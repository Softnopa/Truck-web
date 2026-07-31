"""Enrolling a face, and later deciding whether a burst of frames is that face.

The engine turns pixels into vectors, the store keeps them, liveness judges the
movement — this is the layer that puts the three in order and owns the one
decision that matters: whether to hand back the secret.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from . import config, engine as eng, liveness
from .engine import Engine, NoFace
from .liveness import ChallengeBook, Observation
from .store import FaceStore


@dataclass
class EnrolResult:
    ok: bool
    reason: str = ""
    accepted: int = 0
    secret: str = ""
    label: str = ""


@dataclass
class ChallengeResult:
    ok: bool
    reason: str = ""
    token: str = ""
    action: str = ""


@dataclass
class VerifyResult:
    ok: bool
    reason: str = ""
    similarity: float = 0.0
    secret: str = ""


@dataclass
class Attempts:
    """Consecutive failures for one person, and when the last one landed."""

    count: int = 0
    at: float = field(default_factory=time.monotonic)


class FaceService:
    def __init__(self) -> None:
        self.engine = Engine()
        self.store = FaceStore()
        self.challenges = ChallengeBook()
        self._attempts: dict[str, Attempts] = {}

    # --- enrolment ------------------------------------------------------------

    def enrol(self, person_id: str, label: str, frames: list[str]) -> EnrolResult:
        """
        Captures a face id from a handful of frames of someone facing the camera.

        Frames without a usable face are dropped rather than failing the whole
        capture — in a burst of a dozen, a blink or a turn away is normal. What
        is not survivable is the frames disagreeing with each other: that means
        two people were in shot, and a template built from both would match
        neither well.
        """
        embeddings: list[np.ndarray] = []
        crops: list[np.ndarray] = []
        yaws: list[float] = []
        reasons: list[str] = []

        for payload in frames[: config.MAX_ENROL_SAMPLES * 3]:
            try:
                image = eng.decode_frame(payload)
                face = self.engine.primary_face(image)
            except NoFace as exc:
                reasons.append(str(exc).replace(" ", "_"))
                continue

            embeddings.append(self.engine.embed(image, face))
            crops.append(self.engine.aligned_crop(image, face))
            yaws.append(face.yaw)
            if len(embeddings) >= config.MAX_ENROL_SAMPLES:
                break

        if len(embeddings) < config.MIN_ENROL_SAMPLES:
            return EnrolResult(ok=False, reason=liveness.most_common(reasons) or "no_face")

        stacked = np.stack(embeddings)
        centre = eng.normalise(stacked.mean(axis=0))
        agreement = stacked @ centre

        keep = agreement >= config.ENROL_CONSISTENCY
        if int(keep.sum()) < config.MIN_ENROL_SAMPLES:
            return EnrolResult(ok=False, reason="inconsistent")

        kept_embeddings = stacked[keep]
        kept_crops = [c for c, k in zip(crops, keep) if k]
        # The neutral pose is personal — noses do not sit centred between
        # everyone's eyes. Recording the median here is what lets the turn
        # thresholds later mean "turned, for this person".
        yaw_bias = float(np.median([y for y, k in zip(yaws, keep) if k]))

        record, secret = self.store.enrol(
            person_id=person_id,
            label=label,
            embeddings=kept_embeddings,
            crops=kept_crops,
            yaw_bias=yaw_bias,
        )
        return EnrolResult(
            ok=True,
            accepted=record.sample_count,
            secret=secret,
            label=record.label,
        )

    # --- verification ---------------------------------------------------------

    def challenge(self, person_id: str) -> ChallengeResult:
        """
        Names a direction for this attempt, unless the face is in cooldown.

        Refusing here rather than at /verify is deliberate: an attacker who never
        receives a direction has nothing to answer, so the burst of frames is
        never even worth capturing.
        """
        if not self.store.exists(person_id):
            return ChallengeResult(ok=False, reason="not_enrolled")
        if self._locked_out(person_id):
            return ChallengeResult(ok=False, reason="too_many_attempts")

        challenge = self.challenges.issue(person_id)
        return ChallengeResult(ok=True, token=challenge.token, action=challenge.action)

    def verify(self, token: str, frames: list[str]) -> VerifyResult:
        challenge = self.challenges.redeem(token)
        if challenge is None:
            return VerifyResult(ok=False, reason="expired")

        record = self.store.load(challenge.person_id)
        if record is None:
            return VerifyResult(ok=False, reason="unknown_person")

        observations: list[Observation] = []
        for index, payload in enumerate(frames[:60]):
            try:
                image = eng.decode_frame(payload)
                face = self.engine.primary_face(image)
            except NoFace as exc:
                observations.append(
                    Observation(
                        index=index,
                        yaw=None,
                        similarity=0.0,
                        reason=str(exc).replace(" ", "_"),
                    )
                )
                continue

            probe = self.engine.embed(image, face)
            observations.append(
                Observation(
                    index=index,
                    yaw=face.yaw - record.yaw_bias,
                    similarity=eng.best_similarity(probe, record.embeddings),
                )
            )

        verdict = liveness.judge(observations, challenge.action)
        if not verdict.ok:
            # Framing problems — nobody in shot, too far away — are the owner
            # holding the laptop wrong, not an attempt, so they do not count
            # toward the lockout.
            if verdict.reason in ("no_match", "wrong_turn"):
                self._record_failure(challenge.person_id)
            return VerifyResult(
                ok=False,
                reason=verdict.reason,
                # Only ever reported for a pose failure; an identity failure
                # carries 0.0 so a caller cannot climb toward the threshold.
                similarity=0.0 if verdict.reason == "no_match" else verdict.similarity,
            )

        secret = self.store.secret(challenge.person_id)
        if not secret:
            return VerifyResult(ok=False, reason="unknown_person")

        self._attempts.pop(challenge.person_id, None)
        return VerifyResult(ok=True, similarity=verdict.similarity, secret=secret)

    # --- lockout --------------------------------------------------------------

    def _locked_out(self, person_id: str) -> bool:
        attempts = self._attempts.get(person_id)
        if attempts is None or attempts.count < config.FAILURE_LIMIT:
            return False
        if time.monotonic() - attempts.at >= config.FAILURE_COOLDOWN_SECONDS:
            del self._attempts[person_id]
            return False
        return True

    def _record_failure(self, person_id: str) -> None:
        attempts = self._attempts.setdefault(person_id, Attempts(count=0))
        attempts.count += 1
        attempts.at = time.monotonic()

    # --- management -----------------------------------------------------------

    def faces(self) -> list[dict]:
        return [record.summary() for record in self.store.load_all()]

    def forget(self, person_id: str) -> bool:
        return self.store.forget(person_id)

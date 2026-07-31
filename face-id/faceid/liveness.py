"""Proving there is a head in front of the camera, not a photograph of one.

An embedding cannot tell the two apart — a printed photo of the right person
produces the right vector, which is the whole reason a webcam alone is a weaker
lock than the infrared sensor behind Windows Hello or Face ID.

What is done about it here: the server names a direction *after* the app asks,
and the burst of frames that comes back has to show a head that started facing
the camera and then turned that way, while staying the same person throughout.
A still photo cannot answer, because it cannot turn. Anyone who does not know
the direction in advance cannot answer either, because it is chosen per attempt
and each challenge is redeemable once.

What this does not stop: a video of the owner turning both ways, or a photo on a
stick tilted convincingly. Say so out loud rather than implying otherwise — this
raises the cost of the attack, it does not close it. The session encryption is
what limits the damage if it is beaten.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

from . import config

#: The two directions a head can be asked to turn. Both are equally easy to
#: perform and equally hard to guess, which is the only property that matters.
ACTIONS = ("left", "right")


@dataclass(frozen=True)
class Challenge:
    token: str
    person_id: str
    action: str
    issued_at: float

    def expired(self, at: float | None = None) -> bool:
        return (at or time.monotonic()) - self.issued_at > config.CHALLENGE_TTL_SECONDS


@dataclass
class Observation:
    """One frame, after the engine has looked at it."""

    index: int
    yaw: float | None  # relative to the person's enrolled neutral, None if no face
    similarity: float
    reason: str | None = None  # why there is no yaw


@dataclass
class Verdict:
    ok: bool
    reason: str = ""
    similarity: float = 0.0
    turned: float = 0.0
    faces_seen: int = 0


class ChallengeBook:
    """
    Live challenges, in memory only.

    Restarting the service invalidates every outstanding one, which is the
    correct behaviour: they are worth seconds, and a challenge that survives a
    restart is a challenge someone could have recorded an answer to.
    """

    def __init__(self) -> None:
        self._open: dict[str, Challenge] = {}

    def issue(self, person_id: str) -> Challenge:
        self._prune()
        challenge = Challenge(
            token=secrets.token_urlsafe(18),
            person_id=person_id,
            action=secrets.choice(ACTIONS),
            issued_at=time.monotonic(),
        )
        self._open[challenge.token] = challenge
        return challenge

    def redeem(self, token: str) -> Challenge | None:
        """Single use: a token is spent whether or not the answer was right."""
        self._prune()
        challenge = self._open.pop(token, None)
        if challenge is None or challenge.expired():
            return None
        return challenge

    def _prune(self) -> None:
        at = time.monotonic()
        for token in [t for t, c in self._open.items() if c.expired(at)]:
            del self._open[token]


def judge(observations: list[Observation], action: str) -> Verdict:
    """
    Reads a burst of frames as an answer to one challenge.

    Pose failures come back named, because "turn your head left" is a thing the
    owner can act on. Identity failures come back as one undifferentiated
    `no_match`, because telling an attacker how close they got is a service to
    the attacker.
    """
    seen = [o for o in observations if o.yaw is not None]
    faces_seen = len(seen)

    # A burst that mostly missed the face is a framing problem, not a verdict.
    if faces_seen < 5 or faces_seen < len(observations) * 0.5:
        common = most_common([o.reason for o in observations if o.reason]) or "no_face"
        return Verdict(ok=False, reason=common, faces_seen=faces_seen)

    want_negative = action == "left"

    centred = [o for o in seen if abs(o.yaw or 0.0) <= config.YAW_CENTRE]
    if not centred:
        return Verdict(ok=False, reason="not_centred", faces_seen=faces_seen)

    def turned_far(o: Observation) -> bool:
        yaw = o.yaw or 0.0
        return yaw <= -config.YAW_TURN if want_negative else yaw >= config.YAW_TURN

    def turned_wrong(o: Observation) -> bool:
        yaw = o.yaw or 0.0
        return yaw >= config.YAW_TURN if want_negative else yaw <= -config.YAW_TURN

    # Asked one way and went the other: judged before the missing turn, because
    # the two failures are not the same kind of event. Turning the wrong way is
    # an answer, and a wrong answer counts against the attempt limit; simply not
    # having turned yet is an owner who has not moved.
    if any(turned_wrong(o) for o in seen):
        return Verdict(ok=False, reason="wrong_turn", faces_seen=faces_seen)

    # Order matters: facing the camera *and then* turning is a movement. Holding
    # a photo up already turned, then straightening it, is not the same evidence.
    first_centred = centred[0].index
    turns = [o for o in seen if turned_far(o) and o.index > first_centred]
    if not turns:
        return Verdict(ok=False, reason="no_turn", faces_seen=faces_seen)

    # Identity is taken from the frames facing the camera — the pose SFace is
    # strongest on — but every frame still has to look like the same person, so
    # a second face cannot be swapped in for the turn.
    best = max(o.similarity for o in centred)
    weakest = min(o.similarity for o in seen)
    turned = max(abs(o.yaw or 0.0) for o in turns)

    if best < config.MATCH_THRESHOLD or weakest < config.FRAME_THRESHOLD:
        return Verdict(ok=False, reason="no_match", similarity=best, faces_seen=faces_seen)

    return Verdict(ok=True, similarity=best, turned=turned, faces_seen=faces_seen)


def most_common(values: list[str]) -> str | None:
    if not values:
        return None
    return max(set(values), key=values.count)

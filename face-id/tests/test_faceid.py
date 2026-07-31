"""Tests for the face engine, the store and the liveness judgement.

    python -m unittest discover -s tests

The tests that need a real face use one photograph, downloaded once into
`tests/.cache` from the OpenCV samples. Two derived frames stand in for head
movement: a mirrored copy flips the yaw, which is exactly the signal a turn
produces, and small noise stands in for consecutive webcam frames. That is
enough to exercise decode -> detect -> yaw -> embed -> judge for real. It is not
a recognition benchmark; SFace's accuracy is upstream's business.
"""

from __future__ import annotations

import os
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

# Must precede the faceid imports: config reads the environment once, at import.
_TMP = tempfile.mkdtemp(prefix="faceid-tests-")
os.environ["FACEID_FACES_DIR"] = _TMP

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from faceid import config, engine as eng, liveness, models  # noqa: E402
from faceid.engine import Engine  # noqa: E402
from faceid.liveness import Observation  # noqa: E402
from faceid.service import FaceService  # noqa: E402
from faceid.store import FaceStore  # noqa: E402

CACHE = Path(__file__).resolve().parent / ".cache"
SAMPLE_URL = "https://raw.githubusercontent.com/opencv/opencv/master/samples/data/messi5.jpg"


def sample_face() -> np.ndarray | None:
    """A webcam-sized face, or None when the photo cannot be fetched."""
    CACHE.mkdir(exist_ok=True)
    path = CACHE / "sample.jpg"
    if not path.exists():
        try:
            request = urllib.request.Request(SAMPLE_URL, headers={"User-Agent": "faceid-tests"})
            with urllib.request.urlopen(request, timeout=30) as response:
                path.write_bytes(response.read())
        except (urllib.error.URLError, OSError):
            return None

    image = cv2.imread(str(path))
    if image is None:
        return None
    # Cropped to the head and scaled up: the source face is 31px across, well
    # under the size the service accepts, and a webcam frame is not.
    return cv2.resize(image[60:180, 190:300], None, fx=5, fy=5, interpolation=cv2.INTER_CUBIC)


def to_frame(image: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    import base64

    return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")


def jitter(image: np.ndarray, seed: int) -> np.ndarray:
    """A frame that is the same face but not the same bytes."""
    rng = np.random.default_rng(seed)
    noise = rng.integers(-8, 8, image.shape)
    return np.clip(image.astype(np.int16) + noise, 0, 255).astype(np.uint8)


HAVE_MODELS = not models.missing()


@unittest.skipUnless(HAVE_MODELS, "run `python -m faceid models` first")
class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.image = sample_face()
        if cls.image is None:
            raise unittest.SkipTest("sample photo unavailable offline")
        cls.engine = Engine()

    def test_finds_one_face_large_enough_to_use(self) -> None:
        face = self.engine.primary_face(self.image)
        self.assertGreaterEqual(face.width, config.MIN_FACE_PX)
        self.assertGreater(face.score, config.DETECT_SCORE)

    def test_embedding_is_a_unit_vector(self) -> None:
        face = self.engine.primary_face(self.image)
        vector = self.engine.embed(self.image, face)
        self.assertEqual(vector.shape, (128,))
        self.assertAlmostEqual(float(np.linalg.norm(vector)), 1.0, places=4)

    def test_a_face_matches_itself_across_frames(self) -> None:
        face = self.engine.primary_face(self.image)
        reference = self.engine.embed(self.image, face)
        for seed in range(3):
            frame = jitter(self.image, seed)
            probe = self.engine.embed(frame, self.engine.primary_face(frame))
            self.assertGreater(eng.similarity(reference, probe), config.MATCH_THRESHOLD)

    def test_yaw_ignores_head_tilt(self) -> None:
        """Leaning sideways must not read as turning, or a tilted photo answers."""
        height, width = self.image.shape[:2]
        rotation = cv2.getRotationMatrix2D((width / 2, height / 2), 20, 1.0)
        tilted = cv2.warpAffine(
            self.image, rotation, (width, height), borderMode=cv2.BORDER_REPLICATE
        )
        upright_yaw = self.engine.primary_face(self.image).yaw
        tilted_yaw = self.engine.primary_face(tilted).yaw
        self.assertLess(abs(upright_yaw - tilted_yaw), config.YAW_TURN / 2)

    def test_mirroring_flips_the_turn(self) -> None:
        upright = self.engine.primary_face(self.image).yaw
        mirrored = self.engine.primary_face(cv2.flip(self.image, 1)).yaw
        self.assertLess(mirrored, upright)
        self.assertGreater(abs(upright - mirrored), config.YAW_TURN)

    def test_a_frame_with_no_face_is_refused(self) -> None:
        blank = np.full((480, 640, 3), 200, dtype=np.uint8)
        with self.assertRaises(eng.NoFace):
            self.engine.primary_face(blank)

    def test_a_distant_face_is_refused(self) -> None:
        small = cv2.resize(self.image, None, fx=0.35, fy=0.35)
        with self.assertRaises(eng.NoFace):
            self.engine.primary_face(small)


class DecodeTests(unittest.TestCase):
    def test_rubbish_is_refused_rather_than_crashing(self) -> None:
        with self.assertRaises(eng.NoFace):
            eng.decode_frame("data:image/jpeg;base64,not-base64!!")
        with self.assertRaises(eng.NoFace):
            eng.decode_frame("data:image/jpeg;base64,aGVsbG8=")

    def test_oversized_frames_are_shrunk(self) -> None:
        big = np.zeros((2000, 3000, 3), dtype=np.uint8)
        decoded = eng.decode_frame(to_frame(big))
        self.assertLessEqual(max(decoded.shape[:2]), 960)


def observations(yaws: list[float | None], similarity: float = 0.9) -> list[Observation]:
    return [
        Observation(index=i, yaw=y, similarity=0.0 if y is None else similarity, reason=None if y is not None else "no_face")
        for i, y in enumerate(yaws)
    ]


class LivenessTests(unittest.TestCase):
    """Facing the camera, then turning the way the server asked, and no other way."""

    CENTRED = [0.0, 0.02, -0.03, 0.01, 0.0]

    def test_turning_the_asked_direction_passes(self) -> None:
        verdict = liveness.judge(observations(self.CENTRED + [-0.2, -0.4, -0.45]), "left")
        self.assertTrue(verdict.ok, verdict.reason)

    def test_turning_the_other_way_fails(self) -> None:
        verdict = liveness.judge(observations(self.CENTRED + [0.4, 0.45]), "left")
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.reason, "wrong_turn")

    def test_never_turning_fails(self) -> None:
        verdict = liveness.judge(observations(self.CENTRED + [-0.1, -0.12]), "left")
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.reason, "no_turn")

    def test_turning_before_ever_facing_the_camera_fails(self) -> None:
        """A photo already held at an angle, then straightened, is not a turn."""
        verdict = liveness.judge(observations([-0.4, -0.45] + self.CENTRED), "left")
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.reason, "no_turn")

    def test_a_face_only_ever_turned_fails(self) -> None:
        verdict = liveness.judge(observations([-0.4] * 8), "left")
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.reason, "not_centred")

    def test_mostly_empty_frames_report_framing_not_a_verdict(self) -> None:
        verdict = liveness.judge(observations([None] * 8 + [0.0, -0.4]), "left")
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.reason, "no_face")

    def test_a_stranger_fails_however_well_they_turn(self) -> None:
        verdict = liveness.judge(
            observations(self.CENTRED + [-0.4, -0.45], similarity=0.2), "left"
        )
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.reason, "no_match")

    def test_swapping_faces_midway_fails(self) -> None:
        frames = observations(self.CENTRED, similarity=0.9) + observations(
            [-0.4, -0.45], similarity=0.1
        )
        for index, frame in enumerate(frames):
            frame.index = index
        verdict = liveness.judge(frames, "left")
        self.assertFalse(verdict.ok)
        self.assertEqual(verdict.reason, "no_match")

    def test_a_challenge_can_only_be_answered_once(self) -> None:
        book = liveness.ChallengeBook()
        challenge = book.issue("someone")
        self.assertIsNotNone(book.redeem(challenge.token))
        self.assertIsNone(book.redeem(challenge.token))


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="faceid-store-"))
        self.store = FaceStore(self.root)

    def enrol(self, person_id: str = "owner-1") -> tuple:
        embeddings = eng.normalise(np.ones(128, dtype=np.float32)).reshape(1, 128)
        crop = np.zeros((112, 112, 3), dtype=np.uint8)
        return self.store.enrol(person_id, "Azamat", embeddings, [crop], yaw_bias=0.2)

    def test_a_face_id_round_trips(self) -> None:
        _, secret = self.enrol()
        record = self.store.load("owner-1")
        assert record is not None
        self.assertEqual(record.label, "Azamat")
        self.assertEqual(record.sample_count, 1)
        self.assertAlmostEqual(record.yaw_bias, 0.2, places=3)
        self.assertEqual(self.store.secret("owner-1"), secret)

    def test_the_folder_holds_what_it_says_it_holds(self) -> None:
        self.enrol()
        folder = self.root / "owner-1"
        self.assertTrue((folder / "face.json").exists())
        self.assertTrue((folder / "templates.npy").exists())
        self.assertTrue((folder / "secret.key").exists())
        self.assertTrue((folder / "samples" / "0001.jpg").exists())

    def test_re_enrolling_mints_a_new_secret(self) -> None:
        """Otherwise an attacker who enrolled over a face would inherit its vault."""
        _, first = self.enrol()
        _, second = self.enrol()
        self.assertNotEqual(first, second)

    def test_forget_removes_everything(self) -> None:
        self.enrol()
        self.assertTrue(self.store.forget("owner-1"))
        self.assertFalse((self.root / "owner-1").exists())
        self.assertIsNone(self.store.load("owner-1"))
        self.assertFalse(self.store.forget("owner-1"))

    def test_a_person_id_cannot_escape_the_folder(self) -> None:
        from faceid.store import BadId

        for nasty in ("../secrets", "a/b", "", "x" * 65):
            with self.assertRaises(BadId):
                self.store.exists(nasty)

    def test_a_hand_edited_record_reads_as_absent(self) -> None:
        self.enrol()
        (self.root / "owner-1" / "face.json").write_text("{ broken", encoding="utf-8")
        self.assertIsNone(self.store.load("owner-1"))


@unittest.skipUnless(HAVE_MODELS, "run `python -m faceid models` first")
class ServiceTests(unittest.TestCase):
    """Enrol a face, then answer a challenge with it, through the real pipeline."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.image = sample_face()
        if cls.image is None:
            raise unittest.SkipTest("sample photo unavailable offline")
        cls.mirrored = cv2.flip(cls.image, 1)

    def setUp(self) -> None:
        self.service = FaceService()
        self.service.store = FaceStore(Path(tempfile.mkdtemp(prefix="faceid-svc-")))

    def enrol(self, image: np.ndarray, person_id: str = "owner-1"):
        return self.service.enrol(
            person_id, "Azamat", [to_frame(jitter(image, seed)) for seed in range(6)]
        )

    def challenge_for(self, action: str, person_id: str = "owner-1") -> str:
        """The direction is random per attempt; ask until the wanted one comes up."""
        for _ in range(40):
            result = self.service.challenge(person_id)
            self.assertTrue(result.ok, result.reason)
            if result.action == action:
                return result.token
        self.fail("never drew the requested action")

    def test_enrolment_keeps_the_samples_it_can_use(self) -> None:
        result = self.enrol(self.image)
        self.assertTrue(result.ok, result.reason)
        self.assertGreaterEqual(result.accepted, config.MIN_ENROL_SAMPLES)
        self.assertTrue(result.secret)

    def test_enrolment_needs_a_face(self) -> None:
        blank = np.full((480, 640, 3), 200, dtype=np.uint8)
        result = self.service.enrol("owner-1", "Nobody", [to_frame(blank)] * 6)
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "no_face")

    def test_the_enrolled_face_turning_correctly_gets_the_secret(self) -> None:
        enrolled = self.enrol(self.image)
        token = self.challenge_for("left")
        # Facing the camera, then turned: mirroring is what moves the yaw, and
        # the enrolled bias is what makes "moved" mean moved for this person.
        frames = [to_frame(jitter(self.image, s)) for s in range(6)]
        frames += [to_frame(jitter(self.mirrored, s)) for s in range(4)]

        result = self.service.verify(token, frames)
        self.assertTrue(result.ok, result.reason)
        self.assertEqual(result.secret, enrolled.secret)
        self.assertGreater(result.similarity, config.MATCH_THRESHOLD)

    def test_holding_still_gets_nothing(self) -> None:
        self.enrol(self.image)
        token = self.challenge_for("left")
        frames = [to_frame(jitter(self.image, s)) for s in range(10)]
        result = self.service.verify(token, frames)
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "no_turn")
        self.assertEqual(result.secret, "")

    def test_turning_the_wrong_way_gets_nothing(self) -> None:
        self.enrol(self.mirrored)  # neutral is now the mirrored pose
        token = self.challenge_for("left")
        frames = [to_frame(jitter(self.mirrored, s)) for s in range(6)]
        frames += [to_frame(jitter(self.image, s)) for s in range(4)]  # turns right
        result = self.service.verify(token, frames)
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "wrong_turn")

    def test_a_spent_token_cannot_be_replayed(self) -> None:
        self.enrol(self.image)
        token = self.challenge_for("left")
        frames = [to_frame(jitter(self.image, s)) for s in range(6)]
        frames += [to_frame(jitter(self.mirrored, s)) for s in range(4)]

        self.assertTrue(self.service.verify(token, frames).ok)
        replay = self.service.verify(token, frames)
        self.assertFalse(replay.ok)
        self.assertEqual(replay.reason, "expired")

    def test_nobody_enrolled_means_no_challenge(self) -> None:
        result = self.service.challenge("stranger")
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "not_enrolled")

    def test_repeated_wrong_answers_stop_being_answerable(self) -> None:
        self.enrol(self.mirrored)
        for _ in range(config.FAILURE_LIMIT):
            token = self.challenge_for("left")
            frames = [to_frame(jitter(self.mirrored, s)) for s in range(6)]
            frames += [to_frame(jitter(self.image, s)) for s in range(4)]
            self.assertFalse(self.service.verify(token, frames).ok)

        locked = self.service.challenge("owner-1")
        self.assertFalse(locked.ok)
        self.assertEqual(locked.reason, "too_many_attempts")


if __name__ == "__main__":
    unittest.main()

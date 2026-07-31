"""Everything tunable, in one place.

Every value can be overridden with an environment variable so the thresholds can
be loosened on a dim market laptop without editing code.
"""

from __future__ import annotations

import os
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
ROOT = PACKAGE_DIR.parent  # face-id/


def _path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser().resolve() if raw else default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


# --- where things live -------------------------------------------------------

#: The special folder. One directory per enrolled person, holding their face id.
FACES_DIR = _path("FACEID_FACES_DIR", ROOT / "faces")

#: ONNX weights, downloaded once by `faceid models`.
MODELS_DIR = _path("FACEID_MODELS_DIR", ROOT / "models")

# --- server ------------------------------------------------------------------

HOST = os.environ.get("FACEID_HOST", "127.0.0.1")
PORT = _int("FACEID_PORT", 8765)

# --- detection ---------------------------------------------------------------

#: YuNet confidence below this is not a face worth looking at.
DETECT_SCORE = _float("FACEID_DETECT_SCORE", 0.85)

#: A face smaller than this across is too coarse to embed reliably — it is the
#: difference between someone at the keyboard and someone across the room.
MIN_FACE_PX = _int("FACEID_MIN_FACE_PX", 90)

# --- recognition -------------------------------------------------------------

#: Cosine similarity required to call it the same person. OpenCV publishes 0.363
#: for SFace; this store holds three owners rather than a crowd, so it is worth
#: paying for the stricter setting in occasional retries.
MATCH_THRESHOLD = _float("FACEID_THRESHOLD", 0.42)

#: Every frame in a verification burst is checked, not just the best one, so a
#: face swapped in halfway through fails. Held lower than MATCH_THRESHOLD because
#: turned-away frames legitimately score worse than a full-face one.
FRAME_THRESHOLD = _float("FACEID_FRAME_THRESHOLD", 0.30)

#: Enrolment samples must agree with each other this well, otherwise two
#: different people were captured and the template would match neither.
ENROL_CONSISTENCY = _float("FACEID_ENROL_CONSISTENCY", 0.55)

MIN_ENROL_SAMPLES = _int("FACEID_MIN_ENROL_SAMPLES", 3)
MAX_ENROL_SAMPLES = _int("FACEID_MAX_ENROL_SAMPLES", 12)

# --- liveness ----------------------------------------------------------------

#: Nose offset from the eye midpoint, in interocular widths. Below this the head
#: counts as facing the camera; above it, as turned.
YAW_CENTRE = _float("FACEID_YAW_CENTRE", 0.15)
YAW_TURN = _float("FACEID_YAW_TURN", 0.30)

#: How long a challenge stays answerable. Long enough to read the instruction and
#: move, short enough that a recorded answer goes stale.
CHALLENGE_TTL_SECONDS = _int("FACEID_CHALLENGE_TTL", 45)

#: Frames the browser is asked to send, and the gap between them.
CHALLENGE_FRAMES = _int("FACEID_CHALLENGE_FRAMES", 14)
CHALLENGE_INTERVAL_MS = _int("FACEID_CHALLENGE_INTERVAL_MS", 220)

#: Failed attempts in a row before a face is refused for a cooldown. Generous,
#: because bad light fails honestly, but finite: without it, every threshold in
#: this file is just a number to be retried past.
FAILURE_LIMIT = _int("FACEID_FAILURE_LIMIT", 8)
FAILURE_COOLDOWN_SECONDS = _float("FACEID_FAILURE_COOLDOWN", 60.0)

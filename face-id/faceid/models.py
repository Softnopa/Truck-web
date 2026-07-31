"""The two ONNX files the engine runs on, and how they get here.

They are downloaded rather than committed: 38 MB of weights do not belong in an
app repo, and the URLs below are the upstream OpenCV Zoo releases, so there is
one obvious place to check what is being run.
"""

from __future__ import annotations

import hashlib
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from . import config

ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models"


@dataclass(frozen=True)
class Weights:
    name: str
    filename: str
    url: str
    #: SHA-256 of the upstream file. Checked on download and on load: a truncated
    #: file otherwise surfaces as a baffling OpenCV parse error much later.
    sha256: str

    @property
    def path(self) -> Path:
        return config.MODELS_DIR / self.filename


DETECTOR = Weights(
    name="YuNet",
    filename="face_detection_yunet_2023mar.onnx",
    url=f"{ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    sha256="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
)

RECOGNIZER = Weights(
    name="SFace",
    filename="face_recognition_sface_2021dec.onnx",
    url=f"{ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    sha256="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
)

ALL = (DETECTOR, RECOGNIZER)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def missing() -> list[Weights]:
    return [w for w in ALL if not w.path.exists()]


def fetch(force: bool = False, log=print) -> None:
    """Downloads any weights that are not already on disk."""
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)

    for w in ALL:
        if w.path.exists() and not force:
            log(f"  {w.name}: already here ({w.path.stat().st_size / 1e6:.1f} MB)")
            continue

        log(f"  {w.name}: downloading {w.url}")
        # Written beside the target and renamed, so an interrupted download can
        # never leave a half file that looks present to `missing()`.
        tmp = w.path.with_suffix(w.path.suffix + ".part")
        req = urllib.request.Request(w.url, headers={"User-Agent": "truck-faceid"})
        with urllib.request.urlopen(req, timeout=120) as response, tmp.open("wb") as out:
            while chunk := response.read(1 << 16):
                out.write(chunk)

        # The filenames are dated releases, so the bytes behind them do not move.
        # A mismatch means the download was corrupted or the URL now serves
        # something else — either way, not weights to run a lock on.
        got = digest(tmp)
        if got != w.sha256:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(
                f"{w.filename} does not match its expected checksum.\n"
                f"  expected {w.sha256}\n  got      {got}"
            )
        tmp.replace(w.path)
        log(f"  {w.name}: ready ({w.path.stat().st_size / 1e6:.1f} MB)")


def require() -> tuple[Path, Path]:
    """Paths to both models, or a message saying exactly how to get them."""
    absent = missing()
    if absent:
        names = ", ".join(w.filename for w in absent)
        raise FileNotFoundError(
            f"Missing model weights ({names}) in {config.MODELS_DIR}.\n"
            "Run:  python -m faceid models"
        )
    return DETECTOR.path, RECOGNIZER.path

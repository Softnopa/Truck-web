"""Looking at a face and turning it into 128 numbers.

Two models do the work, both running locally through OpenCV's ONNX runtime:

  YuNet  finds faces and returns five landmarks — both eyes, the nose tip and
         both mouth corners.
  SFace  takes the crop those landmarks align, and produces an embedding: a
         128-dimensional vector where the same person lands in the same place
         and a different person does not.

"Recognition" is then just the angle between two of those vectors. Cosine
similarity, one dot product, no thresholding magic beyond a number you can tune.

The landmarks earn their keep twice: once for alignment, and once for the head
pose used to prove there is a moving head in front of the lens rather than a
photograph — see liveness.py.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

import cv2
import numpy as np

from . import config, models

#: SFace is trained on 112x112 crops that alignCrop produces from the landmarks.
ALIGNED_SIZE = 112


@dataclass(frozen=True)
class Face:
    """One detection, kept in the raw layout OpenCV wants back for alignment."""

    #: The 15 floats YuNet emits: x, y, w, h, 5 landmark pairs, score.
    row: np.ndarray

    @property
    def box(self) -> tuple[int, int, int, int]:
        x, y, w, h = self.row[:4]
        return int(x), int(y), int(w), int(h)

    @property
    def width(self) -> float:
        return float(self.row[2])

    @property
    def score(self) -> float:
        return float(self.row[14])

    @property
    def landmarks(self) -> np.ndarray:
        """(5, 2): right eye, left eye, nose, right mouth, left mouth."""
        return self.row[4:14].reshape(5, 2)

    @property
    def yaw(self) -> float:
        """
        How far the head is turned, as a signed fraction of eye separation.

        Not degrees — the nose tip's offset from the midpoint between the eyes,
        measured *along the line joining them*. Zero means facing the camera;
        turning the head slides the nose toward one eye and away from the other.

        Two normalisations do real work here. Dividing by the distance between
        the eyes makes it independent of how close the person is sitting.
        Projecting onto the eye axis rather than onto the image's x axis makes it
        independent of head tilt — otherwise leaning sideways would read as a
        turn, and the challenge could be answered by tipping a photograph.

        Sign follows the frames as captured, which the browser mirrors before
        sending, so a turn to the person's own left reads negative — the same
        direction they watch themselves move.
        """
        right_eye, left_eye, nose = self.landmarks[0], self.landmarks[1], self.landmarks[2]
        eye_axis = left_eye - right_eye
        separation = float(np.linalg.norm(eye_axis))
        if separation < 1e-3:
            return 0.0
        midpoint = (right_eye + left_eye) / 2.0
        return float(np.dot(nose - midpoint, eye_axis) / (separation * separation))


class NoFace(Exception):
    """Raised when a frame holds nothing usable. The message is shown to nobody."""


class Engine:
    """Loads both models once and keeps them warm."""

    def __init__(self) -> None:
        detector_path, recognizer_path = models.require()
        self._detector = cv2.FaceDetectorYN.create(
            str(detector_path),
            "",
            (320, 320),  # replaced per frame by setInputSize
            config.DETECT_SCORE,
            0.3,  # NMS
            5000,  # top_k before NMS
        )
        self._recognizer = cv2.FaceRecognizerSF.create(str(recognizer_path), "")
        self._input_size: tuple[int, int] | None = None

    # --- detection ------------------------------------------------------------

    def detect(self, image: np.ndarray) -> list[Face]:
        """Every face in the frame, largest first."""
        height, width = image.shape[:2]
        size = (width, height)
        if size != self._input_size:
            self._detector.setInputSize(size)
            self._input_size = size

        _, raw = self._detector.detect(image)
        if raw is None:
            return []
        faces = [Face(row.astype(np.float32)) for row in raw]
        faces.sort(key=lambda f: f.width, reverse=True)
        return faces

    def primary_face(self, image: np.ndarray) -> Face:
        """
        The one face this frame is about, or NoFace.

        A second face in shot is not rejected — market laptops have people
        walking behind them — but it must be clearly further away, otherwise
        there is no way to tell which one the frame is claiming to be.
        """
        faces = self.detect(image)
        if not faces:
            raise NoFace("no face")

        nearest = faces[0]
        if nearest.width < config.MIN_FACE_PX:
            raise NoFace("too far")
        if len(faces) > 1 and faces[1].width > nearest.width * 0.75:
            raise NoFace("two faces")
        return nearest

    # --- embedding ------------------------------------------------------------

    def embed(self, image: np.ndarray, face: Face) -> np.ndarray:
        """
        The face id itself: 128 floats, L2-normalised so comparing two of them
        is a dot product.
        """
        aligned = self._recognizer.alignCrop(image, face.row)
        feature = self._recognizer.feature(aligned)
        return normalise(np.asarray(feature, dtype=np.float32).reshape(-1))

    def aligned_crop(self, image: np.ndarray, face: Face) -> np.ndarray:
        """The 112x112 the embedding was taken from, kept as a re-enrolment source."""
        return self._recognizer.alignCrop(image, face.row)


# --- vector helpers ----------------------------------------------------------


def normalise(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    return vector if norm < 1e-9 else (vector / norm).astype(np.float32)


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity of two normalised embeddings: 1.0 identical, ~0 unrelated."""
    return float(np.dot(a, b))


def best_similarity(probe: np.ndarray, templates: np.ndarray) -> float:
    """
    Scored against the closest enrolled sample rather than their average.

    Averaging blurs a set that deliberately spans several head angles, and the
    blur costs exactly the poses it was captured to cover.
    """
    if templates.size == 0:
        return 0.0
    return float(np.max(templates @ probe))


# --- frame decoding ----------------------------------------------------------


def decode_frame(payload: str) -> np.ndarray:
    """
    A `data:image/jpeg;base64,...` string from the browser, as a BGR array.

    Size is capped before anything else touches it: the browser is asked for
    640px frames, and an oversized one would otherwise mean a slow detect on
    every frame of the burst.
    """
    _, _, encoded = payload.rpartition(",")
    try:
        blob = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise NoFace("undecodable frame") from exc

    image = cv2.imdecode(np.frombuffer(blob, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise NoFace("undecodable frame")

    height, width = image.shape[:2]
    if max(height, width) > 960:
        scale = 960 / max(height, width)
        image = cv2.resize(image, (round(width * scale), round(height * scale)))
    return image

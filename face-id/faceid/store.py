"""The special folder: where face ids live on disk.

One directory per person, all of it plain and inspectable:

    faces/
      <person-id>/
        face.json        who this is, when it was captured, how it is scored
        templates.npy    the embeddings — the face id itself, (N, 128) float32
        secret.key       32 random bytes, handed back only after a match
        samples/0001.jpg the aligned crops the embeddings came from

Two things deserve their own note.

`secret.key` is not a password and never leaves this machine except to the app
that just passed a face check. The browser seals its Supabase session with it and
keeps only the ciphertext, so a stolen browser profile is worth nothing without
this file *and* the face that releases it. Re-enrolling from scratch mints a new
one, which deliberately strands any older vault instead of silently unlocking it.

The crops in `samples/` are kept so a future model change can rebuild the
embeddings without dragging everyone back to the camera. They are photographs of
faces: this folder is biometric data, it is excluded from git, and it is exactly
as private as the Windows account it sits under.
"""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from . import config

MODEL_TAG = "sface_2021dec"
MANIFEST = "face.json"
TEMPLATES = "templates.npy"
SECRET = "secret.key"
SAMPLES = "samples"

#: Ids come from Supabase (uuids), but this is what stops one becoming `../..`.
SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class BadId(ValueError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class FaceRecord:
    person_id: str
    label: str
    created_at: str
    updated_at: str
    yaw_bias: float
    samples: list[dict]
    embeddings: np.ndarray  # (N, 128) float32, L2-normalised

    @property
    def sample_count(self) -> int:
        return int(self.embeddings.shape[0])

    def summary(self) -> dict:
        return {
            "personId": self.person_id,
            "label": self.label,
            "samples": self.sample_count,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


class FaceStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or config.FACES_DIR
        self.root.mkdir(parents=True, exist_ok=True)
        _lock_down(self.root)

    # --- paths ---------------------------------------------------------------

    def _dir(self, person_id: str) -> Path:
        if not SAFE_ID.match(person_id):
            raise BadId("person id must be 1-64 chars of A-Z a-z 0-9 . _ -")
        return self.root / person_id

    def exists(self, person_id: str) -> bool:
        return (self._dir(person_id) / MANIFEST).exists()

    def ids(self) -> list[str]:
        return sorted(
            entry.name
            for entry in self.root.iterdir()
            if entry.is_dir() and (entry / MANIFEST).exists()
        )

    # --- read ----------------------------------------------------------------

    def load(self, person_id: str) -> FaceRecord | None:
        folder = self._dir(person_id)
        manifest_path = folder / MANIFEST
        if not manifest_path.exists():
            return None

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            embeddings = np.load(folder / TEMPLATES)
        except (OSError, ValueError):
            # A half-written or hand-edited record reads as "not enrolled", which
            # sends the owner to the password rather than to a stack trace.
            return None

        embeddings = np.atleast_2d(np.asarray(embeddings, dtype=np.float32))
        if embeddings.ndim != 2 or embeddings.shape[1] != 128:
            return None

        return FaceRecord(
            person_id=person_id,
            label=str(manifest.get("label", "")),
            created_at=str(manifest.get("createdAt", "")),
            updated_at=str(manifest.get("updatedAt", "")),
            yaw_bias=float(manifest.get("yawBias", 0.0)),
            samples=list(manifest.get("samples", [])),
            embeddings=embeddings,
        )

    def load_all(self) -> list[FaceRecord]:
        return [r for r in (self.load(i) for i in self.ids()) if r is not None]

    def secret(self, person_id: str) -> str | None:
        path = self._dir(person_id) / SECRET
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8").strip() or None

    # --- write ---------------------------------------------------------------

    def enrol(
        self,
        person_id: str,
        label: str,
        embeddings: np.ndarray,
        crops: list[np.ndarray],
        yaw_bias: float,
    ) -> tuple[FaceRecord, str]:
        """
        Replaces any existing face id for this person and returns the record
        along with a freshly minted secret.
        """
        folder = self._dir(person_id)
        if folder.exists():
            shutil.rmtree(folder)
        (folder / SAMPLES).mkdir(parents=True)
        _lock_down(folder)

        stamp = now()
        samples = []
        for index, crop in enumerate(crops, start=1):
            name = f"{SAMPLES}/{index:04d}.jpg"
            cv2.imwrite(str(folder / name), crop)
            samples.append({"file": name, "capturedAt": stamp})

        np.save(folder / TEMPLATES, embeddings.astype(np.float32))
        (folder / MANIFEST).write_text(
            json.dumps(
                {
                    "version": 1,
                    "personId": person_id,
                    "label": label,
                    "model": MODEL_TAG,
                    "createdAt": stamp,
                    "updatedAt": stamp,
                    "yawBias": round(yaw_bias, 4),
                    "matchThreshold": config.MATCH_THRESHOLD,
                    "samples": samples,
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        secret = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
        secret_path = folder / SECRET
        secret_path.write_text(secret, encoding="utf-8")
        _lock_down(secret_path)

        record = self.load(person_id)
        assert record is not None  # just written
        return record, secret

    def forget(self, person_id: str) -> bool:
        folder = self._dir(person_id)
        if not folder.exists():
            return False
        shutil.rmtree(folder)
        return True


def _lock_down(path: Path) -> None:
    """
    Owner-only permissions where the OS honours them.

    On Windows this is close to cosmetic — the real protection is the user
    profile the folder sits in — so it is applied quietly and never fatal.
    """
    try:
        os.chmod(path, 0o700 if path.is_dir() else 0o600)
    except OSError:
        pass

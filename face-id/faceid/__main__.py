"""Command line for the face service.

    python -m faceid models                 download the two ONNX models
    python -m faceid serve                  run the service the app talks to
    python -m faceid list                   who is enrolled
    python -m faceid enroll <id> a.jpg ...  enrol from photo files
    python -m faceid forget <id>            delete a face id
    python -m faceid check a.jpg ...        what the detector sees, for tuning
"""

from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

from . import config, models


def _data_url(path: Path) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def cmd_models(args: argparse.Namespace) -> int:
    print(f"Models in {config.MODELS_DIR}")
    models.fetch(force=args.force)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    from .server import serve

    serve(
        host=args.host,
        port=args.port,
        origins=args.origin,
        certfile=Path(args.cert) if args.cert else None,
        keyfile=Path(args.key) if args.key else None,
    )
    return 0


def cmd_list(_: argparse.Namespace) -> int:
    from .store import FaceStore

    store = FaceStore()
    records = store.load_all()
    print(f"Face ids in {store.root}")
    if not records:
        print("  nobody enrolled yet")
        return 0
    for record in records:
        print(
            f"  {record.person_id}"
            f"  {record.label or '(no name)'}"
            f"  {record.sample_count} samples"
            f"  enrolled {record.created_at}"
        )
    return 0


def cmd_enroll(args: argparse.Namespace) -> int:
    from .service import FaceService

    paths = [Path(p) for p in args.images]
    missing = [p for p in paths if not p.exists()]
    if missing:
        print(f"No such file: {missing[0]}", file=sys.stderr)
        return 1

    service = FaceService()
    result = service.enrol(args.person_id, args.label, [_data_url(p) for p in paths])
    if not result.ok:
        print(f"Refused: {result.reason}", file=sys.stderr)
        return 1

    print(f"Enrolled {args.label or args.person_id} from {result.accepted} samples")
    print(f"  stored in {config.FACES_DIR / args.person_id}")
    # Printed once and never again: the app receives it over the API at
    # enrolment, and after that only a face releases it.
    print(f"  secret {result.secret}")
    return 0


def cmd_forget(args: argparse.Namespace) -> int:
    from .store import FaceStore

    removed = FaceStore().forget(args.person_id)
    print("Removed" if removed else "Nothing to remove")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    """
    Prints what the detector makes of each image: how wide the face is, how
    confident it is, and the yaw. Run it on a few frames to see where the turn
    thresholds should sit for a particular camera and desk.
    """
    from .engine import Engine, decode_frame

    engine = Engine()
    for name in args.images:
        path = Path(name)
        if not path.exists():
            print(f"{path}: no such file")
            continue
        image = decode_frame(_data_url(path))
        faces = engine.detect(image)
        if not faces:
            print(f"{path.name}: no face")
            continue
        for index, face in enumerate(faces):
            flag = "" if face.width >= config.MIN_FACE_PX else "  (too small)"
            print(
                f"{path.name}[{index}]: {face.width:.0f}px  "
                f"score {face.score:.2f}  yaw {face.yaw:+.3f}{flag}"
            )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="faceid", description=__doc__.split("\n")[0])
    subs = parser.add_subparsers(dest="command", required=True)

    p = subs.add_parser("models", help="download the ONNX weights")
    p.add_argument("--force", action="store_true", help="re-download even if present")
    p.set_defaults(run=cmd_models)

    p = subs.add_parser("serve", help="run the local face service")
    p.add_argument("--host", default=config.HOST)
    p.add_argument("--port", type=int, default=config.PORT)
    p.add_argument(
        "--origin",
        action="append",
        default=[],
        metavar="URL",
        help="an extra browser origin allowed to call this service, e.g. "
        "https://truck.vercel.app (localhost is always allowed)",
    )
    p.add_argument("--cert", help="TLS certificate, if serving over https")
    p.add_argument("--key", help="TLS private key")
    p.set_defaults(run=cmd_serve)

    p = subs.add_parser("list", help="show enrolled face ids")
    p.set_defaults(run=cmd_list)

    p = subs.add_parser("enroll", help="enrol a face from photo files")
    p.add_argument("person_id")
    p.add_argument("images", nargs="+")
    p.add_argument("--label", default="", help="display name")
    p.set_defaults(run=cmd_enroll)

    p = subs.add_parser("forget", help="delete a face id")
    p.add_argument("person_id")
    p.set_defaults(run=cmd_forget)

    p = subs.add_parser("check", help="print detections and yaw, for tuning")
    p.add_argument("images", nargs="+")
    p.set_defaults(run=cmd_check)

    args = parser.parse_args(argv)
    try:
        return int(args.run(args))
    except FileNotFoundError as exc:
        # Almost always the missing weights, whose message says what to run.
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

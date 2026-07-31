"""The local HTTP face service the app talks to.

Bound to 127.0.0.1 by default, which is the important part: face ids, the
embeddings and the secrets never leave this machine, and there is no account,
no upload and nothing to breach elsewhere.

That also creates the one exposure worth thinking about. Any page in the
browser can try to reach a port on localhost, so the origin allowlist below is
not decoration — without it, an unrelated tab could ask this service to forget a
face or enrol over one. It cannot steal a session that way (the sealed vault
lives in the app's own origin, where no other page can read it), but it could
lock the owner out, and that is enough reason to check.
"""

from __future__ import annotations

import json
import re
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from . import config
from .service import FaceService
from .store import BadId

#: Frames are ~50 KB each and a burst is a couple of dozen. Anything past this
#: is not a face capture.
MAX_BODY = 32 * 1024 * 1024

LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")


class OriginPolicy:
    """
    localhost is always allowed — that is the dev server and the app itself.
    Anything else has to be named on the command line, which keeps the deployed
    web build working without opening the door to every site the owner visits.
    """

    def __init__(self, extra: list[str]) -> None:
        self.extra = {o.rstrip("/") for o in extra if o}

    def allows(self, origin: str | None) -> bool:
        if not origin:
            # A same-origin or non-browser caller (curl, the CLI) sends none.
            return True
        origin = origin.rstrip("/")
        return bool(LOCAL_ORIGIN.match(origin)) or origin in self.extra


class Handler(BaseHTTPRequestHandler):
    server_version = "faceid/1.0"
    protocol_version = "HTTP/1.1"

    service: FaceService
    policy: OriginPolicy
    lock: threading.Lock

    # --- plumbing -------------------------------------------------------------

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A002
        # The default logs every request line; this service logs outcomes
        # instead, from the handlers, where they mean something.
        pass

    def _origin_ok(self) -> bool:
        return self.policy.allows(self.headers.get("Origin"))

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin.rstrip("/"))
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        # Chrome asks before letting a public page reach a private address.
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except (OSError, ValueError):
            return None

    def _note(self, message: str) -> None:
        print(f"  {message}", flush=True)

    # --- routes ---------------------------------------------------------------

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._origin_ok():
            self._reply(403, {"ok": False, "reason": "origin"})
            return
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if not self._origin_ok():
            self._reply(403, {"ok": False, "reason": "origin"})
            return

        if self.path == "/health":
            with self.lock:
                count = len(self.service.store.ids())
            self._reply(
                200,
                {
                    "ok": True,
                    "service": "truck-faceid",
                    "model": "YuNet + SFace",
                    "enrolled": count,
                    "matchThreshold": config.MATCH_THRESHOLD,
                },
            )
            return

        if self.path == "/faces":
            with self.lock:
                faces = self.service.faces()
            self._reply(200, {"ok": True, "faces": faces})
            return

        self._reply(404, {"ok": False, "reason": "no_such_route"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._origin_ok():
            self._reply(403, {"ok": False, "reason": "origin"})
            return

        body = self._body()
        if body is None:
            self._reply(400, {"ok": False, "reason": "bad_request"})
            return

        try:
            if self.path == "/enroll":
                self._enroll(body)
            elif self.path == "/challenge":
                self._challenge(body)
            elif self.path == "/verify":
                self._verify(body)
            elif self.path == "/forget":
                self._forget(body)
            else:
                self._reply(404, {"ok": False, "reason": "no_such_route"})
        except BadId:
            self._reply(400, {"ok": False, "reason": "bad_person_id"})

    def _enroll(self, body: dict) -> None:
        person_id = str(body.get("personId", ""))
        label = str(body.get("label", ""))[:64]
        frames = [f for f in body.get("frames", []) if isinstance(f, str)]
        if not person_id or not frames:
            self._reply(400, {"ok": False, "reason": "bad_request"})
            return

        with self.lock:
            result = self.service.enrol(person_id, label, frames)

        self._note(
            f"enrol {label or person_id}: "
            + (f"{result.accepted} samples kept" if result.ok else f"refused ({result.reason})")
        )
        self._reply(
            200,
            {"ok": True, "accepted": result.accepted, "secret": result.secret}
            if result.ok
            else {"ok": False, "reason": result.reason},
        )

    def _challenge(self, body: dict) -> None:
        person_id = str(body.get("personId", ""))
        if not person_id:
            self._reply(400, {"ok": False, "reason": "bad_request"})
            return

        with self.lock:
            result = self.service.challenge(person_id)

        if not result.ok:
            self._reply(200, {"ok": False, "reason": result.reason})
            return

        self._reply(
            200,
            {
                "ok": True,
                "token": result.token,
                "action": result.action,
                "frames": config.CHALLENGE_FRAMES,
                "intervalMs": config.CHALLENGE_INTERVAL_MS,
                "ttlSeconds": config.CHALLENGE_TTL_SECONDS,
            },
        )

    def _verify(self, body: dict) -> None:
        token = str(body.get("token", ""))
        frames = [f for f in body.get("frames", []) if isinstance(f, str)]
        if not token or not frames:
            self._reply(400, {"ok": False, "reason": "bad_request"})
            return

        with self.lock:
            result = self.service.verify(token, frames)

        self._note(
            "verify: "
            + (f"match ({result.similarity:.2f})" if result.ok else f"no ({result.reason})")
        )
        self._reply(
            200,
            {"ok": True, "secret": result.secret, "similarity": round(result.similarity, 4)}
            if result.ok
            else {"ok": False, "reason": result.reason},
        )

    def _forget(self, body: dict) -> None:
        person_id = str(body.get("personId", ""))
        if not person_id:
            self._reply(400, {"ok": False, "reason": "bad_request"})
            return
        with self.lock:
            removed = self.service.forget(person_id)
        self._note(f"forget {person_id}: {'removed' if removed else 'nothing to remove'}")
        self._reply(200, {"ok": True, "removed": removed})


def serve(
    host: str = config.HOST,
    port: int = config.PORT,
    origins: list[str] | None = None,
    certfile: Path | None = None,
    keyfile: Path | None = None,
) -> None:
    service = FaceService()
    policy = OriginPolicy(origins or [])

    handler = type(
        "BoundHandler",
        (Handler,),
        {
            "service": service,
            "policy": policy,
            # One engine, one store, one lock. OpenCV's ONNX nets are not
            # something to call from several threads at once, and a face check
            # takes tens of milliseconds — there is nothing to gain by trying.
            "lock": threading.Lock(),
        },
    )

    httpd = ThreadingHTTPServer((host, port), handler)
    scheme = "http"
    if certfile and keyfile:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile, keyfile)
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"

    lines = [
        f"Face ID service on {scheme}://{host}:{port}",
        f"  face ids: {config.FACES_DIR}",
        f"  enrolled: {', '.join(service.store.ids()) or 'nobody yet'}",
    ]
    if policy.extra:
        lines.append(f"  also accepting: {', '.join(sorted(policy.extra))}")
    lines.append("  Ctrl+C to stop")
    # Flushed: stdout is block-buffered when this is piped to a log, and a
    # service that appears to print nothing at startup looks hung.
    print("\n".join(lines), flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        httpd.server_close()

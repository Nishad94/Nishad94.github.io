#!/usr/bin/env python3
"""Narrow public gateway for the nishad.ai self-hosted Gemma terminal."""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 32 * 1024
UPSTREAM = os.getenv("GEMMA_UPSTREAM", "http://127.0.0.1:8080/v1/chat/completions")
MODEL = os.getenv("GEMMA_MODEL", "gemma-4-26b-a4b-q4")
ALLOWED_ORIGINS = frozenset(filter(None, os.getenv("ALLOWED_ORIGINS", "https://nishad.ai").split(",")))
LIMITS = {
    "chat_ip": int(os.getenv("CHAT_PER_IP_DAILY", "40")),
    "chat_global": int(os.getenv("CHAT_GLOBAL_DAILY", "1000")),
    "report_ip": int(os.getenv("REPORT_PER_IP_DAILY", "5")),
    "report_global": int(os.getenv("REPORT_GLOBAL_DAILY", "200")),
}

_lock = threading.Lock()
_counts: dict[str, int] = {}


def bump(key: str, limit: int) -> bool:
    day = time.strftime("%Y-%m-%d", time.gmtime())
    bucket = f"{day}:{key}"
    with _lock:
        current = _counts.get(bucket, 0)
        if current >= limit:
            return False
        _counts[bucket] = current + 1
        # Bound memory even if the process survives for months.
        if len(_counts) > 100_000:
            for old in [name for name in _counts if not name.startswith(day + ":")]:
                _counts.pop(old, None)
        return True


def valid_messages(messages: object) -> bool:
    return (
        isinstance(messages, list)
        and 1 <= len(messages) <= 4
        and all(
            isinstance(item, dict)
            and item.get("role") in {"system", "user"}
            and isinstance(item.get("content"), str)
            and len(item["content"]) <= 20_000
            for item in messages
        )
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "nishad-gemma-gateway/1"

    def log_message(self, fmt: str, *args: object) -> None:
        # Never log paths, prompts, addresses, headers, or response bodies.
        print(json.dumps({"event": "request", "status": args[1] if len(args) > 1 else "unknown"}), flush=True)

    def send_json(self, status: int, body: dict, origin: str | None = None, retry_after: str | None = None) -> None:
        encoded = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        if retry_after:
            self.send_header("Retry-After", retry_after)
        self.end_headers()
        self.wfile.write(encoded)

    def allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin", "")
        return origin if origin in ALLOWED_ORIGINS else None

    def client_id(self) -> str:
        # nginx sets X-Real-IP and is the only network peer allowed to reach this service.
        return self.headers.get("X-Real-IP", "unknown")[:64]

    def do_OPTIONS(self) -> None:  # noqa: N802
        origin = self.allowed_origin()
        if not origin:
            self.send_json(403, {"error": "origin_not_allowed"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/healthz":
            self.send_json(404, {"error": "not_found"})
            return
        try:
            with urllib.request.urlopen(UPSTREAM.rsplit("/v1/", 1)[0] + "/health", timeout=3) as response:
                healthy = response.status == 200
        except Exception:
            healthy = False
        self.send_json(200 if healthy else 503, {"status": "ok" if healthy else "unavailable", "model": MODEL})

    def do_POST(self) -> None:  # noqa: N802
        origin = self.allowed_origin()
        if not origin:
            self.send_json(403, {"error": "origin_not_allowed"})
            return
        if self.path != "/":
            self.send_json(404, {"error": "not_found"}, origin)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"error": "payload_too_large"}, origin)
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "invalid_json"}, origin)
            return
        if not isinstance(body, dict) or not valid_messages(body.get("messages")):
            self.send_json(400, {"error": "invalid_messages"}, origin)
            return

        chat = body.get("mode") == "chat"
        prefix = "chat" if chat else "report"
        visitor = self.client_id()
        if not bump(f"{prefix}:ip:{visitor}", LIMITS[f"{prefix}_ip"]):
            self.send_json(429, {"error": "visitor_limit"}, origin, "86400")
            return
        if not bump(f"{prefix}:global", LIMITS[f"{prefix}_global"]):
            self.send_json(429, {"error": "global_limit"}, origin, "3600")
            return

        request_body = {
            "model": MODEL,
            "messages": body["messages"],
            "temperature": 0.75,
            "max_tokens": 256 if chat else 2600,
            "stream": chat,
        }
        if not chat:
            request_body["response_format"] = {"type": "json_object"}
        upstream_request = urllib.request.Request(
            UPSTREAM,
            data=json.dumps(request_body).encode(),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            upstream = urllib.request.urlopen(upstream_request, timeout=180)
        except urllib.error.HTTPError as error:
            self.send_json(502, {"error": "upstream_error", "status": error.code}, origin)
            return
        except Exception:
            self.send_json(502, {"error": "upstream_unreachable"}, origin)
            return

        if chat:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store, no-transform")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.end_headers()
            try:
                with upstream:
                    for raw in upstream:
                        line = raw.decode("utf-8", "replace").strip()
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            self.wfile.write(b'data: {"done":true}\n\n')
                            self.wfile.flush()
                            break
                        try:
                            event = json.loads(payload)
                            choice = (event.get("choices") or [{}])[0]
                            delta = (choice.get("delta") or {}).get("content")
                            finish = choice.get("finish_reason")
                        except (json.JSONDecodeError, AttributeError):
                            continue
                        if delta or finish:
                            safe = json.dumps({"delta": delta or "", "finish_reason": finish}, separators=(",", ":"))
                            self.wfile.write(("data: " + safe + "\n\n").encode())
                            self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        try:
            with upstream:
                result = json.load(upstream)
        except Exception:
            self.send_json(502, {"error": "upstream_unreadable"}, origin)
            return
        choice = (result.get("choices") or [{}])[0]
        self.send_json(200, {"content": (choice.get("message") or {}).get("content"), "finish_reason": choice.get("finish_reason")}, origin)


def main() -> None:
    address = os.getenv("LISTEN", "127.0.0.1:8090")
    host, port = address.rsplit(":", 1)
    ThreadingHTTPServer((host, int(port)), Handler).serve_forever()


if __name__ == "__main__":
    main()

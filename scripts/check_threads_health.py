#!/usr/bin/env python3
"""Publish a privacy-safe Threads API health snapshot."""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, parse, request

THREADS_API_BASE = "https://graph.threads.net/v1.0"
REQUEST_TIMEOUT_SECONDS = 30


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Snapshot JSON output path")
    return parser.parse_args()


def write_snapshot(path, status, latency_ms=None, detail=None):
    snapshot = {
        "schema": "nishad.threads-health.v1",
        "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": status,
        "latency_ms": latency_ms,
    }
    if detail:
        snapshot["detail"] = detail

    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.write_text(
        json.dumps(snapshot, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(output)


def check_threads(user_id, access_token):
    url = (
        f"{THREADS_API_BASE}/{parse.quote(user_id, safe='')}"
        f"?{parse.urlencode({'fields': 'id'})}"
    )
    api_request = request.Request(
        url,
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    started = time.monotonic()
    try:
        with request.urlopen(api_request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            response_data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        raise RuntimeError(f"api_http_{exc.code}") from exc
    except error.URLError as exc:
        raise RuntimeError("api_unreachable") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("api_invalid_json") from exc

    latency_ms = round((time.monotonic() - started) * 1000, 2)
    if not isinstance(response_data, dict) or str(response_data.get("id")) != user_id:
        raise RuntimeError("identity_mismatch")
    return latency_ms


def main():
    args = parse_args()
    user_id = os.getenv("THREADS_USER_ID", "").strip()
    access_token = os.getenv("THREADS_ACCESS_TOKEN", "").strip()
    if not user_id or not access_token:
        write_snapshot(args.output, "down", detail="configuration_missing")
        print("Threads health check failed: configuration_missing", file=sys.stderr)
        return 1

    try:
        latency_ms = check_threads(user_id, access_token)
    except RuntimeError as exc:
        write_snapshot(args.output, "down", detail=str(exc))
        print(f"Threads health check failed: {exc}", file=sys.stderr)
        return 1

    write_snapshot(args.output, "ok", latency_ms=latency_ms)
    print(f"Threads API healthy ({latency_ms} ms)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

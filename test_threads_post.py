#!/usr/bin/env python3
"""Create and publish a text post through the Threads API."""

import argparse
import json
import os
import sys
from urllib import error, parse, request

THREADS_API_BASE = "https://graph.threads.net/v1.0"
DEFAULT_POST_TEXT = "Hello World 👽"
REQUEST_TIMEOUT_SECONDS = 30


class ThreadsAPIError(RuntimeError):
    """Raised when the Threads API rejects or cannot process a request."""


def post_form(url, payload):
    encoded_payload = parse.urlencode(payload).encode("utf-8")
    api_request = request.Request(url, data=encoded_payload, method="POST")

    try:
        with request.urlopen(api_request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            response_body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        raise ThreadsAPIError(
            f"Threads API returned HTTP {exc.code}: {response_body}"
        ) from exc
    except error.URLError as exc:
        raise ThreadsAPIError(f"Could not reach the Threads API: {exc.reason}") from exc

    try:
        response_data = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise ThreadsAPIError("Threads API returned an invalid JSON response") from exc

    if not isinstance(response_data, dict):
        raise ThreadsAPIError("Threads API returned an unexpected response")

    return response_data


def publish_text_post(user_id, access_token, post_text):
    container_data = post_form(
        f"{THREADS_API_BASE}/{parse.quote(user_id, safe='')}/threads",
        {
            "media_type": "TEXT",
            "text": post_text,
            "access_token": access_token,
        },
    )
    creation_id = container_data.get("id")
    if not creation_id:
        raise ThreadsAPIError(
            f"Container creation failed: {json.dumps(container_data, sort_keys=True)}"
        )

    print(f"Container created: {creation_id}")

    publish_data = post_form(
        f"{THREADS_API_BASE}/{parse.quote(user_id, safe='')}/threads_publish",
        {
            "creation_id": creation_id,
            "access_token": access_token,
        },
    )
    post_id = publish_data.get("id")
    if not post_id:
        raise ThreadsAPIError(
            f"Post publication failed: {json.dumps(publish_data, sort_keys=True)}"
        )

    return post_id


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--text",
        default=DEFAULT_POST_TEXT,
        help="Text to publish (default: %(default)s)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate configuration and print the post without calling Threads",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    post_text = args.text.strip()
    if not post_text:
        print("Error: post text cannot be empty.", file=sys.stderr)
        return 2

    if args.dry_run:
        print(f"Dry run: would publish to Threads:\n{post_text}")
        return 0

    user_id = os.getenv("THREADS_USER_ID")
    access_token = os.getenv("THREADS_ACCESS_TOKEN")
    if not user_id or not access_token:
        print(
            "Error: THREADS_USER_ID and THREADS_ACCESS_TOKEN must both be set.",
            file=sys.stderr,
        )
        return 2

    print(f"Creating Threads text container for:\n{post_text}")
    try:
        post_id = publish_text_post(user_id, access_token, post_text)
    except ThreadsAPIError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Published to Threads. Post ID: {post_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

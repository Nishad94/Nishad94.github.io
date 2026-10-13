#!/usr/bin/env python3
"""Exchange a Threads OAuth code for a user access token."""

import argparse
import getpass
import json
import subprocess
import sys
from urllib import error, parse, request

TOKEN_URL = "https://graph.threads.net/oauth/access_token"
DEFAULT_REDIRECT_URI = "https://nishad.ai/threads-callback"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-id", required=True, help="Threads app ID")
    parser.add_argument(
        "--code",
        help="Temporary OAuth authorization code; prompted securely when omitted",
    )
    parser.add_argument(
        "--redirect-uri",
        default=DEFAULT_REDIRECT_URI,
        help="Exact allowlisted OAuth redirect URI (default: %(default)s)",
    )
    parser.add_argument(
        "--set-github-secrets",
        metavar="OWNER/REPO",
        help="Store the token and user ID with gh instead of printing them",
    )
    return parser.parse_args()


def exchange_code(app_id, app_secret, code, redirect_uri):
    payload = parse.urlencode(
        {
            "client_id": app_id,
            "client_secret": app_secret,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
            "code": code,
        }
    ).encode("utf-8")

    token_request = request.Request(TOKEN_URL, data=payload, method="POST")
    try:
        with request.urlopen(token_request, timeout=30) as response:
            response_body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Threads API returned HTTP {exc.code}: {response_body}"
        ) from exc
    except error.URLError as exc:
        raise RuntimeError(f"Could not reach the Threads API: {exc.reason}") from exc

    try:
        response_data = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Threads API returned invalid JSON") from exc

    access_token = response_data.get("access_token")
    user_id = response_data.get("user_id")
    if not access_token or not user_id:
        raise RuntimeError(
            f"Threads API returned an unexpected response: "
            f"{json.dumps(response_data, sort_keys=True)}"
        )

    return str(user_id), access_token


def set_github_secret(repo, name, value):
    try:
        subprocess.run(
            ["gh", "secret", "set", name, "--repo", repo],
            input=value,
            text=True,
            check=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("GitHub CLI (gh) is not installed") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Could not set GitHub secret {name}") from exc


def main():
    args = parse_args()
    app_secret = getpass.getpass("Threads app secret: ").strip()
    code = args.code or getpass.getpass("Authorization code: ").strip()

    if not app_secret or not code:
        print("Error: app secret and authorization code are required.", file=sys.stderr)
        return 2

    try:
        user_id, access_token = exchange_code(
            args.app_id.strip(),
            app_secret,
            code.strip(),
            args.redirect_uri,
        )
        if args.set_github_secrets:
            set_github_secret(
                args.set_github_secrets, "THREADS_ACCESS_TOKEN", access_token
            )
            set_github_secret(args.set_github_secrets, "THREADS_USER_ID", user_id)
            print(f"Configured Threads Actions secrets for {args.set_github_secrets}.")
        else:
            print(
                json.dumps(
                    {"access_token": access_token, "user_id": user_id},
                    indent=2,
                )
            )
            print("Warning: keep this output private.", file=sys.stderr)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/python3
"""Set the OAuth secret locally; never accept it as an argument or environment variable."""
import getpass
import json
import os
import pathlib
import subprocess
import tempfile

CONFIG = pathlib.Path("/etc/nishad-dashboard/report.json")


def main():
    if os.geteuid() != 0 or not os.isatty(0):
        raise SystemExit("Run with sudo from your own interactive terminal.")
    if not CONFIG.is_file():
        raise SystemExit("Dashboard configuration is not staged.")
    config = json.loads(CONFIG.read_text())
    secret = getpass.getpass("GitHub OAuth client secret (hidden): ")
    if len(secret) < 20 or len(secret) > 256 or any(c.isspace() for c in secret):
        raise SystemExit("Invalid secret format; nothing changed.")
    if secret != getpass.getpass("Confirm secret (hidden): "):
        raise SystemExit("Values differ; nothing changed.")
    config["clientSecret"] = secret
    fd, name = tempfile.mkstemp(prefix=".oauth-", dir=CONFIG.parent)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(config, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, CONFIG)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    result = subprocess.run(["systemctl", "restart", "nishad-metrics@report.service"], check=False)
    if result.returncode:
        raise SystemExit("Secret saved privately; service restart failed. Check sanitized service status.")
    print("Secret saved in root-only runtime storage; reporting service restarted.")


if __name__ == "__main__":
    main()

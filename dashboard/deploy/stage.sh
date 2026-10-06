#!/bin/bash
set -euo pipefail
umask 077
if [ "$#" -ne 4 ] || [ "$(id -u)" -ne 0 ]; then
  echo "Usage (root): stage.sh PRIVATE_DOMAIN COLLECTOR_DOMAIN OWNER_ID PUBLIC_CLIENT_ID" >&2
  exit 1
fi
src="$(cd "$(dirname "$0")/.." && pwd)"
for account in nishad-report nishad-collect; do
  if ! id "$account" >/dev/null 2>&1; then
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$account"
  fi
done
install -d -m 0755 /opt/nishad-dashboard/current /var/lib/nishad-acme
install -d -m 0700 /etc/nishad-dashboard
install -m 0755 "$src/dashboard" /opt/nishad-dashboard/current/dashboard.new
mv /opt/nishad-dashboard/current/dashboard.new /opt/nishad-dashboard/current/dashboard
install -m 0644 "$src/analytics-pages.json" /opt/nishad-dashboard/current/analytics-pages.json
install -m 0755 "$src/deploy/set-oauth.py" /usr/local/sbin/nishad-dashboard-set-oauth
install -m 0644 "$src/deploy/"*.service "$src/deploy/"*.timer /etc/systemd/system/
for account in nishad-report nishad-collect; do
  if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$account'" | grep -qx 1; then
    runuser -u postgres -- createuser --no-superuser --no-createdb --no-createrole "$account"
  fi
done
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='nishad_metrics'" | grep -qx 1; then
  runuser -u postgres -- createdb nishad_metrics
fi
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d nishad_metrics < "$src/schema.sql" >/dev/null
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d nishad_metrics < "$src/deploy/roles.sql" >/dev/null
python3 - "$@" <<'PY'
import json, os, pathlib, re, sys
domain, collector, owner, client = sys.argv[1:]
if not all(re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)+", d) for d in [domain, collector]):
    raise SystemExit("Invalid hostname")
if not owner.isdigit() or int(owner) < 1 or not client.isalnum():
    raise SystemExit("Invalid public identity settings")
configs = {
    "report": {"mode": "dashboard", "listen": "127.0.0.1:8090", "origin": "https://"+domain,
               "ownerId": int(owner), "clientId": client, "clientSecret": "",
               "databaseUrl": "postgres:///nishad_metrics?host=/var/run/postgresql&user=nishad-report"},
    "collect": {"mode": "collector", "listen": "127.0.0.1:8091",
                "origins": ["https://nishad.ai", "https://www.nishad.ai"], "dailyCap": 10000,
                "catalog": "/opt/nishad-dashboard/current/analytics-pages.json",
                "databaseUrl": "postgres:///nishad_metrics?host=/var/run/postgresql&user=nishad-collect"},
    "maintain": {"mode": "maintain",
                 "databaseUrl": "postgres:///nishad_metrics?host=/var/run/postgresql&user=nishad-collect"}
}
for name, value in configs.items():
    path = pathlib.Path("/etc/nishad-dashboard") / (name+".json")
    if not path.exists():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(value, f)
PY
systemctl daemon-reload
systemctl enable nishad-metrics@report.service nishad-metrics-maintain.timer >/dev/null
systemctl start nishad-metrics-maintain.timer
systemctl start nishad-metrics-maintain.service
echo "Staged. Collector remains disabled; OAuth secret must be set interactively."

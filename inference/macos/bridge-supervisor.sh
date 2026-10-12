#!/bin/zsh
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
BASE="$HOME/.local/share/nishad-ai"
LOG="$HOME/Library/Logs/nishad-ai-tunnel.log"
ERR="$HOME/Library/Logs/nishad-ai-tunnel.error.log"
while true; do
  : > "$LOG"
  "$HOME/.local/bin/cloudflared" tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:8094 >"$LOG" 2>"$ERR" &
  TUNNEL_PID=$!
  URL=""
  for _ in {1..90}; do
    URL=$(/usr/bin/grep -ahEo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" "$ERR" 2>/dev/null | /usr/bin/head -1 || true)
    [[ -n "$URL" ]] && break
    /bin/sleep 1
  done
  if [[ -n "$URL" ]]; then
    D=$(/usr/bin/mktemp -d /tmp/nishad-worker.XXXXXX)
    /bin/cp "$BASE/worker.js" "$D/worker.js"
    cat > "$D/wrangler.toml" <<EOF
name = "nishad-ai-proxy"
main = "worker.js"
compatibility_date = "2026-10-01"
[vars]
MAC_UPSTREAM = "$URL"
ALLOWED_ORIGIN = "https://nishad.ai"
EOF
    (cd "$D" && env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy /opt/homebrew/bin/npx --yes wrangler deploy) >>"$LOG" 2>>"$ERR"
    /bin/rm -rf "$D"
  fi
  wait "$TUNNEL_PID" || true
  /bin/sleep 5
done

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
    # Install the canonical Worker tree before enabling priority routing.
    # Preserve the laptop route and secrets; this bridge owns only MAC_UPSTREAM.
    if [[ -f "$BASE/inference/wrangler.toml" && -f "$BASE/inference/priority-worker.js" &&
          -f "$BASE/worker/ai-proxy.js" && -f "$BASE/assets/inference-metrics-contract.js" ]]; then
      if ! (cd "$BASE" && env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy /opt/homebrew/bin/npx --yes wrangler deploy \
        --config "$BASE/inference/wrangler.toml" --name nishad-ai-proxy --keep-vars --var "MAC_UPSTREAM:$URL") >>"$LOG" 2>>"$ERR"; then
        print -u2 'Worker route update failed; inspect the private tunnel log.'
      fi
    else
      print -u2 'Canonical priority Worker files are missing; no old Worker was redeployed.'
    fi
  fi
  wait "$TUNNEL_PID" || true
  /bin/sleep 5
done

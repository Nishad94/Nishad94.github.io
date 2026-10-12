# Mac-hosted terminal runtime

`gateway.py` serves loopback-only Ollama Gemma on `127.0.0.1:8094`. The gateway validates the exact `https://nishad.ai` origin, caps payloads/output/concurrency, suppresses hidden thinking, and translates Ollama NDJSON into browser SSE.

`bridge-supervisor.sh` starts a Cloudflare quick tunnel, extracts its ephemeral URL, and redeploys the stable `nishad-ai-proxy` Worker route after every tunnel restart. Install the two plist files in `~/Library/LaunchAgents`, install `cloudflared` at `~/.local/bin/cloudflared`, and keep Wrangler OAuth authenticated. The Worker forwards only requests from `https://nishad.ai`.

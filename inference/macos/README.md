# Mac-hosted terminal runtime

`gateway.py` serves loopback-only Ollama Gemma on `127.0.0.1:8094`. The gateway validates the exact `https://nishad.ai` origin, caps payloads/output/concurrency, suppresses hidden thinking, and translates Ollama NDJSON into browser SSE. It emits explicit sanitized completion/error events and records status, mode, duration and token counts without prompts or output.

## Warm model residency

Both chat and reports set Ollama `keep_alive: -1` for the configured `GEMMA_MODEL`.
This removes that model's idle-unload timer without pinning other models or
changing Ollama's global keep-alive, model-slot, or parallelism settings.

The gateway asynchronously checks residency at startup and every 60 seconds.
When the model is missing, has a different context size, or has a finite expiry
within a day, it sends an **empty** `/api/chat` load request with the same
4096-token context and indefinite keep-alive. It does not evaluate a prompt,
generate a report, use visitor quota, or cache a complete response. A resident
model is left alone. Maintenance uses the same nonblocking semaphore as visitor
requests: it skips a busy gateway; a visitor arriving during an actual reload
gets the existing explicit `busy` response, not a hidden queue. Failed checks or
loads log a sanitized `warmup` event and retry after 60 seconds.
If another local model is resident and Gemma is absent, maintenance defers
instead of repeatedly evicting that model. It resumes preloading once the
other model unloads; an explicit visitor request can still load Gemma normally.

Install the updated `gateway.py` in the existing private runtime directory,
then restart **only** `com.nishad.ai.gateway` after confirming no generation is
in flight. No Worker, tunnel, Pages, or Ollama-server restart is needed. Verify
`/api/ps` shows the configured model with context 4096 and a far-future expiry,
then check again after the previous idle timeout. Keep runtime paths/configuration
and diagnostic artifacts out of the Pages output.

Warmth is best-effort: sleep, restarts, memory pressure, or another model can
still evict Gemma. In particular, `OLLAMA_MAX_LOADED_MODELS=1` allows another
local model to replace it; the next maintenance check preloads it again.
Maintenance reloads Gemma once the other model unloads, rather than fighting it.
Do not increase shared model slots/parallelism or pin every model merely to
hide this limitation. Persistent residency consumes memory even when idle.

This eliminates loading, **not** prompt evaluation or text generation.
The measured Gemma 4 baseline was about 119 seconds cold and 79 seconds warm;
those outputs also missed the requested write-up length. These are not valid
full-report acceptance timings or a promise of a sub-10-second report/PDF.
The model, report prompt, required fields, completion validation, and output
budgets are unchanged.

To roll back, reinstall the previous gateway and restart its launch agent.
Once no request is running, `ollama stop gemma4:e2b` releases the pinned model;
later requests through the old gateway again use Ollama's normal idle timeout.

`bridge-supervisor.sh` starts a Cloudflare quick tunnel, extracts its ephemeral URL, and redeploys the stable `nishad-ai-proxy` Worker route after every tunnel restart. It deploys `~/.local/share/nishad-ai/worker.js`, so every Worker release must synchronize that installed file or a later tunnel restart will restore old code. Install the two plist files in `~/Library/LaunchAgents`, install `cloudflared` at `~/.local/bin/cloudflared`, and keep Wrangler OAuth authenticated. The Worker forwards only requests from `https://nishad.ai`.

# Mac llama.cpp and Python gateway bootstrap

The production Mac runtime serves Qwen3-4B through a loopback-only
`llama-server` on `127.0.0.1:8081` and the Python gateway on
`127.0.0.1:8094`. The gateway validates exact origins and bearer authentication,
caps payloads/output/concurrency, exposes a bounded FIFO queue, translates the
OpenAI-compatible llama.cpp stream into browser SSE, and publishes only
privacy-safe operational aggregates. It never records prompts or answers.

The browser never contacts llama.cpp directly. A Cloudflare tunnel exposes only
the authenticated gateway, and the stable Worker injects the private gateway
token. Runtime files, model weights, credentials and logs stay outside Git under
`~/.local/share/nishad-ai` and `~/Library/Logs`.

## Local manual bootstrap

This manual runbook runs the existing Python gateway against a local
`llama-server` without installing launch agents or publishing a tunnel. Runtime
downloads and model files stay outside the repository in
`~/.local/share/nishad-ai`. The example uses ports `8082` and `8095` so it can
run alongside the persistent ports (`8081` and `8094`); it never stops an
existing process.

Use a Mac with at least 8 GB RAM (16 GB or more is preferable), macOS, Homebrew,
and Python 3.10 or newer. The Qwen3-4B Q4_K_M model is about 2.5 GB. The gateway
uses only Python's standard library. On Apple Silicon, Homebrew's llama.cpp
build can use Metal; Intel Macs can use CPU inference.

Install the local tools and fetch the pinned model:

```sh
brew install llama.cpp python
command -v llama-server
python3 --version

RUNTIME="$HOME/.local/share/nishad-ai"
MODEL="$RUNTIME/models/Qwen3-4B-Q4_K_M.gguf"
mkdir -p "$RUNTIME/models"
curl -fL --retry 3 \
  'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf' \
  -o "$MODEL"
printf '%s  %s\n' \
  '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5' \
  "$MODEL" | shasum -a 256 -c -
curl -fL \
  'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/LICENSE' \
  -o "$RUNTIME/models/Qwen3-LICENSE"
```

The download is pinned to the Qwen repository revision and checked against the
published SHA-256 before use. Keep the model and license in the private runtime
directory, not in Git.

Start the model in one terminal. On Apple Silicon, use `-ngl 99` to offload
layers to Metal; on Intel Macs, change that option to `-ngl 0` for CPU inference.
The server binds only to loopback:

```sh
RUNTIME="$HOME/.local/share/nishad-ai"
llama-server \
  -m "$RUNTIME/models/Qwen3-4B-Q4_K_M.gguf" \
  --host 127.0.0.1 --port 8082 \
  -c 8192 -np 2 -t 6 -ngl 99 --jinja --cache-prompt --log-disable
```

Wait for `curl --fail http://127.0.0.1:8082/health` to report `{"status":"ok"}`.
If the model server exits or does not become healthy, stop here and inspect its
terminal output; do not start the gateway against a failed model server.

Start the gateway in a second terminal from the repository root:

```sh
INFERENCE_BACKEND='llama.cpp' \
LLAMA_BASE_URL='http://127.0.0.1:8082' \
LISTEN='127.0.0.1:8095' \
ALLOWED_ORIGINS='https://nishad.ai,http://127.0.0.1:8000' \
python3 -u inference/gateway.py
```

Check both loopback health endpoints:

```sh
curl --fail http://127.0.0.1:8082/health
curl --fail http://127.0.0.1:8095/healthz
```

For a local site preview, run `python3 tests/serve.py 8000` from the repository
root. In the page at `http://127.0.0.1:8000`, set
`localStorage.nishad_ai_proxy` to `http://127.0.0.1:8095/` and reload. Remove
that override after testing. Stop each manually started process with Ctrl-C.
The persistent gateway samples macOS CPU, memory, Apple GPU device utilization,
disk use and uptime every 15 seconds. A manual gateway run exposes the same
metrics after its first sample.

These commands provide a local, loopback-only runtime, not public hosting. Do
not bind either server to a network interface, install a launch agent, enable a
tunnel, change the live Worker, or deploy as part of this runbook. Those are
separate operational changes requiring explicit authorization.

## Persistent production bootstrap

Run this section locally on the authorized Mac. It installs current-user launch
agents; it does not require root, open an inbound firewall port, or bind either
service beyond loopback. The checked-in plist templates contain the owner's
current home path. If the checkout is used by a different macOS account, replace
that path in private installed copies before loading them.

Install prerequisites and authenticate Wrangler:

```sh
brew install llama.cpp python cloudflared
npx --yes wrangler login
npx --yes wrangler whoami
mkdir -p "$HOME/.local/bin"
ln -sf "$(brew --prefix)/bin/cloudflared" "$HOME/.local/bin/cloudflared"
```

Download and verify the model using the commands in
[Local manual bootstrap](#local-manual-bootstrap), but keep it at the persistent
path `~/.local/share/nishad-ai/models/Qwen3-4B-Q4_K_M.gguf`.

From the repository root, synchronize the private runtime tree:

```sh
BASE="$HOME/.local/share/nishad-ai"
mkdir -p "$BASE/inference" "$BASE/worker" "$BASE/assets"
cp inference/gateway.py inference/telemetry.py "$BASE/"
cp inference/priority-worker.js inference/wrangler.toml "$BASE/inference/"
cp worker/ai-proxy.js "$BASE/worker/"
cp assets/inference-metrics-contract.js "$BASE/assets/"
cp inference/macos/bridge-supervisor.sh "$BASE/bridge-supervisor.sh"
chmod 700 "$BASE/bridge-supervisor.sh"

cp inference/macos/com.nishad.ai.llama.plist \
  "$HOME/Library/LaunchAgents/com.nishad.ai.llama.plist"
cp inference/macos/com.nishad.ai.gateway.plist \
  "$HOME/Library/LaunchAgents/com.nishad.ai.gateway.plist"
cp inference/macos/com.nishad.ai.bridge.plist \
  "$HOME/Library/LaunchAgents/com.nishad.ai.bridge.plist"
```

Generate one gateway token, add it only to the installed gateway plist, and store
the same value as the production Worker secret. Do not echo it, write it into the
repository, or place it in browser configuration:

```sh
TOKEN="$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)"
TOKEN="$TOKEN" python3 - <<'PY'
import os, plistlib
path = os.path.expanduser('~/Library/LaunchAgents/com.nishad.ai.gateway.plist')
with open(path, 'rb') as handle:
    data = plistlib.load(handle)
data.setdefault('EnvironmentVariables', {})['GATEWAY_TOKEN'] = os.environ['TOKEN']
with open(path, 'wb') as handle:
    plistlib.dump(data, handle, sort_keys=False)
PY
printf '%s' "$TOKEN" | npx --yes wrangler secret put MAC_GATEWAY_TOKEN \
  --config "$BASE/inference/wrangler.toml" --name nishad-ai-proxy
unset TOKEN
```

Validate and load the services in dependency order:

```sh
plutil -lint "$HOME/Library/LaunchAgents/com.nishad.ai."{llama,gateway,bridge}".plist"
UID_NUMBER="$(id -u)"

for SERVICE in llama gateway bridge; do
  launchctl bootout "gui/$UID_NUMBER/com.nishad.ai.$SERVICE" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUMBER" \
    "$HOME/Library/LaunchAgents/com.nishad.ai.$SERVICE.plist"
  launchctl enable "gui/$UID_NUMBER/com.nishad.ai.$SERVICE"
done
```

The model can take several seconds to load. Verify local readiness without
printing the token:

```sh
curl --fail http://127.0.0.1:8081/health
TOKEN="$(python3 - <<'PY'
import os, plistlib
with open(os.path.expanduser('~/Library/LaunchAgents/com.nishad.ai.gateway.plist'), 'rb') as handle:
    print(plistlib.load(handle)['EnvironmentVariables']['GATEWAY_TOKEN'])
PY
)"
curl --fail -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8094/healthz
curl --fail -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8094/metrics
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8094/healthz)" = 401
unset TOKEN
```

`bridge-supervisor.sh` starts the quick tunnel, discovers its ephemeral HTTPS
origin, and deploys the canonical priority Worker with `--keep-vars`, changing
only `MAC_UPSTREAM`. Confirm the public adapter after the bridge log reports a
successful deployment:

```sh
curl --fail -H 'Origin: https://nishad.ai' \
  https://nishad-ai-proxy.nishad-dawkhar94.workers.dev/metrics
```

Then test one synthetic terminal request through `https://nishad.ai/#shell`.
The public `/metrics/` page reads the same Worker at `/metrics`; no token reaches
the page. A quick tunnel has no uptime guarantee. If its hostname stops resolving,
restart only `com.nishad.ai.bridge`; the supervisor creates a new tunnel and
updates `MAC_UPSTREAM`. Use a named Cloudflare Tunnel for durable production
availability.

Public-web enrichment is independent of the Mac tunnel. Its `EXA_API_KEY` lives
only as a Worker secret and is preserved by the bridge's `--keep-vars` deploy.
Do not add the key to the gateway plist or private Mac runtime files.

To update code later, recopy the changed private runtime files. Restart only the
affected launch agent after confirming no generation is active. Worker-only
changes can be deployed by restarting the bridge or running its Wrangler command
with the current private `MAC_UPSTREAM`.

## Legacy Ollama warm residency

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

The production server allocates three 4,096-token KV-cache slots from a
12,288-token context pool. Ontology source and passage routing use slot `0`;
final chat, structured reports and web synthesis use slot `1`; distilled-context
web-intent/query planning uses slot `2`. Model weights remain shared while each
prompt family retains its own prefix. Dynamic ontology evidence and the current
question are placed in the final user message of the web-intent prompt so its
system prefix stays stable. The Python gateway still admits only one active
generation, so this improves cache specialization without enabling parallel
model execution.

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

`bridge-supervisor.sh` starts a Cloudflare quick tunnel, extracts its ephemeral URL,
and redeploys the stable `nishad-ai-proxy` Worker route after every tunnel restart.
The updated supervisor requires the canonical `inference/priority-worker.js`,
`inference/wrangler.toml`, and `worker/ai-proxy.js` tree under the private runtime
directory. It deploys with `--keep-vars` and updates only `MAC_UPSTREAM` among
upstream bindings, preserving the laptop route and secret bindings.

**The previously installed supervisor deploys `~/.local/share/nishad-ai/worker.js`.**
Stop/replace it and synchronize all Worker files before enabling priority routing,
or a later tunnel restart will restore old code. The updated supervisor refuses
to redeploy the old file when the canonical tree is missing. Install the two plist
files in `~/Library/LaunchAgents`, install `cloudflared` at
`~/.local/bin/cloudflared`, and keep Wrangler OAuth authenticated. The Worker
forwards only requests from configured exact origins. See
[priority routing and cutover](../README.md); no live Mac changes are implied.

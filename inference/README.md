# Laptop inference and prioritized gateways

The Windows laptop can run a loopback-only `llama.cpp` server behind the existing
Python gateway. `INFERENCE_BACKEND=llama.cpp` selects that protocol; the default
remains `ollama`, including the Mac's existing model-residency behavior.

macOS has local and persistent launchd bootstrap instructions for the
loopback-only llama.cpp + Python gateway runtime in
[`macos/README.md`](macos/README.md). Production publication remains a separate,
explicitly authorized step.

The Windows laptop path is an opt-in experiment. Installing or starting it does
not change production, DNS, Windows startup, sleep settings, or the Mac.
Production continues using its current Worker until an explicitly authorized
cutover.

## Local Windows ARM64 runtime

Use PowerShell 7 on Windows ARM64. The initial CPU baseline uses six threads,
4096 tokens of context, one model slot, and Qwen3-4B Q4_K_M with thinking disabled.
GPU/NPU drivers, test signing, and global environment changes are not required.
Model/runtime downloads and operational logs belong outside this repository,
under `%LOCALAPPDATA%\nishad-ai` by default:

```text
nishad-ai\
  python\python.exe
  node-v22.23.3-win-arm64\node.exe
  llama-b11699\llama-server.exe  (and its adjacent release DLLs)
  models\Qwen3-4B-Q4_K_M.gguf
  cloudflared.exe
  logs\
```

Verified initial downloads:

| Component | Official download | SHA-256 |
| --- | --- | --- |
| Node 22.23.3 | [Windows ARM64 zip](https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-arm64.zip) | `33dad22e4cef5ee8f9fbb1b0d037fdacd0e56d12a4580f0d63f68b894deab535` |
| Python 3.13.9 | [Windows ARM64 embeddable zip](https://www.python.org/ftp/python/3.13.9/python-3.13.9-embed-arm64.zip) | Obtain from python.org over HTTPS. |
| llama.cpp b11699 | [Windows CPU ARM64 zip](https://github.com/ggml-org/llama.cpp/releases/download/b11699/llama-b11699-bin-win-cpu-arm64.zip) | `2d36bdc1602e63927316a4ecf64a957d43ea42f5e8c1576db250ecdb30ada202` |
| Qwen3-4B Q4_K_M | [Pinned official model](https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf) | `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5` |
| cloudflared 2026.10.1 | [Windows AMD64 executable](https://github.com/cloudflare/cloudflared/releases/download/2026.10.1/cloudflared-windows-amd64.exe) | `4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6` |

The model download is approximately 2.5 GB and is Apache-2.0 licensed; retain its
[license](https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/bc640142c66e1fdd12af0bd68f40445458f3869b/LICENSE)
with the local model. Cloudflared's Windows AMD64 binary runs under Windows ARM
emulation; the model and Python runtimes are native ARM64.

From the repository root:

```powershell
& .\inference\windows\Start-Inference.ps1
```

The script checks for occupied ports without stopping existing services, waits
for readiness, and runs until interrupted. If either owned process exits, it
stops the other and reports failure. It does not install automatic startup or
silently restart failed generations. Logs contain gateway status/timings, not
prompts or answers; llama.cpp logging is disabled.

The gateway listens on `127.0.0.1:8094`; the model listens on `127.0.0.1:8081`.
Only the gateway may be tunneled. Never expose the model server directly.

### Bounded request queue

The gateway admits **one active generation plus up to 10 waiting requests** by
default. Waiting requests are served FIFO; a new arrival cannot bypass them.
Further requests receive **HTTP 429**, `{"error":"queue_full"}`, and
`Retry-After: 15` without calling the model. Existing per-visitor/daily quotas
still apply independently. Warm-up never enters or jumps ahead of the queue.

Queued requests receive SSE headers and a `{"queued":true}` event immediately,
then comment heartbeats while waiting. This prevents the Worker's response-header
deadline from triggering duplicate inference. A wait expires after 60 seconds
with an explicit `queue_timeout` SSE error and no generation. Disconnected
clients are removed before their queued work starts. The queue is in memory:
restarts discard waiting work; clients must retry manually. The browser's
120-second deadline includes both waiting and generation time, leaving room for
the full 60-second queue wait.

Queue-full HTTP 429 responses are not retried on the Mac or browser model; the
terminal displays rate limiting. Once a request is admitted, routing also stays
on that backend. Ten waiting places are a burst limit, not a guarantee that all
ten finish before their deadlines. Active model concurrency remains unchanged.

To keep the launch files independent of a temporary worktree, copy
`inference\gateway.py`, `inference\windows\Start-Inference.ps1`, and
`inference\windows\Start-Tunnel.ps1` into a private runtime `app\` directory,
preserving their relative paths. Run the copied start script there. Recopy these
files whenever their source changes.

### Automatic sign-in recovery

The project-owned recovery entry point can be installed without administrator
privileges in PowerShell 7:

```powershell
.\inference\windows\Install-Recovery.ps1 -StartNow
Get-ScheduledTask -TaskName 'Nishad Local Inference'
```

Stop any manually started launcher first. The task runs as the current user at
sign-in, with no stored password or elevation. It starts
`inference\windows\Watch-Inference.ps1` directly from the checkout. The supervisor
restarts the model/gateway pair 15 seconds after a process failure; Task Scheduler
requests supervisor restart after one minute on failure. An additional repeating
one-minute trigger recovers even when Windows does not classify a forced exit as
a restartable failure; `IgnoreNew` prevents duplicate running instances. A Windows job
object stops its owned model/gateway children even if the supervisor is forcibly
terminated, so recovery cannot be blocked by its orphaned listeners. Only one
scheduled instance and one supervisor per user session are allowed. A conflicting
listener is reported in the bounded private `logs\recovery.log`; unrelated
processes are never killed. Model and gateway logs remain private runtime files.

The Scheduled Task references this checkout, not a copied script. Before moving
or removing a worktree, stop the task and register it again from a retained
checkout. To stop recovery intentionally, first use
`Disable-ScheduledTask -TaskName 'Nishad Local Inference'`, then
`Stop-ScheduledTask -TaskName 'Nishad Local Inference'`. Otherwise the repeating
trigger will restart it. The job object also stops the owned listeners. Use
`Enable-ScheduledTask` followed by `Start-ScheduledTask` to resume.

This is **sign-in recovery**, not a Windows system service: it does not run before
sign-in or while signed out, change power settings, wake a sleeping laptop, or
open a public tunnel. Existing runtime downloads remain outside the repository.

### Local benchmark and browser trial

```powershell
$runtime = Join-Path $env:LOCALAPPDATA 'nishad-ai'
$env:PATH = (Join-Path $runtime 'node-v22.23.3-win-arm64') + ';' + $env:PATH
$env:PYTHON = Join-Path $runtime 'python\python.exe'
node .\scripts\benchmark-inference.mjs
node .\scripts\test-local-inference.mjs
npm run test:syntax
npm test
```

On the Mac two-slot runtime, benchmark cache specialization from the repository
root with the private gateway token in the process environment:

```sh
GATEWAY_TOKEN='...' npm run benchmark:kv-slots
```

The harness is loopback-only. For each of ten routing/answer scenarios it first
replaces both slot caches with unrelated prompts, then runs the exact routing
and grounded-answer prompts three times. It reports the first run versus the
median of runs two and three for time to first token and total response latency.
Routing scenarios that require passage selection include both routing passes.
The token is never printed or written to the result.

The benchmark sends synthetic/public-ontology prompts to loopback only,
including employer order, job/education dates and undocumented employment gaps,
requires explicit `stop` completion and factual answer checks, and prints timings
without recording prompts or answers. A short pause separates generations so the
previous request can release its slot; it does not retry failed requests.
These are smoke checks, not a general accuracy or uptime guarantee.

`test-local-inference.mjs` additionally exercises the real model HTTP endpoint,
gateway streaming, denied origins, and a 12-request concurrent synthetic burst.
Run it only against an idle local instance with the default one generation slot;
it consumes 13 gateway quota entries and may keep the CPU busy for about
70 seconds. It requires exactly one overflow 429 and 10 admitted waiting
requests; each accepted request must either complete or explicitly expire from
the queue. Expiration during this deliberate long-answer burst is expected,
not a successful answer. The listener backlog is 64 connections so the gateway
can return HTTP 429 instead of refusing burst TCP connections.

For a local browser preview, start the gateway with
`-AllowedOrigins 'https://nishad.ai,http://127.0.0.1:8000'`, build/serve the site,
and set `localStorage.nishad_ai_proxy` to `http://127.0.0.1:8094/` on that local
page before reloading. Remove that override after testing. The override is
deliberately disabled on non-loopback pages.

## Priority Worker

`inference\priority-worker.js` reuses the existing tested Worker response adapter
in `worker\ai-proxy.js`; that rollback artifact is not replaced.

| Setting | Purpose |
| --- | --- |
| `LAPTOP_UPSTREAM` | Optional HTTPS origin for the laptop gateway tunnel. |
| `MAC_UPSTREAM` | Optional HTTPS origin for the existing Mac gateway tunnel. |
| `LAPTOP_GATEWAY_TOKEN` | Worker secret matching the laptop's `GATEWAY_TOKEN`. |
| `MAC_GATEWAY_TOKEN` | Optional equivalent secret after enabling authentication on the Mac. |
| `EXA_API_KEY` | Optional Worker secret enabling the bounded `/search` endpoint when the public site flag is also enabled. |
| `SITE_ACTIVITY` | Analytics Engine binding for consented public page-view events. |
| `CLOUDFLARE_ACCOUNT_ID` | Remote Worker variable used only to query the activity dataset; keep the real account ID out of Git. |
| `ANALYTICS_API_TOKEN` | Worker secret with Account Analytics Read permission. |
| `LAPTOP_REPORTS` | Only the exact value `true` enables laptop reports. Default: Mac-only reports. |
| `ALLOWED_ORIGIN` | Exact allowed website origins, comma-separated. |

Upstreams must be HTTPS origins without credentials, paths, queries, or fragments.
Addresses and tokens stay out of committed configuration. Do not forward visitor
API keys, cookies, or Authorization headers to gateways.

For chat, the Worker checks the laptop first, then the Mac. With no Mac configured,
it can serve laptop-only chat. Reports remain unavailable without the Mac unless
`LAPTOP_REPORTS=true` is deliberately enabled after separate report acceptance.
Spotify policy prerequisites still apply; use synthetic fixtures, not real
Spotify metadata, for infrastructure testing.

For `/metrics`, the Worker reads the first configured authenticated gateway,
preferring the laptop and otherwise using the Mac. It reconstructs the public
schema field by field and never forwards prompts, answers, identities, addresses,
credentials or arbitrary upstream fields.

`/search` accepts one 3–300 character query from an approved browser origin,
applies best-effort per-visitor and global daily quotas, and calls Exa Lite for
at most five moderated results with cached highlights. It returns a
provider-neutral schema containing only validated HTTPS URLs, bounded titles,
bounded snippets and optional publication dates. It never exposes the Exa key,
fetches result URLs, forwards cookies, or permits arbitrary URL proxying.

`POST /activity/view` accepts only an approved public page identifier and the
site's random daily browser identifier after explicit analytics consent. It
writes one data point to Analytics Engine and stores no IP address, user agent,
referrer, query or fragment. `GET /activity` queries only daily aggregate views
and daily browser counts, caches the result for five minutes, and never returns
raw events or identifiers. Analytics Engine retains data for up to three months.

Configure the read-only query credential and account variable outside Git:

```sh
printf '%s' "$ANALYTICS_API_TOKEN" | npx --yes wrangler secret put ANALYTICS_API_TOKEN \
  --config inference/wrangler.toml --name nishad-ai-proxy
npx --yes wrangler deploy --config inference/wrangler.toml \
  --name nishad-ai-proxy --keep-vars --var "CLOUDFLARE_ACCOUNT_ID:$CLOUDFLARE_ACCOUNT_ID"
```

Configure the secret without printing it:

```sh
printf '%s' "$EXA_API_KEY" | npx --yes wrangler secret put EXA_API_KEY \
  --config inference/wrangler.toml --name nishad-ai-proxy
```

Then set `WEB_SEARCH_ENABLED=true` in `deployment.js` and deploy Pages. Keep the
flag false until the secret exists; local ontology answers and browser fallback
continue to work normally while search is disabled.

Readiness checks use `/healthz`, never sample prompts, and have a five-second
deadline so a newly established quick tunnel can complete its first connection.
A failed check skips that backend for 30 seconds. An explicit `busy`
rejection allows failover and a 3-second cooldown. Both cooldowns are best-effort,
per Worker isolate, not globally shared state or durable availability promises.

After a POST, only an explicit pre-generation `busy`/`upstream_unreachable` 503
rejection is retried. An ambiguous POST failure, 30-second response-header
timeout, quota/auth/input error, or a broken stream is not retried on another
backend. The longer header window accommodates structured-routing prompt
evaluation on local llama.cpp before its first streamed event. Queue-full 429
responses are not retried, and accepted queued requests stay on the chosen
backend. A slow first token does not trigger a race: the gateway sends response
headers before forwarding generated tokens. Chat output is never concatenated
across backends; the UI labels interrupted output and asks for manual retry.
Reports retain the existing buffered, completion-checked JSON contract.

If all gateways fail, terminal chat retains browser-local fallback. Reports have
no browser-model fallback. Explicit OpenAI BYOK remains a deliberate override.
Gateway quotas remain per machine; adding machines does not create a shared
global quota. This free self-hosted experiment has no shared paid-provider key.

## Publishing and cutover (separate authorization required)

1. Set a strong random `GATEWAY_TOKEN` in the private laptop process environment,
   restart the gateway, and verify unauthenticated health/generation requests are
   rejected. Store the matching value as a Worker secret, never in frontend code.
2. Only after approval, run `Start-Tunnel.ps1 -Publish` in that same environment.
   It verifies gateway authentication before opening a public quick tunnel.
   Quick tunnel addresses change after restarts. Initially update
   `LAPTOP_UPSTREAM` manually; for durable operation configure a named tunnel.
   No GoDaddy record is needed for a `trycloudflare.com` address.
3. Deploy to the distinct preview Worker name in `inference\wrangler.toml`, with
   private remote bindings and `--keep-vars`. Test laptop-ready, laptop-offline,
   laptop-busy, cancellation, and stream-interruption cases using synthetic data.
   Do not enable laptop reports merely to conceal missing Mac configuration.
4. Before any production cutover, stop the Mac's old bridge supervisor. It deploys
   an old single-upstream Worker and would overwrite the new router.
   Install the canonical source tree under its private runtime, preserving
   `inference\priority-worker.js`, `inference\wrangler.toml`, and
   `worker\ai-proxy.js`. Install the updated bridge supervisor too. Its deploy
   uses `--keep-vars` and changes only `MAC_UPSTREAM` among upstream bindings.
   Keep every installed copy synchronized with later Worker releases.
5. Only after approval, deploy the priority Worker to the existing production
   name. The site's public endpoint stays the same. Install Windows startup,
   supervision/restart policy, and plugged-in sleep settings separately if wanted.

If Mac access is deferred, leave the production Worker and Mac supervisor alone.
The laptop-only local experiment does not depend on either.

Rollback: restore the previous Worker source/configuration and the old Mac
supervisor together, then remove the laptop binding. Do not delete credentials
or stop unrelated processes. To stop the local runtime, interrupt its launcher;
it stops only the model/gateway processes it created.

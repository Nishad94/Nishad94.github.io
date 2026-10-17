# Inference hosting memory

## Purpose and boundaries

This project can host Qwen locally on a Windows 11 laptop, independently of the
static GitHub Pages site. The reproducible bootstrap currently supports **Windows
ARM64 and x64**, with CPU inference. It does not claim macOS/Linux installation,
GPU/NPU acceleration, or an unattended service before Windows sign-in.

Never contact the Mac to bootstrap or collect metrics: it may be switched off.
Never copy machine credentials, private configuration, operational logs, IP
addresses, prompts, or generated answers into this repository.

## One-command local bootstrap

Prerequisites: a retained clone/checkout of this project, PowerShell 7.2 or newer,
internet access for missing artifacts, and sufficient memory/free disk for a
roughly 2.5 GB model plus runtimes/downloads. Use a machine with at least 8 GB RAM;
16 GB or more is preferable. No administrator access, Docker, global Python
installation, driver changes, inbound firewall rule, or router port forwarding is
required.

From the project root in PowerShell 7:

```powershell
.\inference\windows\Bootstrap-Inference.ps1
```

The script checks both live HTTP endpoints and listener ownership first. When
the setup is healthy and managed by this checkout's Scheduled Task it returns
without downloads, restarts, or setting changes. Otherwise it installs missing,
version-pinned, SHA-256-verified Python, llama.cpp, Node, and Qwen artifacts into
`%LOCALAPPDATA%\nishad-ai`, registers sign-in recovery, starts inference, and
requires healthy APIs before reporting success.

It does not stop unrelated processes, overwrite another application's ports,
replace another checkout's recovery task, automatically enable public exposure,
or invent a healthy fallback. A manual/foreign listener produces actionable
failure instead of being killed.

Diagnostic and dry-run modes:

```powershell
.\inference\windows\Bootstrap-Inference.ps1 -CheckOnly
.\inference\windows\Bootstrap-Inference.ps1 -WhatIf
```

`-CheckOnly` returns `Ready`, `ModelReady`, `GatewayReady`, and recovery state
without downloading/installing anything. `-WhatIf` checks current state and
shows the intended bootstrap action without applying it.

## What runs

```text
Local client / browser
  -> Python gateway       http://127.0.0.1:8094
  -> llama-server.exe     http://127.0.0.1:8081
  -> Qwen3-4B Q4_K_M      native ARM64/x64 CPU inference
```

The native browser chat UI is `http://127.0.0.1:8081/`. It bypasses gateway
authentication, queueing, limits, metrics, and the site's system prompt. It
shares the same model slot, so do not use it during gateway load tests.

The gateway is a separate Python process, not C++ embedded in Python. Its
default model server uses six CPU threads, 4096 context tokens, one generation
slot, and thinking disabled.

Queue contract: **one active request plus 10 FIFO waiting requests**, a
**60-second queue wait**, and HTTP 429 `queue_full` with `Retry-After: 15` on
overflow. Retry-After is not the queue wait limit. Accepted queued requests
receive SSE headers immediately; clients have a 120-second total chat deadline.
Disconnected/expired queued work must never begin generation.

## Recovery and project location

`Nishad Local Inference` is the current-user Scheduled Task. It launches the
project's `inference\windows\Watch-Inference.ps1` at sign-in. A one-minute
repeating trigger recovers an exited supervisor; running instances are not
duplicated. The supervisor retries failed runtime processes after 15 seconds.
A Windows job object stops owned child processes after supervisor termination.

The task points to **this checkout**, not a hidden copy. Keep the checkout on
disk. Before moving/removing it, disable and stop the task, then run bootstrap
or `Install-Recovery.ps1 -StartNow` from the retained replacement checkout.

```powershell
Get-ScheduledTask -TaskName 'Nishad Local Inference'
Disable-ScheduledTask -TaskName 'Nishad Local Inference'
Stop-ScheduledTask -TaskName 'Nishad Local Inference'
# Resume:
Enable-ScheduledTask -TaskName 'Nishad Local Inference'
Start-ScheduledTask -TaskName 'Nishad Local Inference'
```

Recovery does not wake a sleeping laptop, prevent sleep, bypass Windows sign-in,
or make the API available while powered off.

## Runtime files and local checks

### Test the entire website locally

After local inference is healthy, run from the retained checkout:

```powershell
$runtime = Join-Path $env:LOCALAPPDATA 'nishad-ai'
$arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$env:PATH = (Join-Path $runtime "node-v22.23.3-win-$arch") + ';' + $env:PATH
npm run preview:inference
```

Open `http://127.0.0.1:8000/`, `http://127.0.0.1:8000/#shell`, and
`http://127.0.0.1:8000/metrics/`. The preview server overrides the served
`deployment.js` response only; public deployment configuration is not changed.
Its loopback-only proxy sends chat and metrics to the local gateway and keeps
the gateway token server-side. Analytics, ads, and private dashboard integration
are disabled for this preview. Never expose this development server publicly.

Public hosting is currently deferred to another machine. Keep
`PublishEnabled=false` on this laptop; local testing does not need Cloudflare.
Follow organization policy and obtain approval before installing or publishing
any networking tools on a managed device. Do not bypass an IT block.

Runtime files, model weights and bounded recovery logs live under
`%LOCALAPPDATA%\nishad-ai`. Source-of-truth scripts and gateway code live in
`inference\`; do not edit generated `_site` files or silently run stale copies.

```powershell
$runtime = Join-Path $env:LOCALAPPDATA 'nishad-ai'
$arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$env:PATH = (Join-Path $runtime "node-v22.23.3-win-$arch") + ';' + $env:PATH
$env:PYTHON = Join-Path $runtime 'python\python.exe'
node .\scripts\benchmark-inference.mjs
node .\scripts\test-local-inference.mjs
npm ci
npm run test:syntax
npm test
```

Install project dependencies only when missing or after a manifest change.
The burst test deliberately sends 12 synthetic requests; expect one HTTP 429
and ten queued requests. Some queued requests may expire during long outputs.
Do not run it while visitors or another local UI are using the model.
If private gateway authentication is enabled, set `GATEWAY_TOKEN` for the test
process from the private settings without printing it. No public inference
requests, Spotify data, or paid-provider keys are needed for local checks.

## Optional public integration

Local bootstrap is not permission to publish. With separate owner authorization,
install the optional CLI/tunnel binaries using
`Bootstrap-Inference.ps1 -IncludeCloudflareTools` on a not-yet-managed setup,
then authorize Wrangler locally. Windows ARM64 uses an isolated x64 Node CLI
runtime for Wrangler/workerd compatibility; the model remains native ARM64.

The approved architecture uses a **separate laptop Cloudflare Worker** for
terminal chat and public metrics. Do not redeploy the Mac's Worker or use the Mac
as a relay. `deployment.js` contains approved public chat/metrics URLs only.
The browser must never receive the private tunnel address or gateway token.

Owner-generated `private-settings.json` in the private runtime directory holds
`GatewayToken`, `PublishEnabled`, and the separate `WorkerName`. The supervisor
loads it; `Start-Tunnel.ps1` refuses to publish an unauthenticated gateway.
After each quick-tunnel restart it updates only that Worker's `LAPTOP_UPSTREAM`
secret. Configure `LAPTOP_GATEWAY_TOKEN` to match the private gateway token.
Authenticate again on a new machine; never copy OAuth credentials into Git.

`/metrics/` uses only privacy-safe laptop operational aggregates. Missing
GPU/automation/database telemetry is **unavailable**, not zero and not old Mac
data. Direct model UI calls are not counted as gateway inference requests.
Gateway counters/history reset on restart and are not durable analytics storage.

Read `inference\README.md` for detailed routing, report policy, publication,
rollback and runtime constraints. Publishing the static site is a separate
GitHub Pages release; installing the model is not a deployment.

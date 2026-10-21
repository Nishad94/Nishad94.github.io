---
{
  "title": "Running nishad.ai on a MacBook: llama.cpp, a Python Gateway, and a Browser Fallback",
  "date": "2026-10-17",
  "description": "How nishad.ai moved its default AI path to a Mac-hosted Qwen model using llama.cpp, an authenticated Python streaming gateway, Cloudflare routing, launchd recovery, privacy-safe inference metrics, and a WebGPU fallback.",
  "tags": ["AI", "llama.cpp", "Mac", "Qwen", "MLOps", "WebGPU", "system design"],
  "draft": false
}
---

The AI terminal on [nishad.ai](https://nishad.ai/#shell) now runs its default model on a MacBook.

That sentence sounds simpler than the system behind it. A model file does not become a reliable website feature merely because `llama-server` can answer a local `curl`. The useful engineering work lives around inference: process recovery, request admission, authentication, stream translation, timeouts, observability, public routing, and a fallback for the moment the Mac is asleep or the tunnel disappears.

The current path is:

```text
Browser
  → Cloudflare Worker
  → authenticated HTTPS tunnel
  → loopback-only Python gateway
  → loopback-only llama.cpp
  → Qwen3-4B Q4_K_M
```

If that path is unavailable, a much smaller model can run inside a compatible visitor browser through WebLLM and WebGPU.

This article explains the design as an implementable system rather than a “look, local AI!” demo. It intentionally omits credentials, private tunnel addresses, machine identifiers, and operational logs.

![A neon system diagram showing the nishad.ai browser reaching a Cloudflare Worker, authenticated tunnel, Python gateway, llama.cpp, and Qwen model on a MacBook, with a WebGPU fallback inside the browser.](/assets/blog/mac-local-inference-stack.svg)

*The model is local. The engineering problem is still distributed.*

## Why a MacBook?

The project needed a default model path with four properties:

1. Visitors should not need an API key.
2. Prompts should not be sent to a shared paid-provider account.
3. The static GitHub Pages site should remain buildless at runtime.
4. Failure should be explicit and recoverable.

An Apple Silicon Mac is a useful personal-inference host because unified memory and Metal make quantized models practical without a discrete GPU. It is not a data center, and the design does not pretend otherwise. The machine can sleep. Home internet can fail. A quick tunnel can receive a new hostname. Thermal pressure and another local model can affect latency.

Those constraints led to a narrow architecture: two cache-specialized model
slots, one active generation, a bounded queue, short outputs, loopback listeners,
and multiple explicit failure states.

The selected baseline is **Qwen3-4B Q4_K_M** in GGUF format. The quantized model is approximately 2.5 GB—small enough for a personal host, but capable enough for short grounded answers and semantic source routing.

## llama.cpp is the execution engine

The GGUF file contains learned weights. It does not provide an HTTP server, tokenizer lifecycle, context allocation, sampling loop, health endpoint, or streaming protocol.

`llama.cpp` supplies those pieces. The Mac launch agent starts `llama-server` with:

- a 4,096-token context;
- two 4,096-token server slots backed by an 8,192-token context pool;
- six inference and batch threads;
- Jinja chat-template support;
- Metal layer offload on Apple Silicon;
- a loopback-only listener;
- disabled model-server logs.

Conceptually:

```sh
llama-server \
  -m Qwen3-4B-Q4_K_M.gguf \
  --host 127.0.0.1 --port 8081 \
  -c 4096 -np 1 -t 6 -tb 6 \
  -ngl 99 --jinja --log-disable
```

The exact model revision and SHA-256 are pinned in the repository runbook. We verify the complete download before the service is allowed to start. A partial or mismatched model is an installation failure, not an excuse to start a different model silently.

The native server exposes an OpenAI-compatible chat endpoint. That is useful, but it is deliberately not the public API.

### Separate KV-cache slots for routing and answers

Each terminal question normally makes two Qwen calls: a constrained semantic
routing request followed by the final grounded answer. Running both through one
slot caused the routing prompt to replace the answer prompt's reusable KV state,
and the answer then replaced the routing state.

The server now starts with:

```text
-c 8192
-np 2
--cache-prompt
```

The gateway adds llama.cpp's `id_slot` extension:

```python
payload["id_slot"] = 0 if is_route else 1
```

Slot `0` retains the stable routing rules and source catalog. Slot `1` retains
the stable response policy and ontology prefix used by chat and reports. The
gateway still admits only one active generation, so the extra slot improves
prompt-prefix reuse without enabling simultaneous model execution.

On this 16 GB Mac, the one-slot server measured about 2.2 GiB physical footprint
and 2.64 GiB RSS. The warmed two-slot server measured about 3.52 GiB RSS: roughly
0.9 GiB additional memory. The model weights remain loaded once; the increase is
primarily the doubled context/KV capacity.

## Why put Python in front of llama.cpp?

The Python gateway is the policy boundary.

`llama-server` is optimized for inference. The gateway is optimized for the rules of this website:

- accept only known browser origins;
- require a private bearer token for tunneled traffic;
- reject oversized or malformed bodies;
- allow only bounded `system` and `user` messages;
- apply per-visitor and global request limits;
- translate upstream events into the site’s small SSE contract;
- require genuine completion instead of inventing success after EOF;
- expose sanitized health and operational metrics;
- prevent prompts and answers from entering logs.

The gateway also normalizes two model backends. The older Mac path used Ollama; the new path uses the OpenAI-compatible llama.cpp protocol. The browser contract stays stable while the local execution engine changes.

### Streaming is a contract, not a visual effect

The browser expects events shaped roughly like:

```text
data: {"delta":"At Twitter, "}

data: {"delta":"Nishad built…"}

data: {"done":true,"finish_reason":"stop"}
```

The final event matters. A TCP stream ending after plausible-looking text is not proof that the model completed successfully. The gateway accepts only known finish reasons, limits total upstream event bytes, rejects malformed events, and emits a sanitized error if the stream is interrupted.

Structured reports are stricter. They must finish with valid JSON and a genuine `stop` completion. Partial JSON never becomes a success-shaped response.

## One active generation, ten waiting requests

Local inference has a physical concurrency limit. Pretending otherwise creates worse latency, memory pressure, and ambiguous failures.

The gateway therefore admits:

- **one active generation**;
- **ten FIFO waiting requests**;
- **a 60-second maximum queue wait**.

An eleventh waiter receives HTTP `429` with `queue_full` and `Retry-After: 15`. That value is retry guidance, not the queue timeout.

Accepted waiters receive SSE headers immediately, a `queued` event, and periodic comment heartbeats. This detail prevents the edge Worker from deciding that a request never received a response and racing it against another backend. If a waiting browser disconnects, its ticket is removed before it reaches the model.

Queueing is intentionally in memory. Restarting the gateway discards waiting requests. A personal inference host does not need a durable job broker for interactive chat.

## The edge Worker never exposes the gateway token

The public website knows one stable Worker URL. It does not know:

- the current tunnel address;
- the gateway bearer token;
- a private model address;
- a Mac username or filesystem path.

The Worker stores `MAC_GATEWAY_TOKEN` as a secret and `MAC_UPSTREAM` as a private variable. Before forwarding a generation, it checks `/healthz`. It then injects the private bearer token and preserves the browser’s SSE response.

Only an explicit pre-generation `busy` or `upstream_unreachable` rejection can move to another configured host. An ambiguous POST failure is never retried against another model because the first host might already be generating. Concatenating two backends into one answer would be both expensive and incorrect.

The current public link uses a Cloudflare quick tunnel. A supervisor watches that process, extracts each new ephemeral hostname, and redeploys only the Worker’s `MAC_UPSTREAM` binding with `--keep-vars`. Secrets and unrelated bindings survive.

Quick tunnels have no uptime guarantee. A named tunnel is the correct durability upgrade. Until then, DNS failure is a first-class outage mode, and restarting only the bridge rotates the route without restarting the model or gateway.

## launchd recovery without opening the Mac

Three current-user launch agents make the stack persistent:

| Agent | Responsibility |
|---|---|
| `com.nishad.ai.llama` | Load Qwen and keep `llama-server` running on loopback. |
| `com.nishad.ai.gateway` | Run the authenticated Python gateway against llama.cpp. |
| `com.nishad.ai.bridge` | Maintain the tunnel and refresh the Worker’s private upstream. |

They start in dependency order during installation, but each is independently restartable. Updating routing code does not require reloading the model. Updating the gateway does not require redeploying GitHub Pages. Rotating a failed tunnel does not require touching either inference process.

The checked-in launch-agent templates contain no secret. Bootstrap generates a random token, inserts it only into the installed private plist, and sends the same value directly to the Worker secret store.

The complete command sequence—including model checksum verification, private runtime copies, token setup, `launchctl` commands, and health checks—lives in [`inference/macos/README.md`](https://github.com/Nishad94/Nishad94.github.io/blob/master/inference/macos/README.md).

## Semantic routing needed a longer first-token window

The terminal does not inject every blog post into every prompt. A small structured routing request selects the minimum useful public source, such as career evidence or one article.

That request has a large catalog prompt and a tiny JSON answer. After moving to local llama.cpp, the edge Worker’s five-second response-header deadline was too aggressive. llama.cpp can spend several seconds evaluating the catalog before its first streamed event even though token decoding is healthy afterward.

The fix was not an automatic retry. Retrying an accepted POST can duplicate work. Instead, the Worker now allows up to 30 seconds for the response headers while preserving the browser’s overall deadline.

We also discovered a small-model routing failure: “What did Nishad **build** at Twitter?” selected an article whose title began with “Building” instead of the career source. The routing instruction now states that employer-specific responsibility and project questions must select career evidence. This is a useful reminder that schema-constrained output guarantees shape, not semantic correctness.

## Privacy-safe ML observability

The public [operations metrics page](https://nishad.ai/metrics/) now has a separate **ML inference** section.

It publishes measurable runtime data:

- gateway and model readiness;
- active and waiting queue depth;
- completed, truncated, failed, cancelled, and rejected requests;
- completion and failure rates derived from settled generations;
- p50 and p95 end-to-end latency;
- p50 and p95 queue wait;
- p50 and p95 time to first token;
- measured decode tokens per second;
- prompt and output token totals;
- average output tokens.

It deliberately does **not** publish “accuracy.” Live user questions have no ground-truth labels, so an online accuracy percentage would be invented. A future benchmark score would need a versioned synthetic dataset, explicit pass criteria, model/configuration identity, and a last-run timestamp.

The gateway keeps at most 512 recent generation measurements and 288 host samples. Counters reset on restart. The Worker reconstructs the public JSON object field by field, dropping prompts, answers, IPs, credentials, filenames, private addresses, and arbitrary upstream fields.

![A neon observability and failover diagram showing latency, queue, outcome, and token metrics flowing from the gateway to a sanitized public dashboard, while a Mac outage sends compatible browsers to WebLLM and WebGPU.](/assets/blog/mac-inference-fallback-observability.svg)

*Observe the system, not the visitor.*

## Bounded conversation context in the browser tab

The first terminal revision treated every AI question as an isolated request.
That was predictable, but follow-ups such as “Where was he then?” or “What about
the next role?” lacked the previous answer that made the pronouns meaningful.

The terminal now retains **up to four recent user/assistant exchanges** in
JavaScript memory for the current tab. A follow-up request is assembled as:

```json
[
  { "role": "system", "content": "current ontology and selected evidence" },
  { "role": "user", "content": "earlier question" },
  { "role": "assistant", "content": "earlier completed answer" },
  { "role": "user", "content": "current follow-up" }
]
```

With a full four-exchange window, the request can contain one system message,
eight historical user/assistant messages, and the current user message. The
gateway therefore permits at most ten bounded messages and accepts only
`system`, `user`, and `assistant` roles.

Only successful completed answers enter memory. Interrupted streams, routing
errors, empty responses, and requests rejected before generation do not create a
fake conversation turn.

The browser also applies a character budget before each request. Newer exchanges
win when the budget is tight. The WebGPU fallback receives a smaller history
budget because its context window is only 2,048 tokens; the self-hosted and BYOK
paths can carry more context but retain the same four-exchange cap.

Semantic source routing receives a compact version of the recent conversation.
That matters for a question such as:

```text
Where did Nishad work in 2020?
→ Twitter.

Which location was he at?
→ Seattle, Washington.
```

The current profile location is not allowed to replace the historical location
stored on the Twitter career entry. Every employment and education move is kept
with its own location in the ontology.

This is intentionally **session memory, not user profiling**:

- it is not written to `localStorage`, cookies, analytics, or the gateway;
- it is not attached to an IP address or visitor identifier;
- it disappears when the tab closes or reloads;
- switching between Qwen, explicit BYOK OpenAI, and WebGPU retains the same
  in-tab conversation;
- typing `forget` clears it immediately.

This design improves conversational clarity without creating a server-side
conversation database or pretending the model has durable personal memory.

## The browser-local fallback

The Mac is the default, not a single point of fictional perfection.

When the Worker or gateway fails before an answer starts, `askAI()` switches to a browser-local model:

```text
Self-hosted request fails
  → verify this was not a queue/rate-limit contract
  → initialize WebLLM lazily
  → download SmolLM2 weights on first use
  → run routing and generation with WebGPU
  → stream output into the same terminal UI
```

The fallback is **SmolLM2-360M-Instruct**, chosen for browser practicality rather than parity with Qwen. It runs entirely in the visitor’s browser. No visitor API key or owner inference server is involved.

There are important boundaries:

- WebGPU must be available.
- Current Chrome or Edge provides the most reliable path.
- The first fallback request downloads model weights.
- The context window is only 2,048 tokens.
- Structured Spotify reports do not use this fallback because the small model cannot reliably satisfy that schema.
- A full queue or visitor quota rejection does not trigger fallback; those are capacity policies, not backend outages.
- An interrupted answer does not start a second model automatically because generation may already have consumed resources.

If WebGPU is unavailable, the terminal says so explicitly. It does not claim that a local model answered.

## What I would change for a larger deployment

This design is intentionally sized for a personal website. At higher traffic I would replace:

- the quick tunnel with a named tunnel;
- in-memory counters with privacy-reviewed durable aggregates;
- per-isolate Worker cooldowns with shared health state;
- one Mac with at least two independently powered inference hosts;
- launchd-only alerting with external synthetic checks;
- a single small router model with deterministic routing for high-confidence intents plus benchmarked semantic routing.

I would not start by adding more model concurrency. On a memory-limited local host, concurrency is a capacity-planning decision, not a configuration flex.

## The main lesson

Local inference removes a paid API dependency. It does not remove systems engineering.

The model is one process in a chain of contracts:

- model weights must be verified;
- the inference engine must stay private;
- the gateway must distinguish completion from interruption;
- the queue must expose honest capacity;
- the Worker must avoid ambiguous retries;
- process recovery must preserve secrets;
- metrics must measure only what can actually be known;
- the browser fallback must be explicit about its capabilities.

That is what turned a model running on a MacBook into an AI feature that a public static website can use—and, just as importantly, fail safely without pretending nothing happened.

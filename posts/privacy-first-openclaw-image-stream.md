---
{
  "title": "Build a Privacy-First OpenClaw Image Stream",
  "date": "2026-10-07",
  "description": "A twelve-chapter tutorial covering OpenClaw, privacy-safe image search, four async lanes, sqlite-vec caching, Kafka recovery, and Azure migration.",
  "tags": ["OpenClaw", "privacy", "image processing", "Kafka", "Azure"],
  "draft": false
}
---

This tutorial follows one canonical twelve-chapter script. The narration and storyboard use the same chapter titles, order, claims, and tone.

The project begins with a clean OpenClaw installation, adds a Gateway plus foundational plugins and messaging channels, defines a privacy-safe image-search goal, and then reconstructs the WhatsApp, Gmail, Apple Photos, Kafka, vector-cache, concurrency, dashboard, and Azure migration work completed on 2026-10-07.

All examples are sanitized. Never place secrets, private OCR, full card/account/identity values, chat IDs, OAuth URLs, public IPs, or SSH material in tutorial code or screenshots.

---

## Chapter 1 — Install OpenClaw

### 1.1 Prepare the host

Use a supported macOS or Linux host with:

- a current Node.js release supported by your OpenClaw version;
- Python 3 for local data and image utilities;
- Git and SSH;
- adequate disk encryption and an owner-controlled user account.

Install OpenClaw with the current official installer or package-manager command from the OpenClaw documentation. A common npm-based installation looks like:

```bash
npm install --global openclaw
```

Do not copy an old command blindly. Pin the release in production and record it in your runbook. The verified Azure migration used OpenClaw **2026.9.8**.

Verify the binary without exposing configuration:

```bash
openclaw --version
openclaw --help
```

Create the initial configuration through the supported setup flow:

```bash
openclaw configure
```

Keep provider credentials in OpenClaw secret storage or environment-backed secret references. Do not commit credentials to the workspace.

### 1.2 Installation acceptance checks

A host passes this chapter when:

1. `openclaw --version` returns the intended release.
2. `openclaw --help` renders normally.
3. Configuration validates using the command supported by that release.
4. The OpenClaw state directory is owner-only.
5. No messaging channel is enabled accidentally.

---

## Chapter 2 — Run the Gateway and Configure Foundational Plugins and Channels

The Gateway is the long-running OpenClaw control plane. Install and run it using the supported service flow for the host:

```bash
openclaw gateway install
openclaw gateway status --deep
```

Keep the Gateway loopback-bound unless a reviewed secure route is required. On Linux, verify the user service is enabled and active. On macOS, use the OpenClaw-managed service rather than inventing an unmanaged background process.

### 2.1 Inspect before installing plugins

```bash
openclaw plugins list
openclaw channels status
```

Install only the plugins you need, pinning a compatible version in production:

```bash
openclaw plugins install <plugin-package>@<version>
```

Foundational capabilities for this tutorial are:

- a model-provider plugin with image input support;
- WhatsApp for the demonstrated operational dashboard;
- Telegram as a second supported messaging option;
- Gmail read-only integration or the corresponding workspace skill;
- scheduling/automation support;
- optional memory and vector tooling.

### 2.2 Configure WhatsApp

Use the supported channel setup instead of editing credential files manually:

```bash
openclaw channels add whatsapp
```

Complete the private pairing flow. Never publish a QR code, pairing code, account identifier, or target chat ID. Then verify:

```bash
openclaw channels status --json
```

Acceptance evidence should show WhatsApp configured, linked, connected, healthy, and free of a last error. Send a harmless private test message to an approved test destination and verify the provider acknowledgement in Gateway logs.

**Single-listener rule:** only one Gateway should own the linked WhatsApp session. In the implemented system, Azure owned WhatsApp and the Mac channel stayed disabled. Running both could cause duplicate replies, disconnects, or relinking.

### 2.3 Configure Telegram

Telegram is not part of the measured image POC, but the foundational procedure is parallel:

```bash
openclaw channels add telegram
openclaw channels status --json
```

Enter the bot token through the masked setup flow, never in shell history, source code, or screenshots. Restrict allowed users/chats according to your deployment. Verify connection health, then perform one approved inbound and outbound test.

**Verified versus illustrative:** WhatsApp delivery was live-proven in this project. Telegram setup here is a general learning example and was **not verified in the source transcript**.

### 2.4 Gateway/channel acceptance checks

- Gateway deep status is healthy.
- Required plugins are loaded at compatible versions.
- Exactly one WhatsApp listener is active.
- Telegram, when used, passes one inbound and outbound test.
- Schedulers remain disabled during offline staging or migration.
- No secret appears in logs, command output, or the workspace.

---

## Chapter 3 — Define the Goal and Privacy Contract

### General learning goal

Build an image stream that can find owner-authorized important images and identifiers—for example:

- a driving-licence image or **masked** licence number;
- a passport or identity-document image;
- a receipt, warranty, or insurance document;
- a payment confirmation;
- a household document the owner needs to retrieve.

Return only a coarse classification, source reference, confidence/provenance, and masked identifier. A synthetic licence result might be rendered as `DL-XX-••••-1234`; never use a real identifier in examples.

### Private card POC

The original private proof of concept searched owner-controlled WhatsApp media and Apple Photos for selected bank-card evidence. That POC is a private application of the general pipeline, not the tutorial’s default use case. Its rules were stricter:

- never show a full card or account number;
- keep OCR and originals owner-only;
- require bank/network/numeric evidence before a card finding;
- use Luhn validation for numeric candidates;
- send masked summaries only;
- do not reuse OCR from visually similar images.

### Privacy contract

1. Treat every image as potentially sensitive.
2. Keep private results and vector databases mode `0600`.
3. Use Gmail scope `gmail.readonly`.
4. Transfer resized derivatives rather than originals when possible.
5. Send previews only for benign, non-document, non-relevant images.
6. Record provenance: `model_generated` or `cosine_reused`.
7. Label unverified claims instead of guessing.

---

## Chapter 4 — Architecture and Data Flow

```text
WhatsApp archive on Mac ─┐
                         ├─> unified manifest ─> Mac preprocessing ─> SSH/SCP ─┐
Apple Photos on Mac ─────┘                                                    │
                                                                              v
Gmail read-only OAuth ─> scheduled digest ───────────────────────────> OpenClaw on Azure E16
                                                                              │
                                    ┌─────────────────────────────────────────┼──────────────────┐
                                    v                                         v                  v
                           hosted vision inference                      Kafka recovery      sqlite-vec cache
                                    │                                         │                  │
                                    └──────── masked structured results ───────┴──────────────────┘
                                                                              │
                                                                              v
                                                               ImportantPings on WhatsApp
```

The Mac is the source adapter because Photos and the WhatsApp archive are local. Azure owns live messaging and hosted inference orchestration. Kafka is the ordered recovery source. `sqlite-vec` stores classifier reuse. ImportantPings receives masked status, metrics charts, safe previews, and Gmail digests.

The implemented E16 destination had **16 vCPU and 128 GB RAM**. Exact addresses and private destinations are intentionally omitted.

---

## Chapter 5 — Discover and Normalize WhatsApp and Apple Photos

The verified Apple Photos window contained **123 readable originals**, about **273 MB**. Do not trust Photos labels as ground truth; enumerate every owner-authorized item in the target window.

The WhatsApp archive contained **152 image records**, but expired media could return HTTP 403. Phone-assisted retry increased locally recovered files from **53 to 98** at one measured point. In archive positions 53–152, **24 usable images** mapped locally and **76 remained unavailable**. Unavailable means pending, not failed.

Normalize both sources with one UID:

```text
whatsapp:<opaque-message-id>
apple_photos:<photo-uuid>
```

Use schema `image-analysis.v1` for manifest and completion events:

```json
{
  "schema": "image-analysis.v1",
  "event_type": "image_manifest",
  "image_uid": "apple_photos:<masked-uuid>",
  "source_type": "apple_photos",
  "source_id": "<masked-uuid>",
  "sequence_index": 53,
  "sequence_total": 152,
  "captured_at": "<timestamp>"
}
```

Key all durable records by `image_uid`. The v2 migration seeded **152 manifest events** and **24 completion events**.

---

## Chapter 6 — Preprocess on Mac and Infer on E16

For each image:

1. Correct EXIF orientation.
2. Build a **1600 px, JPEG quality 65** scan derivative.
3. Build a **1024 px, JPEG quality 60** safe-preview candidate.
4. Upload through SSH/SCP.
5. Delete transient derivatives after durable completion.

A representative image fell from about **2.2 MB** to roughly **95 KB**. In a 19-image sample:

- Mac-to-E16 upload averaged **1.84 s**;
- hosted image-to-text inference averaged **13.89 s**, about **84%** of total;
- other orchestration was about **0.7 s**;
- end-to-end averaged **16.44 s**, with **19.89 s p99**.

E16 was only **8–9% CPU busy** with **121 GiB RAM available**. Hosted inference—not E16 compute—was the bottleneck.

Ask the model for compact JSON: coarse caption, bounded private OCR, `card_or_document`, and controlled `kind`. Then apply deterministic identifier rules. For a general driving-licence example, validate the expected jurisdiction pattern and mask all but a small suffix. For the private card POC, check bank/network terms, 13–19 digit candidates, and Luhn validity.

A generic document must not become a card finding without stronger evidence. A wrong model name once produced a misleading zero result, so check errors before claiming zero findings.

---

## Chapter 7 — Benchmark Four Async Lanes and Evaluate Models

A same-input concurrency spike produced:

- **1 lane:** 5.53 images/minute;
- **2 lanes:** 10.79 images/minute, **1.95×**;
- **4 lanes:** 17.92 images/minute, **3.24×**;
- errors: **0** in all runs;
- per-image latency: **10.86 s** at one lane and **11.81 s** at four lanes.

Four lanes improved batch throughput without a complex queue rewrite.

A four-image model eval produced:

- GPT-5.6 Sol Fast: **12/12**, **12.38 s wall**;
- Claude Haiku 4.5: **12/12**, **12.26 s**;
- Gemini 3.8 Flash: **12/12**, **15.60 s**;
- GPT-5 mini: **11/12**, **30.14 s**.

There was no meaningful model-only speedup worth the switching risk. The selected design kept the current model and used four lanes. These are small engineering samples, not universal benchmarks.

### How async processing improved p50 and p95

Track two different latency families so the optimization is not overstated:

1. **Per-image service latency:** resize, upload, inference, and result handling for one image.
2. **Queue-inclusive completion latency:** how long an image waits before a lane is available, plus its service latency.

The original 19-image production sample had **16.06 s p50** and **19.89 s p95/p99** end-to-end. Four asynchronous lanes did not make the hosted model itself much faster: in the equal-input spike, per-call p50 was about **11.44 s** and p95 was **13.39 s**. What async removed was serial queueing. Four images completed in **13.39 s wall time** instead of **43.43 s**, reducing batch makespan by about **69%** and improving queue-inclusive p50 and p95 as the backlog grows.

Keep the implementation simple: one bounded `ThreadPoolExecutor`, four workers, independent image jobs, durable completion after success, and no second queue framework. Backpressure still comes from CPU/memory/provider health checks.

---

## Chapter 8 — Add the Persistent sqlite-vec Classifier Cache

The verified cache used:

- `sqlite-vec` **0.1.6**;
- **768-dimensional** `rgb16-normalized-v1` embeddings;
- WAL mode and `synchronous=FULL`;
- cosine threshold **0.9999**.

Store `image_uid`, source fields, embedding, classifier JSON, coarse caption, kind, relevance flags, provenance, source-image lineage, similarity, model, embedder, and timestamps.

A spike over **98 recovered images** found **5 safe near-identical pairs at or above 0.9999**. Looser thresholds grouped payment templates with different text, so:

- reuse only benign, non-relevant, non-document classifications;
- return a generic caption;
- never reuse OCR or identifiers;
- send sensitive or ambiguous images through vision.

After smoke-test cleanup, the production cache held **24 model-generated rows**. The database was **3,211,264 bytes** and owner-only.

### How vector reuse changed the latency distribution

The vector database attacks a different part of the distribution from async processing. Async reduces waiting; sqlite-vec avoids hosted inference entirely for a safe near-duplicate.

In the four-image integrated smoke test, three benign near-duplicates were served locally in about **0.18–0.21 s**, while one cache miss used hosted vision and completed in **18.43 s**. That produced roughly **0.20 s p50** but **18.43 s p95** for this tiny sample. The lesson is important:

- cache hits collapse the median;
- model misses still define the tail;
- four async lanes keep those misses from blocking unrelated hits;
- a strict threshold and sensitive-image bypass protect quality while optimizing latency.

Do not market the 0.20-second p50 as a universal number—it depends on cache-hit rate. Report hit rate beside p50/p95, and split metrics by `model_generated` versus `cosine_reused` provenance.

---

## Chapter 9 — Make Kafka Recovery Semantics Exact

Use two topics:

- `image-analysis-manifest-v2`, cleanup `delete`;
- `image-analysis-completions-v2`, cleanup `compact,delete`.

Apply:

- `retention.ms=345600000`, exactly **96 hours**;
- `segment.ms=3600000`;
- `min.cleanable.dirty.ratio=0.01` on completion topics.

The critical rule is:

> **Next image #53 means committed Kafka offset 52.**

Images 1–52 are complete, and Kafka offsets identify the next zero-based position. Committing 53 would skip image 53.

Advance only through the highest contiguous completion. A sparse completion for a later image is durable but must not skip an unavailable earlier item. The verified v2 state was **152 manifest records**, **24 completion records**, and consumer-group offset **52**.

Kafka does not directly reduce inference p50 or p95. It prevents crash recovery from replaying completed work, which avoids duplicate model calls and unbounded recovery-tail latency. The dashboard should therefore show committed offset, sparse completions, and replay count alongside performance percentiles.

---

## Chapter 10 — Build ImportantPings Dashboards and Gmail Digests

Every dashboard should separate:

- Mac-to-Azure upload;
- Azure model processing;
- cold Mac→SSH→CLI→Gateway dispatch;
- actual WhatsApp provider acknowledgement;
- total per-image latency;
- processed, pending, hits, errors, ETA, CPU, memory, load, average, p95, and p99.

A roughly 20.9-second metric was initially mislabeled “Azure to WhatsApp.” It was cold orchestration, not provider latency. Verified acknowledgements included:

- earlier text: about **0.4–0.5 s**;
- earlier compressed media: about **1.3–3.1 s**;
- later status proofs: **959 ms**, **299 ms**, and **314 ms**;
- dashboard image: **1.708 s**.

During active processing, ImportantPings received approximately one-minute dashboards and a separate heartbeat with Kafka position, completion count, scanner state, E16 health, and the latest PNG chart.

Gmail used a Desktop OAuth client, loopback callback through an SSH tunnel, and `gmail.readonly`. Fixes included adding the required redirect URI and adding the owner as a test user. **Seven automations** migrated. A scheduled proof completed in **9.302 s** and received a **299 ms** WhatsApp acknowledgement.

---

## Chapter 11 — Migrate Azure in Rings and Preserve Rollback

Destination: Azure `Standard_E16ds_v5`, **16 vCPU / 128 GB RAM**, OpenClaw 2026.9.8.

- **Ring 0:** stage a verified backup, matching plugins, configuration, workspace, and scanner assets; keep WhatsApp and scheduler disabled.
- **Ring 1:** take the final quiesced backup, stop source, restore destination, and enable messaging. Verified cutover: **58 seconds**.
- **Ring 2:** prove model inference. Exact proof: `E16_MODEL_OK` in **9.5 s** while WhatsApp stayed healthy.
- **Ring 3:** restore Gmail runtime/config and seven automations.
- **Ring 4:** validate SQLite snapshot, FTS, **1536-dimensional** memory vector index, and audit state.
- **Outbound proof:** Gmail digest succeeded; WhatsApp acknowledgement **959 ms**.

Rollback procedure:

1. Stop E16 Gateway.
2. Start the old Gateway.
3. Verify WhatsApp and scheduler ownership.
4. Never keep both listeners active beyond the explicitly tolerated short overlap.
5. Restore the last verified backup if needed.

The old VM was stopped and retained for rollback. Deletion was requested only after drain metrics approached zero, but **deletion was not verified**.

---

## Chapter 12 — Failures, Costs, and the Production Checklist

### Failures and fixes

- Expired WhatsApp media returned 403 → use phone-assisted retry; keep unrecovered media pending.
- Mac and Azure WhatsApp ownership conflicted → keep one listener, Azure in this design.
- Generic documents became false positives → require stronger identifier evidence.
- Relative preview paths failed → use an absolute path on the sending host.
- Cold dispatch was labeled as provider latency → split the metric boundaries.
- Kafka keyed output parsed as zero completions → parse key/value output and increase consumer timeout.
- Kafka comma-valued cleanup policy failed → quote `[compact,delete]`.
- OAuth URL omitted redirect URI → set the loopback redirect explicitly.
- OAuth app blocked access → add the owner as a test user.
- Similarity thresholds were too loose → use 0.9999 and never reuse OCR.

### Costs

Verified: the earlier setup had a **₹4,815 monthly budget alert**. A budget alert is not actual spend.

Unverified/blocked in the source transcript:

- exact E16 hourly or monthly cost;
- model inference cost;
- Kafka and storage cost;
- old-VM deletion;
- Telegram channel proof;
- GPU deployment, because the subscription had zero GPU-family quota.

Use billing data before publishing cost claims:

```text
VM cost = regional hourly rate × powered-on hours
model cost = image requests × provider unit price
storage cost = disks + snapshots + retained backups
network cost = billable egress
```

### Production checklist

- [ ] OpenClaw version pinned and installation verified.
- [ ] Gateway healthy and loopback-bound.
- [ ] Required plugins loaded; secrets masked.
- [ ] Exactly one WhatsApp listener active.
- [ ] Telegram, if used, independently verified.
- [ ] General identifier examples synthetic and masked.
- [ ] Private card POC kept separate and owner-only.
- [ ] Unified `image_uid` used everywhere.
- [ ] Four-lane benchmark repeated under current provider limits.
- [ ] Cache bypasses documents and sensitive images.
- [ ] Next #53 is tested as committed offset 52.
- [ ] All v1/v2 topics retain 96 hours.
- [ ] Dashboard distinguishes dispatch from provider acknowledgement.
- [ ] Gmail remains read-only.
- [ ] Rollback retained until drain proof.
- [ ] Costs taken from billing, not a budget alert.

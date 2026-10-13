---
{
  "title": "One Hour, Five Fixes, and One Missing Contract",
  "date": "2026-10-13",
  "description": "A production debugging story about Spotify metadata, Gemma 4, SSE versus JSON, honest completion signals, Firefox PDF downloads, and the tiny UI details that decide whether a system feels trustworthy.",
  "tags": ["debugging", "Gemma", "Spotify", "PDF", "Firefox", "system design"],
  "draft": false
}
---

The bug report sounded simple:

> “Why is this not working since one hour? Five fixes have been attempted.”

The feature was supposed to feel almost magical:

1. connect Spotify;
2. choose a time range;
3. send a carefully bounded metadata sample to a self-hosted model;
4. receive a fictional music-personality report;
5. download a cute PDF dossier.

Instead, the screen waited, then displayed:

> AI report was refused, truncated, or empty. No result was invented.

No personality report. No tarot card. No PDF. Just a neon terminal quietly refusing to hallucinate success.

That last part was useful: the system failed without inventing a report.

The rest of the work was about identifying the first broken boundary rather than changing every layer that looked suspicious.

> **Try or inspect it:** [open the guided Spotify report webapp](/#music), [open the themed synthetic PDF](/assets/demos/spotify-gemma-synthetic-report.pdf), [preview its first page](/assets/demos/spotify-gemma-synthetic-report-pdf.png), or [view the full web report](/assets/demos/spotify-gemma-synthetic-report.png). The downloadable demo uses invented artist and track names—no personal Spotify data. The webapp keeps Spotify connection and AI consent explicit.

![Synthetic Spotify report rendered in Firefox after the Worker, Mac gateway, Gemma validation, and PDF pipeline completed.](/assets/demos/spotify-gemma-synthetic-report.png)

## The pipeline was longer than the button

The user saw one button. The button was attached to a small distributed system:

```text
Browser UI
  → Spotify Web API
  → report prompt builder
  → Cloudflare Worker
  → tunnel to a Mac
  → Python gateway
  → Ollama
  → Gemma 4
  → streamed model events
  → Worker response adapter
  → browser JSON parser
  → strict report validator
  → report renderer
  → PDF serializer
  → Firefox download
```

That is a long path behind one button.

It also explains why plausible fixes can be completely correct and still not repair the user experience.

Increasing the output budget can help truncation.

Improving PDF generation can help PDF generation.

Extending a timeout can help slow inference.

None of those changes can fix a response that arrives in the wrong protocol.

## Fixing the last stage before proving the first stage

Several earlier fixes targeted reasonable suspects:

- load the PDF exporter correctly;
- keep a manual download link when automatic download is blocked;
- stop forcing structured reports through chat mode;
- enable JSON mode in the model gateway;
- give Gemma more output tokens and more time.

Each change improved a real weakness.

But PDF code executes only **after a report exists**.

In the failing recording, no report ever rendered. The export button had not run yet.

This is a common debugging trap: the most visible broken feature receives the most attention, even when the defect lives several boundaries earlier.

The antidote is boring and powerful:

> Write down the exact contract at every boundary.

## The contract mismatch

The production browser did this:

```js
const response = await fetch(workerUrl, {
  method: 'POST',
  body: JSON.stringify({ messages })
});

const envelope = await response.json();
```

It expected:

```json
{
  "content": "{\"writeUp\":\"...\"}",
  "finish_reason": "stop"
}
```

The deployed Worker returned this instead:

```text
Content-Type: text/event-stream

data: {"delta":"{\"writeUp\":"}

data: {"delta":"\"...\"}"}

data: {"done":true,"finish_reason":"stop"}
```

The inner model content was valid JSON.

The HTTP body was not a JSON document. It was a sequence of Server-Sent Events.

Calling `response.json()` on that body fails at the first `d` in `data:`.

That was the production blocker.

The two response formats serve different purposes and are not interchangeable.

Terminal chat benefits from incremental streaming because text appears as Gemma writes it.

A structured report should be validated as one complete object. The browser should not render half an MBTI axis and optimistically hope the tarot card arrives later.

So the public contract became:

```text
explicit mode: "chat"  → SSE stream
omitted report mode    → completed JSON envelope
```

One endpoint, two intentional protocols.

## Never manufacture a happy ending

The committed Worker already contained an adapter that collected report events. It also contained a dangerous convenience:

```js
finish_reason: finishReason || (content.trim() ? 'stop' : null)
```

In plain English:

> “If I received some text but never saw a completion event, pretend the model stopped normally.”

That creates success-shaped data from an interrupted stream.

It is especially risky for structured output. A partial JSON object may look substantial while still missing the final fields—or the closing brace.

The repaired adapter requires all three:

1. non-empty content;
2. a genuine terminal event;
3. an explicit finish reason.

EOF is not success.

A socket closing is not success.

“It looks almost complete” is not success.

The gateway and Worker now expose sanitized states such as:

```text
upstream_incomplete
upstream_invalid_response
upstream_timeout
upstream_failed
request_cancelled
busy
```

The browser translates those codes into useful messages without leaking model output, prompts, host details, or private exceptions.

The playful interface still needs precise failure semantics.

## The deployed code was not the repository code

Deployment introduced a second mismatch.

GitHub Pages deployed the static website. It did **not** deploy:

- the Cloudflare Worker;
- the Mac gateway;
- the installed Worker copy used by the tunnel supervisor.

The public page matched the latest repository revision. The live Worker did not.

Its deployed script was smaller and simply forwarded the upstream stream. The report adapter had never reached production.

There was an additional persistence trap: whenever the ephemeral tunnel restarted, a supervisor redeployed an installed `worker.js`. Updating only the repository would allow a future tunnel restart to resurrect the old bug.

The release therefore synchronized:

```text
repository Worker
installed supervisor Worker
deployed Cloudflare Worker
repository gateway
installed Mac gateway
```

Deployment behavior is part of the system.

If the production release path can silently restore old behavior, it belongs in the debugging model.

## Test the complete schema, not the headline

The music report was not just:

```json
{"headline":"you enjoy synths"}
```

The validator required:

- a long-form write-up;
- genre guesses;
- a four-letter music MBTI;
- exactly four matching axes with labels, opposites, and scores;
- a tarot name, symbol, tagline, and flavor text;
- a compatibility score and label;
- gentle, cheeky, and spicy roasts.

Earlier small probes proved that Gemma could return *some* JSON. They did not prove that Gemma could reliably produce the actual application contract.

The repair used invented fixtures in two sizes:

- a normal sample with five artists and five tracks;
- the maximum supported top-list sample with fifty artists and fifty tracks.

Both passed the production prompt builder and the strict production validator.

Observed generation times were roughly:

```text
cold normal fixture       ~122 seconds
warm maximum fixture       ~93 seconds
final live Firefox run    ~104 seconds
```

The evidence did not justify another token-budget increase or a weaker schema.

Gemma could complete the report. The UI simply needed to admit that “local” does not mean “instant.”

The progress copy now says a full report can take around two minutes.

Accurate progress text prevents a slow local generation from looking like a frozen interface.

## A Firefox “network bug” that was actually port 9

During browser acceptance, Chromium passed and Firefox reported:

> The AI service is unreachable or timed out.

At first glance, this looked like a browser transport incompatibility.

The line-level stack ended at the report client’s network-error translation. The mocked request never reached Playwright’s route handler.

The test endpoint used:

```text
http://127.0.0.1:9/report
```

Port 9 is historically the Discard Protocol. Firefox blocks access to restricted ports before `fetch` reaches the network interception layer.

There was no application bug. The test fixture itself used a port Firefox rejects.

Moving the mock to a normal high port fixed Firefox immediately.

This is why cross-browser tests are valuable even when they embarrass the test itself.

## The UI exposed too much state at once

After the transport worked, the interface still asked the user to understand too much state:

- Am I connected?
- Did my click register?
- Is “six months” the mood timeline?
- Is the model running?
- Can I click another report?
- Is PDF generation stuck?

The previous page displayed all controls at once. It was possible to click through them in a valid order, but the interface did not *teach* that order.

The new flow is explicit:

```text
1. Connect
2. Choose
3. Review & generate
4. Read & download
```

The selected report is visibly pressed.

Unavailable choices are disabled.

Loading text names the current stage.

The recent-play mood timeline is clearly separated from the approximately six-month top-item summary. They are different Spotify datasets, not two names for the same history.

Generation remains user-triggered. The interface can advance attention without silently sending music metadata to a model.

The revised flow reduces ambiguous and invalid states.

## The PDF worked—and still looked broken

The first production acceptance produced valid, identical automatic and manual PDF files.

Quick Look opened them.

The headings and paragraphs, however, were glued together:

```text
state.Music personality
write-upDive
metadatasynthetic
scoresENFPThis
broken.Basic
```

The exporter cloned the report, removed buttons and sliders, then used:

```js
clone.innerText || clone.textContent
```

The clone was detached from the document. In that state, `innerText` was unavailable or empty, so the code fell back to `textContent`.

`textContent` understands characters. It does not care that one node is a heading and the next is a paragraph.

The fix was a small block-aware serializer:

```js
function appendReportText(node, parts) {
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.nodeValue || '');
    return;
  }

  const block = BLOCK_TAGS.has(node.tagName);
  if (block) parts.push('\n');
  for (const child of node.childNodes) appendReportText(child, parts);
  if (block) parts.push('\n');
}
```

The PDF styling did not need a redesign.

The text needed structural boundaries.

A regression now places headings and paragraphs directly next to each other in the DOM and verifies that extraction preserves separation.

### Then make the PDF belong to the site

Readable was necessary, but the first exporter still looked like a plain document printed by a backend nobody had met.

The redesigned PDF uses the same visual language as the webapp:

- deep navy pages instead of white paper;
- mint, purple, yellow, and pink section rails;
- terminal-style report labels and continuation headers;
- high-contrast cards for each report section;
- consistent page numbers and entertainment disclaimers;
- selectable text and dependency-free browser generation.

The content and validation contract did not change. Only hierarchy and presentation did.

![First page of the themed synthetic Spotify/Gemma PDF, rendered by macOS Quick Look.](/assets/demos/spotify-gemma-synthetic-report-pdf.png)

The final Firefox acceptance:

- rendered the complete report;
- saved the automatic PDF;
- saved the manual-link PDF;
- verified the files were byte-identical;
- opened the PDF with a real reader;
- checked expected report headings;
- rejected known joined-word patterns;
- recorded no page errors, console errors, or analytics events.

## Small signals removed ambiguity

The live gateway now records small operational signals:

```json
{
  "event": "generation",
  "mode": "report",
  "duration_ms": 86590,
  "finish_reason": "stop",
  "error": null,
  "prompt_tokens": 2046,
  "output_tokens": 403
}
```

It does not log prompts or generated reports.

Those signals made one important distinction visible:

```text
request_cancelled ≠ Gemma crashed
```

Two observed failures were browser cancellations after navigation. Other requests completed normally.

Without completion telemetry, every blank screen becomes “the AI broke.”

With it, we can tell the difference between:

- user navigation;
- browser cancellation;
- queue contention;
- model timeout;
- malformed upstream events;
- successful completion;
- output-limit termination.

Observability did not require a new dashboard. One structured event at the ambiguous boundary was enough.

## Making the implementation easier to inspect

After the pipeline was healthy, the site received one more information-design pass.

A reader should not need to decode the multiverse theme before finding the technical implementation.

The homepage now exposes:

- the live Cloudflare → Mac gateway → Ollama/Gemma path;
- the in-browser WebGPU fallback;
- the private Go/PostgreSQL analytics system;
- highlighted CMU, Twitter, Microsoft, and independent-build milestones;
- direct links to the technical build notes.

The terminal also gained a deterministic command:

```text
brief
```

It renders compact builder notes immediately, without waiting for a remote model to summarize a résumé.

That follows a useful interface principle:

> If an answer is known, important, and latency-sensitive, it probably should not require generative AI.

The model remains available for open-ended questions. The short factual summary is deterministic.

## What the five fixes taught me

The earlier fixes addressed real weaknesses. They did not yet prove the complete production path.

Here is the checklist I want to remember:

### 1. Reproduce the public contract

Do not stop at source code. Capture the live content type, status, and response shape.

### 2. Test the real data shape

A toy JSON probe is not evidence for a nested production schema.

### 3. Require terminal evidence

Never convert partial content into a fabricated successful completion.

### 4. Separate model time from export time

The final PDF takes seconds. The report may take two minutes. Show those as different stages.

### 5. Make cancellation explicit

A closed connection is a state, not a mysterious failure.

### 6. Treat deployment copies as code

Repository, installed runtime, supervisor source, and public deployment must agree.

### 7. Test with the browser you promise

Firefox found a fixture bug and validated the actual download path.

### 8. Validate readability, not file existence

“A PDF was created” is weaker than “the PDF opened and a human can read it.”

### 9. Guide attention

An interface can contain the right buttons and still produce the wrong mental model.

### 10. Keep the system honest

No fake fields. No fake completion. No claim that synthetic OAuth proves a real account works. No claim that an older Azure architecture is the current Mac runtime.

Those constraints narrowed the investigation and made the final verification meaningful.

## The final shape

The repaired path is now:

```text
invented or explicitly consented music metadata
  → strict prompt
  → Cloudflare adapter
  → Mac gateway
  → Ollama / Gemma 4
  → genuine completion event
  → JSON envelope
  → strict validator
  → guided report UI
  → readable Firefox PDF
```

It is still a playful feature: there is a fictional tarot card, three levels of roast, and a cat in the visual language.

The implementation underneath is deliberately strict. The interface can be friendly without obscuring what completed, what failed, and what was actually tested.

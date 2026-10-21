---
{
  "title": "Adding Live Web Search to a Local LLM Without Making the Terminal Wait",
  "date": "2026-10-21",
  "description": "How nishad.ai added LLM-routed Exa Lite search, progressive local-first answers, Cloudflare secret isolation, SmolLM fallback support, and a measured 10-prompt latency benchmark.",
  "tags": ["AI", "web search", "Exa", "Cloudflare Workers", "LLM", "RAG", "MLOps"],
  "draft": false
}
---

The nishad.ai terminal began as a deliberately closed knowledge system. Qwen could answer from the structured ontology, selected public pages, published articles, recent tab conversation, and its pretrained general knowledge. It could not discover information published after the model was trained or retrieve external evidence for questions outside the site corpus.

That limitation was useful for privacy and predictability, but it became visible in questions such as:

```text
What changed recently in llama.cpp prompt caching?
```

```text
Using public benchmarks, what might a comparable Twitter engineering role
in Seattle have paid around 2021?
```

The local model could explain what was documented and clearly label unknowns. It could not responsibly claim that it had searched the web.

The new design adds **Exa Lite search through the Cloudflare Worker**, but preserves the most important user-experience rule: the visitor should see the local answer first. Search happens in parallel, then a second Qwen call streams a clearly separated, cited web addendum.

This post explains the architecture, the security boundary, the routing changes, the browser fallback, and the measured latency from a ten-prompt benchmark.

![A progressive sequence diagram showing ontology source routing, distilled-context web intent, parallel local Qwen generation and Exa search, followed by a cited web-enrichment synthesis.](/assets/blog/exa-progressive-search-flow.svg)

*Search is an addendum, not a loading screen.*

## Why not give Qwen unrestricted browsing?

The model should not choose arbitrary URLs and ask the Mac gateway to fetch them. That would create an SSRF surface capable of probing:

```text
127.0.0.1
private LAN addresses
router administration pages
cloud metadata endpoints
file URLs
credential-bearing URLs
```

It would also mix model-generated instructions with networking authority.

Instead, Qwen produces one bounded natural-language search query. A narrow Worker endpoint calls one known provider:

```text
https://api.exa.ai/search
```

The Worker never fetches the URLs returned by Exa. It validates and returns only bounded metadata and cached highlights.

## A dedicated web-intent inference

The first implementation added `web_search` and `web_query` fields to the existing ontology source router. That router also received a long catalog of careers, geography, articles, pages, projects, and lore.

The result was unreliable. A question could explicitly say “search current public sources,” but the small Qwen router would notice a locally relevant article and set `web_search:false`.

The solution was not a keyword algorithm. The application first performs normal
ontology source and passage routing. It then gives a compact excerpt of that
selected authoritative evidence to a separate schema-constrained Qwen
web-intent call:

```json
{
  "web_search": true,
  "web_query": "recent llama.cpp prompt caching changes"
}
```

Its prompt contains no source catalog. It only decides whether the current question materially requires fresh external evidence and, if so, writes one self-contained query.

Ontology source selection remains a separate call:

```json
{
  "needs_site_data": true,
  "source_ids": [
    "blog-inside-nishad-ai-ontology-kv-cache"
  ],
  "intent": "answer"
}
```

For a compensation question, the selected career passage might identify:

```text
Software Engineer II at Microsoft
Bengaluru, India
May 2024–present
```

The intent model uses those facts to produce a category query such as:

```text
Microsoft Software Engineer II Bengaluru India compensation
```

rather than searching Nishad's name and retrieving unrelated namesakes.

This creates three initial inference phases:

```text
1. Local source and passage routing
2. Web-intent classification using the distilled local evidence
3. Final answer generation
```

Web-enabled questions add a fourth model call later for web synthesis.

## Progressive orchestration

After routing completes, the browser starts two branches:

```text
local Qwen answer
Exa Lite search
```

They run concurrently.

The local answer uses only the ontology and approved nishad.ai evidence. Its system prompt says that a separate web phase may follow and that it must not claim web access.

When the local answer completes, the terminal shows:

```text
nishad.ai🌐> Loading estimates/data from web...
```

If Exa has already returned, the message advances almost immediately. Otherwise it remains visible until the bounded search request finishes.

The second Qwen prompt contains:

- the original question;
- the local answer;
- the original grounded system prompt;
- up to 2,400 characters of sanitized Exa evidence;
- a policy that treats web excerpts as untrusted evidence;
- an instruction to add new external context rather than repeat the local answer.

The result streams into a new terminal line:

```text
nishad.ai🌐> ...
```

Source links and retrieval time are rendered by the browser from validated Worker data. Qwen does not invent URLs.

## The Worker search boundary

The Exa key is stored as a Cloudflare Worker secret:

```text
EXA_API_KEY
```

It is not committed to Git, copied into the Mac gateway, or sent to the browser.

The Worker accepts:

```text
POST /search
```

with:

```json
{
  "query": "one natural-language public search query"
}
```

It calls Exa Lite with:

```text
maximum 5 results
moderation enabled
cached highlights
no live page crawling
10-second timeout
```

The returned public contract is provider-neutral:

```json
{
  "schema": "nishad.web-search.v1",
  "query": "...",
  "retrieved_at": "...",
  "results": [
    {
      "title": "...",
      "url": "https://...",
      "snippet": "...",
      "published_at": null
    }
  ]
}
```

![A trust-boundary diagram showing the browser sending a query to a Cloudflare Worker, the Worker injecting the Exa secret, sanitizing results, and returning only bounded HTTPS evidence while the Mac gateway remains isolated.](/assets/blog/exa-search-security-boundary.svg)

*The model proposes words. The Worker owns network authority.*

## Validation and quotas

The Worker rejects:

- unapproved browser origins;
- non-POST methods;
- malformed JSON;
- request bodies above 4 KiB;
- queries shorter than 3 or longer than 300 characters;
- additional unexpected request fields;
- non-HTTPS result URLs;
- credential-bearing URLs;
- localhost, local-domain, and IP-literal results;
- titles above 200 characters;
- snippets above 900 characters;
- malformed provider responses.

Best-effort per-isolate quotas begin at:

```text
20 searches per visitor per day
500 searches globally per day
```

Provider failures are sanitized into stable errors such as:

```text
search_not_configured
search_quota_exceeded
search_rate_limited
search_budget_exhausted
search_timeout
search_unavailable
```

The local answer remains visible when search or synthesis fails.

## Search privacy

Exa receives the generated public search query. It does not receive:

- the complete ontology;
- browser cookies;
- recent conversation history;
- the gateway token;
- the Exa key in browser-visible form;
- Spotify tokens or identifiers;
- private analytics data.

The terminal displays the exact derived query:

```text
Public search query sent through Cloudflare to Exa: ...
```

This makes external data flow visible rather than silently changing the privacy boundary.

## SmolLM browser fallback

Search is independent of the Mac tunnel. If the Mac is unavailable but WebGPU works:

```text
SmolLM source routing
→ SmolLM web-intent call using selected evidence
→ browser-local answer
→ Exa search through Cloudflare
→ SmolLM web addendum
```

The fallback uses a much smaller evidence budget:

```text
900 web-evidence characters
256 web-addendum tokens
2,048-token model context
```

SmolLM should be treated as an extractive summarizer, not as equivalent to Qwen. If WebGPU is unavailable, the application can still evolve toward showing raw validated search cards without model synthesis.

## Exa Lite cost

Exa Lite currently costs:

```text
$4 per 1,000 searches
```

The account includes $10 in monthly credits, enough for roughly 2,500 Lite searches.

At a maximum of 100 terminal requests per day:

```text
3,000 requests/month
```

If one quarter require web search:

```text
750 searches/month
```

That remains inside the monthly credit.

Even if every request searched:

```text
3,000 searches
≈ $12 gross
≈ $2 after the monthly credit
```

Cloudflare Worker usage remains negligible at this scale. Outbound Exa calls are Worker subrequests and are not separately billed as Worker requests.

## Benchmark design

The committed harness is:

```sh
GATEWAY_TOKEN='...' npm run benchmark:web-enrichment
```

It tests ten prompts ranging from 72 to 508 characters.

Each scenario measures:

1. local ontology source routing;
2. web-intent Qwen latency using distilled evidence;
3. local Qwen answer latency;
4. live Exa Lite search latency;
5. second Qwen web-synthesis latency;
6. total end-to-end time.

The local answer and Exa search run in parallel. Therefore:

```text
parallel phase duration
≈ maximum(local Qwen duration, Exa search duration)
```

not their sum.

## Ten-prompt results

| # | Prompt chars | Local Qwen | Exa search | Web synthesis | Combined |
|---:|---:|---:|---:|---:|---:|
| 1 | 72 | 2.94 s | 0.57 s | 14.72 s | 23.76 s |
| 2 | 101 | 16.14 s | 2.42 s | 18.26 s | 55.39 s |
| 3 | 115 | 8.78 s | 2.03 s | 14.79 s | 36.64 s |
| 4 | 147 | 7.80 s | 3.02 s | 17.88 s | 34.94 s |
| 5 | 157 | 6.95 s | 1.73 s | 12.96 s | 28.99 s |
| 6 | 166 | 4.37 s | 1.87 s | 15.86 s | 33.84 s |
| 7 | 171 | 14.27 s | 2.63 s | 16.58 s | 54.35 s |
| 8 | 221 | 10.46 s | 1.84 s | 20.05 s | 48.48 s |
| 9 | 255 | 3.86 s | 1.70 s | 24.83 s | 51.61 s |
| 10 | 508 | 23.93 s | 2.24 s | 36.20 s | 80.31 s |

Aggregate latency:

| Metric | p50 | p95 | Minimum | Maximum |
|---|---:|---:|---:|---:|
| Local Qwen answer | 7.80 s | 23.93 s | 2.94 s | 23.93 s |
| Exa Lite search | 1.87 s | 3.02 s | 0.57 s | 3.02 s |
| Qwen web synthesis | 16.58 s | 36.20 s | 12.96 s | 36.20 s |
| Combined end to end | 36.64 s | 80.31 s | 23.76 s | 80.31 s |

![A benchmark chart showing that Exa search is consistently faster than local answer generation and web synthesis, with total latency increasing for longer prompts and multi-pass routing.](/assets/blog/exa-web-benchmark-results.svg)

*The internet was not the slow part.*

## What the measurements reveal

Exa search completed in under 3.1 seconds for every scenario. Because it ran alongside the local answer, it was fully hidden by Qwen generation in all ten cases.

The dominant costs were:

- web-intent inference;
- one or two ontology routing passes;
- local Qwen generation;
- the second Qwen synthesis.

The second synthesis had a 16.58-second median and became the largest single phase for many prompts. The longest request needed 36.20 seconds for synthesis and 80.31 seconds end to end.

Prompt length was not the only factor. Some short questions selected long local articles and triggered passage routing. Some longer questions needed no large local source. Cache state, output length, and selected evidence also affected latency.

## User-experience conclusion

Progressive rendering still helps:

```text
local answer first
→ web status
→ external addendum
```

The visitor receives useful local output after approximately 3–24 seconds instead of waiting 24–80 seconds for the entire enriched result.

However, the benchmark shows that web enrichment should remain selective. Running four model phases for every question would degrade throughput and user experience.

## Next optimizations

### Reduce local source routing for web-first questions

If a question is purely about current external data, the application may not need long local article passage selection. It can still include the compact ontology but skip unnecessary local retrieval.

### Cache the web-synthesis prefix

The web addendum uses slot `1`, which also serves normal answers. A future third slot could isolate:

```text
slot 0 → intent and routing
slot 1 → local terminal answers
slot 2 → web synthesis and reports
```

This needs more KV memory.

### Shorter enrichment output

The synthesis prompt currently permits up to 256 tokens. Many web addenda can be limited to:

```text
80–150 tokens
```

reducing total latency.

### Search-result caching

Identical public searches can be cached for one to six hours. This saves Exa credits, although it will not remove the larger Qwen synthesis cost.

### Evidence-first rendering

For simple queries, the browser could show validated search-result cards immediately while Qwen prepares the prose addendum.

### Dedicated small intent model

The separate Qwen intent call is reliable but takes several seconds. A smaller browser or edge classifier could make the decision faster, provided it is benchmarked against the current schema-constrained Qwen result.

## The broader lesson

Adding web search was not mainly a search-provider problem. Exa Lite was fast, inexpensive, and easy to bound. The harder work was preserving:

- local-first responsiveness;
- explicit provenance;
- secret isolation;
- source validation;
- failure-safe behavior;
- small-model routing reliability;
- bounded context;
- useful output when the web phase fails.

The architecture now treats the web as another evidence source—not as an authority that can execute instructions or silently overwrite the ontology.

That separation is what lets a static personal site, a local Mac-hosted Qwen model, a browser fallback, and a public search API cooperate without becoming one opaque agent with unrestricted network access.

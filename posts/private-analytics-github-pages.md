---
{
  "title": "From GitHub Pages to Private Analytics: Building My Own Metrics Dashboard",
  "date": "2026-10-07",
  "description": "A metrics-only Go and PostgreSQL dashboard beside a static website: explicit consent, daily browser estimates, owner-only GitHub sign-in, and honest deployment boundaries.",
  "tags": ["privacy", "analytics", "Go", "PostgreSQL", "Azure", "GitHub Pages"],
  "draft": false
}
---

My website has a fake terminal and an AI persona. Next question: is anybody reading the blog, or am I explaining distributed systems to myself?

I wanted pageviews, estimated unique visitors, referrers, countries, and popular posts on my Azure Ubuntu VM, with owner-only GitHub sign-in. Not a dashboard with a "secret" URL.

For the static foundation, start with [how I built nishad.ai](/blog/building-nishad-ai-from-scratch/). Here: **keep the public website static, and give private reporting a server-side boundary.**

## Static pages are not an authentication system

The homepage and generated blog are served by GitHub Pages. Pages can publish a dashboard launcher; it cannot validate a server session before releasing private report data.

So `/dashboard_metrics` on the public site is just a constant redirect. The canonical owner entry is [private.nishad.ai/dashboard_metrics](https://private.nishad.ai/dashboard_metrics). Knowing that address grants nothing.

The architecture has two deliberately different doors:

```text
Public browser
  |
  +--> nishad.ai / GitHub Pages
  |      homepage + generated /blog/ articles
  |      tracker off until explicit consent
  |
  +--> metrics.nishad.ai/collect
  |      nginx HTTPS --> loopback Go collector
  |                         |
  |                         v
  |                     PostgreSQL
  |                     daily aggregates
  |                         ^
  |                         |
  +--> private.nishad.ai/dashboard_metrics
         nginx HTTPS --> Go reporting service
                           GitHub owner authorization
                           server session required
```

The collector must receive public requests. The reporting service must not return public reports. Separate origins, service accounts, and database roles make that distinction concrete rather than decorative.

![Metrics flow: public Pages browser, consent gate, bounded collector, PostgreSQL aggregates, separate private report service, and authorized owner. No consent means no collection; no session means no reports.](/assets/blog/metrics-data-flow.svg)

*Figure: collection and reporting are separate trust boundaries. Arrows show data flow, not an unauthenticated path into the dashboard.*

The scope also got smaller. An earlier idea included an OpenClaw memory browser. I removed that from the deployed product: no files, memories, connectors, replay, or AI processing. This dashboard is metrics-only.

## Define the measurement before drawing the chart

The visitor estimate means **estimated daily unique browsers**, not people. After consent, the browser generates a cryptographically random first-party identifier. It rotates at UTC day boundaries and is never reused beyond 24 hours. There is no IP-plus-User-Agent fingerprint.

The collector HMACs that identifier with a random daily key and keeps a short-lived deduplication row. A PostgreSQL transaction increments the unique counter only when that day's pseudonym is new. Concurrent requests cannot both win the same uniqueness check.

One person on two devices can count twice. Returning tomorrow counts again. Multi-day totals sum daily browser estimates, not distinct monthly people. Clearing storage changes the estimate.

![Synthetic bar chart: each of two days has three views and two daily browsers. The totals are six views and four browser-days, not four distinct people.](/assets/blog/daily-browser-estimates.svg)

*Figure: an invented counting example, not production traffic. A/B/C are explanatory browser labels; the real system does not retain a cross-day identifier.*

For day `d`, `V(d)` is the count of accepted views and `U(d)` is the number of distinct daily HMAC pseudonyms. Over a range, the report adds `V(d)` for total views and `U(d)` for browser-days. Unidentified views contribute to views, not to the unique estimate.

If browser storage is unavailable, the system can count the consented pageview without an identifier and reports reduced unique coverage. It does not quietly substitute a fingerprint. Consent choices, blockers, bot filtering, and disabled JavaScript all affect coverage. These are partial observations, not a census.

I considered stock Umami, but the tagged implementation I examined derived session identifiers from IP and User-Agent. That did not fit this particular requirement. It is not a claim about every version or every analytics tool; it is why I chose a narrow custom collector. "Cookie-free" alone does not answer "how is identity inferred?"

## Collect less, and make exclusions executable

The tracker runs only on the public homepage and published blog pages. A build-generated page catalog supplies the allowed canonical paths.

Collection requires explicit opt-in, honors Do Not Track and Global Privacy Control, and provides withdrawal controls. Withdrawal stops future collection and clears the browser identifier; it cannot subtract a person's earlier contribution from already-aggregated counters.

The payload is intentionally boring. This is an illustrative shape, with a placeholder rather than a real browser identifier:

```json
{
  "page": "/blog/private-analytics-github-pages/",
  "referrer": "example.org",
  "visitor": "<random-daily-browser-id>"
}
```

Only `page`, `referrer`, and the optional `visitor` field are accepted. Actual identifiers must match the collector's validated format. Extra fields are rejected, not helpfully saved "for later."

No query strings, fragments, form inputs, terminal commands, BYOK secrets, private dashboard activity, or full referrer URLs enter the metrics store. Same-site and private-subdomain referrers are discarded. Network addresses are used transiently for abuse controls and optional coarse country lookup, never retained as visitor IDs. User-Agent is used transiently for best-effort bot filtering, not persisted.

The [privacy notice](/analytics-privacy.html) describes the boundaries. Self-hosting does not establish legal compliance; random identifiers still need careful handling.

## A public collector is not a trusted witness

The Go collector accepts only catalog-approved pages, allowed origins, bounded JSON, and known fields. It caps request bodies at 2 KiB, bounds concurrent work, applies transient rate limits, and enforces a transactional daily storage cap.

**CORS is not authentication**. A non-browser client can forge Origin and events. Limits reduce abuse, not prove human visits. The endpoint has no report or administration routes.

PostgreSQL stores daily totals and page, referrer, and country counters, not a raw event stream. The collector role has bounded data-manipulation permissions without schema ownership. The report role reads aggregate tables, not deduplication keys or pseudonyms.

Aggregates retain today plus the preceding 29 UTC days. Daily keys and dedup rows expire after the day boundary at the next hourly maintenance run, within a 48-hour ceiling. A persistent systemd timer handles retention even if collection stops. Collection also performs maintenance and stops if it fails.

Small country and referrer buckets below five views are hidden in reports. That is a presentation threshold, not deletion of the underlying counters.

There is one publishing detail worth remembering: the collector also needs an updated public-page catalog when new articles ship. Otherwise the tracker learns the new path from Pages, but the server correctly rejects it as unknown. Fail closed beats silently accepting arbitrary URLs.

## GitHub identity is not automatically owner authorization

The login flow uses GitHub authorization code exchange, S256 PKCE, state, and an exact callback URL. After fetching the authenticated identity, the backend compares its immutable provider ID with the configured owner allowlist. A mutable username is not the authorization key, and "first person to log in becomes admin" is not the enrollment plan.

The provider token is discarded after verification. Opaque server sessions use Secure, HttpOnly, host-only cookies, with 30-minute idle and eight-hour absolute expiry. Restarting the service revokes memory-only sessions.

![Owner login flow: state and S256 PKCE, GitHub authorization, exact callback and code exchange, immutable owner-ID check, then server session and authorization on every report. Nonowners receive 403; missing sessions receive 401.](/assets/blog/owner-auth-flow.svg)

*Figure: successful GitHub authentication is only the identity step. The owner check and per-request session checks are separate gates.*

Every report request checks authorization. Mutating POSTs require exact Origin and CSRF validation, and responses use `no-store`. Hiding the dashboard navigation is not a substitute for any of this.

Runtime identity settings and secrets stay outside the public repository and Pages artifact. The OAuth secret was entered through a hidden-input helper in a trusted terminal, not chat, command arguments, or Azure Run Command.

## The dashboard, and the latency number it actually measures

The UI has colored KPI cards, a traffic chart, ranked pages and referrers, country shares, and an interactive world map bundled locally. There are no external map tiles or tracking calls. Gray means no reportable data, not proof that nobody visited.

Countries currently remain **Unknown**: no approved licensed local GeoIP database is configured. The map supports country data; that is different from claiming geolocation is operational. The collector does not call an external IP lookup service.

The performance panels show average, p95, p99, errors, and sample count for authenticated metrics API server processing. They retain at most 2,048 operations in a rolling 15-minute in-memory window, excluding auth, static assets, session polling, and performance reads.

This is **not browser page-load telemetry, RUM, or Core Web Vitals**. It says something about my report backend, not how quickly your phone painted the blog. Empty windows show dashes; restarts reset the samples. Better an honest blank than a synthetic victory lap.

Percentiles use nearest rank: sort the `n` durations and select the one-based position `ceil(p * n)`, with `p = 0.95` for p95 or `0.99` for p99. With small samples those positions can coincide; always read the sample count beside the impressive-looking number.

## Deployment: the boring parts were the interesting parts

I reused the existing VM instead of provisioning another server. PostgreSQL stays private, with data on persistent storage. Nginx terminates HTTPS, certificate renewal is automated, and isolated systemd services receive configuration through credential mounts.

DNS work was limited to explicitly approved subdomain records, with readback and propagation checks. The apex and `www` records serving Pages stayed untouched. Existing loopback OpenClaw services were not repurposed or exposed.

Azure CLI SSH initially failed because usable VM authentication was absent. The alternative was authenticated VM Agent deployment for nonsecret operations, not an SSH authentication bypass.

A credential-permission mismatch also surfaced during rollout. The fix was compatible access through systemd's isolated credential mounts, not making runtime secrets broadly readable.

Identity, file permissions, proxy trust, persistence, and restart scope matter beyond the happy-path diagram.

## Verification without manufacturing traffic

Tests use synthetic events and mocked OAuth, separate from the real database. Coverage includes unauthorized API and asset access, wrong origins, private-page submissions, extra fields, concurrent deduplication, retention, and database privileges. The backend checks include Go race detection and vet; browser checks exercise consent and dashboard behavior.

At publication, DNS and HTTPS, runtime services and retention timers, database privileges, and the Pages deployment were verified. The production database was initialized empty, without demo fixture pollution. **Real owner-browser sign-in acceptance is still pending**; I am not claiming that final check passed or that real traffic has already been collected.

The initial deployment also has **no backups**, by my explicit choice. A VM or disk failure could lose all 30 retained days. That is accepted operational debt, not a production best practice. Encrypted aggregate-only backups with expiration and a tested restore are a next step, alongside owner-login acceptance and separately approved local GeoIP.

The result: a static website, bounded collector, and private aggregate reports. Enough instrumentation to find readers, without turning the multiverse into a surveillance side quest.

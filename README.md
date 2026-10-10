# nishad://multiverse

**One life. Many branches.** — the source behind [nishad.ai](https://nishad.ai).

A single-page, nerdy personal site by **Nishad Dawkhar** that frames a career/life as a
git commit graph: canonical timeline, alternate branches, a tongue-in-cheek "Gmail
Branching Hypothesis," an interactive shell, and an in-browser LLM you can talk to.

---

## Tech stack

- **Static site**: the homepage remains vanilla HTML/CSS/JS. A small Node build converts Markdown posts into HTML and copies the existing site to `_site/`.
- **Hosting**: GitHub Pages (`Nishad94/Nishad94.github.io`), served over HTTPS.
- **Custom domain**: `nishad.ai`, DNS managed at GoDaddy (apex `A` records → GitHub Pages,
  `www` `CNAME` → `nishad94.github.io`). The `CNAME` file in this repo pins the domain.
- **AI terminal**: self-hosted Gemma 4 26B-A4B Q4 served by llama.cpp on an
  isolated Azure ARM64 inference VM, with browser-local WebLLM/WebGPU fallback
  and an optional bring-your-own-key path to the OpenAI API.

The public site stays static. Optional AI and private analytics services are separate.

### Private website metrics

Canonical owner sign-in URL: **https://private.nishad.ai/dashboard_metrics**.
The public **https://nishad.ai/dashboard_metrics** entry is a launcher alias.

`dashboard/` is a separate Go service, not part of GitHub Pages. GitHub
owner-only authentication protects aggregate reports, charts and a locally
bundled world map. A narrow PostgreSQL collector measures consenting public
visitors without fingerprinting. There is no file browser, device connector or
OpenClaw integration. See [setup and privacy boundaries](dashboard/README.md).

Public integration is configured in `deployment.js`; empty values disable it.
`/dashboard_metrics` is only a public launcher that
redirects to the authenticated private backend; Pages itself cannot protect
that path. The homepage/blog tracker is opt-in, records approved public pages
only, and uses random daily browser IDs rather than fingerprints. See
`analytics-privacy.html` for collection, retention and withdrawal details.
No backend services, credentials or analytics data are copied to `_site/`.
The existing Pages workflow publishes only static integration; backend deployment
is separate. Initially countries are Unknown until local GeoIP is configured, and
the owner has accepted launching without backups.

---

## Technical blog: write Markdown, publish through GitHub

The blog lives at `/blog/` (`/blog` redirects there), with durable article URLs at
`/blog/<filename-without-md>/`. Home has a visible Blog link; the terminal's `blog`
command and command palette open it too. Posts render as complete HTML, including
their table of contents, heading anchors, and code highlighting, without JavaScript.
JavaScript only adds copy buttons. Articles have canonical/description/social metadata
and appear in `/sitemap.xml`; unknown or unpublished URLs return a custom 404.

### Write a post

1. Copy `posts/post-template.md` to `posts/your-stable-slug.md`.
2. Replace its metadata and body. Keep `draft: true` until ready.
3. Preview, then change `draft` to `false` and commit the Markdown file and any images.
   Once the one-time Pages setup below is done, merging/pushing to `master` builds and
   publishes automatically. There is no post index to maintain.

Metadata is **JSON between `---` lines**, not YAML. All five fields are required:

```markdown
---
{
  "title": "Your article title",
  "date": "2026-10-07",
  "description": "A short plain-text summary for the listing and search results.",
  "tags": ["engineering", "distributed systems"],
  "draft": true
}
---

Your introduction.

## First section

Your Markdown content.
```

- Filenames must use lowercase letters, numbers and single separating hyphens.
  **Keep published filenames stable**: renaming changes the permalink.
- `date` is a real `YYYY-MM-DD` calendar date, displayed in UTC; newest dates appear
  first, with slug order breaking ties. A future date does **not** schedule publication:
  `draft: false` publishes on the next deployment.
- The layout supplies the H1/title. Use `##` for sections and `###` for subsections.
  These appear in an accessible, collapsible table of contents with stable heading links.
- Supported: paragraphs, emphasis, quotes, ordered/unordered lists, inline code,
  fenced/indented code, links, images, and Markdown tables. Fences labeled `bash`,
  `javascript`/`js`, `typescript`/`ts`, `json`, or `python`/`py` get build-time
  highlighting; unknown languages remain safely escaped plain text with a label.
- Put images in `assets/blog/`, using descriptive alt text and root-relative paths,
  e.g. `![System architecture](/assets/blog/architecture.png)`. Link to other articles
  using `/blog/their-slug/`, not a relative Markdown filename.
- Raw HTML is displayed as text. Script/data/file URLs and protocol-relative links
  are not rendered as links/images. HTTPS, HTTP, mailto, local paths and fragments work.
- Drafts are validated but excluded from HTML, listing, sitemap and deployment artifact.
  **Drafts in this public Git repository are not private.** Never commit secrets.
- Missing fields, invalid dates, malformed JSON, empty bodies, or stray files inside
  `posts/` fail the build with a filename-specific error. An empty posts directory
  produces a genuine “No posts published yet” page.

The first article, **Build a Privacy-First OpenClaw Image Stream**, is the author's
supplied twelve-chapter tutorial. Its body and code are preserved as provided; the
original H1 is stored as the metadata title rather than duplicated in the article.
`post-template.md` remains unpublished.

### Preview and validate

Use Node 22+ and Python 3:

```bash
npm ci
npm run preview
# http://127.0.0.1:8000/blog/
# http://127.0.0.1:8000/blog/privacy-first-openclaw-image-stream/
```

Preview builds once, then serves `_site/`. After edits, stop and rerun it, or run
`npm run build` in a second terminal and refresh. Generated files are ignored by Git;
edit Markdown and source assets, not `_site/`.

```bash
npm run test:syntax
npm run test:blog
npm test
```

If Chromium is missing, run `npx playwright install chromium`. Tests render synthetic
Markdown only inside a temporary `.test-site/` (removed on teardown), exercise real
direct URLs and 404s, code copying and failure, mobile overflow, no-JS reading,
article chapter/code preservation, draft exclusion, malformed metadata and empty
states. The full suite also covers existing homepage/Spotify behavior with mocked
network requests; it makes no live paid API calls.

### GitHub Pages setup and deployment

This publishing workflow requires **GitHub Actions** as the Pages source. The
previous **Deploy from a branch**, `master`, `/` mode does not run the Node generator.
To configure or verify deployment:

1. In repository **Settings → Pages → Build and deployment → Source**, select
   **GitHub Actions**. Keep the custom domain **nishad.ai** and HTTPS settings unchanged.
2. Push or merge changes to `master`, or run **Build and publish Pages** from the
   Actions tab on `master`. Allow its `github-pages` environment deployment
   if repository protection rules require approval.
3. Confirm the workflow succeeds and check `/`, `/blog/`, the article permalink,
   and a nonexistent URL on `https://nishad.ai`.

`.github/workflows/pages.yml` installs locked dependencies with `npm ci` on Node 22,
checks syntax and unit tests, builds `_site/`, and uploads it to Pages. Pull requests
build but do not deploy; only `master` can deploy. The artifact includes `CNAME`,
`.nojekyll`, the existing homepage/Spotify public assets, generated blog and 404;
it excludes source Markdown, tests, development dependencies and Worker source.
There is **no DNS change**, backend, CMS or homepage framework migration.

The small build uses pinned `markdown-it` and `highlight.js` only at build time.
It is preferable here to browser-side Markdown because articles are readable,
linkable and indexable in their initial HTML and drafts are absent from the artifact.
The homepage's existing files are copied without transformation. Adding a new
public root file in future also requires adding it to `scripts/build-site.mjs`'s
explicit copy list.

## Features

### Interactive terminal
A faux zsh at the bottom of the page. Type `help` for the full list. Highlights:

| command | does |
| --- | --- |
| `help` | list commands |
| `conspiracy` / `gmail` | print the Gmail Branching Hypothesis |
| `whoami`, `pwd`, `ls`, `date`, `echo` | basic shell-ish stuff |
| `cat <file>` | read `README.md`, `about.txt`, `branches.txt`, `status.txt` |
| `git status` / `git branch` / `git log` | inspect the "life" repo |
| `timeline`, `branches`, `recruiter`, `linkedin`, `github` | jump around / open links |
| `blog` | open the technical blog |
| `roulette`, `chaos`, `toffee`, `palette` | trigger the multiverse controls |
| `spotify [connect\|status\|disconnect]` | optional Spotify login, consent, status, or local disconnect |
| `vibe [short\|medium\|long]` | top items and optional music personality, genre guesses, Music MBTI, tarot, shuffle roast |
| `spotify connect timeline` | reconnect with optional recent-play scope |
| `vibe timeline`, `vibe compare` | recent-play mood guesses, or past-vs-now samples and narration |
| `clear` / `history` / Ctrl+L | terminal housekeeping |
| ↑ / ↓ | command history |

Anything that isn't a known command is sent to the **AI** (see below).

### Multiverse controls
- **branch roulette** — generate a random alternate-timeline blurb.
- **chaos mode** — bump the visual entropy.
- **summon Toffee** — deploy the site's least-qualified SRE (a cat 🐈).
- **command palette** — `⌘K` / `Ctrl+K` fuzzy navigation.

### Self-hosted AI with a browser-local fallback
Keyless terminal questions go first to **Gemma 4 26B-A4B Q4**, hosted through a
narrow HTTPS gateway on a dedicated Azure ARM64 inference VM. The llama.cpp model
server and management ports stay loopback-only; the gateway validates origins and
request sizes, rate-limits use, and does not log prompts. If that host is unavailable,
the terminal lazy-loads **SmolLM2-360M-Instruct** through WebLLM and runs it entirely
inside the visitor's browser using WebGPU. Local fallback works best in current
Chrome/Edge on hardware with WebGPU.

The AI's knowledge (Nishad's career, projects, skills, lore, persona) lives in
**`ontology.js`** — a single, heavily-commented source of truth. `buildSystemPrompt()`
assembles it into the system prompt used by both the local and hosted models. To change
what the AI knows, edit `ontology.js`, not `index.html`.

### AI-powered fun modes
Beyond free-form questions, the terminal has playful modes that steer the model:

| command | does |
| --- | --- |
| `interview` | an eccentric recruiter interviews Nishad using his real history |
| `branch <topic>` | invents a detailed **fictional** alternate-timeline story |
| `roast` | an affectionate roast of the career choices |
| `hype` | over-the-top hype-man introduction |

### 🕹️ MULTIVERSE cheat code (bring-your-own-key)
A hidden GTA-style cheat upgrades the terminal to a hosted model:

1. Type **`MULTIVERSE`** in the terminal.
2. When prompted, paste your own **OpenAI API key** (`sk-...`).
3. The terminal switches to **`gpt-4o`** via the OpenAI API, streaming responses
   (prompt prefix becomes `nishad.ai✨>`).
4. Type **`lockdown`** (or `clearkey`) to wipe the key and return to self-hosted Gemma.

Gemma is the default on every page load. A remembered OpenAI key is activated only
after you explicitly type `MULTIVERSE` or `key` in that page session.

**Where your key lives:** only in your browser's `localStorage`. Requests go **directly**
from your browser to `api.openai.com` — the key is never sent to, or stored on, any server
(this is a static site; there is no server). The key is masked when you paste it.

### 💸 Live spend HUD
When hosted mode is active, a neon badge appears in the terminal's title bar:

- Shows a **running cost estimate** for this browser (e.g. `✨ multiverse · $0.0041`).
- A gradient bar fills toward a **soft session cap of $0.50** (mint → yellow → pink).
- After each reply, a `[usage] +N tok · $x · session $y / $0.50` line is printed.
- At the cap, further hosted queries are blocked until you `lockdown` or refresh.

**How it's computed:** the OpenAI stream is requested with
`stream_options.include_usage`, so the final chunk carries exact `prompt_tokens` /
`completion_tokens`. Cost = input × \$2.50/1M + output × \$10/1M (gpt-4o pricing).

**Caveats (read these):**
- It's an **estimate** based on returned token counts and current public prices.
- It only counts usage **from this browser/site** — not spend from anywhere else on the key.
- Client-side caps can be bypassed; the **real** safety net is an account-level budget
  limit in your OpenAI dashboard. Set one.

---

## Privacy & security

- The site is fully static; it has no application backend. Hosting providers receive normal HTTP requests.
- In BYOK mode, your API key stays in `localStorage` and is sent only to OpenAI.
- Spotify is opt-in. Its tokens use tab-scoped `sessionStorage`, not `localStorage`.
- Optional music reports require a separate per-request data/permission confirmation before music metadata goes to OpenAI; nothing goes to AI automatically. See [Spotify privacy & data flow](spotify-privacy.html).
- Never commit API keys to this (public) repo.

## Spotify POC: setup and policy prerequisite

**Not a claim of Spotify compliance.** Spotify's current [Developer Policy](https://developer.spotify.com/policy)
III.13 prohibits Spotify content analysis/derived user metrics/profiling; III.14 prohibits ingesting Spotify
content into any AI model (including local models, not just training). The requested standalone-POC feature
port carries the same contractual/deployment risk. **Resolve Spotify permission before compliant live use
of the analysis/AI features or deployment.** User consent alone does not override the terms. Browser tests
use synthetic fixtures only and make no real Spotify/AI calls.

### Dashboard setup (manual; not performed by this implementation)

Use the Spotify app with public client ID `34437fd629a749d9bbef6634ae012833`.
No client secret belongs in this repository or the browser.

1. In [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), register the exact redirect:
   `https://nishad.ai/spotify-callback.html`.
2. For local development also register `http://127.0.0.1:8000/spotify-callback.html`.
   Use `127.0.0.1`, not `localhost`; keep login and callback in the same tab and origin.
   The former Express POC callback `/callback` is **not** this static callback.
3. The app owner must have Premium. Add permitted accounts under **Users Management** before testing.
   Current [quota-mode docs](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
   specify up to **5 authenticated allowlisted users** in development mode. A successful OAuth login
   alone does not guarantee API access: an unallowlisted user can still receive 403.
   Check the dashboard for app-specific/legacy restrictions. This is not unrestricted public sign-in.
4. Serve this worktree with `python3 tests/serve.py 8000` and visit
   `http://127.0.0.1:8000/#music` in Chrome. The development server logs paths only, never OAuth query
   strings. No Node server/build is used by the deployed site; this is just a local static-file server.
5. Click **Connect Spotify**, then **Agree & continue to Spotify**, then approve Spotify consent.
   Return automatically to the music panel. Choose **Last 4 weeks**, **Last 6 months**, or **Last year**.
   No terminal typing is required; the `spotify` / `vibe` commands remain shortcuts.
6. Raw top items work without an AI key/WebGPU. For an authorized AI test, expand **Add or remove your
   OpenAI key**, enter your **own** key, and click **Save my key**. Review the exact music-data preview and separate permission/expense confirmation,
   then select **Generate AI report**. Each regeneration needs confirmation and incurs another request.
   The snark slider switches three already-generated roasts without additional calls.
7. **Enable recent-play access** adds `user-read-recently-played`; then choose **Mood timeline**.
   **Past vs now** compares long- and short-term top-artist samples.
8. **Disconnect Spotify** clears this tab's tokens, pending login, displayed data/reports and cancels
   in-flight Spotify/AI work. It does not clear your independent BYOK key (`lockdown` does).
   **Remove AI key** provides the same key-removal action without terminal typing.
   Revoke the account-level grant at [Spotify Apps](https://www.spotify.com/account/apps/);
   disconnect other open/copied tabs separately. Already-sent AI prompts cannot be recalled.

### Behavior and limitations

- PKCE S256 uses Web Crypto, a 64-byte random verifier and 32-byte random state. Pending attempts expire
  after 10 minutes and are consumed once on callback, including denial/mismatch. The callback scrubs
  its query before loading its module, sends no referrer, and returns a nonsecret range hash only.
  The original callback request still necessarily reaches the static host with code/state in its URL.
- Tokens stay in `sessionStorage` to survive reload; browser session restoration/duplicated tabs may
  preserve them. Access expiry triggers one refresh on demand, honoring refresh-token rotation.
  There is no polling, automatic error retry, audio-features probe, or artist-enrichment request.
  A 429 cooldown honors `Retry-After` (60 seconds if absent/unreadable) across reload/disconnect in that
  tab; it contains no user data. Other errors have actionable messages.
- Only `user-top-read` is requested by default. The timeline alone asks for the additional recent-play
  scope. Top endpoints request up to 50 items, showing at most 20 per list with Spotify attribution/links.
  Timeline inference uses up to 20 recent plays; this is not a complete listening history.
- `short` is approximately 4 weeks, `medium` 6 months, `long` approximately one year including new data,
  **not all-time**. Comparison ranges overlap; sample absence is not proof of stopped listening.
- [February 2026 endpoint changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
  retain top items/recent plays but remove several endpoints and popularity fields for development apps.
  Missing genres/audio features/popularity are not treated as real measurements. AI genres are clearly
  guesses; MBTI axes, tarot, basic-vs-niche scores, and personality are fictional entertainment, not real
  psychology. Timeline guesses describe song vibes, not a listener's actual mood.
- AI is direct-browser **gpt-4o BYOK**, sharing the existing pricing, spend ledger/HUD, and $0.50 soft cap.
  A conservative preflight estimate leaves room for a 2,600-output-token response; exact returned usage
  is charged even for invalid/truncated reports. Missing usage is conservatively estimated. Aborted,
  timed-out, or unreadable responses can incur unreported charges; use OpenAI account-level budgets.
  No owner key, server secret, token, ID, or play timestamp is inserted into an AI prompt.
- The 360M local model's 2,048-token context is not adequate for reliable full structured reports, so
  music reports explicitly require BYOK instead of silently falling back or inventing output. The
  site's pre-existing local AI and hosted fun commands are unchanged.
- Production redirect registration, real OAuth eligibility, and live model output are manual checks.
  No DNS change is needed. This implementation does not push, deploy, or open a PR.

### Verification

The site remains dependency-free at runtime. Node dependencies support the **blog build and tests**:

```bash
npm ci
npx playwright install chromium
npm run test:syntax
npm test
```

Playwright serves a separate loopback test port, blocks external requests except explicitly mocked
endpoints, and uses synthetic Spotify/OpenAI fixtures. It covers PKCE/callback errors, token refresh,
Spotify API errors/cooldown, safe metadata rendering, optional scopes, AI consent/output failures/cost,
the full report controls, and existing terminal/local-failure/BYOK/palette behavior. No live credentials
or paid requests are needed.

The unmodified white Spotify logo in `assets/spotify-logo-white.svg` is from Spotify's official
[2024 full-logo asset pack](https://developer.spotify.com/images/guidelines/design/2024-spotify-full-logo.zip),
used under its [branding guidelines](https://developer.spotify.com/documentation/design).

## For contributors & AI agents

See **`AGENTS.md`** for a full guide: file map, how the two AI backends work, how to
update the ontology, the spend-HUD internals, and the deploy flow.

## Run locally

```bash
git clone https://github.com/Nishad94/Nishad94.github.io.git
cd Nishad94.github.io
npm ci
npm run preview             # → http://127.0.0.1:8000
```

Serve over `http://` (not `file://`) so the `ontology.js` ES-module import resolves.
WebGPU features need a Chromium-based browser with WebGPU enabled.

## Deploy

After the one-time **GitHub Actions** Pages setup above, push to `master`; the Pages
workflow builds `_site/` and publishes it at `https://nishad.ai`. Serving the repository
root directly still works for homepage-only development, but will not generate the blog.

---

*main is protected · force push disabled · built with HTML/CSS/JS and questionable 5 AM lore.*
## Legacy OpenAI proxy rollback path

`worker/ai-proxy.js` is retained as a tested rollback artifact. It forwards prompts
to OpenAI gpt-4o using a Worker secret and enforces an origin allowlist, 32 KB body
limit, fixed token limits, and per-IP/global daily limits. It is not the active
terminal backend; `AI_PROXY_DEFAULT` points to the self-hosted Gemma gateway.

Setup (manual, not done by this repo):

```bash
cd worker
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```

To reactivate this rollback path, replace `AI_PROXY_DEFAULT` with the Worker URL and
restore its production origin allowlist. For local testing, set
`localStorage.nishad_ai_proxy` to a mock/development URL. Tests:
`node --test tests/ai-proxy.test.mjs` (mocked upstream; no live key).

This does not change the Spotify Developer Policy III.13/III.14 position: an owner-run server sending other users' Spotify data to an AI model is a larger contractual exposure than a private BYOK test. Obtain Spotify's permission before enabling it for public visitors.

The legacy Worker may remain deployed for rollback, but the production terminal does
not point at it. On loopback, `localStorage.nishad_ai_proxy = 'off'` forces BYOK/local
mode for tests; a temporary HTTP(S) URL can select a mock or development gateway.

## Layout

The site has six tabs (Home, Story, Lore, Music, Work, Terminal) with a hash router, a mobile bottom bar, a daily branch and a visit streak. Existing `#section` links still work.

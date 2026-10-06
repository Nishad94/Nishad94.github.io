# AGENTS.md — a guide for AI agents & contributors

This document explains how `nishad://multiverse` (the site at **nishad.ai**) is
built so that AI agents and human contributors can work on it safely and quickly.

## TL;DR

- Static site, **no backend**. The homepage stays buildless; `npm run build`
  copies public files and generates blog HTML from Markdown into `_site/`.
- To change **what the AI knows/says**, edit **`ontology.js`** (not `index.html`).
- To change **UI/behavior**, edit the inline `<script type="module">` in `index.html`.
- Deploy = commit + push to `master` after the one-time Pages source switch to
  **GitHub Actions** documented in README. Do not deploy without user authorization.

## Layout

`index.html` is tabbed: Home, Story, Lore, Music, Work, Terminal (`.view[data-view]`, `.tab[data-view]`).
A hash router shows one view at a time; old anchors (`#music`, `#shell`, `#timeline`, ...) still resolve.
Use `window.history` (a local `history` variable shadows the global). Tests must reveal the right view first.

## File map

| file | purpose |
| --- | --- |
| `index.html` | The entire UI + terminal + AI wiring (HTML, CSS, JS all inline). |
| `ontology.js` | **Single source of truth** about Nishad: profile, career, education, skills, projects, awards, fictional branches, lore, persona, and `buildSystemPrompt()`. |
| `README.md` | Human-facing overview and feature docs. |
| `AGENTS.md` | This file. |
| `CNAME` | Pins the custom domain `nishad.ai` for GitHub Pages. |
| `posts/*.md` | Technical articles: JSON frontmatter (`title`, `date`, `description`, `tags`, `draft`) between `---` lines. Filename is the stable slug. |
| `scripts/build-site.mjs` | Validates posts, safely renders Markdown/highlighting/TOC, generates listing, permalinks, 404 and sitemap, copies public files. |
| `blog/blog.css`, `blog/blog.js` | Scoped reading styles and progressive copy controls. No runtime Markdown dependency. |
| `.github/workflows/pages.yml` | Reproducible Node 22 build; PRs validate, master deploys `_site/` to Pages. |
| `spotify.js` | Browser-only PKCE, tab-scoped tokens/refresh, top items/recent plays, safe Spotify links. |
| `spotify-ui.js` | Spotify terminal views, explicit AI consent, strict report validation, music reports. |
| `spotify-callback.html` | Same-origin one-shot OAuth callback; cleans URL before importing code. |
| `spotify-privacy.html` | User-facing data flow, storage, disconnect, and policy prerequisites. |
| `assets/spotify-logo-white.svg` | Unmodified official Spotify attribution logo. |
| `tests/`, `playwright.config.js`, `package.json` | Build/test tooling; no Node code or dependency is shipped to the browser. |

## How the AI works

There are **two** interchangeable model backends behind the terminal:

1. **Local (default, keyless):** `SmolLM2-360M-Instruct` via **WebLLM + WebGPU**,
   loaded lazily from a CDN on the first AI query. Runs fully in the browser.
   Context window is small (2048), so keep the system prompt reasonably tight.
2. **Hosted (BYOK, opt-in):** OpenAI `gpt-4o` via the Chat Completions API,
   unlocked by typing the cheat code **`MULTIVERSE`** and pasting an `sk-...` key.
   The key is stored only in `localStorage` and sent directly to OpenAI.

Both backends are fed the **same system prompt**, produced by
`buildSystemPrompt()` in `ontology.js`. The prompt = `PERSONA` + structured facts.

### Key functions in `index.html`

- `buildSystemPrompt()` (imported from `ontology.js`) → the system prompt string.
- `askAI(query, extra?)` → routes to hosted or local; `extra` is an optional mode
  instruction appended to the system prompt (used by the fun commands).
- `hostedAskAI(query, extra?)` → streams from OpenAI, requests
  `stream_options.include_usage`, and records spend.
- `ensureEngine()` → lazy-loads/initializes the local WebLLM engine.
- `run(raw)` → the terminal command dispatcher (big `switch`).

## Updating what the AI knows

Edit the exported data objects in `ontology.js`:

- `PROFILE`, `CAREER`, `EDUCATION`, `SKILLS`, `PROJECTS`, `AWARDS` — **real facts**.
  Keep them accurate (sourced from résumé/LinkedIn).
- `BRANCHES` — **fictional** what-if timelines. Always clearly fiction; the persona
  is instructed never to present them as real.
- `LORE`, `PERSONA` — tone, jokes, and voice.

`buildSystemPrompt()` will automatically fold your changes into the prompt. No
other edits needed.

**Privacy rule:** do NOT add Nishad's phone number. Email is intentionally public
(owner consent). Don't add other people's private data.

## Terminal commands

Deterministic (no model): `help`, `conspiracy`/`gmail`, `whoami`, `pwd`, `ls`,
`cat <file>`, `git status|branch|log`, `timeline`, `branches`, `recruiter`,
`linkedin`, `github`, `blog`, `open`, `echo`, `date`, `history`, `clear`, `sudo`, `rm`,
`ssh`, `roulette`, `chaos`, `toffee`, `palette`, `matrix`, `exit`/`logout`.

BYOK: `multiverse` (unlock), `lockdown`/`clearkey` (exit + reset spend).

AI-powered "fun modes" (call `askAI` with a mode instruction):
- `interview` — eccentric recruiter interviews Nishad.
- `branch <topic>` — invents a detailed fictional alternate timeline.
- `roast` — affectionate roast.
- `hype` — over-the-top hype-man.

Anything else typed is sent to the AI as a free-form prompt.

## Spotify POC

`spotify [connect|status|disconnect]`, `spotify connect timeline`, and
`vibe [short|medium|long|timeline|compare]` live in separate modules. The shared
BYOK adapter in `index.html` uses the existing gpt-4o pricing/spend HUD; it never
mixes Spotify metadata into the ontology or existing general-chat prompts.
Each music AI request requires an explicit data-flow/permission confirmation;
no local-model fallback or automatic AI processing. No client secret or owner
OpenAI key. Default scope is `user-top-read`; only timeline asks for
`user-read-recently-played`. Do not add audio-features/genre-enrichment probes.

**Deployment prerequisite:** Spotify Developer Policy III.13/14 prohibits
content analysis/user profiles and AI ingestion. This requested experimental
POC port is not asserted compliant. Resolve Spotify permission before compliant
live analysis/AI use or deployment; consent alone is not an exemption. Tests
must use synthetic fixtures, not real Spotify-to-AI calls. Keep these notices
in both UI and docs. All personality/MBTI/tarot/scores/mood labels are entertainment,
not real psychology or measured popularity. See README for dashboard setup.

Run `npm run test:syntax` and `npm test` after changes (test-only Playwright).
For local OAuth use `python3 tests/serve.py 8000`; it logs no query strings.
Register `http://127.0.0.1:8000/spotify-callback.html`, not localhost. Production
uses `https://nishad.ai/spotify-callback.html`; registration is manual.

## Spend HUD & cost safety (hosted mode)

- Pricing constants: `PRICE_IN` / `PRICE_OUT` (gpt-4o) and `SPEND_CAP` (USD).
  If you change `HOSTED_MODEL`, update these to match that model's pricing.
- Exact usage comes from the stream's final `usage` chunk; cost is accumulated in
  `spendTotal` and persisted in `localStorage` (`nishad_hosted_spend`).
- The HUD (`#spend-hud`) shows the running total + a bar toward `SPEND_CAP`.
- At the cap, hosted queries are blocked until `lockdown` or refresh.
- **Note:** client-side caps are best-effort. The real protection is an
  account-level budget limit in the OpenAI dashboard.

## Local dev & deploy

```bash
# build and serve locally (Node 22+, Python 3; not file://)
npm ci
npm run preview              # → http://127.0.0.1:8000

# deploy
git add -A && git commit -m "..." && git push origin master
```

GitHub Pages Actions auto-rebuilds on push after manual source setup. Verify live with a cache-busting fetch, e.g.
`curl -s "https://nishad.ai/?v=$(date +%s)" | grep something`.

## Conventions

- Keep the homepage buildless and runtime dependency-free. Blog build dependencies
  are pinned/locked; do not migrate the homepage to a framework.
- Author posts in `posts/`; never hand-edit `_site/` or maintain a separate index.
  Drafts must not ship. Validate even drafts; malformed metadata fails the build.
  The public repository itself is not private storage for drafts or secrets.
- Preserve supplied article prose/code; layout supplies the H1. Add public assets
  to the build copy list if they are outside `assets/`.
- Prefer editing `ontology.js` for content; keep `index.html` for behavior/UI.
- Run a JS syntax check before pushing:
  `node --check ontology.js` and extract+check the inline script.
- Match the existing neon/terminal aesthetic (CSS custom props: `--mint`,
  `--yellow`, `--pink`, `--purple`).
## AI proxy

`worker/ai-proxy.js` (Cloudflare Worker) is an optional owner-funded gpt-4o proxy; `AI_PROXY_DEFAULT` in `index.html` enables it (empty = BYOK). Never put the OpenAI key in client code; it is a Worker secret. Keep the message/size validation and limits when editing. Tests: `npm test`.

## Private metrics dashboard and analytics

`dashboard/` is an isolated Go module, not a Pages backend. It provides GitHub
immutable-owner authorization, server sessions, a separate PostgreSQL collector
and private aggregate reports. File browsing, connectors and OpenClaw integration
are explicitly out of scope. See `dashboard/README.md`.

Keep real runtime configuration, credentials, owner IDs, host details and all
private data outside the repository and Pages output. Only synthetic
fixtures belong in tests. Do not scan host roots, provision services, publish
integration or deploy without explicit authorization.

`deployment.js` contains only approved public URLs; empty values disable integration.
`analytics.js` tracks only catalog-approved public pages after consent, honors
DNT/GPC, drops queries/fragments/private referrers, and uses random daily IDs,
never device fingerprints. Do not add the tracker to private views, callbacks,
404s or the metrics launcher. Never connect it to the AI/Spotify modules.
The generated `/dashboard_metrics` entry is a redirect, not authentication.

Validate with `npm run test:syntax`, `npm test`, and
`cd dashboard && go test -race ./... && go vet ./...`.
The Go tests start and stop a synthetic temporary PostgreSQL instance.

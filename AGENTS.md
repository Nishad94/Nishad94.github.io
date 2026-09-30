# AGENTS.md — a guide for AI agents & contributors

This document explains how `nishad://multiverse` (the site at **nishad.ai**) is
built so that AI agents and human contributors can work on it safely and quickly.

## TL;DR

- Static site, **no build step, no backend**. Just `index.html` + `ontology.js`,
  served by GitHub Pages at `nishad.ai`.
- To change **what the AI knows/says**, edit **`ontology.js`** (not `index.html`).
- To change **UI/behavior**, edit the inline `<script type="module">` in `index.html`.
- Deploy = commit + push to `master`. Pages rebuilds automatically.

## File map

| file | purpose |
| --- | --- |
| `index.html` | The entire UI + terminal + AI wiring (HTML, CSS, JS all inline). |
| `ontology.js` | **Single source of truth** about Nishad: profile, career, education, skills, projects, awards, fictional branches, lore, persona, and `buildSystemPrompt()`. |
| `README.md` | Human-facing overview and feature docs. |
| `AGENTS.md` | This file. |
| `CNAME` | Pins the custom domain `nishad.ai` for GitHub Pages. |

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
`linkedin`, `github`, `open`, `echo`, `date`, `history`, `clear`, `sudo`, `rm`,
`ssh`, `roulette`, `chaos`, `toffee`, `palette`, `matrix`, `exit`/`logout`.

BYOK: `multiverse` (unlock), `lockdown`/`clearkey` (exit + reset spend).

AI-powered "fun modes" (call `askAI` with a mode instruction):
- `interview` — eccentric recruiter interviews Nishad.
- `branch <topic>` — invents a detailed fictional alternate timeline.
- `roast` — affectionate roast.
- `hype` — over-the-top hype-man.

Anything else typed is sent to the AI as a free-form prompt.

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
# serve locally (module imports need http://, not file://)
python3 -m http.server 8000   # → http://localhost:8000

# deploy
git add -A && git commit -m "..." && git push origin master
```

GitHub Pages auto-rebuilds on push. Verify live with a cache-busting fetch, e.g.
`curl -s "https://nishad.ai/?v=$(date +%s)" | grep something`.

## Conventions

- Keep everything dependency-free and buildless.
- Prefer editing `ontology.js` for content; keep `index.html` for behavior/UI.
- Run a JS syntax check before pushing:
  `node --check ontology.js` and extract+check the inline script.
- Match the existing neon/terminal aesthetic (CSS custom props: `--mint`,
  `--yellow`, `--pink`, `--purple`).
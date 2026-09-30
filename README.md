# nishad://multiverse

**One life. Many branches.** — the source behind [nishad.ai](https://nishad.ai).

A single-page, nerdy personal site by **Nishad Dawkhar** that frames a career/life as a
git commit graph: canonical timeline, alternate branches, a tongue-in-cheek "Gmail
Branching Hypothesis," an interactive shell, and an in-browser LLM you can talk to.

---

## Tech stack

- **Static site**: a single `index.html` (HTML + CSS + vanilla JS, no build step).
- **Hosting**: GitHub Pages (`Nishad94/Nishad94.github.io`), served over HTTPS.
- **Custom domain**: `nishad.ai`, DNS managed at GoDaddy (apex `A` records → GitHub Pages,
  `www` `CNAME` → `nishad94.github.io`). The `CNAME` file in this repo pins the domain.
- **In-browser AI**: [WebLLM](https://github.com/mlc-ai/web-llm) + WebGPU (local model),
  with an optional bring-your-own-key path to the OpenAI API.

No server, no backend, no database — everything runs in the visitor's browser.

---

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
| `roulette`, `chaos`, `toffee`, `palette` | trigger the multiverse controls |
| `clear` / `history` / Ctrl+L | terminal housekeeping |
| ↑ / ↓ | command history |

Anything that isn't a known command is sent to the **AI** (see below).

### Multiverse controls
- **branch roulette** — generate a random alternate-timeline blurb.
- **chaos mode** — bump the visual entropy.
- **summon Toffee** — deploy the site's least-qualified SRE (a cat 🐈).
- **command palette** — `⌘K` / `Ctrl+K` fuzzy navigation.

### Local AI (default, keyless)
The first time you ask a question, the site lazy-loads
**SmolLM2-360M-Instruct** via WebLLM and runs it **entirely in your browser** using WebGPU.
No API key, no server, nothing leaves your machine. Works best in current Chrome/Edge on
hardware with WebGPU.

### 🕹️ MULTIVERSE cheat code (bring-your-own-key)
A hidden GTA-style cheat upgrades the terminal to a hosted model:

1. Type **`MULTIVERSE`** in the terminal.
2. When prompted, paste your own **OpenAI API key** (`sk-...`).
3. The terminal switches to **`gpt-4o-mini`** via the OpenAI API, streaming responses
   (prompt prefix becomes `nishad.ai✨>`).
4. Type **`lockdown`** (or `clearkey`) to wipe the key and revert to the local model.

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
`completion_tokens`. Cost = input × \$0.15/1M + output × \$0.60/1M (gpt-4o-mini pricing).

**Caveats (read these):**
- It's an **estimate** based on returned token counts and current public prices.
- It only counts usage **from this browser/site** — not spend from anywhere else on the key.
- Client-side caps can be bypassed; the **real** safety net is an account-level budget
  limit in your OpenAI dashboard. Set one.

---

## Privacy & security

- The site is fully static; it has no backend and collects nothing.
- In BYOK mode, your API key stays in `localStorage` and is sent only to OpenAI.
- Never commit API keys to this (public) repo.

## Run locally

```bash
git clone https://github.com/Nishad94/Nishad94.github.io.git
cd Nishad94.github.io
open index.html      # or: python3 -m http.server 8000  → http://localhost:8000
```

WebGPU features need a Chromium-based browser with WebGPU enabled.

## Deploy

Push to `master`; GitHub Pages rebuilds automatically and serves at
`https://nishad.ai`.

---

*main is protected · force push disabled · built with HTML/CSS/JS and questionable 5 AM lore.*
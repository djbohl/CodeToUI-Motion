# CodeToUI Playground — project rules

A local tool: write HTML/CSS with a live preview, build multiple screens, and
wire up no-code click-through prototypes. The project is **plain files on disk**;
the app is a preview/editor/prototyping surface over them and must always
reflect disk truth, regardless of who edited the files (built-in editor, Claude
Code, Codex CLI, any text editor).

## Private documents (IMPORTANT)

- Personal/planning docs are **named in ALL-CAPS** at the repo root (e.g.
  `PLAN.md`, `COLLABORATION.md`) and are **git-ignored — never commit or push
  them to the public GitHub repo**.
- When creating a new personal/planning/notes doc, use an ALL-CAPS name and add
  it to `.gitignore` in the same change.
- Regular project docs (README, this file, wiki pages) use normal naming and
  are fine to commit.

## Repos

- Main code repo: committed normally; pushed to GitHub (public).
- **Wiki** lives in a separate repo
  (`github.com/djbohl/CodeToUI-Playground.wiki.git`); its pages are in `wiki/`,
  which is git-ignored by the main repo.

## Commits

- Conventional-commit style (`feat(scope): …`, `fix: …`, `docs: …`, `chore: …`).
- Commit in small, logical batches; don't bundle unrelated changes.
- End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Only commit/push when asked.

## Architecture (orient here first)

- `server/create-api.js` — the shared backend (watcher + WebSocket + REST API),
  mounted by BOTH the Vite dev plugin (`server/plugin.js`) and the Electron app
  (`electron/main.js`). Keep them using this one factory so dev and desktop
  can't drift.
- `server/watcher.js` — chokidar + hash-based echo detection (distinguishes the
  app's own writes from genuine external edits). Load-bearing; be careful.
- `server/projects.js` / `server/screens.js` — projects root + screen CRUD.
- `server/stable-ids.js` — injects `data-proto-id` on save so links survive HTML
  edits; ids are never regenerated.
- Preview is a sandboxed `<iframe>` (NOT same-origin); all parent↔iframe comms
  use `postMessage`. Never assume direct DOM access into the preview iframe.
- Client: `src/main.js` (wiring), `src/editor-sync.js`, `src/pet.js`,
  `src/color-picker.js`, `src/export.js`.
- `links.json` schema: `{ id, screen, elementId, target, mode, transition }`;
  `target` may be a screen name or `$back` / `$home`.

## Conventions

- The assistant generally **can't run the dev server** in its sandbox (TCP
  listen is blocked); the user runs `npm run dev` and reports behavior. Prefer
  fixes you can reason about + any logic testable in plain Node.
- Don't add heavy dependencies (e.g. Puppeteer, ffmpeg) without discussing
  first — they're gated behind an explicit decision.
- Match existing code style; keep comments at the altitude of the surrounding
  code.

## Known / accepted advisories

A default `npm install` should be clean. The desktop-packaging tools (Electron +
electron-builder) are **opt-in** — installed via `npm run app:setup`
(`--no-save`), NOT listed in devDependencies — because they carry build-time-only
advisories and deprecations (`inflight`, `glob@7`, `rimraf@2`, `boolean`,
`minimatch`). Those only matter during `npm run app:build` (packaging) — never
in `npm run dev`, never in the app, never shipped. Don't add Electron/
electron-builder back to devDependencies, and don't force overrides on their
transitives (glob/rimraf major bumps break the installer build). Electron also
re-accrues advisories after each release; that's normal. Prod deps (chokidar,
connect, serve-static, parse5, ws) are kept clean.

## Scope decisions

- **React screens are planned** (per-screen Vanilla ⇄ React toggle). A React
  screen is a single JSX component file + CSS (JSX replaces HTML). Bundle
  React + ReactDOM + Babel locally (offline-safe), compile JSX in the preview
  live and pre-compile for export. Insert tools adapt to the active file type
  (HTML snippets vs JSX snippets). Link/Play prototyping is Vanilla-only for now
  (links need data-proto-id in parsed HTML; JSX isn't parsed that way).
- No other frameworks (Vue/Svelte/etc.) and **no native (Swift)** — can't
  render in an HTML iframe.
- **No video export in the main app** (needs ffmpeg/WASM). Real video is the
  separate "CodeToPrototype" companion tool. In-app, only GIF (pure-JS).

## Product values

- **Pets are rehomed, not discarded.** Never use delete/discard language for the
  pixel pet — replacing one is "going to a new home."

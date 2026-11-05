# CodeToUI Motion

Turn a [CodeToUI Playground](https://github.com/djbohl/CodeToUI-Playground) prototype into
a **demo video** (MP4/WebM). A timeline of clips you scrub and play, with visible
transitions, timed captions, and — because each screen's own CSS/JS runs during playback —
any motion you coded in CodeToUI just plays. Video lives here, in a separate tool, so the
main app's install stays light.

(The package/repo is `codetoprototype`; the app is branded **CodeToUI Motion**.)

## Install

```bash
npm install
```

This pulls `puppeteer` (bundled Chromium) and `ffmpeg-static` (bundled encoder). No system
ffmpeg needed, though a system `ffmpeg` on PATH is used as a fallback if the bundled binary
is missing.

## The editor (web app)

A local web UI over the engine. It reads **CodeToUI's own projects folder** (shared disk
truth — no export step), so point it there and open the project:

```bash
# C2P_PROJECTS_ROOT = your CodeToUI projects folder (abs path or relative to cwd)
C2P_PROJECTS_ROOT=../code-design/projects npm run dev
# then open http://localhost:5900/?project=Demo
```

- **Timeline** (bottom) — clips in sequence; drag a clip to reorder, drag its right edge
  to retime, click to select, click the ruler to scrub. A playhead tracks playback.
- **Screens palette** (left) — click a screen to add it as a clip.
- **Preview** (center) — plays the demo you're composing (▶ / ⏸, scrub). This is *not* an
  interactive click-through — CodeToUI already does that.
- **Inspector** (right) — the selected clip's screen, duration, transition-in, and captions.
- **Seed from flow** — (re)build the timeline from the prototype's click-flow.
- **Export** — render the demo to MP4/WebM (headless Chromium + ffmpeg) and download it.

Edits autosave to **`proto.demo.json`** inside the project folder (disk truth).

### Launch from CodeToUI (ready-to-apply hook)

CodeToUI reserves a disabled **Video** button in its Export modal (`index.html`, "in the
CodeToPrototype companion tool"). To wire it, in the CodeToUI repo give that button an id
and remove `disabled`, then add a handler — no IPC/preload needed:

```js
// CodeToUI src/main.js — after the active project is known (activeProject)
videoBtn.addEventListener("click", () => {
  window.open("http://localhost:5900/?project=" + encodeURIComponent(activeProject), "_blank");
});
```

(Run CodeToUI Motion with `C2P_PROJECTS_ROOT` pointed at the same projects folder.)

## CLI

The demo document (`proto.demo.json`) is the editable/AI-friendly artifact — the same one
the editor reads/writes. Seed it from the click-flow, tweak, render:

```bash
npx codetoprototype seed   ../code-design/projects/Demo --out demo.json
# edit demo.json (clips, durations, transitions, captions) ...
npx codetoprototype render ../code-design/projects/Demo --demo demo.json --out demo.mp4
```

`render` with no `--demo` uses the project's saved `proto.demo.json`, or a fresh seed.
Flags: `--format mp4|webm`, `--fps`, `--scale`, `--keep-frames`.

Demo document shape:

```json
{ "version": 1, "fps": 30, "size": { "width": 390, "height": 844 },
  "clips": [
    { "id": "c1", "type": "screen", "screen": "Login", "duration": 2000,
      "transitionIn": { "type": "instant", "duration": 0 },
      "captions": [ { "text": "Sign in", "at": 300, "for": 1200 } ] },
    { "id": "c2", "type": "screen", "screen": "Home", "duration": 2000,
      "transitionIn": { "type": "slide-up", "duration": 400 }, "captions": [] }
  ] }
```

## How it works

- `src/load-project.js` — reads a project folder or parses an exported `.html` into a model.
- `src/compose-screen.js` — shared screen → srcdoc composer (runs each screen's CSS/JS).
- `src/demo.js` — the `proto.demo.json` model: seed-from-flow, validate, normalize.
- `src/demo-renderer.js` — the keystone: a page that plays the timeline on a clock
  (transitions + captions as functions of time), exposing `window.__demo`. Powers both the
  live preview and the headless export.
- `src/capture.js` — `captureDemo` steps the renderer frame-by-frame in headless Chromium.
- `src/encode.js` — ffmpeg frames → MP4/WebM.
- `src/cli.js` — the `seed` / `render` commands.
- `server/create-video-api.js` — the web backend factory (one shared `{ middleware, close }`,
  mirroring CodeToUI's `create-api.js`), mounted by `server/plugin.js` (Vite dev plugin).
- `src/ui/` — the browser editor (timeline, preview, inspector) in CodeToUI's visual style.

Planned next: per-element animation (presets + custom CSS/JS) and blank-canvas clips (M2),
then music + voiceover (M3).

## Credits

The navigation player and project/links schema are adapted from CodeToUI Playground.

## License

Licensed under **Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0)**.
You're free to use, share, and adapt it for **non-commercial** purposes, with
attribution. See [LICENSE](./LICENSE).

# CodeToPrototype

Turn a [CodeToUI Playground](https://github.com/djbohl/CodeToUI-Playground) click-through
prototype into a **walkthrough video** (MP4/WebM), with light editing — trim, speed, and
captions. Video lives here, in a separate tool, so the main app's install stays light.

It takes a prototype — either a `projects/<name>/` folder **or** an exported standalone
`.html` — replays its click-through navigation headlessly (driving real clicks with a
synthetic cursor), records frames, and encodes them with a bundled ffmpeg.

## Install

```bash
npm install
```

This pulls `puppeteer` (bundled Chromium) and `ffmpeg-static` (bundled encoder). No system
ffmpeg needed, though a system `ffmpeg` on PATH is used as a fallback if the bundled binary
is missing.

## Usage

### Render a video (auto-walk)

With no script, the tool auto-walks the prototype's link graph from its start screen:

```bash
# from a project folder
npx codetoprototype render ../code-design/projects/Demo --out demo.mp4

# from an exported standalone .html
npx codetoprototype render ./my-prototype.html --out demo.mp4 --fps 30 --dwell 1500
```

Common flags: `--format mp4|webm` (default `mp4`), `--fps`, `--dwell` (ms held per screen),
`--width` (device width px), `--scale` (device scale factor), `--no-cursor`.

### Edit per-step with a walkthrough script

Generate the auto-walk as an editable JSON script, tweak it, then render from it:

```bash
npx codetoprototype plan ../code-design/projects/Demo --out walkthrough.json
# edit walkthrough.json ...
npx codetoprototype render ../code-design/projects/Demo --script walkthrough.json --out demo.mp4
```

The script is the editable/AI-friendly artifact — a plain step list:

```json
{
  "fps": 30,
  "format": "mp4",
  "steps": [
    { "screen": "Login", "dwell": 1200 },
    { "screen": "Login", "click": "el-4fb756", "transition": "slide-up",
      "caption": { "text": "Tap to sign in", "at": 400, "for": 800 } },
    { "screen": "Home", "dwell": 1500, "speed": 1.5 }
  ]
}
```

- **trim** — reorder/remove steps, or change a step's `dwell`
- **speed** — per-step `speed` multiplier (`1.5` = 1.5× faster)
- **captions** — per-step `caption` `{ text, at, for }` in ms relative to the step

## Web app (form-based editor)

A local web UI over the same engine — edit the walkthrough as a form, click-to-play
preview the prototype, and render. It reads **CodeToUI's own projects folder** (shared
disk truth, no export step), so point it there:

```bash
# C2P_PROJECTS_ROOT = your CodeToUI projects folder (abs path or relative to cwd)
C2P_PROJECTS_ROOT=../code-design/projects npm run dev
# then open http://localhost:5900/?project=Demo
```

- **Project picker** — switch between projects in that folder.
- **Step editor** — each walkthrough step is a row: the move (a link on that screen,
  or back/home), dwell, speed, and an optional caption with timing. Add / remove /
  reorder steps, or **↻ Regenerate auto-walk** from the links graph.
- **▶ Play preview** — loads the prototype and you click through it yourself (no render).
- **Save** — writes the script to `proto.video.json` inside the project folder.
- **⬇ Render** — runs the headless capture + ffmpeg and downloads the MP4/WebM.

### Launch from CodeToUI (ready-to-apply hook)

CodeToUI already reserves a disabled **Video** button in its Export modal
(`index.html`, "in the CodeToPrototype companion tool"). To wire it, in the CodeToUI
repo: give that button an id and remove `disabled`, then add a handler that opens this
app on the active project — no IPC/preload needed:

```js
// CodeToUI src/main.js — after the active project is known (activeProject)
videoBtn.addEventListener("click", () => {
  window.open("http://localhost:5900/?project=" + encodeURIComponent(activeProject), "_blank");
});
```

(Run CodeToPrototype with `C2P_PROJECTS_ROOT` pointed at the same projects folder
CodeToUI is using.)

## How it works

- `src/load-project.js` — reads a project folder or parses an exported `.html` into a model.
- `src/player.js` — the CodeToUI standalone player (navigation engine) plus a synthetic
  cursor overlay and a driver hook.
- `src/walkthrough.js` — auto-walk planner + script validation.
- `src/capture.js` — Puppeteer driver: deterministic fixed-fps frame capture.
- `src/encode.js` — ffmpeg frames → MP4/WebM.
- `src/cli.js` — the `plan` / `render` commands.
- `server/create-video-api.js` — the web backend factory (one shared `{ middleware, close }`,
  mirroring CodeToUI's `create-api.js`), mounted by `server/plugin.js` (Vite dev plugin).
- `src/ui/` — the browser UI (form editor + preview + render). Engine modules stay
  server-only so puppeteer/ffmpeg never enter the client bundle.

## Credits

The navigation player and project/links schema are adapted from CodeToUI Playground.

## License

Licensed under **Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0)**.
You're free to use, share, and adapt it for **non-commercial** purposes, with
attribution. See [LICENSE](./LICENSE).

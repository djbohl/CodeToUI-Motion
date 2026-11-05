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

## How it works

- `src/load-project.js` — reads a project folder or parses an exported `.html` into a model.
- `src/player.js` — the CodeToUI standalone player (navigation engine) plus a synthetic
  cursor overlay and a driver hook.
- `src/walkthrough.js` — auto-walk planner + script validation.
- `src/capture.js` — Puppeteer driver: deterministic fixed-fps frame capture.
- `src/encode.js` — ffmpeg frames → MP4/WebM.
- `src/cli.js` — the `plan` / `render` commands.

A visual timeline editor (web UI) is planned as phase 2, over this same engine and script
format.

## Credits

The navigation player and project/links schema are adapted from CodeToUI Playground.

# CodeToUI Motion — roadmap

Turn a CodeToUI prototype into a **demo video**: a timeline of clips with transitions,
captions, element animation, and (later) audio. Shares CodeToUI's projects folder (disk
truth) and visual style; launchable from CodeToUI via `?project=` (and `?pet=`).

Status legend: ✅ done · 🚧 in progress · ⬜ planned

## M1 — timeline + playback + export ✅

- ✅ Demo model (`proto.demo.json`): clips, durations, transition-in, captions; seed
  from the links flow (`src/demo.js`).
- ✅ Demo renderer (`src/demo-renderer.js`): plays the timeline on a clock; transitions
  + captions are time-parameterized; screens run their own CSS/JS. Powers live preview
  and headless export via `window.__demo`.
- ✅ Headless export: `captureDemo` steps the renderer → ffmpeg (`src/capture.js`,
  `src/encode.js`). MP4/WebM.
- ✅ Web editor in CodeToUI's style: screens palette, device-framed preview with
  transport + scrub, clip inspector, bottom timeline (drag-reorder, edge-drag retime,
  playhead). Autosaves `proto.demo.json`.
- ✅ Backend factory + Vite plugin; projects-root auto-detects a sibling CodeToUI.
- ✅ CLI `seed` / `render`.
- ✅ Pixel pet ported; follows from CodeToUI via `?pet=`.
- ✅ Editor-driven playback (play uses the same seek path as scrubbing).
- ✅ Project switcher dropdown.

## M2 — element animation + canvas clips 🚧

Goal: the "pull the modal onto its own frame and make it pop" workflow. Keep it simple,
with a custom-code escape hatch (the "simple code" throughline).

- 🚧 **M2a** — element overrides on screen clips: data model (`overrides[]` keyed by
  `data-proto-id`), renderer applies hidden / transform / **preset animation**
  (pop, fade, slide-in/out, scale) / **custom CSS** / **custom JS**, as a function of
  clip time (deterministic for export). Inspector element panel + click-to-select an
  element in the preview.
- ⬜ **M2b** — drag-to-reposition/resize elements on a selection-handle overlay.
- ⬜ **M2c** — blank-canvas clips (`type:"canvas"`): start empty, add elements copied
  from any screen (by id) or simple text/box; same override/animation controls.

## M3 — audio ⬜

- ⬜ Timeline audio lane(s); import background music + voiceover; per-track start /
  volume / trim. `encode.js` muxes with ffmpeg (`-c:a aac -shortest`).
- ⬜ (stretch) record voiceover in-app (MediaRecorder).

## Later / stretch

- ⬜ Electron shell (double-click app; opt-in deps like CodeToUI's `app:setup`) — makes
  "is it running?" a non-issue.
- ⬜ "Open in Motion" button inside CodeToUI (cross-repo; see README hook).
- ⬜ Health-check so CodeToUI can tell the user if Motion isn't running.
- ⬜ Device-size presets / orientation in the editor.

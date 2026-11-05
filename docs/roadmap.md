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

## M2 — element animation + canvas clips ✅

Goal: the "pull the modal onto its own frame and make it pop" workflow. Keep it simple,
with a custom-code escape hatch (the "simple code" throughline).

- ✅ **M2a** — element overrides on screen clips: data model (`overrides[]` keyed by
  `data-proto-id`), renderer applies hidden / transform / **preset animation**
  (pop, fade, slide-in/out, scale) / **custom CSS** / **custom JS**, as a function of
  clip time (deterministic for export). Inspector element panel + click-to-select an
  element in the preview (renderer `setPick`).
- ✅ **M2b** — drag-to-reposition / corner-resize elements on a selection overlay over
  the preview (renderer `elementRect`; editor maps stage→viewport by the preview scale).
- ✅ **M2c** — blank-canvas clips (`type:"canvas"`): add **text** and **box** elements
  (title cards, callouts, intro/outro), each positioned/animated with the same
  controls + overlay drag/resize. (Copying an existing screen element onto a canvas —
  with its styling — is deferred as a stretch; animating it in place on a screen clip
  already covers the main case.)

## M3 — audio ✅

- ✅ Timeline audio lane; import background music + voiceover (saved under the project's
  `proto.assets/`); per-track start / volume / trim; drag on the lane to move start.
  Preview plays the audio synced to the editor clock (`setAudio`/`audioTick`); export
  muxes via ffmpeg filter_complex (adelay + volume + amix, `-c:a aac`/`libopus`,
  `-shortest`). Backend `POST /api/audio` + `GET /api/asset`.
- ⬜ (stretch) record voiceover in-app (MediaRecorder).

## Later / stretch

- ✅ Electron shell (double-click app; opt-in deps via `app:setup`, tiny built-in static
  server, shares CodeToUI's Documents projects root on :5920).
- ✅ "Open in Motion" button inside CodeToUI (cross-repo; done + working).
- ⬜ Health-check so CodeToUI can tell the user if Motion isn't running.
- ⬜ In-app voiceover recording (MediaRecorder).
- ⬜ Copy a styled screen element onto a canvas clip.
- ⬜ Device-size presets / orientation in the editor.

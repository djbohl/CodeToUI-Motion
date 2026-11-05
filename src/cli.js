#!/usr/bin/env node
// CodeToPrototype CLI — `plan` and `render`.
//
//   codetoprototype plan   <input> --out walkthrough.json
//   codetoprototype render <input> [--script f.json] [--out o.mp4]
//                                  [--format mp4|webm] [--fps 30] [--dwell 1500]
//                                  [--width 390] [--height 800] [--scale 2]
//                                  [--no-cursor] [--keep-frames]
//
// <input> is a project folder or an exported standalone .html.

import { parseArgs } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadPrototype } from "./load-project.js";
import { buildAutoWalk, loadScript, validateScript, mergeDefaults, DEFAULTS } from "./walkthrough.js";
import { captureFrames } from "./capture.js";
import { encode } from "./encode.js";

const USAGE = `codetoprototype — walkthrough prototype → video

Usage:
  codetoprototype plan   <input> [--out walkthrough.json]
  codetoprototype render <input> [options]

Arguments:
  <input>            a CodeToUI project folder OR an exported standalone .html

Render options:
  --script <file>    walkthrough JSON (from \`plan\`, hand/AI-edited); else auto-walk
  --out <file>       output path (default: <input>.<format> in cwd)
  --format mp4|webm  default mp4
  --fps <n>          default ${DEFAULTS.fps}
  --dwell <ms>       default hold per screen for auto-walk (default ${DEFAULTS.dwell})
  --width <px>       device width (default 390)
  --height <px>      viewport height (default 800)
  --scale <n>        device scale factor (default 2)
  --no-cursor        don't draw the synthetic cursor/ripple
  --keep-frames      keep the captured PNG frames (debug)
`;

const options = {
  out: { type: "string" },
  script: { type: "string" },
  format: { type: "string" },
  fps: { type: "string" },
  dwell: { type: "string" },
  width: { type: "string" },
  height: { type: "string" },
  scale: { type: "string" },
  "no-cursor": { type: "boolean" },
  "keep-frames": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

function num(v, fallback) {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got "${v}".`);
  return n;
}

function inputStem(input) {
  const base = path.basename(input.replace(/[\\/]+$/, ""));
  return base.replace(/\.html?$/i, "") || "walkthrough";
}

async function cmdPlan(input, values) {
  const model = await loadPrototype(input);
  const script = buildAutoWalk(model);
  const out = values.out || `${inputStem(input)}.walkthrough.json`;
  await writeFile(out, JSON.stringify(script, null, 2) + "\n", "utf8");
  console.log(`Wrote ${script.steps.length}-step walkthrough → ${out}`);
  console.log(`Edit it, then: codetoprototype render ${input} --script ${out}`);
}

async function cmdRender(input, values) {
  const model = await loadPrototype(input);

  let script;
  if (values.script) {
    const raw = await loadScript(values.script);
    const { warnings } = validateScript(raw, model);
    warnings.forEach((w) => console.warn(`warning: ${w}`));
    script = mergeDefaults(raw);
  } else {
    const auto = buildAutoWalk(model);
    if (values.dwell != null) {
      const d = num(values.dwell);
      for (const s of auto.steps) if (s.nav !== "$back") s.dwell = d;
    }
    script = mergeDefaults(auto);
  }

  // CLI flags override script top-level settings.
  if (values.format) {
    if (!["mp4", "webm"].includes(values.format)) throw new Error(`Unknown format "${values.format}".`);
    script.format = values.format;
  }
  if (values.fps != null) script.fps = num(values.fps);

  const out = values.out || path.resolve(`${inputStem(input)}.${script.format}`);
  const framesDir = await mkdtemp(path.join(tmpdir(), "c2p-frames-"));

  console.log(`Capturing ${script.steps.length} steps @ ${script.fps}fps …`);
  let manifest;
  try {
    manifest = await captureFrames(model, script, {
      framesDir,
      width: num(values.width, 390),
      height: num(values.height, 800),
      scale: num(values.scale, 2),
      cursor: !values["no-cursor"],
    });
    console.log(`Captured ${manifest.frameCount} frames. Encoding → ${out}`);
    await encode(manifest, out);
    console.log(`Done: ${out}`);
  } finally {
    if (!values["keep-frames"]) await rm(framesDir, { recursive: true, force: true });
    else console.log(`Frames kept in ${framesDir}`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), options, allowPositionals: true });
  const [command, input] = positionals;

  if (values.help || !command) {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }
  if (!input) throw new Error(`"${command}" needs an <input> (project folder or .html).`);

  if (command === "plan") return cmdPlan(input, values);
  if (command === "render") return cmdRender(input, values);
  throw new Error(`Unknown command "${command}". Try: plan, render.`);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});

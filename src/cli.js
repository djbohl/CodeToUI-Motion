#!/usr/bin/env node
// CodeToUI Motion CLI — `seed` and `render` a demo document.
//
//   codetoprototype seed   <input> [--out proto.demo.json]
//   codetoprototype render <input> [--demo f.json] [--out o.mp4]
//                                  [--format mp4|webm] [--fps 30] [--scale 2] [--keep-frames]
//
// <input> is a CodeToUI project folder or an exported standalone .html. The demo doc
// (clips/transitions/captions) is the editable artifact — the same one the web editor
// reads/writes as proto.demo.json.

import { parseArgs } from "node:util";
import { writeFile, mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadPrototype } from "./load-project.js";
import { buildDemoFromLinks, normalizeDemo, validateDemo } from "./demo.js";
import { captureDemo } from "./capture.js";
import { encode } from "./encode.js";

const USAGE = `codetoprototype — CodeToUI Motion (prototype → demo video)

Usage:
  codetoprototype seed   <input> [--out proto.demo.json]
  codetoprototype render <input> [options]

Arguments:
  <input>            a CodeToUI project folder OR an exported standalone .html

Render options:
  --demo <file>      demo JSON (from \`seed\`, hand/AI-edited); else proto.demo.json / a fresh seed
  --out <file>       output path (default: <input>.<format> in cwd)
  --format mp4|webm  default mp4
  --fps <n>          override the demo's fps
  --scale <n>        device scale factor (default 2)
  --keep-frames      keep the captured PNG frames (debug)
`;

const options = {
  out: { type: "string" },
  demo: { type: "string" },
  format: { type: "string" },
  fps: { type: "string" },
  scale: { type: "string" },
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
  return path.basename(input.replace(/[\\/]+$/, "")).replace(/\.html?$/i, "") || "demo";
}
async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function cmdSeed(input, values) {
  const model = await loadPrototype(input);
  const demo = buildDemoFromLinks(model);
  const out = values.out || `${inputStem(input)}.demo.json`;
  await writeFile(out, JSON.stringify(demo, null, 2) + "\n", "utf8");
  console.log(`Wrote ${demo.clips.length}-clip demo → ${out}`);
  console.log(`Edit it, then: codetoprototype render ${input} --demo ${out}`);
}

async function cmdRender(input, values) {
  const model = await loadPrototype(input);

  let demo;
  if (values.demo) {
    demo = normalizeDemo(JSON.parse(await readFile(values.demo, "utf8")));
  } else {
    // A project folder may carry a saved proto.demo.json next to it.
    const abs = path.resolve(input);
    const saved = path.join(abs, "proto.demo.json");
    demo = (await fileExists(saved))
      ? normalizeDemo(JSON.parse(await readFile(saved, "utf8")))
      : buildDemoFromLinks(model);
  }
  validateDemo(demo, model);
  if (values.fps != null) demo.fps = num(values.fps);
  const format = values.format === "webm" ? "webm" : "mp4";

  const out = values.out || path.resolve(`${inputStem(input)}.${format}`);
  const framesDir = await mkdtemp(path.join(tmpdir(), "c2p-frames-"));
  console.log(`Capturing ${demo.clips.length} clips @ ${demo.fps}fps …`);
  try {
    const manifest = await captureDemo(model, demo, { framesDir, fps: demo.fps, format, scale: num(values.scale, 2) });
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
  if (command === "seed") return cmdSeed(input, values);
  if (command === "render") return cmdRender(input, values);
  throw new Error(`Unknown command "${command}". Try: seed, render.`);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadPrototype, extractStandaloneData } from "../src/load-project.js";
import { buildAutoWalk, validateScript, mergeDefaults, normalizeTransition } from "../src/walkthrough.js";
import { buildPlayerHtml } from "../src/player.js";
import { buildFfmpegArgs, FRAME_PATTERN } from "../src/encode.js";

const DEMO = "/Users/linksys/Downloads/code-design/projects/Demo";

test("loadPrototype reads the Demo folder", async () => {
  const model = await loadPrototype(DEMO);
  assert.equal(model.start, "Login");
  assert.ok(model.screens.Login && model.screens.Home, "has Login + Home");
  assert.equal(model.links.length, 1);
  assert.equal(model.links[0].elementId, "el-4fb756");
  assert.equal(model.links[0].mode, "overlay");
});

test("buildAutoWalk produces Login → click overlay → Home → $back", async () => {
  const model = await loadPrototype(DEMO);
  const script = buildAutoWalk(model);
  assert.deepEqual(
    script.steps.map((s) => ({ screen: s.screen, click: s.click || null, nav: s.nav || null })),
    [
      { screen: "Login", click: null, nav: null },
      { screen: "Login", click: "el-4fb756", nav: null },
      { screen: "Home", click: null, nav: "$back" },
    ]
  );
  assert.equal(script.steps[1].transition, "slide-up");
});

test("standalone .html round-trips to the same model", async () => {
  const model = await loadPrototype(DEMO);
  const html = buildPlayerHtml(model);
  // sanity: the embedded DATA parses
  const data = extractStandaloneData(html);
  assert.equal(data.start, "Login");

  const dir = await mkdtemp(path.join(tmpdir(), "c2p-test-"));
  const file = path.join(dir, "proto.html");
  await writeFile(file, html, "utf8");
  const loaded = await loadPrototype(file);
  assert.equal(loaded.start, model.start);
  assert.deepEqual(Object.keys(loaded.screens).sort(), Object.keys(model.screens).sort());
  assert.equal(loaded.links[0].elementId, "el-4fb756");
});

test("validateScript rejects a click id that isn't a known link (as warning) and bad screens (as error)", async () => {
  const model = await loadPrototype(DEMO);
  // unknown screen → hard error
  assert.throws(() => validateScript({ steps: [{ screen: "Nope" }] }, model), /unknown screen/i);
  // click+nav together → hard error
  assert.throws(
    () => validateScript({ steps: [{ screen: "Login", click: "el-4fb756", nav: "$back" }] }, model),
    /both/i
  );
  // unknown click id → warning, not throw
  const { warnings } = validateScript({ steps: [{ screen: "Login", click: "el-zzz" }] }, model);
  assert.ok(warnings.some((w) => /el-zzz/.test(w)));
});

test("mergeDefaults fills fps/format and per-step dwell/speed/caption", () => {
  const merged = mergeDefaults({
    steps: [
      { screen: "Login" },
      { screen: "Login", click: "el-4fb756", caption: { text: "Hi", at: 100, for: 500 } },
      { screen: "Home", nav: "$back" },
    ],
  });
  assert.equal(merged.fps, 30);
  assert.equal(merged.format, "mp4");
  assert.equal(merged.steps[0].dwell, 1500);
  assert.equal(merged.steps[2].dwell, 600); // $back default
  assert.equal(merged.steps[0].speed, 1);
  assert.deepEqual(merged.steps[1].caption, { text: "Hi", at: 100, for: 500 });
});

test("normalizeTransition maps legacy values", () => {
  assert.equal(normalizeTransition("none"), "instant");
  assert.equal(normalizeTransition("fade"), "dissolve");
  assert.equal(normalizeTransition("slide"), "slide-left");
  assert.equal(normalizeTransition("slide-up"), "slide-up");
  assert.equal(normalizeTransition("bogus"), "instant");
});

test("buildFfmpegArgs emits correct flags per format", () => {
  const mp4 = buildFfmpegArgs({ framesDir: "/f", fps: 30, format: "mp4", outPath: "/o.mp4" });
  assert.ok(mp4.includes("libx264"));
  assert.ok(mp4.includes("yuv420p"));
  assert.ok(mp4.join(" ").includes(path.join("/f", FRAME_PATTERN)));
  assert.equal(mp4[mp4.length - 1], "/o.mp4");

  const webm = buildFfmpegArgs({ framesDir: "/f", fps: 24, format: "webm", outPath: "/o.webm" });
  assert.ok(webm.includes("libvpx-vp9"));
  assert.ok(webm.includes("24"));
});

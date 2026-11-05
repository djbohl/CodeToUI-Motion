import { test } from "node:test";
import assert from "node:assert/strict";

import { loadPrototype } from "../src/load-project.js";
import { buildDemoFromLinks, normalizeDemo, validateDemo, clipTimeline, demoDuration } from "../src/demo.js";
import { buildDemoHtml } from "../src/demo-renderer.js";

const DEMO = "/Users/linksys/Downloads/code-design/projects/Demo";

test("buildDemoFromLinks seeds Login → Home(slide-up) → back(dissolve)", async () => {
  const model = await loadPrototype(DEMO);
  const demo = buildDemoFromLinks(model);
  assert.deepEqual(demo.clips.map((c) => c.screen), ["Login", "Home", "Login"]);
  assert.equal(demo.clips[0].transitionIn.type, "instant");
  assert.equal(demo.clips[1].transitionIn.type, "slide-up");
  assert.equal(demo.clips[2].transitionIn.type, "dissolve");
  assert.ok(demo.clips.every((c) => c.duration > 0));
});

test("validateDemo rejects an unknown screen and warns on overlong captions", async () => {
  const model = await loadPrototype(DEMO);
  assert.throws(() => validateDemo({ clips: [{ type: "screen", screen: "Nope", duration: 1000 }] }, model), /unknown screen/i);
  const { warnings } = validateDemo(
    { clips: [{ type: "screen", screen: "Login", duration: 1000, captions: [{ text: "hi", at: 900, for: 500 }] }] },
    model
  );
  assert.ok(warnings.some((w) => /extends past/.test(w)));
});

test("normalizeDemo fills defaults and ids", () => {
  const d = normalizeDemo({ clips: [{ type: "screen", screen: "Login" }] });
  assert.equal(d.fps, 30);
  assert.equal(d.size.width, 390);
  assert.ok(d.clips[0].id);
  assert.equal(d.clips[0].duration, 2000);
  assert.equal(d.clips[0].transitionIn.type, "instant");
});

test("clipTimeline / demoDuration sum durations", () => {
  const d = normalizeDemo({ clips: [{ screen: "A", duration: 1000 }, { screen: "B", duration: 1500 }] });
  const { clips, duration } = clipTimeline(d);
  assert.equal(duration, 2500);
  assert.deepEqual(clips.map((c) => [c.startT, c.endT]), [[0, 1000], [1000, 2500]]);
  assert.equal(demoDuration(d), 2500);
});

test("buildDemoHtml embeds the renderer runtime + screen content", async () => {
  const model = await loadPrototype(DEMO);
  const html = buildDemoHtml(model, buildDemoFromLinks(model));
  assert.match(html, /window\.__demo/);
  assert.match(html, /window\.__DEMO_DATA/);
  assert.match(html, /composeScreenSrcdoc/);
  assert.match(html, /el-4fb756/); // Login screen HTML is embedded
});

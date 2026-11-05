// The demo document (`proto.demo.json`) — the timeline the Motion editor edits and the
// renderer plays. A demo is an ordered list of clips; each clip shows a screen (M1) or
// a blank canvas (M2) for a duration, with a transition-in and timed captions.
//
// `buildDemoFromLinks` seeds a demo from the prototype's click-flow so the user starts
// from something real. The traversal mirrors the links graph (reusing the transition
// normalization from walkthrough.js) rather than reinterpreting walkthrough steps.

import { readFile } from "node:fs/promises";
import { normalizeTransition } from "./walkthrough.js";

export const DEMO_DEFAULTS = {
  fps: 30,
  size: { width: 390, height: 844 },
  hold: 2000, // ms a seeded clip dwells
  backHold: 1200, // ms for an auto "return" clip
  transitionMs: 400, // default visible transition length
};

function transitionIn(tr) {
  const type = normalizeTransition(tr);
  return { type, duration: type === "instant" ? 0 : DEMO_DEFAULTS.transitionMs };
}

let _idSeq = 0;
function clipId() {
  return "c" + (++_idSeq).toString(36) + Date.now().toString(36).slice(-3);
}

function linksByScreen(links) {
  const by = {};
  for (const l of links) (by[l.screen] = by[l.screen] || []).push(l);
  return by;
}

/**
 * Seed a demo by DFS over the links graph from the start screen: each destination
 * becomes a clip (with the link's transition), and we emit a dissolve "return" clip so
 * the demo visibly comes back before exploring siblings. Each link is used once.
 * @param {import('./load-project.js').PrototypeModel} model
 */
export function buildDemoFromLinks(model) {
  const by = linksByScreen(model.links);
  const clips = [
    { id: clipId(), type: "screen", screen: model.start, duration: DEMO_DEFAULTS.hold,
      transitionIn: { type: "instant", duration: 0 }, captions: [] },
  ];
  const visited = new Set();

  function visit(screen) {
    for (const l of by[screen] || []) {
      if (visited.has(l.id)) continue;
      visited.add(l.id);
      if (l.target === "$back" || l.target === "$home") continue; // sentinels: skip in seed
      if (!model.screens[l.target]) continue; // dangling link

      clips.push({ id: clipId(), type: "screen", screen: l.target, duration: DEMO_DEFAULTS.hold,
        transitionIn: transitionIn(l.transition), captions: [] });
      visit(l.target);
      clips.push({ id: clipId(), type: "screen", screen, duration: DEMO_DEFAULTS.backHold,
        transitionIn: { type: "dissolve", duration: DEMO_DEFAULTS.transitionMs }, captions: [] });
    }
  }
  visit(model.start);

  return { version: 1, fps: DEMO_DEFAULTS.fps, size: { ...DEMO_DEFAULTS.size }, clips, audio: [] };
}

/** Fill in defaults + stable ids; returns a normalized copy (does not mutate input). */
export function normalizeDemo(demo) {
  const fps = demo?.fps || DEMO_DEFAULTS.fps;
  const size = {
    width: demo?.size?.width || DEMO_DEFAULTS.size.width,
    height: demo?.size?.height || DEMO_DEFAULTS.size.height,
  };
  const clips = (demo?.clips || []).map((c) => ({
    id: c.id || clipId(),
    type: c.type === "canvas" ? "canvas" : "screen",
    screen: c.screen || null,
    duration: c.duration > 0 ? c.duration : DEMO_DEFAULTS.hold,
    transitionIn: {
      type: normalizeTransition(c.transitionIn?.type),
      duration: c.transitionIn?.duration >= 0 ? c.transitionIn.duration : DEMO_DEFAULTS.transitionMs,
    },
    captions: (c.captions || []).map((cap) => ({
      text: cap.text,
      at: cap.at >= 0 ? cap.at : 0,
      for: cap.for > 0 ? cap.for : 1000,
    })),
  }));
  return { version: 1, fps, size, clips, audio: demo?.audio || [] };
}

/** Validate against the model. Throws on hard errors; returns { warnings }. */
export function validateDemo(demo, model) {
  const warnings = [];
  if (!demo || !Array.isArray(demo.clips) || !demo.clips.length) {
    throw new Error("Demo has no clips.");
  }
  demo.clips.forEach((c, i) => {
    const at = `clip ${i}`;
    if (c.type === "screen") {
      if (!c.screen || !model.screens[c.screen]) throw new Error(`${at}: unknown screen "${c.screen}".`);
    } else if (c.type !== "canvas") {
      throw new Error(`${at}: type must be "screen" or "canvas".`);
    }
    if (!(c.duration > 0)) throw new Error(`${at}: duration must be > 0.`);
    (c.captions || []).forEach((cap, j) => {
      if (typeof cap.text !== "string" || !cap.text) throw new Error(`${at} caption ${j}: needs text.`);
      if (cap.at + cap.for > c.duration) {
        warnings.push(`${at} caption ${j}: extends past the clip (${cap.at + cap.for}ms > ${c.duration}ms).`);
      }
    });
  });
  return { warnings };
}

/** Absolute clip timeline: [{...clip, startT, endT}] and total duration (ms). */
export function clipTimeline(demo) {
  let t = 0;
  const clips = demo.clips.map((c) => {
    const startT = t;
    t += c.duration;
    return { ...c, startT, endT: t };
  });
  return { clips, duration: t };
}

export function demoDuration(demo) {
  return demo.clips.reduce((n, c) => n + c.duration, 0);
}

export async function loadDemo(demoPath) {
  return JSON.parse(await readFile(demoPath, "utf8"));
}

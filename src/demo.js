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
  const clips = (demo?.clips || []).map((c) => {
    const type = c.type === "canvas" ? "canvas" : "screen";
    const clip = {
      id: c.id || clipId(),
      type,
      screen: type === "screen" ? c.screen || null : null,
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
    };
    if (type === "canvas") clip.elements = (c.elements || []).map(normalizeCanvasEl);
    else clip.overrides = (c.overrides || []).map(normalizeOverride).filter((o) => o.elementId);
    return clip;
  });
  const audio = (demo?.audio || []).map(normalizeAudio).filter((a) => a.src);
  return { version: 1, fps, size, clips, audio };
}

// An audio track on the timeline (background music or voiceover). `src` is a project-
// relative path (under proto.assets/); `start` offsets it on the timeline; trim selects a
// window of the source; `dur` is the source length (ms), cached by the editor for layout.
export function normalizeAudio(a) {
  return {
    id: a.id || "a" + Math.random().toString(36).slice(2, 8),
    kind: a.kind === "voice" ? "voice" : "music",
    src: typeof a.src === "string" ? a.src : "",
    name: typeof a.name === "string" ? a.name : "",
    start: Math.max(0, num(a.start, 0)),
    volume: Math.min(1, Math.max(0, num(a.volume, 1))),
    trimStart: Math.max(0, num(a.trimStart, 0)),
    trimEnd: a.trimEnd != null && Number.isFinite(Number(a.trimEnd)) ? Math.max(0, Number(a.trimEnd)) : null,
    dur: a.dur != null ? Math.max(0, num(a.dur, 0)) : null,
  };
}

export const ANIM_PRESETS = ["none", "pop", "fade", "scale", "slide-up", "slide-down", "slide-left", "slide-right"];
const EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// One element override on a clip, keyed by the element's stable data-proto-id.
function normalizeOverride(o) {
  const out = {
    elementId: typeof o.elementId === "string" ? o.elementId : "",
    hidden: !!o.hidden,
    x: num(o.x, 0),
    y: num(o.y, 0),
    scale: num(o.scale, 1),
    rotate: num(o.rotate, 0),
  };
  if (o.animation && ANIM_PRESETS.includes(o.animation.preset) && o.animation.preset !== "none") {
    out.animation = {
      preset: o.animation.preset,
      duration: Math.max(0, num(o.animation.duration, 400)),
      delay: Math.max(0, num(o.animation.delay, 0)),
      easing: EASINGS.includes(o.animation.easing) ? o.animation.easing : "ease-out",
    };
  }
  if (typeof o.css === "string" && o.css.trim()) out.css = o.css;
  if (typeof o.js === "string" && o.js.trim()) out.js = o.js;
  return out;
}

export const CANVAS_KINDS = ["text", "box"];
// A canvas element = an override (transform/anim/css/js, positioned by translate x/y from
// the top-left) plus its own content (text or a box). Gets a stable id if missing.
export function normalizeCanvasEl(e) {
  const base = normalizeOverride(e);
  if (!base.elementId) base.elementId = "ce-" + Math.random().toString(36).slice(2, 8);
  const kind = e.kind === "box" ? "box" : "text";
  const out = { ...base, kind };
  if (kind === "text") {
    out.text = typeof e.text === "string" ? e.text : "Text";
    out.fontSize = num(e.fontSize, 32);
    out.color = typeof e.color === "string" ? e.color : "#111111";
  } else {
    out.w = num(e.w, 160);
    out.h = num(e.h, 100);
    out.bg = typeof e.bg === "string" ? e.bg : "#5b8cff";
    out.radius = num(e.radius, 8);
  }
  return out;
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
    (c.overrides || []).forEach((o, j) => {
      if (typeof o.elementId !== "string" || !o.elementId) throw new Error(`${at} override ${j}: needs an elementId.`);
    });
    (c.elements || []).forEach((el, j) => {
      if (typeof el.elementId !== "string" || !el.elementId) throw new Error(`${at} element ${j}: needs an elementId.`);
      if (!CANVAS_KINDS.includes(el.kind)) throw new Error(`${at} element ${j}: kind must be text or box.`);
    });
  });
  (demo.audio || []).forEach((a, i) => {
    if (!["music", "voice"].includes(a.kind)) throw new Error(`audio ${i}: kind must be music or voice.`);
    if (typeof a.src !== "string" || !a.src) throw new Error(`audio ${i}: needs a src.`);
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

// Walkthrough planning + script handling.
//
// A "walkthrough script" is the editable, AI-friendly artifact that drives a
// render. `buildAutoWalk` generates a default one by traversing the links graph;
// `loadScript` + `validateScript` + `mergeDefaults` normalize a hand-edited one.
//
// Step shape (all fields but one of click/nav optional):
//   { screen, click?, nav?, transition?, dwell?, speed?, caption? }
//     screen      the screen the user is ON when this step begins
//     click       elementId (data-proto-id or data-goto) to click faithfully
//     nav         "$back" | "$home" — programmatic move instead of a click
//     transition  informational hint (the player picks the real one from the link)
//     dwell       ms to hold after the move settles
//     speed       playback multiplier (1 = real time, 1.5 = 1.5x faster)
//     caption     { text, at, for } — ms relative to the start of the step

import { readFile } from "node:fs/promises";

export const DEFAULTS = { fps: 30, format: "mp4", dwell: 1500, backDwell: 600, speed: 1 };

const TRANSITIONS = new Set([
  "instant", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down",
]);

// Mirror CodeToUI's legacy-value normalization.
export function normalizeTransition(tr) {
  if (tr === "none") return "instant";
  if (tr === "fade") return "dissolve";
  if (tr === "slide") return "slide-left";
  return TRANSITIONS.has(tr) ? tr : "instant";
}

function linksByScreen(links) {
  const by = {};
  for (const l of links) {
    (by[l.screen] = by[l.screen] || []).push(l);
  }
  return by;
}

/**
 * Generate a default walkthrough by DFS over the links graph, visiting each link
 * once. Navigate/overlay links are explored then auto-returned via $back.
 * @param {import('./load-project.js').PrototypeModel} model
 */
export function buildAutoWalk(model) {
  const by = linksByScreen(model.links);
  const steps = [{ screen: model.start, dwell: DEFAULTS.dwell }];
  const visited = new Set();

  function visit(screen) {
    for (const l of by[screen] || []) {
      if (visited.has(l.id)) continue;
      visited.add(l.id);

      steps.push({
        screen,
        click: l.elementId,
        transition: normalizeTransition(l.transition),
        dwell: DEFAULTS.dwell,
      });

      if (l.target === "$back" || l.target === "$home") continue; // no sub-tree to explore

      visit(l.target); // explore the destination / overlay contents

      // Return to where we were so the stack stays balanced for siblings.
      steps.push({ screen: l.target, nav: "$back", transition: "dissolve", dwell: DEFAULTS.backDwell });
    }
  }
  visit(model.start);

  return { fps: DEFAULTS.fps, format: DEFAULTS.format, steps };
}

export async function loadScript(scriptPath) {
  const raw = await readFile(scriptPath, "utf8");
  return JSON.parse(raw);
}

/**
 * Validate a script against a model. Throws on the first hard error.
 * @returns {{ warnings: string[] }}
 */
export function validateScript(script, model) {
  const warnings = [];
  if (!script || !Array.isArray(script.steps) || !script.steps.length) {
    throw new Error("Walkthrough script has no steps.");
  }
  if (script.format && !["mp4", "webm"].includes(script.format)) {
    throw new Error(`Unknown format "${script.format}" (expected mp4 or webm).`);
  }
  const linkIdsByScreen = {};
  for (const l of model.links) {
    (linkIdsByScreen[l.screen] = linkIdsByScreen[l.screen] || new Set()).add(l.elementId);
  }

  script.steps.forEach((step, i) => {
    const at = `step ${i} (${step.screen || "?"})`;
    if (!step.screen || !model.screens[step.screen]) {
      throw new Error(`${at}: unknown screen "${step.screen}".`);
    }
    if (step.click && step.nav) {
      throw new Error(`${at}: a step cannot have both "click" and "nav".`);
    }
    if (step.nav && !["$back", "$home"].includes(step.nav)) {
      throw new Error(`${at}: nav must be "$back" or "$home", got "${step.nav}".`);
    }
    if (step.click) {
      const known = linkIdsByScreen[step.screen];
      if (!known || !known.has(step.click)) {
        // Could still be a raw data-goto element; we can't confirm without parsing
        // HTML, so warn rather than fail — capture will error if it's truly absent.
        warnings.push(`${at}: "${step.click}" is not a links.json element on "${step.screen}"; relying on a data-goto attribute.`);
      }
    }
    if (step.transition) step.transition = normalizeTransition(step.transition);
    if (step.caption != null) {
      if (typeof step.caption === "string") step.caption = { text: step.caption };
      if (typeof step.caption.text !== "string" || !step.caption.text) {
        throw new Error(`${at}: caption needs a non-empty "text".`);
      }
    }
  });
  return { warnings };
}

/** Fill in defaults (fps/format and per-step dwell/speed/caption timing). */
export function mergeDefaults(script) {
  const fps = script.fps || DEFAULTS.fps;
  const format = script.format || DEFAULTS.format;
  const steps = script.steps.map((s) => {
    const dwell = s.dwell != null ? s.dwell : s.nav === "$back" ? DEFAULTS.backDwell : DEFAULTS.dwell;
    const out = {
      screen: s.screen,
      click: s.click || null,
      nav: s.nav || null,
      transition: s.transition ? normalizeTransition(s.transition) : "instant",
      dwell,
      speed: s.speed && s.speed > 0 ? s.speed : DEFAULTS.speed,
      caption: null,
    };
    if (s.caption) {
      out.caption = {
        text: s.caption.text,
        at: s.caption.at != null ? s.caption.at : 0,
        for: s.caption.for != null ? s.caption.for : Math.max(0, dwell),
      };
    }
    return out;
  });
  return { fps, format, steps };
}

// Drive the player in headless Chromium and record a PNG frame sequence.
//
// Capture model: deterministic *frame count* per step. For each step we compute
//   frames = round(fps * contentDurationMs / 1000 / speed)
// and grab one screenshot per frame, sleeping the matching slice of real time
// between grabs so the browser's real 180ms CSS transitions and iframe renders
// advance naturally. The synthetic cursor, click ripple, and caption are DOM
// overlays we set per frame (via window.__proto), so they're captured crisply.
//
// Puppeteer launches with pipe transport (no TCP) so it runs in restricted
// sandboxes. A system sandbox may still block spawning Chromium; in that case the
// caller renders outside the sandbox.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { buildPlayerHtml } from "./player.js";

const TRAVEL_MS = 420; // cursor glide to target before a click
const RIPPLE_MS = 420; // click ripple expand/fade
const TRANSITION_MS = 200; // ~180ms player transition + a little slack

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function pad6(n) {
  return String(n).padStart(6, "0");
}

/**
 * @param {import('./load-project.js').PrototypeModel} model
 * @param {{ fps:number, format:string, steps:Array }} script  (already merged w/ defaults)
 * @param {{ framesDir:string, width?:number, height?:number, scale?:number, cursor?:boolean, launch?:object }} opts
 * @returns {Promise<{ framesDir:string, fps:number, format:string, frameCount:number }>}
 */
export async function captureFrames(model, script, opts) {
  const { fps } = script;
  const width = opts.width || 390;
  const height = opts.height || 800;
  const scale = opts.scale || 2;
  const cursorOn = opts.cursor !== false;
  const framesDir = opts.framesDir;

  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  let puppeteer;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch {
    throw new Error("Puppeteer isn't installed. Run: npm install");
  }
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(opts.launch || {}),
  });

  let frameNo = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(buildPlayerHtml(model), { waitUntil: "load" });
    // Wait for the start screen's iframe to mount.
    await page.waitForFunction("window.__proto && window.__proto.loadSeq() >= 1", { timeout: 5000 });

    let cursorPos = { x: Math.round(width / 2), y: Math.round(height * 0.9) };

    const grab = async () => {
      frameNo += 1;
      await page.screenshot({ path: path.join(framesDir, `frame-${pad6(frameNo)}.png`), type: "png" });
    };

    for (const step of script.steps) {
      const isClick = !!step.click;
      const isNav = !!step.nav;

      // Look up the click target rect (for cursor glide + ripple center).
      let target = null;
      if (isClick) {
        target = await page.evaluate((id) => window.__proto.rectFor(id), step.click);
        if (!target) {
          throw new Error(
            `Could not find clickable element "${step.click}" on screen "${step.screen}".`
          );
        }
      }

      const travel = cursorOn && isClick && target ? TRAVEL_MS : 0;
      const hold = (isClick || isNav ? TRANSITION_MS : 0) + step.dwell;
      const duration = travel + hold; // content ms, before speed scaling
      const frames = Math.max(1, Math.round((fps * duration) / 1000 / step.speed));
      const dtReal = duration / step.speed / frames; // real ms to wait per frame

      const startPos = { ...cursorPos };
      let moved = false; // click/nav fired yet?

      for (let f = 0; f < frames; f++) {
        const contentT = (f / frames) * duration; // position within the step (content ms)

        // Fire the move exactly once, when we cross out of the travel phase.
        if (!moved && contentT >= travel) {
          moved = true;
          if (isClick) {
            const ok = await page.evaluate((id) => window.__proto.click(id), step.click);
            if (!ok) throw new Error(`Click dispatch failed for "${step.click}".`);
          } else if (isNav) {
            await page.evaluate(
              (nav, tr) => window.__proto.nav(nav, "navigate", tr),
              step.nav,
              step.transition || "instant"
            );
          }
          // Let the destination iframe mount (if a navigation happened). Harmless
          // no-op/timeout for overlay-close which does no iframe load.
          const prev = await page.evaluate(() => window.__proto.loadSeq());
          await page
            .waitForFunction((p) => window.__proto.loadSeq() > p, { timeout: 1500 }, prev)
            .catch(() => {});
        }

        // Cursor: glide toward target during travel, then rest at target.
        if (cursorOn && isClick && target) {
          let cx, cy;
          if (contentT < travel && travel > 0) {
            const t = easeInOut(contentT / travel);
            cx = startPos.x + (target.x - startPos.x) * t;
            cy = startPos.y + (target.y - startPos.y) * t;
          } else {
            cx = target.x;
            cy = target.y;
          }
          cursorPos = { x: cx, y: cy };
          await page.evaluate((x, y) => window.__proto.cursor(x, y, true), cx, cy);
        }

        // Ripple: starts when the click fires, over RIPPLE_MS.
        if (cursorOn && isClick && target) {
          const rt = contentT - travel;
          const prog = rt >= 0 && rt <= RIPPLE_MS ? rt / RIPPLE_MS : -1;
          await page.evaluate((x, y, p) => window.__proto.ripple(x, y, p), target.x, target.y, prog);
        }

        // Caption: shown during its [at, at+for] window (relative to step start).
        if (step.caption) {
          const show = contentT >= step.caption.at && contentT < step.caption.at + step.caption.for;
          await page.evaluate((text) => window.__proto.caption(text), show ? step.caption.text : null);
        } else {
          await page.evaluate(() => window.__proto.caption(null));
        }

        await grab();
        await sleep(dtReal);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return { framesDir, fps, format: script.format, frameCount: frameNo };
}

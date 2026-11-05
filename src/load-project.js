// Load a CodeToUI prototype into a normalized model the player/capture use.
//
// Two inputs are accepted:
//   - a project folder  (projects/<name>/ with proto.config.json, global.css,
//     links.json, screens/<Name>/<Name>.{html,css,js,jsx})
//   - an exported standalone .html  (which already embeds a `var DATA = {...}`
//     object with screens/global/links/start/rt — we parse it back out)
//
// Project-folder reading mirrors CodeToUI's render-pipeline.js (readScreenFiles /
// readGlobalCss) and proto.config.json shape; the standalone format mirrors
// buildStandaloneHtml in CodeToUI's src/export.js.

import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {Object} ScreenModel
 * @property {string} html
 * @property {string} css
 * @property {string} js
 * @property {string} jsx
 * @property {"vanilla"|"react"} framework
 *
 * @typedef {Object} PrototypeModel
 * @property {Object<string, ScreenModel>} screens  keyed by screen name
 * @property {string[]} order        screen names in config order (start first-ish)
 * @property {string} global         global css
 * @property {Array} links           links.json entries
 * @property {string} start          start screen name
 * @property {?Object} rt            optional React runtime {react,reactDom,babel}
 */

async function isDirectory(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function readIf(p) {
  return readFile(p, "utf8").catch(() => "");
}

// Reads screens/<name>/<name>.{html,css,js,jsx}. Mirrors CodeToUI readScreenFiles.
async function readScreenFiles(projectDir, name) {
  const dir = path.join(projectDir, "screens", name);
  const [html, css, js, jsx] = await Promise.all([
    readIf(path.join(dir, `${name}.html`)),
    readIf(path.join(dir, `${name}.css`)),
    readIf(path.join(dir, `${name}.js`)),
    readIf(path.join(dir, `${name}.jsx`)),
  ]);
  return { html, css, js, jsx };
}

async function loadFolder(projectDir) {
  let config = {};
  try {
    config = JSON.parse(await readFile(path.join(projectDir, "proto.config.json"), "utf8"));
  } catch {
    config = {};
  }
  const frameworks = config.frameworks || {};
  const global = await readIf(path.join(projectDir, "global.css"));

  let links = [];
  try {
    const parsed = JSON.parse(await readFile(path.join(projectDir, "links.json"), "utf8"));
    if (Array.isArray(parsed.links)) links = parsed.links;
  } catch {
    links = [];
  }

  // Trust on-disk folders; order by config.screens, then append any extra folders.
  const screensRoot = path.join(projectDir, "screens");
  let onDisk = [];
  try {
    const entries = await readdir(screensRoot, { withFileTypes: true });
    onDisk = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    onDisk = [];
  }
  const configOrder = Array.isArray(config.screens) ? config.screens : [];
  const order = [
    ...configOrder.filter((n) => onDisk.includes(n)),
    ...onDisk.filter((n) => !configOrder.includes(n)),
  ];

  const screens = {};
  await Promise.all(
    order.map(async (name) => {
      const files = await readScreenFiles(projectDir, name);
      screens[name] = { ...files, framework: frameworks[name] === "react" ? "react" : "vanilla" };
    })
  );

  const start =
    config.startScreen && order.includes(config.startScreen) ? config.startScreen : order[0];

  return { screens, order, global, links, start, rt: null };
}

// Pull the `var DATA = {...};` object literal out of an exported standalone file.
// The exporter escapes "</" as "<\/" inside the JSON so embedded markup can't close
// the <script>; we reverse that before JSON.parse.
export function extractStandaloneData(htmlText) {
  const m = htmlText.match(/var\s+DATA\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!m) {
    throw new Error("Could not find the embedded prototype data in this .html file.");
  }
  const json = m[1].replace(/<\\\//g, "</");
  return JSON.parse(json);
}

function modelFromStandalone(data) {
  const screens = {};
  const srcScreens = data.screens || {};
  for (const name of Object.keys(srcScreens)) {
    const s = srcScreens[name] || {};
    screens[name] = {
      html: s.html || "",
      css: s.css || "",
      js: s.js || "",
      jsx: s.jsx || "",
      framework: s.framework === "react" ? "react" : "vanilla",
    };
  }
  const order = Object.keys(screens);
  const start = data.start && screens[data.start] ? data.start : order[0];
  return {
    screens,
    order,
    global: data.global || "",
    links: Array.isArray(data.links) ? data.links : [],
    start,
    rt: data.rt || null,
  };
}

/**
 * Load a prototype from a folder path or a standalone .html path.
 * @param {string} input
 * @returns {Promise<PrototypeModel>}
 */
export async function loadPrototype(input) {
  const abs = path.resolve(input);
  if (await isDirectory(abs)) {
    const model = await loadFolder(abs);
    if (!model.order.length) throw new Error(`No screens found in project: ${abs}`);
    if (!model.start) throw new Error(`No start screen for project: ${abs}`);
    return model;
  }
  // Treat as a file (expected .html). A missing/unreadable path throws here.
  const text = await readFile(abs, "utf8");
  const model = modelFromStandalone(extractStandaloneData(text));
  if (!model.order.length) throw new Error(`No screens found in standalone file: ${abs}`);
  if (!model.start) throw new Error(`No start screen in standalone file: ${abs}`);
  return model;
}

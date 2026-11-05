// The CodeToUI Motion web backend, independent of how it's hosted (Vite dev plugin now,
// an Electron shell later) — mirroring CodeToUI's createProtoApi factory so dev and
// desktop can't drift. It operates on one *active* project at a time within a projects
// root (CodeToUI's own root), and drives the engine to preview and render demo videos.

import { readFile, writeFile, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { listProjects, writeActive } from "./projects.js";
import { loadPrototype } from "../src/load-project.js";
import { buildDemoFromLinks, validateDemo, normalizeDemo } from "../src/demo.js";
import { buildDemoHtml } from "../src/demo-renderer.js";
import { captureDemo } from "../src/capture.js";
import { encode } from "../src/encode.js";

const DEMO_FILE = "proto.demo.json"; // saved demo document, per project (disk truth)

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
const ASSETS_DIR = "proto.assets"; // imported audio lives here, inside the project
const AUDIO_CT = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".ogg": "audio/ogg", ".oga": "audio/ogg", ".webm": "audio/webm", ".flac": "audio/flac",
};

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// The saved demo for a project, or a fresh seed from the links flow if none is saved.
async function demoForProject(activeDir, model) {
  const p = path.join(activeDir, DEMO_FILE);
  if (await fileExists(p)) {
    try {
      return normalizeDemo(JSON.parse(await readFile(p, "utf8")));
    } catch {
      /* corrupt — fall back to a fresh seed */
    }
  }
  return buildDemoFromLinks(model);
}

export function createVideoApi({ projectsRoot, initialProject }) {
  let activeName = initialProject;
  let activeDir = activeName ? path.join(projectsRoot, activeName) : null;

  async function setActive(name) {
    activeName = name;
    activeDir = path.join(projectsRoot, name);
    await writeActive(projectsRoot, name);
  }

  async function middleware(req, res, next) {
    if (!req.url?.startsWith("/api/")) return next();
    const url = req.url.split("?")[0];

    const json = (obj, status = 200) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(obj));
    };

    try {
      // Liveness probe so CodeToUI can detect whether Motion is running before launching.
      if (url === "/api/ping" && req.method === "GET") {
        res.setHeader("Access-Control-Allow-Origin", "*"); // allow a cross-origin check from CodeToUI
        json({ ok: true, app: "codetoui-motion" });
        return;
      }

      if (url === "/api/projects" && req.method === "GET") {
        json({ projects: await listProjects(projectsRoot), active: activeName });
        return;
      }

      if (url === "/api/projects/active" && req.method === "POST") {
        const body = await readJsonBody(req);
        const projects = await listProjects(projectsRoot);
        if (!projects.includes(body.name)) {
          json({ error: "no such project" }, 404);
          return;
        }
        await setActive(body.name);
        json({ active: activeName });
        return;
      }

      // Everything below needs an active project.
      if (!activeName) {
        json({ error: "No active project. Point C2P_PROJECTS_ROOT at a CodeToUI projects folder." }, 409);
        return;
      }

      if (url === "/api/project" && req.method === "GET") {
        const query = new URLSearchParams(req.url.split("?")[1] || "");
        const model = await loadPrototype(activeDir);
        const demo = query.get("fresh") ? buildDemoFromLinks(model) : await demoForProject(activeDir, model);
        json({
          activeProject: activeName,
          start: model.start,
          screens: model.order,
          links: model.links,
          demo,
        });
        return;
      }

      if (url === "/api/demo" && req.method === "POST") {
        const body = await readJsonBody(req);
        const model = await loadPrototype(activeDir);
        const demo = normalizeDemo(body.demo);
        const { warnings } = validateDemo(demo, model);
        await writeFile(path.join(activeDir, DEMO_FILE), JSON.stringify(demo, null, 2) + "\n", "utf8");
        json({ ok: true, warnings });
        return;
      }

      if (url === "/api/preview" && req.method === "GET") {
        const model = await loadPrototype(activeDir);
        const demo = await demoForProject(activeDir, model);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(buildDemoHtml(model, demo));
        return;
      }

      // Import an audio file: raw body, ?name=&kind=. Saved under the project's assets.
      if (url === "/api/audio" && req.method === "POST") {
        const query = new URLSearchParams(req.url.split("?")[1] || "");
        const origName = query.get("name") || "audio";
        const kind = query.get("kind") === "voice" ? "voice" : "music";
        const ext = (path.extname(origName) || ".mp3").toLowerCase();
        const buf = await readRawBody(req);
        const assetsDir = path.join(activeDir, ASSETS_DIR);
        await mkdir(assetsDir, { recursive: true });
        const fileName = "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + ext;
        await writeFile(path.join(assetsDir, fileName), buf);
        json({ src: `${ASSETS_DIR}/${fileName}`, name: origName, kind });
        return;
      }

      // Stream an imported asset back for the preview's <audio>.
      if (url === "/api/asset" && req.method === "GET") {
        const query = new URLSearchParams(req.url.split("?")[1] || "");
        const src = query.get("src") || "";
        const abs = path.resolve(activeDir, src);
        if (!abs.startsWith(path.resolve(activeDir) + path.sep)) { json({ error: "bad path" }, 400); return; }
        if (!(await fileExists(abs))) { json({ error: "not found" }, 404); return; }
        res.setHeader("Content-Type", AUDIO_CT[path.extname(abs).toLowerCase()] || "application/octet-stream");
        await new Promise((resolve) => { const s = createReadStream(abs); s.on("error", () => resolve()); res.on("close", resolve); s.pipe(res); });
        return;
      }

      if (url === "/api/render" && req.method === "POST") {
        const body = await readJsonBody(req);
        await renderToResponse(res, activeDir, activeName, body);
        return;
      }

      next();
    } catch (err) {
      const msg = String(err?.message || err);
      // Surface the engine's "not installed" errors as 501, like CodeToUI's exports.
      const status = /isn't installed|ffmpeg/i.test(msg) ? 501 : 500;
      json({ error: msg }, status);
    }
  }

  async function renderToResponse(res, activeDir, name, body) {
    const model = await loadPrototype(activeDir);
    const demo = normalizeDemo(body.demo || (await demoForProject(activeDir, model)));
    validateDemo(demo, model); // throws on bad clips
    const format = body.format === "webm" ? "webm" : "mp4";

    const work = await mkdtemp(path.join(tmpdir(), "c2p-web-"));
    const framesDir = path.join(work, "frames");
    const outPath = path.join(work, `${name}.${format}`);
    // Resolve audio tracks to absolute file paths for ffmpeg (skip any missing files).
    const audio = [];
    for (const a of demo.audio || []) {
      const p = path.resolve(activeDir, a.src);
      if (p.startsWith(path.resolve(activeDir) + path.sep) && (await fileExists(p))) {
        audio.push({ path: p, start: a.start, volume: a.volume, trimStart: a.trimStart, trimEnd: a.trimEnd });
      }
    }
    try {
      const manifest = await captureDemo(model, demo, { framesDir, fps: demo.fps, format });
      await encode(manifest, outPath, audio);

      res.statusCode = 200;
      res.setHeader("Content-Type", format === "webm" ? "video/webm" : "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${name}.${format}"`);
      await new Promise((resolve, reject) => {
        const stream = createReadStream(outPath);
        stream.on("error", reject);
        res.on("finish", resolve);
        res.on("close", resolve);
        stream.pipe(res);
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  function close() {
    // No watcher/WebSocket to tear down.
  }

  return { middleware, close, setActive };
}

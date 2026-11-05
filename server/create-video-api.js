// The CodeToUI Motion web backend, independent of how it's hosted (Vite dev plugin now,
// an Electron shell later) — mirroring CodeToUI's createProtoApi factory so dev and
// desktop can't drift. It operates on one *active* project at a time within a projects
// root (CodeToUI's own root), and drives the engine to preview and render demo videos.

import { readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
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
    try {
      const manifest = await captureDemo(model, demo, { framesDir, fps: demo.fps, format });
      await encode(manifest, outPath);

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

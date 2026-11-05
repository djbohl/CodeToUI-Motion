// The CodeToPrototype web backend, independent of how it's hosted (Vite dev plugin
// now, an Electron shell later) — mirroring CodeToUI's createProtoApi factory so dev
// and desktop can't drift. It operates on one *active* project at a time within a
// projects root (CodeToUI's own root), and drives the Phase-1 engine to preview and
// render walkthrough videos.

import { readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { listProjects, readActive, writeActive } from "./projects.js";
import { loadPrototype } from "../src/load-project.js";
import { buildAutoWalk, validateScript, mergeDefaults } from "../src/walkthrough.js";
import { buildPlayerHtml } from "../src/player.js";
import { captureFrames } from "../src/capture.js";
import { encode } from "../src/encode.js";

const SCRIPT_FILE = "proto.video.json"; // saved walkthrough, per project (disk truth)

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

// The saved walkthrough for a project, or a fresh auto-walk if none is saved.
async function scriptForProject(activeDir, model) {
  const p = path.join(activeDir, SCRIPT_FILE);
  if (await fileExists(p)) {
    try {
      return JSON.parse(await readFile(p, "utf8"));
    } catch {
      /* corrupt — fall back to auto-walk */
    }
  }
  return buildAutoWalk(model);
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
        const script = query.get("fresh") ? buildAutoWalk(model) : await scriptForProject(activeDir, model);
        json({
          activeProject: activeName,
          start: model.start,
          screens: model.order,
          links: model.links,
          script,
        });
        return;
      }

      if (url === "/api/walkthrough" && req.method === "POST") {
        const body = await readJsonBody(req);
        const model = await loadPrototype(activeDir);
        const { warnings } = validateScript(body.script, model);
        await writeFile(
          path.join(activeDir, SCRIPT_FILE),
          JSON.stringify(body.script, null, 2) + "\n",
          "utf8"
        );
        json({ ok: true, warnings });
        return;
      }

      if (url === "/api/preview" && req.method === "GET") {
        const model = await loadPrototype(activeDir);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(buildPlayerHtml(model, { title: activeName }));
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
    const raw = body.script || (await scriptForProject(activeDir, model));
    validateScript(raw, model); // throws on bad steps
    const script = mergeDefaults(raw);
    if (body.format) script.format = body.format;
    if (body.fps != null) script.fps = Number(body.fps);

    const work = await mkdtemp(path.join(tmpdir(), "c2p-web-"));
    const framesDir = path.join(work, "frames");
    const outPath = path.join(work, `${name}.${script.format}`);
    try {
      const manifest = await captureFrames(model, script, {
        framesDir,
        width: Number(body.width) || 390,
        height: Number(body.height) || 800,
        scale: Number(body.scale) || 2,
        cursor: body.cursor !== false,
      });
      await encode(manifest, outPath);

      res.statusCode = 200;
      res.setHeader("Content-Type", script.format === "webm" ? "video/webm" : "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${name}.${script.format}"`);
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
    // No watcher/WebSocket to tear down in v1.
  }

  return { middleware, close, setActive };
}

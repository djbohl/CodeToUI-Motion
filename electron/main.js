// Electron shell for CodeToUI Motion. Mirrors CodeToUI's desktop approach: boot the same
// backend factory on a localhost HTTP server, serve the built client (vite build → dist),
// and load it in a BrowserWindow. Electron + electron-builder are opt-in (installed via
// `npm run app:setup`, not in dependencies) so a plain `npm install` / `npm run dev`
// stays light. A tiny built-in static server avoids any runtime dep for file serving.

import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createVideoApi } from "../server/create-video-api.js";
import { ensureProjectsRoot } from "../server/projects.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTTP_PORT = 5920; // distinct from dev (5900) and CodeToUI (5810)

let api = null;
let httpServer = null;

// Share CodeToUI's desktop projects root (its Electron app seeds Documents/CodeToUI
// Playground), so building in CodeToUI and making a demo here work off one folder.
// C2P_PROJECTS_ROOT overrides for power users.
function resolveProjectsRoot() {
  return process.env.C2P_PROJECTS_ROOT || path.join(app.getPath("documents"), "CodeToUI Playground");
}
function resolveClientDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "dist") : path.join(__dirname, "..", "dist");
}

const CT = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json",
};
async function serveStaticFile(clientDir, req, res) {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const abs = path.join(clientDir, rel);
  if (!abs.startsWith(clientDir)) { res.statusCode = 403; res.end("forbidden"); return; }
  try {
    const buf = await readFile(abs);
    res.setHeader("Content-Type", CT[path.extname(abs)] || "application/octet-stream");
    res.end(buf);
  } catch {
    try { // SPA fallback
      const buf = await readFile(path.join(clientDir, "index.html"));
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(buf);
    } catch { res.statusCode = 404; res.end("not found"); }
  }
}

async function startServer() {
  const projectsRoot = resolveProjectsRoot();
  const clientDir = resolveClientDir();
  const initialProject = await ensureProjectsRoot(projectsRoot);
  api = createVideoApi({ projectsRoot, initialProject });
  return new Promise((resolve, reject) => {
    httpServer = createServer((req, res) => api.middleware(req, res, () => serveStaticFile(clientDir, req, res)));
    httpServer.once("error", reject);
    httpServer.listen(HTTP_PORT, "127.0.0.1", () => resolve());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1300, height: 880, backgroundColor: "#0b0d11", title: "CodeToUI Motion",
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "allow" }));
  // Support a ?project= handoff: Electron could be launched with an arg later; for now
  // the window just opens the app and remembers its last active project.
  win.loadURL(`http://127.0.0.1:${HTTP_PORT}`);
  return win;
}

app.whenReady().then(async () => {
  try { await startServer(); } catch (err) { console.error("Failed to start local server:", err); }
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("will-quit", () => { api?.close(); httpServer?.close(); });

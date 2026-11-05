// Vite dev plugin that mounts the CodeToPrototype backend onto Vite's connect
// middleware server — mirroring CodeToUI's server/plugin.js. The same factory will
// later be mounted by an Electron shell (Phase 3), so dev and desktop can't drift.
//
// The projects root points at CodeToUI's own projects folder so both tools share one
// source of truth on disk. Set it with C2P_PROJECTS_ROOT (an absolute path, or one
// relative to the dev cwd); it falls back to this repo's ./projects.

import path from "node:path";
import { createVideoApi } from "./create-video-api.js";
import { ensureProjectsRoot } from "./projects.js";

export function resolveProjectsRoot() {
  const env = process.env.C2P_PROJECTS_ROOT;
  return env ? path.resolve(process.cwd(), env) : path.resolve(process.cwd(), "projects");
}

export function videoDevPlugin() {
  return {
    name: "codetoprototype-dev-server",
    async configureServer(server) {
      const projectsRoot = resolveProjectsRoot();
      const initialProject = await ensureProjectsRoot(projectsRoot);
      const api = createVideoApi({ projectsRoot, initialProject });
      server.middlewares.use(api.middleware);
      server.httpServer?.once("close", () => api.close());
    },
  };
}

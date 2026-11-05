// Projects-root + active-project helpers.
//
// Adapted (trimmed) from CodeToUI Playground's server/projects.js. CodeToPrototype
// does NOT create projects — it points at CodeToUI's own projects root and reads
// what's there — so there's no scaffolding here. The active project is tracked in a
// sibling `.active` dotfile, exactly as CodeToUI does, so both tools agree.

import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const ACTIVE_FILE = ".active";

/** Project folders are the direct, non-dotfile subdirectories of the projects root. */
export async function listProjects(projectsRoot) {
  try {
    const entries = await readdir(projectsRoot, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function readActive(projectsRoot) {
  try {
    const name = (await readFile(path.join(projectsRoot, ACTIVE_FILE), "utf8")).trim();
    const projects = await listProjects(projectsRoot);
    if (projects.includes(name)) return name;
  } catch {
    /* fall through */
  }
  const projects = await listProjects(projectsRoot);
  return projects[0] || null;
}

export async function writeActive(projectsRoot, name) {
  await writeFile(path.join(projectsRoot, ACTIVE_FILE), name + "\n", "utf8");
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the projects root exists (we don't seed it — that's CodeToUI's job).
 * Returns the resolved active project name, or null if the root has no projects.
 */
export async function ensureProjectsRoot(projectsRoot) {
  if (!(await exists(projectsRoot))) await mkdir(projectsRoot, { recursive: true });
  return readActive(projectsRoot);
}

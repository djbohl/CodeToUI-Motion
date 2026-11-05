import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, cp, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createVideoApi } from "../server/create-video-api.js";

const DEMO_SRC = "/Users/linksys/Downloads/code-design/projects/Demo";

async function seedRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "c2p-root-"));
  await cp(DEMO_SRC, path.join(root, "Demo"), { recursive: true });
  return root;
}
function mockReq(method, url, bodyObj) {
  const body = bodyObj !== undefined ? JSON.stringify(bodyObj) : "";
  const r = Readable.from([Buffer.from(body)]);
  r.url = url;
  r.method = method;
  return r;
}
function mockRes() {
  return { statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(d) { this.body = d; }, on() {} };
}
async function call(api, method, url, body) {
  const res = mockRes();
  let nextCalled = false;
  await api.middleware(mockReq(method, url, body), res, () => (nextCalled = true));
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { res, nextCalled, json };
}

test("GET /api/ping reports liveness without an active project", async () => {
  const api = createVideoApi({ projectsRoot: "/nonexistent", initialProject: null });
  const { res, json } = await call(api, "GET", "/api/ping");
  assert.equal(res.statusCode, 200);
  assert.equal(json.ok, true);
  assert.equal(json.app, "codetoui-motion");
});

test("GET /api/projects lists projects + active", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { res, json } = await call(api, "GET", "/api/projects");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(json.projects, ["Demo"]);
  assert.equal(json.active, "Demo");
});

test("GET /api/project?fresh=1 returns a freshly seeded demo", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  // ?fresh=1 forces a seed from the links flow, independent of any saved proto.demo.json
  // that a real Demo folder might carry.
  const { json } = await call(api, "GET", "/api/project?fresh=1");
  assert.equal(json.activeProject, "Demo");
  assert.deepEqual(json.screens.sort(), ["Home", "Login"]);
  assert.deepEqual(json.demo.clips.map((c) => c.screen), ["Login", "Home", "Login"]);
  assert.equal(json.demo.clips[1].transitionIn.type, "slide-up");
});

test("POST /api/demo validates + writes proto.demo.json, served back next GET", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { json: proj } = await call(api, "GET", "/api/project");
  const edited = { ...proj.demo, clips: proj.demo.clips.slice(0, 2) };
  const { res, json } = await call(api, "POST", "/api/demo", { demo: edited });
  assert.equal(res.statusCode, 200);
  assert.equal(json.ok, true);
  const saved = path.join(root, "Demo", "proto.demo.json");
  await stat(saved);
  const parsed = JSON.parse(await readFile(saved, "utf8"));
  assert.equal(parsed.clips.length, 2);
  const { json: again } = await call(api, "GET", "/api/project");
  assert.equal(again.demo.clips.length, 2);
});

test("POST /api/demo rejects an unknown screen", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { res, json } = await call(api, "POST", "/api/demo", { demo: { clips: [{ type: "screen", screen: "Ghost", duration: 1000 }] } });
  assert.equal(res.statusCode, 500);
  assert.match(json.error, /unknown screen/i);
});

test("GET /api/preview serves the demo renderer HTML", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { res } = await call(api, "GET", "/api/preview");
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.body, /window\.__demo/);
  assert.match(res.body, /el-4fb756/);
});

test("POST /api/projects/active switches, 404 on unknown; non-/api falls through", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  assert.equal((await call(api, "POST", "/api/projects/active", { name: "Demo" })).res.statusCode, 200);
  assert.equal((await call(api, "POST", "/api/projects/active", { name: "Nope" })).res.statusCode, 404);
  assert.equal((await call(api, "GET", "/index.html")).nextCalled, true);
});

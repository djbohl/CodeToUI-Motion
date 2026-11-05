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
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(d) { this.body = d; },
    on() {},
  };
}
async function call(api, method, url, body) {
  const res = mockRes();
  let nextCalled = false;
  await api.middleware(mockReq(method, url, body), res, () => (nextCalled = true));
  return { res, nextCalled, json: tryJson(res.body) };
}
function tryJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

test("GET /api/projects lists projects + active", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { res, json } = await call(api, "GET", "/api/projects");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(json.projects, ["Demo"]);
  assert.equal(json.active, "Demo");
});

test("GET /api/project returns model summary + auto-walk script", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { json } = await call(api, "GET", "/api/project");
  assert.equal(json.activeProject, "Demo");
  assert.equal(json.start, "Login");
  assert.deepEqual(json.screens.sort(), ["Home", "Login"]);
  assert.equal(json.links[0].elementId, "el-4fb756");
  assert.ok(json.script.steps.length >= 2, "has a walkthrough");
  assert.equal(json.script.steps[1].click, "el-4fb756");
});

test("POST /api/walkthrough validates + writes proto.video.json", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { json: proj } = await call(api, "GET", "/api/project");
  const { res, json } = await call(api, "POST", "/api/walkthrough", { script: proj.script });
  assert.equal(res.statusCode, 200);
  assert.equal(json.ok, true);
  const saved = path.join(root, "Demo", "proto.video.json");
  await stat(saved); // throws if missing
  const parsed = JSON.parse(await readFile(saved, "utf8"));
  assert.equal(parsed.steps[1].click, "el-4fb756");

  // A saved script is served back by GET /api/project (not a fresh auto-walk).
  const { json: again } = await call(api, "GET", "/api/project");
  assert.deepEqual(again.script.steps.length, parsed.steps.length);
});

test("POST /api/walkthrough rejects an unknown screen", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { res, json } = await call(api, "POST", "/api/walkthrough", { script: { steps: [{ screen: "Ghost" }] } });
  assert.equal(res.statusCode, 500);
  assert.match(json.error, /unknown screen/i);
});

test("GET /api/preview serves the player HTML", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { res } = await call(api, "GET", "/api/preview");
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.body, /window\.__proto/);
  assert.match(res.body, /el-4fb756/);
});

test("POST /api/projects/active switches, 404 on unknown", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const ok = await call(api, "POST", "/api/projects/active", { name: "Demo" });
  assert.equal(ok.res.statusCode, 200);
  const bad = await call(api, "POST", "/api/projects/active", { name: "Nope" });
  assert.equal(bad.res.statusCode, 404);
});

test("non-/api/ URLs fall through to next()", async () => {
  const root = await seedRoot();
  const api = createVideoApi({ projectsRoot: root, initialProject: "Demo" });
  const { nextCalled } = await call(api, "GET", "/index.html");
  assert.equal(nextCalled, true);
});

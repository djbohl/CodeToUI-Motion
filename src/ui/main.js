// CodeToUI Motion — the demo editor. A timeline of clips you scrub and play, with
// visible transitions and captions, rendered live in a same-origin preview iframe (the
// demo renderer), and exported to video on demand. Looks like CodeToUI.
//
// The preview iframe embeds the project's screens once (/api/preview); on every edit we
// push the in-memory clips into it via contentWindow.__demo.load() — no reload, no save
// round-trip. Edits autosave to proto.demo.json (debounced).

const $ = (s) => document.querySelector(s);
const PPS = 90; // timeline pixels per second
const TRANSITIONS = ["instant", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down"];

const state = {
  project: null,
  screens: [],
  demo: { version: 1, fps: 30, size: { width: 390, height: 844 }, clips: [], audio: [] },
  selectedId: null,
};

// --- REST -------------------------------------------------------------------
const jsonHeaders = { "Content-Type": "application/json" };
async function api(path, opts) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) throw new Error(ct.includes("json") ? (await res.json()).error : res.statusText);
  return ct.includes("json") ? res.json() : res;
}
function setStatus(msg, kind = "") {
  const el = $("#status");
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

// --- preview renderer bridge ------------------------------------------------
function renderer() {
  try { return $("#preview").contentWindow.__demo || null; } catch { return null; }
}
function whenRendererReady() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function poll() {
      if (renderer()) return resolve(renderer());
      if (Date.now() - t0 > 5000) return resolve(null);
      setTimeout(poll, 40);
    })();
  });
}
function pushToRenderer() {
  const r = renderer();
  if (r) r.load(state.demo.clips, state.demo.size);
}
async function reloadPreview() {
  $("#preview").src = "/api/preview?t=" + Date.now();
  await new Promise((res) => $("#preview").addEventListener("load", res, { once: true }));
  await whenRendererReady();
  pushToRenderer();
  fitPreview();
}

// --- autosave ---------------------------------------------------------------
let saveTimer = null;
function markDirty() {
  pushToRenderer();
  renderTimeline();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}
async function save() {
  try {
    const { warnings } = await api("/api/demo", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ demo: state.demo }) });
    setStatus(warnings?.length ? "Saved · " + warnings.join(" ") : "Saved.", warnings?.length ? "warn" : "ok");
  } catch (e) {
    setStatus("Save failed: " + e.message, "error");
  }
}

// --- clip helpers -----------------------------------------------------------
function selectedClip() {
  return state.demo.clips.find((c) => c.id === state.selectedId) || null;
}
function totalMs() {
  return state.demo.clips.reduce((n, c) => n + c.duration, 0);
}
function newClip(screen) {
  return {
    id: "c" + Math.random().toString(36).slice(2, 8),
    type: "screen",
    screen,
    duration: 2000,
    transitionIn: { type: "instant", duration: 0 },
    captions: [],
  };
}
function addClip(screen) {
  const c = newClip(screen);
  state.demo.clips.push(c);
  state.selectedId = c.id;
  renderInspector();
  markDirty();
}

// --- palette ----------------------------------------------------------------
function renderPalette() {
  const ul = $("#screen-palette");
  ul.innerHTML = "";
  state.screens.forEach((name) => {
    const li = document.createElement("li");
    li.textContent = name;
    li.title = "Add " + name + " as a clip";
    li.onclick = () => addClip(name);
    ul.appendChild(li);
  });
}

// --- timeline ---------------------------------------------------------------
function renderRuler() {
  const ruler = $("#ruler");
  const secs = Math.max(1, Math.ceil(totalMs() / 1000) + 1);
  ruler.style.width = secs * PPS + "px";
  ruler.innerHTML = "";
  for (let s = 0; s <= secs; s++) {
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = s * PPS + "px";
    tick.textContent = s + "s";
    ruler.appendChild(tick);
  }
}
function renderTimeline() {
  renderRuler();
  const track = $("#track");
  track.style.width = $("#ruler").style.width;
  track.innerHTML = "";
  let x = 0;
  for (const c of state.demo.clips) {
    const w = (c.duration / 1000) * PPS;
    const el = document.createElement("div");
    el.className = "clip" + (c.id === state.selectedId ? " selected" : "");
    el.style.left = x + "px";
    el.style.width = w + "px";
    el.dataset.id = c.id;
    const label = c.type === "screen" ? c.screen : "canvas";
    const tr = c.transitionIn?.type && c.transitionIn.type !== "instant" ? `↷${c.transitionIn.type}` : "";
    el.innerHTML = `<span class="clip-label">${label}</span><span class="clip-sub">${(c.duration / 1000).toFixed(1)}s ${tr}</span><span class="clip-resize" title="Drag to retime"></span>`;
    track.appendChild(el);
    x += w;
  }
}

// Pointer handling on the timeline: scrub (empty/ruler), select+drag-reorder (clip body),
// resize (right-edge handle).
function initTimelinePointer() {
  const scroll = $("#timeline-scroll");
  let mode = null; // "scrub" | "drag" | "resize"
  let clipId = null, startX = 0, startDur = 0;

  const timeAtClientX = (clientX) => {
    const rect = scroll.getBoundingClientRect();
    const x = clientX - rect.left + scroll.scrollLeft;
    return Math.max(0, (x / PPS) * 1000);
  };

  scroll.addEventListener("pointerdown", (e) => {
    const clipEl = e.target.closest(".clip");
    if (e.target.classList.contains("clip-resize")) {
      mode = "resize"; clipId = clipEl.dataset.id; startX = e.clientX;
      startDur = state.demo.clips.find((c) => c.id === clipId).duration;
    } else if (clipEl) {
      mode = "drag"; clipId = clipEl.dataset.id; startX = e.clientX;
      state.selectedId = clipId; renderInspector(); renderTimeline();
      const r = renderer(); if (r) r.seek(clipStart(clipId));
    } else {
      mode = "scrub"; const r = renderer(); if (r) r.seek(timeAtClientX(e.clientX)); updatePlayhead();
    }
    scroll.setPointerCapture(e.pointerId);
  });

  scroll.addEventListener("pointermove", (e) => {
    if (!mode) return;
    if (mode === "scrub") {
      const r = renderer(); if (r) r.seek(timeAtClientX(e.clientX)); updatePlayhead();
    } else if (mode === "resize") {
      const c = state.demo.clips.find((x) => x.id === clipId);
      c.duration = Math.max(200, Math.round((startDur + ((e.clientX - startX) / PPS) * 1000) / 50) * 50);
      renderTimeline(); renderInspector(); pushToRenderer();
    } else if (mode === "drag") {
      // reorder preview: compute target index from pointer position
      const idx = indexAtClientX(e.clientX);
      reorderTo(clipId, idx);
    }
  });

  const end = (e) => {
    if (mode === "resize" || mode === "drag") markDirty();
    mode = null; clipId = null;
    try { scroll.releasePointerCapture(e.pointerId); } catch {}
  };
  scroll.addEventListener("pointerup", end);
  scroll.addEventListener("pointercancel", end);
}
function clipStart(id) {
  let t = 0;
  for (const c of state.demo.clips) { if (c.id === id) return t; t += c.duration; }
  return 0;
}
function indexAtClientX(clientX) {
  const scroll = $("#timeline-scroll");
  const rect = scroll.getBoundingClientRect();
  const x = clientX - rect.left + scroll.scrollLeft;
  let acc = 0, i = 0;
  for (const c of state.demo.clips) {
    const w = (c.duration / 1000) * PPS;
    if (x < acc + w / 2) return i;
    acc += w; i++;
  }
  return state.demo.clips.length - 1;
}
function reorderTo(id, idx) {
  const from = state.demo.clips.findIndex((c) => c.id === id);
  if (from === -1 || from === idx) return;
  const [c] = state.demo.clips.splice(from, 1);
  state.demo.clips.splice(idx, 0, c);
  renderTimeline(); pushToRenderer();
}

// --- playhead / transport ---------------------------------------------------
function updatePlayhead() {
  const r = renderer();
  const t = r ? r.time() : 0;
  const total = r ? r.duration() : totalMs();
  $("#playhead").style.left = (t / 1000) * PPS + "px";
  $("#timecode").textContent = `${(t / 1000).toFixed(1)}s / ${(total / 1000).toFixed(1)}s`;
  $("#play-pause").textContent = r && r.playing() ? "⏸" : "▶";
}
function transportLoop() {
  updatePlayhead();
  requestAnimationFrame(transportLoop);
}

// --- inspector --------------------------------------------------------------
function field(label, control) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}
function renderInspector() {
  const body = $("#inspector-body");
  const c = selectedClip();
  body.innerHTML = "";
  if (!c) { body.innerHTML = '<p class="inspector-empty">Select a clip in the timeline.</p>'; return; }

  // Screen
  const scr = document.createElement("select");
  state.screens.forEach((n) => { const o = document.createElement("option"); o.value = n; o.textContent = n; o.selected = n === c.screen; scr.appendChild(o); });
  scr.onchange = () => { c.screen = scr.value; markDirty(); };
  body.appendChild(field("Screen", scr));

  // Duration
  const dur = document.createElement("input");
  dur.type = "number"; dur.min = 200; dur.step = 100; dur.value = c.duration;
  dur.onchange = () => { c.duration = Math.max(200, Number(dur.value) || 200); markDirty(); renderInspector(); };
  body.appendChild(field("Duration (ms)", dur));

  // Transition
  const tr = document.createElement("select");
  TRANSITIONS.forEach((t) => { const o = document.createElement("option"); o.value = t; o.textContent = t; o.selected = t === c.transitionIn.type; tr.appendChild(o); });
  tr.onchange = () => {
    c.transitionIn.type = tr.value;
    if (tr.value === "instant") c.transitionIn.duration = 0;
    else if (!c.transitionIn.duration) c.transitionIn.duration = 400;
    markDirty(); renderInspector();
  };
  body.appendChild(field("Transition in", tr));

  if (c.transitionIn.type !== "instant") {
    const td = document.createElement("input");
    td.type = "number"; td.min = 0; td.step = 50; td.value = c.transitionIn.duration;
    td.onchange = () => { c.transitionIn.duration = Math.max(0, Number(td.value) || 0); markDirty(); };
    body.appendChild(field("Transition (ms)", td));
  }

  // Captions
  const capTitle = document.createElement("div");
  capTitle.className = "inspector-subtitle";
  capTitle.textContent = "Captions";
  body.appendChild(capTitle);
  (c.captions || []).forEach((cap, i) => body.appendChild(renderCaptionRow(c, cap, i)));
  const addCap = document.createElement("button");
  addCap.className = "topbar-btn btn-wide";
  addCap.textContent = "+ Caption";
  addCap.onclick = () => { (c.captions ||= []).push({ text: "Caption", at: 0, for: Math.min(1200, c.duration) }); renderInspector(); markDirty(); };
  body.appendChild(addCap);

  // Clip actions
  const actions = document.createElement("div");
  actions.className = "inspector-actions";
  actions.append(
    mkBtn("Duplicate", () => { const d = { ...c, id: "c" + Math.random().toString(36).slice(2, 8), captions: c.captions.map((x) => ({ ...x })) }; const idx = state.demo.clips.indexOf(c); state.demo.clips.splice(idx + 1, 0, d); state.selectedId = d.id; renderInspector(); markDirty(); }),
    mkBtn("Delete", () => { state.demo.clips = state.demo.clips.filter((x) => x !== c); state.selectedId = null; renderInspector(); markDirty(); })
  );
  body.appendChild(actions);
}
function renderCaptionRow(clip, cap, i) {
  const row = document.createElement("div");
  row.className = "caption-row";
  const text = document.createElement("input");
  text.type = "text"; text.value = cap.text; text.placeholder = "text";
  text.oninput = () => { cap.text = text.value; markDirty(); };
  const at = document.createElement("input");
  at.type = "number"; at.min = 0; at.step = 100; at.value = cap.at; at.title = "start (ms)";
  at.onchange = () => { cap.at = Math.max(0, Number(at.value) || 0); markDirty(); };
  const dur = document.createElement("input");
  dur.type = "number"; dur.min = 0; dur.step = 100; dur.value = cap.for; dur.title = "duration (ms)";
  dur.onchange = () => { cap.for = Math.max(0, Number(dur.value) || 0); markDirty(); };
  const del = document.createElement("button");
  del.className = "topbar-btn"; del.textContent = "✕";
  del.onclick = () => { clip.captions.splice(i, 1); renderInspector(); markDirty(); };
  row.append(text, at, dur, del);
  return row;
}
function mkBtn(label, onClick) {
  const b = document.createElement("button");
  b.className = "topbar-btn"; b.textContent = label; b.onclick = onClick;
  return b;
}

// --- preview fit ------------------------------------------------------------
function fitPreview() {
  const pane = $("#stage-pane");
  const { width, height } = state.demo.size;
  const availW = pane.clientWidth - 48;
  const availH = pane.clientHeight - 48;
  const scale = Math.max(0.1, Math.min(1, availW / width, availH / height));
  const f = $("#preview");
  f.style.width = width + "px";
  f.style.height = height + "px";
  f.style.transform = `scale(${scale})`;
}

// --- export -----------------------------------------------------------------
async function doExport() {
  const btn = $("#export");
  btn.disabled = true;
  try {
    setStatus("Rendering… headless Chromium + ffmpeg, this can take a bit.");
    const res = await fetch("/api/render", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ demo: state.demo, format: $("#format").value }) });
    if (!res.ok) throw new Error((res.headers.get("content-type") || "").includes("json") ? (await res.json()).error : res.statusText);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.project}.${$("#format").value}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus("Rendered.", "ok");
  } catch (e) {
    setStatus("Render failed: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// --- load / boot ------------------------------------------------------------
async function loadProject(fresh = false, reload = false) {
  const data = await api("/api/project" + (fresh ? "?fresh=1" : ""));
  state.project = data.activeProject;
  state.screens = data.screens;
  state.demo = data.demo;
  state.selectedId = state.demo.clips[0]?.id || null;
  $("#current-project").textContent = state.project;
  renderPalette();
  renderTimeline();
  renderInspector();
  if (reload) await reloadPreview(); else { pushToRenderer(); fitPreview(); }
  setStatus(fresh ? "Re-seeded from the prototype flow." : "");
}

async function main() {
  // theme
  $("#theme").onclick = () => {
    const html = document.documentElement;
    const light = html.getAttribute("data-theme") === "light";
    html.setAttribute("data-theme", light ? "dark" : "light");
    $("#theme").textContent = light ? "☾ Dark" : "☀ Light";
  };
  // transport
  $("#play-pause").onclick = () => { const r = renderer(); if (!r) return; r.playing() ? r.pause() : r.play(); };
  $("#to-start").onclick = () => { const r = renderer(); if (r) r.seek(0); };
  $("#seed-flow").onclick = async () => {
    if (!confirm("Rebuild the timeline from the prototype's click-flow? Unsaved edits are replaced.")) return;
    await loadProject(true, false); markDirty();
  };
  $("#export").onclick = doExport;
  $("#format").onchange = () => {};
  $("#project-switch").onclick = () => switchProjectPrompt();

  initTimelinePointer();
  window.addEventListener("resize", fitPreview);
  transportLoop();

  // boot: ?project=<name> handoff from CodeToUI
  try {
    const wanted = new URLSearchParams(location.search).get("project");
    if (wanted) await api("/api/projects/active", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: wanted }) }).catch(() => {});
    // initial preview iframe load (embeds this project's screens)
    $("#preview").src = "/api/preview";
    await new Promise((res) => $("#preview").addEventListener("load", res, { once: true }));
    await whenRendererReady();
    await loadProject(false, false);
  } catch (e) {
    setStatus("Could not load a project: " + e.message + " — set C2P_PROJECTS_ROOT to a CodeToUI projects folder.", "error");
  }
}

async function switchProjectPrompt() {
  try {
    const { projects, active } = await api("/api/projects");
    const name = prompt("Switch to project:\n" + projects.join(", "), active);
    if (!name || name === active || !projects.includes(name)) return;
    await api("/api/projects/active", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name }) });
    await loadProject(false, true); // reload preview: different screens embedded
  } catch (e) {
    setStatus("Switch failed: " + e.message, "error");
  }
}

main();

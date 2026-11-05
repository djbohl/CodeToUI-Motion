// CodeToUI Motion — the demo editor. A timeline of clips you scrub and play, with
// visible transitions and captions, rendered live in a same-origin preview iframe (the
// demo renderer), and exported to video on demand. Looks like CodeToUI.
//
// The preview iframe embeds the project's screens once (/api/preview); on every edit we
// push the in-memory clips into it via contentWindow.__demo.load() — no reload, no save
// round-trip. Edits autosave to proto.demo.json (debounced).

import { initPet } from "./pet.js";

const $ = (s) => document.querySelector(s);
const PPS = 90; // timeline pixels per second
const ANIM_PRESETS = ["none", "pop", "fade", "scale", "slide-up", "slide-down", "slide-left", "slide-right"];
const EASINGS = ["ease-out", "ease-in", "ease-in-out", "linear", "ease"];
let pet = null;
let everPlayed = false;
const TRANSITIONS = ["instant", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down"];

const state = {
  project: null,
  screens: [],
  demo: { version: 1, fps: 30, size: { width: 390, height: 844 }, clips: [], audio: [] },
  selectedId: null,
  selectedElementId: null,
  selectedAudioId: null,
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
function pushAudioToRenderer() {
  const r = renderer();
  if (!r || !r.setAudio) return;
  r.setAudio((state.demo.audio || []).map((a) => ({
    id: a.id, url: "/api/asset?src=" + encodeURIComponent(a.src),
    start: a.start, volume: a.volume, trimStart: a.trimStart, trimEnd: a.trimEnd,
  })));
}
async function reloadPreview() {
  $("#preview").src = "/api/preview?t=" + Date.now();
  await new Promise((res) => $("#preview").addEventListener("load", res, { once: true }));
  await whenRendererReady();
  pushToRenderer();
  fitPreview();
}

// --- autosave + undo --------------------------------------------------------
let saveTimer = null;
let undoStack = [];
let lastSnapshot = null; // JSON of the last committed demo; the undo baseline
function resetHistory() {
  undoStack = [];
  lastSnapshot = JSON.stringify(state.demo);
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}
function undo() {
  if (!undoStack.length) { setStatus("Nothing to undo.", "warn"); return; }
  const prev = undoStack.pop();
  state.demo = JSON.parse(prev);
  lastSnapshot = prev;
  if (!state.demo.clips.some((c) => c.id === state.selectedId)) state.selectedId = state.demo.clips[0]?.id || null;
  state.selectedElementId = null;
  renderTimeline(); renderInspector(); pushToRenderer(); fitPreview();
  scheduleSave();
  setStatus("Undone.");
}
// Structural/content change: remount the renderer + redraw the timeline.
function markDirty() {
  pushToRenderer();
  renderTimeline();
  scheduleSave();
}
// Live tweak (transform/animation/hidden): re-apply in place, no remount, no flicker.
function markDirtyLive() {
  const r = renderer();
  if (r && r.refresh) r.refresh();
  scheduleSave();
}
async function save() {
  // Record one undo step per settled edit burst (not per keystroke/drag frame).
  const cur = JSON.stringify(state.demo);
  if (lastSnapshot != null && cur !== lastSnapshot) {
    undoStack.push(lastSnapshot);
    if (undoStack.length > 50) undoStack.shift();
    lastSnapshot = cur;
  }
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
  pet?.react("clipAdded");
}
function addCanvasClip() {
  const c = {
    id: "c" + Math.random().toString(36).slice(2, 8),
    type: "canvas",
    screen: null,
    duration: 2000,
    transitionIn: { type: "instant", duration: 0 },
    captions: [],
    elements: [],
  };
  state.demo.clips.push(c);
  state.selectedId = c.id;
  state.selectedElementId = null;
  renderInspector();
  markDirty();
  pet?.react("clipAdded");
}
// The animatable items on a clip: element overrides (screen) or canvas elements.
function clipElements(c) {
  if (c.type === "canvas") return (c.elements ||= []);
  return (c.overrides ||= []);
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
  const canvasBtn = document.createElement("button");
  canvasBtn.className = "topbar-btn btn-wide";
  canvasBtn.textContent = "+ Blank canvas";
  canvasBtn.title = "Add a blank-canvas clip (title card, callout, etc.)";
  canvasBtn.style.marginTop = "8px";
  canvasBtn.onclick = addCanvasClip;
  ul.appendChild(canvasBtn); // inside #screen-palette so re-render clears it too
}

// --- timeline ---------------------------------------------------------------
function timelineWidthMs() {
  let w = totalMs();
  for (const a of state.demo.audio || []) w = Math.max(w, a.start + audioLen(a));
  return w;
}
function renderRuler() {
  const ruler = $("#ruler");
  const secs = Math.max(1, Math.ceil(timelineWidthMs() / 1000) + 1);
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
  renderAudioLane();
}
function audioLen(a) {
  const src = a.trimEnd != null ? a.trimEnd : a.dur != null ? a.dur : 3000;
  return Math.max(200, src - a.trimStart);
}
function renderAudioLane() {
  const lane = $("#audio-track");
  lane.style.width = $("#ruler").style.width;
  lane.innerHTML = "";
  for (const a of state.demo.audio || []) {
    const el = document.createElement("div");
    el.className = `audio-clip ${a.kind}` + (a.id === state.selectedAudioId ? " selected" : "");
    el.style.left = (a.start / 1000) * PPS + "px";
    el.style.width = (audioLen(a) / 1000) * PPS + "px";
    el.dataset.audioId = a.id;
    el.innerHTML = `<span class="clip-label">${a.kind === "voice" ? "🎙" : "♪"} ${a.name || a.kind}</span><span class="clip-sub">${(audioLen(a) / 1000).toFixed(1)}s · vol ${Math.round((a.volume ?? 1) * 100)}%</span><span class="audio-resize" title="Drag to trim the end"></span>`;
    lane.appendChild(el);
  }
}
function selectedAudio() {
  return (state.demo.audio || []).find((a) => a.id === state.selectedAudioId) || null;
}
function selectAudio(id) {
  state.selectedAudioId = id;
  renderInspector();
  renderTimeline();
}
// Audio edits: update the renderer's tracks + redraw the lane, then autosave.
function markAudioDirty() {
  pushAudioToRenderer();
  renderTimeline();
  scheduleSave();
}
let pendingAudioKind = "music";
function importAudio(kind) { pendingAudioKind = kind; $("#audio-file").click(); }
function readAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const au = new Audio();
    au.preload = "metadata";
    au.onloadedmetadata = () => { resolve(isFinite(au.duration) ? Math.round(au.duration * 1000) : null); URL.revokeObjectURL(url); };
    au.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    au.src = url;
  });
}
// --- voiceover recording (MediaRecorder) ------------------------------------
let mediaRec = null, recChunks = [], recStart = 0, recTimer = null;
function updateRecLabel(on) {
  const b = $("#rec-voice");
  if (!b) return;
  if (on) {
    const s = Math.floor((Date.now() - recStart) / 1000);
    b.textContent = `■ Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    b.classList.add("recording");
  } else { b.textContent = "● Record"; b.classList.remove("recording"); }
}
async function toggleRecord() {
  if (mediaRec && mediaRec.state === "recording") { mediaRec.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setStatus("Recording isn't supported in this browser.", "warn"); return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recChunks = [];
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
    mediaRec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimer); updateRecLabel(false);
      const blob = new Blob(recChunks, { type: mediaRec.mimeType || "audio/webm" });
      blob.name = "voiceover.webm"; // give uploadAudio a filename for the extension
      await uploadAudio(blob, "voice");
    };
    mediaRec.start(); recStart = Date.now(); updateRecLabel(true);
    recTimer = setInterval(() => updateRecLabel(true), 500);
    setStatus("Recording… click Stop when you're done.");
  } catch (e) {
    setStatus("Microphone access failed: " + e.message, "error");
  }
}
async function uploadAudio(file, kind) {
  try {
    setStatus(`Importing ${file.name}…`);
    const dur = await readAudioDuration(file);
    const res = await fetch(`/api/audio?name=${encodeURIComponent(file.name)}&kind=${kind}`, { method: "POST", body: file });
    if (!res.ok) throw new Error((res.headers.get("content-type") || "").includes("json") ? (await res.json()).error : res.statusText);
    const { src, name } = await res.json();
    const a = { id: "a" + Math.random().toString(36).slice(2, 8), kind, src, name, start: Math.round(playT), volume: 1, trimStart: 0, trimEnd: null, dur };
    (state.demo.audio ||= []).push(a);
    state.selectedAudioId = a.id;
    renderInspector();
    markAudioDirty();
    setStatus(`Added ${name}.`, "ok");
  } catch (e) {
    setStatus("Import failed: " + e.message, "error");
  }
}
function renderAudioInspector(body, a) {
  body.innerHTML = "";
  const title = document.createElement("div");
  title.className = "inspector-subtitle";
  title.textContent = a.kind === "voice" ? "Voiceover" : "Music";
  body.appendChild(title);

  const nm = document.createElement("div");
  nm.style.cssText = "font-size:12px;color:var(--text);word-break:break-all";
  nm.textContent = a.name || a.src;
  body.appendChild(nm);

  const kind = document.createElement("select");
  [["music", "Music"], ["voice", "Voiceover"]].forEach(([v, lbl]) => { const o = document.createElement("option"); o.value = v; o.textContent = lbl; o.selected = a.kind === v; kind.appendChild(o); });
  kind.onchange = () => { a.kind = kind.value; markAudioDirty(); };
  body.appendChild(field("Track", kind));

  body.appendChild(field("Start (ms)", numberInput(a.start, (v) => { a.start = Math.max(0, v || 0); markAudioDirty(); }, 0, 600000, 50)));
  body.appendChild(field("Volume (0–1)", numberInput(a.volume, (v) => { a.volume = Math.min(1, Math.max(0, v ?? 1)); markAudioDirty(); }, 0, 1, 0.05)));
  body.appendChild(field("Trim start (ms)", numberInput(a.trimStart, (v) => { a.trimStart = Math.max(0, v || 0); markAudioDirty(); }, 0, 600000, 50)));

  const te = document.createElement("input");
  te.type = "number"; te.min = 0; te.step = 50; te.placeholder = "end of file";
  if (a.trimEnd != null) te.value = a.trimEnd;
  te.onchange = () => { a.trimEnd = te.value === "" ? null : Math.max(0, Number(te.value) || 0); markAudioDirty(); };
  body.appendChild(field("Trim end (ms)", te));

  // Snap the track's end to the video's end (plays from its start to the last clip).
  body.appendChild(mkBtn("Fit to video length", () => {
    const len = Math.max(200, totalMs() - a.start);
    let end = a.trimStart + len;
    if (a.dur != null) end = Math.min(end, a.dur);
    a.trimEnd = end;
    renderInspector(); markAudioDirty();
  }));

  body.appendChild(mkBtn("Remove track", () => {
    state.demo.audio = state.demo.audio.filter((x) => x !== a);
    state.selectedAudioId = null;
    renderInspector(); markAudioDirty();
  }));
}

// Pointer handling on the timeline: scrub (empty/ruler), select+drag-reorder (clip body),
// resize (right-edge handle).
function initTimelinePointer() {
  const scroll = $("#timeline-scroll");
  let mode = null; // "scrub" | "drag" | "resize" | "audio"
  let clipId = null, startX = 0, startDur = 0, audioId = null, startAudioStart = 0, startAudioLen = 0;

  const timeAtClientX = (clientX) => {
    const rect = scroll.getBoundingClientRect();
    const x = clientX - rect.left + scroll.scrollLeft;
    return Math.max(0, (x / PPS) * 1000);
  };

  scroll.addEventListener("pointerdown", (e) => {
    const clipEl = e.target.closest(".clip");
    const audioEl = e.target.closest(".audio-clip");
    if (e.target.classList.contains("clip-resize")) {
      mode = "resize"; clipId = clipEl.dataset.id; startX = e.clientX;
      startDur = state.demo.clips.find((c) => c.id === clipId).duration;
    } else if (e.target.classList.contains("audio-resize")) {
      mode = "audioResize"; audioId = audioEl.dataset.audioId; startX = e.clientX;
      startAudioLen = audioLen(state.demo.audio.find((x) => x.id === audioId));
      selectAudio(audioId);
    } else if (audioEl) {
      mode = "audio"; audioId = audioEl.dataset.audioId; startX = e.clientX;
      const a = state.demo.audio.find((x) => x.id === audioId);
      startAudioStart = a.start;
      selectAudio(audioId);
    } else if (clipEl) {
      mode = "drag"; clipId = clipEl.dataset.id; startX = e.clientX;
      state.selectedAudioId = null; state.selectedId = clipId; renderInspector(); renderTimeline();
      playing = false; seekTo(clipStart(clipId));
    } else {
      mode = "scrub"; playing = false; seekTo(timeAtClientX(e.clientX));
    }
    scroll.setPointerCapture(e.pointerId);
  });

  scroll.addEventListener("pointermove", (e) => {
    if (!mode) return;
    if (mode === "scrub") {
      seekTo(timeAtClientX(e.clientX));
    } else if (mode === "resize") {
      const c = state.demo.clips.find((x) => x.id === clipId);
      c.duration = Math.max(200, Math.round((startDur + ((e.clientX - startX) / PPS) * 1000) / 50) * 50);
      renderTimeline(); renderInspector(); pushToRenderer();
    } else if (mode === "drag") {
      // reorder preview: compute target index from pointer position
      const idx = indexAtClientX(e.clientX);
      reorderTo(clipId, idx);
    } else if (mode === "audio") {
      const a = state.demo.audio.find((x) => x.id === audioId);
      if (a) { a.start = Math.max(0, Math.round((startAudioStart + ((e.clientX - startX) / PPS) * 1000) / 50) * 50); renderAudioLane(); }
    } else if (mode === "audioResize") {
      const a = state.demo.audio.find((x) => x.id === audioId);
      if (a) {
        let len = Math.max(200, Math.round((startAudioLen + ((e.clientX - startX) / PPS) * 1000) / 50) * 50);
        let end = a.trimStart + len;
        if (a.dur != null) end = Math.min(end, a.dur); // can't play past the source
        a.trimEnd = end;
        renderAudioLane(); pushAudioToRenderer();
      }
    }
  });

  const end = (e) => {
    if (mode === "resize" || mode === "drag") markDirty();
    else if (mode === "audio" || mode === "audioResize") { markAudioDirty(); renderInspector(); }
    mode = null; clipId = null; audioId = null;
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
// The editor owns the clock and drives the preview via r.seek() every frame — the same
// path scrubbing uses — so playback and scrubbing behave identically.
let playing = false;
let playT = 0; // current playhead time (ms)
let lastTs = 0;

function seekTo(t) {
  const total = totalMs();
  playT = Math.max(0, Math.min(t, total));
  const r = renderer();
  if (r) r.seek(playT);
  updatePlayhead();
}
function togglePlay() {
  if (!renderer()) return;
  if (playing) { playing = false; }
  else { if (playT >= totalMs()) playT = 0; playing = true; everPlayed = true; lastTs = performance.now(); }
  updatePlayhead();
}
function updatePlayhead() {
  const total = totalMs();
  playT = Math.min(playT, total);
  $("#playhead").style.left = (playT / 1000) * PPS + "px";
  $("#timecode").textContent = `${(playT / 1000).toFixed(1)}s / ${(total / 1000).toFixed(1)}s`;
  $("#play-pause").textContent = playing ? "⏸" : "▶";
}
function transportLoop(now) {
  if (playing) {
    const total = totalMs();
    playT += now - (lastTs || now);
    lastTs = now;
    if (playT >= total) { playT = total; playing = false; }
    const r = renderer();
    if (r) r.seek(playT);
    updatePlayhead();
  }
  const r = renderer();
  if (r && r.audioTick) r.audioTick(playT, playing);
  updateSelectionOverlay();
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
function numberInput(value, onChange, min, max, step = 1) {
  const el = document.createElement("input");
  el.type = "number";
  el.value = value;
  if (min != null) el.min = min;
  if (max != null) el.max = max;
  el.step = step;
  el.oninput = () => onChange(el.value === "" ? undefined : Number(el.value));
  return el;
}
function renderInspector() {
  const body = $("#inspector-body");
  // An audio track takes over the inspector when one is selected.
  if (state.selectedAudioId) {
    const a = selectedAudio();
    if (a) { renderAudioInspector(body, a); return; }
    state.selectedAudioId = null;
  }
  const c = selectedClip();
  body.innerHTML = "";
  if (!c) { body.innerHTML = '<p class="inspector-empty">Select a clip in the timeline.</p>'; return; }
  // Drop a stale element selection that doesn't belong to this clip.
  if (state.selectedElementId && !clipElements(c).some((o) => o.elementId === state.selectedElementId)) {
    state.selectedElementId = null;
  }

  // Clip type badge / screen picker
  if (c.type === "canvas") {
    const badge = document.createElement("div");
    badge.className = "inspector-subtitle";
    badge.textContent = "Blank canvas";
    body.appendChild(badge);
  } else {
    const scr = document.createElement("select");
    state.screens.forEach((n) => { const o = document.createElement("option"); o.value = n; o.textContent = n; o.selected = n === c.screen; scr.appendChild(o); });
    scr.onchange = () => { c.screen = scr.value; markDirty(); };
    body.appendChild(field("Screen", scr));
  }

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

  renderElementPanel(c, body);

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

// --- element overrides (M2a) / canvas elements (M2c) ------------------------
function selectedOverride(c) {
  return clipElements(c).find((o) => o.elementId === state.selectedElementId) || null;
}
function renderElementPanel(clip, body) {
  const isCanvas = clip.type === "canvas";
  const title = document.createElement("div");
  title.className = "inspector-subtitle";
  title.textContent = "Elements";
  body.appendChild(title);

  if (isCanvas) {
    const row = document.createElement("div");
    row.className = "inspector-actions";
    row.append(mkBtn("+ Text", () => addCanvasElement(clip, "text")), mkBtn("+ Box", () => addCanvasElement(clip, "box")));
    body.appendChild(row);
  } else {
    const pickBtn = document.createElement("button");
    pickBtn.className = "topbar-btn btn-wide";
    pickBtn.textContent = "✛ Pick element on screen";
    pickBtn.onclick = () => startPick(clip);
    body.appendChild(pickBtn);
  }

  // Existing elements/overrides for this clip.
  const list = document.createElement("div");
  list.className = "override-list";
  clipElements(clip).forEach((o) => {
    const chip = document.createElement("button");
    chip.className = "override-chip" + (o.elementId === state.selectedElementId ? " active" : "");
    const label = o.kind === "text" ? "“" + (o.text || "") + "”" : o.kind === "box" ? "box" : o.kind === "screenEl" ? "⧉ element" : o.elementId;
    chip.textContent = label + (o.animation ? " · " + o.animation.preset : o.hidden ? " · hidden" : "");
    chip.onclick = () => selectElement(clip, o.elementId);
    list.appendChild(chip);
  });
  body.appendChild(list);

  const o = selectedOverride(clip);
  if (!o) return;

  // Canvas element content controls.
  if (isCanvas && o.kind === "text") {
    const txt = document.createElement("input");
    txt.type = "text"; txt.value = o.text || "";
    txt.oninput = () => { o.text = txt.value; markDirty(); };
    body.appendChild(field("Text", txt));
    body.appendChild(field("Font size", numberInput(o.fontSize, (v) => { o.fontSize = Math.max(4, v || 16); markDirty(); }, 4, 400, 1)));
    const col = document.createElement("input"); col.type = "color"; col.value = o.color || "#111111";
    col.oninput = () => { o.color = col.value; markDirty(); };
    body.appendChild(field("Color", col));
  } else if (isCanvas && o.kind === "box") {
    const wh = document.createElement("div"); wh.className = "xy-grid";
    wh.append(
      field("Width", numberInput(o.w, (v) => { o.w = Math.max(1, v || 1); markDirty(); }, 1, 5000, 1)),
      field("Height", numberInput(o.h, (v) => { o.h = Math.max(1, v || 1); markDirty(); }, 1, 5000, 1)),
      field("Radius", numberInput(o.radius, (v) => { o.radius = Math.max(0, v || 0); markDirty(); }, 0, 999, 1))
    );
    body.appendChild(wh);
    const bg = document.createElement("input"); bg.type = "color"; bg.value = o.bg || "#5b8cff";
    bg.oninput = () => { o.bg = bg.value; markDirty(); };
    body.appendChild(field("Background", bg));
  }

  // Controls for the selected element override.
  const hidden = document.createElement("input");
  hidden.type = "checkbox"; hidden.checked = !!o.hidden;
  hidden.onchange = () => { o.hidden = hidden.checked; markDirtyLive(); };
  const hidWrap = document.createElement("label");
  hidWrap.className = "field checkbox-field";
  hidWrap.append(hidden, document.createTextNode(" Hidden"));
  body.appendChild(hidWrap);

  // Animation preset
  const preset = document.createElement("select");
  ANIM_PRESETS.forEach((p) => { const op = document.createElement("option"); op.value = p; op.textContent = p; op.selected = (o.animation?.preset || "none") === p; preset.appendChild(op); });
  preset.onchange = () => {
    if (preset.value === "none") delete o.animation;
    else o.animation = { preset: preset.value, duration: o.animation?.duration ?? 400, delay: o.animation?.delay ?? 0, easing: o.animation?.easing ?? "ease-out" };
    markDirtyLive(); renderInspector();
  };
  body.appendChild(field("Animation", preset));

  if (o.animation) {
    body.appendChild(field("Duration (ms)", numberInput(o.animation.duration, (v) => { o.animation.duration = Math.max(0, v || 0); markDirtyLive(); }, 0, 20000, 50)));
    body.appendChild(field("Delay (ms)", numberInput(o.animation.delay, (v) => { o.animation.delay = Math.max(0, v || 0); markDirtyLive(); }, 0, 20000, 50)));
    const eas = document.createElement("select");
    EASINGS.forEach((e) => { const op = document.createElement("option"); op.value = e; op.textContent = e; op.selected = o.animation.easing === e; eas.appendChild(op); });
    eas.onchange = () => { o.animation.easing = eas.value; markDirtyLive(); };
    body.appendChild(field("Easing", eas));
  }

  // Position / transform
  const pos = document.createElement("div");
  pos.className = "xy-grid";
  pos.append(
    field("X", numberInput(o.x, (v) => { o.x = v || 0; markDirtyLive(); }, -5000, 5000, 1)),
    field("Y", numberInput(o.y, (v) => { o.y = v || 0; markDirtyLive(); }, -5000, 5000, 1)),
    field("Scale", numberInput(o.scale, (v) => { o.scale = v || 1; markDirtyLive(); }, 0, 10, 0.05)),
    field("Rotate°", numberInput(o.rotate, (v) => { o.rotate = v || 0; markDirtyLive(); }, -360, 360, 1))
  );
  body.appendChild(pos);

  // Custom CSS / JS escape hatch
  const css = document.createElement("textarea");
  css.className = "code-field"; css.rows = 3; css.placeholder = "custom CSS (applies to this clip's screen)";
  css.value = o.css || "";
  css.oninput = () => { o.css = css.value; markDirty(); };
  body.appendChild(field("Custom CSS", css));
  const js = document.createElement("textarea");
  js.className = "code-field"; js.rows = 3; js.placeholder = "custom JS — `el` = the element, `document` = the screen";
  js.value = o.js || "";
  js.oninput = () => { o.js = js.value; markDirty(); };
  body.appendChild(field("Custom JS", js));

  if (!isCanvas) body.appendChild(mkBtn("⧉ Isolate on new canvas", () => isolateOnCanvas(clip, o)));

  body.appendChild(mkBtn(clip.type === "canvas" ? "Remove element" : "Remove element override", () => {
    const arr = clipElements(clip);
    const i = arr.indexOf(o);
    if (i >= 0) arr.splice(i, 1);
    state.selectedElementId = null;
    renderInspector(); markDirty();
  }));
}

function startPick(clip) {
  const w = $("#preview").contentWindow;
  if (!w || !w.__demo) { setStatus("Preview not ready yet.", "warn"); return; }
  playing = false;
  seekTo(clipStart(clip.id)); // show this clip's screen in the preview
  w.__demoPickCb = (id) => {
    onPickElement(clip, id);
    w.__demo.setPick(false);
    w.__demoPickCb = null;
    setStatus("");
  };
  w.__demo.setPick(true);
  setStatus("Click an element in the preview to animate it…");
}
function onPickElement(clip, id) {
  clip.overrides = clip.overrides || [];
  if (!clip.overrides.find((o) => o.elementId === id)) {
    clip.overrides.push({ elementId: id, hidden: false, x: 0, y: 0, scale: 1, rotate: 0, animation: { preset: "pop", duration: 400, delay: 0, easing: "ease-out" } });
  }
  selectElement(clip, id);
  markDirty();
}
// Copy a picked screen element onto a brand-new canvas clip (its own frame), carrying its
// markup so the renderer can re-style it with the source screen's CSS — e.g. pull a modal
// out and make it pop.
function isolateOnCanvas(clip, o) {
  const w = $("#preview").contentWindow;
  const html = w && w.__demo && w.__demo.elementHtml ? w.__demo.elementHtml(o.elementId) : null;
  if (!html) { setStatus("Couldn't read that element — select it again, then isolate.", "warn"); return; }
  const id = "ce-" + Math.random().toString(36).slice(2, 8);
  const el = {
    elementId: id, kind: "screenEl", sourceScreen: clip.screen, html, hidden: false,
    x: Math.round(state.demo.size.width / 2), y: Math.round(state.demo.size.height / 2),
    scale: 1, rotate: 0, animation: { preset: "pop", duration: 400, delay: 0, easing: "ease-out" },
  };
  const canvas = {
    id: "c" + Math.random().toString(36).slice(2, 8), type: "canvas", screen: null,
    duration: 1500, transitionIn: { type: "dissolve", duration: 300 }, captions: [], elements: [el],
  };
  state.demo.clips.splice(state.demo.clips.indexOf(clip) + 1, 0, canvas);
  state.selectedId = canvas.id;
  state.selectedElementId = id;
  renderTimeline(); renderInspector(); markDirty();
  seekTo(clipStart(canvas.id) + canvas.duration - 1);
  setStatus("Isolated on a new canvas clip — give it a transition and make it pop.", "ok");
}
function addCanvasElement(clip, kind) {
  const id = "ce-" + Math.random().toString(36).slice(2, 8);
  const base = { elementId: id, hidden: false, x: Math.round(state.demo.size.width / 2), y: Math.round(state.demo.size.height / 3), scale: 1, rotate: 0, kind };
  if (kind === "text") Object.assign(base, { text: "Title", fontSize: 32, color: "#111111" });
  else Object.assign(base, { w: 160, h: 100, bg: "#5b8cff", radius: 8 });
  (clip.elements ||= []).push(base);
  selectElement(clip, id);
  markDirty();
}
// Select an element and seek to the clip's settled state so the overlay sits on the
// element's resting position (not mid-entrance-animation).
function selectElement(clip, id) {
  state.selectedElementId = id;
  playing = false;
  seekTo(clipStart(clip.id) + Math.max(0, clip.duration - 1));
  renderInspector();
}

// --- selection overlay (drag to move, corner to scale) ----------------------
let selDrag = null;
function activeClipIdAt(t) {
  let acc = 0;
  for (const c of state.demo.clips) { acc += c.duration; if (t < acc) return c.id; }
  return state.demo.clips[state.demo.clips.length - 1]?.id || null;
}
function rendererRect(id) {
  const w = $("#preview").contentWindow;
  return w && w.__demo && w.__demo.elementRect ? w.__demo.elementRect(id) : null;
}
function previewScale() {
  const pr = $("#preview").getBoundingClientRect();
  return pr.width / state.demo.size.width;
}
function ensureSelectionOverlay() {
  if ($("#select-overlay")) return;
  const ov = document.createElement("div");
  ov.id = "select-overlay";
  ov.hidden = true;
  ov.innerHTML = '<div class="sel-box" id="sel-box"><div class="sel-resize" id="sel-resize" title="Drag to scale"></div></div>';
  document.body.appendChild(ov);
  $("#sel-box").addEventListener("pointerdown", (e) => { if (e.target.id !== "sel-resize") startSelDrag(e, "move"); });
  $("#sel-resize").addEventListener("pointerdown", (e) => { e.stopPropagation(); startSelDrag(e, "resize"); });
}
function startSelDrag(e, mode) {
  const c = selectedClip();
  const o = c ? selectedOverride(c) : null;
  if (!o) return;
  const rect = rendererRect(o.elementId);
  const scale = previewScale();
  const baseW = rect && o.scale ? rect.w / o.scale : 0; // element width at scale 1, in stage px
  selDrag = { mode, o, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, oscale: o.scale, baseW, scale };
  window.addEventListener("pointermove", onSelMove);
  window.addEventListener("pointerup", onSelUp, { once: true });
  e.preventDefault();
}
function onSelMove(e) {
  if (!selDrag) return;
  const dx = e.clientX - selDrag.sx, dy = e.clientY - selDrag.sy;
  if (selDrag.mode === "move") {
    selDrag.o.x = Math.round(selDrag.ox + dx / selDrag.scale);
    selDrag.o.y = Math.round(selDrag.oy + dy / selDrag.scale);
  } else if (selDrag.baseW > 0) {
    selDrag.o.scale = Math.max(0.1, +(selDrag.oscale + dx / (selDrag.baseW * selDrag.scale)).toFixed(2));
  }
  markDirtyLive(); // re-apply in place; overlay follows via the transport loop
}
function onSelUp() {
  window.removeEventListener("pointermove", onSelMove);
  selDrag = null;
  renderInspector(); // reflect new x/y/scale in the number fields
  markDirty();
}
function updateSelectionOverlay() {
  const ov = $("#select-overlay");
  if (!ov) return;
  const c = selectedClip();
  const o = c ? selectedOverride(c) : null;
  const rect = o && !o.hidden ? rendererRect(o.elementId) : null;
  if (!rect || !c || activeClipIdAt(playT) !== c.id) { ov.hidden = true; return; }
  const pr = $("#preview").getBoundingClientRect();
  const scale = pr.width / state.demo.size.width;
  const box = $("#sel-box");
  ov.hidden = false;
  box.style.left = pr.left + rect.x * scale + "px";
  box.style.top = pr.top + rect.y * scale + "px";
  box.style.width = rect.w * scale + "px";
  box.style.height = rect.h * scale + "px";
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
    setStatus("Rendering your video… this can take a moment.");
    const res = await fetch("/api/render", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ demo: state.demo, format: $("#format").value }) });
    if (!res.ok) throw new Error((res.headers.get("content-type") || "").includes("json") ? (await res.json()).error : res.statusText);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.project}.${$("#format").value}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus("Rendered.", "ok");
    pet?.react("rendered");
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
  state.selectedElementId = null;
  state.selectedAudioId = null;
  resetHistory();
  $("#current-project").textContent = state.project;
  renderPalette();
  renderTimeline();
  renderInspector();
  if (reload) await reloadPreview(); else { pushToRenderer(); fitPreview(); }
  pushAudioToRenderer();
  setStatus(fresh ? "Re-seeded from the prototype flow." : "");
}

const THEMES = [
  { id: "dark", label: "☾ Dark" },
  { id: "light", label: "☀ Light" },
  { id: "spooky", label: "🌙 Spooky" },
];
// A hand-drawn-ish corner spiderweb as an SVG background (radial spokes + sagging rings).
function makeCornerWeb(size, anchor) {
  const O = anchor === "br" ? [size, size] : [0, 0];
  const s = anchor === "br" ? -1 : 1;
  const angs = [6, 20, 36, 54, 72, 84].map((d) => (d * Math.PI) / 180);
  const pt = (a, r) => [(O[0] + s * Math.cos(a) * r).toFixed(1), (O[1] + s * Math.sin(a) * r).toFixed(1)];
  let d = "";
  for (const a of angs) d += `M${O[0]} ${O[1]}L${pt(a, size).join(" ")}`;
  for (const f of [0.22, 0.44, 0.66, 0.88]) {
    const r = size * f;
    for (let i = 0; i < angs.length - 1; i++) {
      const p1 = pt(angs[i], r), p2 = pt(angs[i + 1], r);
      const mx = (+p1[0] + +p2[0]) / 2, my = (+p1[1] + +p2[1]) / 2;
      const cx = (O[0] + (mx - O[0]) * 0.8).toFixed(1), cy = (O[1] + (my - O[1]) * 0.8).toFixed(1);
      d += `M${p1.join(" ")}Q${cx} ${cy} ${p2.join(" ")}`; // slight sag toward the corner
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><path d='${d}' fill='none' stroke='rgba(185,167,230,0.22)' stroke-width='1'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.setAttribute("data-theme", t.id);
  const btn = $("#theme");
  if (btn) btn.textContent = t.label;
  // Spooky swaps the main canvas's grid for corner spiderwebs; others fall back to CSS.
  const pane = $("#stage-pane");
  if (pane) {
    if (t.id === "spooky") {
      pane.style.backgroundImage = `${makeCornerWeb(320, "tl")}, ${makeCornerWeb(260, "br")}`;
      pane.style.backgroundRepeat = "no-repeat, no-repeat";
      pane.style.backgroundPosition = "top left, bottom right";
      pane.style.backgroundSize = "auto, auto";
    } else {
      pane.style.backgroundImage = pane.style.backgroundRepeat = pane.style.backgroundPosition = pane.style.backgroundSize = "";
    }
  }
  try { localStorage.setItem("c2p-theme", t.id); } catch {}
  window.dispatchEvent(new CustomEvent("c2p-theme", { detail: t.id }));
}
function cycleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  const i = THEMES.findIndex((x) => x.id === cur);
  applyTheme(THEMES[(i + 1) % THEMES.length].id);
}

async function main() {
  // theme (dark → light → spooky), persisted
  applyTheme(localStorage.getItem("c2p-theme") || "dark");
  $("#theme").onclick = cycleTheme;
  // transport
  $("#play-pause").onclick = togglePlay;
  $("#to-start").onclick = () => { playing = false; seekTo(0); };
  $("#seed-flow").onclick = async () => {
    if (!confirm("Auto-build the timeline from your prototype's screens and links? This replaces the current clips.")) return;
    await loadProject(true, false); markDirty();
  };
  $("#export").onclick = doExport;
  $("#format").onchange = () => {};
  $("#add-music").onclick = () => importAudio("music");
  $("#add-voice").onclick = () => importAudio("voice");
  $("#rec-voice").onclick = toggleRecord;
  $("#audio-file").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) uploadAudio(f, pendingAudioKind); };
  $("#project-switch").onclick = (e) => { e.stopPropagation(); toggleProjectMenu(); };
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".project-switch-wrap")) $("#project-menu").hidden = true;
  });

  initTimelinePointer();
  ensureSelectionOverlay();
  window.addEventListener("resize", fitPreview);
  // Undo (Cmd/Ctrl+Z) — but let text fields keep their native undo.
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      undo();
    }
  });
  requestAnimationFrame(transportLoop);

  // Pet handoff: CodeToUI can pass its pet in ?pet=<encoded JSON of the pets array>;
  // write it to localStorage so the pet "follows" into Motion. Then mount the companion.
  const petParam = new URLSearchParams(location.search).get("pet");
  if (petParam) {
    try { JSON.parse(petParam); localStorage.setItem("codetoui-pet", petParam); } catch { /* ignore bad param */ }
  }
  pet = initPet({
    getContext: () => ({
      clipCount: state.demo.clips.length,
      hasTransitions: state.demo.clips.some((c) => c.transitionIn?.type && c.transitionIn.type !== "instant"),
      everPlayed,
    }),
  });

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

async function toggleProjectMenu() {
  const menu = $("#project-menu");
  if (!menu.hidden) { menu.hidden = true; return; }
  try {
    const { projects, active } = await api("/api/projects");
    menu.innerHTML = "";
    if (!projects.length) {
      const empty = document.createElement("div");
      empty.className = "project-menu-empty";
      empty.textContent = "No projects found.";
      menu.appendChild(empty);
    }
    projects.forEach((name) => {
      const b = document.createElement("button");
      b.className = "project-menu-item" + (name === active ? " active" : "");
      b.textContent = name;
      b.onclick = async () => {
        menu.hidden = true;
        if (name === active) return;
        try {
          await api("/api/projects/active", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name }) });
          await loadProject(false, true); // reload preview: different screens embedded
          setStatus(`Switched to "${name}".`);
        } catch (e) { setStatus("Switch failed: " + e.message, "error"); }
      };
      menu.appendChild(b);
    });
    menu.hidden = false;
  } catch (e) {
    setStatus("Couldn't list projects: " + e.message, "error");
  }
}

main();

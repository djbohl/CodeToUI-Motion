// CodeToPrototype web UI — a form-based editor over the walkthrough script, a
// click-to-play preview (the Phase-1 player in an iframe), and a Render button that
// posts to the engine and downloads the resulting video. No timeline, no live render
// preview — Render is the only heavy action.

const $ = (sel) => document.querySelector(sel);

// --- state ------------------------------------------------------------------
let model = null; // { activeProject, start, screens, links, script }
let steps = []; // editable copy of script.steps

// --- REST helpers -----------------------------------------------------------
async function api(path, opts) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let msg = res.statusText;
    if (ct.includes("application/json")) msg = (await res.json()).error || msg;
    throw new Error(msg);
  }
  return ct.includes("application/json") ? res.json() : res;
}

function setStatus(msg, kind = "") {
  const el = $("#status");
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

// --- move encoding ----------------------------------------------------------
// A step's "move" is one of: hold / click:<elementId> / nav:$back / nav:$home.
function moveValue(step) {
  if (step.click) return "click:" + step.click;
  if (step.nav) return "nav:" + step.nav;
  return "hold";
}
function applyMove(step, value) {
  step.click = null;
  step.nav = null;
  if (value.startsWith("click:")) step.click = value.slice(6);
  else if (value.startsWith("nav:")) step.nav = value.slice(4);
}
function linksForScreen(screen) {
  return (model.links || []).filter((l) => l.screen === screen);
}

// --- rendering the step list -----------------------------------------------
function optionEl(value, label, selected) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

function renderSteps() {
  const host = $("#steps");
  host.innerHTML = "";
  steps.forEach((step, i) => host.appendChild(renderStep(step, i)));
  $("#steps-title").textContent = `Walkthrough — ${steps.length} step${steps.length === 1 ? "" : "s"}`;
}

function renderStep(step, i) {
  const row = document.createElement("div");
  row.className = "step";

  const num = document.createElement("div");
  num.className = "step-num";
  num.textContent = i + 1;
  row.appendChild(num);

  const grid = document.createElement("div");
  grid.className = "step-grid";

  // Screen
  grid.appendChild(labeled("Screen", (() => {
    const s = document.createElement("select");
    (model.screens || []).forEach((name) => s.appendChild(optionEl(name, name, name === step.screen)));
    s.onchange = () => { step.screen = s.value; applyMove(step, "hold"); renderSteps(); };
    return s;
  })()));

  // Move
  grid.appendChild(labeled("Move", (() => {
    const s = document.createElement("select");
    s.appendChild(optionEl("hold", "— hold —", moveValue(step) === "hold"));
    linksForScreen(step.screen).forEach((l) => {
      const val = "click:" + l.elementId;
      s.appendChild(optionEl(val, `click → ${l.target} (${l.mode || "navigate"})`, moveValue(step) === val));
    });
    s.appendChild(optionEl("nav:$back", "⬅ back", moveValue(step) === "nav:$back"));
    s.appendChild(optionEl("nav:$home", "⌂ home", moveValue(step) === "nav:$home"));
    s.onchange = () => applyMove(step, s.value);
    return s;
  })()));

  // Dwell
  grid.appendChild(labeled("Dwell (ms)", numberInput(step.dwell ?? 1500, (v) => (step.dwell = v), 0, 60000)));
  // Speed
  grid.appendChild(labeled("Speed", numberInput(step.speed ?? 1, (v) => (step.speed = v), 0.1, 10, 0.1)));

  // Caption
  const cap = step.caption || null;
  const capText = document.createElement("input");
  capText.type = "text";
  capText.placeholder = "caption (optional)";
  capText.value = cap?.text || "";
  const capAt = numberInput(cap?.at ?? 0, (v) => ensureCaption(step).at = v, 0, 60000);
  const capFor = numberInput(cap?.for ?? 800, (v) => ensureCaption(step).for = v, 0, 60000);
  capText.oninput = () => {
    if (capText.value.trim()) ensureCaption(step).text = capText.value;
    else step.caption = null;
  };
  grid.appendChild(labeled("Caption", capText));
  grid.appendChild(labeled("at (ms)", capAt));
  grid.appendChild(labeled("for (ms)", capFor));

  row.appendChild(grid);

  // Row actions
  const actions = document.createElement("div");
  actions.className = "step-actions";
  actions.appendChild(iconBtn("↑", "Move up", () => move(i, -1), i === 0));
  actions.appendChild(iconBtn("↓", "Move down", () => move(i, 1), i === steps.length - 1));
  actions.appendChild(iconBtn("✕", "Remove", () => { steps.splice(i, 1); renderSteps(); }));
  row.appendChild(actions);

  return row;
}

function ensureCaption(step) {
  if (!step.caption) step.caption = { text: "", at: 0, for: 800 };
  return step.caption;
}
function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  renderSteps();
}
function labeled(label, control) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.appendChild(span);
  wrap.appendChild(control);
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
function iconBtn(glyph, title, onClick, disabled) {
  const b = document.createElement("button");
  b.className = "btn btn-icon";
  b.textContent = glyph;
  b.title = title;
  b.disabled = !!disabled;
  b.onclick = onClick;
  return b;
}

// --- top-level actions ------------------------------------------------------
async function loadProjectList() {
  const { projects, active } = await api("/api/projects");
  const picker = $("#project-picker");
  picker.innerHTML = "";
  projects.forEach((p) => picker.appendChild(optionEl(p, p, p === active)));
  picker.onchange = async () => {
    await api("/api/projects/active", { method: "POST", headers: json(), body: JSON.stringify({ name: picker.value }) });
    await loadProject();
  };
}

async function loadProject(fresh = false) {
  model = await api("/api/project" + (fresh ? "?fresh=1" : ""));
  steps = (model.script?.steps || []).map((s) => ({ ...s }));
  const picker = $("#project-picker");
  if (picker.value !== model.activeProject) picker.value = model.activeProject;
  renderSteps();
  setStatus(`Loaded "${model.activeProject}"${fresh ? " (regenerated)" : ""}.`);
}

function json() {
  return { "Content-Type": "application/json" };
}

function buildScript() {
  return {
    fps: Number($("#opt-fps").value) || 30,
    format: $("#opt-format").value,
    steps,
  };
}

async function save() {
  try {
    setStatus("Saving…");
    const { warnings } = await api("/api/walkthrough", {
      method: "POST",
      headers: json(),
      body: JSON.stringify({ script: buildScript() }),
    });
    setStatus(warnings?.length ? `Saved. ${warnings.join(" ")}` : "Saved.", warnings?.length ? "warn" : "ok");
  } catch (e) {
    setStatus("Save failed: " + e.message, "error");
  }
}

async function render() {
  const btn = $("#btn-render");
  btn.disabled = true;
  try {
    setStatus("Rendering… this runs headless Chromium + ffmpeg and may take a bit.");
    const res = await fetch("/api/render", {
      method: "POST",
      headers: json(),
      body: JSON.stringify({
        script: buildScript(),
        format: $("#opt-format").value,
        fps: Number($("#opt-fps").value) || 30,
        width: Number($("#opt-width").value) || 390,
        cursor: $("#opt-cursor").checked,
      }),
    });
    if (!res.ok) {
      const msg = (res.headers.get("content-type") || "").includes("json") ? (await res.json()).error : res.statusText;
      throw new Error(msg);
    }
    const blob = await res.blob();
    downloadBlob(blob, `${model.activeProject}.${$("#opt-format").value}`);
    setStatus("Rendered.", "ok");
  } catch (e) {
    setStatus("Render failed: " + e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openPreview() {
  const ov = $("#preview-overlay");
  $("#preview-title").textContent = `Preview — ${model.activeProject} (click through it)`;
  $("#preview-frame").src = "/api/preview?t=" + Date.now();
  ov.hidden = false;
}
function closePreview() {
  $("#preview-overlay").hidden = true;
  $("#preview-frame").src = "about:blank";
}

// --- boot -------------------------------------------------------------------
async function main() {
  $("#btn-play").onclick = openPreview;
  $("#preview-close").onclick = closePreview;
  $("#btn-save").onclick = save;
  $("#btn-render").onclick = render;
  $("#btn-add").onclick = () => {
    steps.push({ screen: model?.start || (model?.screens || [])[0], dwell: 1500, speed: 1 });
    renderSteps();
  };
  $("#btn-regen").onclick = async () => {
    if (!confirm("Regenerate the walkthrough from the links graph? Unsaved edits will be lost.")) return;
    await loadProject(true);
  };

  try {
    await loadProjectList();
    // A launch from CodeToUI arrives as ?project=<name>.
    const wanted = new URLSearchParams(location.search).get("project");
    if (wanted) {
      await api("/api/projects/active", { method: "POST", headers: json(), body: JSON.stringify({ name: wanted }) }).catch(() => {});
    }
    await loadProject();
  } catch (e) {
    setStatus("Could not load a project: " + e.message + " — set C2P_PROJECTS_ROOT to a CodeToUI projects folder.", "error");
  }
}

main();

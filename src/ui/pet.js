// The pixel companion, ported from CodeToUI Playground so it can follow the user into
// CodeToUI Motion. Same storage key ("codetoui-pet") and shape (array of { i, name });
// since the two apps run on different origins, the pet "follows" by being handed over in
// the launch URL (?pet=<encoded JSON>) which main.js writes into localStorage before this
// loads. Tips/quips are Motion-flavored. Pets are rehomed, never deleted.

const STORE_KEY = "codetoui-pet";
const MAX_PETS = 2;

const PETS = [
  { emoji: "👾", kind: "Invader" },
  { emoji: "🐣", kind: "Chick" },
  { emoji: "🦖", kind: "Rexie" },
  { emoji: "🐙", kind: "Squish" },
  { emoji: "🐸", kind: "Hopper" },
  { emoji: "🦄", kind: "Sparkle" },
  { emoji: "🐲", kind: "Draggo" },
  { emoji: "🤖", kind: "Botling" },
];

const NAMES = ["Pixel", "Boop", "Nibble", "Zap", "Waffles", "Mochi", "Gizmo", "Taco", "Sprout", "Bit", "Noodle", "Pip"];

const QUIPS = [
  "Boop!",
  "Lights, camera, pixels!",
  "I followed you here from CodeToUI 🏃",
  "Are we shipping the demo yet?",
  "That transition? Chef's kiss.",
  "I live in your timeline now.",
  "Pretty sure that clip needs a caption.",
  "You + me = demo dream team.",
  "Hit play, I wanna watch.",
  "Beep boop, motion mode engaged.",
];

const TIPS = [
  "Tip: Click a screen on the left to add it as a clip.",
  "Tip: Drag a clip to reorder; drag its right edge to retime.",
  "Tip: Click the ruler to scrub; hit ▶ to play the demo.",
  "Tip: Give a clip a transition-in in the inspector.",
  "Tip: Add captions with their own start + duration.",
  "Tip: Auto-build timeline rebuilds from your prototype's flow.",
  "Tip: Export renders the demo to MP4 or WebM.",
  "Tip: Toggle ☾/☀ for light and dark.",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function initPet({ getContext } = {}) {
  const dock = document.getElementById("pet-dock");
  if (!dock) return { react() {} };

  let pets = load();
  const units = [];
  let bubbleTimers = [];
  let chatterTimer = null;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (Array.isArray(raw)) return raw.slice(0, MAX_PETS);
      if (raw && typeof raw.i === "number") return [raw];
    } catch { /* ignore */ }
    return [];
  }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(pets)); }

  function speak(idx, text) {
    const u = units[idx];
    if (!u) return;
    u.bubbleEl.textContent = text;
    u.bubbleEl.hidden = false;
    clearTimeout(bubbleTimers[idx]);
    bubbleTimers[idx] = setTimeout(() => (u.bubbleEl.hidden = true), 5500);
  }
  function bounce(idx, animClass) {
    const sprite = units[idx]?.spriteEl;
    if (!sprite) return;
    sprite.classList.remove("jump", "hatching");
    void sprite.offsetWidth;
    sprite.classList.add(animClass);
    sprite.addEventListener("animationend", () => sprite.classList.remove(animClass), { once: true });
  }
  function contextualLine() {
    if (!getContext) return null;
    let c;
    try { c = getContext(); } catch { return null; }
    const cands = [];
    if (c.clipCount === 0) cands.push("Empty timeline! Click a screen to add your first clip.");
    if (c.clipCount >= 2 && !c.hasTransitions) cands.push("Try giving a clip a transition-in to make it pop.");
    if (c.clipCount > 0 && !c.everPlayed) cands.push("Your demo's ready — hit ▶ to watch it!");
    return cands.length ? pick(cands) : null;
  }
  function scheduleChatter() {
    clearTimeout(chatterTimer);
    if (pets.length === 0) return;
    chatterTimer = setTimeout(() => {
      const idx = Math.floor(Math.random() * pets.length);
      const ctx = Math.random() < 0.5 ? contextualLine() : null;
      speak(idx, ctx || (Math.random() < 0.5 ? pick(TIPS) : pick(QUIPS)));
      scheduleChatter();
    }, 12000 + Math.random() * 12000);
  }

  function render() {
    dock.innerHTML = "";
    units.length = 0;
    bubbleTimers = [];
    for (let idx = pets.length - 1; idx >= 0; idx--) units[idx] = renderPetUnit(idx);
    if (pets.length < MAX_PETS) renderAddUnit();
  }
  function renderPetUnit(idx) {
    const pet = PETS[pets[idx].i] || PETS[0];
    const unit = document.createElement("div");
    unit.className = "pet";
    const bubbleEl = document.createElement("div");
    bubbleEl.className = "pet-bubble";
    bubbleEl.hidden = true;
    const stage = document.createElement("div");
    stage.className = "pet-stage";
    const spriteEl = document.createElement("button");
    spriteEl.className = "pet-sprite";
    spriteEl.title = "Pet me";
    spriteEl.textContent = pet.emoji;
    spriteEl.addEventListener("click", () => {
      bounce(idx, "jump");
      const ctx = Math.random() < 0.4 ? contextualLine() : null;
      speak(idx, ctx || (Math.random() < 0.5 ? pick(QUIPS) : pick(TIPS)));
      scheduleChatter();
    });
    stage.appendChild(spriteEl);
    const captionEl = document.createElement("div");
    captionEl.className = "pet-caption";
    captionEl.textContent = `${pets[idx].name} the ${pet.kind}`;
    const rehomeBtn = document.createElement("button");
    rehomeBtn.className = "pet-rehome";
    rehomeBtn.textContent = "Rehome";
    rehomeBtn.title = "Send this pet to a new home";
    rehomeBtn.addEventListener("click", () => rehome(idx));
    unit.append(bubbleEl, stage, captionEl, rehomeBtn);
    dock.appendChild(unit);
    return { bubbleEl, spriteEl, captionEl };
  }
  function renderAddUnit() {
    const unit = document.createElement("div");
    unit.className = "pet pet-add";
    const stage = document.createElement("div");
    stage.className = "pet-stage";
    const egg = document.createElement("button");
    egg.className = "pet-sprite egg";
    egg.textContent = "🥚";
    egg.title = "Hatch an egg";
    egg.addEventListener("click", () => hatchPet(Math.floor(Math.random() * PETS.length)));
    stage.appendChild(egg);
    const caption = document.createElement("div");
    caption.className = "pet-caption";
    caption.textContent = pets.length === 0 ? "A mysterious egg…" : "Room for one more…";
    const choice = document.createElement("div");
    choice.className = "pet-choice";
    const eggBtn = document.createElement("button");
    eggBtn.className = "topbar-btn";
    eggBtn.textContent = "Hatch egg";
    eggBtn.addEventListener("click", () => hatchPet(Math.floor(Math.random() * PETS.length)));
    const pixelBtn = document.createElement("button");
    pixelBtn.className = "topbar-btn";
    pixelBtn.textContent = "Pick pet";
    const picker = document.createElement("div");
    picker.className = "pet-picker";
    picker.hidden = true;
    PETS.forEach((pet, i) => {
      const b = document.createElement("button");
      b.className = "pet-pick";
      b.textContent = pet.emoji;
      b.title = pet.kind;
      b.addEventListener("click", () => hatchPet(i));
      picker.appendChild(b);
    });
    pixelBtn.addEventListener("click", () => { picker.hidden = !picker.hidden; });
    choice.append(eggBtn, pixelBtn);
    unit.append(stage, caption, choice, picker);
    dock.appendChild(unit);
  }
  function hatchPet(i) {
    if (pets.length >= MAX_PETS) return;
    pets.push({ i, name: pick(NAMES) });
    save();
    render();
    const newIdx = pets.length - 1;
    bounce(newIdx, "hatching");
    speak(newIdx, `Hi! I'm ${pets[newIdx].name}. Let's make a demo!`);
    scheduleChatter();
  }
  function rehome(idx) {
    const name = pets[idx].name;
    if (!confirm(`Rehome ${name} to a new home? They'll be happy and cared for. 🏡`)) return;
    speak(idx, `🏡 ${name} is off to a loving new home. Bye! 👋`);
    const unit = units[idx];
    if (unit) unit.spriteEl.classList.add("leaving");
    setTimeout(() => { pets.splice(idx, 1); save(); render(); scheduleChatter(); }, 1600);
  }
  function react(event) {
    if (pets.length === 0) return;
    const lines = {
      clipAdded: "Ooh, a new clip! The demo's taking shape.",
      rendered: "That's a wrap! 🎬 Nice demo.",
    };
    const text = lines[event];
    if (!text) return;
    bounce(0, "jump");
    speak(0, text);
    scheduleChatter();
  }

  render();
  if (pets.length > 0) {
    scheduleChatter();
    setTimeout(() => speak(0, `${pets[0].name} followed you to Motion!`), 1500);
  }

  return { react };
}

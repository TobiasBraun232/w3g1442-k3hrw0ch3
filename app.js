/* ---------- Grunddaten (identisch zur PDF-Logik) ---------- */

const ROTATION = [2, 1, 4, 3, 6, 5, 8, 7];
const BLOCK_START = new Date(2026, 6, 26); // Sonntag, 26.07.2026 -> Wohnung 2
const BLOCK_LEN_DAYS = 7;

const WOHNUNG_COUNT = 8;

/* ---------- Datum-Hilfsfunktionen ---------- */

function stripTime(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function diffDays(a, b) {
  return Math.round((stripTime(a) - stripTime(b)) / 86400000);
}

// Sonntag-referenzierter Wochenstart (Kehrwoche = So-Sa)
function weekStart(d) {
  const date = stripTime(d);
  const offset = date.getDay(); // 0 = Sonntag
  return addDays(date, -offset);
}

function weekEnd(ws) {
  return addDays(ws, 6);
}

function isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function kwForWeek(ws) {
  // KW wird über den Montag der Woche bestimmt (ISO 8601)
  return isoWeekNumber(addDays(ws, 1));
}

function wohnungForDate(d) {
  const delta = diffDays(weekStart(d), weekStart(BLOCK_START));
  const blockIndex = Math.floor(delta / BLOCK_LEN_DAYS);
  const pos = ((blockIndex % WOHNUNG_COUNT) + WOHNUNG_COUNT) % WOHNUNG_COUNT;
  return ROTATION[pos];
}

function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return dd + "." + mm + ".";
}

function fmtISO(d) {
  const c = stripTime(d);
  return c.getFullYear() + "-" + String(c.getMonth() + 1).padStart(2, "0") + "-" + String(c.getDate()).padStart(2, "0");
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return stripTime(aStart) <= stripTime(bEnd) && stripTime(bStart) <= stripTime(aEnd);
}

/* ---------- Speicher (rein lokal, nichts wird übertragen) ---------- */

const STORE_KEYS = {
  wohnung: "kw_meineWohnung",
  vertretungen: "kw_vertretungen",
  tausch: "kw_tausch",
  notizen: "kw_notizen",
  namen: "kw_namen",
  swaps: "kw_swaps",
  theme: "kw_theme"
};

function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

/* ---------- Anwendungszustand ---------- */

let state = {
  meineWohnung: storageGet(STORE_KEYS.wohnung, null),
  vertretungen: storageGet(STORE_KEYS.vertretungen, []),
  tausch: storageGet(STORE_KEYS.tausch, []),
  notizen: storageGet(STORE_KEYS.notizen, {}),
  namen: storageGet(STORE_KEYS.namen, {}),
  swaps: storageGet(STORE_KEYS.swaps, []),
  currentWeekStart: weekStart(new Date()),
  showOnboarding: false
};

function persist() {
  storageSet(STORE_KEYS.vertretungen, state.vertretungen);
  storageSet(STORE_KEYS.tausch, state.tausch);
  storageSet(STORE_KEYS.notizen, state.notizen);
  storageSet(STORE_KEYS.swaps, state.swaps);
}

/* ---------- Namen ---------- */

function wohnungName(n) {
  return (state.namen && state.namen[n]) ? state.namen[n] : "Wohnung " + n;
}

function avatarText(n) {
  const name = state.namen && state.namen[n];
  if (!name) return "W" + n;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = (parts[0] ? parts[0][0] : "") + (parts[1] ? parts[1][0] : "");
  return initials.toUpperCase() || ("W" + n);
}

/* ---------- Theme (Hell/Dunkel) ---------- */

function systemPrefersDark() {
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function storedThemePref() {
  return storageGet(STORE_KEYS.theme, "auto");
}

function resolvedTheme() {
  const pref = storedThemePref();
  if (pref === "light" || pref === "dark") return pref;
  return systemPrefersDark() ? "dark" : "light";
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#14120F" : "#F7F5F1");
  document.querySelectorAll(".theme-toggle").forEach(btn => {
    btn.textContent = theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19";
    btn.setAttribute("aria-label", theme === "dark" ? "Hellmodus einschalten" : "Dunkelmodus einschalten");
  });
}

function toggleTheme() {
  storageSet(STORE_KEYS.theme, resolvedTheme() === "dark" ? "light" : "dark");
  applyTheme();
}

/* ---------- Haptik ---------- */

function haptic(ms) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms || 12); } catch (e) {}
  }
}

// Richtung der letzten Wochen-Navigation: -1 zurück, 1 vor, 0 sonst.
let weekAnimDir = 0;

/* ---------- Wochenstatus-Logik ---------- */

function findVertretungFor(ws) {
  const we = weekEnd(ws);
  return state.vertretungen.find(v => rangesOverlap(ws, we, new Date(v.von), new Date(v.bis)));
}

function findTauschFor(ws) {
  const key = fmtISO(ws);
  return state.tausch.find(t => t.woche === key);
}

function findSwapGave(key) {
  return state.swaps.find(s => s.giveWeek === key);
}

function findSwapTook(key) {
  return state.swaps.find(s => s.takeWeek === key);
}

function weekInvolvedInSwap(key) {
  return state.swaps.some(s => s.giveWeek === key || s.takeWeek === key);
}

function weekInfo(ws) {
  const key = fmtISO(ws);
  const baseWohnung = wohnungForDate(ws);
  const isMineByRotation = state.meineWohnung !== null && baseWohnung === state.meineWohnung;

  const swapGave = findSwapGave(key);
  const swapTook = findSwapTook(key);
  const vertretung = isMineByRotation ? findVertretungFor(ws) : null;
  const tausch = !isMineByRotation ? findTauschFor(ws) : null;

  let highlighted = isMineByRotation;
  if (swapGave) highlighted = false;
  else if (swapTook) highlighted = true;
  if (vertretung && highlighted) highlighted = false;
  if (tausch && !highlighted) highlighted = true;

  return {
    ws,
    we: weekEnd(ws),
    key,
    baseWohnung,
    isMineByRotation,
    vertretung,
    tausch,
    swapGave,
    swapTook,
    highlighted
  };
}

function isEffectivelyMine(ws) {
  return weekInfo(ws).highlighted;
}

/* ---------- Countdown ---------- */

function remainingKehrwochen() {
  if (state.meineWohnung === null) return 0;
  const today = stripTime(new Date());
  const year = today.getFullYear();
  const yearEnd = new Date(year, 11, 31);
  let count = 0;
  let ws = weekStart(today);
  while (ws <= yearEnd) {
    const we = weekEnd(ws);
    if (we >= today && isEffectivelyMine(ws)) count++;
    ws = addDays(ws, 7);
  }
  return count;
}

function nextKehrwoche() {
  if (state.meineWohnung === null) return null;
  const today = stripTime(new Date());
  const startWs = weekStart(today);
  let ws = startWs;
  for (let i = 0; i < 106; i++) {
    const we = weekEnd(ws);
    if (we >= today && isEffectivelyMine(ws)) {
      return { ws, we, weeksAway: Math.round(diffDays(ws, startWs) / 7) };
    }
    ws = addDays(ws, 7);
  }
  return null;
}

/* ---------- Rendering ---------- */

const $ = sel => document.querySelector(sel);

function wohnungVars(n) {
  return {
    base: `var(--w${n}-base)`,
    strong: `var(--w${n}-strong)`,
    border: `var(--w${n}-border)`,
    text: `var(--w${n}-text)`
  };
}

function renderOnboarding() {
  const list = $("#wohnungGrid");
  list.innerHTML = "";
  for (let i = 1; i <= WOHNUNG_COUNT; i++) {
    const v = wohnungVars(i);
    const selected = state.meineWohnung === i;

    const row = document.createElement("div");
    row.className = "wohnung-pick" + (selected ? " selected" : "");
    row.style.borderColor = selected ? v.border : "transparent";

    const swatch = document.createElement("span");
    swatch.className = "wohnung-swatch";
    swatch.style.background = v.strong;
    swatch.style.color = v.text;
    swatch.textContent = avatarText(i);

    const label = document.createElement("span");
    label.className = "wohnung-name";
    label.textContent = wohnungName(i);

    const edit = document.createElement("button");
    edit.className = "rename-btn";
    edit.type = "button";
    edit.setAttribute("aria-label", "Umbenennen");
    edit.textContent = "\u270E";

    row.append(swatch, label, edit);
    row.addEventListener("click", () => selectWohnung(i));
    edit.addEventListener("click", e => {
      e.stopPropagation();
      startRename(i, row);
    });
    list.appendChild(row);
  }
}

function selectWohnung(i) {
  state.meineWohnung = i;
  storageSet(STORE_KEYS.wohnung, i);
  state.showOnboarding = false;
  haptic(12);
  renderAll();
}

function startRename(i, row) {
  row.classList.add("editing");
  row.innerHTML = "";
  row.addEventListener("click", e => e.stopPropagation());

  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.value = wohnungName(i);
  input.maxLength = 40;

  const save = document.createElement("button");
  save.className = "rename-save";
  save.type = "button";
  save.textContent = "\u2713";

  row.append(input, save);

  const commit = () => {
    const val = input.value.trim();
    if (val === "" || val === "Wohnung " + i) {
      delete state.namen[i];
    } else {
      state.namen[i] = val;
    }
    storageSet(STORE_KEYS.namen, state.namen);
    renderOnboarding();
  };

  save.addEventListener("click", e => {
    e.stopPropagation();
    commit();
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") renderOnboarding();
  });

  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

function renderHeader() {
  const header = $("#header");
  if (state.meineWohnung === null) {
    header.classList.add("hidden");
    return;
  }
  header.classList.remove("hidden");
  const v = wohnungVars(state.meineWohnung);
  $("#avatar").textContent = avatarText(state.meineWohnung);
  $("#avatar").style.background = v.strong;
  $("#avatar").style.color = v.text;
  $("#headerTitle").textContent = wohnungName(state.meineWohnung);
}

function renderWeek() {
  const info = weekInfo(state.currentWeekStart);
  const v = wohnungVars(info.baseWohnung);

  $("#weekLabel").textContent =
    "KW " + kwForWeek(info.ws) + " · " + fmtDate(info.ws) + "–" + fmtDate(info.we);

  const card = $("#weekCard");
  card.classList.toggle("own", info.highlighted);
  card.style.background = info.highlighted ? v.strong : v.base;
  card.style.borderColor = info.highlighted ? v.border : "transparent";
  card.style.boxShadow = info.highlighted
    ? `0 16px 44px -12px var(--w${info.baseWohnung}-border), var(--shadow-md)`
    : "";

  card.classList.remove("slide-next", "slide-prev", "pop");
  void card.offsetWidth;
  card.classList.add(weekAnimDir > 0 ? "slide-next" : weekAnimDir < 0 ? "slide-prev" : "pop");
  weekAnimDir = 0;

  const headline = $("#headline");
  const subline = $("#subline");
  const tag = $("#weekTag");
  // Nicht-eigene Wochen liegen auf hellem Pastellton -> Text/Chip bleiben in beiden Themes dunkel.
  headline.style.color = info.highlighted ? v.text : "#262420";
  subline.style.color = info.highlighted ? v.text : "#6F6A63";
  tag.style.color = info.highlighted ? v.text : "#262420";
  tag.style.background = "rgba(0,0,0,0.08)";

  if (info.highlighted) {
    headline.textContent = "Du bist dran";
    subline.textContent = "Diese Woche hast du Kehrwoche.";
  } else {
    headline.textContent = wohnungName(info.baseWohnung) + " ist dran";
    subline.textContent = "Du hast diese Woche keine Kehrwoche.";
  }

  if (info.swapTook || info.tausch) {
    tag.textContent = "Getauscht \u00b7 nur f\u00fcr dich";
    tag.classList.remove("hidden");
  } else if (info.swapGave) {
    tag.textContent = "Abgegeben \u00b7 nur f\u00fcr dich";
    tag.classList.remove("hidden");
  } else if (info.vertretung) {
    tag.textContent = "Vertretung \u00b7 nur f\u00fcr dich";
    tag.classList.remove("hidden");
  } else {
    tag.classList.add("hidden");
  }

  renderActions(info);
  renderNote(info);
  renderCountdown();
}

function renderActions(info) {
  const wrap = $("#actions");
  wrap.innerHTML = "";
  closePanel();

  if (info.swapGave || info.swapTook) {
    addButton(wrap, "Tausch r\u00fcckg\u00e4ngig", () => {
      const id = (info.swapGave || info.swapTook).id;
      state.swaps = state.swaps.filter(s => s.id !== id);
      persist();
      renderWeek();
    }, true);
    return;
  }

  if (info.isMineByRotation && info.vertretung) {
    addButton(wrap, "Vertretung entfernen", () => {
      state.vertretungen = state.vertretungen.filter(v => v.id !== info.vertretung.id);
      persist();
      renderWeek();
    }, true);
    return;
  }

  if (info.tausch) {
    addButton(wrap, "Markierung entfernen", () => {
      state.tausch = state.tausch.filter(t => t.id !== info.tausch.id);
      persist();
      renderWeek();
    }, true);
    return;
  }

  if (info.isMineByRotation) {
    addButton(wrap, "Vertretung eintragen", () => openVertretungPanel(info));
  } else {
    addButton(wrap, "Diese Woche tauschen", () => openTauschPanel(info));
  }
}

function addButton(wrap, label, onClick, danger) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn" + (danger ? " danger" : "");
  b.textContent = label;
  b.addEventListener("click", onClick);
  wrap.appendChild(b);
}

function addPanelButton(panel, label, onClick, variant) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn" + (variant ? " " + variant : "");
  b.textContent = label;
  b.addEventListener("click", onClick);
  panel.appendChild(b);
}

function closePanel() {
  const panel = $("#panel");
  panel.classList.add("hidden");
  panel.dataset.mode = "";
  panel.innerHTML = "";
}

function infoNote() {
  const n = document.createElement("p");
  n.className = "info-note";
  n.textContent = "Wird nur auf diesem Ger\u00e4t gespeichert und ist nur f\u00fcr dich sichtbar.";
  return n;
}

function panelTitle(text) {
  const p = document.createElement("p");
  p.className = "panel-title";
  p.textContent = text;
  return p;
}

function labeledInput(labelText, type, value) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  wrap.append(label, input);
  return { wrap, input, label };
}

function openTauschPanel(info) {
  const panel = $("#panel");
  if (panel.dataset.mode === "tausch") { closePanel(); return; }
  panel.innerHTML = "";
  panel.dataset.mode = "tausch";
  panel.classList.remove("hidden");

  panel.appendChild(infoNote());
  panel.appendChild(panelTitle("Mit welcher deiner Wochen m\u00f6chtest du tauschen?"));
  panel.appendChild(buildSwapList(info, "tausch"));

  addPanelButton(panel, "Nur diese Woche \u00fcbernehmen (ohne Tausch)", () => {
    state.tausch.push({ id: newId(), woche: info.key, notiz: "" });
    persist();
    haptic(15);
    renderWeek();
  });
  addPanelButton(panel, "Abbrechen", () => closePanel(), "ghost");
}

function openVertretungPanel(info) {
  const panel = $("#panel");
  if (panel.dataset.mode === "vertretung") { closePanel(); return; }
  panel.innerHTML = "";
  panel.dataset.mode = "vertretung";
  panel.classList.remove("hidden");

  panel.appendChild(infoNote());
  panel.appendChild(panelTitle("Vertretung mit Zeitraum"));

  const row = document.createElement("div");
  row.className = "row";
  const von = labeledInput("Von", "date", fmtISO(info.ws));
  const bis = labeledInput("Bis", "date", fmtISO(info.we));
  row.append(von.wrap, bis.wrap);
  panel.appendChild(row);

  const notiz = labeledInput("Wer vertritt dich? (optional)", "text", "");
  notiz.input.placeholder = "z. B. Nachbarn aus Wohnung 6";
  panel.appendChild(notiz.wrap);

  addPanelButton(panel, "Vertretung speichern", () => {
    if (!von.input.value || !bis.input.value) return;
    state.vertretungen.push({ id: newId(), von: von.input.value, bis: bis.input.value, notiz: notiz.input.value || "" });
    persist();
    haptic(15);
    renderWeek();
  });

  const divider = document.createElement("div");
  divider.className = "divider";
  divider.innerHTML = "<span>oder</span>";
  panel.appendChild(divider);

  panel.appendChild(panelTitle("Mit einer anderen Woche tauschen"));
  panel.appendChild(buildSwapList(info, "vertretung"));

  addPanelButton(panel, "Abbrechen", () => closePanel(), "ghost");
}

function buildSwapList(info, mode) {
  const wantMine = mode !== "vertretung";
  const container = document.createElement("div");
  container.className = "swap-list";

  let ws = weekStart(new Date());
  const candidates = [];
  for (let i = 0; i < 40 && candidates.length < 12; i++) {
    const key = fmtISO(ws);
    if (key !== info.key && !weekInvolvedInSwap(key)) {
      const wi = weekInfo(ws);
      const hasOther = wi.vertretung || wi.tausch;
      if (!hasOther && wi.highlighted === wantMine) candidates.push(wi);
    }
    ws = addDays(ws, 7);
  }

  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "swap-empty";
    empty.textContent = "Keine passende Woche in n\u00e4chster Zeit gefunden.";
    container.appendChild(empty);
    return container;
  }

  candidates.forEach((wi, idx) => {
    const rowBtn = document.createElement("button");
    rowBtn.type = "button";
    rowBtn.className = "swap-row";
    const v = wohnungVars(wi.baseWohnung);
    rowBtn.style.borderColor = v.border;

    const texts = document.createElement("span");
    texts.className = "swap-row-texts";
    const main = document.createElement("span");
    main.className = "swap-row-main";
    main.textContent = "KW " + kwForWeek(wi.ws) + " \u00b7 " + fmtDate(wi.ws) + "\u2013" + fmtDate(wi.we);
    const sub = document.createElement("span");
    sub.className = "swap-row-sub";
    sub.textContent = wantMine ? "deine Woche" : wohnungName(wi.baseWohnung);
    texts.append(main, sub);
    rowBtn.appendChild(texts);

    if (idx < 3) {
      const badge = document.createElement("span");
      badge.className = "swap-badge";
      badge.textContent = "Vorschlag";
      rowBtn.appendChild(badge);
    }

    rowBtn.addEventListener("click", () => {
      if (performSwap(info.ws, wi.ws)) renderWeek();
    });
    container.appendChild(rowBtn);
  });

  return container;
}

function performSwap(currentWs, otherWs) {
  const a = weekInfo(currentWs);
  const b = weekInfo(otherWs);
  let give, take;
  if (a.highlighted && !b.highlighted) { give = currentWs; take = otherWs; }
  else if (!a.highlighted && b.highlighted) { give = otherWs; take = currentWs; }
  else return false;
  state.swaps.push({ id: newId(), giveWeek: fmtISO(give), takeWeek: fmtISO(take), note: "" });
  persist();
  haptic(15);
  return true;
}

function renderNote(info) {
  const key = fmtISO(info.ws);
  const field = $("#noteField");
  field.value = state.notizen[key] || "";
  field.oninput = () => {
    if (field.value.trim() === "") {
      delete state.notizen[key];
    } else {
      state.notizen[key] = field.value;
    }
    storageSet(STORE_KEYS.notizen, state.notizen);
  };
}

function renderCountdown() {
  const el = $("#countdownText");
  const nextEl = $("#countdownNext");
  if (state.meineWohnung === null) {
    el.innerHTML = "";
    if (nextEl) nextEl.innerHTML = "";
    return;
  }
  const n = remainingKehrwochen();
  el.innerHTML = "Noch <b>" + n + "</b> Kehrwoche" + (n === 1 ? "" : "n") + " f\u00fcr dich in " + new Date().getFullYear();

  if (!nextEl) return;
  const next = nextKehrwoche();
  if (!next) {
    nextEl.innerHTML = "Aktuell keine weitere Kehrwoche eingeplant.";
  } else if (next.weeksAway === 0) {
    nextEl.innerHTML = "Diese Woche bist du dran \u00b7 KW " + kwForWeek(next.ws) + " " + fmtDate(next.ws) + "\u2013" + fmtDate(next.we);
  } else {
    nextEl.innerHTML = "N\u00e4chste Kehrwoche in <b>" + next.weeksAway + "</b> Woche" + (next.weeksAway === 1 ? "" : "n") + " \u00b7 KW " + kwForWeek(next.ws) + " " + fmtDate(next.ws) + "\u2013" + fmtDate(next.we);
  }
}

function renderAll() {
  const onboardingDone = state.meineWohnung !== null && !state.showOnboarding;
  $("#onboarding").classList.toggle("hidden", onboardingDone);
  $("#main").classList.toggle("hidden", !onboardingDone);
  if (!onboardingDone) {
    renderOnboarding();
    return;
  }
  renderHeader();
  renderWeek();
}

/* ---------- Events ---------- */

$("#changeWohnungBtn").addEventListener("click", () => {
  state.showOnboarding = true;
  renderAll();
});

$("#prevWeek").addEventListener("click", () => {
  weekAnimDir = -1;
  state.currentWeekStart = addDays(state.currentWeekStart, -7);
  renderWeek();
});

$("#nextWeek").addEventListener("click", () => {
  weekAnimDir = 1;
  state.currentWeekStart = addDays(state.currentWeekStart, 7);
  renderWeek();
});

// Swipe-Navigation ueber die gesamte Hauptansicht (iOS & Android)
let touchStartX = null;
let touchStartY = null;
const mainEl = $("#main");
mainEl.addEventListener("touchstart", e => {
  if (e.target.closest("input, textarea, button, .panel")) {
    touchStartX = null;
    return;
  }
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
mainEl.addEventListener("touchend", e => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    weekAnimDir = dx < 0 ? 1 : -1;
    state.currentWeekStart = addDays(state.currentWeekStart, dx < 0 ? 7 : -7);
    haptic(8);
    renderWeek();
  }
  touchStartX = null;
  touchStartY = null;
}, { passive: true });

/* ---------- Theme-Verdrahtung ---------- */

document.querySelectorAll(".theme-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    toggleTheme();
    haptic(10);
  });
});

if (window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => { if (storedThemePref() === "auto") applyTheme(); };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

applyTheme();

/* ---------- Start ---------- */

renderAll();

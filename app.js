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
  notizen: "kw_notizen"
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
  currentWeekStart: weekStart(new Date()),
  showOnboarding: false,
  showVertretungForm: false,
  showTauschForm: false
};

function persist() {
  storageSet(STORE_KEYS.vertretungen, state.vertretungen);
  storageSet(STORE_KEYS.tausch, state.tausch);
  storageSet(STORE_KEYS.notizen, state.notizen);
}

/* ---------- Wochenstatus-Logik ---------- */

function findVertretungFor(ws) {
  const we = weekEnd(ws);
  return state.vertretungen.find(v => rangesOverlap(ws, we, new Date(v.von), new Date(v.bis)));
}

function findTauschFor(ws) {
  const key = fmtISO(ws);
  return state.tausch.find(t => t.woche === key);
}

function weekInfo(ws) {
  const baseWohnung = wohnungForDate(ws);
  const isMineByRotation = state.meineWohnung !== null && baseWohnung === state.meineWohnung;
  const vertretung = isMineByRotation ? findVertretungFor(ws) : null;
  const tausch = !isMineByRotation ? findTauschFor(ws) : null;

  const highlighted = (isMineByRotation && !vertretung) || (!!tausch);

  return {
    ws,
    we: weekEnd(ws),
    baseWohnung,
    isMineByRotation,
    vertretung,
    tausch,
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
  const grid = $("#wohnungGrid");
  grid.innerHTML = "";
  for (let i = 1; i <= WOHNUNG_COUNT; i++) {
    const v = wohnungVars(i);
    const btn = document.createElement("div");
    btn.className = "wohnung-pick" + (state.meineWohnung === i ? " selected" : "");
    btn.style.background = v.base;
    btn.style.color = v.text;
    btn.style.borderColor = state.meineWohnung === i ? v.border : "transparent";
    btn.textContent = "Wohnung " + i;
    btn.addEventListener("click", () => {
      state.meineWohnung = i;
      renderOnboarding();
    });
    grid.appendChild(btn);
  }
  $("#saveWohnungBtn").disabled = state.meineWohnung === null;
}

function renderHeader() {
  const header = $("#header");
  if (state.meineWohnung === null) {
    header.classList.add("hidden");
    return;
  }
  header.classList.remove("hidden");
  const v = wohnungVars(state.meineWohnung);
  $("#avatar").textContent = "W" + state.meineWohnung;
  $("#avatar").style.background = v.strong;
  $("#avatar").style.color = v.text;
  $("#headerTitle").textContent = "Wohnung " + state.meineWohnung;
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

  const headline = $("#headline");
  const subline = $("#subline");
  const tag = $("#weekTag");
  headline.style.color = info.highlighted ? v.text : "var(--text-primary)";
  subline.style.color = info.highlighted ? v.text : "var(--text-secondary)";

  if (info.highlighted) {
    headline.textContent = "Du bist dran";
    subline.textContent = "Diese Woche hast du Kehrwoche.";
  } else {
    headline.textContent = "Wohnung " + info.baseWohnung + " ist dran";
    subline.textContent = "Du hast diese Woche keine Kehrwoche.";
  }

  if (info.tausch) {
    tag.textContent = "Getauscht";
    tag.classList.remove("hidden");
  } else if (info.vertretung) {
    tag.textContent = "Vertretung eingetragen";
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
  state.showVertretungForm = false;
  state.showTauschForm = false;
  $("#vertretungForm").classList.add("hidden");
  $("#tauschForm").classList.add("hidden");

  if (info.isMineByRotation && !info.vertretung) {
    addButton(wrap, "Vertretung eintragen", () => toggleForm("vertretungForm"));
  } else if (info.vertretung) {
    addButton(wrap, "Vertretung entfernen", () => {
      state.vertretungen = state.vertretungen.filter(v => v.id !== info.vertretung.id);
      persist();
      renderWeek();
    }, true);
  } else if (info.tausch) {
    addButton(wrap, "Tausch entfernen", () => {
      state.tausch = state.tausch.filter(t => t.id !== info.tausch.id);
      persist();
      renderWeek();
    }, true);
  } else if (!info.isMineByRotation) {
    addButton(wrap, "Diese Woche tauschen", () => toggleForm("tauschForm"));
  }

  $("#vertretungVon").value = fmtISO(info.ws);
  $("#vertretungBis").value = fmtISO(info.we);
}

function addButton(wrap, label, onClick, danger) {
  const b = document.createElement("button");
  b.className = "btn" + (danger ? " danger" : "");
  b.textContent = label;
  b.addEventListener("click", onClick);
  wrap.appendChild(b);
}

function toggleForm(id) {
  const el = $("#" + id);
  el.classList.toggle("hidden");
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
  if (state.meineWohnung === null) {
    el.innerHTML = "";
    return;
  }
  const n = remainingKehrwochen();
  el.innerHTML = "Noch <b>" + n + "</b> Kehrwoche" + (n === 1 ? "" : "n") + " für dich in " + new Date().getFullYear();
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

$("#saveWohnungBtn").addEventListener("click", () => {
  if (state.meineWohnung === null) return;
  storageSet(STORE_KEYS.wohnung, state.meineWohnung);
  state.showOnboarding = false;
  renderAll();
});

$("#changeWohnungBtn").addEventListener("click", () => {
  state.showOnboarding = true;
  renderAll();
});

$("#prevWeek").addEventListener("click", () => {
  state.currentWeekStart = addDays(state.currentWeekStart, -7);
  renderWeek();
});

$("#nextWeek").addEventListener("click", () => {
  state.currentWeekStart = addDays(state.currentWeekStart, 7);
  renderWeek();
});

// Swipe-Navigation (iOS & Android einheitlich über Touch-Events)
let touchStartX = null;
const cardEl = $("#weekCard");
cardEl.addEventListener("touchstart", e => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });
cardEl.addEventListener("touchend", e => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 40) {
    state.currentWeekStart = addDays(state.currentWeekStart, dx < 0 ? 7 : -7);
    renderWeek();
  }
  touchStartX = null;
}, { passive: true });

$("#vertretungSave").addEventListener("click", () => {
  const von = $("#vertretungVon").value;
  const bis = $("#vertretungBis").value;
  if (!von || !bis) return;
  state.vertretungen.push({ id: newId(), von, bis, notiz: $("#vertretungNotiz").value || "" });
  persist();
  $("#vertretungNotiz").value = "";
  renderWeek();
});

$("#tauschSave").addEventListener("click", () => {
  const info = weekInfo(state.currentWeekStart);
  state.tausch.push({ id: newId(), woche: fmtISO(info.ws), notiz: $("#tauschNotiz").value || "" });
  persist();
  $("#tauschNotiz").value = "";
  renderWeek();
});

/* ---------- Start ---------- */

renderAll();

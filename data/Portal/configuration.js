// data/Portal/configuration.js

async function apiGetConfig() {
  const r = await fetch("/api/config", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/config failed: ${r.status}`);
  return await r.json();
}

async function apiSaveConfig(obj) {
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  if (!r.ok) throw new Error(`POST /api/config failed: ${r.status}`);
  return await r.json();
}

function $(id) {
  return document.getElementById(id);
}

/* ---------- text fields ---------- */

function setText(id, v) {
  const el = $(id);
  if (!el) return;
  el.value = (v ?? "").toString();
}

function getText(id) {
  const el = $(id);
  if (!el) return "";
  return (el.value ?? "").toString().trim();
}

/* ---------- checkbox fields ---------- */

function setCheck(id, v) {
  const el = $(id);
  if (!el) return;
  el.checked = !!v;
}

function getCheck(id) {
  const el = $(id);
  if (!el) return false;
  return !!el.checked;
}

/* ---------- status pill ---------- */

function refreshStatus(msg, isError = false) {
  const el = $("statusPill");
  if (!el) return;

  el.textContent = msg;
  el.style.opacity = "1";
  el.style.fontWeight = "700";
  el.style.background = isError ? "#dc2626" : "#16a34a";
}

/* ---------- field maps (ONLY what exists in HTML) ---------- */

const FIELD_MAP_TEXT = {
  callsign: "callsign",
  balloonType: "balloonType",
  note: "note",
};

const FIELD_MAP_CHECK = {
  autoErase: "autoErase",
};

/* ---------- form helpers ---------- */

function fillForm(cfg) {
  for (const [id, key] of Object.entries(FIELD_MAP_TEXT)) {
    setText(id, cfg?.[key]);
  }
  for (const [id, key] of Object.entries(FIELD_MAP_CHECK)) {
    setCheck(id, cfg?.[key]);
  }
}

function readForm() {
  const out = {};

  for (const [id, key] of Object.entries(FIELD_MAP_TEXT)) {
    out[key] = getText(id);
  }
  for (const [id, key] of Object.entries(FIELD_MAP_CHECK)) {
    out[key] = getCheck(id);
  }

  return out;
}

/* ---------- lifecycle ---------- */

async function onLoad() {
  try {
    const cfg = await apiGetConfig();
    fillForm(cfg);
    refreshStatus("Loaded");
  } catch (e) {
    refreshStatus("Load failed", true);
  }

  const saveBtn = $("saveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        const data = readForm();
        const res = await apiSaveConfig(data);
        if (res?.ok) refreshStatus("Saved");
        else refreshStatus("Save failed", true);
      } catch (e) {
        refreshStatus("Save failed", true);
      }
    });
  }
}

window.addEventListener("DOMContentLoaded", onLoad);
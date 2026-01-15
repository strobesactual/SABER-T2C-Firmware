// data/Portal/configuration.js

async function apiGetConfig() {
  const r = await fetch("/api/config", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/config failed: ${r.status}`);
  return await r.json();
}

async function apiGetStatus() {
  const r = await fetch("/api/status", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/status failed: ${r.status}`);
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

function setGpsStatusPill(gpsFix, sats) {
  const el = $("statusPill");
  if (!el) return;
  el.classList.remove("status-good", "status-nofix");
  if (gpsFix) {
    const count = Number(sats);
    el.textContent = Number.isFinite(count) ? `Good ${count}` : "Good";
    el.classList.add("status-good");
  } else {
    el.textContent = "No Fix";
    el.classList.add("status-nofix");
  }
}

function showSaveFlag(msg, isError = false) {
  const el = $("saveFlag");
  if (!el) return;
  el.textContent = msg;
  el.style.background = isError ? "#dc2626" : "#16a34a";
  el.classList.add("is-visible");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove("is-visible");
  }, 2500);
}

function toggleStateBox(id, ok) {
  const el = $(id);
  if (!el) return;
  el.classList.toggle("box-state-good", !!ok);
  el.classList.toggle("box-state-bad", !ok);
}

function setGpsFields(status) {
  const hasFix = !!status?.gpsFix;
  const satCount = Number(status?.sats);
  const satcomId = extractSatcomId(status);
  const satcomState = satcomId ? "GOOD" : "INIT";
  const flightRaw = (status?.flightState || "").toString().trim().toUpperCase();
  const flightText = (flightRaw === "FLT" || flightRaw === "FLIGHT") ? "FLIGHT" : "GROUND";

  setText("gpsFixText", hasFix ? "GOOD" : "NO FIX");
  setText("gpsSats", Number.isFinite(satCount) ? satCount : "");
  setText("satcomState", satcomState);
  setText("globalstarId", satcomId);
  setText("gpsFlight", flightText);
  setMissionFields(status);

  const satcomOk = satcomState === "GOOD";
  toggleStateBox("gpsFixText", hasFix);
  toggleStateBox("satcomState", satcomOk);

  const lat = Number(status.lat);
  const lon = Number(status.lon);
  const altM = Number(status.alt_m);
  const altFt = altM * 3.28084;

  setText("lat", Number.isFinite(lat) ? lat.toFixed(6) : "");
  setText("lon", Number.isFinite(lon) ? lon.toFixed(6) : "");
  setText("alt_m", Number.isFinite(altM) ? altM.toFixed(1) : "");
  setText("alt_ft", Number.isFinite(altFt) ? altFt.toFixed(1) : "");
}

function extractSatcomId(status) {
  if (!status) return "";
  const direct = status.globalstarId || status.satcomId || status.satId || "";
  if (direct) return String(direct).trim();

  const satcom = (status.satcom || status.satcomState || "").toString();
  const match = satcom.match(/(\\d{4,})/);
  return match ? match[1] : "";
}

function setMissionFields(status) {
  const hold = (status?.holdState || "").toString().trim().toUpperCase();
  const statusText = hold === "HOLD" ? "HOLD" : "READY";
  const triggerCount = Number(status?.triggerCount);
  const totalSec = Number(status?.ttTotalSec);
  const timerTrigger = Number.isFinite(totalSec) && totalSec > 60 ? 1 : 0;
  const geoCountText = Number.isFinite(triggerCount)
    ? Math.max(triggerCount - timerTrigger, 0)
    : 0;
  const lora = (status?.lora || "").toString().trim();
  const batt = Number(status?.battery);
  const battText = Number.isFinite(batt) && batt >= 0 ? `${batt}%` : "--";
  const minutes = Number(status?.ttTotalMin);
  const minutesText = Number.isFinite(minutes) ? String(minutes).padStart(4, "0") : "0000";

  const statusEl = document.getElementById("missionStatus");
  const loraEl = document.getElementById("missionLora");
  const battEl = document.getElementById("missionBattery");
  const geoEl = document.getElementById("missionGeofenceCount");
  const secEl = document.getElementById("missionTerminationSeconds");

  if (statusEl) {
    statusEl.textContent = statusText.toUpperCase();
    toggleStateBox("missionStatus", hold !== "HOLD");
  }
  if (loraEl) {
    const ready = lora && lora.toUpperCase() !== "INIT";
    loraEl.textContent = ready ? "READY" : "N/A";
    toggleStateBox("missionLora", ready);
  }
  if (battEl) battEl.textContent = battText;
  if (geoEl) geoEl.textContent = String(geoCountText).padStart(2, "0");
  if (secEl) secEl.textContent = minutesText;
}

/* ---------- field maps (ONLY what exists in HTML) ---------- */

const FIELD_MAP_TEXT = {
  callsign: "callsign",
  balloonType: "balloonType",
  note: "note",
};

const FIELD_MAP_CHECK = {
  autoErase: "autoErase",
  satcomMessages: "satcomMessages",
};

/* ---------- form helpers ---------- */

function fillForm(cfg) {
  for (const [id, key] of Object.entries(FIELD_MAP_TEXT)) {
    let val = cfg?.[key];
    if (key === "callsign" && (!val || String(val).trim() === "")) {
      val = "NONE";
    }
    setText(id, val);
  }
  for (const [id, key] of Object.entries(FIELD_MAP_CHECK)) {
    setCheck(id, cfg?.[key]);
  }
}

function readForm() {
  const out = {};

  for (const [id, key] of Object.entries(FIELD_MAP_TEXT)) {
    let val = getText(id);
    if (key === "callsign") {
      val = val.slice(0, 6);
    }
    out[key] = val;
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
  } catch (e) {
    showSaveFlag("Load failed", true);
  }

  try {
    const status = await apiGetStatus();
    setGpsFields(status);
  } catch (e) {
    setGpsFields({ gpsFix: false });
  }

  setInterval(async () => {
    try {
      const status = await apiGetStatus();
      setGpsFields(status);
    } catch (e) {
      setGpsFields({ gpsFix: false });
    }
  }, 2000);

  const saveBtn = $("saveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        const data = readForm();
        const res = await apiSaveConfig(data);
        if (res?.ok) {
          showSaveFlag("Changes Saved");
        } else {
          showSaveFlag("Save failed", true);
        }
      } catch (e) {
        showSaveFlag("Save failed", true);
      }
    });
  }
}

window.addEventListener("DOMContentLoaded", onLoad);

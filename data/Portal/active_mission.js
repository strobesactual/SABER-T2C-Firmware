function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function markError(el, on) {
  if (!el) return;
  el.classList.toggle("field-error", !!on);
}

function showSaveFlag(msg, isError = false) {
  const el = document.getElementById("saveFlag");
  if (!el) return;
  el.textContent = msg;
  el.style.background = isError ? "#dc2626" : "#16a34a";
  el.classList.add("is-visible");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove("is-visible");
  }, 2500);
}

async function apiGetStatus() {
  const r = await fetch("/api/status", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/status failed: ${r.status}`);
  return await r.json();
}

async function apiGetGeofence() {
  const r = await fetch("/api/geofence", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/geofence failed: ${r.status}`);
  return await r.json();
}

async function apiSaveGeofence(obj) {
  const r = await fetch("/api/geofence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  if (!r.ok) throw new Error(`POST /api/geofence failed: ${r.status}`);
  return await r.json();
}

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

function setText(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = (v ?? "").toString();
  } else {
    el.textContent = v ?? "--";
  }
}

const MAX_POINTS = 10;
let keepOutDraft = [];
let remainInDraft = [];
let keepOutPolygons = [];
let remainInPolygon = [];
let currentGeofenceDoc = { keep_out: [], stay_in: [], lines: [] };

function renderPointList(containerId, points) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";
  points.forEach((pt, idx) => {
    const row = document.createElement("div");
    row.className = "point-row";
    row.innerHTML = `
      <span class="point-label">Point ${idx + 1}</span>
      <label>Latitude</label>
      <input data-idx="${idx}" data-field="lat" type="number" step="0.000001" value="${pt.lat ?? ""}" />
      <label>Longitude</label>
      <input data-idx="${idx}" data-field="lon" type="number" step="0.000001" value="${pt.lon ?? ""}" />
    `;
    container.appendChild(row);
  });
}

function addPoint(points, containerId) {
  if (points.length >= MAX_POINTS) return;
  const toAdd = points.length === 0 ? 3 : 1;
  for (let i = 0; i < toAdd && points.length < MAX_POINTS; i++) {
    points.push({ lat: "", lon: "" });
  }
  renderPointList(containerId, points);
}

function bindPointInputs(containerId, points) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.addEventListener("input", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    const idx = Number(target.dataset.idx);
    const field = target.dataset.field;
    if (!Number.isFinite(idx) || !field) return;
    if (!points[idx]) return;
    points[idx][field] = target.value;
  });
}

function validatePoints(points, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return true;
  let ok = true;
  container.querySelectorAll("input[data-field]").forEach((input) => {
    const idx = Number(input.dataset.idx);
    const field = input.dataset.field;
    const otherField = field === "lat" ? "lon" : "lat";
    const value = input.value.trim();
    const other = container.querySelector(`input[data-idx="${idx}"][data-field="${otherField}"]`);
    const otherVal = other?.value?.trim() ?? "";

    const partial = (value && !otherVal) || (!value && otherVal);
    markError(input, partial);
    if (other) markError(other, partial);
    if (partial) ok = false;
  });
  return ok;
}

function pointsToPolygon(points) {
  return points
    .filter((p) => !isEmpty(p.lat) && !isEmpty(p.lon))
    .map((p) => [Number(p.lat), Number(p.lon)]);
}

function formatPointValue(v) {
  const num = Number(v);
  return Number.isFinite(num) ? num.toFixed(6) : "--";
}

function renderSavedPolygons() {
  const keepOutEl = document.getElementById("keepOutSaved");
  const remainEl = document.getElementById("remainInSaved");

  if (keepOutEl) {
    if (keepOutPolygons.length === 0) {
      keepOutEl.innerHTML = '<div class="muted">No polygons saved.</div>';
    } else {
      keepOutEl.innerHTML = keepOutPolygons
        .map((poly, idx) => `
          <div class="saved-poly-card">
            <div class="saved-poly-title">Keep-out ${idx + 1}</div>
            ${poly.map((pt, i) => `
              <div class="saved-poly-point">${i + 1}. ${formatPointValue(pt[0])}, ${formatPointValue(pt[1])}</div>
            `).join("")}
          </div>
        `)
        .join("");
    }
  }

  if (remainEl) {
    if (remainInPolygon.length === 0) {
      remainEl.innerHTML = '<div class="muted">No polygon saved.</div>';
    } else {
      remainEl.innerHTML = `
        <div class="saved-poly-card">
          <div class="saved-poly-title">Remain-in</div>
          ${remainInPolygon.map((pt, i) => `
            <div class="saved-poly-point">${i + 1}. ${formatPointValue(pt[0])}, ${formatPointValue(pt[1])}</div>
          `).join("")}
        </div>
      `;
    }
  }
}

function getTimedTotalSeconds() {
  const days = Number(document.getElementById("tt_days")?.value || 0);
  const hours = Number(document.getElementById("tt_hours")?.value || 0);
  const minutes = Number(document.getElementById("tt_minutes")?.value || 0);
  const seconds = Number(document.getElementById("tt_seconds")?.value || 0);

  if (![days, hours, minutes, seconds].every((v) => Number.isFinite(v))) return 0;
  return (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;
}

function updateTimedTotal() {
  const total = getTimedTotalSeconds();
  const totalEl = document.getElementById("tt_total");
  if (totalEl) totalEl.value = String(total);
}

function collectLines(count) {
  const lines = [];

  for (let i = 1; i <= count; i++) {
    const axisEl = document.getElementById(`line_axis_${i}`);
    const valueEl = document.getElementById(`line_value_${i}`);
    const valueRaw = valueEl?.value?.trim();
    if (isEmpty(valueRaw)) continue;

    const axisRaw = axisEl?.value || "N/S";
    const axis = axisRaw.toUpperCase() === "E/W" ? "E/W" : "N/S";
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) continue;

    lines.push({
      id: `Line ${i}`,
      axis,
      value,
    });
  }

  return lines;
}

function fillLineInputs(lines, count) {
  for (let i = 1; i <= count; i++) {
    const axisEl = document.getElementById(`line_axis_${i}`);
    const valueEl = document.getElementById(`line_value_${i}`);
    const line = lines?.[i - 1];

    if (!axisEl || !valueEl) continue;

    if (line) {
      axisEl.value = (line.axis || "N/S").toUpperCase() === "E/W" ? "E/W" : "N/S";
      valueEl.value = Number.isFinite(Number(line.value)) ? Number(line.value).toFixed(4) : "";
    } else {
      axisEl.value = "N/S";
      valueEl.value = "";
    }
  }
}

function validateLineRows(count) {
  let ok = true;
  for (let i = 1; i <= count; i++) {
    const valueEl = document.getElementById(`line_value_${i}`);
    const valueRaw = valueEl?.value?.trim();
    if (isEmpty(valueRaw)) {
      markError(valueEl, false);
      continue;
    }

    const value = Number(valueRaw);
    const inRange = Number.isFinite(value) && value >= -180 && value <= 180;
    markError(valueEl, !inRange);
    if (!inRange) ok = false;
  }
  return ok;
}

function updateCounters() {
  setText("countTimed", getTimedTotalSeconds() > 0 ? 1 : 0);
  setText("countKeepOut", keepOutPolygons.length);
  setText("countRemainIn", remainInPolygon.length ? 1 : 0);
  setText("countLines", collectLines(4).length);
}

async function loadStatus() {
  try {
    const status = await apiGetStatus();
    setText("amMissionCallsign", status?.callsign || "--");

    const flight = (status?.flightState || "").toString().toUpperCase();
    const flightText = flight === "GND" ? "Ground" : flight === "FLT" ? "Flight" : flight || "--";
    const hold = (status?.holdState || "").toString().toUpperCase();
    const systemText = hold === "HOLD" ? "Hold" : "Ready";
  } catch (e) {
    setText("amMissionCallsign", "--");
  }
}

async function loadConfig() {
  try {
    const cfg = await apiGetConfig();
    const input = document.getElementById("missionId");
    if (input) input.value = (cfg?.missionId || "").toString();
    const satcom = document.getElementById("satcomMessagesMission");
    if (satcom) satcom.checked = !!cfg?.satcomMessages;
    if (typeof cfg?.ttTotalSec === "number") {
      const totalEl = document.getElementById("tt_total");
      if (totalEl) totalEl.value = String(cfg.ttTotalSec);
    }
  } catch (e) {
    const input = document.getElementById("missionId");
    if (input) input.value = "";
  }
}

async function loadGeofence() {
  try {
    const doc = await apiGetGeofence();
    currentGeofenceDoc = doc || currentGeofenceDoc;
    keepOutPolygons = (currentGeofenceDoc.keep_out || []).map((rule) => rule.polygon || []);
    remainInPolygon = (currentGeofenceDoc.stay_in || [])[0]?.polygon || [];
    fillLineInputs(currentGeofenceDoc.lines || [], 4);
    for (let i = 1; i <= 4; i++) {
      const axis = document.getElementById(`line_axis_${i}`);
      if (axis) updateAxisLabel(axis);
    }
  } catch (e) {
    currentGeofenceDoc = { keep_out: [], stay_in: [], lines: [] };
    keepOutPolygons = [];
    remainInPolygon = [];
    fillLineInputs([], 4);
  }

  renderSavedPolygons();
  updateCounters();
  setRemainButtonsState();
}

function wireEvents() {
  const keepOutAdd = document.getElementById("keepOutAdd");
  const keepOutSave = document.getElementById("keepOutSave");
  const remainAdd = document.getElementById("remainInAdd");
  const remainSave = document.getElementById("remainInSave");

  if (keepOutAdd) keepOutAdd.addEventListener("click", () => {
    addPoint(keepOutDraft, "keepOutPoints");
  });
  if (keepOutSave) keepOutSave.addEventListener("click", () => {
    if (!validatePoints(keepOutDraft, "keepOutPoints")) return;
    const poly = pointsToPolygon(keepOutDraft);
    if (poly.length < 3) {
      alert("Keep-out polygon requires at least 3 points.");
      return;
    }
    keepOutPolygons.push(poly);
    keepOutDraft.length = 0;
    renderPointList("keepOutPoints", keepOutDraft);
    renderSavedPolygons();
    updateCounters();
  });

  if (remainAdd) remainAdd.addEventListener("click", () => {
    if (remainInPolygon.length) {
      alert("Only one remain-in polygon is allowed.");
      return;
    }
    addPoint(remainInDraft, "remainInPoints");
  });
  if (remainSave) remainSave.addEventListener("click", () => {
    if (remainInPolygon.length) {
      alert("Only one remain-in polygon is allowed.");
      return;
    }
    if (!validatePoints(remainInDraft, "remainInPoints")) return;
    const poly = pointsToPolygon(remainInDraft);
    if (poly.length < 3) {
      alert("Remain-in polygon requires at least 3 points.");
      return;
    }
    const area = Math.abs(polygonArea(poly));
    if (area === 0) {
      alert("Remain-in polygon is invalid. Points must form a closed shape.");
      return;
    }
    remainInPolygon = poly;
    remainInDraft.length = 0;
    renderPointList("remainInPoints", remainInDraft);
    renderSavedPolygons();
    updateCounters();
    setRemainButtonsState();
  });

  bindPointInputs("keepOutPoints", keepOutDraft);
  bindPointInputs("remainInPoints", remainInDraft);

  ["tt_days", "tt_hours", "tt_minutes", "tt_seconds"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      updateTimedTotal();
      updateCounters();
    });
  });

  for (let i = 1; i <= 4; i++) {
    const value = document.getElementById(`line_value_${i}`);
    const axis = document.getElementById(`line_axis_${i}`);
    [value, axis].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", updateCounters);
      el.addEventListener("change", updateCounters);
    });
    if (axis) {
      axis.addEventListener("change", () => updateAxisLabel(axis));
      updateAxisLabel(axis);
    }
    if (value) {
      value.addEventListener("blur", () => formatAxisValue(value));
    }
  }
}

function onSaveClick() {
  if (!validateLineRows(4)) {
    alert("Each shall-not-pass line must include a value between -180 and 180.");
    return;
  }

  const keepOutRule = keepOutPolygons.map((poly, idx) => ({
    id: `KeepOut-${idx + 1}`,
    polygon: poly,
  }));

  const stayInRule = remainInPolygon.length
    ? [{ id: "StayIn", polygon: remainInPolygon }]
    : [];

  currentGeofenceDoc = {
    keep_out: keepOutRule,
    stay_in: stayInRule,
    lines: collectLines(4),
  };

  const missionIdInput = document.getElementById("missionId");
  const missionId = missionIdInput?.value?.trim() || "";
  const satcom = document.getElementById("satcomMessagesMission");
  const satcomMessages = !!satcom?.checked;
  const ttTotalSec = getTimedTotalSeconds();

  Promise.all([
    apiSaveGeofence(currentGeofenceDoc),
    (async () => {
      const cfg = await apiGetConfig().catch(() => ({}));
      cfg.missionId = missionId;
      cfg.satcomMessages = satcomMessages;
      cfg.ttTotalSec = ttTotalSec;
      return apiSaveConfig(cfg);
    })(),
  ])
    .then(() => {
      updateCounters();
      showSaveFlag("Changes Saved");
    })
    .catch(() => showSaveFlag("Save failed", true));
}

document.addEventListener("DOMContentLoaded", () => {
  renderPointList("keepOutPoints", keepOutDraft);
  renderPointList("remainInPoints", remainInDraft);

  wireEvents();
  updateTimedTotal();
  updateCounters();
  loadStatus();
  loadConfig();
  loadGeofence();

  setInterval(loadStatus, 2000);

  const saveBtn = document.getElementById("saveActiveMission");
  if (saveBtn) saveBtn.addEventListener("click", onSaveClick);
});

function updateAxisLabel(axisEl) {
  const row = axisEl?.closest(".line-row-inline");
  if (!row) return;
  const label = row.querySelector(".axis-value-label");
  if (!label) return;
  const axis = axisEl.value === "E/W" ? "E/W" : "N/S";
  label.textContent = axis === "N/S" ? "Longitude" : "Latitude";
}

function formatAxisValue(input) {
  const num = Number(input.value);
  if (!Number.isFinite(num)) return;
  input.value = num.toFixed(4);
}

function polygonArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += (x1 * y2) - (x2 * y1);
  }
  return area / 2;
}

function setRemainButtonsState() {
  const remainAdd = document.getElementById("remainInAdd");
  const remainSave = document.getElementById("remainInSave");
  const locked = remainInPolygon.length > 0;
  if (remainAdd) remainAdd.disabled = locked;
  if (remainSave) remainSave.disabled = locked;
}

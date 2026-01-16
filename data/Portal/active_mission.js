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

async function apiSaveMission(obj) {
  const r = await fetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  if (!r.ok) throw new Error(`POST /api/missions failed: ${r.status}`);
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
let createPolyDraft = [];
let keepOutPolygons = [];
let remainInPolygon = [];
let currentGeofenceDoc = { keep_out: [], stay_in: [], lines: [] };
let lastStatus = null;
let suaCatalog = [];
const suaById = new Map();
const suaNameById = new Map();
const keepOutFromSua = new Map();
let remainInFromSua = null;
let suaBin = null;
let suaStringOffset = 0;
let suaGeomOffset = 0;
let selectedSuaId = "";

const MAX_KEEP_OUT = 5;
const ARC_STEP_M = 1000;

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

function closePolygon(poly) {
  if (poly.length < 3) return poly;
  const first = poly[0];
  const last = poly[poly.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    poly.push([first[0], first[1]]);
  }
  return poly;
}

function formatPointValue(v) {
  const num = Number(v);
  return Number.isFinite(num) ? num.toFixed(6) : "--";
}

function readCString(buf, offset) {
  const bytes = new Uint8Array(buf, offset);
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return new TextDecoder().decode(bytes.slice(0, end));
}

function metersToDegLat(m) {
  return m / 111320;
}

function metersToDegLon(m, latDeg) {
  const denom = 111320 * Math.cos((latDeg * Math.PI) / 180);
  return m / (denom || 1);
}

function arcToPoints(seg) {
  const startDeg = seg.start_cd / 100;
  const endDeg = seg.end_cd / 100;
  const direction = seg.direction;
  let start = ((startDeg % 360) + 360) % 360;
  let end = ((endDeg % 360) + 360) % 360;

  let delta;
  let stepSign;
  if (direction === 1) {
    if (end < start) end += 360;
    delta = end - start;
    stepSign = 1;
  } else {
    if (start < end) start += 360;
    delta = start - end;
    stepSign = -1;
  }

  const arcLen = (delta * Math.PI / 180) * seg.radius_m;
  const steps = Math.max(2, Math.ceil(arcLen / ARC_STEP_M));
  const pts = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = start + stepSign * (delta * t);
    const angRad = (ang * Math.PI) / 180;
    const dx = Math.cos(angRad) * seg.radius_m;
    const dy = Math.sin(angRad) * seg.radius_m;
    const lat = seg.center[0] + metersToDegLat(dy);
    const lon = seg.center[1] + metersToDegLon(dx, seg.center[0]);
    pts.push([lat, lon]);
  }

  return pts;
}

function appendPoint(list, pt) {
  if (!list.length || list[list.length - 1][0] !== pt[0] || list[list.length - 1][1] !== pt[1]) {
    list.push(pt);
  }
}

function segmentsToRing(segments) {
  const ring = [];
  segments.forEach((seg) => {
    if (seg.type === "LINE") {
      appendPoint(ring, seg.start);
      appendPoint(ring, seg.end);
    } else if (seg.type === "ARC") {
      arcToPoints(seg).forEach((pt) => appendPoint(ring, pt));
    }
  });
  if (ring.length >= 3) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  }
  return ring;
}

function parseAreaGeometry(area) {
  if (!suaBin) return null;
  const view = new DataView(suaBin);
  let offset = suaGeomOffset + area.geom_offset;
  const ringCount = view.getUint16(offset, true);
  offset += 2;
  offset += 2; // reserved
  const typeLen = view.getUint16(offset, true);
  offset += 2;
  offset += 2; // reserved
  const typeOffset = view.getUint32(offset, true);
  offset += 4;

  const typeCode = typeLen > 0 ? readCString(suaBin, suaStringOffset + typeOffset) : "";
  const rings = [];

  for (let r = 0; r < ringCount; r++) {
    const segCount = view.getUint16(offset, true);
    offset += 2;
    offset += 2; // reserved
    const segments = [];

    for (let s = 0; s < segCount; s++) {
      const segType = view.getUint8(offset);
      offset += 1;
      if (segType === 0x01) {
        const sLat = view.getInt32(offset, true); offset += 4;
        const sLon = view.getInt32(offset, true); offset += 4;
        const eLat = view.getInt32(offset, true); offset += 4;
        const eLon = view.getInt32(offset, true); offset += 4;
        segments.push({
          type: "LINE",
          start: [sLat / 1e6, sLon / 1e6],
          end: [eLat / 1e6, eLon / 1e6],
        });
      } else if (segType === 0x02) {
        const sLat = view.getInt32(offset, true); offset += 4;
        const sLon = view.getInt32(offset, true); offset += 4;
        const eLat = view.getInt32(offset, true); offset += 4;
        const eLon = view.getInt32(offset, true); offset += 4;
        const cLat = view.getInt32(offset, true); offset += 4;
        const cLon = view.getInt32(offset, true); offset += 4;
        const radius = view.getUint32(offset, true); offset += 4;
        const startCd = view.getUint16(offset, true); offset += 2;
        const endCd = view.getUint16(offset, true); offset += 2;
        const direction = view.getUint8(offset); offset += 1;
        segments.push({
          type: "ARC",
          start: [sLat / 1e6, sLon / 1e6],
          end: [eLat / 1e6, eLon / 1e6],
          center: [cLat / 1e6, cLon / 1e6],
          radius_m: radius,
          start_cd: startCd,
          end_cd: endCd,
          direction: direction,
        });
      } else {
        return null;
      }
    }

    rings.push({
      segments,
      polygon: segmentsToRing(segments),
    });
  }

  return { type_code: typeCode, rings };
}

function previewPolygonPoints(poly, limit = 20) {
  if (poly.length <= limit) return poly;
  const headCount = Math.ceil(limit / 2);
  const tailCount = Math.floor(limit / 2);
  return [...poly.slice(0, headCount), null, ...poly.slice(-tailCount)];
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
            ${previewPolygonPoints(poly).map((pt, i) => pt ? `
              <div class="saved-poly-point">${i + 1}. ${formatPointValue(pt[0])}, ${formatPointValue(pt[1])}</div>
            ` : `
              <div class="saved-poly-point">...</div>
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
          ${previewPolygonPoints(remainInPolygon).map((pt, i) => pt ? `
            <div class="saved-poly-point">${i + 1}. ${formatPointValue(pt[0])}, ${formatPointValue(pt[1])}</div>
          ` : `
            <div class="saved-poly-point">...</div>
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
  const totalSeconds = getTimedTotalSeconds();
  const totalMinutes = Math.round(totalSeconds / 60);
  const totalEl = document.getElementById("tt_total");
  if (totalEl) totalEl.value = String(totalMinutes);
}

function setTimedEnabled(enabled) {
  ["tt_days", "tt_hours", "tt_minutes", "tt_seconds"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = !enabled;
    if (!enabled) {
      el.setAttribute("readonly", "readonly");
    } else {
      el.removeAttribute("readonly");
    }
    el.classList.toggle("box-editable", enabled);
    el.classList.toggle("box-display", !enabled);
  });
  if (!enabled) {
    ["tt_days", "tt_hours", "tt_minutes", "tt_seconds"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "0";
    });
  }
  updateTimedTotal();
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
    lastStatus = status;
    setText("amMissionCallsign", status?.callsign || "--");
    setText("amSatcomId", status?.globalstarId || status?.satcom_id || "--");

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
    if (satcom) satcom.checked = !!cfg?.satcom_id;
    if (typeof cfg?.time_kill_min === "number") {
      const totalEl = document.getElementById("tt_total");
      if (totalEl) totalEl.value = String(cfg.time_kill_min);
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
    keepOutFromSua.clear();
    remainInFromSua = null;
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
  renderSuaList();
}

async function fetchFirstOk(urls, type = "arrayBuffer") {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastErr = new Error(`GET ${url} failed: ${res.status}`);
        continue;
      }
      if (type === "arrayBuffer") return await res.arrayBuffer();
      if (type === "json") return await res.json();
      return await res.text();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Fetch failed");
}

async function loadSuaCatalog() {
  const tbody = document.getElementById("suaSelect");
  try {
    const idxBuf = await fetchFirstOk(["/sua_catalog.idx", "../sua_catalog.idx"]);
    suaBin = await fetchFirstOk(["/sua_catalog.bin", "../sua_catalog.bin"]);

    const idxView = new DataView(idxBuf);
    const binView = new DataView(suaBin);
    const idxMagic = String.fromCharCode(
      idxView.getUint8(0), idxView.getUint8(1), idxView.getUint8(2), idxView.getUint8(3)
    );
    const binMagic = String.fromCharCode(
      binView.getUint8(0), binView.getUint8(1), binView.getUint8(2), binView.getUint8(3)
    );
    if (idxMagic !== "SIA1" || binMagic !== "SIA1") {
      throw new Error("Invalid SUA catalog format");
    }

    const entrySize = idxView.getUint16(6, true);
    const entryCount = idxView.getUint32(8, true);

    suaStringOffset = binView.getUint32(8, true);
    suaGeomOffset = binView.getUint32(12, true);

    suaCatalog = [];
    suaById.clear();
    suaNameById.clear();

    let offset = 16;
    for (let i = 0; i < entryCount; i++) {
      const nameOffset = idxView.getUint32(offset + 4, true);
      const geomOffset = idxView.getUint32(offset + 8, true);
      const geomLength = idxView.getUint32(offset + 12, true);
      const name = readCString(suaBin, suaStringOffset + nameOffset);
      if (name) {
        const area = { id: name, name, geom_offset: geomOffset, geom_length: geomLength };
        suaCatalog.push(area);
        suaById.set(name, area);
        suaNameById.set(name, name);
      }
      offset += entrySize;
    }

    suaCatalog.sort((a, b) => a.name.localeCompare(b.name));
    renderSuaList();
  } catch (e) {
    if (tbody) tbody.innerHTML = "<option>Failed to load areas.</option>";
  }
}

function renderSuaList() {
  const list = document.getElementById("suaSelect");
  const countEl = document.getElementById("suaCount");
  if (!list) return;
  list.innerHTML = "";

  if (!suaCatalog.length) {
    const opt = document.createElement("option");
    opt.textContent = "No areas available.";
    opt.disabled = true;
    opt.selected = true;
    list.appendChild(opt);
    if (countEl) countEl.textContent = "";
    updateSuaActionButtons();
    return;
  }

  const query = (document.getElementById("suaSearch")?.value || "").trim().toLowerCase();
  const filtered = query
    ? suaCatalog.filter((area) => {
        const haystack = `${area.name} ${area.id}`.toLowerCase();
        return haystack.includes(query);
      })
    : suaCatalog;

  if (countEl) {
    countEl.textContent = query
      ? `Showing ${filtered.length} of ${suaCatalog.length}`
      : `${suaCatalog.length} areas`;
  }

  if (!filtered.length) {
    const opt = document.createElement("option");
    opt.textContent = "No matches found.";
    opt.disabled = true;
    opt.selected = true;
    list.appendChild(opt);
    selectedSuaId = "";
    updateSuaActionButtons();
    return;
  }

  const ids = filtered.map((area) => area.id);
  if (!selectedSuaId || !ids.includes(selectedSuaId)) {
    selectedSuaId = ids[0] || "";
  }

  filtered.forEach((area) => {
    const id = area.id;
    const name = area.name;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = name;
    if (id === selectedSuaId) opt.selected = true;
    list.appendChild(opt);
  });

  updateSuaActionButtons();
}

function updateSuaActionButtons() {
  const remainBtn = document.getElementById("suaSetRemain");
  const keepBtn = document.getElementById("suaAddKeepOut");
  if (!remainBtn || !keepBtn) return;

  if (!selectedSuaId) {
    remainBtn.disabled = true;
    keepBtn.disabled = true;
    remainBtn.textContent = "Set as Remain-in boundary";
    keepBtn.textContent = "Add to Keep-out boundaries";
    return;
  }

  const remainSelected = remainInFromSua === selectedSuaId;
  const keepSelected = keepOutFromSua.has(selectedSuaId);
  const keepDisabled = !keepSelected && keepOutPolygons.length >= MAX_KEEP_OUT;

  remainBtn.disabled = false;
  keepBtn.disabled = keepDisabled;
  remainBtn.textContent = remainSelected ? "Clear Remain-in boundary" : "Set as Remain-in boundary";
  keepBtn.textContent = keepSelected ? "Remove from Keep-out" : "Add to Keep-out boundaries";
}

function applyRemainSelection(areaId, checked) {
  const area = suaById.get(areaId);
  if (checked && area) {
    const parsed = parseAreaGeometry(area);
    const ring = parsed?.rings?.[0]?.polygon || [];
    if (ring.length >= 3) {
      remainInFromSua = areaId;
      remainInPolygon = ring;
    }
  } else if (remainInFromSua === areaId) {
    remainInFromSua = null;
    remainInPolygon = [];
  }

  renderSavedPolygons();
  updateCounters();
  updateSelectedAreas();
  updateSuaActionButtons();
  setRemainButtonsState();
}

function applyKeepSelection(areaId, checked) {
  if (checked) {
    if (keepOutFromSua.has(areaId)) return;
    if (keepOutPolygons.length >= MAX_KEEP_OUT) {
      alert(`Only ${MAX_KEEP_OUT} keep-out areas are allowed.`);
      return;
    }
    const area = suaById.get(areaId);
    const parsed = parseAreaGeometry(area);
    const ring = parsed?.rings?.[0]?.polygon || [];
    if (ring.length >= 3) {
      keepOutFromSua.set(areaId, ring);
      keepOutPolygons.push(ring);
    }
  } else {
    const ring = keepOutFromSua.get(areaId);
    if (ring) {
      keepOutPolygons = keepOutPolygons.filter((p) => p !== ring);
      keepOutFromSua.delete(areaId);
    }
  }

  renderSavedPolygons();
  updateCounters();
  updateSelectedAreas();
  updateSuaActionButtons();
}

function wireEvents() {
  const createAdd = document.getElementById("createPolyAdd");
  const createRemain = document.getElementById("createSetRemain");
  const createKeep = document.getElementById("createAddKeepOut");

  if (createAdd) createAdd.addEventListener("click", () => {
    addPoint(createPolyDraft, "createPolyPoints");
  });

  if (createRemain) createRemain.addEventListener("click", () => {
    if (remainInPolygon.length) {
      alert("Only one remain-in polygon is allowed.");
      return;
    }
    if (remainInFromSua) {
      alert("A pre-defined remain-in area is already selected.");
      return;
    }
    if (!validatePoints(createPolyDraft, "createPolyPoints")) return;
    const poly = pointsToPolygon(createPolyDraft);
    if (poly.length < 3) {
      alert("Remain-in polygon requires at least 3 points.");
      return;
    }
    const area = Math.abs(polygonArea(poly));
    if (area === 0) {
      alert("Remain-in polygon is invalid. Points must form a closed shape.");
      return;
    }
    closePolygon(poly);
    remainInPolygon = poly;
    createPolyDraft.length = 0;
    renderPointList("createPolyPoints", createPolyDraft);
    renderSavedPolygons();
    updateCounters();
    setRemainButtonsState();
  });

  if (createKeep) createKeep.addEventListener("click", () => {
    if (keepOutPolygons.length >= MAX_KEEP_OUT) {
      alert(`Only ${MAX_KEEP_OUT} keep-out areas are allowed.`);
      return;
    }
    if (!validatePoints(createPolyDraft, "createPolyPoints")) return;
    const poly = pointsToPolygon(createPolyDraft);
    if (poly.length < 3) {
      alert("Keep-out polygon requires at least 3 points.");
      return;
    }
    const area = Math.abs(polygonArea(poly));
    if (area === 0) {
      alert("Keep-out polygon is invalid. Points must form a closed shape.");
      return;
    }
    closePolygon(poly);
    keepOutPolygons.push(poly);
    createPolyDraft.length = 0;
    renderPointList("createPolyPoints", createPolyDraft);
    renderSavedPolygons();
    updateCounters();
  });

  bindPointInputs("createPolyPoints", createPolyDraft);

  ["tt_days", "tt_hours", "tt_minutes", "tt_seconds"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      updateTimedTotal();
      updateCounters();
    });
  });

  const timedToggle = document.getElementById("timedEnabled");
  if (timedToggle) {
    timedToggle.addEventListener("change", () => {
      setTimedEnabled(timedToggle.checked);
      updateCounters();
    });
  }

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
  if (!missionId) {
    showSaveFlag("Mission ID required", true);
    return;
  }
  const ttTotalSec = getTimedTotalSeconds();
  const timeKillMin = Math.round(ttTotalSec / 60);
  const triggerCount = calculateTriggerCount(ttTotalSec);
  const satcomId = (lastStatus?.globalstarId || "").toString();
  const missionRecord = {
    id: missionId,
    name: missionId,
    description: `Timer(min): ${timeKillMin} | Keep-out: ${keepOutPolygons.length} | Remain-in: ${remainInPolygon.length ? 1 : 0} | Lines: ${collectLines(4).length}`,
  };

  Promise.all([
    apiSaveGeofence(currentGeofenceDoc),
    (async () => {
      const cfg = await apiGetConfig().catch(() => ({}));
      cfg.missionId = missionId;
      cfg.satcom_id = satcomId;
      cfg.time_kill_min = timeKillMin;
      cfg.triggerCount = triggerCount;
      return apiSaveConfig(cfg);
    })(),
    apiSaveMission(missionRecord),
  ])
    .then(() => {
      updateCounters();
      showSaveFlag("Changes Saved");
    })
    .catch(() => showSaveFlag("Save failed", true));
}

function calculateTriggerCount(ttTotalSec) {
  const timerTrigger = ttTotalSec > 60 ? 1 : 0;
  const keepOutCount = keepOutPolygons.length;
  const remainInCount = remainInPolygon.length ? 1 : 0;
  const lineCount = collectLines(4).length;
  return timerTrigger + keepOutCount + remainInCount + lineCount;
}

document.addEventListener("DOMContentLoaded", () => {
  renderPointList("createPolyPoints", createPolyDraft);

  wireEvents();
  updateTimedTotal();
  updateCounters();
  const timedToggle = document.getElementById("timedEnabled");
  if (timedToggle) {
    timedToggle.checked = false;
    setTimedEnabled(false);
  }
  loadStatus();
  loadConfig();
  loadGeofence();
  loadSuaCatalog();

  setInterval(loadStatus, 2000);

  const saveBtn = document.getElementById("saveActiveMission");
  if (saveBtn) saveBtn.addEventListener("click", onSaveClick);
  updateSelectedAreas();

  const search = document.getElementById("suaSearch");
  if (search) search.addEventListener("input", renderSuaList);

  const select = document.getElementById("suaSelect");
  if (select) {
    select.addEventListener("change", () => {
      selectedSuaId = select.value || "";
      updateSuaActionButtons();
    });
  }

  const remainBtn = document.getElementById("suaSetRemain");
  if (remainBtn) {
    remainBtn.addEventListener("click", () => {
      if (!selectedSuaId) return;
      const shouldSet = remainInFromSua !== selectedSuaId;
      applyRemainSelection(selectedSuaId, shouldSet);
      renderSuaList();
      updateSelectedAreas();
    });
  }

  const keepBtn = document.getElementById("suaAddKeepOut");
  if (keepBtn) {
    keepBtn.addEventListener("click", () => {
      if (!selectedSuaId) return;
      const shouldSet = !keepOutFromSua.has(selectedSuaId);
      applyKeepSelection(selectedSuaId, shouldSet);
      renderSuaList();
      updateSelectedAreas();
    });
  }
});

function updateSelectedAreas() {
  const selectedKeep = Array.from(keepOutFromSua.keys())
    .map((id) => suaNameById.get(id) || id)
    .filter((name) => name && name.trim().length > 0);
  const selectedRemain = remainInFromSua
    ? [suaNameById.get(remainInFromSua) || remainInFromSua]
    : [];
  const remainOut = document.getElementById("selectedRemainIn");
  if (remainOut) {
    remainOut.textContent = selectedRemain.length ? selectedRemain[0] : "None selected.";
  }
  const keepOut = document.getElementById("selectedKeepOut");
  if (keepOut) {
    keepOut.textContent = selectedKeep.length ? selectedKeep.join(", ") : "None selected.";
  }
  setRemainPredefinedState(selectedRemain.length > 0);
}

function setRemainPredefinedState(hasSelection) {
  const remainBtn = document.getElementById("createSetRemain");
  if (remainBtn) remainBtn.disabled = hasSelection;
  const remainSaved = document.getElementById("remainInSaved");
  if (remainSaved && hasSelection) {
    remainSaved.innerHTML = '<div class="muted">Pre-defined area already selected</div>';
  }
}

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
  const remainAdd = document.getElementById("createPolyAdd");
  const remainSave = document.getElementById("createSetRemain");
  const locked = remainInPolygon.length > 0;
  if (remainAdd) remainAdd.disabled = locked;
  if (remainSave) remainSave.disabled = locked;
}

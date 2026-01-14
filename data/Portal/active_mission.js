function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function markError(el, on) {
  if (!el) return;
  el.classList.toggle("field-error", !!on);
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

function setText(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = v ?? "--";
}

function validateGeofenceRows() {
  const errors = [];

  for (let i = 1; i <= 10; i++) {
    const lat = document.getElementById(`gf_lat_${i}`);
    const lon = document.getElementById(`gf_lon_${i}`);

    const latEmpty = isEmpty(lat?.value);
    const lonEmpty = isEmpty(lon?.value);

    const partial = (latEmpty && !lonEmpty) || (!latEmpty && lonEmpty);

    markError(lat, partial);
    markError(lon, partial);

    if (partial) errors.push(i);
  }

  return errors;
}

function collectGeofence() {
  const pts = [];
  for (let i = 1; i <= 10; i++) {
    const lat = document.getElementById(`gf_lat_${i}`)?.value?.trim();
    const lon = document.getElementById(`gf_lon_${i}`)?.value?.trim();

    if (isEmpty(lat) && isEmpty(lon)) continue; // unused row
    pts.push({ lat: Number(lat), lon: Number(lon) });
  }
  return pts;
}

let currentGeofenceDoc = {
  keep_out: [],
  stay_in: [],
  lines: [],
};

function fillGeofenceInputs(poly) {
  for (let i = 1; i <= 10; i++) {
    const latEl = document.getElementById(`gf_lat_${i}`);
    const lonEl = document.getElementById(`gf_lon_${i}`);
    const pt = poly?.[i - 1];
    if (!latEl || !lonEl) continue;
    if (pt && pt.length >= 2) {
      latEl.value = pt[0];
      lonEl.value = pt[1];
    } else {
      latEl.value = "";
      lonEl.value = "";
    }
  }
}

async function loadStatus() {
  try {
    const status = await apiGetStatus();
    setText("currentCallsign", status?.callsign || "--");
    if (status?.gpsFix) {
      setText("currentLat", Number(status?.lat).toFixed(6));
      setText("currentLon", Number(status?.lon).toFixed(6));
    } else {
      setText("currentLat", "--");
      setText("currentLon", "--");
    }
  } catch (e) {
    setText("currentCallsign", "--");
    setText("currentLat", "--");
    setText("currentLon", "--");
  }
}

async function loadGeofence() {
  try {
    const doc = await apiGetGeofence();
    currentGeofenceDoc = doc || currentGeofenceDoc;
    const stayIn = currentGeofenceDoc?.stay_in?.[0]?.polygon || [];
    fillGeofenceInputs(stayIn);
  } catch (e) {
    currentGeofenceDoc = { keep_out: [], stay_in: [], lines: [] };
    fillGeofenceInputs([]);
  }
}

function wireValidation() {
  // Validate live on any change in those fields
  for (let i = 1; i <= 10; i++) {
    const lat = document.getElementById(`gf_lat_${i}`);
    const lon = document.getElementById(`gf_lon_${i}`);

    [lat, lon].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", validateGeofenceRows);
      el.addEventListener("blur", validateGeofenceRows);
    });
  }
}

function onSaveClick() {
  const badRows = validateGeofenceRows();

  if (badRows.length > 0) {
    alert(`Geofencing incomplete on row(s): ${badRows.join(", ")}\n\nEach row must have BOTH Latitude and Longitude.`);
    return;
  }

  const geofencePts = collectGeofence();
  const stayInRule = geofencePts.length
    ? [{ id: "Active", polygon: geofencePts.map((p) => [p.lat, p.lon]) }]
    : [];

  currentGeofenceDoc = {
    keep_out: currentGeofenceDoc.keep_out || [],
    stay_in: stayInRule,
    lines: currentGeofenceDoc.lines || [],
  };

  apiSaveGeofence(currentGeofenceDoc)
    .then(() => alert("Geofence saved."))
    .catch(() => alert("Geofence save failed."));
}

document.addEventListener("DOMContentLoaded", () => {
  wireValidation();
  loadStatus();
  loadGeofence();

  const saveBtn = document.getElementById("saveActiveMission");
  if (saveBtn) saveBtn.addEventListener("click", onSaveClick);
});

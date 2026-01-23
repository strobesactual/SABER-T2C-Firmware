function $(id) {
  return document.getElementById(id);
}

function requireTestPassword() {
  const key = "testing-auth";
  if (sessionStorage.getItem(key) === "ok") return true;
  const pass = window.prompt("Enter password to access Testing");
  if (pass === "austin") {
    sessionStorage.setItem(key, "ok");
    return true;
  }
  window.location.href = "./configuration.html";
  return false;
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = value ?? "";
  } else {
    el.textContent = value ?? "";
  }
}

async function fetchStatus() {
  const r = await fetch("/api/status", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/status failed: ${r.status}`);
  return await r.json();
}

async function fetchTestFlags() {
  const r = await fetch("/api/test", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/test failed: ${r.status}`);
  return await r.json();
}

async function saveTestFlags(obj) {
  const r = await fetch("/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  if (!r.ok) throw new Error(`POST /api/test failed: ${r.status}`);
  return await r.json();
}

function updateGpsMode(status) {
  const flightRaw = (status?.flightState || "").toString().trim().toUpperCase();
  const flightText = (flightRaw === "FLT" || flightRaw === "FLIGHT") ? "FLIGHT" : "GROUND";
  setText("gpsFlight", flightText);
}

function updateOledMirror(status) {
  const callsign = (status?.callsign || "").toString() || "NONE";
  const balloon = (status?.balloonType || "").toString();
  const flight = (status?.flightState || "").toString();
  const hold = (status?.holdState || "").toString();
  const satcom = (status?.satcomState || "").toString();
  const lora = (status?.lora || "").toString();
  const battery = Number(status?.battery);
  const geoCount = Number(status?.geoCount);
  const geoOk = status?.geoOk;
  const gpsFix = !!status?.gpsFix;
  const sats = Number(status?.sats);

  setText("oledCallsign", callsign || "--");
  setText("oledBalloon", balloon || "");
  setText("oledFlight", flight || "");
  setText("oledHold", hold || "");
  setText("oledSatcom", satcom || "");
  setText("oledLora", lora || "");

  const gpsText = `${gpsFix ? "Good" : "No Fix"} ${Number.isFinite(sats) ? sats : 0}`;
  setText("oledGps", gpsText);

  const batText = Number.isFinite(battery) && battery >= 0 ? `${battery}%` : "--";
  setText("oledBattery", batText);

  const geoCountText = Number.isFinite(geoCount) ? geoCount : 0;
  const geoText = `${geoCountText} ${geoOk ? "+" : "-"}`;
  setText("oledGeo", geoText);
}

async function refresh() {
  try {
    const [status, testFlags] = await Promise.all([
      fetchStatus(),
      fetchTestFlags(),
    ]);
    updateGpsMode(status);
    updateOledMirror(status);
    const geoToggle = $("geofenceViolation");
    if (geoToggle) {
      geoToggle.checked = !!testFlags?.force_geofence;
    }
    const flightToggle = $("flightModeEnabled");
    if (flightToggle) {
      flightToggle.checked = !!testFlags?.flight_mode;
    }
  } catch (e) {
    setText("gpsFlight", "--");
    setText("oledCallsign", "--");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireTestPassword()) return;
  const geoToggle = $("geofenceViolation");
  const flightToggle = $("flightModeEnabled");

  async function pushTestFlags() {
    const forceGeofence = !!geoToggle?.checked;
    const flightMode = !!flightToggle?.checked;
    try {
      await saveTestFlags({
        force_geofence: forceGeofence,
        flight_mode: flightMode,
      });
    } catch (e) {
      if (geoToggle) geoToggle.checked = !forceGeofence;
      if (flightToggle) flightToggle.checked = !flightMode;
    }
  }

  if (geoToggle) {
    geoToggle.addEventListener("change", pushTestFlags);
  }
  if (flightToggle) {
    flightToggle.addEventListener("change", pushTestFlags);
  }
  refresh();
  setInterval(refresh, 2000);
});

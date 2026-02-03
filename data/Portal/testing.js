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
  window.location.href = "./active_mission.html";
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

async function fetchConfig() {
  const r = await fetch("/api/config", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/config failed: ${r.status}`);
  return await r.json();
}

function normalizeFlightMode(status) {
  const raw = (status?.flightState || "").toString().trim().toUpperCase();
  if (raw === "FLIGHT" || raw === "FLT") return "FLIGHT";
  return "GROUND";
}

function shouldContinuePolling(status, testFlags) {
  if (Date.now() < forcePollUntil) return true;
  const flightMode = normalizeFlightMode(status);
  const testMode = !!testFlags?.test_mode;
  return flightMode !== "FLIGHT" || testMode;
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

async function saveConfig(payload) {
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`POST /api/config failed: ${r.status}`);
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
  const lora = "Disabled";
  const battery = Number(status?.battery);
  const geoCount = Number(status?.geoCount);
  const geoOk = status?.geoOk;
  const sats = Number(status?.sats);
  const gpsFix = !!status?.gpsFix;
  const gpsGood = gpsFix && Number.isFinite(sats) && sats >= 4;
  const gpsFair = gpsFix && (!Number.isFinite(sats) || sats < 4);

  setText("oledCallsign", callsign || "--");
  setText("oledBalloon", balloon || "");
  setText("oledFlight", flight || "");
  setText("oledHold", hold || "");
  setText("oledSatcom", satcom || "");
  setText("oledLora", lora || "");

  const gpsLabel = gpsGood ? "Good" : (gpsFair ? "Fair" : "No Fix");
  const gpsText = `${gpsLabel} ${Number.isFinite(sats) ? sats : 0}`;
  setText("oledGps", gpsText);

  const batText = Number.isFinite(battery) && battery >= 0 ? `${battery}%` : "--";
  setText("oledBattery", batText);

  const geoCountText = Number.isFinite(geoCount) ? geoCount : 0;
  const geoText = `${geoCountText} ${geoOk ? "+" : "-"}`;
  setText("oledGeo", geoText);
}

function formatTimer(seconds) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (v) => String(v).padStart(2, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

function setReadyFlag(isReady) {
  const el = $("readyFlag");
  if (!el) return;
  if (isReady) {
    el.classList.remove("is-visible");
    return;
  }
  el.textContent = "Not ready for launch";
  el.classList.add("is-visible");
}

function updateReadyFlag(status, cfg) {
  const satCount = Number(status?.sats);
  const hasGps = !!status?.gpsFix && Number.isFinite(satCount) && satCount >= 4;
  const hasTermination = !!(cfg && (cfg.timed_enabled || cfg.contained_enabled || cfg.exclusion_enabled || cfg.crossing_enabled));
  setReadyFlag(hasGps && hasTermination);
}

let pollTimer = null;
let forcePollUntil = 0;

async function refresh() {
  let status = null;
  let testFlags = null;
  try {
    const [statusRes, testRes, cfg] = await Promise.all([
      fetchStatus(),
      fetchTestFlags(),
      fetchConfig(),
    ]);
    status = statusRes;
    testFlags = testRes;
    updateGpsMode(status);
    updateOledMirror(status);
    setText("flightTimer", formatTimer(status?.flight_timer_sec));
    updateReadyFlag(status, cfg);
    const geoToggle = $("geofenceViolation");
    if (geoToggle) {
      geoToggle.checked = !!testFlags?.force_geofence;
    }
    const flightToggle = $("flightModeEnabled");
    if (flightToggle) {
      flightToggle.checked = !!cfg?.launch_confirmed;
    }
    const testToggle = $("testModeEnabled");
    if (testToggle) {
      testToggle.checked = !!testFlags?.test_mode;
    }
  } catch (e) {
    setText("gpsFlight", "--");
    setText("oledCallsign", "--");
    setReadyFlag(false);
  }

  if (shouldContinuePolling(status, testFlags)) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(refresh, 2000);
  } else if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireTestPassword()) return;
  const geoToggle = $("geofenceViolation");
  const flightToggle = $("flightModeEnabled");
  const testToggle = $("testModeEnabled");
  const resetToggle = $("resetFlightMode");

  async function pushTestFlags() {
    const forceGeofence = !!geoToggle?.checked;
    const flightMode = !!flightToggle?.checked;
    const testMode = !!testToggle?.checked;
    try {
      await saveTestFlags({
        force_geofence: forceGeofence,
        flight_mode: flightMode,
        test_mode: testMode,
      });
      await saveConfig({ launch_confirmed: flightMode });
      if (!pollTimer) refresh();
    } catch (e) {
      if (geoToggle) geoToggle.checked = !forceGeofence;
      if (flightToggle) flightToggle.checked = !flightMode;
      if (testToggle) testToggle.checked = !testMode;
    }
  }

  if (geoToggle) {
    geoToggle.addEventListener("change", pushTestFlags);
  }
  if (flightToggle) {
    flightToggle.addEventListener("change", pushTestFlags);
  }
  if (testToggle) {
    testToggle.addEventListener("change", pushTestFlags);
  }
  if (resetToggle) {
    resetToggle.addEventListener("change", async () => {
      if (!resetToggle.checked) return;
      if (flightToggle) flightToggle.checked = false;
      try {
        await saveTestFlags({
          force_geofence: !!geoToggle?.checked,
          flight_mode: false,
          test_mode: !!testToggle?.checked,
          reset_ground: true,
        });
        await saveConfig({ launch_confirmed: false });
      } catch (e) {
        if (flightToggle) flightToggle.checked = true;
      } finally {
        resetToggle.checked = false;
        forcePollUntil = Date.now() + 15000;
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(refresh, 200);
      }
    });
  }
  refresh();
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(refresh, 2000);
});

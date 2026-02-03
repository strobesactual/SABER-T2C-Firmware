/* Map profile (pixel coords from top-left of CONUS_map.png)
 * LA:      (323, 887)   lat 34.0522 lon -118.2437
 * Seattle: (162, 180)   lat 47.6062 lon -122.3321
 * Chicago: (1527, 496)  lat 41.8781 lon -87.6298
 * NYC:     (2062, 556)  lat 40.7128 lon -74.0060
 * Miami:   (1820, 1263) lat 25.7617 lon -80.1918
 * Austin:  (1128, 1063) lat 30.2672 lon -97.7431
 */

const MAP_IMAGE_URLS = [
  "/assets/CONUS_map.jpg",
  "./assets/CONUS_map.jpg",
  "../assets/CONUS_map.jpg",
  "/CONUS_map.jpg",
];
const LAUNCH_ICON_URLS = [
  "/assets/NATO_Friendly_Air.png",
  "./assets/NATO_Friendly_Air.png",
  "../assets/NATO_Friendly_Air.png",
];
const GEOFENCE_URLS = ["/api/geofence", "/geofence.json", "../geofence.json", "./geofence.json"];

const TRANSFORM = {
  a: 39.32666855913076,
  b: 4971.910497641973,
  c: -49.40047812453783,
  d: 2558.2141514910113,
};

const COLORS = {
  keepOut: "#dc2626",
  stayIn: "#16a34a",
  line: "#dc2626",
  point: "#0f172a",
  label: "#111827",
};

const DRAW_VERTICES = true;
const DRAW_LABELS = true;
const LINE_WIDTH = 5;
const VERTEX_RADIUS = 4;
const LAUNCH_ICON_SIZE = 26;

let mapImage = null;
let launchIcon = null;
let lastLaunchKey = "";

function latLonToPx(lat, lon) {
  return {
    x: TRANSFORM.a * lon + TRANSFORM.b,
    y: TRANSFORM.c * lat + TRANSFORM.d,
  };
}

function inBounds(pt, width, height) {
  return pt.x >= 0 && pt.y >= 0 && pt.x <= width && pt.y <= height;
}

function clipLineToBounds(p1, p2, width, height) {
  const INSIDE = 0;
  const LEFT = 1;
  const RIGHT = 2;
  const BOTTOM = 4;
  const TOP = 8;

  function outCode(p) {
    let code = INSIDE;
    if (p.x < 0) code |= LEFT;
    else if (p.x > width) code |= RIGHT;
    if (p.y < 0) code |= TOP;
    else if (p.y > height) code |= BOTTOM;
    return code;
  }

  let x1 = p1.x;
  let y1 = p1.y;
  let x2 = p2.x;
  let y2 = p2.y;

  let code1 = outCode(p1);
  let code2 = outCode(p2);

  while (true) {
    if (!(code1 | code2)) {
      return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    }
    if (code1 & code2) {
      return null;
    }

    const out = code1 ? code1 : code2;
    let x = 0;
    let y = 0;

    if (out & TOP) {
      x = x1 + ((x2 - x1) * (0 - y1)) / (y2 - y1);
      y = 0;
    } else if (out & BOTTOM) {
      x = x1 + ((x2 - x1) * (height - y1)) / (y2 - y1);
      y = height;
    } else if (out & RIGHT) {
      y = y1 + ((y2 - y1) * (width - x1)) / (x2 - x1);
      x = width;
    } else if (out & LEFT) {
      y = y1 + ((y2 - y1) * (0 - x1)) / (x2 - x1);
      x = 0;
    }

    if (out === code1) {
      x1 = x;
      y1 = y;
      code1 = outCode({ x: x1, y: y1 });
    } else {
      x2 = x;
      y2 = y;
      code2 = outCode({ x: x2, y: y2 });
    }
  }
}

function drawPolygon(ctx, points, opts) {
  if (points.length < 3) return;
  const { width, height } = ctx.canvas;

  ctx.strokeStyle = opts.color;
  ctx.lineWidth = opts.lineWidth || LINE_WIDTH;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const clipped = clipLineToBounds(a, b, width, height);
    if (!clipped) continue;
    ctx.beginPath();
    ctx.moveTo(clipped[0].x, clipped[0].y);
    ctx.lineTo(clipped[1].x, clipped[1].y);
    ctx.stroke();
  }

  if (opts.drawVertices) {
    ctx.fillStyle = opts.vertexColor || opts.color;
    points.forEach((pt) => {
      if (!inBounds(pt, width, height)) return;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, VERTEX_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function drawLabel(ctx, points, label) {
  if (!label) return;
  const { width, height } = ctx.canvas;
  const inBoundsPoints = points.filter((pt) => inBounds(pt, width, height));
  if (!inBoundsPoints.length) return;

  const centroid = inBoundsPoints.reduce(
    (acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }),
    { x: 0, y: 0 }
  );
  centroid.x /= inBoundsPoints.length;
  centroid.y /= inBoundsPoints.length;

  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  ctx.fillStyle = COLORS.label;
  ctx.fillText(label, centroid.x + 6, centroid.y - 6);
}

function drawPoint(ctx, pt, color) {
  const { width, height } = ctx.canvas;
  if (!inBounds(pt, width, height)) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, VERTEX_RADIUS + 1, 0, Math.PI * 2);
  ctx.fill();
}

function drawLineSegment(ctx, p1, p2, color) {
  const { width, height } = ctx.canvas;
  const clipped = clipLineToBounds(p1, p2, width, height);
  if (!clipped) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(clipped[0].x, clipped[0].y);
  ctx.lineTo(clipped[1].x, clipped[1].y);
  ctx.stroke();
}

async function loadImage(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load ${url}`));
        image.src = url;
      });
      return img;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Image load failed");
}

async function loadGeofence() {
  let lastErr;
  for (const url of GEOFENCE_URLS) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastErr = new Error(`GET ${url} failed: ${res.status}`);
        continue;
      }
      return res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Fetch failed");
}

async function apiGetStatus() {
  const r = await fetch("/api/status", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/status failed: ${r.status}`);
  return await r.json();
}

async function apiGetConfig() {
  const r = await fetch("/api/config", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/config failed: ${r.status}`);
  return await r.json();
}

async function apiSaveConfig(payload) {
  const r = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!r.ok || (data && data.ok === false)) {
    const err = data?.error || `HTTP ${r.status}`;
    throw new Error(`POST /api/config failed: ${err}`);
  }
  return data || {};
}

async function apiSaveTest(payload) {
  const r = await fetch("/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`POST /api/test failed: ${r.status} ${text}`);
  }
  return await r.json();
}

async function apiGetTest() {
  const r = await fetch("/api/test", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/test failed: ${r.status}`);
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

function setReadyFlag(isReady) {
  const el = document.getElementById("readyFlag");
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

function toggleStateBox(id, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("box-state-good", !!ok);
  el.classList.toggle("box-state-bad", !ok);
}

function setStateBox(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("box-state-good", "box-state-warn", "box-state-bad");
  if (state === "good") el.classList.add("box-state-good");
  else if (state === "warn") el.classList.add("box-state-warn");
  else if (state === "bad") el.classList.add("box-state-bad");
}

function formatTimer(seconds) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (v) => String(v).padStart(2, "0");
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

function extractSatcomId(status) {
  if (!status) return "";
  const direct = status.globalstarId || status.satcomId || status.satId || "";
  if (direct) return String(direct).trim();

  const satcom = (status.satcom || status.satcomState || "").toString();
  const match = satcom.match(/(\\d{4,})/);
  return match ? match[1] : "";
}

function setMissionFields(status, cfg) {
  const satcomOk = !!cfg?.satcom_verified;
  const launchPosOk = !!status?.launch_set;
  const satCount = Number(status?.sats);
  const gpsOk = !!status?.gpsFix && Number.isFinite(satCount) && satCount >= 4;
  const containedEnabled = !!cfg?.contained_enabled;
  const containedOk = !containedEnabled || !!status?.contained_launch;
  const readyNow = satcomOk && launchPosOk && gpsOk && containedOk;
  const statusText = readyNow ? "READY" : "NOT READY";
  const batt = Number(status?.battery);
  const battText = Number.isFinite(batt) && batt >= 0 ? `${batt}%` : "--";
  const flightSeconds = Number(status?.flight_timer_sec);
  const flightText = formatTimer(flightSeconds);
  const timeKillMin = Number(status?.time_kill_min);
  const timeKillSec = Number.isFinite(timeKillMin) ? Math.max(0, Math.floor(timeKillMin * 60)) : 0;
  const flightSec = Number.isFinite(flightSeconds) ? Math.max(0, Math.floor(flightSeconds)) : 0;
  const remainingSec = Math.max(0, timeKillSec - flightSec);
  const remainingText = formatTimer(remainingSec);

  const statusEl = document.getElementById("missionStatus");
  const loraEl = document.getElementById("missionLora");
  const battEl = document.getElementById("missionBattery");
  const secEl = document.getElementById("missionTerminationSeconds");
  const flightEl = document.getElementById("missionFlightTimer");

  if (statusEl) {
    statusEl.textContent = statusText;
    toggleStateBox("missionStatus", readyNow);
  }
  if (loraEl) {
    loraEl.textContent = "DISABLED";
    loraEl.classList.remove("box-state-good", "box-state-warn", "box-state-bad");
    loraEl.classList.add("box-state-disabled");
  }
  if (battEl) battEl.textContent = battText;
  if (secEl) secEl.textContent = remainingText;
  if (flightEl) flightEl.textContent = flightText;

  const launchSet = !!status?.launch_set;
  const launchLat = Number(status?.launch_lat);
  const launchLon = Number(status?.launch_lon);
  const launchAlt = Number(status?.launch_alt_m);
  setText("launchLat", launchSet && Number.isFinite(launchLat) ? launchLat.toFixed(6) : "--");
  setText("launchLon", launchSet && Number.isFinite(launchLon) ? launchLon.toFixed(6) : "--");
  setText("launchAlt", launchSet && Number.isFinite(launchAlt) ? launchAlt.toFixed(1) : "--");
}

function updateTerminationToggles(cfg) {
  const satcom = document.getElementById("satcomMessages");
  if (satcom) satcom.checked = !!cfg?.satcom_verified;
  const launchConfirmed = document.getElementById("launchConfirmed");
  if (launchConfirmed) launchConfirmed.checked = !!cfg?.launch_confirmed;
}

function setPillVisible(id, show) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("is-visible", !!show);
}

function updateReadyPills(status, cfg) {
  const satcomOk = !!cfg?.satcom_verified;
  const launchPosOk = !!status?.launch_set;
  const containedEnabled = !!cfg?.contained_enabled;
  const containedOk = !!status?.contained_launch;
  const satCount = Number(status?.sats);
  const gpsOk = !!status?.gpsFix && Number.isFinite(satCount) && satCount >= 4;

  setPillVisible("pillSatcom", !satcomOk);
  setPillVisible("pillLaunchPos", !launchPosOk);
  setPillVisible("pillGpsFix", !gpsOk);
  setPillVisible("pillContained", containedEnabled && !containedOk);
}

function wireTerminationToggles() {
  const satcom = document.getElementById("satcomMessages");
  const launchConfirmed = document.getElementById("launchConfirmed");
  const reset = document.getElementById("resetFlightMode");
  const push = async () => {
    try {
      const payload = {
        satcom_verified: !!satcom?.checked,
        launch_confirmed: !!launchConfirmed?.checked,
      };
      await apiSaveConfig(payload);
      await apiSaveTest({
        flight_mode: !!launchConfirmed?.checked,
      });
    } catch {
      // keep UI as-is on failure
    }
  };
  if (satcom) satcom.addEventListener("change", push);
  if (launchConfirmed) launchConfirmed.addEventListener("change", push);
    if (reset) {
      reset.addEventListener("change", async () => {
        if (!reset.checked) return;
        try {
          await apiSaveConfig({ launch_confirmed: false });
          await apiSaveTest({ flight_mode: false, reset_ground: true });
          if (launchConfirmed) launchConfirmed.checked = false;
        } catch {
          // keep UI state
        } finally {
          reset.checked = false;
          forcePollUntil = Date.now() + 15000;
          if (pollTimer) clearTimeout(pollTimer);
          pollTimer = setTimeout(refreshStatus, 200);
        }
      });
  }
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

  const geoCountText2 = Number.isFinite(geoCount) ? geoCount : 0;
  const geoText = `${geoCountText2} ${geoOk ? "+" : "-"}`;
  setText("oledGeo", geoText);
}

function setGpsFields(status) {
  const satCount = Number(status?.sats);
  const hasRawFix = !!status?.gpsFix;
  const hasGoodFix = hasRawFix && Number.isFinite(satCount) && satCount >= 4;
  const hasFairFix = hasRawFix && (!Number.isFinite(satCount) || satCount < 4);
  const satcomId = extractSatcomId(status);
  const satcomState = satcomId ? "GOOD" : "INIT";
  const flightRaw = (status?.flightState || "").toString().trim().toUpperCase();
  const flightText = (flightRaw === "FLT" || flightRaw === "FLIGHT") ? "FLIGHT" : "GROUND";

  const fixText = hasGoodFix ? "GOOD" : (hasFairFix ? "FAIR" : "NO FIX");
  setText("gpsFixText", fixText);
  setText("gpsSats", Number.isFinite(satCount) ? satCount : "");
  setText("satcomState", satcomState);
  setText("globalstarId", satcomId);
  setText("gpsFlight", flightText);

  const satcomOk = satcomState === "GOOD";
  const fixState = hasGoodFix ? "good" : (hasFairFix ? "warn" : "bad");
  setStateBox("gpsFixText", fixState);
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

function syncCanvasCssSize(canvas, img) {
  const parentWidth = canvas.parentElement?.clientWidth || img.width;
  if (!parentWidth) return;
  canvas.style.width = "100%";
  const ratio = img.height / img.width;
  canvas.style.height = `${Math.round(parentWidth * ratio)}px`;
}

async function ensureMapAssets() {
  if (!mapImage) mapImage = await loadImage(MAP_IMAGE_URLS);
  if (!launchIcon) launchIcon = await loadImage(LAUNCH_ICON_URLS);
}

function drawLaunchIcon(ctx, pt) {
  if (!launchIcon) return;
  const { width, height } = ctx.canvas;
  if (!inBounds(pt, width, height)) return;
  const size = LAUNCH_ICON_SIZE;
  ctx.drawImage(launchIcon, pt.x - size / 2, pt.y - size / 2, size, size);
}

async function renderMap(launchPoint) {
  const canvas = document.getElementById("mapCanvas");
  if (!canvas) return;

  await ensureMapAssets();
  const img = mapImage;

  canvas.width = img.width;
  canvas.height = img.height;
  syncCanvasCssSize(canvas, img);

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let geofence;
  try {
    geofence = await loadGeofence();
  } catch (err) {
    console.error(err);
    return;
  }

  const keepOut = (geofence.keep_out || []).map((rule) => ({
    label: rule.label || rule.id || "",
    points: (rule.polygon || [])
      .map((pair) => {
        const lat = Number(pair?.[0]);
        const lon = Number(pair?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return latLonToPx(lat, lon);
      })
      .filter(Boolean),
  }));
  const stayIn = (geofence.stay_in || []).map((rule) => ({
    label: rule.label || rule.id || "",
    points: (rule.polygon || [])
      .map((pair) => {
        const lat = Number(pair?.[0]);
        const lon = Number(pair?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return latLonToPx(lat, lon);
      })
      .filter(Boolean),
  }));
  const lines = (geofence.lines || [])
    .map((line) => {
      const axis = (line?.axis || "N/S").toUpperCase() === "E/W" ? "E/W" : "N/S";
      const value = Number(line?.value);
      if (!Number.isFinite(value)) return null;
      return {
        label: line.label || line.id || "",
        axis,
        value,
      };
    })
    .filter(Boolean);
  keepOut.forEach((poly) => {
    if (poly.points.length < 3) return;
    drawPolygon(ctx, poly.points, {
      color: COLORS.keepOut,
      drawVertices: DRAW_VERTICES,
      vertexColor: COLORS.keepOut,
    });
    if (DRAW_LABELS) drawLabel(ctx, poly.points, poly.label);
  });

  stayIn.forEach((poly) => {
    if (poly.points.length < 3) return;
    drawPolygon(ctx, poly.points, {
      color: COLORS.stayIn,
      drawVertices: DRAW_VERTICES,
      vertexColor: COLORS.stayIn,
    });
    if (DRAW_LABELS) drawLabel(ctx, poly.points, poly.label);
  });

  lines.forEach((line) => {
    if (line.axis === "N/S") {
      const x = TRANSFORM.a * line.value + TRANSFORM.b;
      const p1 = { x, y: 0 };
      const p2 = { x, y: ctx.canvas.height };
      drawLineSegment(ctx, p1, p2, COLORS.line);
      if (DRAW_LABELS && line.label) drawLabel(ctx, [p1, p2], line.label);
    } else {
      const y = TRANSFORM.c * line.value + TRANSFORM.d;
      const p1 = { x: 0, y };
      const p2 = { x: ctx.canvas.width, y };
      drawLineSegment(ctx, p1, p2, COLORS.line);
      if (DRAW_LABELS && line.label) drawLabel(ctx, [p1, p2], line.label);
    }
  });

  if (launchPoint) {
    const pt = latLonToPx(launchPoint.lat, launchPoint.lon);
    drawLaunchIcon(ctx, pt);
  }
}

window.addEventListener("resize", () => {
  const canvas = document.getElementById("mapCanvas");
  if (!canvas) return;
  const sync = (img) => syncCanvasCssSize(canvas, img);
  if (mapImage) {
    sync(mapImage);
  } else {
    loadImage(MAP_IMAGE_URLS)
      .then((img) => {
        mapImage = img;
        sync(img);
      })
      .catch(() => {});
  }
});

let pollTimer = null;
let forcePollUntil = 0;

async function refreshStatus() {
  let status = null;
  let cfg = null;
  let testFlags = null;
  try {
    [status, cfg, testFlags] = await Promise.all([apiGetStatus(), apiGetConfig(), apiGetTest()]);
    updateOledMirror(status);
    setGpsFields(status);
    setMissionFields(status, cfg);
    updateReadyFlag(status, cfg);
    updateTerminationToggles(cfg);
    updateReadyPills(status, cfg);
    const reset = document.getElementById("resetFlightMode");
    if (reset) reset.checked = false;

    if (status?.launch_set) {
      const lat = Number(status?.launch_lat);
      const lon = Number(status?.launch_lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const key = `${lat.toFixed(6)}:${lon.toFixed(6)}`;
        if (key !== lastLaunchKey) {
          lastLaunchKey = key;
          await renderMap({ lat, lon });
        }
      }
    }
  } catch (err) {
    setGpsFields({ gpsFix: false });
    setReadyFlag(false);
    updateOledMirror(null);
  }

  if (shouldContinuePolling(status, testFlags)) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(refreshStatus, 2000);
  } else if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

renderMap().catch((err) => {
  // Fail silently in UI; console is enough for debug.
  console.error(err);
});
refreshStatus();
wireTerminationToggles();

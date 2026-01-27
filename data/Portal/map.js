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
  const timeKillMin = Number(status?.time_kill_min);
  const timerTrigger = Number.isFinite(timeKillMin) && timeKillMin > 0 ? 1 : 0;
  const geoCountText = Number.isFinite(triggerCount)
    ? Math.max(triggerCount - timerTrigger, 0)
    : 0;
  const lora = (status?.lora || "").toString().trim();
  const batt = Number(status?.battery);
  const battText = Number.isFinite(batt) && batt >= 0 ? `${batt}%` : "--";
  const minutes = Number(status?.time_kill_min);
  const minutesText = Number.isFinite(minutes) ? String(minutes).padStart(4, "0") : "0000";
  const flightSeconds = Number(status?.flight_timer_sec);
  const flightMinutes = Number.isFinite(flightSeconds) ? Math.floor(flightSeconds / 60) : 0;
  const flightText = String(flightMinutes).padStart(4, "0");

  const statusEl = document.getElementById("missionStatus");
  const loraEl = document.getElementById("missionLora");
  const battEl = document.getElementById("missionBattery");
  const geoEl = document.getElementById("missionGeofenceCount");
  const secEl = document.getElementById("missionTerminationSeconds");
  const flightEl = document.getElementById("missionFlightTimer");

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
  if (flightEl) flightEl.textContent = flightText;

  const launchSet = !!status?.launch_set;
  const launchLat = Number(status?.launch_lat);
  const launchLon = Number(status?.launch_lon);
  const launchAlt = Number(status?.launch_alt_m);
  setText("launchLat", launchSet && Number.isFinite(launchLat) ? launchLat.toFixed(6) : "--");
  setText("launchLon", launchSet && Number.isFinite(launchLon) ? launchLon.toFixed(6) : "--");
  setText("launchAlt", launchSet && Number.isFinite(launchAlt) ? launchAlt.toFixed(1) : "--");
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

async function refreshStatus() {
  try {
    const [status, cfg] = await Promise.all([apiGetStatus(), apiGetConfig()]);
    setGpsFields(status);
    setMissionFields(status);
    updateReadyFlag(status, cfg);

    if (status?.launch_set) {
      const lat = Number(status?.launch_lat);
      const lon = Number(status?.launch_lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const key = `${lat.toFixed(6)}:${lon.toFixed(6)}`;
        if (key !== lastLaunchKey) {
          lastLaunchKey = key;
          await renderMap({ lat, lon });
          return;
        }
      }
    }
  } catch (err) {
    setGpsFields({ gpsFix: false });
    setReadyFlag(false);
  }
}

renderMap().catch((err) => {
  // Fail silently in UI; console is enough for debug.
  console.error(err);
});
refreshStatus();
setInterval(refreshStatus, 2000);

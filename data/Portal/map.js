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

function syncCanvasCssSize(canvas, img) {
  const parentWidth = canvas.parentElement?.clientWidth || img.width;
  if (!parentWidth) return;
  canvas.style.width = "100%";
  const ratio = img.height / img.width;
  canvas.style.height = `${Math.round(parentWidth * ratio)}px`;
}

async function renderMap() {
  const canvas = document.getElementById("mapCanvas");
  if (!canvas) return;

  const img = await loadImage(MAP_IMAGE_URLS);

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
}

window.addEventListener("resize", () => {
  const canvas = document.getElementById("mapCanvas");
  if (!canvas) return;
  loadImage(MAP_IMAGE_URLS)
    .then((img) => syncCanvasCssSize(canvas, img))
    .catch(() => {});
});

renderMap().catch((err) => {
  // Fail silently in UI; console is enough for debug.
  console.error(err);
});

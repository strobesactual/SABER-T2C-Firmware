function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value ?? "";
}

async function fetchStatus() {
  const r = await fetch("/api/status", { cache: "no-store" });
  if (!r.ok) throw new Error(`GET /api/status failed: ${r.status}`);
  return await r.json();
}

function updateGpsMode(status) {
  const flightRaw = (status?.flightState || "").toString().trim().toUpperCase();
  const flightText = (flightRaw === "FLT" || flightRaw === "FLIGHT") ? "FLIGHT" : "GROUND";
  setText("gpsFlight", flightText);
}

async function refresh() {
  try {
    const status = await fetchStatus();
    updateGpsMode(status);
  } catch (e) {
    setText("gpsFlight", "--");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  refresh();
  setInterval(refresh, 2000);
});

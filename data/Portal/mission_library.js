async function fetchMissions() {
  try {
    const r = await fetch("/api/missions");
    if (!r.ok) throw new Error("no api");
    return await r.json();
  } catch {
    try {
      const r = await fetch("../mission_library.json", { cache: "no-store" });
      if (!r.ok) throw new Error("no api");
      const data = await r.json();
      return data?.missions || [];
    } catch {
      return [];
    }
  }
}

async function fetchConfig() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (!r.ok) throw new Error("no api");
    return await r.json();
  } catch {
    return {};
  }
}

async function fetchGeofence() {
  try {
    const r = await fetch("/api/geofence", { cache: "no-store" });
    if (!r.ok) throw new Error("no api");
    return await r.json();
  } catch {
    return null;
  }
}

async function saveMission(mission) {
  const r = await fetch("/api/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mission),
  });
  if (!r.ok) throw new Error("save failed");
}

function render(missions, activeId) {
  const wrap = document.getElementById("missions");

  const rows = missions.map(m => `
    <div style="display:flex; gap:10px; align-items:center; padding:10px 0; border-bottom:1px solid var(--line);">
      <button class="btn btn-green" style="visibility:${String(m.id) === String(activeId) ? "visible" : "hidden"};">Active</button>
      <button class="btn btn-blue" data-load="${m.id}">Load</button>

      <div style="flex:1;">
        <div style="font-weight:700;">${escapeHtml(m.name)}</div>
        <div class="muted" style="font-size:13px;">${escapeHtml(m.description || "")}</div>
        <div class="muted" style="font-size:13px; margin-top:4px;">
          ID: ${escapeHtml(m.id || "--")} &nbsp;|&nbsp;
          Callsign: ${escapeHtml(m.callsign || "--")} &nbsp;|&nbsp;
          Balloon: ${escapeHtml(m.balloonType || "--")}
        </div>
      </div>
    </div>
  `).join("");

  wrap.innerHTML = `<div>${rows || "<div class='muted'>No missions yet.</div>"}</div>`;

  wrap.querySelectorAll("button[data-load]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-load");
      const mission = missions.find(x => String(x.id) === String(id));
      localStorage.setItem("saber_active_mission_prefill", JSON.stringify(mission));
      window.location.href = "./active_mission.html";
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

async function refreshMissionLibrary() {
  let [missions, cfg, geofence] = await Promise.all([fetchMissions(), fetchConfig(), fetchGeofence()]);
  const activeId = cfg?.missionId || "";
  if (!missions.length) {
    const seedId = activeId || "ACTIVE";
    const seedMission = {
      id: seedId,
      name: seedId,
      description: "Active mission snapshot",
      timed_enabled: !!cfg?.timed_enabled,
      contained_enabled: !!cfg?.contained_enabled,
      exclusion_enabled: !!cfg?.exclusion_enabled,
      crossing_enabled: !!cfg?.crossing_enabled,
      callsign: cfg?.callsign || "",
      balloonType: cfg?.balloonType || "",
      time_kill_min: Number(cfg?.time_kill_min) || 0,
      autoErase: !!cfg?.autoErase,
      satcom_id: cfg?.satcom_id || "",
      satcom_verified: !!cfg?.satcom_verified,
      launch_confirmed: !!cfg?.launch_confirmed,
    };
    if (geofence) seedMission.geofence = geofence;
    try {
      await saveMission(seedMission);
      missions = await fetchMissions();
    } catch {
      // continue with empty list
    }
  }
  render(missions, activeId);
}

window.refreshMissionLibrary = refreshMissionLibrary;

refreshMissionLibrary().catch(() => {
  render([], "");
});

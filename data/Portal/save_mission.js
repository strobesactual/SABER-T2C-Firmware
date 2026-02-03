function portalSaveFlag(msg, isError) {
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

function portalReadValue(id) {
  const el = document.getElementById(id);
  if (!el) return "";
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return (el.value ?? "").toString().trim();
  }
  return (el.textContent ?? "").toString().trim();
}

function portalReadChecked(id) {
  const el = document.getElementById(id);
  return !!(el && el.checked);
}

function portalGetTimeKillMin() {
  const days = Number(portalReadValue("tt_days") || 0);
  const hours = Number(portalReadValue("tt_hours") || 0);
  const minutes = Number(portalReadValue("tt_minutes") || 0);
  const seconds = Number(portalReadValue("tt_seconds") || 0);
  const totalSeconds = (Number.isFinite(days) ? days : 0) * 86400
    + (Number.isFinite(hours) ? hours : 0) * 3600
    + (Number.isFinite(minutes) ? minutes : 0) * 60
    + (Number.isFinite(seconds) ? seconds : 0);
  return Math.max(0, Math.round(totalSeconds / 60));
}

async function portalPostJson(url, payload) {
  const r = await fetch(url, {
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
    throw new Error(`${url} failed: ${err}`);
  }
  return data || {};
}

async function portalSaveActiveMission() {
  const saveBtn = document.getElementById("saveActiveMission");
  if (saveBtn) saveBtn.disabled = true;

  try {
    const missionId = portalReadValue("missionId");
    if (!missionId) {
      alert("Mission ID required.");
      portalSaveFlag("Mission ID required", true);
      return;
    }

    portalSaveFlag("Saving...");

    const cfg = {
      missionId,
      callsign: portalReadValue("callsign").slice(0, 6),
      balloonType: portalReadValue("balloonType"),
      note: portalReadValue("note"),
      autoErase: portalReadChecked("autoErase"),
      satcom_verified: portalReadChecked("satcomMessages"),
      launch_confirmed: portalReadChecked("launchConfirmed"),
      time_kill_min: portalGetTimeKillMin(),
      timed_enabled: portalReadChecked("timedEnabled"),
      contained_enabled: portalReadChecked("containedEnabled"),
      exclusion_enabled: portalReadChecked("exclusionEnabled"),
      crossing_enabled: portalReadChecked("crossingEnabled"),
    };

    let geofenceDoc = { keep_out: [], stay_in: [], lines: [] };
    if (typeof window.buildGeofenceDoc === "function") {
      try {
        geofenceDoc = window.buildGeofenceDoc() || geofenceDoc;
      } catch {
        geofenceDoc = { keep_out: [], stay_in: [], lines: [] };
      }
    }

    let descKeepOut = 0;
    let descRemain = 0;
    let descLines = 0;
    if (typeof window.keepOutPolygons !== "undefined" && Array.isArray(window.keepOutPolygons)) {
      descKeepOut = window.keepOutPolygons.length;
    }
    if (typeof window.remainInPolygon !== "undefined" && Array.isArray(window.remainInPolygon)) {
      descRemain = window.remainInPolygon.length ? 1 : 0;
    }
    if (typeof window.collectLines === "function") {
      try {
        descLines = (window.collectLines(4) || []).length;
      } catch {
        descLines = 0;
      }
    }

    const missionRecord = {
      id: missionId,
      name: missionId,
      description: `Timer(min): ${cfg.time_kill_min || 0} | Exclusion: ${descKeepOut} | Contained: ${descRemain} | Lines: ${descLines}`,
      timed_enabled: !!cfg.timed_enabled,
      contained_enabled: !!cfg.contained_enabled,
      exclusion_enabled: !!cfg.exclusion_enabled,
      crossing_enabled: !!cfg.crossing_enabled,
      callsign: cfg.callsign || "",
      balloonType: cfg.balloonType || "",
      note: cfg.note || "",
      time_kill_min: cfg.time_kill_min || 0,
      autoErase: !!cfg.autoErase,
      satcom_id: cfg.satcom_id || "",
      satcom_verified: !!cfg.satcom_verified,
      launch_confirmed: !!cfg.launch_confirmed,
      geofence: geofenceDoc,
    };

    await portalPostJson("/api/config", cfg);
    await portalPostJson("/api/geofence", geofenceDoc);
    await portalPostJson("/api/missions", missionRecord);
    if (typeof window.refreshMissionLibrary === "function") {
      try {
        await window.refreshMissionLibrary();
      } catch {}
    }
    portalSaveFlag("Changes Saved");
  } catch (err) {
    portalSaveFlag(err?.message || "Save failed", true);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

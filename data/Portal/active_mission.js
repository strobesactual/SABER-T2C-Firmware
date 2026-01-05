function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function markError(el, on) {
  if (!el) return;
  el.classList.toggle("field-error", !!on);
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

  // Stub payload (wire to backend later)
  const payload = {
    timedTermination: {
      days: Number(document.getElementById("tt_days")?.value || 0),
      hours: Number(document.getElementById("tt_hours")?.value || 0),
      minutes: Number(document.getElementById("tt_minutes")?.value || 0),
      seconds: Number(document.getElementById("tt_seconds")?.value || 0),
    },
    geofence: collectGeofence(),
  };

  console.log("ACTIVE MISSION SAVE (stub):", payload);
  alert("Saved (stub). Next step: persist to backend.");
}

document.addEventListener("DOMContentLoaded", () => {
  wireValidation();

  const saveBtn = document.getElementById("saveActiveMission");
  if (saveBtn) saveBtn.addEventListener("click", onSaveClick);
});
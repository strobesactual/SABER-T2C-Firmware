const els = {
  callsign: document.getElementById("callsign"),
  balloonType: document.getElementById("balloonType"),
  note: document.getElementById("note"),
  autoErase: document.getElementById("autoErase"),
  saveBtn: document.getElementById("saveBtn"),
};

function formatNumber(n) {
  if (n === null || n === undefined || n === "") return "";
  return Number(n).toLocaleString("en-US");
}

function readForm() {
  return {
    callsign: els.callsign.value.trim(),
    balloonType: els.balloonType.value,
    note: els.note.value.trim(),
    autoEraseAfterTermination: !!els.autoErase.checked,
  };
}

els.saveBtn.addEventListener("click", async () => {
  const payload = readForm();
  console.log("SAVE payload (stub):", payload);
  alert("Saved (stub). Next step: wire to ESP32 backend.");
});

const altMeters = document.getElementById("alt_m");
const altFeet   = document.getElementById("alt_ft");

/* Placeholder demo values — replace later with real variables */
const altitudeMetersValue = 10600;
const altitudeFeetValue   = 34777;

/* Display with thousands separators */
altMeters.value = formatNumber(altitudeMetersValue);
altFeet.value   = formatNumber(altitudeFeetValue);

const gpsTime = document.getElementById("gpsTime");
const gpsDate = document.getElementById("gpsDate");

/* Placeholder demo values */
gpsTime.value = "07:00 Z";
gpsDate.value = "02 Jan 2026";
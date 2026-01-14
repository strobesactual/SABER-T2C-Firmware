// src/main.cpp
#include <Arduino.h>
#include "board/Board_TBeamS3.h"
#include "ui/PortalServer.h"
#include "display/display.h"
#include "gps/GPSControl.h"
#include "satcom/SatCom.h"
#include "message/MessageCodec.h"
#include "sensors/BME280.h"
#include "sensors/PMU_AXP2101.h"
#include "geofence/GeoFence.h"
#include "termination/Termination.h"
#include "core/ConfigStore.h"
#include <Wire.h>
#include <math.h>

// ---------------- Boot / UI state ----------------
enum class Screen { BOOT, STATUS };
static Screen screen = Screen::BOOT;

static uint8_t  bootPct = 0;
static bool     bootDone = false;
static uint32_t bootStartMs = 0;
static uint32_t lastStatusDrawMs = 0;
static uint32_t lastSatSendMs = 0;
static bool satIdPrinted = false;
static uint32_t lastSatIdQueryMs = 0;
static uint32_t satId = 0;

static constexpr uint32_t MIN_BOOT_MS = 5000;
static constexpr uint32_t SAT_SEND_INTERVAL_MS = 120000;
static constexpr uint32_t STATUS_REFRESH_MS = 30000;

// Helper: only redraw when % changes
static void setBoot(uint8_t pct) {
  if (pct > 100) pct = 100;
  if (pct != bootPct) {
    bootPct = pct;
    display_update_boot(bootPct);
  }
}

void setup() {
  // NOTE: Keep Serial first so you can see early boot logs.
  Serial.begin(115200);
  delay(1500);

  // init the shared I2C bus used by OLED + BME
  Wire.begin(17, 18);
  Wire.setClock(400000);


  uint32_t t0 = millis();
  while (!Serial && (millis() - t0) < 3000) { delay(10); }  // wait for USB CDC
  delay(200);
  Serial.println("[BOOT] setup start (serial ready)");
  

  // EARLY BOARD INIT (PMU / rails) - should be first dependency init
  Board_TBeamS3::earlyBegin();  // <-- FIRST!!!
  SatCom::begin();
  SatCom::getIdAndPrint();   // <-- ADD THIS
  BME280Sensor::begin();
  PMU_AXP2101::begin();
  GeoFence::begin();

  // ---------------- Optional: GPS bring-up (keep, but if it spams / blocks, comment it) ----------------
  GPSControl::begin();
  Serial.println("[BOOT] GPSControl::begin done");
  // GPSControl::poll();  // not needed in setup; loop() handles it

  // ---------------- Optional: Portal server ----------------
  PortalServer::begin();
  // If PortalServer requires servicing in loop, uncomment below in loop().
  // PortalServer::loop();

  // ---------------- Display boot screen ----------------
  display_init();
  display_show_boot();
  display_set_callsign("SR99");
  display_set_satcom("INIT");
  display_set_hold_state("HOLD");
  display_set_flight_state("GROUND");
  {
    ConfigStore portalConfig("/config.json");
    StaticJsonDocument<256> cfg;
    if (portalConfig.begin() && portalConfig.load(cfg)) {
      String callsign = cfg["callsign"] | String("SR99");
      if (callsign.length() > 0) {
        display_set_callsign(callsign.c_str());
      }
    }
  }

  bootStartMs = millis();

  // Optional visual “milestones” (kept for future tuning)
  // (These will immediately get overwritten by the smooth time-based fill below.)
  // setBoot(10);
  // setBoot(25);
  // setBoot(40);
  // setBoot(60);
  // setBoot(80);

  // Force immediate first draw of progress bar at 0%
  setBoot(0);
}

void loop() {
  const uint32_t now = millis();

  // ---------------- Keep-alive log (useful while debugging boot/serial issues) ----------------
  static uint32_t lastAliveMs = 0;
  if (now - lastAliveMs >= 1000) {
    lastAliveMs = now;
    Serial.println("[BOOT] loop alive");
  }

  // ---------------- SATCOM ----------------
  SatCom::poll();
  
  // ---------------- Optional: Portal server servicing ----------------
  // PortalServer::loop();

  // ---------------- GPS polling (raw NMEA passthrough / debug) ----------------
  GPSControl::poll();

  // ---------------- BOOT ----------------
  if (screen == Screen::BOOT) {
    const uint32_t elapsed = now - bootStartMs;

    // Smooth fill: 0–99% over MIN_BOOT_MS (always at least 5 seconds)
    uint8_t timePct = (uint8_t)((elapsed * 99UL) / MIN_BOOT_MS);
    if (timePct > 99) timePct = 99;
    setBoot(timePct);

    // TODO: replace this with real readiness (e.g., GPS bytes seen, PMU OK, etc.)
    bool gpsReady = true;
    // Example future gating (keep commented so we don’t lose it):
    // bool gpsReady = GPSControl::hasTraffic();   // you’d implement this
    // bool gpsReady = (GPSControl::totalBytes() > 0);

    // Enforce BOTH:
    //  - at least MIN_BOOT_MS elapsed
    //  - readiness condition satisfied
    if (!bootDone && elapsed >= MIN_BOOT_MS && gpsReady) {
      setBoot(100);            // guaranteed visible
      bootDone = true;

      // Switch to status
      screen = Screen::STATUS;
      display_show_status();
      lastStatusDrawMs = now;
    }
    return;
  }

  // ---------------- STATUS ----------------
  if (now - lastStatusDrawMs >= STATUS_REFRESH_MS) {
    BME280Sensor::update();
    PMU_AXP2101::update();
    if (GPSControl::hasFix()) {
      const bool violation = GeoFence::update(GPSControl::latitude(), GPSControl::longitude());
      if (violation && !Termination::triggered() && GeoFence::violationCount() > 0) {
        const GeoFence::Violation &v = GeoFence::violation(0);
        Termination::trigger(v.detail.c_str());
      }
      display_set_geo((uint8_t)GeoFence::ruleCount(), !violation);
    } else {
      display_set_geo((uint8_t)GeoFence::ruleCount(), true);
    }
    const int battPct = PMU_AXP2101::batteryPercent();
    if (battPct >= 0) {
      display_set_battery(static_cast<uint8_t>(battPct));
    }
    display_set_gps(GPSControl::hasFix(), GPSControl::satellites());
    display_show_status();
    lastStatusDrawMs = now;
  }

  if (!satIdPrinted && (now - lastSatIdQueryMs >= 2000)) {
    lastSatIdQueryMs = now;
    if (SatCom::getId(satId)) {
      char satBuf[20];
      snprintf(satBuf, sizeof(satBuf), "GOOD %lu", (unsigned long)satId);
      display_set_satcom(satBuf);
      satIdPrinted = true;
    } else {
      display_set_satcom("INIT");
    }
  }

  if (now - lastSatSendMs >= SAT_SEND_INTERVAL_MS) {
    lastSatSendMs = now;
    if (GPSControl::hasFix()) {
      MessageCodec::Fields fields;
      fields.time_value = GPSControl::timeValue();
      fields.latitude = GPSControl::latitude();
      fields.longitude = GPSControl::longitude();
      fields.altitude_m = GPSControl::altitudeMeters();
      fields.temp_k = BME280Sensor::temperatureC() + 273.15f;
      fields.pressure_hpa = BME280Sensor::pressureHpa();

      MessageCodec::EncodedMessage msg;
      if (MessageCodec::encodeRaw27(fields, msg)) {
        SatCom::sendRawFrame(msg.bytes, msg.len);
      }
    }
  }
}

#include "PortalServer.h"

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

#include "core/ConfigStore.h"
#include "core/SystemStatus.h"
#include "geofence/GeoFence.h"
#include "gps/GPSControl.h"
#include "mission/MissionController.h"
#include "satcom/SatCom.h"

static const char* AP_SSID = "SABER-T2C";
static const char* AP_PASS = "kyberdyne";
static const char* GEOFENCE_PATH = "/geofence.json";
static const char* GEOFENCE_DB_PATH = "/geofence_db.json";
static const char* MISSION_LIBRARY_PATH = "/mission_library.json";

static AsyncWebServer server(80);
static ConfigStore store("/mission_active.json");

// Default config returned when file is missing/corrupt
static void fillDefaults(JsonDocument& doc) {
  doc.clear();
  doc["missionId"] = "";
  doc["callsign"] = "";
  doc["balloonType"] = "";
  doc["satcom_id"] = "";
  doc["satcom_verified"] = false;
  doc["launch_confirmed"] = false;
  doc["time_kill_min"] = 0;
  doc["triggerCount"] = 0;
  doc["timed_enabled"] = false;
  doc["contained_enabled"] = false;
  doc["exclusion_enabled"] = false;
  doc["crossing_enabled"] = false;
  doc["note"] = "";
  doc["autoErase"] = false;
  doc["launch_set"] = false;
  doc["launch_lat"] = 0.0f;
  doc["launch_lon"] = 0.0f;
  doc["launch_alt_m"] = 0.0f;
}

static void fillGeofenceDefaults(JsonDocument& doc) {
  doc.clear();
  doc.createNestedArray("keep_out");
  doc.createNestedArray("stay_in");
  doc.createNestedArray("lines");
}

static void fillMissionsDefaults(JsonDocument& doc) {
  doc.clear();
  doc.createNestedArray("missions");
}

static bool loadJsonFile(const char* path, JsonDocument& doc) {
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  return !err;
}

static bool saveJsonFile(const char* path, const JsonDocument& doc) {
  File f = LittleFS.open(path, "w");
  if (!f) return false;
  if (serializeJson(doc, f) == 0) {
    f.close();
    return false;
  }
  f.close();
  return true;
}

namespace PortalServer {

void begin() {
  Serial.begin(115200);
  delay(300);

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS failed");
    return;
  }

  // Ensure config file exists (creates {} if missing)
  if (!store.begin()) {
    Serial.println("ConfigStore begin failed");
    // continue anyway; portal can still run
  }

  // Ensure geofence file exists with defaults if missing/corrupt
  if (!LittleFS.exists(GEOFENCE_PATH)) {
    StaticJsonDocument<256> geoDoc;
    fillGeofenceDefaults(geoDoc);
    saveJsonFile(GEOFENCE_PATH, geoDoc);
  }
  if (!LittleFS.exists(GEOFENCE_DB_PATH)) {
    StaticJsonDocument<256> geoDoc;
    fillGeofenceDefaults(geoDoc);
    saveJsonFile(GEOFENCE_DB_PATH, geoDoc);
  }
  if (!LittleFS.exists(MISSION_LIBRARY_PATH)) {
    StaticJsonDocument<256> missionDoc;
    fillMissionsDefaults(missionDoc);
    saveJsonFile(MISSION_LIBRARY_PATH, missionDoc);
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);

  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());

  server.serveStatic("/", LittleFS, "/portal")
        .setDefaultFile("active_mission.html");

  // GET current config (or defaults if missing/corrupt)
  server.on("/api/config", HTTP_GET, [](AsyncWebServerRequest *request) {
    StaticJsonDocument<1024> doc;

    if (!store.load(doc)) {
      fillDefaults(doc);
    }

    String out;
    serializeJson(doc, out);
    request->send(200, "application/json", out);
  });

  // GET current status (callsign + GPS)
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *request) {
    StaticJsonDocument<1024> doc;
    StaticJsonDocument<1024> cfg;

    if (!store.load(cfg)) {
      fillDefaults(cfg);
    }

    doc["callsign"] = SystemStatus::callsign();
    doc["balloonType"] = SystemStatus::balloonType();
    doc["flightState"] = SystemStatus::flightState();
    doc["holdState"] = SystemStatus::holdState();
    doc["lora"] = SystemStatus::loraState();
    doc["satcomState"] = SystemStatus::satcomState();
    doc["battery"] = SystemStatus::batteryPct();
    doc["geoCount"] = SystemStatus::geoCount();
    doc["geoOk"] = SystemStatus::geoOk();
    doc["missionId"] = cfg["missionId"] | "";
    doc["satcom_id"] = cfg["satcom_id"] | "";
    doc["time_kill_min"] = cfg["time_kill_min"] | 0;
    doc["triggerCount"] = cfg["triggerCount"] | 0;
    doc["launch_set"] = MissionController::launchLocationSet();
    doc["launch_lat"] = MissionController::launchLatitude();
    doc["launch_lon"] = MissionController::launchLongitude();
    doc["launch_alt_m"] = MissionController::launchAltitudeMeters();
    doc["gpsFix"] = GPSControl::hasFix();
    doc["lat"] = GPSControl::latitude();
    doc["lon"] = GPSControl::longitude();
    doc["alt_m"] = GPSControl::altitudeMeters();
    doc["sats"] = GPSControl::satellites();
    doc["flight_timer_sec"] = MissionController::flightTimerSeconds();
    const uint32_t satId = SatCom::lastId();
    if (satId > 0) {
      char idBuf[16];
      snprintf(idBuf, sizeof(idBuf), "%lu", (unsigned long)satId);
      doc["globalstarId"] = idBuf;
    } else {
      doc["globalstarId"] = "";
    }

    String out;
    serializeJson(doc, out);
    request->send(200, "application/json", out);
  });

  // GET test flags
  server.on("/api/test", HTTP_GET, [](AsyncWebServerRequest *request) {
    StaticJsonDocument<128> doc;
    doc["force_geofence"] = GeoFence::forcedViolation();
    doc["flight_mode"] = MissionController::testFlightMode();
    doc["test_mode"] = MissionController::testModeActive();
    String out;
    serializeJson(doc, out);
    request->send(200, "application/json", out);
  });

  // GET current geofence config
  server.on("/api/geofence", HTTP_GET, [](AsyncWebServerRequest *request) {
    StaticJsonDocument<2048> doc;
    if (!loadJsonFile(GEOFENCE_PATH, doc)) {
      fillGeofenceDefaults(doc);
    }
    String out;
    serializeJson(doc, out);
    request->send(200, "application/json", out);
  });

  // POST new config (validates JSON before saving)
  server.on(
    "/api/config",
    HTTP_POST,
    [](AsyncWebServerRequest *request) {},   // headers handled in body callback
    NULL,                                    // no file upload
    [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
      static String body;

      if (index == 0) body = "";
      body += String((char*)data).substring(0, len);

      if (index + len != total) return; // wait for full body

      StaticJsonDocument<1024> doc;
      DeserializationError err = deserializeJson(doc, body);

      if (err) {
        request->send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_json\"}");
        return;
      }

      StaticJsonDocument<1024> existing;
      if (!store.load(existing)) {
        fillDefaults(existing);
      }

      StaticJsonDocument<1024> merged;
      merged.set(existing);

      if (doc.containsKey("callsign")) merged["callsign"] = doc["callsign"].as<String>();
      if (doc.containsKey("balloonType")) merged["balloonType"] = doc["balloonType"].as<String>();
      if (doc.containsKey("missionId")) merged["missionId"] = doc["missionId"].as<String>();
      if (doc.containsKey("satcom_id")) merged["satcom_id"] = doc["satcom_id"].as<String>();
      if (doc.containsKey("satcom_verified")) merged["satcom_verified"] = doc["satcom_verified"].as<bool>();
      if (doc.containsKey("launch_confirmed")) merged["launch_confirmed"] = doc["launch_confirmed"].as<bool>();
      if (doc.containsKey("time_kill_min")) merged["time_kill_min"] = doc["time_kill_min"].as<uint32_t>();
      if (doc.containsKey("triggerCount")) merged["triggerCount"] = doc["triggerCount"].as<uint32_t>();
      if (doc.containsKey("timed_enabled")) merged["timed_enabled"] = doc["timed_enabled"].as<bool>();
      if (doc.containsKey("contained_enabled")) merged["contained_enabled"] = doc["contained_enabled"].as<bool>();
      if (doc.containsKey("exclusion_enabled")) merged["exclusion_enabled"] = doc["exclusion_enabled"].as<bool>();
      if (doc.containsKey("crossing_enabled")) merged["crossing_enabled"] = doc["crossing_enabled"].as<bool>();
      if (doc.containsKey("note")) merged["note"] = doc["note"].as<String>();
      if (doc.containsKey("autoErase")) merged["autoErase"] = doc["autoErase"].as<bool>();

      {
        String cs = merged["callsign"].as<String>();
        cs.trim();
        if (cs.length() > 6) cs.remove(6);
        merged["callsign"] = cs;
      }

      if (!store.save(merged)) {
        request->send(500, "application/json", "{\"ok\":false,\"error\":\"save_failed\"}");
        return;
      }

      request->send(200, "application/json", "{\"ok\":true}");
    }
  );

  // POST test flags
  server.on(
    "/api/test",
    HTTP_POST,
    [](AsyncWebServerRequest *request) {},
    NULL,
    [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
      static String body;

      if (index == 0) body = "";
      body += String((char*)data).substring(0, len);

      if (index + len != total) return;

      StaticJsonDocument<128> doc;
      DeserializationError err = deserializeJson(doc, body);
      if (err) {
        request->send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_json\"}");
        return;
      }

      const bool forceGeofence = doc["force_geofence"] | false;
      const bool flightMode = doc["flight_mode"] | false;
      const bool testMode = doc["test_mode"] | false;
      GeoFence::setForcedViolation(forceGeofence);
      MissionController::setTestFlightMode(flightMode);
      MissionController::setTestMode(testMode);

      request->send(200, "application/json", "{\"ok\":true}");
    }
  );

  // POST new geofence config
  server.on(
    "/api/geofence",
    HTTP_POST,
    [](AsyncWebServerRequest *request) {},
    NULL,
    [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
      static String body;

      if (index == 0) body = "";
      body += String((char*)data).substring(0, len);

      if (index + len != total) return;

      StaticJsonDocument<2048> doc;
      DeserializationError err = deserializeJson(doc, body);

      if (err) {
        request->send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_json\"}");
        return;
      }

      if (!doc.containsKey("keep_out")) doc.createNestedArray("keep_out");
      if (!doc.containsKey("stay_in")) doc.createNestedArray("stay_in");
      if (!doc.containsKey("lines")) doc.createNestedArray("lines");

      if (!saveJsonFile(GEOFENCE_PATH, doc)) {
        request->send(500, "application/json", "{\"ok\":false,\"error\":\"save_failed\"}");
        return;
      }
      (void)saveJsonFile(GEOFENCE_DB_PATH, doc);
      (void)GeoFence::reload(GEOFENCE_PATH);

      request->send(200, "application/json", "{\"ok\":true}");
    }
  );

  // GET missions list
  server.on("/api/missions", HTTP_GET, [](AsyncWebServerRequest *request) {
    DynamicJsonDocument doc(16384);
    if (!loadJsonFile(MISSION_LIBRARY_PATH, doc)) {
      fillMissionsDefaults(doc);
    }
    JsonArray arr = doc["missions"].as<JsonArray>();
    DynamicJsonDocument outDoc(16384);
    JsonArray outArr = outDoc.to<JsonArray>();
    for (JsonObject m : arr) {
      JsonObject o = outArr.createNestedObject();
      o["id"] = m["id"] | "";
      o["name"] = m["name"] | "";
      o["description"] = m["description"] | "";
      o["timed_enabled"] = m["timed_enabled"] | false;
      o["contained_enabled"] = m["contained_enabled"] | false;
      o["exclusion_enabled"] = m["exclusion_enabled"] | false;
      o["crossing_enabled"] = m["crossing_enabled"] | false;
      o["callsign"] = m["callsign"] | "";
      o["balloonType"] = m["balloonType"] | "";
      o["note"] = m["note"] | "";
      o["time_kill_min"] = m["time_kill_min"] | 0;
      o["autoErase"] = m["autoErase"] | false;
      o["satcom_id"] = m["satcom_id"] | "";
      o["satcom_verified"] = m["satcom_verified"] | false;
      o["launch_confirmed"] = m["launch_confirmed"] | false;
      if (m.containsKey("geofence")) {
        o["geofence"] = m["geofence"];
      }
    }
    String out;
    serializeJson(outArr, out);
    request->send(200, "application/json", out);
  });

  // POST missions list (upsert by id)
  server.on(
    "/api/missions",
    HTTP_POST,
    [](AsyncWebServerRequest *request) {},
    NULL,
    [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
      static String body;

      if (index == 0) body = "";
      body += String((char*)data).substring(0, len);

      if (index + len != total) return;

      DynamicJsonDocument incoming(8192);
      DeserializationError err = deserializeJson(incoming, body);
      if (err) {
        request->send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_json\"}");
        return;
      }

      const char *id = incoming["id"] | "";
      const char *name = incoming["name"] | "";
      const char *description = incoming["description"] | "";
      const bool hasTimed = incoming.containsKey("timed_enabled");
      const bool hasContained = incoming.containsKey("contained_enabled");
      const bool hasExclusion = incoming.containsKey("exclusion_enabled");
      const bool hasCrossing = incoming.containsKey("crossing_enabled");
      const bool hasCallsign = incoming.containsKey("callsign");
      const bool hasBalloon = incoming.containsKey("balloonType");
      const bool hasNote = incoming.containsKey("note");
      const bool hasTimeKill = incoming.containsKey("time_kill_min");
      const bool hasAutoErase = incoming.containsKey("autoErase");
      const bool hasSatcom = incoming.containsKey("satcom_id");
      const bool hasSatcomVerified = incoming.containsKey("satcom_verified");
      const bool hasLaunchConfirmed = incoming.containsKey("launch_confirmed");
      const bool timedEnabled = incoming["timed_enabled"] | false;
      const bool containedEnabled = incoming["contained_enabled"] | false;
      const bool exclusionEnabled = incoming["exclusion_enabled"] | false;
      const bool crossingEnabled = incoming["crossing_enabled"] | false;
      const bool hasGeofence = incoming.containsKey("geofence");
      const char *callsign = incoming["callsign"] | "";
      const char *balloonType = incoming["balloonType"] | "";
      const char *note = incoming["note"] | "";
      const uint32_t timeKillMin = incoming["time_kill_min"] | 0;
      const bool autoErase = incoming["autoErase"] | false;
      const char *satcomId = incoming["satcom_id"] | "";
      const bool satcomVerified = incoming["satcom_verified"] | false;
      const bool launchConfirmed = incoming["launch_confirmed"] | false;
      if (strlen(id) == 0) {
        request->send(400, "application/json", "{\"ok\":false,\"error\":\"missing_id\"}");
        return;
      }

      DynamicJsonDocument doc(16384);
      if (!loadJsonFile(MISSION_LIBRARY_PATH, doc)) {
        fillMissionsDefaults(doc);
      }
      JsonArray arr = doc["missions"].as<JsonArray>();
      bool found = false;
      for (JsonObject m : arr) {
        if (String(m["id"] | "") == String(id)) {
          m["name"] = name;
          m["description"] = description;
          if (hasTimed) m["timed_enabled"] = timedEnabled;
          if (hasContained) m["contained_enabled"] = containedEnabled;
          if (hasExclusion) m["exclusion_enabled"] = exclusionEnabled;
          if (hasCrossing) m["crossing_enabled"] = crossingEnabled;
          if (hasCallsign) m["callsign"] = callsign;
          if (hasBalloon) m["balloonType"] = balloonType;
          if (hasNote) m["note"] = note;
          if (hasTimeKill) m["time_kill_min"] = timeKillMin;
          if (hasAutoErase) m["autoErase"] = autoErase;
          if (hasSatcom) m["satcom_id"] = satcomId;
          if (hasSatcomVerified) m["satcom_verified"] = satcomVerified;
          if (hasLaunchConfirmed) m["launch_confirmed"] = launchConfirmed;
          if (hasGeofence) m["geofence"] = incoming["geofence"];
          found = true;
          break;
        }
      }
      if (!found) {
        JsonObject m = arr.createNestedObject();
        m["id"] = id;
        m["name"] = name;
        m["description"] = description;
        m["timed_enabled"] = timedEnabled;
        m["contained_enabled"] = containedEnabled;
        m["exclusion_enabled"] = exclusionEnabled;
        m["crossing_enabled"] = crossingEnabled;
        if (hasCallsign) m["callsign"] = callsign;
        if (hasBalloon) m["balloonType"] = balloonType;
        if (hasNote) m["note"] = note;
        if (hasTimeKill) m["time_kill_min"] = timeKillMin;
        if (hasAutoErase) m["autoErase"] = autoErase;
        if (hasSatcom) m["satcom_id"] = satcomId;
        if (hasSatcomVerified) m["satcom_verified"] = satcomVerified;
        if (hasLaunchConfirmed) m["launch_confirmed"] = launchConfirmed;
        if (hasGeofence) m["geofence"] = incoming["geofence"];
      }

      if (!saveJsonFile(MISSION_LIBRARY_PATH, doc)) {
        request->send(500, "application/json", "{\"ok\":false,\"error\":\"save_failed\"}");
        return;
      }

      request->send(200, "application/json", "{\"ok\":true}");
    }
  );

  server.begin();
  Serial.println("Web server started");
}

} // namespace PortalServer

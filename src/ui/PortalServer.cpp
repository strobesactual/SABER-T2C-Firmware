#include "PortalServer.h"

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

#include "core/ConfigStore.h"
#include "core/SystemStatus.h"
#include "gps/GPSControl.h"
#include "satcom/SatCom.h"

static const char* AP_SSID = "SABER-T2C";
static const char* AP_PASS = "saber1234";
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
  doc["time_kill_min"] = 0;
  doc["triggerCount"] = 0;
  doc["note"] = "";
  doc["autoErase"] = false;
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
        .setDefaultFile("configuration.html");

  // GET current config (or defaults if missing/corrupt)
  server.on("/api/config", HTTP_GET, [](AsyncWebServerRequest *request) {
    StaticJsonDocument<512> doc;

    if (!store.load(doc)) {
      fillDefaults(doc);
    }

    String out;
    serializeJson(doc, out);
    request->send(200, "application/json", out);
  });

  // GET current status (callsign + GPS)
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *request) {
    StaticJsonDocument<512> doc;
    StaticJsonDocument<512> cfg;

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
    doc["gpsFix"] = GPSControl::hasFix();
    doc["lat"] = GPSControl::latitude();
    doc["lon"] = GPSControl::longitude();
    doc["alt_m"] = GPSControl::altitudeMeters();
    doc["sats"] = GPSControl::satellites();
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

      StaticJsonDocument<512> doc;
      DeserializationError err = deserializeJson(doc, body);

      if (err) {
        request->send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_json\"}");
        return;
      }

      // Optional: enforce expected keys exist (and keep types sane)
      // If a key is missing, set a default.
      if (!doc.containsKey("callsign"))   doc["callsign"] = "";
      if (!doc.containsKey("balloonType")) doc["balloonType"] = "";
      if (!doc.containsKey("missionId"))  doc["missionId"] = "";
      if (!doc.containsKey("satcom_id")) doc["satcom_id"] = "";
      if (!doc.containsKey("time_kill_min")) doc["time_kill_min"] = 0;
      if (!doc.containsKey("triggerCount")) doc["triggerCount"] = 0;
      if (!doc.containsKey("note"))       doc["note"] = "";
      if (!doc.containsKey("autoErase"))  doc["autoErase"] = false;

      // Optional: coerce types (ArduinoJson is flexible; this keeps your schema stable)
      doc["callsign"] = doc["callsign"].as<String>();
      doc["balloonType"] = doc["balloonType"].as<String>();
      doc["missionId"] = doc["missionId"].as<String>();
      doc["satcom_id"] = doc["satcom_id"].as<String>();
      doc["time_kill_min"] = doc["time_kill_min"].as<uint32_t>();
      doc["triggerCount"] = doc["triggerCount"].as<uint32_t>();
      doc["note"] = doc["note"].as<String>();
      doc["autoErase"] = doc["autoErase"].as<bool>();
      {
        String cs = doc["callsign"].as<String>();
        cs.trim();
        if (cs.length() > 6) cs.remove(6);
        doc["callsign"] = cs;
      }

      if (!store.save(doc)) {
        request->send(500, "application/json", "{\"ok\":false,\"error\":\"save_failed\"}");
        return;
      }

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

      request->send(200, "application/json", "{\"ok\":true}");
    }
  );

  // GET missions list
  server.on("/api/missions", HTTP_GET, [](AsyncWebServerRequest *request) {
    StaticJsonDocument<4096> doc;
    if (!loadJsonFile(MISSION_LIBRARY_PATH, doc)) {
      fillMissionsDefaults(doc);
    }
    JsonArray arr = doc["missions"].as<JsonArray>();
    StaticJsonDocument<4096> outDoc;
    JsonArray outArr = outDoc.to<JsonArray>();
    for (JsonObject m : arr) {
      JsonObject o = outArr.createNestedObject();
      o["id"] = m["id"] | "";
      o["name"] = m["name"] | "";
      o["description"] = m["description"] | "";
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

      StaticJsonDocument<512> incoming;
      DeserializationError err = deserializeJson(incoming, body);
      if (err) {
        request->send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_json\"}");
        return;
      }

      const char *id = incoming["id"] | "";
      const char *name = incoming["name"] | "";
      const char *description = incoming["description"] | "";
      if (strlen(id) == 0) {
        request->send(400, "application/json", "{\"ok\":false,\"error\":\"missing_id\"}");
        return;
      }

      StaticJsonDocument<4096> doc;
      if (!loadJsonFile(MISSION_LIBRARY_PATH, doc)) {
        fillMissionsDefaults(doc);
      }
      JsonArray arr = doc["missions"].as<JsonArray>();
      bool found = false;
      for (JsonObject m : arr) {
        if (String(m["id"] | "") == String(id)) {
          m["name"] = name;
          m["description"] = description;
          found = true;
          break;
        }
      }
      if (!found) {
        JsonObject m = arr.createNestedObject();
        m["id"] = id;
        m["name"] = name;
        m["description"] = description;
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

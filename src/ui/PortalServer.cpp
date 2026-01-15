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

static AsyncWebServer server(80);
static ConfigStore store("/config.json");

// Default config returned when file is missing/corrupt
static void fillDefaults(JsonDocument& doc) {
  doc.clear();
  doc["callsign"] = "";
  doc["balloonType"] = "";
  doc["missionId"] = "";
  doc["satcomMessages"] = false;
  doc["ttTotalSec"] = 0;
  doc["note"] = "";
  doc["autoErase"] = false;
}

static void fillGeofenceDefaults(JsonDocument& doc) {
  doc.clear();
  doc.createNestedArray("keep_out");
  doc.createNestedArray("stay_in");
  doc.createNestedArray("lines");
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

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);

  Serial.print("AP IP: ");
  Serial.println(WiFi.softAPIP());

  server.serveStatic("/", LittleFS, "/Portal")
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
    doc["satcomMessages"] = cfg["satcomMessages"] | false;
    doc["ttTotalSec"] = cfg["ttTotalSec"] | 0;
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
      if (!doc.containsKey("satcomMessages")) doc["satcomMessages"] = false;
      if (!doc.containsKey("ttTotalSec")) doc["ttTotalSec"] = 0;
      if (!doc.containsKey("note"))       doc["note"] = "";
      if (!doc.containsKey("autoErase"))  doc["autoErase"] = false;

      // Optional: coerce types (ArduinoJson is flexible; this keeps your schema stable)
      doc["callsign"] = doc["callsign"].as<String>();
      doc["balloonType"] = doc["balloonType"].as<String>();
      doc["missionId"] = doc["missionId"].as<String>();
      doc["satcomMessages"] = doc["satcomMessages"].as<bool>();
      doc["ttTotalSec"] = doc["ttTotalSec"].as<uint32_t>();
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

      request->send(200, "application/json", "{\"ok\":true}");
    }
  );

  server.begin();
  Serial.println("Web server started");
}

} // namespace PortalServer

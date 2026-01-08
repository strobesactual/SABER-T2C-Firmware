#include "PortalServer.h"

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

#include "core/ConfigStore.h"

static const char* AP_SSID = "SABER-T2C";
static const char* AP_PASS = "saber1234";

static AsyncWebServer server(80);
static ConfigStore store("/config.json");

// Default config returned when file is missing/corrupt
static void fillDefaults(JsonDocument& doc) {
  doc.clear();
  doc["callsign"] = "";
  doc["balloonType"] = "";
  doc["note"] = "";
  doc["autoErase"] = false;
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
      if (!doc.containsKey("note"))       doc["note"] = "";
      if (!doc.containsKey("autoErase"))  doc["autoErase"] = false;

      // Optional: coerce types (ArduinoJson is flexible; this keeps your schema stable)
      doc["callsign"] = doc["callsign"].as<String>();
      doc["balloonType"] = doc["balloonType"].as<String>();
      doc["note"] = doc["note"].as<String>();
      doc["autoErase"] = doc["autoErase"].as<bool>();

      if (!store.save(doc)) {
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
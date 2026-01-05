#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>

const char* AP_SSID = "SABER-T2C";
const char* AP_PASS = "saber1234";   // change later

AsyncWebServer server(80);

void setup() {
  Serial.begin(115200);
  delay(500);

  // Filesystem
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed");
    return;
  }
  Serial.println("LittleFS mounted");

  // Wi-Fi AP
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);

  IPAddress ip = WiFi.softAPIP();
  Serial.print("AP IP: ");
  Serial.println(ip);

  // Serve Portal
  server.serveStatic("/", LittleFS, "/")
        .setDefaultFile("configuration.html");

  server.begin();
  Serial.println("Web server started");
}

void loop() {
  // nothing here
}
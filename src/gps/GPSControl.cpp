// src/gps/GPSControl.cpp

#include <Arduino.h>
#include <HardwareSerial.h>
#include <TinyGPS++.h>
#include "gps/GPSControl.h"
#include "display/display.h"

static HardwareSerial GPSSerial(1);

// From schematic:
// ESP GPIO9  = GPS_RX  (ESP RX  <- GNSS TXD)
// ESP GPIO8  = GPS_TX  (ESP TX  -> GNSS RXD)
// ESP GPIO6  = GPS_WAKEUP (to L76K WAKE_UP)
static const int GPS_RX_PIN   = 9;
static const int GPS_TX_PIN   = 8;
static const int GPS_WAKE_PIN = 6;

static const uint32_t GPS_BAUD = 9600;

// Stats / throttling
static uint32_t totalBytes = 0;
static uint32_t lastPrintMs = 0;

// Line buffer for throttled output
static char lineBuf[128];
static size_t lineLen = 0;

static TinyGPSPlus gps;
static float lastLat = 0.0f;
static float lastLng = 0.0f;
static float lastAlt = NAN;
static uint32_t lastTime = 0;
static bool lastFix = false;
static uint8_t lastSats = 0;

void GPSControl::begin()
{
  Serial.println("[GPS] begin()");

  // Wake GPS and keep it awake
  pinMode(GPS_WAKE_PIN, OUTPUT);
  digitalWrite(GPS_WAKE_PIN, HIGH);
  delay(200);
  Serial.println("[GPS] WAKE=HIGH");

  // UART init
  GPSSerial.setRxBufferSize(4096);
  GPSSerial.end();
  delay(50);
  GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  Serial.printf("[GPS] UART1 @%lu RX=%d TX=%d\n",
                (unsigned long)GPS_BAUD,
                GPS_RX_PIN,
                GPS_TX_PIN);
}

void GPSControl::poll()
{
  const uint32_t now = millis();

  while (GPSSerial.available()) {
    const char c = (char)GPSSerial.read();
    totalBytes++;
    gps.encode(c);

    // Build NMEA line
    if (c == '\n') {
      lineBuf[lineLen] = '\0';

      // Print at most once per second
      if (now - lastPrintMs >= 1000) {
        Serial.printf("[GPS] %s\n", lineBuf);
        lastPrintMs = now;
      }

      lineLen = 0;
    }
    else if (c != '\r') {
      if (lineLen < sizeof(lineBuf) - 1) {
        lineBuf[lineLen++] = c;
      }
    }
  }

  if (gps.location.isUpdated()) {
    lastLat = gps.location.lat();
    lastLng = gps.location.lng();
  }
  if (gps.altitude.isUpdated()) {
    lastAlt = gps.altitude.meters();
  }
  if (gps.time.isUpdated()) {
    lastTime = gps.time.value();
  }
  lastFix = gps.location.isValid();
  if (gps.satellites.isValid()) {
    lastSats = (uint8_t)gps.satellites.value();
  }
  display_set_gps(lastFix, lastSats);
}

bool GPSControl::hasFix() { return lastFix; }
float GPSControl::latitude() { return lastLat; }
float GPSControl::longitude() { return lastLng; }
float GPSControl::altitudeMeters() { return lastAlt; }
uint32_t GPSControl::timeValue() { return lastTime; }
uint8_t GPSControl::satellites() { return lastSats; }

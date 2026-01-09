#include <Arduino.h>
#include "gps/GPSControl.h"
#include "board/Board_TBeamS3.h"

static HardwareSerial GPSSerial(1);  // UART1

// T-Beam S3 Supreme GNSS UART pins
static const int GPS_RX_PIN = 44;    // ESP32 RX <- GNSS TX
static const int GPS_TX_PIN = 43;    // ESP32 TX -> GNSS RX
static const uint32_t GPS_BAUD = 9600;

static uint32_t lastDbgMs = 0;
static uint32_t totalBytes = 0;

void GPSControl::begin()
{
  Serial.println("[GPS] begin()");

  // Ensure GNSS rail is on (safe if already enabled)
  if (Board_TBeamS3::pmuOk()) {
    Board_TBeamS3::enableGnss();
  } else {
    Serial.println("[GPS] WARN: PMU not OK; GNSS may be unpowered");
  }

  GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.printf("[GPS] UART1 started @ %lu (RX=%d TX=%d)\n",
                (unsigned long)GPS_BAUD, GPS_RX_PIN, GPS_TX_PIN);
}

void GPSControl::poll()
{
  while (GPSSerial.available()) {
    char c = (char)GPSSerial.read();
    totalBytes++;
    Serial.write(c); // raw NMEA passthrough
  }

  const uint32_t now = millis();
  if (now - lastDbgMs >= 1000) {
    lastDbgMs = now;
    Serial.printf("[GPS] bytes=%lu\n", (unsigned long)totalBytes);
  }
}
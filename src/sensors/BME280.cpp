#include "sensors/BME280.h"

#include <Arduino.h>
#include <Adafruit_BME280.h>
#include <Wire.h>

namespace {
  Adafruit_BME280 s_bme;
  bool s_ok = false;

  float s_temp_c = NAN;
  float s_press_hpa = NAN;
  float s_hum_pct = NAN;

  bool tryBegin(uint8_t addr)
  {
    if (s_bme.begin(addr, &Wire)) {
      return true;
    }
    return false;
  }
}

bool BME280Sensor::begin()
{
  // Common BME280 I2C addresses.
  s_ok = tryBegin(0x76) || tryBegin(0x77);
  if (!s_ok) {
    Serial.println("[BME280] not found on I2C");
    return false;
  }

  Serial.println("[BME280] online");
  return true;
}

bool BME280Sensor::update()
{
  if (!s_ok) return false;

  s_temp_c = s_bme.readTemperature();
  s_press_hpa = s_bme.readPressure() / 100.0f;
  s_hum_pct = s_bme.readHumidity();
  return true;
}

bool BME280Sensor::isOnline()
{
  return s_ok;
}

float BME280Sensor::temperatureC()
{
  return s_temp_c;
}

float BME280Sensor::pressureHpa()
{
  return s_press_hpa;
}

float BME280Sensor::humidityPct()
{
  return s_hum_pct;
}

#pragma once

#include <stdint.h>

namespace BME280Sensor {
  // Initializes the BME280 over I2C. Returns true if detected.
  bool begin();
  // Updates cached measurements. Returns true on success.
  bool update();

  bool isOnline();

  // Cached measurements (updated by update()).
  float temperatureC();
  float pressureHpa();
  float humidityPct();
}

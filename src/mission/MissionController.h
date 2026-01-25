#pragma once

#include <Arduino.h>

namespace MissionController {
  void begin();
  void update(uint32_t now_ms);

  void setTestFlightMode(bool enabled);
  void setTestMode(bool enabled);
  bool testFlightMode();
  bool testModeActive();
  bool flightModeActive();
  uint32_t flightTimerSeconds();
  bool launchLocationSet();
  float launchLatitude();
  float launchLongitude();
  float launchAltitudeMeters();
}

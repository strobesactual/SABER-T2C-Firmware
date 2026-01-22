#pragma once

#include <Arduino.h>

namespace MissionController {
  void begin();
  void update(uint32_t now_ms);

  void setTestFlightMode(bool enabled);
  bool testFlightMode();
  bool flightModeActive();
}

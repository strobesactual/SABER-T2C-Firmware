#pragma once

#include <stdint.h>

namespace PMU_AXP2101 {
  // Initialize PMU measurements. Returns true if PMU is available.
  bool begin();
  // Refresh cached battery measurements.
  bool update();

  bool isOnline();
  bool batteryPresent();
  bool isCharging();

  // Cached values (updated by update()).
  uint16_t batteryMv();
  int batteryPercent();
}

#pragma once
#include <Arduino.h>

class XPowersAXP2101;

namespace Board_TBeamS3 {
  void earlyBegin();      // Call FIRST in setup()
  bool pmuOk();           // True if AXP2101 detected
  XPowersAXP2101 *pmu();  // Returns PMU handle if available
  void enableGnss();      // Enables GNSS rail (idempotent)
}

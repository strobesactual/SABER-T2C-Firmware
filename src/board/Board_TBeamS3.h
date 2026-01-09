#pragma once
#include <Arduino.h>

namespace Board_TBeamS3 {
  void earlyBegin();      // Call FIRST in setup()
  bool pmuOk();           // True if AXP2101 detected
  void enableGnss();      // Enables GNSS rail (idempotent)
}
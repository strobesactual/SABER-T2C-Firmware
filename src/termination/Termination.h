#pragma once

#include <Arduino.h>

namespace Termination {
  // Marks the system as terminated and records the reason (no hardware action yet).
  void trigger(const char *reason);
  bool triggered();
  const char *reason();
  void reset();
}

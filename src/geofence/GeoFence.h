#pragma once

#include <Arduino.h>
#include <stddef.h>

namespace GeoFence {
  struct Violation {
    String id;
    String type;
    String detail;
  };

  // Load rules from LittleFS JSON (default: /geofence.json).
  bool begin(const char *path = "/geofence.json");
  bool reload(const char *path = "/geofence.json");

  // Evaluate current position. Returns true if any violations.
  bool update(double lat, double lon);

  // Test hook to force a geofence violation regardless of position.
  void setForcedViolation(bool enabled);
  bool forcedViolation();

  size_t ruleCount();
  size_t violationCount();
  const Violation &violation(size_t idx);
  void clearViolations();

  // Check if point is inside any stay-in polygon. hasStayIn is set if any exist.
  bool containedAt(double lat, double lon, bool *hasStayIn);
}

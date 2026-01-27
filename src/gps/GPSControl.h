// src/gps/GPSControl.h
#pragma once
#include <Arduino.h>

namespace GPSControl {
  void begin();
  void poll();
  bool hasFix();
  bool hasGoodFix();
  float latitude();
  float longitude();
  float altitudeMeters();
  uint32_t timeValue();
  uint8_t satellites();
}

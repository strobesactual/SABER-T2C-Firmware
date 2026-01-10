// src/satcom/SatCom.h
#pragma once
#include <Arduino.h>

class SatCom {
public:
  static void begin();
  static void poll();

  // Legacy raw payload exercise (0x27 frame)
  static void ping();

  // Documented command: Get ID (0x01)
  static void getIdAndPrint();

  // Generic documented command helper (prints response as hex)
  static void queryAndHexDump(uint8_t cmd,
                              const uint8_t *payload = nullptr,
                              size_t payloadLen = 0,
                              uint32_t timeoutMs = 1000);
};
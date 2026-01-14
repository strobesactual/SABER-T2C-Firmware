#pragma once

#include <Arduino.h>

namespace MessageCodec {

struct Fields {
  uint32_t time_value;   // TinyGPS++ time.value() (hhmmsscc)
  float latitude;        // degrees, -90..90
  float longitude;       // degrees, -180..180
  float altitude_m;      // meters
  float temp_k;          // kelvin
  float pressure_hpa;    // hPa
};

struct EncodedMessage {
  uint8_t bytes[64];
  size_t len = 0;
};

// Builds a full SmartOne raw 0x27 frame (AA LEN 0x27 0x00 ... CRC).
// Returns true on success, false if the output buffer is too small.
bool encodeRaw27(const Fields &fields, EncodedMessage &out);

}  // namespace MessageCodec

#include "message/MessageCodec.h"
#include <math.h>

namespace {

static const uint8_t kHeaderLen = 4;
static const uint8_t kCrcLen = 2;
static const uint8_t kCommandRaw = 0x27;
static const uint8_t kBurnByte = 0x00;

static const uint32_t kFillerNumber = 999999999UL;  // "9"s placeholder

static uint16_t crcSmartOne(const uint8_t *data, size_t len)
{
  uint16_t crc = 0xFFFF;
  while (len--) {
    uint16_t d = 0x00FF & *data++;
    crc ^= d;
    for (uint8_t i = 0; i < 8; i++) {
      if (crc & 0x0001) crc = (crc >> 1) ^ 0x8408;
      else             crc >>= 1;
    }
  }
  return (uint16_t)~crc;
}

static void writeUint32Be(uint8_t *out, uint32_t value)
{
  out[0] = (uint8_t)((value >> 24) & 0xFF);
  out[1] = (uint8_t)((value >> 16) & 0xFF);
  out[2] = (uint8_t)((value >> 8) & 0xFF);
  out[3] = (uint8_t)(value & 0xFF);
}

}  // namespace

namespace MessageCodec {

bool encodeRaw27(const Fields &fields, EncodedMessage &out)
{
  uint32_t enc_time = fields.time_value;
  uint32_t enc_lat = (uint32_t)roundf((fields.latitude + 90.0f) * 1e5f);
  uint32_t enc_lng = (uint32_t)roundf((fields.longitude + 180.0f) * 1e5f);

  uint32_t enc_alt = isnan(fields.altitude_m)
    ? kFillerNumber
    : (uint32_t)roundf((fields.altitude_m + 200.0f) * 1e2f);
  uint32_t enc_temp = isnan(fields.temp_k)
    ? kFillerNumber
    : (uint32_t)roundf(fields.temp_k * 1e2f);
  uint32_t enc_press = isnan(fields.pressure_hpa)
    ? kFillerNumber
    : (uint32_t)roundf(fields.pressure_hpa * 1e2f);

  uint32_t data[6] = {enc_time, enc_lat, enc_lng, enc_alt, enc_temp, enc_press};

  const size_t payloadLen = sizeof(data);
  const size_t totalLen = kHeaderLen + payloadLen + kCrcLen;
  if (totalLen > sizeof(out.bytes)) return false;

  uint8_t *buf = out.bytes;
  buf[0] = 0xAA;
  buf[1] = (uint8_t)totalLen;
  buf[2] = kCommandRaw;
  buf[3] = kBurnByte;

  size_t offset = kHeaderLen;
  for (size_t i = 0; i < (sizeof(data) / sizeof(data[0])); i++) {
    writeUint32Be(&buf[offset], data[i]);
    offset += 4;
  }

  const uint16_t crc = crcSmartOne(buf, kHeaderLen + payloadLen);
  buf[offset + 0] = (uint8_t)(crc & 0xFF);        // legacy raw: LO then HI
  buf[offset + 1] = (uint8_t)((crc >> 8) & 0xFF);
  out.len = totalLen;

  return true;
}

}  // namespace MessageCodec

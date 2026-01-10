// src/satcom/SatCom.cpp
#include <Arduino.h>
#include <HardwareSerial.h>
#include "satcom/SatCom.h"

// Pins from legacy flight software
static const int SAT_RX_PIN = 46;   // ESP RX  <- SatCom TX
static const int SAT_TX_PIN = 45;   // ESP TX  -> SatCom RX
static const int SAT_HS_PIN = 39;   // handshake / wake

static const uint32_t SAT_BAUD = 9600;

static uint32_t totalRx = 0;
static uint32_t totalTx = 0;

static uint32_t lastPrintMs = 0;
static uint32_t lastRxSnapshot = 0;

static void wakeSat()
{
  digitalWrite(SAT_HS_PIN, LOW);
  delay(70);
  digitalWrite(SAT_HS_PIN, HIGH);
  delay(70);
}

static void drainForMs(uint32_t ms, bool hexDump)
{
  const uint32_t start = millis();
  bool any = false;

  while (millis() - start < ms) {
    while (Serial2.available()) {
      uint8_t b = (uint8_t)Serial2.read();
      totalRx++;
      any = true;
      if (hexDump) Serial.printf("%02X ", b);
    }
    delay(2);
  }

  if (hexDump) {
    if (!any) Serial.print("(no bytes)");
    Serial.println();
  }
}

// -------- Packet read helper (AA LEN ... CRC) --------
static bool readPacket(uint8_t *buf, size_t bufMax, size_t &outLen, uint32_t timeoutMs)
{
  outLen = 0;

  // Find 0xAA start
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    if (Serial2.available()) {
      uint8_t b = (uint8_t)Serial2.read();
      totalRx++;
      if (b == 0xAA) {
        buf[outLen++] = b;
        break;
      }
    }
    delay(1);
  }
  if (outLen == 0) return false;

  // Read LEN
  t0 = millis();
  while (millis() - t0 < timeoutMs) {
    if (Serial2.available()) {
      buf[outLen++] = (uint8_t)Serial2.read();
      totalRx++;
      break;
    }
    delay(1);
  }
  if (outLen < 2) return false;

  const uint8_t totalLen = buf[1];
  if (totalLen < 5 || totalLen > bufMax) return false;

  // Read rest
  while (outLen < totalLen && (millis() - t0 < timeoutMs)) {
    while (Serial2.available() && outLen < totalLen) {
      buf[outLen++] = (uint8_t)Serial2.read();
      totalRx++;
    }
    delay(1);
  }

  return (outLen == totalLen);
}

// -------- CRC helper (same algo as your legacy code) --------
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
  crc = ~crc;
  return crc;
}

// -------- Documented command sender (AA LEN CMD ... CRC) --------
// NOTE: For SmartOne documented commands, do NOT pulse HS low during write.
// Also: give it extra settle time after wake.
static void sendCmd(uint8_t cmd, const uint8_t *payload, size_t payloadLen)
{
  uint8_t msg[64];
  const size_t headerLen = 3; // AA, LEN, CMD
  const size_t crcLen    = 2;

  const uint8_t totalLen = (uint8_t)(headerLen + payloadLen + crcLen);
  if (totalLen > sizeof(msg)) return;

  msg[0] = 0xAA;
  msg[1] = totalLen;
  msg[2] = cmd;

  if (payloadLen && payload) memcpy(&msg[3], payload, payloadLen);

  const uint16_t crc = crcSmartOne(msg, headerLen + payloadLen);

  // Keep your current ordering (HI then LO)
  msg[headerLen + payloadLen + 0] = (uint8_t)((crc >> 8) & 0xFF);
  msg[headerLen + payloadLen + 1] = (uint8_t)(crc & 0xFF);

  wakeSat();
  delay(150); // <-- KEY: settle time after wake for command mode

  // IMPORTANT: keep HS HIGH during documented command send
  digitalWrite(SAT_HS_PIN, HIGH);
  delay(2);

  Serial2.write(msg, totalLen);
  Serial2.flush();

  totalTx += totalLen;

  Serial.print("[SAT] TX: ");
  for (size_t i = 0; i < totalLen; i++) Serial.printf("%02X ", msg[i]);
  Serial.println();
}

void SatCom::begin()
{
  pinMode(SAT_HS_PIN, OUTPUT);
  digitalWrite(SAT_HS_PIN, HIGH);

  Serial2.end();
  delay(50);
  Serial2.setRxBufferSize(4096);
  Serial2.begin(SAT_BAUD, SERIAL_8N1, SAT_RX_PIN, SAT_TX_PIN);

  Serial.printf("[SAT] Serial2 @%lu RX=%d TX=%d HS=%d\n",
                (unsigned long)SAT_BAUD, SAT_RX_PIN, SAT_TX_PIN, SAT_HS_PIN);

  lastPrintMs = millis();
  lastRxSnapshot = totalRx;
}

void SatCom::poll()
{
  // Drain incoming bytes quietly
  while (Serial2.available()) {
    (void)Serial2.read();
    totalRx++;
  }

  // Once per second summary
  const uint32_t now = millis();
  if (now - lastPrintMs >= 1000) {
    const uint32_t rxThisSec = totalRx - lastRxSnapshot;
    lastRxSnapshot = totalRx;
    lastPrintMs = now;

    Serial.printf("[SAT] rxBytes/s=%lu totalRx=%lu totalTx=%lu\n",
                  (unsigned long)rxThisSec,
                  (unsigned long)totalRx,
                  (unsigned long)totalTx);
  }
}

// Your old raw payload exercise (0x27 frame)
// Keep it if you want, but it is NOT a “status/query” command.
static void sendRaw27(const uint8_t *payload, size_t payloadLen)
{
  uint8_t msg[64];
  const uint8_t headerLen = 4;
  const uint8_t crcLen = 2;

  const uint8_t totalLen = (uint8_t)(headerLen + payloadLen + crcLen);
  if (totalLen > sizeof(msg)) return;

  msg[0] = 0xAA;
  msg[1] = totalLen;
  msg[2] = 0x27;
  msg[3] = 0x00;

  memcpy(&msg[4], payload, payloadLen);

  const uint16_t crc = crcSmartOne(msg, headerLen + payloadLen);

  // legacy raw used LO then HI — keep it exactly as you had it
  msg[headerLen + payloadLen + 0] = (uint8_t)(crc & 0xFF);
  msg[headerLen + payloadLen + 1] = (uint8_t)((crc >> 8) & 0xFF);

  wakeSat();
  digitalWrite(SAT_HS_PIN, LOW);
  delay(3);
  Serial2.write(msg, totalLen);
  Serial2.flush();
  digitalWrite(SAT_HS_PIN, HIGH);

  totalTx += totalLen;
  Serial.printf("[SAT] sent raw27 len=%u\n", totalLen);
}

void SatCom::ping()
{
  Serial.println("[SAT] ping()");

  const uint8_t payload[] = {0xDE, 0xAD, 0xBE, 0xEF};
  sendRaw27(payload, sizeof(payload));

  Serial.println("[SAT] listening 1000ms for response (hex)...");
  drainForMs(1000, true);
}

void SatCom::getIdAndPrint()
{
  Serial.println("[SAT] getId (0x01) ...");

  for (int attempt = 1; attempt <= 5; attempt++) {
    Serial.printf("[SAT] attempt %d\n", attempt);

    sendCmd(0x01, nullptr, 0);

    uint8_t rx[64];
    size_t n = 0;
    if (!readPacket(rx, sizeof(rx), n, 1500)) {
      Serial.println("[SAT] getId: no response packet");
      delay(250);
      continue;
    }

    Serial.print("[SAT] RX: ");
    for (size_t i = 0; i < n; i++) Serial.printf("%02X ", rx[i]);
    Serial.println();

    const uint8_t cmd = rx[2];
    Serial.printf("[SAT] rsp cmd=0x%02X len=%u\n", cmd, (unsigned)rx[1]);

    // NAK/busy → retry
    if (cmd == 0xFF) {
      delay(400);
      continue;
    }

    if (cmd == 0x01 && rx[1] == 0x09) {
      uint32_t id =
        ((uint32_t)rx[3] << 24) |
        ((uint32_t)rx[4] << 16) |
        ((uint32_t)rx[5] <<  8) |
        ((uint32_t)rx[6] <<  0);

      Serial.printf("[SAT] SmartOne ID (ESN int) = %lu (0x%08lX)\n",
                    (unsigned long)id, (unsigned long)id);
      return;
    }

    Serial.println("[SAT] getId: unexpected response format");
    return;
  }

  Serial.println("[SAT] getId: giving up after retries");
}

void SatCom::queryAndHexDump(uint8_t cmd, const uint8_t *payload, size_t payloadLen, uint32_t timeoutMs)
{
  Serial.printf("[SAT] query cmd=0x%02X ...\n", cmd);

  sendCmd(cmd, payload, payloadLen);

  uint8_t rx[128];
  size_t n = 0;
  if (!readPacket(rx, sizeof(rx), n, timeoutMs)) {
    Serial.println("[SAT] query: no response packet");
    return;
  }

  Serial.printf("[SAT] rsp (%u bytes): ", (unsigned)n);
  for (size_t i = 0; i < n; i++) Serial.printf("%02X ", rx[i]);
  Serial.println();
}
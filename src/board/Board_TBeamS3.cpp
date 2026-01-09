// src/board/Board_TBeamS3.cpp
#include "board/Board_TBeamS3.h"
#include <Arduino.h>
#include <Wire.h>
#include <XPowersLib.h>

// Shared I2C bus (OLED + PMU)
static const int I2C_SDA = 17;
static const int I2C_SCL = 18;

static XPowersAXP2101 s_pmu;
static bool s_pmu_ok = false;
static bool s_gnss_enabled = false;

bool Board_TBeamS3::pmuOk() { return s_pmu_ok; }

void Board_TBeamS3::enableGnss()
{
  if (!s_pmu_ok || s_gnss_enabled) return;

  // T-Beam S3 Supreme commonly powers GNSS from ALDO3
  s_pmu.setALDO3Voltage(3300);
  s_pmu.enableALDO3();

  // Confirm rail state (prints are your proof, not LEDs)
  Serial.printf("[PMU] ALDO3 enabled=%d voltage=%u\n",
                (unsigned)s_pmu.getALDO3Voltage());

  s_gnss_enabled = true;
}

void Board_TBeamS3::earlyBegin()
{
  Serial.println("[BOARD] earlyBegin()");

  Wire.begin(I2C_SDA, I2C_SCL);

  Serial.println("[PMU] probing...");
  s_pmu_ok = s_pmu.begin(Wire, AXP2101_SLAVE_ADDRESS, I2C_SDA, I2C_SCL);
  Serial.printf("[PMU] begin=%s\n", s_pmu_ok ? "OK" : "FAIL");

  if (!s_pmu_ok) {
    Serial.println("[BOARD] ERROR: AXP2101 not detected");
    return;
  }

  Serial.printf("[PMU] Chip ID: 0x%02X\n", s_pmu.getChipID());

  enableGnss();
}

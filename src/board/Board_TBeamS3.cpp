// src/board/Board_TBeamS3.cpp

#include "board/Board_TBeamS3.h"
#include <Arduino.h>
#include <Wire.h>
#include <XPowersLib.h>

// -----------------------------------------------------------------------------
// I2C buses
// -----------------------------------------------------------------------------

// Shared I2C bus: OLED / BME280 / misc sensors
static const int I2C_SDA = 17;
static const int I2C_SCL = 18;

// Dedicated PMU bus (AXP2101) on T-Beam S3 Supreme
static const int PMU_SDA = 42;
static const int PMU_SCL = 41;
static TwoWire PMUWire(1);

// -----------------------------------------------------------------------------
// PMU state
// -----------------------------------------------------------------------------

static XPowersAXP2101 s_pmu;
static bool s_pmu_ok = false;
static bool s_gnss_enabled = false;

bool Board_TBeamS3::pmuOk()
{
  return s_pmu_ok;
}

XPowersAXP2101 *Board_TBeamS3::pmu()
{
  return s_pmu_ok ? &s_pmu : nullptr;
}

// -----------------------------------------------------------------------------
// GNSS power control
// -----------------------------------------------------------------------------

void Board_TBeamS3::enableGnss()
{
  if (!s_pmu_ok || s_gnss_enabled) return;

  Serial.println("[PMU] enabling GNSS rail (ALDO4 -> 3300mV)");

  const bool v_ok = s_pmu.setALDO4Voltage(3300);
  const bool e_ok = s_pmu.enableALDO4();

  Serial.printf(
    "[PMU] setALDO4Voltage=%s enableALDO4=%s\n",
    v_ok ? "OK" : "FAIL",
    e_ok ? "OK" : "FAIL"
  );

  s_gnss_enabled = true;
}

// -----------------------------------------------------------------------------
// Early board init
// -----------------------------------------------------------------------------

void Board_TBeamS3::earlyBegin()
{
  Serial.println("[PMU] earlyBegin()");

  // Bring up BOTH I2C buses (this fixes Wire NULL TX buffer errors)
  Wire.begin(I2C_SDA, I2C_SCL);        // OLED / BME / shared devices
  PMUWire.begin(PMU_SDA, PMU_SCL);     // AXP2101 only

  Serial.println("[PMU] probing AXP2101 on PMUWire...");
  const bool ok2101 =
    s_pmu.begin(PMUWire, AXP2101_SLAVE_ADDRESS, PMU_SDA, PMU_SCL);

  Serial.printf(
    "[PMU] AXP2101 @0x%02X = %s\n",
    AXP2101_SLAVE_ADDRESS,
    ok2101 ? "OK" : "FAIL"
  );

  s_pmu_ok = ok2101;

  if (!s_pmu_ok) {
    Serial.println("[PMU] NO PMU FOUND — GNSS UNPOWERED");
    return;
  }

  Serial.printf("[PMU] Chip ID: 0x%02X\n", s_pmu.getChipID());
  enableGnss();
}

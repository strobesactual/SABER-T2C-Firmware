#include "sensors/PMU_AXP2101.h"

#include <Arduino.h>
#include "board/Board_TBeamS3.h"
#include <XPowersLib.h>

namespace {
  bool s_ok = false;
  bool s_batt_present = false;
  bool s_charging = false;
  uint16_t s_batt_mv = 0;
  int s_batt_pct = -1;
}

bool PMU_AXP2101::begin()
{
  if (!Board_TBeamS3::pmuOk()) {
    Serial.println("[PMU] AXP2101 not detected");
    s_ok = false;
    return false;
  }

  XPowersAXP2101 *pmu = Board_TBeamS3::pmu();
  if (!pmu) {
    s_ok = false;
    return false;
  }

  pmu->enableBattVoltageMeasure();
  s_ok = true;
  Serial.println("[PMU] AXP2101 online");
  return true;
}

bool PMU_AXP2101::update()
{
  if (!s_ok) return false;

  XPowersAXP2101 *pmu = Board_TBeamS3::pmu();
  if (!pmu) return false;

  s_batt_present = pmu->isBatteryConnect();
  s_charging = pmu->isCharging();

  if (s_batt_present) {
    s_batt_mv = pmu->getBattVoltage();
    s_batt_pct = pmu->getBatteryPercent();
  } else {
    s_batt_mv = 0;
    s_batt_pct = -1;
  }

  return true;
}

bool PMU_AXP2101::isOnline()
{
  return s_ok;
}

bool PMU_AXP2101::batteryPresent()
{
  return s_batt_present;
}

bool PMU_AXP2101::isCharging()
{
  return s_charging;
}

uint16_t PMU_AXP2101::batteryMv()
{
  return s_batt_mv;
}

int PMU_AXP2101::batteryPercent()
{
  return s_batt_pct;
}

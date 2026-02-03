#include "core/SystemStatus.h"
#include <strings.h>

namespace {
  char s_callsign[8] = "NONE";
  char s_balloonType[16] = "";
  char s_holdState[12] = "HOLD";
  char s_flightState[12] = "GND";
  char s_loraState[12] = "Disabled";
  char s_satcomState[20] = "INIT";
  int s_batteryPct = -1;
  uint8_t s_geoCount = 0;
  bool s_geoOk = true;
  bool s_containedLaunch = false;
}

namespace SystemStatus {

void setCallsign(const char *cs)
{
  if (!cs) cs = "";
  snprintf(s_callsign, sizeof(s_callsign), "%.*s", 6, cs);
}

void setBalloonType(const char *type)
{
  if (!type) type = "";
  const char *trimmed = type;
  if (strncasecmp(type, "SABER-", 6) == 0) trimmed = type + 6;
  snprintf(s_balloonType, sizeof(s_balloonType), "%s", trimmed);
}

void setHoldState(const char *state)
{
  if (!state) state = "";
  snprintf(s_holdState, sizeof(s_holdState), "%s", state);
}

void setFlightState(const char *state)
{
  if (!state) state = "";
  if (strcasecmp(state, "GROUND") == 0 || strcasecmp(state, "GND") == 0) {
    snprintf(s_flightState, sizeof(s_flightState), "GND");
  } else if (strcasecmp(state, "FLIGHT") == 0 || strcasecmp(state, "FLT") == 0) {
    snprintf(s_flightState, sizeof(s_flightState), "FLT");
  } else {
    snprintf(s_flightState, sizeof(s_flightState), "%s", state);
  }
}

void setLoraState(const char *state)
{
  if (!state) state = "";
  snprintf(s_loraState, sizeof(s_loraState), "%s", state);
}

void setSatcomState(const char *state)
{
  if (!state) state = "";
  snprintf(s_satcomState, sizeof(s_satcomState), "%s", state);
}

void setBatteryPct(int pct)
{
  s_batteryPct = pct;
}

void setGeoStatus(uint8_t count, bool ok)
{
  s_geoCount = count;
  s_geoOk = ok;
}

void setContainedLaunch(bool inside)
{
  s_containedLaunch = inside;
}

const char *callsign() { return s_callsign; }
const char *balloonType() { return s_balloonType; }
const char *holdState() { return s_holdState; }
const char *flightState() { return s_flightState; }
const char *loraState() { return s_loraState; }
const char *satcomState() { return s_satcomState; }
int batteryPct() { return s_batteryPct; }
uint8_t geoCount() { return s_geoCount; }
bool geoOk() { return s_geoOk; }
bool containedLaunch() { return s_containedLaunch; }

}  // namespace SystemStatus

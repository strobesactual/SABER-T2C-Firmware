#pragma once

#include <Arduino.h>

namespace SystemStatus {

void setCallsign(const char *cs);
void setBalloonType(const char *type);
void setHoldState(const char *state);
void setFlightState(const char *state);
void setLoraState(const char *state);
void setSatcomState(const char *state);
void setBatteryPct(int pct);
void setGeoStatus(uint8_t count, bool ok);
void setContainedLaunch(bool inside);

const char *callsign();
const char *balloonType();
const char *holdState();
const char *flightState();
const char *loraState();
const char *satcomState();
int batteryPct();
uint8_t geoCount();
bool geoOk();
bool containedLaunch();

}  // namespace SystemStatus

#include "mission/MissionController.h"

#include <ArduinoJson.h>
#include <math.h>
#include "core/ConfigStore.h"
#include "core/SystemStatus.h"
#include "display/display.h"
#include "geofence/GeoFence.h"
#include "gps/GPSControl.h"
#include "termination/Termination.h"

namespace {
  ConfigStore s_config("/mission_active.json");

  bool s_test_flight_mode = false;
  bool s_flight_mode = false;
  bool s_test_mode = false;
  bool s_launch_alt_set = false;
  float s_launch_alt_m = 0.0f;
  float s_launch_sum_m = 0.0f;
  uint32_t s_launch_samples = 0;
  uint32_t s_launch_start_ms = 0;
  bool s_hold_ready = false;
  bool s_satcom_verified = false;
  bool s_timer_running = false;
  uint32_t s_timer_start_ms = 0;
  uint32_t s_flight_timer_sec = 0;
  bool s_launch_location_set = false;
  float s_launch_lat = 0.0f;
  float s_launch_lon = 0.0f;
  bool s_test_mode_pending = false;
  uint32_t s_test_mode_request_ms = 0;
  bool s_display_on = true;
  uint32_t s_time_kill_ms = 0;
  uint32_t s_last_config_ms = 0;
  constexpr uint32_t LAUNCH_SAMPLE_MS = 30000;
  constexpr float LAUNCH_THRESHOLD_M = 30.48f; // 100 ft
  constexpr uint32_t TEST_MODE_DELAY_MS = 1000;
}

namespace MissionController {

void begin()
{
  (void)s_config.begin();
  s_flight_mode = false;
  s_test_flight_mode = false;
  s_test_mode = false;
  s_launch_alt_set = false;
  s_launch_alt_m = 0.0f;
  s_launch_sum_m = 0.0f;
  s_launch_samples = 0;
  s_launch_start_ms = 0;
  s_hold_ready = false;
  s_satcom_verified = false;
  s_timer_running = false;
  s_timer_start_ms = 0;
  s_flight_timer_sec = 0;
  s_launch_location_set = false;
  s_launch_lat = 0.0f;
  s_launch_lon = 0.0f;
  s_test_mode_pending = false;
  s_test_mode_request_ms = 0;
  s_display_on = true;
}

void setTestFlightMode(bool enabled)
{
  s_test_flight_mode = enabled;
}

void setTestMode(bool enabled)
{
  if (enabled) {
    s_test_mode_pending = true;
    s_test_mode_request_ms = millis();
  } else {
    s_test_mode = false;
    s_test_mode_pending = false;
  }
}

bool testFlightMode()
{
  return s_test_flight_mode;
}

bool testModeActive()
{
  return s_test_mode;
}

bool flightModeActive()
{
  return s_flight_mode;
}

uint32_t flightTimerSeconds()
{
  return s_flight_timer_sec;
}

bool launchLocationSet()
{
  return s_launch_location_set;
}

float launchLatitude()
{
  return s_launch_lat;
}

float launchLongitude()
{
  return s_launch_lon;
}

float launchAltitudeMeters()
{
  return s_launch_alt_m;
}

static void refreshConfig(uint32_t now_ms)
{
  if (now_ms - s_last_config_ms < 3000) {
    return;
  }
  s_last_config_ms = now_ms;
  StaticJsonDocument<256> cfg;
  if (!s_config.load(cfg)) {
    s_time_kill_ms = 0;
    return;
  }
  const uint32_t time_kill_min = cfg["time_kill_min"] | 0;
  s_time_kill_ms = time_kill_min * 60000UL;
  s_satcom_verified = cfg["satcom_verified"] | false;
}

void update(uint32_t now_ms)
{
  refreshConfig(now_ms);

  if (!s_launch_alt_set && GPSControl::hasFix()) {
    if (s_launch_start_ms == 0) {
      s_launch_start_ms = now_ms;
    }
    const float alt_m = GPSControl::altitudeMeters();
    if (isfinite(alt_m)) {
      s_launch_sum_m += alt_m;
      s_launch_samples++;
    }
    if (now_ms - s_launch_start_ms >= LAUNCH_SAMPLE_MS && s_launch_samples > 0) {
      s_launch_alt_m = s_launch_sum_m / static_cast<float>(s_launch_samples);
      s_launch_alt_set = true;
      const float lat = GPSControl::latitude();
      const float lon = GPSControl::longitude();
      if (isfinite(lat) && isfinite(lon)) {
        s_launch_lat = lat;
        s_launch_lon = lon;
        s_launch_location_set = true;
      }
    }
  }

  const bool above_launch = s_launch_alt_set &&
    GPSControl::hasFix() &&
    GPSControl::altitudeMeters() > (s_launch_alt_m + LAUNCH_THRESHOLD_M);
  const bool next_flight_mode = s_test_flight_mode || above_launch;
  if (next_flight_mode != s_flight_mode) {
    s_flight_mode = next_flight_mode;
    if (s_flight_mode) {
      if (!s_timer_running) {
        s_timer_running = true;
        s_timer_start_ms = now_ms;
      }
      display_set_flight_state("FLIGHT");
      SystemStatus::setFlightState("FLIGHT");
    } else {
      s_timer_running = false;
      s_timer_start_ms = 0;
      s_flight_timer_sec = 0;
      display_set_flight_state("GROUND");
      SystemStatus::setFlightState("GROUND");
    }
    display_show_status();
  }

  if (s_timer_running) {
    s_flight_timer_sec = (now_ms - s_timer_start_ms) / 1000UL;
  }

  if (s_test_mode_pending && (now_ms - s_test_mode_request_ms >= TEST_MODE_DELAY_MS)) {
    s_test_mode = true;
    s_test_mode_pending = false;
  }

  const bool should_display_on = !s_flight_mode || s_test_mode;
  if (should_display_on != s_display_on) {
    s_display_on = should_display_on;
    display_set_power(s_display_on);
    if (s_display_on) {
      display_show_status();
    }
  }

  const bool ready_now = s_launch_alt_set && s_satcom_verified && GPSControl::hasFix();
  if (ready_now != s_hold_ready) {
    s_hold_ready = ready_now;
    if (s_hold_ready) {
      display_set_hold_state("READY");
      SystemStatus::setHoldState("READY");
    } else {
      display_set_hold_state("HOLD");
      SystemStatus::setHoldState("HOLD");
    }
    display_show_status();
  }

  if (GeoFence::forcedViolation()) {
    display_set_geo(GeoFence::ruleCount(), false);
    SystemStatus::setGeoStatus(GeoFence::ruleCount(), false);
    display_show_status();
    Termination::trigger("forced geofence violation");
    GeoFence::setForcedViolation(false);
  }

  if (s_timer_running && s_time_kill_ms > 0 && !Termination::triggered()) {
    const uint32_t elapsed = now_ms - s_timer_start_ms;
    if (elapsed >= s_time_kill_ms) {
      Termination::trigger("flight timer elapsed");
    }
  }
}

}  // namespace MissionController

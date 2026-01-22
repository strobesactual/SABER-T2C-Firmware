#include "mission/MissionController.h"

#include <ArduinoJson.h>
#include "core/ConfigStore.h"
#include "core/SystemStatus.h"
#include "display/display.h"
#include "geofence/GeoFence.h"
#include "termination/Termination.h"

namespace {
  ConfigStore s_config("/mission_active.json");

  bool s_test_flight_mode = false;
  bool s_flight_mode = false;
  bool s_timer_running = false;
  uint32_t s_timer_start_ms = 0;
  uint32_t s_time_kill_ms = 0;
  uint32_t s_last_config_ms = 0;
}

namespace MissionController {

void begin()
{
  (void)s_config.begin();
}

void setTestFlightMode(bool enabled)
{
  s_test_flight_mode = enabled;
}

bool testFlightMode()
{
  return s_test_flight_mode;
}

bool flightModeActive()
{
  return s_flight_mode;
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
}

void update(uint32_t now_ms)
{
  refreshConfig(now_ms);

  const bool next_flight_mode = s_test_flight_mode;
  if (next_flight_mode != s_flight_mode) {
    s_flight_mode = next_flight_mode;
    if (s_flight_mode) {
      s_timer_running = true;
      s_timer_start_ms = now_ms;
      display_set_flight_state("FLIGHT");
      SystemStatus::setFlightState("FLIGHT");
    } else {
      s_timer_running = false;
      display_set_flight_state("GROUND");
      SystemStatus::setFlightState("GROUND");
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

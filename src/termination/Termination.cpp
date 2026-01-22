#include "termination/Termination.h"

namespace {
  constexpr uint8_t kRelayPin = 3;
  constexpr uint32_t kRelayDurationMs = 5000;
  constexpr uint8_t kRelayOnLevel = HIGH;
  constexpr uint8_t kRelayOffLevel = LOW;

  bool s_triggered = false;
  bool s_pinInit = false;
  String s_reason;

  void ensureRelayReady()
  {
    if (s_pinInit) {
      return;
    }
    pinMode(kRelayPin, OUTPUT);
    digitalWrite(kRelayPin, kRelayOffLevel);
    s_pinInit = true;
  }
}

void Termination::trigger(const char *reason)
{
  ensureRelayReady();
  s_triggered = true;
  s_reason = reason ? reason : "";
  digitalWrite(kRelayPin, kRelayOnLevel);
  delay(kRelayDurationMs);
  digitalWrite(kRelayPin, kRelayOffLevel);
}

bool Termination::triggered()
{
  return s_triggered;
}

const char *Termination::reason()
{
  return s_reason.c_str();
}

void Termination::reset()
{
  s_triggered = false;
  s_reason = "";
}

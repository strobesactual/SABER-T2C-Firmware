#include "termination/Termination.h"

namespace {
  bool s_triggered = false;
  String s_reason;
}

void Termination::trigger(const char *reason)
{
  s_triggered = true;
  s_reason = reason ? reason : "";
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

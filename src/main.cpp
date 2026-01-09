#include <Arduino.h>
#include "ui/PortalServer.h"
#include "display/display.h"

static uint32_t bootStartMs = 0;
static uint32_t lastProgressMs = 0;
static uint8_t  bootPct = 0;
static bool     statusShown = false;

void setup() {
  PortalServer::begin();
  display_init();

  display_show_boot();
  bootStartMs = millis();
  lastProgressMs = bootStartMs;
  bootPct = 0;
  display_update_boot(bootPct);
}

void loop() {
  // IMPORTANT: keep the portal running (uncomment the correct one that exists)
  // PortalServer::loop();
  // PortalServer::tick();
  // PortalServer::handle();

  const uint32_t now = millis();

  if (!statusShown) {
    if (now - lastProgressMs >= 50) {
      lastProgressMs = now;
      if (bootPct < 100) bootPct++;
      display_update_boot(bootPct);
    }

    if (now - bootStartMs >= 5000) {
      statusShown = true;
      display_show_status();
    }
  }
}
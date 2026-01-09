#pragma once
#include <Arduino.h>

void display_init();
void display_show_boot();
void display_update_boot(uint8_t percent);
void display_show_status();

void display_set_callsign(const char *cs);
void display_set_gps(bool fix, uint8_t sats);
void display_set_satcom(const char *state);
void display_set_lora(const char *state);
void display_set_battery(uint8_t pct);
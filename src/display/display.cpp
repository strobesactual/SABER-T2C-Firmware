#include "display.h"
#include <Wire.h>
#include <U8g2lib.h>
#include "kyberdyne_logo.h"

// ---- I2C pins (adjust only here) ----
#define I2C_SDA 17
#define I2C_SCL 18

// ---- Display ----
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

// ---- Logo dimensions (match how you generated kyberdyne_logo.h) ----
static constexpr int LOGO_W = 128;
static constexpr int LOGO_H = 32;

// ---- State ----
static const char *callsign = "UNKNOWN";
static bool gpsFix = false;
static uint8_t gpsSats = 0;
static const char *satcom = "INIT";
static const char *lora = "INIT";
static uint8_t batteryPct = 0;

void display_init()
{
    Wire.begin(I2C_SDA, I2C_SCL);
    u8g2.begin();
    u8g2.setPowerSave(0);
}

void display_show_boot()
{
    u8g2.clearBuffer();

    // Draw logo centered horizontally at top
    int x = (128 - LOGO_W) / 2;
    u8g2.drawXBMP(x, 0, LOGO_W, LOGO_H, kyberdyne_logo_bitmap);

    // Text under logo
    u8g2.setFont(u8g2_font_6x12_tf);
    u8g2.drawStr(0, 46, "SABER T2C v3.0");

    u8g2.sendBuffer();
}

void display_update_boot(uint8_t percent)
{
    if (percent > 100) percent = 100;

    char buf[24];
    snprintf(buf, sizeof(buf), "Booting %u%%", percent);

    // Clear only the bottom area where the progress lives (keep logo + version)
    u8g2.setDrawColor(0);
    u8g2.drawBox(0, 50, 128, 14);
    u8g2.setDrawColor(1);

    // Progress label
    u8g2.setFont(u8g2_font_6x12_tf);
    u8g2.drawStr(0, 60, buf);

    // Progress bar above the label
    u8g2.drawFrame(0, 50, 128, 10);
    int fill = (percent * 124) / 100;
    u8g2.drawBox(2, 52, fill, 6);

    u8g2.sendBuffer();
}

void display_show_status()
{
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x12_tf);

    char l1[32]; snprintf(l1, sizeof(l1), "ID: %s", callsign);
    char l2[32]; snprintf(l2, sizeof(l2), "GPS: %s %u", gpsFix ? "Good" : "No Fix", gpsSats);
    char l3[32]; snprintf(l3, sizeof(l3), "SATCOM: %s", satcom);
    char l4[32]; snprintf(l4, sizeof(l4), "LoRa: %s", lora);
    char l5[32]; snprintf(l5, sizeof(l5), "BAT: %u%%", batteryPct);

    u8g2.drawStr(0, 12, l1);
    u8g2.drawStr(0, 24, l2);
    u8g2.drawStr(0, 36, l3);
    u8g2.drawStr(0, 48, l4);
    u8g2.drawStr(0, 60, l5);

    u8g2.sendBuffer();
}

// ---- setters ----
void display_set_callsign(const char *cs) { callsign = cs; }
void display_set_gps(bool fix, uint8_t sats) { gpsFix = fix; gpsSats = sats; }
void display_set_satcom(const char *s) { satcom = s; }
void display_set_lora(const char *s) { lora = s; }
void display_set_battery(uint8_t p) { batteryPct = p; }
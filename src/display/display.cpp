#include "display/display.h"
#include <Wire.h>
#include <U8g2lib.h>
#include "display/kyberdyne_logo.h"

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
    u8g2.drawStr(0, 46, "SABER T2C v3.0 GPS TESTING");

    u8g2.sendBuffer();
}

void display_update_boot(uint8_t pct)
{
    u8g2.clearBuffer();

    // Logo (top half)
    u8g2.drawXBMP(0, 0, 128, 32, kyberdyne_logo_bitmap);

    u8g2.setFont(u8g2_font_6x12_tf);
    u8g2.drawStr(0, 42, "SABER T2C v3.0 GPS TEST");

    // ---- Boot line ----
    // Baseline for text line
    const uint8_t yText = 58;

    // "Booting" + percent
    char bootBuf[20];
    snprintf(bootBuf, sizeof(bootBuf), "Booting %u%%", (unsigned)pct);
    u8g2.drawStr(0, yText, bootBuf);

    // ---- Progress bar to the right of text ----
    // Approx text width: 6px per char for this font
    // "Booting 100%" is 12 chars -> ~72px. We’ll start bar after that.
    const uint8_t barX = 78;
    const uint8_t barW = 48;
    const uint8_t barH = 10;
    const uint8_t barY = yText - barH + 2;  // align bar with text line

    u8g2.drawFrame(barX, barY, barW, barH);
    uint8_t fill = (pct * (barW - 2)) / 100;
    u8g2.drawBox(barX + 1, barY + 1, fill, barH - 2);

    u8g2.sendBuffer();
}

void display_show_status()
{
    const uint8_t xLabel = 0;
    const uint8_t xVal   = 45;

    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_6x12_tf);

    u8g2.drawStr(xLabel, 12, "ID:");
    u8g2.drawStr(xVal,   12, callsign);

    u8g2.drawStr(xLabel, 24, "GPS:");
    char gpsBuf[16];
    snprintf(gpsBuf, sizeof(gpsBuf), "%s %u",
             gpsFix ? "Good" : "No Fix", gpsSats);
    u8g2.drawStr(xVal, 24, gpsBuf);

    u8g2.drawStr(xLabel, 36, "SATCOM:");
    u8g2.drawStr(xVal,   36, satcom);

    u8g2.drawStr(xLabel, 48, "LoRa:");
    u8g2.drawStr(xVal,   48, lora);

    u8g2.drawStr(xLabel, 60, "BAT:");
    char batBuf[8];
    snprintf(batBuf, sizeof(batBuf), "%u%%", batteryPct);
    u8g2.drawStr(xVal, 60, batBuf);

    u8g2.sendBuffer();
}

// ---- setters ----
void display_set_callsign(const char *cs) { callsign = cs; }
void display_set_gps(bool fix, uint8_t sats) { gpsFix = fix; gpsSats = sats; }
void display_set_satcom(const char *s) { satcom = s; }
void display_set_lora(const char *s) { lora = s; }
void display_set_battery(uint8_t p) { batteryPct = p; }
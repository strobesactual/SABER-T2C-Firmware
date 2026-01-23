#include "display/display.h"
#include <Wire.h>
#include <strings.h>
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
static char callsignBuf[8] = "NONE";
static const char *callsign = callsignBuf;
static bool gpsFix = false;
static uint8_t gpsSats = 0;
static const char *satcom = "INIT";
static char satcomBuf[20] = "INIT";
static const char *lora = "Disabled";
static uint8_t batteryPct = 0;
static uint8_t geoCount = 0;
static bool geoOk = true;
static const char *flightState = "GROUND";
static char flightBuf[12] = "GROUND";
static const char *holdState = "HOLD";
static char holdBuf[12] = "HOLD";
static const char *balloonType = "";
static char balloonBuf[16] = "";

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

void display_update_boot(uint8_t pct)
{
    u8g2.clearBuffer();

    // Logo (top half)
    u8g2.drawXBMP(0, 0, 128, 32, kyberdyne_logo_bitmap);

    u8g2.setFont(u8g2_font_6x12_tf);
    u8g2.drawStr(0, 42, "SABER T2C v3.0");

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
    int typeWidth = u8g2.getStrWidth(balloonType);
    if (typeWidth > 0) {
        u8g2.drawStr(128 - typeWidth, 12, balloonType);
    }

    u8g2.drawStr(xLabel, 24, "GPS:");
    char gpsBuf[16];
    snprintf(gpsBuf, sizeof(gpsBuf), "%s %u",
             gpsFix ? "Good" : "No Fix", gpsSats);
    u8g2.drawStr(xVal, 24, gpsBuf);
    int stateWidth = u8g2.getStrWidth(flightState);
    u8g2.drawStr(128 - stateWidth, 24, flightState);

    u8g2.drawStr(xLabel, 36, "SATCOM:");
    u8g2.drawStr(xVal,   36, satcom);

    u8g2.drawStr(xLabel, 48, "LoRa:");
    u8g2.drawStr(xVal,   48, lora);

    u8g2.drawStr(xLabel, 60, "STATUS:");
    int holdWidth = u8g2.getStrWidth(holdState);
    u8g2.drawStr(xVal, 60, holdState);

    char batBuf[8];
    snprintf(batBuf, sizeof(batBuf), "%u%%", batteryPct);
    int batWidth = u8g2.getStrWidth(batBuf);
    int batX = 128 - batWidth;
    u8g2.drawStr(batX, 60, batBuf);

    char geoBuf[10];
    snprintf(geoBuf, sizeof(geoBuf), "%u %c", geoCount, geoOk ? '+' : '-');
    int geoWidth = u8g2.getStrWidth(geoBuf);
    int leftEnd = xVal + holdWidth + 4;
    int rightStart = batX - 4;
    int geoX = leftEnd + (rightStart - leftEnd - geoWidth) / 2;
    if (geoX < leftEnd) geoX = leftEnd;
    if (geoX + geoWidth > rightStart) geoX = rightStart - geoWidth;
    u8g2.drawStr(geoX, 60, geoBuf);

    u8g2.sendBuffer();
}

// ---- setters ----
void display_set_callsign(const char *cs) {
    if (!cs) cs = "";
    snprintf(callsignBuf, sizeof(callsignBuf), "%.*s", 6, cs);
    callsign = callsignBuf;
}
void display_set_gps(bool fix, uint8_t sats) { gpsFix = fix; gpsSats = sats; }
void display_set_satcom(const char *s) {
    if (!s) s = "";
    snprintf(satcomBuf, sizeof(satcomBuf), "%s", s);
    satcom = satcomBuf;
}
void display_set_lora(const char *s) { lora = s; }
void display_set_battery(uint8_t p) { batteryPct = p; }
void display_set_geo(uint8_t count, bool ok) { geoCount = count; geoOk = ok; }
void display_set_flight_state(const char *state) {
    if (!state) state = "";
    if (strcasecmp(state, "GROUND") == 0 || strcasecmp(state, "GND") == 0) {
        snprintf(flightBuf, sizeof(flightBuf), "GND");
    } else if (strcasecmp(state, "FLIGHT") == 0 || strcasecmp(state, "FLT") == 0) {
        snprintf(flightBuf, sizeof(flightBuf), "FLT");
    } else {
        snprintf(flightBuf, sizeof(flightBuf), "%s", state);
        for (size_t i = 0; flightBuf[i] != '\0'; ++i) {
            flightBuf[i] = static_cast<char>(toupper(flightBuf[i]));
        }
    }
    flightState = flightBuf;
}
void display_set_hold_state(const char *state) {
    if (!state) state = "";
    snprintf(holdBuf, sizeof(holdBuf), "%s", state);
    holdState = holdBuf;
}
void display_set_balloon_type(const char *type) {
    if (!type) type = "";
    const char *trimmed = type;
    if (strncasecmp(type, "SABER-", 6) == 0) trimmed = type + 6;
    snprintf(balloonBuf, sizeof(balloonBuf), "%s", trimmed);
    balloonType = balloonBuf;
}

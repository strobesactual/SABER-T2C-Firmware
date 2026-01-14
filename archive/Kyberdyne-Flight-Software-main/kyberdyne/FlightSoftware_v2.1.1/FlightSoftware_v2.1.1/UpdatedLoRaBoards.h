/**
 * @file      boards.h
 * @author    Lewis He (lewishe@outlook.com)
 * @license   MIT
 * @copyright Copyright (c) 2024  ShenZhen XinYuan Electronic Technology Co., Ltd
 * @date      2024-04-25
 * @last-update 2024-08-07
 */

#pragma once


#include "utilities.h"

#ifdef HAS_SDCARD
#include <SD.h>
#endif

#if defined(ARDUINO_ARCH_ESP32)  
#include <FS.h>
#include <WiFi.h>
#endif

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <XPowersLib.h>

#include <esp_mac.h>

#ifndef DISPLAY_MODEL
#define DISPLAY_MODEL           U8G2_SSD1306_128X64_NONAME_F_HW_I2C
#endif

#ifndef OLED_WIRE_PORT
#define OLED_WIRE_PORT          Wire
#endif

#ifndef PMU_WIRE_PORT
#define PMU_WIRE_PORT           Wire
#endif

#ifndef DISPLAY_ADDR
#define DISPLAY_ADDR            0x3C
#endif

#ifndef LORA_FREQ_CONFIG
#define LORA_FREQ_CONFIG        915.0
#endif

enum {
    POWERMANAGE_ONLINE  = _BV(0),
    DISPLAY_ONLINE      = _BV(1),
    RADIO_ONLINE        = _BV(2),
    GPS_ONLINE          = _BV(3),
    PSRAM_ONLINE        = _BV(4),
    SDCARD_ONLINE       = _BV(5),
    AXDL345_ONLINE      = _BV(6),
    BME280_ONLINE       = _BV(7),
    BMP280_ONLINE       = _BV(8),
    BME680_ONLINE       = _BV(9),
    QMC6310_ONLINE      = _BV(10),
    QMI8658_ONLINE      = _BV(11),
    PCF8563_ONLINE      = _BV(12),
    OSC32768_ONLINE      = _BV(13),
};


#define ENABLE_BLE      //Enable ble function

typedef struct {
    String          chipModel;
    float           psramSize;
    uint8_t         chipModelRev;
    uint8_t         chipFreq;
    uint8_t         flashSize;
    uint8_t         flashSpeed;
} DevInfo_t;

////////////////////////////////////////////////
// uncomment this for debugging
// #define SOFTWARE_MODE 2

#ifndef SOFTWARE_MODE
#define SOFTWARE_MODE 1
#endif

// Used to wrap debugging functions so that they are compiled if software_mode == 2
#if SOFTWARE_MODE == 2
    #define DEBUG_BLOCK(code) code
#else
    #define DEBUG_BLOCK(code)
#endif

class Debug
{
public:
    // static Debug& instance();
    void printSatBeforeCRC(const uint8_t* message, size_t len);
    void printCRC(const uint8_t* crc);
    void printFullMessage(uint8_t* final_msg, size_t len);
    void printStartCoords(float* launchCoords);
    void printData(uint32_t enc_time, float* data);
    void printSatCheck(float time_bw, unsigned long interval);
    void printCircGeoFence(bool within, float *startCoords, int checksLeft, float radius, float distance);
    void printZoneGeoFence(float lat, float lng, int i, bool inZone, bool checkingLastZone);
    void printChecksLeft(int checksLeft);
    void printStartMission();
    void printRunMission();
    void printAfterTermination();
    void timerEnded(unsigned long timeElapsed, unsigned long timeLimit);
    void relayTriggered();
};
extern Debug debug;

void setupBoards(bool disable_u8g2 = false);

bool beginSDCard();

bool beginDisplay();

void disablePeripherals();

bool beginPower();

void printResult(bool radio_online);

void flashLed();

void scanDevices(TwoWire *w);

bool beginGPS();

bool recoveryGPS();

void loopPMU(void (*pressed_cb)(void));

void scanWiFi();

#ifdef HAS_PMU
extern XPowersLibInterface *PMU;
extern bool pmuInterrupt;
#endif
extern DISPLAY_MODEL *u8g2;

#define U8G2_HOR_ALIGN_CENTER(t)    ((u8g2->getDisplayWidth() -  (u8g2->getUTF8Width(t))) / 2)
#define U8G2_HOR_ALIGN_RIGHT(t)     ( u8g2->getDisplayWidth()  -  u8g2->getUTF8Width(t))


#if defined(ARDUINO_ARCH_ESP32)

#if defined(HAS_SDCARD)
extern SPIClass SDCardSPI;
#endif

#define SerialGPS Serial1
#elif defined(ARDUINO_ARCH_STM32)
extern HardwareSerial  SerialGPS;
#endif

float getTempForNTC();

void setupBLE();

extern uint32_t deviceOnline;

/**
 * @author    Carson Rendell (carsonj.rendell@gmail.com)
 *            Kyberdyne LLC
 * @date      2025-09-24
 *            Built from LoraBoards architecture created by Lewis He (lewishe@outlook.com)
 *            (see LoraBoards.h for more details)
 */

/*
 TO ENABLE DEBUG MODE: Go to UpdatedLoraBoards.h and uncomment line 83, "#define SOFTWARE_MODE 2"
 */

#include "UpdatedLoRaBoards.h"
#include <TinyGPS++.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

/// @brief Relay object(relayPin, durationInSeconds)
class Relay
{
    unsigned long relayDurationMillis;
    uint8_t relayPin;
    
public:
    /// @param pin TBeam pin number
    /// @param durationInSec Duration in seconds
    

    bool triggered = false; 

    Relay(uint8_t pin, int durationInSec) : relayPin(pin), relayDurationMillis(durationInSec* 1000UL)
    {
        pinMode(relayPin, OUTPUT);
    }

    void trigger()
    {
        digitalWrite(relayPin, HIGH); // relay triggers once timer has ended
        delay(relayDurationMillis);
        digitalWrite(relayPin, LOW);
        triggered = true;

        //debug
        debug.relayTriggered();
    }

};

class OledMessages
{

public:

// individual displays
    void blank()
    {
        u8g2->clearBuffer();
        u8g2->sendBuffer();
    }

    void sdFailed()
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("SD card"));
        u8g2->setCursor(0,27);
        u8g2->print(F("initialization"));
        u8g2->setCursor(0,39);
        u8g2->print(F("failed."));
        u8g2->sendBuffer();

        delay(2500);
        blank();
        delay(500);

        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("Insert SD card"));
        u8g2->setCursor(0,27);
        u8g2->print(F("and restart "));
        u8g2->setCursor(0,39);
        u8g2->print(F("T-Beam."));
        u8g2->sendBuffer();
    }

    void gpsAcquiring()
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("Still acquiring"));
        u8g2->setCursor(0,27);
        u8g2->print(F("GPS..."));
        u8g2->sendBuffer();
    }

    void gpsAcquired()
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("GPS acquired."));
        u8g2->sendBuffer();
    }

    void askStartMessage()
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("Sending data to"));
        u8g2->setCursor(0,29);
        u8g2->print(F("SatCom."));
        u8g2->setCursor(0,49);
        u8g2->print(F("Push button to"));
        u8g2->setCursor(0,63);
        u8g2->print(F("start mission."));
        u8g2->sendBuffer();
    }

    void missionStartedMessage()
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("Mission started."));
        u8g2->setCursor(0,29);
        u8g2->print(F("Timer begun."));
        u8g2->sendBuffer();
    }

    void printTimer(int seconds)
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,50);
        u8g2->print(F("Time remaining (s): "));
        u8g2->setCursor(0,64);
        u8g2->print(seconds);
        u8g2->sendBuffer();
    }

    void flightSoftwareMessage()
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("Running Flight "));
        u8g2->setCursor(0,28);
        u8g2->print(F("Software"));
        u8g2->setCursor(0,41);
        u8g2->print("Version 2.0");
        u8g2->sendBuffer();
    }

    void debugModeMsg()
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("Running in debug"));
        u8g2->setCursor(0,29);
        u8g2->print(F("mode!"));
        u8g2->sendBuffer();
    }

    void geoFenceTriggered(int checks)
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("GeoFence pos."));
        u8g2->setCursor(0,29);
        u8g2->print(F("Checks left:"));
        u8g2->setCursor(0,43);
        u8g2->print(checks);   
        u8g2->sendBuffer();
    }

    void satComPreflightCheck()
    {
        u8g2->clearBuffer();
        u8g2->setFontMode(0);
        u8g2->setFont(u8g2_font_littlemissloudonbold_tr);
        u8g2->setCursor(0,15);
        u8g2->print(F("Press button for"));
        u8g2->setCursor(0,29);
        u8g2->print(F("preflight check."));
        u8g2->sendBuffer();
    }


    // combinations
    void askStartMission()
    {
        blank();
        delay(500);
        askStartMessage();
    }

    void missionStarted()
    {
        blank();
        delay(500);
        missionStartedMessage();
        delay(1500);
        blank();
    }

    void whichSoftware()
    {   
        for(int i = 0; i <= 3; i++)
        {
            blank();
            delay(300);
            // used the structure below to see which mode the software is in w/o checking header
            #if SOFTWARE_MODE == 2
                debugModeMsg();
            #elif SOFTWARE_MODE == 1
                flightSoftwareMessage();
            #endif
            delay(1000);
            blank();
            delay(200);
        }
    }
};

/// @brief MistionTimer object(timeLimitMin, messageIntervalSec)
class MissionTimer
{

public:

    unsigned long startMillis;
    unsigned long timeElapsed;
    unsigned long lastTimeCheck = 0;
    unsigned long timeRemaining;
    unsigned long timeLimit;
    unsigned long interval;
    bool started = false;
    bool ended = false;

    MissionTimer(float limitMin, int intervalSec) 
    {
        timeLimit = (unsigned long)(limitMin * 60.0f * 1000.0f); // minutes * 60s * 1000UL = millis
        interval = (unsigned long)(intervalSec) * 1000UL;
    }

    void start()
    {
        startMillis = millis();
        started = true;
        timeRemaining = timeLimit;
    }

    void check()
    {
        if(!started)
        {
            return;
        }
        
        timeElapsed = millis() - startMillis;

        if(!ended)
        {
            timeRemaining = (timeElapsed >= timeLimit) ? 0 : timeLimit - timeElapsed; // for display purposes only, may remove

            if (timeElapsed >= timeLimit)
            {
                ended = true;

                //debug
                debug.timerEnded(timeElapsed, timeLimit);
            }  
        }
    }
};

/// @brief GPSControl object(launchRadiusInKm)
class GPSControl
{

public:
    OledMessages oled;
    TinyGPSPlus tinygps;

    bool gpsValid = false;
    bool gpsUpdated = false;
    bool lastGpsState = true;
    bool withinGeoFence = true;

    // float rad;
    float lat;
    float lng;
    float alt;
    float time;
    float date;
    float launchCoords[2];

    uint32_t enc_lat;
    uint32_t enc_lng;

    // GPSControl(float launchRadiusInkm) : rad(launchRadiusInkm) {} // user must specify launch radius on object creation
    
    void feedSerial() // gps must be constantly fed values to work. This funciton reduces code repetition
    { 
        while(SerialGPS.available() > 0)
        {
            tinygps.encode(SerialGPS.read());
        }
    }

    void checkGpsAcquired()
    {
        while(!gpsValid)
        {
            feedSerial();
            gpsValid = tinygps.location.isValid();

            if (gpsValid != lastGpsState)
            {
                lastGpsState = gpsValid;
                oled.gpsAcquiring();
            }
        }
        // this block runs once gpsValid = true, or if it's true initially
        oled.blank();
        delay(200);
        oled.gpsAcquired();
        delay(2000);
        oled.blank();
    }

    void getGps()
    {
        feedSerial();
        lat = tinygps.location.lat();
        lng = tinygps.location.lng();
        alt = tinygps.altitude.meters();
        time = tinygps.time.value();
        // date = gps.date.value();
    }

    void setLaunchCoords()
    {
        getGps();
        launchCoords[0] = lat;
        launchCoords[1] = lng;
        
        //debug
        debug.printStartCoords(launchCoords);
    }

    void encodeLatLng(float lat, float lng) 
    {
        enc_lat = (uint32_t)roundf((lat + 90) * 1e5);
        enc_lng = (uint32_t)roundf((lng + 187) * 1e5);
    }


int maxChecks = 15;
int checksLeft = maxChecks;

    void circGeoFence(float *startCoords, float lat, float lng, float rad)
    {
        float R = 6371000; // earth radius [m]

        // convert to rads
        float startLatRad = startCoords[0]*PI/180.0f;
        float startLngRad = startCoords[1]*PI/180.0f;
        float latRad = lat*PI/180.0f;
        float lngRad = lng*PI/180.0f; 

        float delta_lat = latRad - startLatRad;
        float delta_lng = lngRad - startLngRad;

        // haversine formulas
        float a = sq(sin(delta_lat/2.0f)) + cos(latRad)*cos(startLatRad)*sq(sin(delta_lng)/2.0f);
        float c = 2 * atan2(sqrt(a),sqrt(1-a));
        float distance = (R * c)/1000.0f; // [km]

        if (distance > rad)
        {
            checksLeft--;
            withinGeoFence = false;

            //debug
            debug.printGeoFence(withinGeoFence, startCoords, checksLeft, rad, distance);

        } 
        else if(checksLeft < maxChecks || checksLeft == maxChecks)
        {
            checksLeft = min(checksLeft + 1, maxChecks);
            withinGeoFence = true;

            //debug
            debug.printGeoFence(withinGeoFence, startCoords, checksLeft, rad, distance);
        }

    }
};

/// @brief Button object(buttonPin)
class Button
{
    OledMessages oled;
    // GPSControl gps;
    uint8_t startButtonPin;

public:
    /// @param buttonPin TBeam pin for button

    Button(uint8_t pin) : startButtonPin(pin)
    {
        pinMode(startButtonPin, INPUT_PULLUP);
    }
    
    bool pressed()
    {
        static bool waitingForRelease = true;
        if (waitingForRelease) 
        {
        // Button must be released before we can accept a press
            if (digitalRead(startButtonPin) == HIGH) // high is unpressed
            {
                delay(200); // debounce delay
                waitingForRelease = false;  
            }
            return false;
        } 
        else 
        {
        // wait for an intentional press
            if (digitalRead(startButtonPin) == LOW) // low is pressed
            {
                delay(200);
                waitingForRelease = true; // reset for next cycle
                return true;  // valid press detected
            }
        }
        return false;
    }

};

/// @brief SatCom object(rxPin, txPin, handshakePin)
class SatCom
{
    uint8_t rxPin;
    uint8_t txPin;
    uint8_t handshakePin;
public:
    /// @param rxPin rx line pin on TBeam
    /// @param txPin tx line pin on TBeam 
    /// @param handshakePin handshake line pin on TBeam

    SatCom(uint8_t RXPin, uint8_t TXPin, uint8_t handshakePin) : rxPin(RXPin), txPin(TXPin), handshakePin(handshakePin) 
    {
        pinMode(handshakePin, OUTPUT);
        digitalWrite(handshakePin, HIGH);  // start high
    }

    void begin()
    {
        Serial2.begin(9600, SERIAL_8N1, rxPin, txPin); // SmartOne baud, serial mode, rx and tx pins
    }

    /// @brief sendMessage(uint32_t array, int array_length)
    /// @param msg Must be a uint32_t array
    /// @param len 
    // named sendMessage for user, actual send function (trueSendMessage) is private
    void sendMessage(uint32_t* data, size_t len)
    {
        wakeSat();
        convertToBytes(data, len);
    }

    // wakeSat is based on awake protocol in Smart One C documentation
    void wakeSat()
    {
        digitalWrite(handshakePin, LOW);
        delay(70); // documentation says handshake line needs to be set to LOW for at least 60ms to initialize
        digitalWrite(handshakePin, HIGH);
        delay(70); // doc says wait at least 60ms before sending commands
    }

    void waitForResponse() // adjust logic for mission, no printing needed just verification and maybe soft reset?
    {
        unsigned long start = millis();
        bool gotResponse = false;

        while (millis() - start < 500) 
        {
            if (Serial2.available()) 
            {
                uint8_t b = Serial2.read();
                Serial.printf("%02X ", b);
                gotResponse = true;
            }
        }
        if (!gotResponse) 
        {
            Serial.println("No response received.");
        } 
        else 
        {
            Serial.println("\nSmartOne response complete.");
        }
        digitalWrite(handshakePin, HIGH);
    }


/////////////////////////////////////////////////////////////////////////////////////////////////////////

private: 
    // written out for clarity

    // the header array is created in combineHeaderPayload
    const uint8_t headerLength = 4; // 1: 0xAA, 2: msg_len (0x16), 3: 0x27 (for raw msg), 4: 0x00 (burn byte)
    
    const uint8_t crcLength = 2;
    
    uint8_t command = 0x27; // 0x27 is a raw message, per Smart One C documentation

    uint8_t message[200]; // arbitrarily large to handle variable sizes
    uint8_t finalCRC[2]; // low high
    uint8_t finalMessage[200]; 

/////////////////////////////////////////////////////////////////////////////////

    void convertToBytes(uint32_t *data_array, size_t len)
    {
        uint8_t data_bytes[200]; // arbitrarily large. avoids C++ dynamic memory issues
        size_t len_bytes = len * 4;

        for (size_t i = 0; i < len; i++)
        {
            data_bytes[4*i] = (data_array[i] >> 24) & 0xFF;
            data_bytes[4*i + 1] = (data_array[i] >> 16) & 0xFF;
            data_bytes[4*i + 2] = (data_array[i] >> 8) & 0xFF;
            data_bytes[4*i + 3] = data_array[i] & 0xFF;
        }
        combineHeaderPayload(data_bytes, len_bytes);
    }

    void combineHeaderPayload(uint8_t *data_bytes, size_t len_bytes)
    {
        uint8_t msg_len = headerLength + len_bytes;
        uint8_t total_msg_len = headerLength + len_bytes + crcLength; // number of elements * 4 is the length of data in bytes (4, 8-bit numbers from 1 32-bit number)
        
        uint8_t header[] = {0xAA, total_msg_len, command, 0x00};
        
        memcpy(&message[0], header, headerLength);
        memcpy(&message[headerLength], data_bytes, len_bytes);

        //debug
        debug.printSatBeforeCRC(message, msg_len);

        makeCRC(message, msg_len, total_msg_len);
    }

    void makeCRC(uint8_t *msg, uint8_t msg_len, size_t total_msg_len)
    {
        uint8_t i;
        uint16_t data;
        size_t len = msg_len;
        uint16_t crc = 0xFFFF; // initial CRC value in SmartOne C documentation

        while(len--)
        {
            data = 0x00FF & *msg++; // masked conversion from 8-bit to 16-bit
            crc = crc ^ data;

            for (i = 8; i > 0; i--)
            {
                if (crc & 0x0001)
                {
                    crc = (crc >> 1) ^ 0x8408; // 0x8408 is the CRC polynomial for SmartOne C 
                } 
                else
                {
                    crc >>= 1;
                }
            }
        }
        
        crc = ~crc;
        
        finalCRC[0] = crc & 0xFF;
        finalCRC[1] = (crc >> 8) & 0xFF;

        //debug
        debug.printCRC(finalCRC);

        buildFinalMessage(message, msg_len, total_msg_len);
    }

    void buildFinalMessage(uint8_t* msg, int msg_len, size_t total_msg_len)
    {
        memcpy(&finalMessage[0], msg, msg_len);
        memcpy(&finalMessage[msg_len], finalCRC, crcLength);
        trueSendMessage(finalMessage, total_msg_len);
    }

    void trueSendMessage(uint8_t* final_msg, size_t len)
    {
        digitalWrite(handshakePin, LOW);
        delay(3);
        Serial2.write(final_msg, len);
        digitalWrite(handshakePin, HIGH);

        //debug
        debug.printFullMessage(final_msg, len);
    }

};

class TBeam 
{
    // satcom pins
    uint8_t rxPin = 46;
    uint8_t txPin = 45;
    uint8_t handshakePin = 39;

    // relay pin/duration
    uint8_t relayPin = 3;
    uint8_t relayDurationSec = 5;
    
    // button pin
    uint8_t buttonPin = 2;

    // timer
    float timeLimitMin = .5 * 60; // hrs * 60mins
    int msgIntervalSec = 120;
    unsigned long lastSend = 0; // for sat check, which doesn't rely on timer

    // gps
    float radiusKm = 50.0f;

    // sensor data
    float temp;
    float press;

public:
    GPSControl gps;
    MissionTimer timer;
    Relay relay;
    Button button;
    OledMessages oled;
    Adafruit_BME280 bme;
    SatCom sat;

    TBeam() : relay(relayPin,relayDurationSec), button(buttonPin), timer(timeLimitMin,msgIntervalSec), sat(rxPin, txPin, handshakePin) {}

    void init()
    {
        bme.begin();
        sat.begin();
    }

    void satCheck()
    {
        bool satCheckStart = false;
        bool finishedChecking = false;
        oled.satComPreflightCheck();
        while(!satCheckStart)
        {
            gps.feedSerial(); // keeps gps fresh if avionics is sitting
            if(button.pressed())
            {
                satCheckStart = true;
                oled.blank();
            }
        }

        oled.askStartMission();

        while(!finishedChecking)
        {
            
            while(!button.pressed())
            {
                gps.feedSerial();
                
                if(millis() - lastSend >= timer.interval)
                {
                    float bw_msg = (float)((millis() - lastSend)/1000UL); //convert to float for printing
                    //debug
                    debug.printSatCheck(bw_msg, timer.interval);

                    readAndSendData();
                    lastSend = millis();
                }
            }
            oled.blank();
            finishedChecking = true;
        }

    }

    // displays start message, grabs initial launch coords, and starts timer
    void startMission()
    {
        //debug
        debug.printStartMission();

        oled.missionStarted();
        gps.setLaunchCoords();
        timer.start();
    }

    void readAndSendData()
    {
        gps.getGps();
        temp = bme.readTemperature() + 273.15; // kelvin
        press = bme.readPressure() / 1000; // hectoPascals

        float raw_data[] = {gps.lat, gps.lng, gps.alt, temp, press}; // for debugging

        // encode
        uint32_t enc_time = gps.time; // gps time is already read as uint32_t
        uint32_t enc_lat = (uint32_t)roundf((gps.lat + 90.0f) * 1e5f); // storing up to 5th decimal place for ~1m accuracy
        // uint32_t enc_lat = (uint32_t)roundf((msgIntervalSec + 90.0f) * 1e5f); // for testing message drop rates at different intervals
        uint32_t enc_lng = (uint32_t)roundf((gps.lng + 180.0f) * 1e5f);
        uint32_t enc_alt = (uint32_t)roundf((gps.alt + 200) * 1e2f); // storing up to 2nd decimal place for ~cm precision
        uint32_t enc_temp = (uint32_t)roundf(temp* 1e2f);
        uint32_t enc_press = (uint32_t)roundf(press* 1e2);

        uint32_t data[] = {enc_time, enc_lat, enc_lng, enc_alt, enc_temp, enc_press};
        size_t len = sizeof(data)/sizeof(data[0]);

        //debug
        debug.printData(enc_time, raw_data);
        sat.sendMessage(data,len);
        
        // uint32_t blank_data[] = {0, 0, 0, 0, 0, 0};
        // sat.sendMessage(blank_data,6);
        //debug (should be moved to actual debug class)
        // sat.waitForResponse();
    }

    void runMission()
    {
        gps.feedSerial();
        timer.check();

        if(timer.timeElapsed - timer.lastTimeCheck >= timer.interval)
        {
            timer.lastTimeCheck = timer.timeElapsed;
            
            //debug
            debug.printRunMission();

            gps.feedSerial(); // unfortunately required for time.isUpdated, so called twice
            if (gps.tinygps.time.isUpdated())
            {
                readAndSendData(); // feedSerial is in getGps, called here
                gps.circGeoFence(gps.launchCoords, gps.lat, gps.lng, radiusKm);
            } 
        }


        if((gps.checksLeft == 0 || timer.ended) && !relay.triggered)
        {
            relay.trigger();
        }
    }

    // gets rid of geofence check to save some computation, otherwise same as runMission
    void missionAfterTermination()
    {
        gps.feedSerial();
        timer.check();

        if(timer.timeElapsed - timer.lastTimeCheck >= timer.interval)
        {
            timer.lastTimeCheck = timer.timeElapsed;

            //debug
            debug.printAfterTermination();
            
            gps.feedSerial();
            if (gps.tinygps.time.isUpdated())
            {
                readAndSendData();
            }
        }
    }
};

TBeam tbeam;

void setup()
{
    setupBoards();
    
    tbeam.init();
    tbeam.oled.whichSoftware();
    tbeam.gps.checkGpsAcquired();
    tbeam.satCheck();
    tbeam.startMission();
}

void loop()
{
    while(!tbeam.relay.triggered)
    {
        tbeam.runMission();
    }
    tbeam.missionAfterTermination();
}

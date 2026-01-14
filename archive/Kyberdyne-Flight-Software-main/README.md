## Kyberdyne Flight Software Repository
This github contains the latest flight software for Kyberdyne's avionics system. It is built off the LilyGoLoRa repository, found here: https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series

## T-Beam Flight Software V2.1.1 Hot Fix (10-16-25):
- adjusted zoneGeoFence logic to run on a global checksLeft variable. checksLeft counts down any time the T-Beam is inside a geofence, and counts up if it is not inside any geofences. This fixed an issue in which the T-Beam could stay in geofences longer than the maximum allowed if it was hopping between multiple zones.

## T-Beam Flight Software V2.1 Patch Notes (10-14-25):
1. **Added proper geofence**
  - In GPSControl class, 3 new functions control the new geofence system:
  - 1. **is_inside_algorithm**
      - Ray casting function which determines if a point is inside a geometry
  - 2. **checkZone**
      - Calls is_inside. If TBeam is inside a geofence zone, reduces a counter and stores the Last Known Zone, to be checked first next cycle. If TBeam is outside a geofence zone, the counter ticks back up. If the counter for any geofence is zero, it triggers mission termination
  - 3. **zoneGeoFence**
      - Mainly passes values into the previous two functions. Also resets some key variables.
  - Along with the new geofence, a new **setMaxChecks** function has been made to set the maximum number of checks a zone has before it can reduce to zero and trigger termination. The default number of checks is set to 5, set in GeoFenceData.cpp
2. **New GeoFenceData header and source files**
  - These new files contain the geofence data, currently for Utah. These have been placed in a source file so that we can control which zones are compiled using macros. System is work in progress. Currently only UTAH is defined.
  - Data is stored in a structure called **GeoFenceStructure**, which contains the geofence polygon, the number of edges in said polygon, the upper altitude limit, and the number of checks left for that zone. 
  - An array of pointers to all of the structures, called **allGeos**, is also initialized here. This is the variable that is passed into zoneGeoFence, as well as the total number of zones. 


## T-Beam Flight Software V2.0 Patch Notes:
1. Added **DEBUG MODE**
    - Debug mode will print statements to the terminal to verify proper functioning. These
      are contained within a Debug class that is stored in the LoraBoards.h and .cpp files.
    - When debug mode is inactive, these print statments will not compile and the software
      will be in flight mode.
    - **TO CHANGE TO DEBUG MODE**: Go into the LoraBoards.h header file and uncomment **line 83, "#define SOFTWARE_MODE 2"**. 
      If SOFTWARE_MODE is not defined it is 1 by default.

2. **SATCOM CLASS CHANGE**
    - The SatCom class has been made dumber so that it can take messages of variable length.
      Previously, an encoding function in SatCom encoded the data and converted it from float to uint32_t. The encoding step was data specific--the latitude, longitude, altitude, etc., all required their own formulas.
      This meant that any change to the data being sent required editing both the main code and the SatCom class.
      The encoding function has been removed to make SatCom more general.
    - This change is reflected in the TBeam::readAndSend function mentioned earlier--this function
      now handles the encoding and array creation. This means that more work is required by the
      user to prep the data before sending to the SatCom, but now the SatCom does not have to be 
      touched to send different amounts of data, a tradeoff deemed acceptable.
    - The sendMessage function in SatCom now requires a uint32_t message array and that array's length to function properly. This also 
      removed the need for (and reliance upon) the Data struct.
      
3. **Moved all subsystems into (mostly) independent classes.**
   This makes subsystem testing easier (more pick-and-pull style). New classes include:
    - **Relay**
        - initializes relay pin and controls trigger mechanism
    - **GPSControl**
        - handles Serial.GPS with new feedSerial function to keep gps fresh
        - contains checkGpsAcquired
        - contains getGPS (reads time, lat, lng, alt)
        - contains new setLaunchCoords function for the new circGeoFence function
        - contains circGeoFence
    - **TBeam**
        - this is the master class that orchestrates all TBeam functions. Essentially,
          the functions which controlled the flight that were outside of any class have
          been moved into this one. These include...
        - init: initializes the Adafruit bme and SatCom
        - satCheck: sends data over satcom to verify that it is functioning without starting 
          the mission timer
        - startMission: starts the timer and sets the launch coordinates
        - readAndSendData: see point 2 for details
        - runMission and runAfterTermination: first includes circGeoFence check, second does not

5. **Eliminated all global variables** (again, to make class copy-paste and testing easier)
    - Mission-specific variables are declared at the top of the TBeam class. Subsystem-specific variables are declared in their corresponding class.

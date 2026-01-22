# SABER T2C Firmware (v3)

Firmware for the SABER T2C flight computer with a built-in browser portal for configuration and mission programming. The firmware targets the T-Beam S3 platform and integrates GPS, satellite messaging, geofencing, onboard sensors, display UI, and mission logic.

## Repository structure (archive omitted)

- `src/`: Application firmware (main loop, drivers, and system modules).
- `include/`: Global build configuration and hardware pin/version constants.
- `data/`: LittleFS payloads loaded onto the device (portal web UI, mission data, geofence rules, SUA catalogs).
- `special_use_airspace/`: Scripts and source data used to build SUA catalogs for geofencing.
- `platformio.ini`: PlatformIO build targets and settings.
- `mission_library.db`: Mission library database used by tooling and the portal.
- `LICENSE`: Project license.

## Module breakdown (src/)

- `src/main.cpp`: Boot sequence, periodic polling, display updates, SATCOM sends, and module orchestration.
- `src/board/`: Board bring-up and power rail/PMU helpers for the T-Beam S3.
- `src/ui/`: Portal server initialization for the on-device browser UI.
- `src/display/`: OLED UI rendering and status presentation, plus logo assets.
- `src/gps/`: GPS initialization and polling with fix/position accessors.
- `src/satcom/`: Satellite modem (SmartOne) initialization, polling, and command helpers.
- `src/message/`: Message encoding for SATCOM payloads.
- `src/sensors/`: Environmental sensor (BME280) and PMU (AXP2101) measurement helpers.
- `src/geofence/`: Geofence rule loading and violation detection against current GPS position.
- `src/mission/`: Mission state machine and flight/test mode handling.
- `src/termination/`: Termination state and reason tracking.
- `src/core/`: Shared configuration persistence and system status cache.
- `src/io/`: Placeholder IO modules (button/relay stubs for future hardware control).
- `src/LoRa/`: Reserved space for LoRa support (currently empty).

## Portal assets (data/portal/)

- `data/portal/*.html`: Portal pages for configuration, mission library, and active mission status.
- `data/portal/*.js`: Client-side logic for portal workflows and mission tooling.
- `data/portal/styles.css`: Shared portal styling.
- `data/portal/assets/`: Portal images/icons.
- `data/portal/prebuilt_areas.csv`: Prebuilt mission areas for quick selection in the UI.

## Build and flash (PlatformIO)

- Build: `platformio run`
- Upload: `platformio run -t upload`
- Upload filesystem (portal + data): `platformio run -t uploadfs`

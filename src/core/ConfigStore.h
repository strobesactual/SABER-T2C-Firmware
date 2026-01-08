#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

class ConfigStore {
public:
  explicit ConfigStore(const char* path);

  bool begin();
  bool load(JsonDocument& doc);
  bool save(const JsonDocument& doc);

private:
  const char* _path;
};
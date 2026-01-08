#include "ConfigStore.h"
#include <LittleFS.h>

ConfigStore::ConfigStore(const char* path) : _path(path) {}

bool ConfigStore::begin() {
  if (!LittleFS.exists(_path)) {
    File f = LittleFS.open(_path, "w");
    if (!f) return false;
    f.print("{}");
    f.close();
  }
  return true;
}

bool ConfigStore::load(JsonDocument& doc) {
  File f = LittleFS.open(_path, "r");
  if (!f) return false;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  return !err;
}

bool ConfigStore::save(const JsonDocument& doc) {
  File f = LittleFS.open(_path, "w");
  if (!f) return false;
  if (serializeJson(doc, f) == 0) {
    f.close();
    return false;
  }
  f.close();
  return true;
}
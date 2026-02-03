#include "geofence/GeoFence.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <vector>

namespace {
  struct Point {
    double lat;
    double lon;
  };

  enum class RuleType {
    KeepOut,
    StayIn,
    Line
  };

  enum class LineAxis {
    NorthSouth,  // line of constant longitude
    EastWest     // line of constant latitude
  };

  struct Rule {
    RuleType type;
    String id;
    String detail;
    std::vector<Point> polygon;  // for KeepOut/StayIn
    LineAxis axis = LineAxis::NorthSouth;
    double value = 0.0;          // lon for NS, lat for EW
    bool armed = false;          // for StayIn
  };

  std::vector<Rule> s_rules;
  std::vector<GeoFence::Violation> s_violations;

  bool s_loaded = false;
  bool s_force_violation = false;
  bool s_has_prev = false;
  double s_prev_lat = 0.0;
  double s_prev_lon = 0.0;
  bool s_violation_pending = false;
  uint32_t s_violation_start_ms = 0;
  constexpr uint32_t VIOLATION_SUSTAIN_MS = 30000;

  bool pointInPolygon(const std::vector<Point> &poly, double lat, double lon)
  {
    if (poly.size() < 3) return false;
    int cnt = 0;
    for (size_t i = 0; i < poly.size(); i++) {
      const Point &p1 = poly[i];
      const Point &p2 = poly[(i + 1) % poly.size()];
      const double x1 = p1.lat;
      const double y1 = p1.lon;
      const double x2 = p2.lat;
      const double y2 = p2.lon;
      const double xp = lat;
      const double yp = lon;

      if (((yp < y2) != (yp < y1)) &&
          (xp < x1 + ((yp - y1) / (y2 - y1)) * (x2 - x1))) {
        cnt++;
      }
    }
    return (cnt % 2) == 1;
  }

  bool crossedLine(LineAxis axis, double value,
                   double prev_lat, double prev_lon,
                   double lat, double lon)
  {
    if (axis == LineAxis::NorthSouth) {
      const double a = prev_lon - value;
      const double b = lon - value;
      return (a == 0.0) ? (b != 0.0) : (a < 0.0 && b >= 0.0) || (a > 0.0 && b <= 0.0);
    }
    const double a = prev_lat - value;
    const double b = lat - value;
    return (a == 0.0) ? (b != 0.0) : (a < 0.0 && b >= 0.0) || (a > 0.0 && b <= 0.0);
  }

  void addViolation(const Rule &rule, const char *detail)
  {
    GeoFence::Violation v;
    v.id = rule.id;
    if (rule.type == RuleType::KeepOut) v.type = "keep_out";
    else if (rule.type == RuleType::StayIn) v.type = "stay_in";
    else v.type = "line";
    v.detail = detail;
    s_violations.push_back(v);
  }

  bool loadFromJson(const char *path)
  {
    s_rules.clear();
    s_violations.clear();
    s_loaded = false;

    if (!LittleFS.begin(true)) {
      Serial.println("[GEOFENCE] LittleFS mount failed");
      return false;
    }
    if (!LittleFS.exists(path)) {
      Serial.printf("[GEOFENCE] config not found: %s\n", path);
      return false;
    }

    File f = LittleFS.open(path, "r");
    if (!f) {
      Serial.printf("[GEOFENCE] failed to open: %s\n", path);
      return false;
    }

    DynamicJsonDocument doc(8192);
    const DeserializationError err = deserializeJson(doc, f);
    f.close();
    if (err) {
      Serial.printf("[GEOFENCE] JSON parse error: %s\n", err.c_str());
      return false;
    }

    auto parsePolyRules = [&](JsonArray arr, RuleType type) {
      for (JsonObject o : arr) {
        Rule r;
        r.type = type;
        r.id = o["id"] | String("rule");
        JsonArray pts = o["polygon"].as<JsonArray>();
        for (JsonArray p : pts) {
          if (p.size() < 2) continue;
          Point pt{p[0].as<double>(), p[1].as<double>()};
          r.polygon.push_back(pt);
        }
        if (type == RuleType::StayIn) r.armed = false;
        s_rules.push_back(r);
      }
    };

    if (doc.containsKey("keep_out")) {
      parsePolyRules(doc["keep_out"].as<JsonArray>(), RuleType::KeepOut);
    }
    if (doc.containsKey("stay_in")) {
      parsePolyRules(doc["stay_in"].as<JsonArray>(), RuleType::StayIn);
    }

    if (doc.containsKey("lines")) {
      for (JsonObject o : doc["lines"].as<JsonArray>()) {
        Rule r;
        r.type = RuleType::Line;
        r.id = o["id"] | String("line");
        String axis = o["axis"] | String("N/S");
        axis.toUpperCase();
        if (axis == "E/W") {
          r.axis = LineAxis::EastWest;
        } else {
          r.axis = LineAxis::NorthSouth;
        }
        r.value = o["value"] | 0.0;
        r.detail = o["detail"] | String("");
        s_rules.push_back(r);
      }
    }

    s_loaded = true;
    Serial.printf("[GEOFENCE] loaded %u rules from %s\n",
                  (unsigned)s_rules.size(), path);
    return true;
  }
}  // namespace

namespace GeoFence {

bool begin(const char *path)
{
  return loadFromJson(path);
}

bool reload(const char *path)
{
  s_violation_pending = false;
  s_violation_start_ms = 0;
  return loadFromJson(path);
}

bool update(double lat, double lon)
{
  s_violations.clear();
  if (s_force_violation) {
    GeoFence::Violation v;
    v.id = "force";
    v.type = "test";
    v.detail = "forced geofence violation";
    s_violations.push_back(v);
    s_prev_lat = lat;
    s_prev_lon = lon;
    s_has_prev = true;
    return true;
  }
  if (!s_loaded) {
    s_prev_lat = lat;
    s_prev_lon = lon;
    s_has_prev = true;
    return false;
  }

  for (Rule &r : s_rules) {
    if (r.type == RuleType::KeepOut) {
      if (pointInPolygon(r.polygon, lat, lon)) {
        addViolation(r, "entered keep-out");
      }
    } else if (r.type == RuleType::StayIn) {
      const bool inside = pointInPolygon(r.polygon, lat, lon);
      if (!r.armed) {
        if (inside) r.armed = true;
        continue;
      }
      if (!inside) {
        addViolation(r, "left stay-in");
      }
    } else if (r.type == RuleType::Line) {
      if (s_has_prev && crossedLine(r.axis, r.value, s_prev_lat, s_prev_lon, lat, lon)) {
        addViolation(r, "crossed line");
      }
    }
  }

  if (!s_violations.empty()) {
    if (!s_violation_pending) {
      s_violation_pending = true;
      s_violation_start_ms = millis();
      s_violations.clear();
    } else if (millis() - s_violation_start_ms < VIOLATION_SUSTAIN_MS) {
      s_violations.clear();
    }
  } else {
    s_violation_pending = false;
    s_violation_start_ms = 0;
  }

  s_prev_lat = lat;
  s_prev_lon = lon;
  s_has_prev = true;

  return !s_violations.empty();
}

void setForcedViolation(bool enabled)
{
  s_force_violation = enabled;
  if (!s_force_violation) {
    s_violations.clear();
  }
  s_violation_pending = false;
  s_violation_start_ms = 0;
}

bool forcedViolation()
{
  return s_force_violation;
}

size_t violationCount()
{
  return s_violations.size();
}

size_t ruleCount()
{
  return s_rules.size();
}

const Violation &violation(size_t idx)
{
  return s_violations[idx];
}

void clearViolations()
{
  s_violations.clear();
}

bool containedAt(double lat, double lon, bool *hasStayIn)
{
  bool has = false;
  bool inside = false;
  for (const Rule &r : s_rules) {
    if (r.type != RuleType::StayIn) continue;
    has = true;
    if (pointInPolygon(r.polygon, lat, lon)) {
      inside = true;
      break;
    }
  }
  if (hasStayIn) *hasStayIn = has;
  return has && inside;
}

}  // namespace GeoFence

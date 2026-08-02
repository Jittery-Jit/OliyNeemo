// Thin wrapper over the Preferences (NVS) library for storing Wi-Fi
// credentials -- PRD 1 Section 7 step 1, Section 11 (factory reset).
#pragma once

#include <Arduino.h>

class NvsCreds {
public:
  void begin();
  bool hasCredentials();
  bool load(String& ssid, String& password);
  void save(const String& ssid, const String& password);
  void clear();
};

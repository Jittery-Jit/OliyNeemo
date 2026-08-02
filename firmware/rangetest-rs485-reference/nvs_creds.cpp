#include "nvs_creds.h"
#include <Preferences.h>

namespace {
Preferences prefs;
const char* kNamespace = "neemo";
const char* kKeySsid = "ssid";
const char* kKeyPass = "pass";
}  // namespace

void NvsCreds::begin() {
  // Nothing to do up front -- Preferences opens/closes per call below so
  // the RFID/RS485 code (which also touches flash-adjacent peripherals via
  // Serial2) never contends with an NVS handle held open across loop().
}

bool NvsCreds::hasCredentials() {
  prefs.begin(kNamespace, true /* read-only */);
  bool has = prefs.isKey(kKeySsid);
  prefs.end();
  return has;
}

bool NvsCreds::load(String& ssid, String& password) {
  prefs.begin(kNamespace, true /* read-only */);
  if (!prefs.isKey(kKeySsid)) {
    prefs.end();
    return false;
  }
  ssid = prefs.getString(kKeySsid, "");
  password = prefs.getString(kKeyPass, "");
  prefs.end();
  return ssid.length() > 0;
}

void NvsCreds::save(const String& ssid, const String& password) {
  prefs.begin(kNamespace, false /* read-write */);
  prefs.putString(kKeySsid, ssid);
  prefs.putString(kKeyPass, password);
  prefs.end();
}

void NvsCreds::clear() {
  prefs.begin(kNamespace, false /* read-write */);
  prefs.clear();
  prefs.end();
}

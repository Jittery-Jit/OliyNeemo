// NimBLE GATT server + advertising -- PRD 1 Section 4.
//
// Uses the h2zero NimBLE-Arduino library, NOT the arduino-esp32 core's own
// bundled `BLE` library. The bundled one looks NimBLE-capable from its
// source (it supports both CONFIG_BLUEDROID_ENABLED and
// CONFIG_NIMBLE_ENABLED), but the precompiled libs shipped for the classic
// ESP32 (WROOM-32) target in this core version (3.3.10) are built with
// CONFIG_BT_BLUEDROID_ENABLED=y -- confirmed by grepping
// esp32-libs/3.3.10/sdkconfig. Bluedroid is exactly what Section 12 says
// not to use ("RAM footprint is not affordable alongside Wi-Fi and RFID").
// NimBLE-Arduino provides a real NimBLE host on this chip regardless of
// the core's own default, which is why it's installed as a separate
// library here instead.
//
// Wire formats not pinned by either PRD, defined here (hand to the app
// team alongside the GATT UUIDs in config.h):
//   state:        [state:u8][errorCode:u8]  (errorCode is 0/NONE unless state==FAILED)
//   network_info: "ip;ssid;rssi" as ASCII text, e.g. "192.168.1.42;MyWiFi;-58"
//   device_info:  "id=XXXX;mac=AA:BB:CC:DD:EE:FF;fw=<version>" as ASCII text
//   credentials:  [ssid bytes]['\0'][password bytes] -- PLAINTEXT for the
//                 MVP pass (see TODO in ble_service.cpp); password half may
//                 be empty (open network)
//   manufacturer data (advertising): [0xFF 0xFF][state:u8] -- 0xFFFF is the
//                 Bluetooth SIG's reserved/unallocated company ID, standard
//                 placeholder for prototype devices; swap for a real
//                 registered company ID before any certification/production run.
#pragma once

#include <Arduino.h>
#include <NimBLEDevice.h>
#include "hub_types.h"
#include "wifi_manager.h"
#include "wifi_scan.h"
#include "led_status.h"

class HubStateMachine;

class BleService {
public:
  void begin(HubStateMachine* hub, WifiManager* wifiManager, WifiScanner* wifiScanner, LedStatus* ledStatus);

  // Push-model publishers -- called by the owning logic whenever the
  // underlying value changes; each does setValue() + notify().
  void publishState(HubState state, ErrorCode error);
  void publishNetworkInfo(const String& ip, const String& ssid, int8_t rssi);
  void publishPortalTerms(const String& terms);
  void publishScanResults();  // reads current results from the WifiScanner given in begin()

  // Called from the write-callback classes defined in ble_service.cpp.
  void handleIdentifyWrite();
  void handleScanTriggerWrite();
  void handleCredentialsWrite(NimBLECharacteristic* c);
  void handlePortalConsentWrite();
  void handleResetWrite();

private:
  HubStateMachine* hub_ = nullptr;
  WifiManager* wifiManager_ = nullptr;
  WifiScanner* wifiScanner_ = nullptr;
  LedStatus* ledStatus_ = nullptr;

  NimBLEAdvertising* advertising_ = nullptr;
  NimBLECharacteristic* deviceInfoChar_ = nullptr;
  NimBLECharacteristic* stateChar_ = nullptr;
  NimBLECharacteristic* identifyChar_ = nullptr;
  NimBLECharacteristic* scanTriggerChar_ = nullptr;
  NimBLECharacteristic* scanResultsChar_ = nullptr;
  NimBLECharacteristic* credentialsChar_ = nullptr;
  NimBLECharacteristic* portalTermsChar_ = nullptr;
  NimBLECharacteristic* portalConsentChar_ = nullptr;
  NimBLECharacteristic* networkInfoChar_ = nullptr;
  NimBLECharacteristic* resetChar_ = nullptr;

  bool advertisingFast_ = true;

  static String computeShortId();
  void applyAdvertisingForState(HubState state);
};

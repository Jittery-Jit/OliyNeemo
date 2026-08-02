// Shared enums/structs for the Neemo hub pairing/connectivity state machine.
#pragma once

#include <Arduino.h>

// PRD 1 Section 3 -- the hub is always in exactly one of these.
enum class HubState : uint8_t {
  UNPROVISIONED = 0,
  CONNECTING = 1,
  PORTAL_PENDING = 2,
  ONLINE = 3,
  RECONNECTING = 4,
  FAILED = 5,
};

// PRD 1 Section 8 -- one specific code, never a generic failure.
enum class ErrorCode : uint8_t {
  NONE = 0,
  AUTH_FAILED = 1,
  AP_NOT_FOUND = 2,
  DHCP_FAILED = 3,
  CAPTIVE_PORTAL_SIMPLE = 4,
  CAPTIVE_PORTAL_COMPLEX = 5,
  NO_INTERNET = 6,
  WEAK_SIGNAL = 7,
};

// PRD 1 Section 9.1 -- what the connectivity probe found.
enum class PortalProbeResult : uint8_t {
  CLEAN = 0,
  PORTAL_DETECTED = 1,
  NO_INTERNET = 2,
};

// PRD 1 Section 9.2 -- once a portal's been fetched and inspected.
enum class PortalClass : uint8_t {
  SIMPLE = 0,
  COMPLEX = 1,
};

// PRD 1 Section 6 -- one network from a scan.
struct WifiNetwork {
  char ssid[33];        // 802.11 max SSID length + null terminator
  int8_t rssi;
  uint8_t securityType;  // 0=open, 1=WPA2, 2=WPA3 (matches app-side enum in PRD 2 Step 4)
  bool hidden;
};

enum WifiSecurityType : uint8_t {
  SECURITY_OPEN = 0,
  SECURITY_WPA2 = 1,
  SECURITY_WPA3 = 2,
};

// PRD 1 Section 9.2 -- parsed out of the portal page for portal_terms /
// the eventual consent submission.
struct PortalInfo {
  String termsText;
  String formAction;
  String formFieldNames;  // comma-separated, informational for now
};

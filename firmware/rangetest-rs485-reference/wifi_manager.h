// Wi-Fi connection sequence (PRD 1 Section 7), error classification
// (Section 8), and reconnection with backoff (Section 10).
//
// Design note: "reconnect" here means specifically Section 10's "was
// online, lost Wi-Fi" case -- that's the only place the spec asks for
// backoff-and-retry-forever behavior. A fresh boot with stored credentials
// hasn't "been online" yet this session, so hub_state drives that through
// the same startConnect() path as first-time provisioning: immediate
// attempt, standard timeouts, straight to FAILED on failure. (The hub is
// mains-powered/always-on per Section 2, so a full device reboot losing
// its home network is the rare case, not the one Section 10 is about.)
#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include "hub_types.h"
#include "config.h"
#include "nvs_creds.h"
#include "wifi_scan.h"
#if NEEMO_ENABLE_CAPTIVE_PORTAL
#include "captive_portal.h"
#endif

enum class WifiOutcome : uint8_t {
  NONE,           // nothing happened this tick
  ONLINE,         // just reached (or re-reached) ONLINE -- (re-)publish network_info
  PORTAL_PENDING, // simple portal found, terms available via portalInfo()
  FAILED,         // gave up -- error code available via lastError()
  RECONNECTING,   // was ONLINE, just dropped, now retrying with backoff
};

class WifiManager {
public:
  // `scanner` is owned by the caller (HubStateMachine) and shared with
  // BleService for scan_trigger -- avoids paying for two ~700-byte
  // WifiNetwork[20] result arrays on a chip this RAM-constrained (Section 12).
  void begin(WifiScanner* scanner);

  // Section 7. Persists credentials, then attempts to associate.
  void startConnect(const String& ssid, const String& password);

  // Section 9.3. Only meaningful while a PORTAL_PENDING outcome is active.
  void submitPortalConsent();

  // Drops the current attempt/connection and goes idle -- used for factory
  // reset and for hub_state-driven timeouts (e.g. PORTAL_PENDING's 5 minutes).
  void abortToIdle();

  // Call every loop() iteration. Non-blocking except for the captive-portal
  // probe/fetch calls, which are bounded, one-shot HTTP requests that only
  // run once per connection attempt (not every tick).
  WifiOutcome tick();

  ErrorCode lastError() const { return lastError_; }
  const PortalInfo& portalInfo() const { return portalInfo_; }
  String ip() const;
  String ssid() const { return targetSsid_; }
  int8_t rssi() const;

private:
  enum class Phase : uint8_t {
    IDLE,
    ASSOCIATING,
    WAITING_DHCP,
    PROBING,
    AWAITING_CONSENT,
    RESUBMIT_PROBING,
    ONLINE,
    RECONNECT_WAIT,
  };

  Phase phase_ = Phase::IDLE;
  NvsCreds nvsCreds_;
#if NEEMO_ENABLE_CAPTIVE_PORTAL
  CaptivePortal captivePortal_;
#endif
  WifiScanner* scanner_ = nullptr;  // shared, not owned -- see begin()

  String targetSsid_;
  String targetPassword_;
  ErrorCode lastError_ = ErrorCode::NONE;
  PortalInfo portalInfo_;
  String lastKnownIp_;

  bool isReconnect_ = false;
  uint32_t phaseStartMs_ = 0;
  uint32_t reconnectFirstFailureMs_ = 0;
  uint8_t reconnectBackoffIdx_ = 0;
  uint32_t reconnectWaitStartMs_ = 0;
  uint32_t reconnectWaitDurationMs_ = 0;

  // Set from the WiFi event callback (WiFi driver task context), consumed
  // and cleared at the top of tick() (loop task context). Plain bool/u8
  // flags -- word-sized reads/writes are atomic enough on the Xtensa/RISC-V
  // targets ESP32 uses for this single-writer/single-reader pattern.
  volatile bool evConnected_ = false;
  volatile bool evGotIp_ = false;
  volatile bool evDisconnected_ = false;
  volatile uint8_t evDisconnectReason_ = 0;

  static WifiManager* instance_;
  void handleEvent(arduino_event_id_t event, arduino_event_info_t info);

  void beginAssociation();
  ErrorCode classifyAssocFailure(uint8_t reason);
  WifiOutcome failWith(ErrorCode code);
  WifiOutcome handleReconnectFailure();
};

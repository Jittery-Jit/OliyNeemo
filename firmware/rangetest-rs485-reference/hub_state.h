// Central state machine -- PRD 1 Section 3. Owns the current HubState,
// ticks every module that needs non-blocking time-based work, and is the
// single place that decides when the hub's state actually changes.
#pragma once

#include <Arduino.h>
#include "hub_types.h"
#include "led_status.h"
#include "nvs_creds.h"
#include "wifi_scan.h"
#include "wifi_manager.h"
#include "ble_service.h"

class HubStateMachine {
public:
  void begin();
  void tick();  // call every loop() iteration; non-blocking except for the
                // brief, bounded HTTP calls inside WifiManager's own tick()

  // Called by BleService when the app writes `reset`, and by the BOOT-button
  // fallback (Section 11).
  void handleResetRequest();

private:
  HubState state_ = HubState::UNPROVISIONED;
  ErrorCode error_ = ErrorCode::NONE;
  uint32_t stateEnteredMs_ = 0;

  WifiScanner wifiScanner_;
  WifiManager wifiManager_;
  LedStatus ledStatus_;
  NvsCreds nvsCreds_;
  BleService bleService_;

  bool bootButtonHeld_ = false;
  uint32_t bootButtonPressStartMs_ = 0;

  void setState(HubState state, ErrorCode error = ErrorCode::NONE);
  void checkBootButton();
};

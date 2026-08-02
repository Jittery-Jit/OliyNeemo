#include "hub_state.h"
#include "config.h"

void HubStateMachine::begin() {
  ledStatus_.begin();
  nvsCreds_.begin();
  wifiManager_.begin(&wifiScanner_);
  bleService_.begin(this, &wifiManager_, &wifiScanner_, &ledStatus_);

  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);  // BOOT is active-low on the DevKit V1

  String ssid, password;
  if (nvsCreds_.load(ssid, password)) {
    // Fresh boot with stored credentials -- Section 7's normal CONNECTING
    // path, not Section 10's reconnect/backoff path (see the design note
    // at the top of wifi_manager.h for why).
    setState(HubState::CONNECTING);
    wifiManager_.startConnect(ssid, password);
  } else {
    setState(HubState::UNPROVISIONED);
  }
}

void HubStateMachine::setState(HubState state, ErrorCode error) {
  state_ = state;
  error_ = error;
  stateEnteredMs_ = millis();
  ledStatus_.setHubState(state);
  bleService_.publishState(state, error);
}

void HubStateMachine::checkBootButton() {
  bool pressed = (digitalRead(BOOT_BUTTON_PIN) == LOW);
  if (!pressed) {
    bootButtonHeld_ = false;
    return;
  }
  if (!bootButtonHeld_) {
    bootButtonHeld_ = true;
    bootButtonPressStartMs_ = millis();
  } else if (millis() - bootButtonPressStartMs_ >= 10000) {
    handleResetRequest();
    bootButtonHeld_ = false;  // don't re-fire every tick while still held
  }
}

void HubStateMachine::handleResetRequest() {
  wifiManager_.abortToIdle();
  nvsCreds_.clear();
  setState(HubState::UNPROVISIONED, ErrorCode::NONE);
}

void HubStateMachine::tick() {
  checkBootButton();
  ledStatus_.tick();

  WifiOutcome outcome = wifiManager_.tick();
  switch (outcome) {
    case WifiOutcome::NONE:
      break;
    case WifiOutcome::ONLINE:
      setState(HubState::ONLINE, ErrorCode::NONE);
      bleService_.publishNetworkInfo(wifiManager_.ip(), wifiManager_.ssid(), wifiManager_.rssi());
      break;
    case WifiOutcome::PORTAL_PENDING:
      setState(HubState::PORTAL_PENDING, ErrorCode::CAPTIVE_PORTAL_SIMPLE);
      bleService_.publishPortalTerms(wifiManager_.portalInfo().termsText);
      break;
    case WifiOutcome::FAILED:
      setState(HubState::FAILED, wifiManager_.lastError());
      break;
    case WifiOutcome::RECONNECTING:
      setState(HubState::RECONNECTING, ErrorCode::NONE);
      break;
  }

  // Section 9.3: PORTAL_PENDING times out after 5 minutes with no consent.
  if (state_ == HubState::PORTAL_PENDING && millis() - stateEnteredMs_ >= PORTAL_PENDING_TIMEOUT_MS) {
    wifiManager_.abortToIdle();
    setState(HubState::FAILED, ErrorCode::CAPTIVE_PORTAL_COMPLEX);
  }
}

#include "wifi_manager.h"
#include "config.h"

WifiManager* WifiManager::instance_ = nullptr;

void WifiManager::begin(WifiScanner* scanner) {
  instance_ = this;
  scanner_ = scanner;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);  // we drive reconnection ourselves (Section 10)
  WiFi.onEvent([](arduino_event_id_t event, arduino_event_info_t info) {
    if (WifiManager::instance_) WifiManager::instance_->handleEvent(event, info);
  });
}

void WifiManager::handleEvent(arduino_event_id_t event, arduino_event_info_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      evConnected_ = true;
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      evGotIp_ = true;
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      evDisconnected_ = true;
      evDisconnectReason_ = info.wifi_sta_disconnected.reason;
      break;
    default:
      break;
  }
}

void WifiManager::beginAssociation() {
  phase_ = Phase::ASSOCIATING;
  phaseStartMs_ = millis();
  evConnected_ = evGotIp_ = evDisconnected_ = false;
  WiFi.begin(targetSsid_.c_str(), targetPassword_.length() ? targetPassword_.c_str() : nullptr);
}

void WifiManager::startConnect(const String& ssid, const String& password) {
  targetSsid_ = ssid;
  targetPassword_ = password;
  nvsCreds_.save(ssid, password);
  isReconnect_ = false;
  reconnectBackoffIdx_ = 0;
  beginAssociation();
}

void WifiManager::submitPortalConsent() {
#if NEEMO_ENABLE_CAPTIVE_PORTAL
  if (phase_ != Phase::AWAITING_CONSENT) return;
  captivePortal_.submitConsent();
  phase_ = Phase::RESUBMIT_PROBING;
  phaseStartMs_ = millis();
#endif
}

void WifiManager::abortToIdle() {
  WiFi.disconnect();
  phase_ = Phase::IDLE;
  isReconnect_ = false;
}

ErrorCode WifiManager::classifyAssocFailure(uint8_t reason) {
  switch (reason) {
    case WIFI_REASON_NO_AP_FOUND:
    case WIFI_REASON_NO_AP_FOUND_W_COMPATIBLE_SECURITY:
    case WIFI_REASON_NO_AP_FOUND_IN_AUTHMODE_THRESHOLD:
    case WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD:
      return ErrorCode::AP_NOT_FOUND;
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_MIC_FAILURE:
    case WIFI_REASON_802_1X_AUTH_FAILED:
      return ErrorCode::AUTH_FAILED;
    default: {
      // Ambiguous reason code -- fall back to Section 8's documented
      // AP_NOT_FOUND detection: a fresh scan for the target SSID.
      scanner_->scan();
      for (size_t i = 0; i < scanner_->resultCount(); i++) {
        if (targetSsid_.equals(scanner_->result(i).ssid)) return ErrorCode::AUTH_FAILED;
      }
      return ErrorCode::AP_NOT_FOUND;
    }
  }
}

WifiOutcome WifiManager::handleReconnectFailure() {
  if (millis() - reconnectFirstFailureMs_ >= RECONNECT_GIVEUP_MS) {
    // Section 10: 10 minutes of continuous failure -> FAILED, fast
    // advertising (hub_state handles the advertising side), keep creds.
    phase_ = Phase::IDLE;
    isReconnect_ = false;
    return WifiOutcome::FAILED;
  }
  phase_ = Phase::RECONNECT_WAIT;
  reconnectWaitStartMs_ = millis();
  reconnectWaitDurationMs_ =
      (reconnectBackoffIdx_ < RECONNECT_BACKOFF_STEPS) ? RECONNECT_BACKOFF_MS[reconnectBackoffIdx_++] : RECONNECT_BACKOFF_FLOOR_MS;
  return WifiOutcome::NONE;  // RECONNECTING was already reported once when we first dropped
}

WifiOutcome WifiManager::failWith(ErrorCode code) {
  lastError_ = code;
  if (isReconnect_) return handleReconnectFailure();
  phase_ = Phase::IDLE;
  return WifiOutcome::FAILED;
}

WifiOutcome WifiManager::tick() {
  bool connected = evConnected_;
  bool gotIp = evGotIp_;
  bool disconnected = evDisconnected_;
  uint8_t reason = evDisconnectReason_;
  evConnected_ = evGotIp_ = evDisconnected_ = false;

  WifiOutcome outcome = WifiOutcome::NONE;

  switch (phase_) {
    case Phase::IDLE:
      break;

    case Phase::ASSOCIATING:
      if (gotIp) {
        phase_ = Phase::WAITING_DHCP;  // fall through to the same-tick DHCP check below
      } else if (connected) {
        phase_ = Phase::WAITING_DHCP;
        phaseStartMs_ = millis();
        break;
      } else if (disconnected) {
        outcome = failWith(classifyAssocFailure(reason));
        break;
      } else if (millis() - phaseStartMs_ > WIFI_ASSOC_TIMEOUT_MS) {
        outcome = failWith(ErrorCode::AP_NOT_FOUND);
        break;
      } else {
        break;
      }
      [[fallthrough]];

    case Phase::WAITING_DHCP:
      if (gotIp) {
        int8_t currentRssi = (int8_t)WiFi.RSSI();
        if (currentRssi < WIFI_RSSI_WEAK_THRESHOLD) {
          outcome = failWith(ErrorCode::WEAK_SIGNAL);
        } else {
#if NEEMO_ENABLE_CAPTIVE_PORTAL
          phase_ = Phase::PROBING;
          phaseStartMs_ = millis();
#else
          // Captive portal detection disabled (config.h) -- go straight to
          // ONLINE after a clean DHCP lease.
          phase_ = Phase::ONLINE;
          lastError_ = ErrorCode::NONE;
          lastKnownIp_ = WiFi.localIP().toString();
          reconnectBackoffIdx_ = 0;
          isReconnect_ = false;
          outcome = WifiOutcome::ONLINE;
#endif
        }
      } else if (disconnected) {
        outcome = failWith(ErrorCode::DHCP_FAILED);
      } else if (millis() - phaseStartMs_ > WIFI_DHCP_TIMEOUT_MS) {
        outcome = failWith(ErrorCode::DHCP_FAILED);
      }
      break;

#if NEEMO_ENABLE_CAPTIVE_PORTAL
    case Phase::PROBING:
    case Phase::RESUBMIT_PROBING: {
      bool isResubmit = (phase_ == Phase::RESUBMIT_PROBING);
      PortalProbeResult probeResult = captivePortal_.probe();

      if (probeResult == PortalProbeResult::CLEAN) {
        phase_ = Phase::ONLINE;
        lastError_ = ErrorCode::NONE;
        lastKnownIp_ = WiFi.localIP().toString();
        reconnectBackoffIdx_ = 0;
        isReconnect_ = false;
        outcome = WifiOutcome::ONLINE;
      } else if (isResubmit) {
        // Section 9.3: any non-clean result after a consent resubmit is
        // reported as CAPTIVE_PORTAL_COMPLEX, regardless of deeper cause.
        outcome = failWith(ErrorCode::CAPTIVE_PORTAL_COMPLEX);
      } else if (probeResult == PortalProbeResult::PORTAL_DETECTED) {
        PortalClass pclass;
        PortalInfo info;
        bool ok = captivePortal_.fetchAndTriage(pclass, info);
        if (!ok || pclass == PortalClass::COMPLEX) {
          outcome = failWith(ErrorCode::CAPTIVE_PORTAL_COMPLEX);
        } else {
          portalInfo_ = info;
          phase_ = Phase::AWAITING_CONSENT;
          lastError_ = ErrorCode::CAPTIVE_PORTAL_SIMPLE;
          outcome = WifiOutcome::PORTAL_PENDING;
        }
      } else {
        outcome = failWith(ErrorCode::NO_INTERNET);
      }
      break;
    }

    case Phase::AWAITING_CONSENT:
      // Waiting on submitPortalConsent(). hub_state owns the 5-minute
      // PORTAL_PENDING timeout (Section 9.3) and calls abortToIdle() if it fires.
      break;
#endif  // NEEMO_ENABLE_CAPTIVE_PORTAL

    case Phase::ONLINE:
      if (disconnected) {
        phase_ = Phase::RECONNECT_WAIT;
        isReconnect_ = true;
        reconnectBackoffIdx_ = 0;
        reconnectFirstFailureMs_ = millis();
        reconnectWaitStartMs_ = millis();
        reconnectWaitDurationMs_ = RECONNECT_BACKOFF_MS[0];
        outcome = WifiOutcome::RECONNECTING;
      }
      break;

    case Phase::RECONNECT_WAIT:
      if (millis() - reconnectWaitStartMs_ >= reconnectWaitDurationMs_) {
        beginAssociation();
      }
      break;

    default:
      // Only reachable if NEEMO_ENABLE_CAPTIVE_PORTAL is 0, in which case
      // phase_ never becomes PROBING/RESUBMIT_PROBING/AWAITING_CONSENT.
      break;
  }

  return outcome;
}

String WifiManager::ip() const {
  return (phase_ == Phase::ONLINE) ? WiFi.localIP().toString() : lastKnownIp_;
}

int8_t WifiManager::rssi() const {
  return (int8_t)WiFi.RSSI();
}

#include "ble_service.h"
#include "config.h"
#include "hub_state.h"
#include <WiFi.h>

namespace {

// Section 4.4: one BLE connection at a time -- reject a second concurrent
// central by disconnecting it immediately. advertiseOnDisconnect(true) (set
// in begin()) handles resuming advertising after any disconnect, including
// this rejection, so nothing else is needed here.
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
    if (pServer->getConnectedCount() > 1) pServer->disconnect(connInfo);
  }
};

class IdentifyCallbacks : public NimBLECharacteristicCallbacks {
public:
  explicit IdentifyCallbacks(BleService* self) : self_(self) {}
  void onWrite(NimBLECharacteristic*, NimBLEConnInfo&) override { self_->handleIdentifyWrite(); }

private:
  BleService* self_;
};

class ScanTriggerCallbacks : public NimBLECharacteristicCallbacks {
public:
  explicit ScanTriggerCallbacks(BleService* self) : self_(self) {}
  void onWrite(NimBLECharacteristic*, NimBLEConnInfo&) override { self_->handleScanTriggerWrite(); }

private:
  BleService* self_;
};

class CredentialsCallbacks : public NimBLECharacteristicCallbacks {
public:
  explicit CredentialsCallbacks(BleService* self) : self_(self) {}
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override { self_->handleCredentialsWrite(c); }

private:
  BleService* self_;
};

class PortalConsentCallbacks : public NimBLECharacteristicCallbacks {
public:
  explicit PortalConsentCallbacks(BleService* self) : self_(self) {}
  void onWrite(NimBLECharacteristic*, NimBLEConnInfo&) override { self_->handlePortalConsentWrite(); }

private:
  BleService* self_;
};

class ResetCallbacks : public NimBLECharacteristicCallbacks {
public:
  explicit ResetCallbacks(BleService* self) : self_(self) {}
  void onWrite(NimBLECharacteristic*, NimBLEConnInfo&) override { self_->handleResetWrite(); }

private:
  BleService* self_;
};

}  // namespace

String BleService::computeShortId() {
  String mac = WiFi.macAddress();
  String hex;
  for (size_t i = 0; i < mac.length(); i++) {
    if (mac[i] != ':') hex += mac[i];
  }
  hex.toUpperCase();
  return hex.length() >= 4 ? hex.substring(hex.length() - 4) : hex;
}

void BleService::begin(HubStateMachine* hub, WifiManager* wifiManager, WifiScanner* wifiScanner, LedStatus* ledStatus) {
  hub_ = hub;
  wifiManager_ = wifiManager;
  wifiScanner_ = wifiScanner;
  ledStatus_ = ledStatus;

  String shortId = computeShortId();
  String localName = "Neemo-" + shortId;

  NimBLEDevice::init(localName.c_str());
  NimBLEDevice::setMTU(247);  // best-effort; scan_results chunking assumes a negotiated MTU well above 23 bytes

  NimBLEServer* server = NimBLEDevice::createServer();
  // setCallbacks() defaults to taking ownership (deletes the object later),
  // so this must be heap-allocated, not a static/stack instance.
  server->setCallbacks(new ServerCallbacks());
  server->advertiseOnDisconnect(true);

  NimBLEService* service = server->createService(NEEMO_SERVICE_UUID);

  deviceInfoChar_ = service->createCharacteristic(CHAR_DEVICE_INFO_UUID, NIMBLE_PROPERTY::READ);
  stateChar_ = service->createCharacteristic(CHAR_STATE_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  identifyChar_ = service->createCharacteristic(CHAR_IDENTIFY_UUID, NIMBLE_PROPERTY::WRITE);
  identifyChar_->setCallbacks(new IdentifyCallbacks(this));

  scanTriggerChar_ = service->createCharacteristic(CHAR_SCAN_TRIGGER_UUID, NIMBLE_PROPERTY::WRITE);
  scanTriggerChar_->setCallbacks(new ScanTriggerCallbacks(this));

  scanResultsChar_ = service->createCharacteristic(CHAR_SCAN_RESULTS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  credentialsChar_ = service->createCharacteristic(CHAR_CREDENTIALS_UUID, NIMBLE_PROPERTY::WRITE);
  credentialsChar_->setCallbacks(new CredentialsCallbacks(this));

  portalTermsChar_ = service->createCharacteristic(CHAR_PORTAL_TERMS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  portalConsentChar_ = service->createCharacteristic(CHAR_PORTAL_CONSENT_UUID, NIMBLE_PROPERTY::WRITE);
  portalConsentChar_->setCallbacks(new PortalConsentCallbacks(this));

  networkInfoChar_ = service->createCharacteristic(CHAR_NETWORK_INFO_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  resetChar_ = service->createCharacteristic(CHAR_RESET_UUID, NIMBLE_PROPERTY::WRITE);
  resetChar_->setCallbacks(new ResetCallbacks(this));

  String mac = WiFi.macAddress();
  String info = "id=" + shortId + ";mac=" + mac + ";fw=" + FIRMWARE_VERSION;
  deviceInfoChar_->setValue((const uint8_t*)info.c_str(), info.length());

  advertising_ = NimBLEDevice::getAdvertising();
  advertising_->enableScanResponse(true);
  NimBLEAdvertisementData scanResp;
  scanResp.setName(localName.c_str());
  advertising_->setScanResponseData(scanResp);

  advertisingFast_ = false;  // force applyAdvertisingForState() below to do its first-time setup
  applyAdvertisingForState(HubState::UNPROVISIONED);
}

void BleService::applyAdvertisingForState(HubState state) {
  bool wantFast = (state == HubState::UNPROVISIONED || state == HubState::FAILED || state == HubState::CONNECTING ||
                    state == HubState::PORTAL_PENDING);

  NimBLEAdvertisementData advData;
  advData.setFlags(0x06);  // BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP
  advData.addServiceUUID(NimBLEUUID(NEEMO_SERVICE_UUID));
  uint8_t mfg[3] = { 0xFF, 0xFF, (uint8_t)state };
  advData.setManufacturerData(mfg, sizeof(mfg));
  advertising_->setAdvertisementData(advData);

  if (wantFast != advertisingFast_) {
    advertisingFast_ = wantFast;
    bool wasAdvertising = advertising_->isAdvertising();
    if (wasAdvertising) advertising_->stop();
    uint16_t interval = wantFast ? BLE_ADV_INTERVAL_FAST_UNITS : BLE_ADV_INTERVAL_SLOW_UNITS;
    advertising_->setMinInterval(interval);
    advertising_->setMaxInterval(interval);
    advertising_->start();
  } else {
    advertising_->refreshAdvertisingData();
  }
}

void BleService::publishState(HubState state, ErrorCode error) {
  uint8_t payload[2] = { (uint8_t)state, (uint8_t)error };
  stateChar_->setValue(payload, sizeof(payload));
  stateChar_->notify();
  applyAdvertisingForState(state);
}

void BleService::publishNetworkInfo(const String& ip, const String& ssid, int8_t rssi) {
  String info = ip + ";" + ssid + ";" + String(rssi);
  networkInfoChar_->setValue((const uint8_t*)info.c_str(), info.length());
  networkInfoChar_->notify();
}

void BleService::publishPortalTerms(const String& terms) {
  portalTermsChar_->setValue((const uint8_t*)terms.c_str(), terms.length());
  portalTermsChar_->notify();
}

void BleService::publishScanResults() {
  size_t chunks = wifiScanner_->chunkCount();
  uint8_t buf[BLE_SCAN_CHUNK_PAYLOAD + 8];
  for (size_t i = 0; i < chunks; i++) {
    size_t n = wifiScanner_->buildChunk(i, buf, sizeof(buf));
    scanResultsChar_->setValue(buf, n);
    scanResultsChar_->notify();
  }
}

void BleService::handleIdentifyWrite() {
  ledStatus_->triggerIdentify();
}

void BleService::handleScanTriggerWrite() {
  // Section 6 radio coexistence: suspend BLE advertising for the scan
  // window, then resume and notify -- do not stream results while scanning.
  advertising_->stop();
  wifiScanner_->scan();
  advertising_->start();
  publishScanResults();
}

void BleService::handleCredentialsWrite(NimBLECharacteristic* c) {
  // TODO(security): PRD 1 Section 4.3 wants this write encrypted (Curve25519
  // key exchange + AES-CTR, gated by the hub's short-ID proof-of-possession).
  // Deferred per the plaintext-MVP-first decision -- neither PRD pins a byte
  // format for the key exchange yet. Plaintext for now: see the wire format
  // comment at the top of ble_service.h.
  NimBLEAttValue val = c->getValue();
  const uint8_t* data = val.data();
  size_t len = val.length();

  size_t sep = 0;
  while (sep < len && data[sep] != '\0') sep++;

  char ssidBuf[33] = { 0 };
  size_t ssidLen = min(sep, (size_t)32);
  memcpy(ssidBuf, data, ssidLen);
  ssidBuf[ssidLen] = '\0';

  char passBuf[65] = { 0 };
  if (sep < len) {
    size_t pwLen = min(len - sep - 1, (size_t)64);
    memcpy(passBuf, data + sep + 1, pwLen);
    passBuf[pwLen] = '\0';
  }

  String ssid(ssidBuf);
  if (ssid.length() == 0) return;  // malformed write, ignore
  wifiManager_->startConnect(ssid, String(passBuf));
}

void BleService::handlePortalConsentWrite() {
  wifiManager_->submitPortalConsent();
}

void BleService::handleResetWrite() {
  hub_->handleResetRequest();
}

#include "wifi_scan.h"
#include <WiFi.h>

namespace {

uint8_t classifySecurity(wifi_auth_mode_t mode) {
  switch (mode) {
    case WIFI_AUTH_OPEN:
      return SECURITY_OPEN;
    case WIFI_AUTH_WPA3_PSK:
    case WIFI_AUTH_WPA2_WPA3_PSK:
      return SECURITY_WPA3;
    default:
      // WEP / WPA-only / enterprise all bucket into the "secured, not WPA3"
      // slot -- PRD 1 only defines three categories.
      return SECURITY_WPA2;
  }
}

size_t entrySerializedSize(const WifiNetwork& net) {
  return 4 + strnlen(net.ssid, sizeof(net.ssid));  // ssidLen byte + ssid + rssi + security + hidden
}

}  // namespace

int WifiScanner::scan() {
  count_ = 0;
  int found = WiFi.scanNetworks(false /* async */, true /* show_hidden */);
  if (found <= 0) {
    WiFi.scanDelete();
    return 0;
  }

  for (int i = 0; i < found && count_ < WIFI_SCAN_MAX_RESULTS; i++) {
    String ssid = WiFi.SSID(i);
    int8_t rssi = (int8_t)constrain(WiFi.RSSI(i), -128, 127);
    uint8_t security = classifySecurity(WiFi.encryptionType(i));
    bool hidden = ssid.length() == 0;

    if (!hidden) {
      // De-dupe: mesh APs broadcast the same SSID from multiple radios --
      // keep the strongest signal.
      bool merged = false;
      for (size_t j = 0; j < count_; j++) {
        if (!results_[j].hidden && ssid.equals(results_[j].ssid)) {
          if (rssi > results_[j].rssi) {
            results_[j].rssi = rssi;
            results_[j].securityType = security;
          }
          merged = true;
          break;
        }
      }
      if (merged) continue;
    }

    WifiNetwork& net = results_[count_++];
    ssid.toCharArray(net.ssid, sizeof(net.ssid));
    net.rssi = rssi;
    net.securityType = security;
    net.hidden = hidden;
  }

  WiFi.scanDelete();

  // Sort by RSSI descending -- insertion sort is fine at count_ <= 20.
  for (size_t i = 1; i < count_; i++) {
    WifiNetwork key = results_[i];
    size_t j = i;
    while (j > 0 && results_[j - 1].rssi < key.rssi) {
      results_[j] = results_[j - 1];
      j--;
    }
    results_[j] = key;
  }

  return (int)count_;
}

size_t WifiScanner::chunkCount() const {
  if (count_ == 0) return 1;  // still send one chunk (entryCount=0) so the app knows "no networks"
  size_t chunks = 0;
  size_t i = 0;
  while (i < count_) {
    size_t used = 0;
    size_t entries = 0;
    while (i < count_) {
      size_t entrySize = entrySerializedSize(results_[i]);
      if (entries > 0 && used + entrySize > BLE_SCAN_CHUNK_PAYLOAD) break;
      used += entrySize;
      entries++;
      i++;
    }
    chunks++;
  }
  return chunks;
}

size_t WifiScanner::buildChunk(size_t chunkIndex, uint8_t* out, size_t maxLen) const {
  size_t totalChunks = chunkCount();
  if (chunkIndex >= totalChunks || maxLen < 3) return 0;

  size_t startEntry = 0, entryCountInChunk = 0;
  size_t i = 0, chunk = 0;
  while (i < count_) {
    size_t used = 0;
    size_t entries = 0;
    size_t chunkStart = i;
    while (i < count_) {
      size_t entrySize = entrySerializedSize(results_[i]);
      if (entries > 0 && used + entrySize > BLE_SCAN_CHUNK_PAYLOAD) break;
      used += entrySize;
      entries++;
      i++;
    }
    if (chunk == chunkIndex) {
      startEntry = chunkStart;
      entryCountInChunk = entries;
      break;
    }
    chunk++;
  }

  size_t pos = 0;
  out[pos++] = (uint8_t)chunkIndex;
  out[pos++] = (uint8_t)totalChunks;
  out[pos++] = (uint8_t)entryCountInChunk;

  for (size_t e = 0; e < entryCountInChunk; e++) {
    const WifiNetwork& net = results_[startEntry + e];
    uint8_t ssidLen = (uint8_t)strnlen(net.ssid, sizeof(net.ssid));
    if (pos + 4 + ssidLen > maxLen) break;  // stay safe; shouldn't trigger given chunk sizing
    out[pos++] = ssidLen;
    memcpy(out + pos, net.ssid, ssidLen);
    pos += ssidLen;
    out[pos++] = (uint8_t)net.rssi;
    out[pos++] = net.securityType;
    out[pos++] = net.hidden ? 1 : 0;
  }
  return pos;
}

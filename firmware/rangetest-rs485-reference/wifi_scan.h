// Wi-Fi scan handling -- PRD 1 Section 6.
//
// Radio coexistence note: a Wi-Fi scan can stall/drop a live BLE
// connection. WifiScanner::scan() is a blocking call by design -- the
// caller (hub_state) is responsible for suspending BLE advertising before
// calling it and resuming afterward, per Section 6's "suspend or throttle
// BLE activity during the scan window" requirement. This class does not
// touch BLE itself.
//
// scan_results wire format (chunk payload) -- not pinned by either PRD, so
// defined here; hand to the app team alongside the GATT UUIDs:
//   byte 0: chunkIndex (0-based)
//   byte 1: totalChunks
//   byte 2: entry count in this chunk
//   repeated per entry: [ssidLen:u8][ssid bytes][rssi:i8][securityType:u8][hidden:u8]
//   securityType: 0=open, 1=WPA2 (also covers WEP/WPA-only, bucketed as "secured"), 2=WPA3
#pragma once

#include <Arduino.h>
#include "hub_types.h"
#include "config.h"

class WifiScanner {
public:
  // Blocking. Scans, de-dupes by SSID (keeping strongest), sorts by RSSI
  // descending, caps at WIFI_SCAN_MAX_RESULTS. Returns the resulting count.
  int scan();

  size_t resultCount() const { return count_; }
  const WifiNetwork& result(size_t i) const { return results_[i]; }

  size_t chunkCount() const;
  // Writes chunk `chunkIndex` into `out` (max `maxLen` bytes), returns bytes written.
  size_t buildChunk(size_t chunkIndex, uint8_t* out, size_t maxLen) const;

private:
  WifiNetwork results_[WIFI_SCAN_MAX_RESULTS];
  size_t count_ = 0;
};

// Neemo hub pairing/connectivity config -- pins, timeouts, GATT UUIDs.
// UUIDs here are the authoritative shared contract with PRD 2 (mobile app);
// hand these to the app team verbatim if they change.
#pragma once

#include <stdint.h>

// ---------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------
// Captive portal detection (PRD 1 Section 9) is the only thing in this
// sketch that uses HTTPClient -- and HTTPClient.h unconditionally pulls in
// NetworkClientSecure (the full TLS stack) whether or not it's ever used,
// which is the single largest flash cost in this build once WiFi+BLE are
// both linked in. Set to 0 to drop it entirely: wifi_manager then goes
// straight from a clean DHCP lease to ONLINE, skipping portal detection.
// PRD 1 Section 9's acceptance criteria (simple/complex portal handling)
// don't hold with this off -- everything else (BLE pairing, Wi-Fi
// connect/reconnect, scanning) is unaffected.
#define NEEMO_ENABLE_CAPTIVE_PORTAL 0

// ---------------------------------------------------------------------
// Pins (PRD 1 Section 2)
// ---------------------------------------------------------------------
#define STATUS_LED_PIN        2     // onboard LED -- status + identify
#define BOOT_BUTTON_PIN        0     // onboard BOOT button -- best-effort factory reset (Section 11)

// ---------------------------------------------------------------------
// BLE advertising (PRD 1 Section 4.1)
// ---------------------------------------------------------------------
#define BLE_ADV_INTERVAL_FAST_MS   100   // UNPROVISIONED / FAILED
#define BLE_ADV_INTERVAL_SLOW_MS   1000  // ONLINE / RECONNECTING
// NimBLE advertising interval setters take 0.625ms units (BLE spec unit).
#define BLE_ADV_INTERVAL_FAST_UNITS 160   // 100ms
#define BLE_ADV_INTERVAL_SLOW_UNITS 1600  // 1000ms

#define NEEMO_SERVICE_UUID       "deaa4e52-e6b7-4fb8-98e7-abfb96e3dff3"
#define CHAR_DEVICE_INFO_UUID    "0994099b-4fa5-4738-8bf6-575d5ab8ed52"
#define CHAR_STATE_UUID          "ec29cba4-9b38-4ee4-a2f8-94e8213341d6"
#define CHAR_IDENTIFY_UUID       "af7f89d0-c5dc-4490-9d3b-f6b1250d16b3"
#define CHAR_SCAN_TRIGGER_UUID   "3cfecf01-d5a9-4ab1-b3ad-835b9b5744fa"
#define CHAR_SCAN_RESULTS_UUID   "de7ecbc2-795a-4045-bc5f-91bbdb1c594c"
#define CHAR_CREDENTIALS_UUID    "b8707153-9d30-4d33-89b8-3b8cd39d4461"
#define CHAR_PORTAL_TERMS_UUID   "d983c720-1cf0-4073-9bfa-5397213eeebd"
#define CHAR_PORTAL_CONSENT_UUID "cd456750-2eba-47f7-8101-f196539e9fc8"
#define CHAR_NETWORK_INFO_UUID   "d923169e-c09b-4b21-9322-1656863e8534"
#define CHAR_RESET_UUID          "0ae5af30-e919-4b0a-ba0b-3ae2e1e26ab3"

#define FIRMWARE_VERSION         "0.1.0-mvp"

// ---------------------------------------------------------------------
// Wi-Fi connection sequence timeouts (PRD 1 Section 7)
// ---------------------------------------------------------------------
#define WIFI_ASSOC_TIMEOUT_MS      20000
#define WIFI_DHCP_TIMEOUT_MS       15000
#define WIFI_RSSI_WEAK_THRESHOLD   -75    // dBm, below this -> WEAK_SIGNAL

// ---------------------------------------------------------------------
// Reconnection backoff (PRD 1 Section 10): 5s, 15s, 30s, 60s, then every 60s
// ---------------------------------------------------------------------
static const uint32_t RECONNECT_BACKOFF_MS[] = { 5000, 15000, 30000, 60000 };
#define RECONNECT_BACKOFF_STEPS   (sizeof(RECONNECT_BACKOFF_MS) / sizeof(RECONNECT_BACKOFF_MS[0]))
#define RECONNECT_BACKOFF_FLOOR_MS 60000
#define RECONNECT_GIVEUP_MS        (10UL * 60UL * 1000UL)  // 10 minutes continuous failure -> FAILED

// ---------------------------------------------------------------------
// Captive portal (PRD 1 Section 9)
// ---------------------------------------------------------------------
// Same 204-probe endpoint Android/ChromeOS use for connectivity checks.
#define CONNECTIVITY_CHECK_URL     "http://connectivitycheck.gstatic.com/generate_204"
#define PORTAL_PROBE_TIMEOUT_MS    8000
#define PORTAL_PENDING_TIMEOUT_MS  (5UL * 60UL * 1000UL)

// ---------------------------------------------------------------------
// Wi-Fi scan (PRD 1 Section 6)
// ---------------------------------------------------------------------
#define WIFI_SCAN_MAX_RESULTS      20
#define BLE_SCAN_CHUNK_PAYLOAD     180   // bytes of scan data per notification chunk

// ---------------------------------------------------------------------
// BLE session handling
// ---------------------------------------------------------------------
#define PARTIAL_STATE_RETENTION_MS (60UL * 1000UL)  // Section 4.4
#define IDENTIFY_DURATION_MS       10000             // Section 5

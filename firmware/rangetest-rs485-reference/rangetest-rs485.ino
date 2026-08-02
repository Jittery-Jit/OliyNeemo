/*
  rangetest-rs485 -- same minimal "is a tag in range" check as rangetest.ino,
  but talks to the reader over a TTL-to-RS485 transceiver instead of wiring
  the reader's UART directly to the ESP32. The protocol/CRC/frame code below
  is unchanged from rangetest.ino / rfid-tester.py (already confirmed working
  against the real reader) -- only the transport layer is new, plus a
  heavier set of debug checks aimed at the failure modes an RS485 hop adds
  on top of a direct wire: direction-control timing, A/B wiring polarity,
  noise/corruption, and flat-out silence.

  WIRING
  ------
  ESP32                  TTL-RS485 module          RS485 bus -> reader
  GPIO17 (TX2)  ------->  DI/TXD (driver in)
  GPIO16 (RX2)  <-------  RO/RXD (receiver out)
  3V3 or 5V     ------->  VCC   (check your module's datasheet -- if its TTL side only
                                 runs at 5V logic, level-shift RO -> GPIO16, since ESP32
                                 GPIOs are 3.3V-only and 5V on RO can damage the pin)
  GND           ------->  GND   ----------------->  GND  (common ground, all the way
                                                           through to the reader/PSU --
                                                           any GND pin on the reader board
                                                           is fine, it's one shared plane)
                                          A  ----->  A (RS485+) on the reader
                                          B  ----->  B (RS485-) on the reader

  This module has no DE/RE pins (auto direction, RS485_AUTO_DIRECTION = true
  below) -- it senses the DI line itself and switches the driver on/off
  automatically. If you ever swap to a module that exposes separate DE/RE
  pins, tie them together, wire them to RS485_DIR_PIN, and flip that define
  back to false.

  If NOTHING ever comes back (every poll times out), the single most common
  cause is A/B swapped -- RS485 A/B labeling is not standardized across
  manufacturers, so "A to A" on the silkscreen is a reasonable starting
  guess, not a guarantee. Try flipping them before anything else.

  Reader side is the same UHFReader18 protocol already validated in
  rangetest.ino: [Len][Addr][Cmd][Data...][CRC_lo][CRC_hi], CRC16 LSB-first
  (poly 0x8408, init 0xFFFF). Cmd 0x01 = inventory (no data), response is
  [Len][Addr][Cmd][Status][NumTags][EPC records...][CRC]. Addr 0x00, 57600
  baud -- unchanged, since a reader's RS485 port is normally the same
  internal UART as its TTL/RS232 port, just on a different line driver.

  Serial Monitor commands (type + Enter):
    RAW    - toggle the per-poll raw TX/RX hex dump (on by default here --
             this is a bring-up sketch)
    STATS  - print the running health counters on demand (also auto-printed
             every STATS_EVERY_N_POLLS polls)

  PAIRING / CONNECTIVITY
  -----------------------
  This sketch also carries the Neemo hub's BLE provisioning + Wi-Fi
  connectivity state machine (Neemo PRD 1 of 2), split across the other
  .h/.cpp files in this folder: hub_state (orchestrator), ble_service
  (NimBLE GATT server), wifi_manager (connect/reconnect/error
  classification), captive_portal, wifi_scan, led_status, nvs_creds. See
  ble_service.h for the GATT UUIDs and wire formats shared with the app.
  It runs independently of the RFID polling below -- RFID logic here is
  unchanged from the pre-pairing version of this sketch.
*/

#define READER_RX_PIN         16     // ESP32 RX2 <- module RO
#define READER_TX_PIN         17     // ESP32 TX2 -> module DI
#define READER_BAUD           57600
#define USB_BAUD              115200
#define FIXED_POWER           30     // max power -- removes "too weak a setting" as a variable

#define RS485_AUTO_DIRECTION  true   // true if your module has no DE/RE pins (auto flow control)
#define RS485_DIR_PIN         4      // module DE+RE tied together -> this GPIO (ignored if auto direction)
#define DIR_SETTLE_US         50     // let the transceiver's driver enable/disable before we drive/read the bus

#define FIRST_BYTE_TIMEOUT_MS 200    // how long we'll wait for the reader to start answering at all
#define IDLE_GAP_MS           15     // how long the line must go quiet before we call a response "done"
#define POLL_INTERVAL_MS      300    // gap between polls
#define STATS_EVERY_N_POLLS   20

#include "hub_state.h"
HubStateMachine hubState;

HardwareSerial readerSerial(2);  // UART2

const uint8_t READER_ADDR = 0x00;
const size_t RESP_BUF_SIZE = 256;

bool debugRaw = true;  // on by default -- this is a bring-up/debug sketch; type RAW to toggle

uint32_t pollCount = 0, timeoutCount = 0, framingErrCount = 0, crcErrCount = 0, validCount = 0, tagCount = 0;

// ---------------------------------------------------------------------
// CRC16 (UHFReader18 protocol, LSB-first) -- identical to rangetest.ino / rfid-tester.py
// ---------------------------------------------------------------------
uint16_t calculateCRC(const uint8_t* data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) {
      if (crc & 0x0001) crc = (crc >> 1) ^ 0x8408;
      else crc >>= 1;
    }
  }
  return crc;
}

// Writes the frame into outFrame, returns its length. Identical to rangetest.ino.
size_t buildFrame(uint8_t addr, uint8_t cmd, const uint8_t* data, size_t dataLen, uint8_t* outFrame) {
  outFrame[0] = (uint8_t)(dataLen + 4);
  outFrame[1] = addr;
  outFrame[2] = cmd;
  for (size_t i = 0; i < dataLen; i++) outFrame[3 + i] = data[i];
  size_t noCrcLen = 3 + dataLen;
  uint16_t crc = calculateCRC(outFrame, noCrcLen);
  outFrame[noCrcLen] = crc & 0xFF;
  outFrame[noCrcLen + 1] = (crc >> 8) & 0xFF;
  return noCrcLen + 2;
}

void printHex(const char* label, const uint8_t* buf, size_t len) {
  Serial.print(label);
  if (len == 0) {
    Serial.println("(nothing)");
    return;
  }
  for (size_t i = 0; i < len; i++) {
    if (buf[i] < 0x10) Serial.print('0');
    Serial.print(buf[i], HEX);
    Serial.print(' ');
  }
  Serial.println();
}

// ---------------------------------------------------------------------
// RS485 transport -- the new layer vs. rangetest.ino's direct wiring
// ---------------------------------------------------------------------
void rs485SetDirection(bool transmit) {
  if (RS485_AUTO_DIRECTION) return;
  digitalWrite(RS485_DIR_PIN, transmit ? HIGH : LOW);
  delayMicroseconds(DIR_SETTLE_US);
}

void rs485Send(const uint8_t* frame, size_t len) {
  while (readerSerial.available()) readerSerial.read();  // drop stale bytes before we speak
  rs485SetDirection(true);
  readerSerial.write(frame, len);
  readerSerial.flush();       // wait for the last bit to actually leave the UART...
  rs485SetDirection(false);   // ...before letting go of the transmit-enable line
  if (debugRaw) printHex("TX: ", frame, len);
}

// Waits up to firstByteTimeoutMs for the reader to say anything at all, then
// keeps draining until the line's been quiet for IDLE_GAP_MS (rather than a
// single fixed delay), so a slightly slow or bursty reply over RS485 doesn't
// get truncated.
size_t rs485Read(uint8_t* buf, size_t maxLen, uint32_t firstByteTimeoutMs) {
  uint32_t deadline = millis() + firstByteTimeoutMs;
  while (millis() < deadline && !readerSerial.available()) {}
  if (!readerSerial.available()) return 0;  // nothing ever came -- timeout

  size_t n = 0;
  uint32_t idleStart = millis();
  while (millis() - idleStart < IDLE_GAP_MS) {
    if (readerSerial.available()) {
      uint8_t b = readerSerial.read();
      if (n < maxLen) buf[n++] = b;  // silently drop past maxLen but keep draining, see below
      idleStart = millis();          // saw a byte -- push the idle deadline back out
    }
  }
  return n;
}

// ---------------------------------------------------------------------
// Frame validation -- NEW vs. rangetest.ino, which trusted resp[3]/resp[4]
// without checking length or CRC at all. Worth doing once RS485 is in the
// picture: a bad A/B connection, missing termination, or a direction-timing
// glitch tends to show up as garbled bytes rather than clean silence.
// ---------------------------------------------------------------------
bool validateFrame(const uint8_t* resp, size_t len) {
  if (len == 0) {
    Serial.println("RX: TIMEOUT -- no bytes came back at all. Check power/wiring/A-B polarity/baud.");
    timeoutCount++;
    return false;
  }

  size_t declaredLen = resp[0];
  if (declaredLen < 2 || declaredLen + 1 != len) {
    Serial.printf("RX: FRAMING ERROR -- Len byte says %u (expects %u total bytes), actually got %u bytes\n",
                  (unsigned)declaredLen, (unsigned)(declaredLen + 1), (unsigned)len);
    framingErrCount++;
    return false;
  }

  uint16_t receivedCrc = resp[len - 2] | (resp[len - 1] << 8);
  uint16_t computedCrc = calculateCRC(resp, len - 2);
  if (receivedCrc != computedCrc) {
    Serial.printf("RX: CRC FAIL -- computed 0x%04X, received 0x%04X (garbled frame -- noise, timing, or wiring)\n",
                  computedCrc, receivedCrc);
    crcErrCount++;
    return false;
  }

  validCount++;
  return true;
}

// Response = [len, addr, cmd, status, numTags, ...]. Same interpretation as rangetest.ino.
// Only call this after validateFrame() has passed.
bool responseHasTag(const uint8_t* resp, size_t len) {
  if (len < 5) return false;
  uint8_t status = resp[3];
  if (status != 0x00 && status != 0x01) return false;
  return resp[4] > 0;
}

// --- Command 0x2F: Set RF Power. Pwr range is 0-30 (roughly dBm). ---
void setPower(uint8_t addr, int power) {
  power = constrain(power, 0, 30);
  uint8_t data[1] = { (uint8_t)power };
  uint8_t frame[8];
  size_t frameLen = buildFrame(addr, 0x2F, data, 1, frame);
  rs485Send(frame, frameLen);

  uint8_t resp[RESP_BUF_SIZE];
  size_t respLen = rs485Read(resp, RESP_BUF_SIZE, FIRST_BYTE_TIMEOUT_MS);
  if (debugRaw) printHex("RX: ", resp, respLen);
  validateFrame(resp, respLen);
}

void printStats() {
  Serial.printf("---- polls=%lu  valid=%lu  tagHits=%lu  timeouts=%lu  framingErr=%lu  crcErr=%lu ----\n",
                pollCount, validCount, tagCount, timeoutCount, framingErrCount, crcErrCount);
}

void pollCommands() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  if (line.equalsIgnoreCase("RAW")) {
    debugRaw = !debugRaw;
    Serial.println(debugRaw ? "Raw byte debug ON." : "Raw byte debug OFF.");
  } else if (line.equalsIgnoreCase("STATS")) {
    printStats();
  }
}

void setup() {
  Serial.begin(USB_BAUD);
  Serial.setTimeout(50);
  delay(200);

  if (!RS485_AUTO_DIRECTION) {
    pinMode(RS485_DIR_PIN, OUTPUT);
    digitalWrite(RS485_DIR_PIN, LOW);  // start in receive mode
  }

  readerSerial.begin(READER_BAUD, SERIAL_8N1, READER_RX_PIN, READER_TX_PIN);

  Serial.println();
  Serial.println("rangetest-rs485 -- tag-in-range check over a TTL-RS485 hop.");
  Serial.printf("Reader UART: %d baud, addr 0x%02X, fixed power %d/30.\n", READER_BAUD, READER_ADDR, FIXED_POWER);
  if (RS485_AUTO_DIRECTION) {
    Serial.println("RS485 direction: automatic (module-controlled)");
  } else {
    Serial.printf("RS485 direction: manual, GPIO%d (HIGH=transmit, LOW=receive)\n", RS485_DIR_PIN);
  }
  Serial.println("Type RAW + Enter to toggle raw TX/RX hex dump, STATS + Enter for a health summary.\n");

  setPower(READER_ADDR, FIXED_POWER);
  Serial.println();

  hubState.begin();
}

void loop() {
  hubState.tick();
  pollCommands();

  uint8_t frame[8];
  size_t frameLen = buildFrame(READER_ADDR, 0x01, nullptr, 0, frame);
  rs485Send(frame, frameLen);

  uint8_t resp[RESP_BUF_SIZE];
  size_t respLen = rs485Read(resp, RESP_BUF_SIZE, FIRST_BYTE_TIMEOUT_MS);
  if (debugRaw) printHex("RX: ", resp, respLen);

  pollCount++;
  if (validateFrame(resp, respLen)) {
    bool tagInRange = responseHasTag(resp, respLen);
    if (tagInRange) tagCount++;
    Serial.println(tagInRange ? "Tag in range: YES" : "Tag in range: NO");
  }

  if (pollCount % STATS_EVERY_N_POLLS == 0) printStats();

  Serial.println();

  // Non-blocking stand-in for the original delay(POLL_INTERVAL_MS): keeps
  // ticking the hub state machine (BLE/Wi-Fi/LED) through the gap instead
  // of a dead wait. rs485Send()/rs485Read() above still block for up to
  // ~FIRST_BYTE_TIMEOUT_MS + IDLE_GAP_MS each poll (unchanged from the
  // original sketch), so hubState.tick() still sees occasional gaps up to
  // ~215ms -- fine against timeouts measured in seconds, and against the
  // LED patterns' fastest components (100-125ms).
  uint32_t pollDeadline = millis() + POLL_INTERVAL_MS;
  while ((int32_t)(pollDeadline - millis()) > 0) {
    hubState.tick();
  }
}

#include "led_status.h"
#include "config.h"

namespace {

struct BlinkStep {
  uint16_t durationMs;
  bool ledOn;
};

// UNPROVISIONED: slow pulse (1Hz)
const BlinkStep PATTERN_UNPROVISIONED[] = { { 500, true }, { 500, false } };
// CONNECTING / RECONNECTING: fast blink (4Hz)
const BlinkStep PATTERN_FAST_BLINK[] = { { 125, true }, { 125, false } };
// PORTAL_PENDING: double blink, repeating
const BlinkStep PATTERN_DOUBLE_BLINK[] = { { 120, true }, { 120, false }, { 120, true }, { 640, false } };
// FAILED: triple blink, repeating
const BlinkStep PATTERN_TRIPLE_BLINK[] = {
  { 100, true }, { 100, false }, { 100, true }, { 100, false }, { 100, true }, { 700, false }
};
// Identify: deliberately faster/snappier than FAILED's triple blink so the
// two are never confused when several hubs are blinking in the same room
// (PRD 1 Section 5 -- must be visually distinct from every state pattern).
const BlinkStep PATTERN_IDENTIFY[] = {
  { 60, true }, { 60, false }, { 60, true }, { 60, false }, { 60, true }, { 500, false }
};

void runPattern(const BlinkStep* steps, size_t count, uint32_t referenceMs) {
  uint32_t total = 0;
  for (size_t i = 0; i < count; i++) total += steps[i].durationMs;
  uint32_t elapsed = (millis() - referenceMs) % total;
  uint32_t acc = 0;
  for (size_t i = 0; i < count; i++) {
    acc += steps[i].durationMs;
    if (elapsed < acc) {
      digitalWrite(STATUS_LED_PIN, steps[i].ledOn ? HIGH : LOW);
      return;
    }
  }
}

}  // namespace

void LedStatus::begin() {
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);
  patternStartMs_ = millis();
}

void LedStatus::setHubState(HubState state) {
  if (state == state_) return;
  state_ = state;
  patternStartMs_ = millis();  // restart the new pattern cleanly from phase 0
}

void LedStatus::triggerIdentify() {
  identifying_ = true;
  identifyStartMs_ = millis();
}

void LedStatus::tick() {
  if (identifying_) {
    if (millis() - identifyStartMs_ >= IDENTIFY_DURATION_MS) {
      identifying_ = false;
      patternStartMs_ = millis();  // resume the state pattern from phase 0
    } else {
      runPattern(PATTERN_IDENTIFY, sizeof(PATTERN_IDENTIFY) / sizeof(BlinkStep), identifyStartMs_);
      return;
    }
  }

  switch (state_) {
    case HubState::UNPROVISIONED:
      runPattern(PATTERN_UNPROVISIONED, sizeof(PATTERN_UNPROVISIONED) / sizeof(BlinkStep), patternStartMs_);
      break;
    case HubState::CONNECTING:
    case HubState::RECONNECTING:
      runPattern(PATTERN_FAST_BLINK, sizeof(PATTERN_FAST_BLINK) / sizeof(BlinkStep), patternStartMs_);
      break;
    case HubState::PORTAL_PENDING:
      runPattern(PATTERN_DOUBLE_BLINK, sizeof(PATTERN_DOUBLE_BLINK) / sizeof(BlinkStep), patternStartMs_);
      break;
    case HubState::ONLINE:
      digitalWrite(STATUS_LED_PIN, HIGH);
      break;
    case HubState::FAILED:
      runPattern(PATTERN_TRIPLE_BLINK, sizeof(PATTERN_TRIPLE_BLINK) / sizeof(BlinkStep), patternStartMs_);
      break;
  }
}

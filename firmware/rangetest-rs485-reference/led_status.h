// Non-blocking LED status driver -- PRD 1 Section 3 (state patterns) and
// Section 5 (identify). Call tick() every loop() iteration; never delay().
#pragma once

#include <Arduino.h>
#include "hub_types.h"

class LedStatus {
public:
  void begin();
  void setHubState(HubState state);
  void triggerIdentify();
  void tick();

private:
  HubState state_ = HubState::UNPROVISIONED;
  uint32_t patternStartMs_ = 0;
  bool identifying_ = false;
  uint32_t identifyStartMs_ = 0;
};

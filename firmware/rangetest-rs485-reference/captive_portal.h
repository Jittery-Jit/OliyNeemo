// Captive portal detection and handling -- PRD 1 Section 9.
//
// No HTML/DOM parser is bundled with the Arduino core and pulling one in
// isn't worth the RAM budget (Section 12), so form inspection here is a
// small hand-rolled scanner: strip <script>/<style>, find the first <form>,
// walk its <input> tags. This is intentionally limited to what Section 9.2
// actually asks for (checkbox/submit-only vs. anything requiring a human),
// not general HTML parsing -- see Section 9.4's explicit non-goals.
#pragma once

#include <Arduino.h>
#include "hub_types.h"
#include "config.h"

#if NEEMO_ENABLE_CAPTIVE_PORTAL

class CaptivePortal {
public:
  // Section 9.1. Blocking GET to CONNECTIVITY_CHECK_URL.
  PortalProbeResult probe();

  // Section 9.2. Only meaningful after probe() returns PORTAL_DETECTED.
  // Fetches (following up to a few plain-HTTP redirect hops) and classifies
  // the portal page. Returns false only on a hard local failure (e.g. could
  // not even open a connection); a page that doesn't parse as a form is
  // still a successful call with outClass == COMPLEX, per "stop, don't
  // retry" in the spec.
  bool fetchAndTriage(PortalClass& outClass, PortalInfo& outInfo);

  // Section 9.3. Submits the checkbox/submit-only form found during
  // fetchAndTriage(). Caller re-runs probe() afterward to see whether the
  // network actually opened up.
  bool submitConsent();

private:
  String pendingUrl_;      // set by probe(): redirect target, or the check URL itself
  String lastPortalUrl_;   // URL the portal page was actually fetched from
  String formAction_;      // absolute URL to submit consent to
  String formFieldNames_;  // comma-separated checkbox/hidden field names to check

  bool parseForm(const String& html, const String& pageUrl, PortalClass& outClass, PortalInfo& outInfo);
  static String extractAttr(const String& tag, const String& attrName);
  static String stripTags(const String& html, size_t maxLen);
  static String removeBlock(String html, const char* tagName);
  static String resolveUrl(const String& baseUrl, const String& action);
};

#endif  // NEEMO_ENABLE_CAPTIVE_PORTAL

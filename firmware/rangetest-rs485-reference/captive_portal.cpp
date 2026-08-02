#include "captive_portal.h"
#include "config.h"

#if NEEMO_ENABLE_CAPTIVE_PORTAL

#include <HTTPClient.h>

namespace {
const int kMaxTermsLen = 1024;  // stays under NimBLE's max attribute length with margin
}

String CaptivePortal::extractAttr(const String& tag, const String& attrName) {
  String tagLower = tag;
  tagLower.toLowerCase();
  String needle = attrName + "=";
  int idx = tagLower.indexOf(needle);
  if (idx < 0) return "";
  int valStart = idx + needle.length();
  if (valStart >= (int)tag.length()) return "";
  char quote = tag[valStart];
  if (quote == '"' || quote == '\'') {
    int valEnd = tag.indexOf(quote, valStart + 1);
    if (valEnd < 0) return "";
    return tag.substring(valStart + 1, valEnd);
  }
  int valEnd = valStart;
  while (valEnd < (int)tag.length() && tag[valEnd] != ' ' && tag[valEnd] != '>' && tag[valEnd] != '\t') valEnd++;
  return tag.substring(valStart, valEnd);
}

String CaptivePortal::removeBlock(String html, const char* tagName) {
  String lower = html;
  lower.toLowerCase();
  String openTag = String("<") + tagName;
  String closeTag = String("</") + tagName + ">";
  int pos;
  while ((pos = lower.indexOf(openTag)) >= 0) {
    int closePos = lower.indexOf(closeTag, pos);
    int end = (closePos < 0) ? html.length() : closePos + closeTag.length();
    html.remove(pos, end - pos);
    lower.remove(pos, end - pos);
  }
  return html;
}

String CaptivePortal::stripTags(const String& html, size_t maxLen) {
  String out;
  out.reserve(min(maxLen, (size_t)html.length()));
  bool inTag = false;
  bool lastWasSpace = true;
  for (size_t i = 0; i < html.length() && out.length() < maxLen; i++) {
    char c = html[i];
    if (c == '<') { inTag = true; continue; }
    if (c == '>') { inTag = false; continue; }
    if (inTag) continue;
    if (c == '\r' || c == '\n' || c == '\t') c = ' ';
    if (c == ' ') {
      if (lastWasSpace) continue;
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    out += c;
  }
  out.trim();
  return out;
}

String CaptivePortal::resolveUrl(const String& baseUrl, const String& action) {
  if (action.length() == 0) return baseUrl;
  String actionLower = action;
  actionLower.toLowerCase();
  if (actionLower.startsWith("http://") || actionLower.startsWith("https://")) return action;

  int schemeEnd = baseUrl.indexOf("://");
  int hostStart = (schemeEnd < 0) ? 0 : schemeEnd + 3;
  int pathStart = baseUrl.indexOf('/', hostStart);
  String origin = (pathStart < 0) ? baseUrl : baseUrl.substring(0, pathStart);

  if (action.startsWith("/")) return origin + action;

  String basePath = (pathStart < 0) ? "/" : baseUrl.substring(pathStart);
  int lastSlash = basePath.lastIndexOf('/');
  String dir = (lastSlash < 0) ? "/" : basePath.substring(0, lastSlash + 1);
  return origin + dir + action;
}

PortalProbeResult CaptivePortal::probe() {
  pendingUrl_ = "";
  HTTPClient http;
  http.setTimeout(PORTAL_PROBE_TIMEOUT_MS);
  http.setConnectTimeout(PORTAL_PROBE_TIMEOUT_MS);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(CONNECTIVITY_CHECK_URL)) return PortalProbeResult::NO_INTERNET;

  int code = http.GET();
  if (code < 0) {
    http.end();
    return PortalProbeResult::NO_INTERNET;  // DNS failure, timeout, connection refused, etc.
  }
  if (code == 204) {
    http.end();
    return PortalProbeResult::CLEAN;
  }
  if (code >= 300 && code < 400) {
    String location = http.header("Location");
    http.end();
    if (location.length() == 0) return PortalProbeResult::NO_INTERNET;
    pendingUrl_ = location;
    return PortalProbeResult::PORTAL_DETECTED;
  }
  if (code == 200) {
    // Some portals intercept the check URL itself and serve the portal page in place,
    // rather than redirecting -- treat the check URL as the portal page.
    pendingUrl_ = CONNECTIVITY_CHECK_URL;
    http.end();
    return PortalProbeResult::PORTAL_DETECTED;
  }
  http.end();
  return PortalProbeResult::NO_INTERNET;  // unexpected status -- neither clean nor portal-shaped
}

bool CaptivePortal::fetchAndTriage(PortalClass& outClass, PortalInfo& outInfo) {
  String url = pendingUrl_;
  if (url.length() == 0) {
    outClass = PortalClass::COMPLEX;
    return false;
  }

  for (int hop = 0; hop < 3; hop++) {
    if (url.startsWith("https://")) {
      // Non-goal: no HTTPS portal handling (Section 9.4).
      outClass = PortalClass::COMPLEX;
      return true;
    }

    HTTPClient http;
    http.setTimeout(PORTAL_PROBE_TIMEOUT_MS);
    http.setConnectTimeout(PORTAL_PROBE_TIMEOUT_MS);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    if (!http.begin(url)) {
      outClass = PortalClass::COMPLEX;
      return false;
    }

    int code = http.GET();
    if (code >= 300 && code < 400) {
      String location = http.header("Location");
      http.end();
      if (location.length() == 0) {
        outClass = PortalClass::COMPLEX;
        return true;
      }
      url = resolveUrl(url, location);
      continue;
    }
    if (code != 200) {
      http.end();
      outClass = PortalClass::COMPLEX;  // couldn't retrieve a parseable page -- stop, don't retry
      return true;
    }

    String body = http.getString();
    http.end();
    lastPortalUrl_ = url;
    return parseForm(body, url, outClass, outInfo);
  }

  outClass = PortalClass::COMPLEX;  // exhausted redirect hops without landing on a page
  return true;
}

bool CaptivePortal::parseForm(const String& htmlRaw, const String& pageUrl, PortalClass& outClass, PortalInfo& outInfo) {
  String html = removeBlock(removeBlock(htmlRaw, "script"), "style");
  String lower = html;
  lower.toLowerCase();

  int formStart = lower.indexOf("<form");
  if (formStart < 0) {
    outClass = PortalClass::COMPLEX;  // no parseable HTML form
    return true;
  }
  int formTagEnd = lower.indexOf('>', formStart);
  if (formTagEnd < 0) {
    outClass = PortalClass::COMPLEX;
    return true;
  }
  int formEnd = lower.indexOf("</form>", formTagEnd);
  if (formEnd < 0) formEnd = html.length();

  String formOpenTag = html.substring(formStart, formTagEnd + 1);
  String formBody = html.substring(formTagEnd + 1, formEnd);
  String formBodyLower = lower.substring(formTagEnd + 1, formEnd);

  bool hasCredentialField = false;
  bool hasOtherInput = false;
  String fieldNames;

  int pos = 0;
  while (true) {
    int inputPos = formBodyLower.indexOf("<input", pos);
    if (inputPos < 0) break;
    int tagEnd = formBodyLower.indexOf('>', inputPos);
    if (tagEnd < 0) break;
    String inputTag = formBody.substring(inputPos, tagEnd + 1);

    String type = extractAttr(inputTag, "type");
    type.toLowerCase();
    String name = extractAttr(inputTag, "name");
    String nameLower = name;
    nameLower.toLowerCase();

    if (type == "password" || type == "email") hasCredentialField = true;
    if (nameLower.indexOf("user") >= 0 || nameLower.indexOf("pass") >= 0 ||
        nameLower.indexOf("email") >= 0 || nameLower.indexOf("id") >= 0) {
      hasCredentialField = true;
    }

    // "hidden" is allowed alongside checkbox/submit even though the spec's
    // wording is "only checkbox and/or submit" -- real portals almost
    // always carry a hidden CSRF/session token, and it collects nothing
    // from the human. Anything else (free text, radio, etc.) pushes this
    // to COMPLEX since it wasn't explicitly cleared as safe.
    if (type != "checkbox" && type != "submit" && type != "hidden" && type != "button") {
      hasOtherInput = true;
    }
    if (type == "checkbox" || type == "hidden") {
      if (name.length() > 0) {
        if (fieldNames.length() > 0) fieldNames += ",";
        fieldNames += name;
      }
    }

    pos = tagEnd + 1;
  }

  if (hasCredentialField || hasOtherInput) {
    outClass = PortalClass::COMPLEX;
    return true;
  }

  outClass = PortalClass::SIMPLE;
  String action = extractAttr(formOpenTag, "action");
  formAction_ = resolveUrl(pageUrl, action);
  formFieldNames_ = fieldNames;

  outInfo.termsText = stripTags(html, kMaxTermsLen);
  outInfo.formAction = formAction_;
  outInfo.formFieldNames = formFieldNames_;
  return true;
}

bool CaptivePortal::submitConsent() {
  if (formAction_.length() == 0 || formAction_.startsWith("https://")) return false;

  String url = formAction_;
  if (formFieldNames_.length() > 0) {
    url += (url.indexOf('?') >= 0) ? "&" : "?";
    String q;
    int start = 0;
    while (start < (int)formFieldNames_.length()) {
      int comma = formFieldNames_.indexOf(',', start);
      String name = (comma < 0) ? formFieldNames_.substring(start) : formFieldNames_.substring(start, comma);
      if (name.length() > 0) {
        if (q.length() > 0) q += "&";
        q += name + "=on";
      }
      if (comma < 0) break;
      start = comma + 1;
    }
    url += q;
  }

  HTTPClient http;
  http.setTimeout(PORTAL_PROBE_TIMEOUT_MS);
  http.setConnectTimeout(PORTAL_PROBE_TIMEOUT_MS);
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  if (!http.begin(url)) return false;
  int code = http.GET();
  http.end();
  return code > 0;  // fired successfully; caller re-probes to see if it actually opened the network
}

#endif  // NEEMO_ENABLE_CAPTIVE_PORTAL

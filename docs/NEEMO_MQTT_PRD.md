# Neemo MQTT Hub Integration — Product Requirements Document

**Status:** Implemented compatibility MVP aligned with the working RFID Hub fleet  
**Scope:** Hub discovery, room assignment, live status, tag ingestion, item labelling, and location calculations  
**Primary integration reference:** `MQTT_INTEGRATION_GUIDE.md`  
**MQTT learning reference:** [Arduino — Sending Data over MQTT](https://docs.arduino.cc/tutorials/uno-wifi-rev2/uno-wifi-r2-mqtt-device-to-device/)  
**Target products:** Neemo web app/PWA, Neemo HTTPS backend, Neemo Local Gateway, and the existing ESP32 RFID Hubs

## 1. Purpose

Neemo will use the MQTT communication already implemented on the ESP32 RFID Hubs. The system must replace the laptop’s current manual role without changing the working Hub topic or payload contract during the MVP.

The finished system will:

- discover any compatible Hub publishing on the local network;
- let an owner or admin name the Hub and assign it to a room;
- show whether each Hub is currently active;
- receive real EPC and reader power-level data;
- store the latest item observations in the shared Neemo backend;
- use observations from several measured Hubs for item location calculations; and
- remove Bluetooth from the active Neemo pairing and scanning experience.

## 2. Source-of-truth order

If implementation details conflict, engineers must use this order:

1. The working files listed in `MQTT_INTEGRATION_GUIDE.md`, especially:
   - `mqtt-rfid-publish/mqtt-rfid-publish.ino`
   - `mqtt-rfid-publish/secrets.h`
   - `mosquitto/mosquitto.conf`
   - `start_broker.py`
   - `mqtt_table_client.py`
   - `secrets.py`
2. `MQTT_INTEGRATION_GUIDE.md`
3. This PRD
4. The Arduino tutorial, which supplies the general publisher/subscriber pattern but not Neemo’s exact topics or payloads

The current Hub firmware is already publishing correctly. The MVP must adapt Neemo to that firmware instead of replacing its MQTT contract.

## 3. Confirmed current Hub behavior

Each ESP32 Hub already:

- reads its UHF RFID reader over RS485;
- connects to its configured Wi‑Fi network;
- connects to an MQTT broker using `PubSubClient`;
- creates a stable Hub identifier from its Wi‑Fi MAC address;
- publishes confirmed tag readings;
- publishes a heartbeat every five seconds;
- reconnects to Wi‑Fi and MQTT after interruptions; and
- subscribes to a reserved command topic, although commands are not acted on yet.

### 3.1 Current limitations

- The supplied reference project used a local Mosquitto instance. Neemo’s Local Gateway now supplies its own wire-compatible broker so users do not install Mosquitto.
- The current broker listens on TCP port `1883`.
- The current broker allows anonymous clients.
- Messages use QoS 0.
- Messages are not retained.
- No MQTT Last Will is configured.
- Hubs must be able to reach the broker over the local network.
- The MQTT command channel is scaffolding only.
- Wi‑Fi and broker settings are currently placed in each Hub’s `secrets.h`.

These limitations define the compatibility-first MVP. Security and remote access improvements are a later phase because they require coordinated broker and firmware changes.

## 4. Product architecture

### 4.1 Required components

**ESP32 RFID Hubs**

- Continue using their current MQTT firmware.
- Publish to the exact existing topics.
- Require no new pairing-code, JSON, QoS, retained-message, or command behavior for the MVP.

**Local MQTT broker**

- Accepts connections from every Hub on the same reachable network.
- Runs inside the Neemo Local Gateway using a compatible embedded MQTT 3.1/3.1.1 broker.
- Uses the current port and anonymous configuration during trusted-LAN testing.

**Neemo Local Gateway**

- Replaces the laptop’s current MQTT subscriber role.
- Runs continuously on a device that can reach the local broker.
- Subscribes to `rfid-hub/#`.
- Parses and validates Hub messages.
- Sends normalized Hub status and tag readings to the hosted Neemo backend over HTTPS.
- Authenticates to Neemo using a team-specific gateway token.

**Neemo HTTPS backend**

- Stores teams, rooms, Hubs, measurements, items, scans, and observations.
- Associates a MAC-derived Hub ID with one Neemo team and room.
- Accepts authenticated observations from the Local Gateway.
- Provides the existing browser app with Hub and item data.

**Neemo web app/PWA**

- Never opens a raw MQTT connection or hosts a TCP broker.
- Communicates only with the Neemo HTTPS backend.
- Shows newly discovered Hubs, active/offline status, item readings, and room maps.

### 4.2 Communication path

```text
UHF RFID reader
       ↕ RS485
ESP32 Hub(s)
       ↕ Wi‑Fi / MQTT on local network
Local MQTT broker
       ↕ MQTT subscription
Neemo Local Gateway
       ↕ authenticated HTTPS
Neemo backend
       ↕ HTTPS
Neemo web app/PWA
```

### 4.3 Why a Local Gateway is required

A hosted HTTPS website cannot listen on `0.0.0.0:1883`, accept incoming TCP connections from LAN devices, or safely embed a broker password. Therefore, “the app hosts the broker and subscribes” must be implemented as a local companion service or dedicated gateway, not inside the browser page itself.

The gateway and broker may run:

- together on the existing laptop during development;
- on the current Mac laptop during the MVP;
- on a Windows laptop or another Node.js-capable desktop when needed;
- in a future packaged Neemo desktop application; or
- as separate services on another always-on LAN device.

The implemented MVP is Mac-first and cross-platform: a Node.js Local Gateway starts its own compatible MQTT broker on macOS or Windows. Each launcher uses an existing compatible Node.js or downloads an official checksum-verified private runtime into the Neemo folder. Users do not install Homebrew or Mosquitto. The final iOS/Google Play broker approach remains a future product decision because a hosted website cannot listen for raw LAN MQTT traffic.

## 5. MQTT broker requirements

### 5.1 MVP compatibility mode

The working development configuration is:

```conf
listener 1883 0.0.0.0
allow_anonymous true

log_dest stdout
log_type notice
log_type warning
log_type error
```

Requirements:

- Bind to `0.0.0.0`, not only `127.0.0.1`.
- Listen on port `1883`.
- Be reachable from every ESP32 Hub.
- Allow anonymous connections until the Hub firmware is updated with authentication.
- Run on a trusted private LAN only.
- Use a stable LAN address, preferably a router DHCP reservation.

### 5.2 Production mode

Before deployment on an untrusted or Internet-accessible network:

- enable broker authentication;
- create separate credentials for the gateway and Hubs;
- add topic access controls;
- enable TLS on `[production MQTT TLS port]`;
- update each Hub’s `secrets.h` or provisioning process;
- rotate all development credentials; and
- disable anonymous access.

The app must never expose broker credentials in browser code.

## 6. Existing topic contract

All topics use a MAC-derived Hub ID:

1. Read the ESP32 Wi‑Fi MAC address.
2. Remove colons.
3. convert it to uppercase hexadecimal.

Example:

```text
AA:BB:CC:DD:EE:FF → AABBCCDDEEFF
```

| Purpose               | Topic                         | Direction     | Current behavior                     |
| --------------------- | ----------------------------- | ------------- | ------------------------------------ |
| Confirmed tag reading | `rfid-hub/<mac>/rfid/tag`     | Hub → gateway | Functional                           |
| Heartbeat             | `rfid-hub/<mac>/status/hello` | Hub → gateway | Functional                           |
| Reserved commands     | `rfid-hub/<mac>/cmd/#`        | Gateway → Hub | Received and printed only; no action |

The gateway subscribes to:

```text
rfid-hub/#
```

This wildcard allows new Hubs to appear without pre-registering their MAC addresses.

### 6.1 Topic validation

The gateway must accept only topics matching:

```regex
^rfid-hub/([0-9A-F]{12})/(.+)$
```

Parsed values:

```text
parts[0] = "rfid-hub"
parts[1] = MAC-derived Hub ID
parts[2] = "rfid", "status", or "cmd"
parts[3] = subtype such as "tag" or "hello"
```

The MAC-derived Hub ID is treated as an opaque, stable hardware identifier. User-facing names are stored separately in Neemo.

### 6.2 MQTT client IDs

Each ESP32 connects with:

```text
esp32-rfid-hub-<mac>
```

The Local Gateway must use its own unique client ID:

```text
neemo-gateway-<gatewayId>
```

No two connected MQTT clients may share a client ID.

## 7. Tag-reading payload

### 7.1 Current format

Single tag:

```text
<EPC>,<level>
```

Multiple tags confirmed in the same cycle:

```text
<EPC_1>,<EPC_2>,...,<EPC_N>,<level>
```

Examples:

```text
E200341201234567,18
E200341201234567,E200341201238899,4
```

### 7.2 Parsing requirements

The gateway must:

1. Decode the payload as ASCII.
2. Split on commas.
3. Treat the final field as `level`.
4. Treat every preceding field as a separate EPC.
5. Trim whitespace.
6. Validate each EPC as an uppercase hexadecimal string.
7. Accept varying EPC lengths.
8. Parse `level` as an integer from `0` through `30`.
9. Reject the complete message if the last field is not a valid level.
10. Create one normalized observation per EPC.

The parser must not assume exactly two comma-separated fields.

### 7.3 Power-level meaning

The reader uses a climb-then-confirm algorithm:

- it begins at RF power level 0;
- increases power until it detects a tag;
- requires a second consecutive successful read at that level;
- publishes the confirmed EPC(s) and level; and
- resets to power level 0.

Therefore:

- lower level = detected using less RF power = generally closer/stronger;
- higher level = required more RF power = generally farther/weaker.

The value is not dBm and is not an exact physical distance. Neemo must calibrate its relative-distance model using real measurements before claiming precise location accuracy.

### 7.4 Delivery behavior

- QoS: 0
- Retained: No
- Frequency: Irregular
- A Hub with no detected tag publishes no tag message.
- A late subscriber receives no previous readings.

The gateway must persist accepted observations immediately so the app can show the latest known reading after reconnecting.

## 8. Heartbeat and online status

**Topic**

```text
rfid-hub/<mac>/status/hello
```

**Payload**

```text
hello world
```

**Current frequency:** every five seconds while the Hub has Wi‑Fi and MQTT  
**QoS:** 0  
**Retained:** No

The gateway updates `lastSeenAt` whenever it receives this message.

Neemo status rules:

- **Active:** last heartbeat received within 15 seconds.
- **Delayed:** last heartbeat received 15–30 seconds ago.
- **Offline:** no heartbeat for more than 30 seconds.
- **Never seen:** Hub record exists but no heartbeat has been stored.

The app must not rely on an MQTT offline message because the current firmware has no Last Will.

## 9. Hub discovery and pairing

With the current firmware, MQTT pairing means discovering and claiming a MAC-identified Hub. It does not mean sending Wi‑Fi credentials or a pairing code to the Hub.

### 9.1 Prerequisites

Before discovery:

- a local broker is running;
- the broker is reachable at its LAN IP on port `1883`;
- the Hub firmware contains the correct Wi‑Fi and broker address;
- the Hub and broker can route to each other; and
- the Local Gateway is connected and subscribed to `rfid-hub/#`.

### 9.2 User flow

1. An owner or admin opens **Hubs** and chooses a room.
2. They press **Find Hubs on this network**.
3. Neemo shows a waiting screen and refreshes pending discoveries from the backend.
4. The Local Gateway receives a heartbeat or tag topic from an unknown MAC.
5. The gateway sends the MAC-derived ID and `lastSeenAt` to the backend.
6. The Hub appears as **New Hub AABBCCDDEEFF**.
7. The user selects it and confirms:
   - Hub name;
   - room;
   - optional notes; and
   - wall measurements.
8. The backend marks that hardware ID as claimed by the current team.
9. The Hub appears in the normal room Hub list.

No fake Hub is created. If no real heartbeat or tag topic is received, no Hub appears.

### 9.3 Ownership rules

- Only an owner or admin can claim, rename, move, measure, or remove a Hub.
- A Hub hardware ID may belong to only one active team.
- Removing a Hub removes its Neemo association but does not erase its firmware.
- Reassigning a Hub requires an owner/admin to remove its existing Neemo association with confirmation. It can then be claimed by another team only after that team’s authenticated Gateway sees the physical Hub.

### 9.4 Wi‑Fi and broker setup outside Neemo

The current Hub firmware takes Wi‑Fi and broker information from `secrets.h`. Until separate provisioning firmware is approved, Neemo must explain that the Hub must be configured and flashed before it can appear.

Future work may add a temporary setup network or another provisioning method, but it is not part of this compatibility MVP.

## 10. Local Gateway requirements

The gateway should port the behavior of `mqtt_table_client.py`.

### 10.1 Connection

- Connect to the laptop’s detected local-network IP on port `1883`.
- Use a unique gateway client ID.
- Subscribe to `rfid-hub/#` after every connection or reconnection.
- Retry broker connections automatically.
- Record its own health and last broker message time.

### 10.2 Routing

For every message:

1. Validate and parse the topic.
2. Extract the MAC-derived Hub ID.
3. Route `rfid/tag` to the tag parser.
4. Route `status/hello` to heartbeat handling.
5. Ignore unexpected `cmd` messages.
6. Reject unsupported topics without crashing.
7. Submit normalized information to the Neemo backend through HTTPS.

### 10.3 Backend submissions

The gateway sends:

**Gateway health**

```json
{
	"type": "gateway_heartbeat",
	"brokerConnected": true,
	"brokerHost": "192.168.1.25",
	"brokerPort": 1883
}
```

**Hub heartbeat**

```json
{
	"type": "hub_heartbeat",
	"hardwareId": "AABBCCDDEEFF",
	"topic": "rfid-hub/AABBCCDDEEFF/status/hello",
	"observedAt": 1760000000000
}
```

**Tag observations**

```json
{
	"type": "tag_readings",
	"hardwareId": "AABBCCDDEEFF",
	"topic": "rfid-hub/AABBCCDDEEFF/rfid/tag",
	"observedAt": 1760000000000,
	"readings": [
		{
			"epc": "E200341201234567",
			"powerLevel": 18
		}
	]
}
```

The gateway sends these messages to `POST /api/gateways/ingest` and authenticates with `Authorization: Bearer <gateway-token>`. The authenticated token, rather than a caller-supplied `gatewayId`, determines the Gateway and team. The token is stored outside browser code and must never be logged with Wi‑Fi or broker credentials.

Registration uses a single-use code:

1. An owner/admin requests a 10-minute code from `POST /api/gateways`.
2. The companion exchanges it at `POST /api/gateways/register`.
3. The backend stores only the SHA-256 token hash.
4. The companion stores the returned raw token in `.neemo-gateway.json` with owner-only permissions.
5. Revoking the Gateway immediately prevents further ingestion.

### 10.4 Local buffering

Because current Hub messages are QoS 0 and not retained, the gateway should buffer HTTPS submissions temporarily when the Internet/backend is unavailable:

- buffer for up to 15 minutes;
- keep at most 10,000 pending events;
- retry with exponential backoff;
- preserve original `observedAt`;
- deduplicate using gateway ID, hardware ID, topic, payload, and timestamp window; and
- discard oldest buffered records when the limit is reached.

## 11. Backend requirements

The backend must:

- register and revoke Local Gateways;
- authenticate gateway submissions;
- store unknown Hub discoveries separately from claimed Hubs;
- enforce one active team per MAC-derived hardware ID;
- store Hub names independently from hardware IDs;
- store `lastSeenAt` from heartbeats;
- infer active/delayed/offline status;
- store every valid EPC/power-level observation;
- associate observations with the correct Hub and room;
- make the latest observation available after app restarts;
- support active scan windows without requiring Hub commands;
- reject observations from revoked gateways; and
- avoid showing low-level ingestion errors to ordinary users.

## 12. App requirements

### 12.1 Hubs page

- Replace **Add demo Hub** with **Find Hubs on this network**.
- Keep the existing Hub list visible while refreshing.
- Show the selected room.
- List newly discovered, unclaimed hardware separately.
- Show a shortened ID such as `…DDEEFF`.
- Allow owners/admins to name and claim a real Hub.
- Show Active, Delayed, Offline, or Never seen.
- Show the latest heartbeat time.
- Retain room measurement and Hub placement controls.
- Provide simple troubleshooting for broker, gateway, Wi‑Fi, and power issues.
- Do not show Bluetooth permissions or Bluetooth terminology.

### 12.2 Gateway setup

The Account or Hubs page must show:

- whether a Local Gateway has checked in;
- the gateway’s friendly name;
- last gateway check-in time;
- the expected local broker address;
- a setup-code flow for registering the gateway; and
- instructions for starting the gateway on Mac and Windows.

### 12.3 Room requirement

If the team has no rooms, the user creates a named room before claiming a Hub. Discovery may still occur, but claiming remains disabled until a room exists.

## 13. Item logging and location scans

The current Hub firmware continuously performs its climb-then-confirm reading cycle. Its `cmd/#` subscription does not start a scan.

Therefore, Neemo scanning works as an app-side time window:

1. The user starts **Log an item** or **Locate item**.
2. The backend opens a scan session for the selected room and time range.
3. No MQTT command is required.
4. Incoming observations from that room’s Hubs are associated with the open scan.
5. A label scan displays previously unlabelled EPCs received during the window.
6. A location scan keeps observations matching the selected item EPC.
7. The scan closes after 8 seconds.
8. The backend calculates the result from the Hubs that observed the tag.

The app must not claim that a Hub was remotely triggered.

### 13.1 Relative location

For each EPC:

- group readings by Hub hardware ID;
- map each Hub to its measured room coordinates;
- treat a lower power level as stronger/closer evidence;
- aggregate repeated readings during the scan;
- require three or more measured Hubs for trilateration;
- use one or two Hubs only for a low-confidence proximity result;
- show uncertainty instead of an “exact” location; and
- retain the last observation time and contributing Hub count.

Physical calibration is required because tag orientation, reflections, reader differences, baud/address quirks, and RF environment affect the relationship between power level and distance.

## 14. Commands

The topic `rfid-hub/<mac>/cmd/#` is reserved but not functional. During the MVP:

- the app does not expose identify, restart, reset, or scan-command controls;
- the gateway does not assume a command was executed;
- publishing test messages is limited to developer diagnostics; and
- user-facing success messages are prohibited unless firmware returns a real acknowledgement.

Remote commands require a future firmware update plus a command/result contract.

## 15. Reliability and timing

| Event                  | Current behavior                               | Neemo requirement                                     |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Heartbeat              | Every 5 seconds                                | Update Hub last-seen                                  |
| Tag reading            | Only after confirmed climb-then-confirm result | Persist immediately                                   |
| Wi‑Fi retry            | Continuous, 20-second attempt timeout          | Show offline after stale heartbeat                    |
| MQTT retry             | Every 5 seconds                                | Gateway and Hub recover without re-claiming           |
| RFID polling           | Continues without network                      | Explain that offline readings are not delivered later |
| Gateway/backend outage | No current Hub persistence                     | Gateway buffers normalized submissions                |

The backend is the durable source for last-known item and Hub state. MQTT itself is not used as the history database.

## 16. Security stages

### 16.1 Trusted-LAN MVP

- Port `1883`
- Anonymous broker access
- No TLS
- Same trusted private LAN
- No router port-forwarding
- No Internet exposure
- Clear in-product warning that the mode is for development/testing

### 16.2 Production readiness

Production requires:

- TLS;
- authenticated broker clients;
- per-Hub credentials;
- gateway credentials;
- topic access controls;
- credential rotation/revocation;
- secure firmware secret provisioning; and
- removal of anonymous access.

Any broker password previously shared in chat or documentation must be rotated and stored only through an approved secret mechanism.

## 17. BLE removal

The MQTT MVP replaces the active Bluetooth path in Neemo.

Completion requires:

- no Web Bluetooth pairing UI;
- no Bluetooth permission prompt;
- no browser BLE tag-reader connection;
- no user-facing instruction that requires an installed Bluetooth app;
- no production scan path that depends on BLE;
- tests based on the real MQTT topic/payload contract; and
- archival or removal of unused BLE-specific app/mobile code after MQTT field validation.

The known-working MQTT firmware remains the Hub-side source of truth. BLE files must not be deleted from a different firmware branch until the working MQTT sketch and RS485 behavior are safely preserved.

## 18. Hardware caveats

- Different UHF reader units may use different RS485 addresses or baud rates.
- A silent Hub may be a reader configuration issue rather than an MQTT issue.
- The onboard reader buzzer remains a separate hardware problem.
- EPC detection strength depends on tag orientation and environment.
- These issues must be documented without presenting them as app failures.

## 19. Failure handling

| Failure                        | App behavior                        | System behavior                   |
| ------------------------------ | ----------------------------------- | --------------------------------- |
| Broker not running             | Show gateway/broker troubleshooting | Gateway retries                   |
| Broker bound only to localhost | Explain that Hubs cannot reach it   | Require `0.0.0.0` bind            |
| Wrong broker IP in Hub         | Hub never appears                   | Direct user to Hub configuration  |
| Hub heartbeat becomes stale    | Show Delayed, then Offline          | Preserve last-known data          |
| Gateway loses Internet         | Show gateway status delay           | Buffer HTTPS submissions          |
| Malformed topic                | No user-facing crash                | Gateway rejects safely            |
| Invalid power level            | Do not create observation           | Gateway records safe diagnostic   |
| Multiple EPC payload           | Show all valid tags                 | Parse final field as shared level |
| No readings during scan        | Show “No tag detected”              | Never invent sample data          |
| Command published              | Do not show success                 | Firmware currently only prints it |

## 20. Acceptance criteria

1. The gateway connects to the working local broker and subscribes to `rfid-hub/#`.
2. A heartbeat from an unknown valid MAC topic creates a pending Hub discovery.
3. An owner/admin can name, claim, room-assign, and measure that Hub.
4. Heartbeats update status using the 5/15/30-second rules.
5. A single-EPC payload is parsed correctly.
6. A multi-EPC payload assigns the final power level to every preceding EPC.
7. Invalid topics, EPCs, and power levels are rejected without crashing.
8. Real readings are stored in the Neemo backend and survive app restarts.
9. Log-item scans show only real unlabelled EPCs received during the scan window.
10. Locate-item scans use observations from the selected room.
11. Three or more measured Hubs can feed the existing trilateration calculation.
12. No fake Hub, tag, reading, or location is generated.
13. No active Bluetooth step remains.
14. No user-facing command is offered until the Hub firmware acts on commands.
15. The browser bundle contains no Wi‑Fi, MQTT, broker, or gateway secret.

## 21. Implementation phases

### Phase 1 — Reproduce the working reference

- Use the supplied Mosquitto configuration as the reference for port, network binding, and anonymous compatibility.
- Confirm at least one Hub publishes heartbeats and tags.
- Run `mqtt_table_client.py`.
- Record exact sample topics and payloads from each physical Hub.

### Phase 2 — Build the Local Gateway

- Port the Python client’s connect, wildcard subscription, parsing, and reconnect behavior.
- Add gateway registration and HTTPS forwarding.
- Add buffering and health reporting.

### Phase 3 — Extend the Neemo backend

- Add gateway records and tokens.
- Add pending Hub discoveries.
- Add heartbeat and tag-ingestion endpoints.
- Map MAC-derived IDs to team Hubs and rooms.
- Persist last-known readings.

### Phase 4 — Update the Neemo app

- Replace demo/Bluetooth setup with real network discovery.
- Add gateway state and troubleshooting.
- Add Hub claim, room assignment, and measurement.
- Use live MQTT-fed data for logging and locating.

### Phase 5 — Validate location behavior

- Collect controlled power-level measurements.
- Calibrate the power-to-relative-distance model.
- Test three- and four-Hub geometry.
- Display honest confidence and uncertainty.

### Phase 6 — Production security

- Choose the production broker topology.
- Add TLS, authentication, and ACLs.
- Update and reflash Hub credentials.
- Disable anonymous broker access.

## 22. Implemented MVP decisions and remaining production decisions

Implemented:

- Mac laptop as the current broker/Gateway host.
- One-step Mac and Windows launchers with an embedded MQTT broker and no separate Mosquitto installation.
- Automatic private Node.js runtime download when the computer does not already have Node.js 20 or newer.
- Automatic LAN IPv4 detection, with `MQTT_ADVERTISED_HOST` override.
- Port `1883`, `0.0.0.0` broker binding, and anonymous trusted-LAN access.
- One-time 10-minute Gateway setup code and revocable token stored locally with owner-only file permissions.
- Exponential HTTPS retry, 15-minute offline buffer, 10,000-event limit, and two-second duplicate window.
- Eight-second backend scan windows with no MQTT commands.
- Confirmed removal before Hub reassignment.

Still open for production:

- `[Final mobile Local Gateway and embedded-broker approach]`
- `[Production stable broker hostname or network-discovery strategy]`
- `[Production broker host, TLS port, and authentication method]`
- `[Per-Hub secure credential provisioning method]`
- `[Whether retained status and Last Will will be added in later firmware]`
- `[Whether functional remote commands are required after MVP]`

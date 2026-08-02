# MQTT visual demo

This prototype shows the complete RFID message loop without needing a physical reader:

```text
TypeScript mock scanner
  → mqtt://neemo.xy.icu:2883
  → retained MQTT message
  → wss://neemo.xy.icu/mqtt
  → MQTT.js in the browser
  → Neemo demo workspace
```

Demo mode is integrated into the normal Neemo experience but remains deliberately separate from the production D1 ingestion flow. It substitutes an in-memory fictional room, Hub, map labels, and item catalog while enabled; it never creates real Neemo Hubs, items, or observations.

## Run the mock scanner

Install dependencies, then start the scanner from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm mock:scanner
```

It publishes all six fake assets immediately, then publishes another simulated read every 1.8 seconds. Stop it with `Ctrl+C`. The newest message for every tag uses QoS 1 and `retain: true`, so a browser opened later still receives the catalog.

Useful modes:

```bash
# Publish all six tags once and exit
pnpm mock:scanner --once

# Delete the six retained messages from the broker
pnpm mock:scanner --clear

# Use another broker or scan interval
NEEMO_DEMO_MQTT_URL=mqtt://broker.example:1883 \
NEEMO_DEMO_SCAN_INTERVAL_MS=3000 \
pnpm mock:scanner
```

The browser intentionally stays on the fixed WSS endpoint and example namespace. If those change, update the shared contract in `app/lib/demo-mqtt.ts`.

## Open the display

1. Open Neemo and create or continue an anonymous device profile.
2. Turn on **Demo mode** in the global header. This also works before creating a real room.
3. Explore Overview, Scanner, and Hubs as the fictional **Neemo Robotics Club** workspace.
4. Start `pnpm mock:scanner` in a terminal.

The normal inventory search and selected-item panel show fake catalog metadata alongside retained last-known observations. The room map uses each catalog item’s assigned home position. The Scanner page shows only messages that are arriving now, and the Hubs page reports scanner activity separately from the browser’s MQTT broker connection.

Retained snapshots appear as soon as the subscription is established; continuing scans update the inventory, map, counts, and activity feed. A tag is considered live for 15 seconds after its latest read. Because the scanner cycles through six tags every 1.8 seconds, every tag is refreshed about every 10.8 seconds while it is running. After the scanner stops, individual live indicators therefore switch off roughly 15–26 seconds later, depending on when each tag was last published. The item remains visible as retained last-known history.

Scanner health is based on the newest scanner publish, not on whether the browser can reach MQTT:

- **Publishing:** a scanner message arrived in the last 12 seconds.
- **Idle:** the newest scanner message is 12–30 seconds old.
- **Offline:** no scanner message has arrived for 30 seconds.

Retained MQTT messages are historical snapshots, so receiving them when the browser subscribes does not make the scanner online. Likewise, one RFID reader observation can establish proximity to that reader but cannot produce a defensible map coordinate, distance, or confidence radius. Demo mode therefore never fabricates those estimates; starting the mock scanner provides new observations instead.

Demo mode is saved in local browser storage, so the fictional workspace stays selected after a refresh. Turning it off immediately restores the user’s real workspace context.

## Topic contract

The mock scanner publishes one retained JSON object per example tag:

```text
/neemo/exampleteam/examplehubid/tags/E20034120123456789ABC001
/neemo/exampleteam/examplehubid/tags/E20034120123456789ABC002
...
```

The browser subscribes to:

```text
/neemo/exampleteam/examplehubid/tags/#
```

The payload uses `eventType: "tag.seen"` and includes the tag ID, fake catalog metadata, team/Hub labels, ISO timestamp, sequence, RSSI, read count, and mock Hub temperature.

## Prototype safety boundary

`neemo.xy.icu` currently accepts the example connections without credentials. Anyone able to reach the broker may read or publish within an unprotected topic. The UI therefore:

- accepts only the six allowlisted example tag IDs;
- caps payloads at 16 KiB;
- validates and bounds every displayed field;
- renders values as text;
- labels the workspace as public, untrusted demo data;
- makes demo inventory and hardware controls read-only; and
- never writes MQTT demo messages to D1 or the production inventory.

Do not use this namespace for personal data, real asset records, secrets, or production tracking. Normal mode uses a separate Team-ID namespace and authenticated Worker persistence, but the prototype broker still has no per-team credentials or ACLs.

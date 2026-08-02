# Neemo

Neemo is a Cloudflare-hosted RFID inventory app for workshops and robotics teams. ESP32/RFID Hubs publish directly to a team-scoped cloud MQTT namespace; Neemo labels tags, records observations, and estimates where an item was last detected in a measured room.

## Architecture

```text
RFID reader → ESP32 Hub → neemo.xy.icu MQTT broker
                              ↓ team-scoped WSS
                         Neemo web app → authenticated Cloudflare Worker
                                         ├── D1: app and RFID data
                                         └── R2: item images
```

In normal mode, the signed-in browser subscribes to `/neemo/<TEAM_ID>/#`, validates every topic and JSON body, and forwards accepted observations to the Worker under its authenticated session. The Worker checks that the body and topic match the user’s current team before persisting anything. For this prototype, a Neemo page must remain open to bridge cloud MQTT observations into D1. Team ID provides routing, not authentication; the public broker is suitable for prototyping, not sensitive inventory data.

The web application is Next.js 16 packaged for Cloudflare Workers with OpenNext. `wrangler.jsonc` is the source of truth for the Worker, D1, R2, Assets, rate-limit bindings, and observability. D1 schema changes are applied only through the committed migrations in `drizzle/`; request handlers never create or alter tables.

## Implemented product flow

- Automatic private device profiles with a signed, rolling HTTP-only session cookie
- Owner, Admin, and Member team roles with shared rooms and inventory
- Room dimensions, Hub placement, map labels, and item images
- Team-ID-scoped cloud MQTT connection in normal mode
- MAC-addressed Hub discovery, claiming, naming, room assignment, and 30-second offline status
- Validated, idempotent MQTT event ingestion sized for Cloudflare D1 request limits
- Eight-second label and locate scan windows with one active scan per room
- Relative-signal trilateration with explicit confidence and uncertainty
- No simulated Hubs, tags, readings, or locations in the production inventory workflow
- An isolated, clearly marked MQTT visual demo with six metadata-rich fake assets

The native Capacitor/BLE and Local Gateway prototypes are not part of the supported product path. The active path is the web app plus direct cloud MQTT from scanner firmware.

## Prerequisites

- Node.js 22.13 or newer
- pnpm 10.28.1 through Corepack
- A Cloudflare account for deployment

```bash
corepack enable
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

Replace the placeholder in `.dev.vars` with a random value of at least 32 characters:

```bash
openssl rand -base64 48
```

## Local development

The stable development address is `http://localhost:43761`; the server binds to `0.0.0.0` so it is also reachable from the local network.

```bash
pnpm db:migrate:local
pnpm dev
```

To run the production Worker locally:

```bash
pnpm preview
```

## Validation

```bash
pnpm check
pnpm deploy:dry-run
```

`pnpm check` runs TypeScript, formatting, ESLint, unit tests, the dependency audit, an OpenNext build, clean D1 migrations, and a live workerd HTTP flow covering sessions, request-origin protection, teams, rooms, team-scoped MQTT ingestion, idempotent retries, and Hub discovery. See [docs/SECURITY.md](docs/SECURITY.md) for the pinned transitive dependency policy.

## Deployment

See [docs/CLOUDFLARE_DEPLOYMENT.md](docs/CLOUDFLARE_DEPLOYMENT.md) for first-time provisioning, secrets, migrations, deployment, verification, rollback, and custom domains. After the first deployment is bootstrapped, releases use:

```bash
pnpm deploy:cloudflare
```

Verify the live Worker without creating rooms, items, Hubs, or Gateways:

```bash
NEEMO_DEPLOYMENT_URL=https://your-worker.workers.dev pnpm verify:deployment
```

## MQTT visual demo

Start the retained-message mock scanner:

```bash
pnpm mock:scanner
```

Then turn on **Demo mode** in Neemo’s global header. The app switches its normal room, map, inventory, tag scanner, and Hubs views to a fictional robotics workshop fed by MQTT. The Node script publishes fake tag reads over `mqtt://neemo.xy.icu:2883`; the browser uses MQTT.js over `wss://neemo.xy.icu/mqtt` and subscribes to `/neemo/exampleteam/examplehubid/tags/#`.

Use `pnpm mock:scanner --once` for a single batch or `pnpm mock:scanner --clear` to delete the six retained demo messages. See [docs/MQTT_DEMO.md](docs/MQTT_DEMO.md) for the payload, configuration, classroom flow, and prototype security boundary.

## Scanner protocol

- Team lookup: `POST /api/scanners/team-id` with `{"inviteCode":"ABCDEFGH"}`
- Broker: `mqtt://neemo.xy.icu:2883`
- Hardware ID: 12 uppercase Wi-Fi MAC hexadecimal characters without colons
- Heartbeat: `/neemo/<TEAM_ID>/<HUB_ID>/status/heartbeat`
- Tag: `/neemo/<TEAM_ID>/<HUB_ID>/tags/<EPC>`
- Delivery: QoS 1, retained
- Heartbeat interval: 5 seconds; the app marks a Hub offline after 30 seconds without a current message

The exact topic and JSON contracts are in [docs/TEAM_MQTT.md](docs/TEAM_MQTT.md).

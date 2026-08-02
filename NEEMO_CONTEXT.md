# Neemo — Durable Project Context

Last updated: July 29, 2026

This is the durable engineering handoff for Neemo. Do not add Wi-Fi credentials, Gateway tokens, session secrets, or other credentials to this file.

## Product

Neemo is a web/PWA RFID inventory app for workshops and robotics teams. Passive tags are read by an RFID reader attached to an ESP32 Hub. Hubs publish readings over local MQTT. A Mac or Windows Local Gateway forwards authenticated events to the hosted application.

The application must report only real observations and honest location confidence. It must not manufacture Hubs, tags, readings, or coordinates.

## Current architecture

- Web framework: Next.js 16 and React 19
- Cloudflare adapter: `@opennextjs/cloudflare`
- Runtime and deployment CLI: Wrangler
- Structured storage: D1 binding `DB`
- Item-image storage: R2 binding `ITEM_IMAGES`
- Static files: Workers Assets binding `ASSETS`
- Abuse controls: `PUBLIC_RATE_LIMITER` and `GATEWAY_RATE_LIMITER`
- Authentication: automatic private device identity in a signed, rolling, HTTP-only cookie
- Local hardware bridge: TypeScript Gateway in `gateway/`
- Package manager: pnpm workspace

`wrangler.jsonc` is the only deployment configuration. The former Sites/Vinext and Capacitor/native paths have been removed. There is no supported BLE pairing path in the app.

## Data and migrations

The Drizzle schema is in `db/schema.ts`. The committed migration history is in `drizzle/0000` through `drizzle/0012`.

Important table groups:

- Accounts and collaboration: `user_profiles`, `teams`, `team_members`
- Rooms and maps: `rooms`, `room_spaces`, `room_labels`
- Hubs: `hubs`, `hub_pairing_codes`, `hub_placements`
- MQTT Gateway: `mqtt_gateway_pairing_codes`, `mqtt_gateways`, `mqtt_hub_discoveries`, `mqtt_gateway_events`
- Inventory and scans: `items`, `tag_observations`, `scan_tag_observations`, `scan_sessions`, `hub_scan_jobs`

Migrations are authoritative. Runtime code must not issue `CREATE TABLE`, `ALTER TABLE`, or schema cleanup queries. After changing `db/schema.ts`, run `pnpm db:generate`, inspect the generated SQL and snapshot, apply it to a clean local D1 database, and run `pnpm check`.

## Request and security boundaries

- `SESSION_SECRET` is the only required Worker secret and must be at least 32 characters.
- State-changing browser routes require same-origin requests.
- Anonymous session and Gateway registration endpoints use the public rate limiter.
- Gateway ingest authenticates a hashed bearer token and uses a separate per-Gateway limiter.
- Gateway events require a UUIDv4 `eventId`; the event receipt and all related writes are in one D1 batch, making retries idempotent.
- Ingest accepts no more than 10 readings per event. Its worst-case request stays below D1's 50-query free-plan per-invocation limit.
- Item uploads stream into R2 and reject bodies above 5 MiB.
- Security headers are configured in `next.config.ts`.

## Hardware path

```text
RFID reader → ESP32 Hub → MQTT on trusted local network
            → Local Gateway → authenticated HTTPS → Worker/D1
```

The Gateway includes an Aedes broker bound to `0.0.0.0:1883`, subscribes to `rfid-hub/#`, and sends batches of at most 10 readings. It persists queued events with stable IDs for retry. MQTT is intentionally anonymous for compatibility with the current firmware, so port `1883` must never be exposed to the public internet.

The reference RS485 firmware remains under `firmware/rangetest-rs485-reference/`. Some BLE reference modules remain inside that hardware snapshot because it is preserved as supplied firmware history; they are not used by the web application.

## Main API routes

- `/api/session`
- `/api/team`
- `/api/room`
- `/api/room/labels`
- `/api/items`
- `/api/items/image`
- `/api/hubs`
- `/api/gateways`
- `/api/gateways/register`
- `/api/gateways/claim`
- `/api/gateways/ingest`
- `/api/scans`

## Release validation

Run:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm audit
pnpm deploy:dry-run
unzip -t public/neemo-local-gateway.zip
```

`pnpm check` includes a live local Worker test on a newly migrated D1 database. A release is not ready if that flow is skipped or if the app works only against an old `.wrangler` database.

The exact first-deployment and rollback runbook is [docs/CLOUDFLARE_DEPLOYMENT.md](docs/CLOUDFLARE_DEPLOYMENT.md).

## Known product boundaries

- The RFID reader/firmware integration remains the largest physical-hardware dependency.
- RSSI produces a room estimate with uncertainty, not centimeter-level positioning.
- The Local Gateway computer must stay powered on and connected to the same trusted LAN as the Hubs.
- The current MVP has no broker authentication because the deployed firmware contract is anonymous MQTT.
- Cloudflare credentials and the production `SESSION_SECRET` are intentionally not stored in the repository.

## Continuation rules

1. Preserve automatic private device profiles; do not introduce an external sign-in provider without a product decision.
2. Keep the web/PWA + MQTT Gateway as the sole supported connection path.
3. Never add runtime schema creation or silently repair production tables.
4. Keep ingest idempotent and within Cloudflare query/body limits.
5. Use real RFID observations and honest uncertainty.
6. Run the full release validation before deployment.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function source(path) {
	return (await readFile(new URL(path, root), 'utf8')).replaceAll("'", '"')
}

test('the app starts real label and locate scan sessions', async () => {
	const app = await source('app/NeemoApp.tsx')

	assert.match(app, /fetch\("\/api\/scans"/)
	assert.match(app, /mode:\s*"label"/)
	assert.match(app, /mode:\s*"locate"/)
	assert.match(app, /relative-signal trilateration/)
	assert.doesNotMatch(app, /stableNoise|Found near the center workbench|weighted trilateration/)
})

test('the backend covers team MQTT-fed scan windows, labelling, and lifecycle changes', async () => {
	const [scans, ingest, items, hubs] = await Promise.all([
		source('app/api/scans/route.ts'),
		source('app/api/mqtt/ingest/route.ts'),
		source('app/api/items/route.ts'),
		source('app/api/hubs/route.ts'),
	])

	assert.match(scans, /INSERT INTO scan_sessions/)
	assert.match(scans, /INSERT INTO hub_scan_jobs/)
	assert.match(scans, /"scanning"/)
	assert.match(ingest, /scanIds/)
	assert.match(ingest, /tag_observations/)
	assert.match(ingest, /scan_tag_observations/)
	assert.match(ingest, /read_count = scan_tag_observations\.read_count \+ excluded\.read_count/)
	assert.doesNotMatch(`${scans}\n${ingest}`, /device\/commands|cmd\/#/)
	assert.match(items, /export async function POST/)
	assert.match(items, /ORDER BY o\.last_seen_at DESC/)
	assert.match(items, /export async function PATCH/)
	assert.match(items, /export async function DELETE/)
	assert.match(hubs, /DELETE FROM tag_observations/)
	assert.match(hubs, /DELETE FROM hub_scan_jobs/)
})

test('location scans use measured-room RSSI trilateration rather than a weighted Hub average', async () => {
	const [scans, results, trilateration] = await Promise.all([
		source('app/api/scans/route.ts'),
		source('app/lib/scan-results.ts'),
		source('app/lib/trilateration.ts'),
	])

	assert.match(scans, /r\.length AS room_length/)
	assert.match(scans, /JOIN rooms r/)
	assert.match(scans, /FROM scan_tag_observations o/)
	assert.match(scans, /o\.scan_id = \?/)
	assert.match(results, /estimateByRssiTrilateration/)
	assert.match(results, /estimatedDistanceMeters/)
	assert.match(trilateration, /robust RSSI-ratio trilateration/)
	assert.match(trilateration, /huberLoss/)
	assert.match(trilateration, /geometryCoverage/)
	assert.match(trilateration, /pathLossExponent/)
	assert.doesNotMatch(results, /signal-weighted Hub estimate/)
})

test('the supplied RS485 reader transport is preserved in the Hub firmware', async () => {
	const firmware = await source('firmware/rangetest-rs485-reference/rangetest-rs485.ino')

	assert.match(firmware, /RS485_AUTO_DIRECTION/)
	assert.match(firmware, /READER_BAUD\s+57600/)
	assert.match(firmware, /calculateCRC/)
	assert.match(firmware, /Cmd 0x01 = inventory/)
	assert.match(firmware, /hubState\.tick\(\)/)
})

test('active Hub setup uses the team-scoped cloud MQTT contract with no browser Bluetooth', async () => {
	const [flow, app, contract, client] = await Promise.all([
		source('app/HubPairingFlow.tsx'),
		source('app/NeemoApp.tsx'),
		source('app/lib/team-mqtt.ts'),
		source('app/TeamMqttMode.tsx'),
	])

	assert.match(flow, /Connect scanner firmware/)
	assert.match(flow, /Team ID/)
	assert.match(flow, /Heartbeat every 5 seconds/)
	assert.match(flow, /fetch\("\/api\/gateways"/)
	assert.match(flow, /fetch\("\/api\/gateways\/claim"/)
	assert.doesNotMatch(flow, /navigator\.bluetooth|requestDevice|getNeemoHubBridge/)
	assert.doesNotMatch(flow, /Local Gateway|Create setup code|Start Neemo/)
	assert.doesNotMatch(app, /DEMO_HUB_STORAGE_KEY|demo-hub-|isDemoHub/)
	assert.doesNotMatch(app, /getNeemoHubBridge|getRfidTelemetryBridge/)
	assert.match(contract, /TEAM_MQTT_TCP_URL = "mqtt:\/\/neemo\.xy\.icu:2883"/)
	assert.match(contract, /teamMqttSubscription/)
	assert.match(contract, /status\/heartbeat/)
	assert.match(contract, /\/tags\//)
	assert.match(client, /mqtt\.connect\(TEAM_MQTT_WSS_URL/)
	assert.match(client, /client\.subscribe\(subscription, \{ qos: 1 \}/)
	assert.match(client, /fetch\("\/api\/mqtt\/ingest"/)
})

test('named rooms and Hub calibration are required for room-based scans', async () => {
	const [app, room, hubs, scans] = await Promise.all([
		source('app/NeemoApp.tsx'),
		source('app/api/room/route.ts'),
		source('app/api/hubs/route.ts'),
		source('app/api/scans/route.ts'),
	])

	assert.match(app, /Create your first room/)
	assert.match(app, /Choose active room/)
	assert.match(app, /Measure from each wall/)
	assert.match(room, /INSERT INTO rooms/)
	assert.match(room, /DELETE FROM hub_placements/)
	assert.match(hubs, /left \+ right - room\.length/)
	assert.match(hubs, /top \+ bottom - room\.width/)
	assert.match(scans, /INNER JOIN hub_placements/)
	assert.match(scans, /h\.room_id = \?/)
})

test('team workspaces use real memberships and shared backend ownership', async () => {
	const [app, team, workspace, items, hubs] = await Promise.all([
		source('app/NeemoApp.tsx'),
		source('app/api/team/route.ts'),
		source('app/lib/workspace.ts'),
		source('app/api/items/route.ts'),
		source('app/api/hubs/route.ts'),
	])

	assert.match(team, /INSERT INTO teams/)
	assert.match(team, /INSERT INTO team_members/)
	assert.match(team, /invite_code/)
	assert.match(team, /setRole/)
	assert.match(team, /renameSelf/)
	assert.match(team, /The team owner cannot be removed/)
	assert.match(workspace, /dataOwnerSub/)
	assert.match(workspace, /canManageWorkspace/)
	assert.match(items, /getWorkspaceContext/)
	assert.match(hubs, /getWorkspaceContext/)
	assert.doesNotMatch(app, /Jon Reyes|Avery Singh|482&nbsp;901|Circuit Breakers Robotics/)
})

test('scanner firmware can resolve a Team ID from an invite code without joining', async () => {
	const [route, workspace] = await Promise.all([source('app/api/scanners/team-id/route.ts'), source('app/lib/workspace.ts')])

	assert.match(route, /enforcePublicRateLimit\(request, "scanner-team-id"\)/)
	assert.match(route, /rejectCrossOriginRequest\(request\)/)
	assert.match(route, /SELECT id FROM teams WHERE invite_code = \? LIMIT 1/)
	assert.match(route, /Response\.json\(\{ teamId: team\.id \}\)/)
	assert.match(route, /cache-control", "no-store"/)
	assert.doesNotMatch(route, /INSERT INTO team_members|UPDATE team_members/)
	assert.match(workspace, /normalizeTeamCode/)
})

test('first visit creates a private device profile without Google sign-in', async () => {
	const [app, entry, sessionRoute, page] = await Promise.all([
		source('app/NeemoApp.tsx'),
		source('app/AnonymousEntry.tsx'),
		source('app/api/session/route.ts'),
		source('app/page.tsx'),
	])

	assert.match(app, /Choose how to get started/)
	assert.match(app, /onboardingChoice === "choose"/)
	assert.match(app, /setOnboardingChoice\("create"\)/)
	assert.match(app, /setOnboardingChoice\("join"\)/)
	assert.match(app, /Create your team/)
	assert.match(app, /Join a team/)
	assert.match(app, /Skip for now/)
	assert.doesNotMatch(app, /aria-labelledby="room-setup-title"/)
	assert.match(entry, /No Google account or sign-in is required/)
	assert.match(sessionRoute, /device:\$\{deviceId\}/)
	assert.match(sessionRoute, /anonymous\.neemo/)
	assert.match(page, /<AnonymousEntry \/>/)
	assert.doesNotMatch(`${entry}\n${sessionRoute}\n${page}`, /accounts\.google\.com|GOOGLE_CLIENT_ID|Sign in with Google/)
})

test('the room map uses user-created labels and reports located items', async () => {
	const [app, labels] = await Promise.all([source('app/NeemoApp.tsx'), source('app/api/room/labels/route.ts')])

	assert.match(app, /items located/)
	assert.match(app, /Add a place to the map/)
	assert.doesNotMatch(app, /map-object workbench|map-object shelves|map-object assembly|map-object toolcrib/)
	assert.match(labels, /INSERT INTO room_labels/)
	assert.match(labels, /DELETE FROM room_labels/)
	assert.match(labels, /getWorkspaceContext/)
})

test('the overview consolidates item finding and shows both workspace totals', async () => {
	const app = await source('app/NeemoApp.tsx')

	assert.match(app, /id="find-items"/)
	assert.match(app, /type FinderFilter = "all" \| "live" \| "history" \| "unseen"/)
	assert.match(app, /aria-keyshortcuts="\/"/)
	assert.match(app, /Filter items by observation state/)
	assert.match(app, /\[item\.name, item\.category, item\.tagEpc, item\.homeHubName/)
	assert.match(app, /sourceAwareFreshness/)
	assert.match(app, /hub\.status === "online" \|\| hub\.status === "delayed"/)
	assert.match(app, /className=\{`item-row \$\{freshness\}/)
	assert.match(app, /FRESHNESS_ORDER\[left\.freshness\]/)
	assert.match(app, /items located/)
	assert.match(app, /Hubs connected/)
	assert.doesNotMatch(app, /\{ id: "find"/)
	assert.doesNotMatch(app, /sidebar-footer/)
	assert.doesNotMatch(app, /role="alert"/)
	assert.match(app, /setTimeout\(\(\) => setNotice\(""\), 4_000\)/)
})

test('the Hubs page lists every room below the connection controls', async () => {
	const app = await source('app/NeemoApp.tsx')

	assert.match(app, /<h2 id="hub-room-list-title">Your rooms<\/h2>/)
	assert.match(app, /rooms\.map\(\(candidate\) =>/)
	assert.match(app, /setActiveRoomId\(candidate\.id\)/)
})

test('refreshing Hubs keeps the paired-Hubs panel and its empty state mounted', async () => {
	const app = await source('app/NeemoApp.tsx')

	assert.match(app, /className="hub-list" aria-busy=\{!demoMode && hubLoading\}/)
	assert.match(app, /hub-list-refreshing/)
	assert.match(app, /\{workspaceHubs\.length === 0 && \(/)
	assert.doesNotMatch(app, /!hubLoading && hubs\.length === 0/)
})

test('normal mode subscribes by Team ID, persists validated messages, and claims MAC-identified Hubs', async () => {
	const [app, flow, client, contract, claim, ingest, schema] = await Promise.all([
		source('app/NeemoApp.tsx'),
		source('app/HubPairingFlow.tsx'),
		source('app/TeamMqttMode.tsx'),
		source('app/lib/team-mqtt.ts'),
		source('app/api/gateways/claim/route.ts'),
		source('app/api/mqtt/ingest/route.ts'),
		source('db/schema.ts'),
	])

	assert.match(app, /<HubPairingFlow/)
	assert.match(app, /<TeamMqttMode teamId=\{team\.id\}/)
	assert.match(flow, /cloudMqttGatewayId\(teamId\)/)
	assert.match(flow, /TEAM_MQTT_TCP_URL/)
	assert.match(contract, /mqtt:\/\/neemo\.xy\.icu:2883/)
	assert.match(client, /teamMqttSubscription\(teamId\)/)
	assert.match(client, /parseTeamMqttMessage\(topic, payload, teamId\)/)
	assert.match(client, /Date\.parse\(message\.seenAt\)/)
	assert.doesNotMatch(client, /setLastMessageAt\(Date\.now\(\)\)/)
	assert.match(contract, /cloud:\$\{teamId\}/)
	assert.match(ingest, /context\.teamId/)
	assert.match(ingest, /parseTeamMqttMessage\(topic, encodedMessage, context\.teamId\)/)
	assert.match(ingest, /platform, broker_host, broker_port/)
	assert.match(ingest, /"cloud-mqtt"/)
	assert.match(claim, /device_id.*mqtt:/s)
	assert.match(claim, /formatHardwareId/)
	assert.match(claim, /cloudMqttGatewayId\(context\.teamId\)/)
	assert.match(schema, /mqttGateways/)
	assert.match(schema, /mqttHubDiscoveries/)
})

test('team MQTT observations feed persistent items and open scan windows without commands', async () => {
	const [app, ingest, hubs, scans, results] = await Promise.all([
		source('app/NeemoApp.tsx'),
		source('app/api/mqtt/ingest/route.ts'),
		source('app/api/hubs/route.ts'),
		source('app/api/scans/route.ts'),
		source('app/lib/scan-results.ts'),
	])

	assert.match(app, /const realHubs = hubs/)
	assert.match(app, /realHubs\.map\(\(hub\) =>\s*\(\s*<option/)
	assert.match(hubs, /device_id NOT LIKE "web-test-%"/)
	assert.match(ingest, /INSERT INTO tag_observations/)
	assert.match(ingest, /INSERT INTO scan_tag_observations/)
	assert.match(ingest, /s\.created_at <= \? AND s\.expires_at >= \?/)
	assert.match(ingest, /UPDATE items[\s\S]*last_seen_hub_id/)
	assert.match(scans, /VALUES \(\?, \?, \?, "scanning"/)
	assert.doesNotMatch(scans, /simulationPercent|simulatedEpc|TEST-\$\{scanId/)
	assert.match(scans, /hub\.last_seen_at >= now - HUB_ONLINE_WINDOW_MS/)
	assert.doesNotMatch(scans, /connectedHubIds|cmd\/|device\/commands/)
	assert.match(results, /estimateByRssiTrilateration/)
})

test('the production pairing UI discovers and claims team MQTT Hubs without Web Bluetooth', async () => {
	const [flow, claim, contract] = await Promise.all([
		source('app/HubPairingFlow.tsx'),
		source('app/api/gateways/claim/route.ts'),
		source('app/lib/team-mqtt.ts'),
	])

	assert.match(flow, /discoveries\.filter/)
	assert.match(flow, /discovery\.gatewayId === gatewayId/)
	assert.match(flow, /hardwareId/)
	assert.match(flow, /Give this Hub a name/)
	assert.match(flow, /`Add to \$\{roomName\}`/)
	assert.doesNotMatch(flow, /navigator\.bluetooth|requestDevice|connectSelectedDevice/)
	assert.match(claim, /INSERT INTO hubs/)
	assert.match(claim, /claimed_hub_id/)
	assert.match(contract, /\^\[A-F0-9\]\{12\}\$/)
})

test('page navigation resets to the top and Hub discovery cannot launch a Bluetooth chooser', async () => {
	const [app, flow] = await Promise.all([source('app/NeemoApp.tsx'), source('app/HubPairingFlow.tsx')])

	assert.match(app, /document\.scrollingElement\?\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/)
	assert.match(app, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/)
	assert.doesNotMatch(flow, /Bluetooth help|question-mark/i)
	assert.doesNotMatch(flow, /navigator\.bluetooth|requestDevice/)
	assert.doesNotMatch(flow, /window\.alert/)
})

test('the cloud scanner flow states its prototype security boundary and never invents a connection', async () => {
	const [flow, client, readme] = await Promise.all([source('app/HubPairingFlow.tsx'), source('app/TeamMqttMode.tsx'), source('README.md')])

	assert.match(flow, /prototype broker is public/)
	assert.match(flow, /Team ID separates data but is not a secret or authentication credential/)
	assert.match(flow, /No valid scanner message received/)
	assert.match(flow, /No new scanners detected/)
	assert.match(client, /connectionState, setConnectionState/)
	assert.match(client, /setConnectionState\("offline"\)/)
	assert.match(readme, /Team ID provides routing, not authentication/)
})

test('team roles enforce owner-only titles and owner-admin workspace editing', async () => {
	const [app, team, items, rooms, hubs] = await Promise.all([
		source('app/NeemoApp.tsx'),
		source('app/api/team/route.ts'),
		source('app/api/items/route.ts'),
		source('app/api/room/route.ts'),
		source('app/api/hubs/route.ts'),
	])

	assert.match(team, /context\.role !== "owner"[\s\S]*change admin access/)
	assert.match(team, /context\.role !== "owner" && context\.role !== "admin"/)
	assert.match(items, /Members can rename items and change their images/)
	assert.match(items, /Only the team owner or an admin can remove items/)
	assert.match(rooms, /canManageWorkspace\(context\)/)
	assert.match(hubs, /canManageWorkspace\(context\)/)
	assert.match(app, /window\.confirm\(`Remove \$\{targetItem\.name\} from Neemo completely/)
	assert.match(app, /window\.confirm\(`Remove \$\{member\.name\} from/)
})

test('roomless workspaces show only room setup outside Account', async () => {
	const app = await source('app/NeemoApp.tsx')

	assert.match(app, /!demoMode && screen !== "account" && !roomLoading && rooms\.length === 0/)
	assert.match(app, /Add your first room/)
	assert.match(app, /Skip for now/)
	assert.match(app, /const hasWorkspaceContent = demoMode \|\| rooms\.length > 0/)
	assert.match(app, /screen === "home" && hasWorkspaceContent/)
	assert.match(app, /screen === "log" &&\s*hasWorkspaceContent/)
	assert.match(app, /screen === "hubs" && hasWorkspaceContent/)
})

test('global demo mode integrates retained MQTT tags into the normal workspace', async () => {
	const [app, demo, monitor, freshness, contract, scanner, config] = await Promise.all([
		source('app/NeemoApp.tsx'),
		source('app/MqttDemoMode.tsx'),
		source('app/components/DemoScannerMonitor.tsx'),
		source('app/lib/freshness.ts'),
		source('app/lib/demo-mqtt.ts'),
		source('scripts/mock-scanner.ts'),
		source('next.config.ts'),
	])

	assert.doesNotMatch(app, /\{ id: "demo", label: "Live demo"/)
	assert.match(app, /role="switch"/)
	assert.match(app, /aria-checked=\{demoMode\}/)
	assert.match(app, /DEMO_MODE_STORAGE_KEY = "neemo\.demo-mode"/)
	assert.match(app, /const workspaceItems = demoMode \? demoItems : items/)
	assert.match(app, /const workspaceHubs = demoMode \? \[demoHub\] : hubs/)
	assert.match(app, /const workspaceRooms = demoMode \? \[DEMO_ROOM\] : rooms/)
	assert.match(app, /Demo inventory is read-only/)
	assert.match(app, /never written to the real Neemo inventory/)
	assert.match(app, /<MqttDemoMode onSnapshot=\{setDemoSnapshot\} onExit=\{toggleDemoMode\} \/>/)
	assert.match(freshness, /DEMO_ITEM_FRESH_MS = 15_000/)
	assert.match(freshness, /SCANNER_IDLE_MS = 12_000/)
	assert.match(freshness, /SCANNER_OFFLINE_MS = 30_000/)
	assert.match(demo, /mqtt\.connect\(DEMO_MQTT_WSS_URL/)
	assert.match(demo, /client\.subscribe\(DEMO_TOPIC_SUBSCRIPTION, \{ qos: 1 \}/)
	assert.match(demo, /parseDemoTagMessage\(topic, payload, receivedAt\)/)
	assert.match(demo, /scannerStatus\(latestSeenAt, now\)/)
	assert.match(demo, /Scanner offline/)
	assert.match(demo, /payload\.byteLength === 0/)
	assert.match(demo, /Exit demo/)
	assert.match(demo, /pnpm mock:scanner --clear/)
	assert.match(app, /<DemoScannerMonitor snapshot=\{demoSnapshot\}/)
	assert.match(app, /if \(demoMode \|\| !selectedItem/)
	assert.doesNotMatch(app, /Demo MQTT last-known reading/)
	assert.doesNotMatch(app, /Replay MQTT reads as a Hub scan/)
	assert.match(monitor, /snapshot\.scannerStatus !== "publishing"/)
	assert.match(monitor, /Retained messages are not being presented as live readings/)
	assert.match(app, /no position, distance, or confidence estimate/i)
	assert.match(contract, /wss:\/\/neemo\.xy\.icu\/mqtt/)
	assert.match(contract, /\/neemo\/\$\{DEMO_TEAM_ID\}\/\$\{DEMO_HUB_ID\}\/tags\//)
	assert.match(contract, /MAX_DEMO_MQTT_PAYLOAD_BYTES = 16 \* 1024/)
	assert.match(contract, /DEMO_TAGS\.find\(\(candidate\) => candidate\.tagId === tagId\)/)
	assert.match(scanner, /connectAsync\(mqttUrl/)
	assert.match(scanner, /publishAsync\(topic, JSON\.stringify\(message\), \{ qos: 1, retain: true \}\)/)
	assert.match(scanner, /publishAsync\(demoTagTopic\(definition\.tagId\), "", \{ qos: 1, retain: true \}\)/)
	assert.match(config, /connect-src "self" wss:\/\/neemo\.xy\.icu/)
})

test('the interactive room map pans, zooms, and stays honest about state', async () => {
	const [map, viewport, app, css] = await Promise.all([
		source('app/components/RoomMap.tsx'),
		source('app/lib/map-viewport.ts'),
		source('app/NeemoApp.tsx'),
		source('app/globals.css'),
	])

	assert.match(map, /role="toolbar"/)
	assert.match(map, /aria-label="Zoom in"/)
	assert.match(map, /aria-label="Fit whole room"/)
	assert.match(map, /aria-label="Map legend and help"/)
	assert.match(map, /grouped beside the Hub that last read it/)
	assert.match(map, /observed tags/)
	assert.match(map, /onPointerDown/)
	assert.match(map, /pinchStart/)
	assert.match(map, /event\.key === "ArrowLeft"/)
	assert.match(map, /containerPointToRoomPercent/)
	assert.match(map, /estimateRadiusPercent/)
	assert.match(map, /aria-live="polite"/)
	assert.match(viewport, /MAX_MAP_SCALE = 8/)
	assert.match(viewport, /export function clampViewport/)
	assert.match(viewport, /export function zoomAt/)
	assert.match(viewport, /export function measurementsFromRoomPercent/)
	assert.match(app, /measurementsFromRoomPercent\(point, room\)/)
	assert.match(
		app,
		/demoMode[\s\S]*\? \{ kind: "hub", id: selectedItem\.lastSeenHubId as string, token: Date\.now\(\) \}[\s\S]*: \{ kind: "item", id: selectedItem\.id, token: Date\.now\(\) \}/,
	)
	assert.match(app, /role="dialog"/)
	assert.match(map, /touchAction: zoomedIn \? "none" : "pan-y"/)
	assert.match(css, /prefers-reduced-motion/)
})

test('item images use shared object storage and durable database metadata', async () => {
	const [app, imageRoute, schema, wrangler] = await Promise.all([
		source('app/NeemoApp.tsx'),
		source('app/api/items/image/route.ts'),
		source('db/schema.ts'),
		source('wrangler.jsonc'),
	])

	assert.match(app, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/)
	assert.match(imageRoute, /MAX_IMAGE_BYTES/)
	assert.match(imageRoute, /getItemImageBucket\(\)\.get|bucket\.put/)
	assert.match(schema, /imageKey:\s*text\("image_key"\)/)
	assert.match(wrangler, /"binding":\s*"ITEM_IMAGES"/)
})

test('mobile layouts keep navigation and maps usable without zooming', async () => {
	const css = await source('app/globals.css')

	assert.match(css, /min-height:\s*calc\(74px \+ env\(safe-area-inset-bottom\)\)/)
	assert.match(css, /\.mobile-nav button[\s\S]*min-height:\s*58px/)
	assert.match(css, /\.mobile-nav\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*1fr\)/)
	assert.match(css, /\.button\.wide\s*\{[\s\S]*width:\s*min\(100%,\s*420px\)/)
	assert.match(css, /@media \(max-width: 430px\)/)
	assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.map-toolbar button\s*\{[\s\S]*width:\s*44px/)
	assert.match(css, /\.item-drawer\s*\{[\s\S]*env\(safe-area-inset-bottom\)/)
})

import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const hubPairingCodes = sqliteTable(
	'hub_pairing_codes',
	{
		id: text('id').primaryKey(),
		ownerSub: text('owner_sub').notNull(),
		ownerEmail: text('owner_email').notNull(),
		roomId: text('room_id'),
		hubName: text('hub_name').notNull(),
		codeHash: text('code_hash').notNull().unique(),
		expiresAt: integer('expires_at').notNull(),
		consumedAt: integer('consumed_at'),
		createdAt: integer('created_at').notNull(),
	},
	(table) => [index('hub_pairing_owner_idx').on(table.ownerSub, table.expiresAt)],
)

export const hubs = sqliteTable(
	'hubs',
	{
		id: text('id').primaryKey(),
		ownerSub: text('owner_sub').notNull(),
		ownerEmail: text('owner_email').notNull(),
		roomId: text('room_id'),
		name: text('name').notNull(),
		deviceId: text('device_id').notNull().unique(),
		deviceTokenHash: text('device_token_hash').notNull().unique(),
		macAddress: text('mac_address'),
		ipAddress: text('ip_address'),
		ssid: text('ssid'),
		connectionState: text('connection_state').notNull().default('UNPROVISIONED'),
		connectionError: text('connection_error'),
		firmwareVersion: text('firmware_version'),
		wifiRssi: integer('wifi_rssi'),
		posX: real('pos_x').notNull().default(50),
		posY: real('pos_y').notNull().default(50),
		pairedAt: integer('paired_at').notNull(),
		lastSeenAt: integer('last_seen_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
	},
	(table) => [index('hubs_owner_idx').on(table.ownerSub, table.pairedAt)],
)

export const mqttGatewayPairingCodes = sqliteTable(
	'mqtt_gateway_pairing_codes',
	{
		id: text('id').primaryKey(),
		ownerSub: text('owner_sub').notNull(),
		ownerEmail: text('owner_email').notNull(),
		gatewayName: text('gateway_name').notNull(),
		codeHash: text('code_hash').notNull().unique(),
		expiresAt: integer('expires_at').notNull(),
		consumedAt: integer('consumed_at'),
		createdAt: integer('created_at').notNull(),
	},
	(table) => [index('mqtt_gateway_pairing_owner_idx').on(table.ownerSub, table.expiresAt)],
)

export const mqttGateways = sqliteTable(
	'mqtt_gateways',
	{
		id: text('id').primaryKey(),
		ownerSub: text('owner_sub').notNull(),
		ownerEmail: text('owner_email').notNull(),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull().unique(),
		platform: text('platform'),
		brokerHost: text('broker_host').notNull().default('127.0.0.1'),
		brokerPort: integer('broker_port').notNull().default(1883),
		brokerConnected: integer('broker_connected', { mode: 'boolean' }).notNull().default(false),
		registeredAt: integer('registered_at').notNull(),
		lastSeenAt: integer('last_seen_at').notNull(),
		lastBrokerMessageAt: integer('last_broker_message_at'),
		revokedAt: integer('revoked_at'),
	},
	(table) => [
		index('mqtt_gateways_owner_idx').on(table.ownerSub, table.registeredAt),
		index('mqtt_gateways_token_idx').on(table.tokenHash),
	],
)

export const mqttHubDiscoveries = sqliteTable(
	'mqtt_hub_discoveries',
	{
		gatewayId: text('gateway_id').notNull(),
		ownerSub: text('owner_sub').notNull(),
		hardwareId: text('hardware_id').notNull(),
		firstSeenAt: integer('first_seen_at').notNull(),
		lastSeenAt: integer('last_seen_at').notNull(),
		lastTopic: text('last_topic').notNull(),
		claimedHubId: text('claimed_hub_id'),
	},
	(table) => [
		primaryKey({ columns: [table.gatewayId, table.hardwareId] }),
		index('mqtt_hub_discoveries_owner_idx').on(table.ownerSub, table.lastSeenAt),
		uniqueIndex('mqtt_hub_discoveries_claimed_unique').on(table.claimedHubId),
	],
)

export const mqttGatewayEvents = sqliteTable(
	'mqtt_gateway_events',
	{
		gatewayId: text('gateway_id').notNull(),
		eventId: text('event_id').notNull(),
		receivedAt: integer('received_at').notNull(),
	},
	(table) => [primaryKey({ columns: [table.gatewayId, table.eventId] }), index('mqtt_gateway_events_received_idx').on(table.receivedAt)],
)

export const roomSpaces = sqliteTable('room_spaces', {
	ownerSub: text('owner_sub').primaryKey(),
	ownerEmail: text('owner_email').notNull(),
	name: text('name').notNull().default('My room'),
	length: real('length').notNull(),
	width: real('width').notNull(),
	unit: text('unit').notNull().default('ft'),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
})

export const rooms = sqliteTable(
	'rooms',
	{
		id: text('id').primaryKey(),
		ownerSub: text('owner_sub').notNull(),
		ownerEmail: text('owner_email').notNull(),
		name: text('name').notNull(),
		length: real('length').notNull(),
		width: real('width').notNull(),
		unit: text('unit').notNull().default('ft'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
	},
	(table) => [index('rooms_owner_idx').on(table.ownerSub, table.createdAt)],
)

export const roomLabels = sqliteTable(
	'room_labels',
	{
		id: text('id').primaryKey(),
		ownerSub: text('owner_sub').notNull(),
		roomId: text('room_id'),
		name: text('name').notNull(),
		leftDistance: real('left_distance').notNull(),
		frontDistance: real('front_distance').notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
	},
	(table) => [index('room_labels_owner_idx').on(table.ownerSub, table.createdAt)],
)

export const hubPlacements = sqliteTable(
	'hub_placements',
	{
		hubId: text('hub_id').primaryKey(),
		ownerSub: text('owner_sub').notNull(),
		leftDistance: real('left_distance').notNull(),
		rightDistance: real('right_distance').notNull(),
		topDistance: real('top_distance').notNull(),
		bottomDistance: real('bottom_distance').notNull(),
		updatedAt: integer('updated_at').notNull(),
	},
	(table) => [index('hub_placements_owner_idx').on(table.ownerSub)],
)

export const teams = sqliteTable(
	'teams',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		ownerSub: text('owner_sub').notNull(),
		inviteCode: text('invite_code').notNull().unique(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
	},
	(table) => [index('teams_owner_idx').on(table.ownerSub)],
)

export const teamMembers = sqliteTable(
	'team_members',
	{
		teamId: text('team_id').notNull(),
		userSub: text('user_sub').notNull(),
		userEmail: text('user_email').notNull(),
		userName: text('user_name').notNull(),
		role: text('role').notNull().default('member'),
		joinedAt: integer('joined_at').notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.teamId, table.userSub] }),
		uniqueIndex('team_members_user_unique').on(table.userSub),
		index('team_members_team_idx').on(table.teamId, table.joinedAt),
	],
)

export const userProfiles = sqliteTable('user_profiles', {
	userSub: text('user_sub').primaryKey(),
	email: text('email').notNull(),
	displayName: text('display_name').notNull(),
	workspaceName: text('workspace_name').notNull(),
	onboardingComplete: integer('onboarding_complete', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
})

export const items = sqliteTable(
	'items',
	{
		id: text('id').primaryKey(),
		ownerSub: text('owner_sub').notNull(),
		ownerEmail: text('owner_email').notNull(),
		roomId: text('room_id'),
		name: text('name').notNull(),
		imageKey: text('image_key'),
		category: text('category').notNull(),
		tagEpc: text('tag_epc').notNull(),
		homeHubId: text('home_hub_id'),
		lastSeenHubId: text('last_seen_hub_id'),
		lastSeenAt: integer('last_seen_at'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
	},
	(table) => [
		uniqueIndex('items_owner_epc_unique').on(table.ownerSub, table.tagEpc),
		index('items_owner_updated_idx').on(table.ownerSub, table.updatedAt),
	],
)

export const tagObservations = sqliteTable(
	'tag_observations',
	{
		ownerSub: text('owner_sub').notNull(),
		hubId: text('hub_id').notNull(),
		epc: text('epc').notNull(),
		rssi: real('rssi').notNull(),
		antenna: integer('antenna'),
		frequency: integer('frequency'),
		readCount: integer('read_count').notNull().default(1),
		firstSeenAt: integer('first_seen_at').notNull(),
		lastSeenAt: integer('last_seen_at').notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.hubId, table.epc] }),
		index('tag_observations_owner_seen_idx').on(table.ownerSub, table.lastSeenAt),
	],
)

export const scanTagObservations = sqliteTable(
	'scan_tag_observations',
	{
		scanId: text('scan_id').notNull(),
		ownerSub: text('owner_sub').notNull(),
		hubId: text('hub_id').notNull(),
		epc: text('epc').notNull(),
		rssi: real('rssi').notNull(),
		antenna: integer('antenna'),
		frequency: integer('frequency'),
		readCount: integer('read_count').notNull().default(1),
		firstSeenAt: integer('first_seen_at').notNull(),
		lastSeenAt: integer('last_seen_at').notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.scanId, table.hubId, table.epc] }),
		index('scan_tag_observations_owner_scan_idx').on(table.ownerSub, table.scanId),
	],
)

export const scanSessions = sqliteTable(
	'scan_sessions',
	{
		id: text('id').primaryKey(),
		ownerSub: text('owner_sub').notNull(),
		ownerEmail: text('owner_email').notNull(),
		roomId: text('room_id'),
		mode: text('mode').notNull(),
		targetItemId: text('target_item_id'),
		targetEpc: text('target_epc'),
		status: text('status').notNull().default('queued'),
		createdAt: integer('created_at').notNull(),
		expiresAt: integer('expires_at').notNull(),
		completedAt: integer('completed_at'),
	},
	(table) => [index('scan_sessions_owner_created_idx').on(table.ownerSub, table.createdAt)],
)

export const hubScanJobs = sqliteTable(
	'hub_scan_jobs',
	{
		scanId: text('scan_id').notNull(),
		hubId: text('hub_id').notNull(),
		ownerSub: text('owner_sub').notNull(),
		status: text('status').notNull().default('queued'),
		requestedAt: integer('requested_at').notNull(),
		dispatchedAt: integer('dispatched_at'),
		completedAt: integer('completed_at'),
		readingCount: integer('reading_count').notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.scanId, table.hubId] }),
		index('hub_scan_jobs_hub_status_idx').on(table.hubId, table.status, table.requestedAt),
		index('hub_scan_jobs_scan_idx').on(table.scanId),
	],
)

export const DEMO_MQTT_TCP_URL = 'mqtt://neemo.xy.icu:2883'
export const DEMO_MQTT_WSS_URL = 'wss://neemo.xy.icu/mqtt'
export const DEMO_TEAM_ID = 'exampleteam'
export const DEMO_HUB_ID = 'examplehubid'
export const DEMO_TOPIC_PREFIX = `/neemo/${DEMO_TEAM_ID}/${DEMO_HUB_ID}/tags/`
export const DEMO_TOPIC_SUBSCRIPTION = `${DEMO_TOPIC_PREFIX}#`
export const MAX_DEMO_MQTT_PAYLOAD_BYTES = 16 * 1024

export type DemoTagDefinition = Readonly<{
	tagId: string
	displayName: string
	category: string
	emoji: string
	accent: string
	description: string
	assetCode: string
	custodian: string
	project: string
	homeLocation: string
	manufacturer: string
	model: string
	condition: string
	notes: string
}>

export type DemoTagMessage = DemoTagDefinition &
	Readonly<{
		schemaVersion: 1
		eventType: 'tag.seen'
		demo: true
		teamId: typeof DEMO_TEAM_ID
		teamName: string
		hubId: typeof DEMO_HUB_ID
		hubName: string
		hubZone: string
		scannerName: string
		seenAt: string
		sequence: number
		signalRssi: number
		readCount: number
		hubTemperatureCelsius: number
		publishedWithRetain: true
	}>

export const DEMO_TAGS: readonly DemoTagDefinition[] = [
	{
		tagId: 'E20034120123456789ABC001',
		displayName: 'Precision digital calipers',
		category: 'Measurement',
		emoji: '📏',
		accent: '#4778d0',
		description: '150 mm stainless calipers used for drivetrain and spacer measurements.',
		assetCode: 'MEASURE-014',
		custodian: 'Build Team',
		project: '2026 Competition Robot',
		homeLocation: 'Blue tool chest · Drawer 2',
		manufacturer: 'Mitutoyo',
		model: 'Absolute AOS 150',
		condition: 'Excellent',
		notes: 'Return to its foam case after every use.',
	},
	{
		tagId: 'E20034120123456789ABC002',
		displayName: 'Safety goggles crate',
		category: 'Safety',
		emoji: '🥽',
		accent: '#f09b32',
		description: 'Class set of twelve anti-fog safety glasses for fabrication sessions.',
		assetCode: 'SAFETY-003',
		custodian: 'Workshop Lead',
		project: 'General workshop',
		homeLocation: 'Safety station · Top shelf',
		manufacturer: '3M',
		model: 'Virtua CCS',
		condition: 'Good',
		notes: 'Two pairs are sized for smaller students.',
	},
	{
		tagId: 'E20034120123456789ABC003',
		displayName: 'Arduino sensor kit',
		category: 'Electronics',
		emoji: '🔌',
		accent: '#35a276',
		description: 'Prototype box with distance, color, IMU, temperature, and light sensors.',
		assetCode: 'ELEC-027',
		custodian: 'Programming Team',
		project: 'Autonomous Navigation',
		homeLocation: 'Electronics cabinet · Bin E4',
		manufacturer: 'Arduino',
		model: 'Student Sensor Bundle',
		condition: 'Complete',
		notes: 'Inventory card says 18 modules and 24 jumper leads.',
	},
	{
		tagId: 'E20034120123456789ABC004',
		displayName: 'Competition laptop charger',
		category: 'Computing',
		emoji: '🔋',
		accent: '#7e5bc7',
		description: 'Spare 100 W USB-C charger reserved for the drive-station laptop.',
		assetCode: 'IT-009',
		custodian: 'Drive Team',
		project: 'Pit Equipment',
		homeLocation: 'Travel case · Front pocket',
		manufacturer: 'Anker',
		model: 'Prime 100W',
		condition: 'Ready',
		notes: 'Includes a labeled 2 m braided USB-C cable.',
	},
	{
		tagId: 'E20034120123456789ABC005',
		displayName: 'Orange cordless drill',
		category: 'Power tools',
		emoji: '🛠️',
		accent: '#df6245',
		description: 'Compact drill/driver used for assembly, field repairs, and outreach demos.',
		assetCode: 'POWER-006',
		custodian: 'Fabrication Team',
		project: 'Shared Tooling',
		homeLocation: 'Charging bench · Slot 3',
		manufacturer: 'RIDGID',
		model: 'SubCompact 18V',
		condition: 'Good',
		notes: 'Battery pack has an orange Neemo label on its base.',
	},
	{
		tagId: 'E20034120123456789ABC006',
		displayName: 'Prototype rover controller',
		category: 'Robotics',
		emoji: '🎮',
		accent: '#cf4f8d',
		description: 'Wireless controller configured for the student-built outreach rover.',
		assetCode: 'ROBOT-021',
		custodian: 'Outreach Team',
		project: 'Neptune Rover',
		homeLocation: 'Rover cart · Locking drawer',
		manufacturer: '8BitDo',
		model: 'Ultimate 2.4G',
		condition: 'Demo ready',
		notes: 'Custom controls are printed on the back of the case.',
	},
]

export function demoTagTopic(tagId: string): string {
	return `${DEMO_TOPIC_PREFIX}${tagId}`
}

export function createDemoTagMessage(definition: DemoTagDefinition, sequence: number, seenAt = new Date()): DemoTagMessage {
	const definitionIndex = Math.max(
		0,
		DEMO_TAGS.findIndex((candidate) => candidate.tagId === definition.tagId),
	)
	return {
		...definition,
		schemaVersion: 1,
		eventType: 'tag.seen',
		demo: true,
		teamId: DEMO_TEAM_ID,
		teamName: 'Neemo Robotics Club',
		hubId: DEMO_HUB_ID,
		hubName: 'Workshop Entry Scanner',
		hubZone: 'Main build room · East doorway',
		scannerName: 'Mock RFID Scanner',
		seenAt: seenAt.toISOString(),
		sequence,
		signalRssi: -36 - ((sequence * 7 + definitionIndex * 5) % 34),
		readCount: 2 + ((sequence + definitionIndex) % 7),
		hubTemperatureCelsius: 21.4 + ((sequence + definitionIndex) % 8) / 10,
		publishedWithRetain: true,
	}
}

type JsonObject = Readonly<Record<string, unknown>>

function isJsonObject(value: unknown): value is JsonObject {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown, fallback: string, maxLength = 180): string {
	return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback
}

function numberValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
	const number = Number(value)
	return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function parseSeenAt(value: unknown, fallback: number): string {
	if (typeof value !== 'string') return new Date(fallback).toISOString()
	const timestamp = Date.parse(value)
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date(fallback).toISOString()
}

export function parseDemoTagMessage(topic: string, payload: Uint8Array, receivedAt: number): DemoTagMessage | null {
	if (!topic.startsWith(DEMO_TOPIC_PREFIX) || payload.byteLength === 0 || payload.byteLength > MAX_DEMO_MQTT_PAYLOAD_BYTES) {
		return null
	}
	const tagId = topic.slice(DEMO_TOPIC_PREFIX.length)
	const definition = DEMO_TAGS.find((candidate) => candidate.tagId === tagId)
	if (!definition) return null

	try {
		const data = JSON.parse(new TextDecoder().decode(payload)) as unknown
		if (!isJsonObject(data) || data.tagId !== tagId || data.eventType !== 'tag.seen') return null
		return {
			...definition,
			displayName: stringValue(data.displayName, definition.displayName, 100),
			category: stringValue(data.category, definition.category, 60),
			emoji: stringValue(data.emoji, definition.emoji, 8),
			description: stringValue(data.description, definition.description, 240),
			assetCode: stringValue(data.assetCode, definition.assetCode, 60),
			custodian: stringValue(data.custodian, definition.custodian, 80),
			project: stringValue(data.project, definition.project, 100),
			homeLocation: stringValue(data.homeLocation, definition.homeLocation, 120),
			manufacturer: stringValue(data.manufacturer, definition.manufacturer, 80),
			model: stringValue(data.model, definition.model, 80),
			condition: stringValue(data.condition, definition.condition, 60),
			notes: stringValue(data.notes, definition.notes, 200),
			schemaVersion: 1,
			eventType: 'tag.seen',
			demo: true,
			teamId: DEMO_TEAM_ID,
			teamName: stringValue(data.teamName, 'Neemo Robotics Club', 100),
			hubId: DEMO_HUB_ID,
			hubName: stringValue(data.hubName, 'Workshop Entry Scanner', 100),
			hubZone: stringValue(data.hubZone, 'Main build room · East doorway', 120),
			scannerName: stringValue(data.scannerName, 'Mock RFID Scanner', 100),
			seenAt: parseSeenAt(data.seenAt, receivedAt),
			sequence: numberValue(data.sequence, 0, 0, Number.MAX_SAFE_INTEGER),
			signalRssi: numberValue(data.signalRssi, -80, -120, 0),
			readCount: numberValue(data.readCount, 1, 1, 10_000),
			hubTemperatureCelsius: numberValue(data.hubTemperatureCelsius, 22, -40, 100),
			publishedWithRetain: true,
		}
	} catch {
		return null
	}
}

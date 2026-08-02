import { connectAsync, type MqttClient } from 'mqtt'
import { setTimeout as delay } from 'node:timers/promises'
import {
	createDemoTagMessage,
	DEMO_HUB_ID,
	DEMO_MQTT_TCP_URL,
	DEMO_TAGS,
	DEMO_TEAM_ID,
	demoTagTopic,
	type DemoTagDefinition,
} from '../app/lib/demo-mqtt.ts'

const arguments_ = new Set(process.argv.slice(2))
const mqttUrl = process.env.NEEMO_DEMO_MQTT_URL ?? DEMO_MQTT_TCP_URL
const requestedInterval = Number(process.env.NEEMO_DEMO_SCAN_INTERVAL_MS ?? '1800')
const scanInterval = Number.isFinite(requestedInterval) ? Math.min(60_000, Math.max(250, requestedInterval)) : 1_800
const runOnce = arguments_.has('--once')
const clearRetainedMessages = arguments_.has('--clear')
let stopping = false

function requestStop(): void {
	stopping = true
}

process.once('SIGINT', requestStop)
process.once('SIGTERM', requestStop)

async function publishTag(client: MqttClient, definition: DemoTagDefinition, sequence: number): Promise<void> {
	const topic = demoTagTopic(definition.tagId)
	const message = createDemoTagMessage(definition, sequence)
	await client.publishAsync(topic, JSON.stringify(message), { qos: 1, retain: true })
	console.log(`scan ${String(sequence).padStart(3, '0')}  ${definition.emoji}  ${definition.displayName}  →  ${topic}`)
}

async function clearDemoTopics(client: MqttClient): Promise<void> {
	await Promise.all(DEMO_TAGS.map((definition) => client.publishAsync(demoTagTopic(definition.tagId), '', { qos: 1, retain: true })))
	console.log(`Cleared ${DEMO_TAGS.length} retained demo tags.`)
}

async function runScanner(client: MqttClient): Promise<void> {
	console.log(`Mock scanner connected to ${mqttUrl}`)
	console.log(`Publishing retained QoS 1 messages for /neemo/${DEMO_TEAM_ID}/${DEMO_HUB_ID}/tags/#`)

	if (clearRetainedMessages) {
		await clearDemoTopics(client)
		return
	}

	await Promise.all(DEMO_TAGS.map((definition, index) => publishTag(client, definition, index + 1)))
	if (runOnce) return

	console.log(`Cycling through ${DEMO_TAGS.length} example tags every ${scanInterval} ms. Press Ctrl+C to stop.`)
	let sequence = DEMO_TAGS.length + 1
	while (!stopping) {
		await delay(scanInterval)
		if (stopping) break
		await publishTag(client, DEMO_TAGS[(sequence - 1) % DEMO_TAGS.length] as DemoTagDefinition, sequence)
		sequence += 1
	}
}

async function main(): Promise<void> {
	const client = await connectAsync(mqttUrl, {
		clean: true,
		clientId: `neemo_mock_scanner_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
		connectTimeout: 10_000,
		keepalive: 30,
		reconnectPeriod: 2_000,
	})
	try {
		await runScanner(client)
	} finally {
		await client.endAsync(false)
	}
}

try {
	await main()
} catch (error) {
	console.error('Mock scanner failed:', error instanceof Error ? error.message : error)
	process.exitCode = 1
}

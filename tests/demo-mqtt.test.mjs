import assert from 'node:assert/strict'
import test from 'node:test'
import {
	createDemoTagMessage,
	DEMO_HUB_ID,
	DEMO_MQTT_TCP_URL,
	DEMO_MQTT_WSS_URL,
	DEMO_TAGS,
	DEMO_TEAM_ID,
	DEMO_TOPIC_SUBSCRIPTION,
	demoTagTopic,
	MAX_DEMO_MQTT_PAYLOAD_BYTES,
	parseDemoTagMessage,
} from '../app/lib/demo-mqtt.ts'

test('demo MQTT endpoints and subscription match the student prototype contract', () => {
	assert.equal(DEMO_MQTT_TCP_URL, 'mqtt://neemo.xy.icu:2883')
	assert.equal(DEMO_MQTT_WSS_URL, 'wss://neemo.xy.icu/mqtt')
	assert.equal(DEMO_TEAM_ID, 'exampleteam')
	assert.equal(DEMO_HUB_ID, 'examplehubid')
	assert.equal(DEMO_TOPIC_SUBSCRIPTION, '/neemo/exampleteam/examplehubid/tags/#')
	assert.equal(demoTagTopic('EXAMPLE-TAG'), '/neemo/exampleteam/examplehubid/tags/EXAMPLE-TAG')
})

test('mock scanner messages contain rich fake metadata and retained scan facts', () => {
	assert.equal(DEMO_TAGS.length, 6)
	const seenAt = new Date('2026-07-29T20:00:00.000Z')
	const message = createDemoTagMessage(DEMO_TAGS[0], 12, seenAt)

	assert.equal(message.schemaVersion, 1)
	assert.equal(message.eventType, 'tag.seen')
	assert.equal(message.demo, true)
	assert.equal(message.publishedWithRetain, true)
	assert.equal(message.seenAt, seenAt.toISOString())
	assert.equal(message.sequence, 12)
	assert.match(message.tagId, /^[A-F0-9]{24}$/)
	assert.ok(message.displayName)
	assert.ok(message.assetCode)
	assert.ok(message.custodian)
	assert.ok(message.homeLocation)
	assert.ok(message.manufacturer)
	assert.ok(message.signalRssi <= -36)
	assert.ok(message.readCount >= 2)
})

test('browser parser accepts only allowlisted, bounded demo messages', () => {
	const definition = DEMO_TAGS[0]
	const message = createDemoTagMessage(definition, 20, new Date('2026-07-29T20:00:00.000Z'))
	const encoded = new TextEncoder().encode(
		JSON.stringify({
			...message,
			displayName: 'X'.repeat(500),
			accent: 'url(https://attacker.example)',
			signalRssi: 42,
			readCount: -20,
		}),
	)
	const parsed = parseDemoTagMessage(demoTagTopic(definition.tagId), encoded, Date.now())

	assert.ok(parsed)
	assert.equal(parsed.displayName.length, 100)
	assert.equal(parsed.accent, definition.accent)
	assert.equal(parsed.signalRssi, 0)
	assert.equal(parsed.readCount, 1)
	assert.equal(parseDemoTagMessage(demoTagTopic('UNKNOWN-TAG'), encoded, Date.now()), null)
	assert.equal(parseDemoTagMessage(demoTagTopic(DEMO_TAGS[1].tagId), encoded, Date.now()), null)
	assert.equal(parseDemoTagMessage(demoTagTopic(definition.tagId), new Uint8Array(MAX_DEMO_MQTT_PAYLOAD_BYTES + 1), Date.now()), null)
})

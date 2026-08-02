import assert from 'node:assert/strict'
import test from 'node:test'
import {
	cloudMqttGatewayId,
	MAX_TEAM_MQTT_PAYLOAD_BYTES,
	parseTeamMqttMessage,
	TEAM_MQTT_TCP_URL,
	TEAM_MQTT_WSS_URL,
	teamMqttHeartbeatTopic,
	teamMqttSubscription,
	teamMqttTagTopic,
} from '../app/lib/team-mqtt.ts'

const teamId = '8e40ec21-8ec9-4f35-82c0-6dc9effeae12'
const hubId = '5C013BBEDEBC'
const tagId = 'E20034120123456789ABC005'
const encode = (value) => new TextEncoder().encode(JSON.stringify(value))

test('team MQTT topics use the cloud broker and a team-scoped namespace', () => {
	assert.equal(TEAM_MQTT_TCP_URL, 'mqtt://neemo.xy.icu:2883')
	assert.equal(TEAM_MQTT_WSS_URL, 'wss://neemo.xy.icu/mqtt')
	assert.equal(teamMqttSubscription(teamId), `/neemo/${teamId}/#`)
	assert.equal(teamMqttHeartbeatTopic(teamId, hubId), `/neemo/${teamId}/${hubId}/status/heartbeat`)
	assert.equal(teamMqttTagTopic(teamId, hubId, tagId), `/neemo/${teamId}/${hubId}/tags/${tagId}`)
	assert.equal(cloudMqttGatewayId(teamId), `cloud:${teamId}`)
})

test('team MQTT parser validates heartbeat identity against its topic', () => {
	const topic = teamMqttHeartbeatTopic(teamId, hubId)
	const parsed = parseTeamMqttMessage(
		topic,
		encode({ eventType: 'hub.heartbeat', teamId, hubId, seenAt: '2026-07-29T20:00:00.000Z' }),
		teamId,
	)

	assert.deepEqual(parsed, {
		kind: 'heartbeat',
		eventType: 'hub.heartbeat',
		teamId,
		hubId,
		seenAt: '2026-07-29T20:00:00.000Z',
	})
	assert.equal(parseTeamMqttMessage(topic, encode({ eventType: 'hub.heartbeat', teamId: 'another-team', hubId }), teamId), null)
})

test('team MQTT parser accepts RSSI or reader power tag messages', () => {
	const topic = teamMqttTagTopic(teamId, hubId, tagId)
	const rssi = parseTeamMqttMessage(
		topic,
		encode({
			eventType: 'tag.seen',
			teamId,
			hubId,
			tagId,
			seenAt: '2026-07-29T20:00:01.000Z',
			sequence: 4,
			signalRssi: -47,
			readCount: 2,
		}),
		teamId,
	)
	const power = parseTeamMqttMessage(
		topic,
		encode({
			eventType: 'tag.seen',
			teamId,
			hubId,
			tagId,
			seenAt: '2026-07-29T20:00:02.000Z',
			powerLevel: 18,
		}),
		teamId,
	)

	assert.equal(rssi?.kind, 'tag')
	assert.equal(rssi?.signalRssi, -47)
	assert.equal(rssi?.powerLevel, null)
	assert.equal(power?.kind, 'tag')
	assert.equal(power?.signalRssi, null)
	assert.equal(power?.powerLevel, 18)
	assert.equal(parseTeamMqttMessage(topic, encode({ eventType: 'tag.seen', teamId, hubId, tagId, seenAt: 'bad' }), teamId), null)
	assert.equal(parseTeamMqttMessage(topic, new Uint8Array(MAX_TEAM_MQTT_PAYLOAD_BYTES + 1), teamId), null)
})

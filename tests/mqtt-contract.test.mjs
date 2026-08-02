import assert from 'node:assert/strict'
import test from 'node:test'

import { formatHardwareId, parseMqttHubTopic, parseMqttTagPayload, powerLevelToRelativeSignal } from '../app/lib/mqtt-contract.ts'

test('MQTT topics identify tag and heartbeat messages by colon-free Wi-Fi MAC', () => {
	assert.deepEqual(parseMqttHubTopic('rfid-hub/A1B2C3D4E5F6/rfid/tag'), {
		kind: 'tag',
		hardwareId: 'A1B2C3D4E5F6',
	})
	assert.deepEqual(parseMqttHubTopic('rfid-hub/A1B2C3D4E5F6/status/hello'), {
		kind: 'heartbeat',
		hardwareId: 'A1B2C3D4E5F6',
	})
	assert.equal(parseMqttHubTopic('other/A1B2C3D4E5F6/rfid/tag'), null)
	assert.equal(formatHardwareId('a1b2c3d4e5f6'), 'A1:B2:C3:D4:E5:F6')
})

test('MQTT tag payload treats the last comma-separated field as power level', () => {
	assert.deepEqual(parseMqttTagPayload('E200471604606422A6320110,18'), [{ epc: 'E200471604606422A6320110', powerLevel: 18 }])
	assert.deepEqual(parseMqttTagPayload('E200471604606422A6320110,E280116060000205,4'), [
		{ epc: 'E200471604606422A6320110', powerLevel: 4 },
		{ epc: 'E280116060000205', powerLevel: 4 },
	])
})

test('MQTT payload validation enforces hexadecimal EPCs and power 0 through 30', () => {
	assert.throws(() => parseMqttTagPayload('NOT-A-TAG,12'))
	assert.throws(() => parseMqttTagPayload('E2004716,31'))
	assert.throws(() => parseMqttTagPayload('E2004716,12.5'))
})

test('lower reader power is stronger evidence for location math', () => {
	assert.equal(powerLevelToRelativeSignal(0), 0)
	assert.equal(powerLevelToRelativeSignal(30), -30)
	assert.ok(powerLevelToRelativeSignal(4) > powerLevelToRelativeSignal(22))
})

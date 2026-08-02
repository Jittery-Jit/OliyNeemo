export const MQTT_TOPIC_ROOT = 'rfid-hub'
export const MQTT_SUBSCRIPTION = `${MQTT_TOPIC_ROOT}/#`
export const MQTT_BROKER_PORT = 1883
export const HUB_ACTIVE_WINDOW_MS = 15_000
export const HUB_DELAYED_WINDOW_MS = 30_000
export const GATEWAY_ACTIVE_WINDOW_MS = 30_000

export type MqttHubTopic =
	| { kind: 'heartbeat'; hardwareId: string }
	| { kind: 'tag'; hardwareId: string }
	| { kind: 'command'; hardwareId: string; commandPath: string }

export function normalizeHardwareId(value: string) {
	return value
		.trim()
		.toUpperCase()
		.replace(/[^A-F0-9]/g, '')
}

export function isHardwareId(value: string) {
	return /^[A-F0-9]{12}$/.test(value)
}

export function formatHardwareId(value: string) {
	const normalized = normalizeHardwareId(value)
	return normalized.match(/.{1,2}/g)?.join(':') ?? normalized
}

export function parseMqttHubTopic(topic: string): MqttHubTopic | null {
	const parts = topic.trim().split('/')
	if (parts.length < 4 || parts[0] !== MQTT_TOPIC_ROOT) return null
	const hardwareId = normalizeHardwareId(parts[1])
	if (!isHardwareId(hardwareId)) return null
	if (parts[2] === 'rfid' && parts[3] === 'tag' && parts.length === 4) {
		return { kind: 'tag', hardwareId }
	}
	if (parts[2] === 'status' && parts[3] === 'hello' && parts.length === 4) {
		return { kind: 'heartbeat', hardwareId }
	}
	if (parts[2] === 'cmd' && parts.length >= 4) {
		return { kind: 'command', hardwareId, commandPath: parts.slice(3).join('/') }
	}
	return null
}

export type MqttTagReading = {
	epc: string
	powerLevel: number
}

export function parseMqttTagPayload(payload: string): MqttTagReading[] {
	const fields = payload
		.trim()
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
	if (fields.length < 2) throw new Error('A tag payload must contain at least one EPC and a power level.')

	const rawPowerLevel = fields.at(-1) ?? ''
	if (!/^\d+$/.test(rawPowerLevel)) throw new Error('The final payload field must be an integer power level.')
	const powerLevel = Number(rawPowerLevel)
	if (!Number.isInteger(powerLevel) || powerLevel < 0 || powerLevel > 30) {
		throw new Error('Power level must be an integer from 0 through 30.')
	}

	const epcs = fields.slice(0, -1).map((value) => value.toUpperCase().replace(/\s+/g, ''))
	if (epcs.some((epc) => !/^[A-F0-9]{4,128}$/.test(epc))) {
		throw new Error('Each EPC must contain 4–128 hexadecimal characters.')
	}
	return Array.from(new Set(epcs)).map((epc) => ({ epc, powerLevel }))
}

export function powerLevelToRelativeSignal(powerLevel: number) {
	return powerLevel === 0 ? 0 : -Math.round(powerLevel * 10) / 10
}

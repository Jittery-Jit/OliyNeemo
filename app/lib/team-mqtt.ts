export const TEAM_MQTT_TCP_URL = 'mqtt://neemo.xy.icu:2883'
export const TEAM_MQTT_WSS_URL = 'wss://neemo.xy.icu/mqtt'
export const MAX_TEAM_MQTT_PAYLOAD_BYTES = 16 * 1024

export type TeamMqttHeartbeat = Readonly<{
	kind: 'heartbeat'
	eventType: 'hub.heartbeat'
	teamId: string
	hubId: string
	seenAt: string
}>

export type TeamMqttTagReading = Readonly<{
	kind: 'tag'
	eventType: 'tag.seen'
	teamId: string
	hubId: string
	tagId: string
	seenAt: string
	sequence: number
	signalRssi: number | null
	powerLevel: number | null
	readCount: number
}>

export type TeamMqttMessage = TeamMqttHeartbeat | TeamMqttTagReading

type JsonObject = Readonly<Record<string, unknown>>

function isJsonObject(value: unknown): value is JsonObject {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function validTopicPart(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

export function normalizeTeamMqttHubId(value: string): string {
	return value
		.trim()
		.toUpperCase()
		.replace(/[^A-F0-9]/g, '')
}

export function normalizeTeamMqttTagId(value: string): string {
	return value.trim().toUpperCase().replace(/\s+/g, '')
}

export function cloudMqttGatewayId(teamId: string): string {
	return `cloud:${teamId}`
}

export function teamMqttTopicPrefix(teamId: string): string {
	return `/neemo/${teamId}/`
}

export function teamMqttSubscription(teamId: string): string {
	return `${teamMqttTopicPrefix(teamId)}#`
}

export function teamMqttHeartbeatTopic(teamId: string, hubId: string): string {
	return `${teamMqttTopicPrefix(teamId)}${normalizeTeamMqttHubId(hubId)}/status/heartbeat`
}

export function teamMqttTagTopic(teamId: string, hubId: string, tagId: string): string {
	return `${teamMqttTopicPrefix(teamId)}${normalizeTeamMqttHubId(hubId)}/tags/${normalizeTeamMqttTagId(tagId)}`
}

function parsedSeenAt(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const timestamp = Date.parse(value)
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

export function parseTeamMqttMessage(topic: string, payload: Uint8Array, expectedTeamId: string): TeamMqttMessage | null {
	if (!validTopicPart(expectedTeamId) || payload.byteLength === 0 || payload.byteLength > MAX_TEAM_MQTT_PAYLOAD_BYTES) return null
	const parts = topic.split('/').filter(Boolean)
	if (parts.length !== 5 || parts[0] !== 'neemo' || parts[1] !== expectedTeamId) return null

	const hubId = normalizeTeamMqttHubId(parts[2] ?? '')
	if (!/^[A-F0-9]{12}$/.test(hubId)) return null
	const isHeartbeat = parts[3] === 'status' && parts[4] === 'heartbeat'
	const topicTagId = parts[3] === 'tags' ? normalizeTeamMqttTagId(parts[4] ?? '') : ''
	if (!isHeartbeat && !/^[A-F0-9]{4,128}$/.test(topicTagId)) return null

	try {
		const data = JSON.parse(new TextDecoder().decode(payload)) as unknown
		if (!isJsonObject(data) || data.teamId !== expectedTeamId || normalizeTeamMqttHubId(String(data.hubId ?? '')) !== hubId) return null
		const seenAt = parsedSeenAt(data.seenAt)
		if (!seenAt) return null

		if (isHeartbeat) {
			return data.eventType === 'hub.heartbeat'
				? { kind: 'heartbeat', eventType: 'hub.heartbeat', teamId: expectedTeamId, hubId, seenAt }
				: null
		}

		const tagId = normalizeTeamMqttTagId(String(data.tagId ?? ''))
		if (data.eventType !== 'tag.seen' || tagId !== topicTagId) return null
		const rawSignalRssi = typeof data.signalRssi === 'number' ? data.signalRssi : Number.NaN
		const signalRssi = Number.isFinite(rawSignalRssi) && rawSignalRssi >= -120 && rawSignalRssi <= 0 ? rawSignalRssi : null
		const rawPowerLevel = typeof data.powerLevel === 'number' ? data.powerLevel : Number.NaN
		const powerLevel = Number.isInteger(rawPowerLevel) && rawPowerLevel >= 0 && rawPowerLevel <= 30 ? rawPowerLevel : null
		if (signalRssi === null && powerLevel === null) return null
		const rawSequence = typeof data.sequence === 'number' ? data.sequence : Number.NaN
		const sequence = Number.isSafeInteger(rawSequence) && rawSequence >= 0 ? rawSequence : 0
		const rawReadCount = typeof data.readCount === 'number' ? data.readCount : Number.NaN
		const readCount = Number.isInteger(rawReadCount) && rawReadCount >= 1 && rawReadCount <= 10_000 ? rawReadCount : 1
		return {
			kind: 'tag',
			eventType: 'tag.seen',
			teamId: expectedTeamId,
			hubId,
			tagId,
			seenAt,
			sequence,
			signalRssi,
			powerLevel,
			readCount,
		}
	} catch {
		return null
	}
}

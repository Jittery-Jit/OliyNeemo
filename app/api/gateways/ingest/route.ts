import { authenticateGateway } from '../../../lib/gateway-auth'
import { getHubDb, normalizeEpc } from '../../../lib/hub-db'
import { isHardwareId, normalizeHardwareId, parseMqttHubTopic, powerLevelToRelativeSignal } from '../../../lib/mqtt-contract'
import { enforceGatewayRateLimit } from '../../../lib/request-security'

type GatewayMessageBase = {
	eventId?: string
}

type GatewayHeartbeat = GatewayMessageBase & {
	type: 'gateway_heartbeat'
	brokerConnected?: boolean
	brokerHost?: string
	brokerPort?: number
}

type HubHeartbeat = GatewayMessageBase & {
	type: 'hub_heartbeat'
	hardwareId?: string
	topic?: string
	observedAt?: number
}

type SubmittedReading = { epc?: string; powerLevel?: number; readCount?: number }

type TagReadings = GatewayMessageBase & {
	type: 'tag_readings'
	hardwareId?: string
	topic?: string
	observedAt?: number
	readings?: SubmittedReading[]
}

type GatewayMessage = GatewayHeartbeat | HubHeartbeat | TagReadings

type ClaimedHub = {
	id: string
	owner_sub: string
	room_id: string | null
}

type BodyResult<T> = { data: T; error?: never } | { data?: never; error: Response }

const MAX_REQUEST_BYTES = 64 * 1024
const MAX_READINGS_PER_REQUEST = 10

function eventTime(value: number | undefined, now: number) {
	if (!Number.isFinite(value)) return now
	return Math.min(now + 30_000, Math.max(now - 24 * 60 * 60 * 1000, Math.round(value as number)))
}

function cleanReadings(readings: SubmittedReading[]) {
	return readings
		.map((reading) => {
			const epc = normalizeEpc(reading.epc ?? '')
			const powerLevel = Number(reading.powerLevel)
			if (!/^[A-F0-9]{4,128}$/.test(epc)) return null
			if (!Number.isInteger(powerLevel) || powerLevel < 0 || powerLevel > 30) return null
			const readCount = Number.isInteger(reading.readCount) ? Math.min(10_000, Math.max(1, Number(reading.readCount))) : 1
			return { epc, powerLevel, rssi: powerLevelToRelativeSignal(powerLevel), readCount }
		})
		.filter((reading): reading is NonNullable<typeof reading> => reading !== null)
}

function isEventId(value: string | undefined): value is string {
	return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

async function readJsonBody<T>(request: Request): Promise<BodyResult<T>> {
	const declaredLength = Number(request.headers.get('content-length') ?? '0')
	if (declaredLength > MAX_REQUEST_BYTES) {
		return { error: Response.json({ error: 'Gateway payload is too large.' }, { status: 413 }) }
	}
	if (!request.body) {
		return { error: Response.json({ error: 'Gateway payload is required.' }, { status: 400 }) }
	}

	const chunks: Uint8Array[] = []
	const reader = request.body.getReader()
	let totalBytes = 0
	while (true) {
		const result = await reader.read()
		if (result.done) break
		totalBytes += result.value.byteLength
		if (totalBytes > MAX_REQUEST_BYTES) {
			await reader.cancel()
			return { error: Response.json({ error: 'Gateway payload is too large.' }, { status: 413 }) }
		}
		chunks.push(result.value)
	}

	const bytes = new Uint8Array(totalBytes)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	try {
		return { data: JSON.parse(new TextDecoder().decode(bytes)) as T }
	} catch {
		return { error: Response.json({ error: 'Gateway payload must be valid JSON.' }, { status: 400 }) }
	}
}

async function eventAlreadyHandled(db: D1Database, gatewayId: string, eventId: string) {
	return Boolean(
		await db
			.prepare('SELECT 1 AS found FROM mqtt_gateway_events WHERE gateway_id = ? AND event_id = ? LIMIT 1')
			.bind(gatewayId, eventId)
			.first(),
	)
}

function eventReceipt(db: D1Database, gatewayId: string, eventId: string, now: number) {
	return db.prepare('INSERT INTO mqtt_gateway_events (gateway_id, event_id, received_at) VALUES (?, ?, ?)').bind(gatewayId, eventId, now)
}

function isDuplicateEventError(error: unknown) {
	return (
		error instanceof Error &&
		error.message.includes('UNIQUE constraint failed') &&
		error.message.includes('mqtt_gateway_events.gateway_id') &&
		error.message.includes('mqtt_gateway_events.event_id')
	)
}

export async function POST(request: Request) {
	try {
		const gateway = await authenticateGateway(request)
		if (!gateway) return Response.json({ error: 'Gateway token is invalid.' }, { status: 401 })

		const rateLimitResponse = await enforceGatewayRateLimit(gateway.id)
		if (rateLimitResponse) return rateLimitResponse

		const body = await readJsonBody<GatewayMessage>(request)
		if (body.error) return body.error
		const payload = body.data
		if (!isEventId(payload.eventId)) {
			return Response.json({ error: 'Gateway event ID is missing or invalid.' }, { status: 400 })
		}

		const db = getHubDb()
		const now = Date.now()
		if (await eventAlreadyHandled(db, gateway.id, payload.eventId)) {
			return Response.json({ ok: true, duplicate: true, serverTime: now })
		}

		if (payload.type === 'gateway_heartbeat') {
			const brokerHost = payload.brokerHost?.trim().slice(0, 255) || null
			const brokerPort = Number(payload.brokerPort)
			if (Number.isFinite(brokerPort) && brokerPort !== 1883) {
				return Response.json({ error: 'The Neemo MVP broker must use port 1883.' }, { status: 400 })
			}
			try {
				await db.batch([
					eventReceipt(db, gateway.id, payload.eventId, now),
					db
						.prepare(
							`
							UPDATE mqtt_gateways
							SET last_seen_at = ?, broker_connected = ?,
								broker_host = COALESCE(?, broker_host),
								broker_port = COALESCE(?, broker_port)
							WHERE id = ? AND revoked_at IS NULL
						`,
						)
						.bind(now, payload.brokerConnected ? 1 : 0, brokerHost, Number.isFinite(brokerPort) ? brokerPort : null, gateway.id),
					db.prepare('DELETE FROM mqtt_gateway_events WHERE received_at < ?').bind(now - 24 * 60 * 60 * 1000),
				])
			} catch (error) {
				if (isDuplicateEventError(error)) return Response.json({ ok: true, duplicate: true, serverTime: now })
				throw error
			}
			return Response.json({ ok: true, serverTime: now })
		}

		if (payload.type !== 'hub_heartbeat' && payload.type !== 'tag_readings') {
			return Response.json({ error: 'Unknown Gateway message type.' }, { status: 400 })
		}
		const hardwareId = normalizeHardwareId(payload.hardwareId ?? '')
		const topic = payload.topic?.trim() ?? ''
		const parsedTopic = parseMqttHubTopic(topic)
		const expectedKind = payload.type === 'hub_heartbeat' ? 'heartbeat' : 'tag'
		if (!isHardwareId(hardwareId) || !parsedTopic || parsedTopic.hardwareId !== hardwareId || parsedTopic.kind !== expectedKind) {
			return Response.json({ error: 'Hub identity and MQTT topic do not match the Neemo protocol.' }, { status: 400 })
		}
		const observedAt = eventTime(payload.observedAt, now)
		const hub = await db
			.prepare(
				`
				SELECT id, owner_sub, room_id
				FROM hubs
				WHERE owner_sub = ? AND device_id = ?
				LIMIT 1
			`,
			)
			.bind(gateway.ownerSub, `mqtt:${hardwareId}`)
			.first<ClaimedHub>()

		const statements: D1PreparedStatement[] = [
			eventReceipt(db, gateway.id, payload.eventId, now),
			db
				.prepare(
					`
					UPDATE mqtt_gateways
					SET last_seen_at = ?, broker_connected = 1,
						last_broker_message_at = CASE
							WHEN last_broker_message_at IS NULL OR last_broker_message_at < ? THEN ?
							ELSE last_broker_message_at
						END
					WHERE id = ? AND revoked_at IS NULL
				`,
				)
				.bind(now, observedAt, observedAt, gateway.id),
			db
				.prepare(
					`
					INSERT INTO mqtt_hub_discoveries
						(gateway_id, owner_sub, hardware_id, first_seen_at, last_seen_at, last_topic, claimed_hub_id)
					VALUES (?, ?, ?, ?, ?, ?, NULL)
					ON CONFLICT(gateway_id, hardware_id) DO UPDATE SET
						last_seen_at = CASE
							WHEN excluded.last_seen_at > mqtt_hub_discoveries.last_seen_at
								THEN excluded.last_seen_at
							ELSE mqtt_hub_discoveries.last_seen_at
						END,
						last_topic = excluded.last_topic
				`,
				)
				.bind(gateway.id, gateway.ownerSub, hardwareId, observedAt, observedAt, topic),
		]

		if (!hub) {
			try {
				await db.batch(statements)
			} catch (error) {
				if (isDuplicateEventError(error)) return Response.json({ ok: true, duplicate: true, serverTime: now })
				throw error
			}
			return Response.json({ ok: true, discovered: true, claimed: false, hardwareId, serverTime: now }, { status: 202 })
		}

		statements.push(
			db
				.prepare(
					`
					UPDATE hubs
					SET connection_state = 'ONLINE', connection_error = NULL,
						last_seen_at = CASE WHEN last_seen_at < ? THEN ? ELSE last_seen_at END,
						updated_at = ?
					WHERE id = ? AND owner_sub = ?
				`,
				)
				.bind(observedAt, observedAt, now, hub.id, hub.owner_sub),
		)
		if (payload.type === 'hub_heartbeat') {
			try {
				await db.batch(statements)
			} catch (error) {
				if (isDuplicateEventError(error)) return Response.json({ ok: true, duplicate: true, serverTime: now })
				throw error
			}
			return Response.json({ ok: true, claimed: true, hubId: hub.id, serverTime: now })
		}

		if (!Array.isArray(payload.readings) || payload.readings.length === 0) {
			return Response.json({ error: 'At least one tag reading is required.' }, { status: 400 })
		}
		if (payload.readings.length > MAX_READINGS_PER_REQUEST) {
			return Response.json({ error: `Send no more than ${MAX_READINGS_PER_REQUEST} tag readings at once.` }, { status: 413 })
		}
		const readings = cleanReadings(payload.readings)
		if (!readings.length) return Response.json({ error: 'No valid tag readings were provided.' }, { status: 400 })

		const scan = await db
			.prepare(
				`
				SELECT s.id
				FROM scan_sessions s
				JOIN hub_scan_jobs j ON j.scan_id = s.id AND j.owner_sub = s.owner_sub
				WHERE s.owner_sub = ? AND s.room_id = ? AND j.hub_id = ?
					AND s.status IN ('queued', 'scanning')
					AND s.created_at <= ? AND s.expires_at >= ?
					AND j.status IN ('queued', 'dispatched', 'scanning')
				ORDER BY s.created_at DESC
				LIMIT 1
			`,
			)
			.bind(hub.owner_sub, hub.room_id, hub.id, observedAt, observedAt)
			.first<{ id: string }>()
		const scanId = scan?.id ?? null
		const acceptedReadCount = readings.reduce((sum, reading) => sum + reading.readCount, 0)

		statements.push(db.prepare('DELETE FROM tag_observations WHERE last_seen_at < ?').bind(now - 24 * 60 * 60 * 1000))
		if (scanId) {
			statements.push(
				db
					.prepare(
						`
						UPDATE hub_scan_jobs
						SET status = 'scanning', dispatched_at = COALESCE(dispatched_at, ?),
							reading_count = reading_count + ?
						WHERE scan_id = ? AND hub_id = ? AND owner_sub = ?
					`,
					)
					.bind(observedAt, acceptedReadCount, scanId, hub.id, hub.owner_sub),
				db.prepare("UPDATE scan_sessions SET status = 'scanning' WHERE id = ? AND owner_sub = ?").bind(scanId, hub.owner_sub),
			)
		}

		for (const reading of readings) {
			statements.push(
				db
					.prepare(
						`
						INSERT INTO tag_observations
							(owner_sub, hub_id, epc, rssi, antenna, frequency, read_count, first_seen_at, last_seen_at)
						VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)
						ON CONFLICT(hub_id, epc) DO UPDATE SET
							rssi = excluded.rssi,
							read_count = tag_observations.read_count + excluded.read_count,
							last_seen_at = excluded.last_seen_at
					`,
					)
					.bind(hub.owner_sub, hub.id, reading.epc, reading.rssi, reading.readCount, observedAt, observedAt),
				db
					.prepare(
						`
						UPDATE items
						SET last_seen_hub_id = ?, last_seen_at = ?, updated_at = ?
						WHERE owner_sub = ? AND room_id = ? AND tag_epc = ?
					`,
					)
					.bind(hub.id, observedAt, now, hub.owner_sub, hub.room_id, reading.epc),
			)
			if (scanId) {
				statements.push(
					db
						.prepare(
							`
							INSERT INTO scan_tag_observations
								(scan_id, owner_sub, hub_id, epc, rssi, antenna, frequency, read_count, first_seen_at, last_seen_at)
							VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
							ON CONFLICT(scan_id, hub_id, epc) DO UPDATE SET
								rssi = (
									scan_tag_observations.rssi * scan_tag_observations.read_count +
									excluded.rssi * excluded.read_count
								) / (scan_tag_observations.read_count + excluded.read_count),
								read_count = scan_tag_observations.read_count + excluded.read_count,
								last_seen_at = excluded.last_seen_at
						`,
						)
						.bind(scanId, hub.owner_sub, hub.id, reading.epc, reading.rssi, reading.readCount, observedAt, observedAt),
				)
			}
		}

		try {
			await db.batch(statements)
		} catch (error) {
			if (isDuplicateEventError(error)) return Response.json({ ok: true, duplicate: true, serverTime: now })
			throw error
		}
		return Response.json({
			ok: true,
			claimed: true,
			hubId: hub.id,
			accepted: readings.length,
			acceptedReadCount,
			scanIds: scanId ? [scanId] : [],
			serverTime: now,
		})
	} catch (error) {
		console.error('Gateway data could not be stored', error)
		return Response.json({ error: 'Gateway data could not be stored.' }, { status: 500 })
	}
}

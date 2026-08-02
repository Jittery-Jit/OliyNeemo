import { getHubDb, hashSecret } from '../../../lib/hub-db'
import { powerLevelToRelativeSignal } from '../../../lib/mqtt-contract'
import { enforceGatewayRateLimit, rejectCrossOriginRequest } from '../../../lib/request-security'
import { getRequestSession } from '../../../lib/request-session'
import {
	cloudMqttGatewayId,
	parseTeamMqttMessage,
	TEAM_MQTT_TCP_URL,
	teamMqttHeartbeatTopic,
	teamMqttTagTopic,
	type TeamMqttMessage,
} from '../../../lib/team-mqtt'
import { getWorkspaceContext } from '../../../lib/workspace'

type SubmittedMessage = Readonly<{
	topic?: string
	message?: TeamMqttMessage
}>

type ClaimedHub = Readonly<{
	id: string
	owner_sub: string
	room_id: string | null
}>

const MAX_CLOCK_SKEW_MS = 30_000
const MAX_RETAINED_AGE_MS = 30 * 24 * 60 * 60 * 1_000

function duplicateEventError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes('UNIQUE constraint failed') &&
		error.message.includes('mqtt_gateway_events.gateway_id') &&
		error.message.includes('mqtt_gateway_events.event_id')
	)
}

function observedTime(seenAt: string, now: number): number | null {
	const timestamp = Date.parse(seenAt)
	return Number.isFinite(timestamp) && timestamp <= now + MAX_CLOCK_SKEW_MS && timestamp >= now - MAX_RETAINED_AGE_MS ? timestamp : null
}

function eventReceipt(db: D1Database, gatewayId: string, eventId: string, now: number): D1PreparedStatement {
	return db.prepare('INSERT INTO mqtt_gateway_events (gateway_id, event_id, received_at) VALUES (?, ?, ?)').bind(gatewayId, eventId, now)
}

export async function POST(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const context = await getWorkspaceContext(session.sub)
		if (!context.teamId) {
			return Response.json({ error: 'Create or join a team before connecting cloud MQTT scanners.' }, { status: 409 })
		}
		const rateLimitResponse = await enforceGatewayRateLimit(cloudMqttGatewayId(context.teamId))
		if (rateLimitResponse) return rateLimitResponse

		const payload = (await request.json()) as SubmittedMessage
		const topic = payload.topic?.trim() ?? ''
		const encodedMessage = new TextEncoder().encode(JSON.stringify(payload.message ?? null))
		const message = parseTeamMqttMessage(topic, encodedMessage, context.teamId)
		if (!message) return Response.json({ error: 'MQTT topic or message body is invalid.' }, { status: 400 })
		const now = Date.now()
		const observedAt = observedTime(message.seenAt, now)
		if (observedAt === null) {
			return Response.json({ error: 'MQTT seenAt must be within 30 days and no more than 30 seconds in the future.' }, { status: 400 })
		}

		const expectedTopic =
			message.kind === 'heartbeat'
				? teamMqttHeartbeatTopic(context.teamId, message.hubId)
				: teamMqttTagTopic(context.teamId, message.hubId, message.tagId)
		if (topic !== expectedTopic) return Response.json({ error: 'MQTT topic normalization failed.' }, { status: 400 })

		const gatewayId = cloudMqttGatewayId(context.teamId)
		const eventId = await hashSecret(
			JSON.stringify([
				topic,
				message.seenAt,
				message.kind === 'tag' ? message.tagId : null,
				message.kind === 'tag' ? message.sequence : null,
				message.kind === 'tag' ? message.signalRssi : null,
				message.kind === 'tag' ? message.powerLevel : null,
			]),
		)
		const db = getHubDb()
		await db
			.prepare(
				`
					INSERT INTO mqtt_gateways
						(id, owner_sub, owner_email, name, token_hash, platform, broker_host, broker_port,
						 broker_connected, registered_at, last_seen_at, last_broker_message_at, revoked_at)
					VALUES (?, ?, ?, 'Cloud MQTT', ?, 'cloud-mqtt', ?, 2883, 1, ?, ?, ?, NULL)
					ON CONFLICT(id) DO UPDATE SET
						owner_sub = excluded.owner_sub,
						owner_email = excluded.owner_email,
						broker_connected = 1,
						last_seen_at = excluded.last_seen_at,
						last_broker_message_at = excluded.last_broker_message_at,
						revoked_at = NULL
				`,
			)
			.bind(gatewayId, context.dataOwnerSub, session.email, gatewayId, new URL(TEAM_MQTT_TCP_URL).hostname, now, now, observedAt)
			.run()

		if (
			await db
				.prepare('SELECT 1 AS found FROM mqtt_gateway_events WHERE gateway_id = ? AND event_id = ? LIMIT 1')
				.bind(gatewayId, eventId)
				.first()
		) {
			return Response.json({ ok: true, duplicate: true, serverTime: now })
		}

		const hub = await db
			.prepare('SELECT id, owner_sub, room_id FROM hubs WHERE owner_sub = ? AND device_id = ? LIMIT 1')
			.bind(context.dataOwnerSub, `mqtt:${message.hubId}`)
			.first<ClaimedHub>()
		const statements: D1PreparedStatement[] = [
			eventReceipt(db, gatewayId, eventId, now),
			db
				.prepare(
					`
						INSERT INTO mqtt_hub_discoveries
							(gateway_id, owner_sub, hardware_id, first_seen_at, last_seen_at, last_topic, claimed_hub_id)
						VALUES (?, ?, ?, ?, ?, ?, NULL)
						ON CONFLICT(gateway_id, hardware_id) DO UPDATE SET
							last_seen_at = MAX(mqtt_hub_discoveries.last_seen_at, excluded.last_seen_at),
							last_topic = CASE
								WHEN excluded.last_seen_at >= mqtt_hub_discoveries.last_seen_at THEN excluded.last_topic
								ELSE mqtt_hub_discoveries.last_topic
							END
					`,
				)
				.bind(gatewayId, context.dataOwnerSub, message.hubId, observedAt, observedAt, topic),
			db.prepare('DELETE FROM mqtt_gateway_events WHERE received_at < ?').bind(now - 24 * 60 * 60 * 1_000),
		]

		if (!hub) {
			try {
				await db.batch(statements)
			} catch (error) {
				if (duplicateEventError(error)) return Response.json({ ok: true, duplicate: true, serverTime: now })
				throw error
			}
			return Response.json({ ok: true, discovered: true, claimed: false, hardwareId: message.hubId, serverTime: now }, { status: 202 })
		}

		statements.push(
			db
				.prepare(
					`
						UPDATE hubs
						SET connection_state = 'ONLINE', connection_error = NULL,
							last_seen_at = MAX(last_seen_at, ?), updated_at = ?
						WHERE id = ? AND owner_sub = ?
					`,
				)
				.bind(observedAt, now, hub.id, hub.owner_sub),
		)
		if (message.kind === 'heartbeat') {
			try {
				await db.batch(statements)
			} catch (error) {
				if (duplicateEventError(error)) return Response.json({ ok: true, duplicate: true, serverTime: now })
				throw error
			}
			return Response.json({ ok: true, claimed: true, hubId: hub.id, serverTime: now })
		}

		const signalRssi = message.signalRssi ?? powerLevelToRelativeSignal(message.powerLevel as number)
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

		statements.push(
			db.prepare('DELETE FROM tag_observations WHERE last_seen_at < ?').bind(now - 24 * 60 * 60 * 1_000),
			db
				.prepare(
					`
						INSERT INTO tag_observations
							(owner_sub, hub_id, epc, rssi, antenna, frequency, read_count, first_seen_at, last_seen_at)
						VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)
						ON CONFLICT(hub_id, epc) DO UPDATE SET
							rssi = CASE WHEN excluded.last_seen_at >= tag_observations.last_seen_at THEN excluded.rssi ELSE tag_observations.rssi END,
							read_count = tag_observations.read_count + excluded.read_count,
							last_seen_at = MAX(tag_observations.last_seen_at, excluded.last_seen_at)
					`,
				)
				.bind(hub.owner_sub, hub.id, message.tagId, signalRssi, message.readCount, observedAt, observedAt),
			db
				.prepare(
					`
						UPDATE items
						SET last_seen_hub_id = ?, last_seen_at = ?, updated_at = ?
						WHERE owner_sub = ? AND room_id = ? AND tag_epc = ?
							AND (last_seen_at IS NULL OR last_seen_at <= ?)
					`,
				)
				.bind(hub.id, observedAt, now, hub.owner_sub, hub.room_id, message.tagId, observedAt),
		)
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
					.bind(observedAt, message.readCount, scanId, hub.id, hub.owner_sub),
				db.prepare("UPDATE scan_sessions SET status = 'scanning' WHERE id = ? AND owner_sub = ?").bind(scanId, hub.owner_sub),
				db
					.prepare(
						`
							INSERT INTO scan_tag_observations
								(scan_id, owner_sub, hub_id, epc, rssi, antenna, frequency, read_count, first_seen_at, last_seen_at)
							VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
							ON CONFLICT(scan_id, hub_id, epc) DO UPDATE SET
								rssi = CASE
									WHEN excluded.last_seen_at >= scan_tag_observations.last_seen_at THEN excluded.rssi
									ELSE scan_tag_observations.rssi
								END,
								read_count = scan_tag_observations.read_count + excluded.read_count,
								last_seen_at = MAX(scan_tag_observations.last_seen_at, excluded.last_seen_at)
						`,
					)
					.bind(scanId, hub.owner_sub, hub.id, message.tagId, signalRssi, message.readCount, observedAt, observedAt),
			)
		}

		try {
			await db.batch(statements)
		} catch (error) {
			if (duplicateEventError(error)) return Response.json({ ok: true, duplicate: true, serverTime: now })
			throw error
		}
		return Response.json({
			ok: true,
			claimed: true,
			hubId: hub.id,
			accepted: 1,
			acceptedReadCount: message.readCount,
			scanIds: scanId ? [scanId] : [],
			serverTime: now,
		})
	} catch (error) {
		console.error('Cloud MQTT data could not be stored', error)
		return Response.json({ error: 'Cloud MQTT data could not be stored.' }, { status: 500 })
	}
}

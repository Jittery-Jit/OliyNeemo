import { getHubDb, hashSecret, randomToken } from '../../../lib/hub-db'
import { formatHardwareId, isHardwareId, normalizeHardwareId } from '../../../lib/mqtt-contract'
import { rejectCrossOriginRequest } from '../../../lib/request-security'
import { getRequestSession } from '../../../lib/request-session'
import { cloudMqttGatewayId } from '../../../lib/team-mqtt'
import { canManageWorkspace, getWorkspaceContext } from '../../../lib/workspace'

export async function POST(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const payload = (await request.json()) as {
			gatewayId?: string
			hardwareId?: string
			roomId?: string
			name?: string
		}
		const gatewayId = payload.gatewayId?.trim()
		const hardwareId = normalizeHardwareId(payload.hardwareId ?? '')
		const roomId = payload.roomId?.trim()
		const name = payload.name?.trim().slice(0, 60)
		if (!gatewayId || !isHardwareId(hardwareId) || !roomId || !name) {
			return Response.json({ error: 'Choose a discovered Hub, room, and Hub name.' }, { status: 400 })
		}

		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can add Hubs.' }, { status: 403 })
		}
		if (!context.teamId || gatewayId !== cloudMqttGatewayId(context.teamId)) {
			return Response.json({ error: 'This scanner was not discovered in your team MQTT namespace.' }, { status: 404 })
		}
		const db = getHubDb()
		const [discovery, room, existing] = await Promise.all([
			db
				.prepare(
					`
          SELECT d.last_seen_at, d.claimed_hub_id
          FROM mqtt_hub_discoveries d
          JOIN mqtt_gateways g ON g.id = d.gateway_id AND g.owner_sub = d.owner_sub
          WHERE d.gateway_id = ? AND d.hardware_id = ? AND d.owner_sub = ? AND g.revoked_at IS NULL
        `,
				)
				.bind(gatewayId, hardwareId, context.dataOwnerSub)
				.first<{ last_seen_at: number; claimed_hub_id: string | null }>(),
			db.prepare('SELECT id FROM rooms WHERE id = ? AND owner_sub = ?').bind(roomId, context.dataOwnerSub).first<{ id: string }>(),
			db.prepare('SELECT id FROM hubs WHERE device_id = ?').bind(`mqtt:${hardwareId}`).first<{ id: string }>(),
		])
		if (!discovery) return Response.json({ error: 'This Hub has not been discovered by your Gateway.' }, { status: 404 })
		if (!room) return Response.json({ error: 'Room was not found.' }, { status: 404 })
		if (discovery.claimed_hub_id || existing) {
			return Response.json({ error: 'This Hub is already connected to a Neemo workspace.' }, { status: 409 })
		}

		const now = Date.now()
		const hubId = crypto.randomUUID()
		await db.batch([
			db
				.prepare(
					`
          INSERT INTO hubs
            (id, owner_sub, owner_email, room_id, name, device_id, device_token_hash, mac_address,
             ip_address, ssid, connection_state, connection_error, firmware_version, wifi_rssi,
             pos_x, pos_y, paired_at, last_seen_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'ONLINE', NULL, NULL, NULL, 50, 50, ?, ?, ?)
        `,
				)
				.bind(
					hubId,
					context.dataOwnerSub,
					session.email,
					roomId,
					name,
					`mqtt:${hardwareId}`,
					await hashSecret(randomToken()),
					formatHardwareId(hardwareId),
					now,
					discovery.last_seen_at,
					now,
				),
			db
				.prepare(
					`
          UPDATE mqtt_hub_discoveries
          SET claimed_hub_id = ?
          WHERE gateway_id = ? AND hardware_id = ? AND owner_sub = ? AND claimed_hub_id IS NULL
        `,
				)
				.bind(hubId, gatewayId, hardwareId, context.dataOwnerSub),
		])
		return Response.json({ ok: true, hubId }, { status: 201 })
	} catch (error) {
		console.error('Could not connect discovered Hub', error)
		return Response.json({ error: 'The Hub could not be connected.' }, { status: 500 })
	}
}

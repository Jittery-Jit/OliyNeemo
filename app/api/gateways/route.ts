import { createPairingCode, getHubDb, hashSecret } from '../../lib/hub-db'
import { GATEWAY_ACTIVE_WINDOW_MS, MQTT_BROKER_PORT } from '../../lib/mqtt-contract'
import { rejectCrossOriginRequest } from '../../lib/request-security'
import { getRequestSession } from '../../lib/request-session'
import { canManageWorkspace, getWorkspaceContext } from '../../lib/workspace'

type GatewayRow = {
	id: string
	name: string
	platform: string | null
	broker_host: string
	broker_port: number
	broker_connected: number
	registered_at: number
	last_seen_at: number
	last_broker_message_at: number | null
}

type DiscoveryRow = {
	gateway_id: string
	gateway_name: string
	hardware_id: string
	first_seen_at: number
	last_seen_at: number
	last_topic: string
	claimed_hub_id: string | null
}

export async function GET() {
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const context = await getWorkspaceContext(session.sub)
		const db = getHubDb()
		const [gatewayResult, discoveryResult] = await Promise.all([
			db
				.prepare(
					`
          SELECT id, name, platform, broker_host, broker_port, broker_connected,
                 registered_at, last_seen_at, last_broker_message_at
          FROM mqtt_gateways
          WHERE owner_sub = ? AND revoked_at IS NULL
          ORDER BY registered_at DESC
        `,
				)
				.bind(context.dataOwnerSub)
				.all<GatewayRow>(),
			db
				.prepare(
					`
          SELECT d.gateway_id, g.name AS gateway_name, d.hardware_id, d.first_seen_at,
                 d.last_seen_at, d.last_topic, d.claimed_hub_id
          FROM mqtt_hub_discoveries d
          JOIN mqtt_gateways g ON g.id = d.gateway_id AND g.owner_sub = d.owner_sub
          WHERE d.owner_sub = ? AND g.revoked_at IS NULL
          ORDER BY d.last_seen_at DESC
        `,
				)
				.bind(context.dataOwnerSub)
				.all<DiscoveryRow>(),
		])
		const now = Date.now()
		return Response.json({
			gateways: gatewayResult.results.map((gateway) => ({
				id: gateway.id,
				name: gateway.name,
				platform: gateway.platform,
				brokerHost: gateway.broker_host,
				brokerPort: gateway.broker_port,
				brokerConnected: Boolean(gateway.broker_connected),
				registeredAt: gateway.registered_at,
				lastSeenAt: gateway.last_seen_at,
				lastBrokerMessageAt: gateway.last_broker_message_at,
				status: now - gateway.last_seen_at <= GATEWAY_ACTIVE_WINDOW_MS ? 'online' : 'offline',
			})),
			discoveries: discoveryResult.results.map((discovery) => ({
				gatewayId: discovery.gateway_id,
				gatewayName: discovery.gateway_name,
				hardwareId: discovery.hardware_id,
				firstSeenAt: discovery.first_seen_at,
				lastSeenAt: discovery.last_seen_at,
				lastTopic: discovery.last_topic,
				claimedHubId: discovery.claimed_hub_id,
			})),
			canManage: canManageWorkspace(context),
			serverTime: now,
		})
	} catch (error) {
		console.error('Could not load Local Gateways', error)
		return Response.json({ error: 'Gateway status could not be loaded.' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const payload = (await request.json()) as { name?: string }
		const name = payload.name?.trim().slice(0, 60) || 'Neemo Gateway'
		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can connect a Gateway.' }, { status: 403 })
		}

		const now = Date.now()
		const expiresAt = now + 10 * 60 * 1000
		const code = createPairingCode()
		const db = getHubDb()
		await db.batch([
			db
				.prepare('DELETE FROM mqtt_gateway_pairing_codes WHERE owner_sub = ? AND (consumed_at IS NOT NULL OR expires_at < ?)')
				.bind(context.dataOwnerSub, now),
			db
				.prepare(
					`
          INSERT INTO mqtt_gateway_pairing_codes
            (id, owner_sub, owner_email, gateway_name, code_hash, expires_at, consumed_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
        `,
				)
				.bind(crypto.randomUUID(), context.dataOwnerSub, session.email, name, await hashSecret(code.raw), expiresAt, now),
		])
		return Response.json(
			{
				pairingCode: code.display,
				expiresAt,
				brokerPort: MQTT_BROKER_PORT,
			},
			{ status: 201 },
		)
	} catch (error) {
		console.error('Could not create Gateway setup code', error)
		return Response.json({ error: 'A Gateway setup code could not be created.' }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const payload = (await request.json()) as { id?: string }
		const id = payload.id?.trim()
		if (!id) return Response.json({ error: 'Gateway ID is required.' }, { status: 400 })
		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can disconnect a Gateway.' }, { status: 403 })
		}
		const result = await getHubDb()
			.prepare('UPDATE mqtt_gateways SET revoked_at = ? WHERE id = ? AND owner_sub = ? AND revoked_at IS NULL')
			.bind(Date.now(), id, context.dataOwnerSub)
			.run()
		if (!result.meta.changes) return Response.json({ error: 'Gateway not found.' }, { status: 404 })
		return Response.json({ ok: true })
	} catch (error) {
		console.error('Could not disconnect Local Gateway', error)
		return Response.json({ error: 'The Gateway could not be disconnected.' }, { status: 500 })
	}
}

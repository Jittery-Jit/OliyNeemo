import { getHubDb, hashSecret, normalizePairingCode, randomToken } from '../../../lib/hub-db'
import { MQTT_BROKER_PORT, MQTT_SUBSCRIPTION } from '../../../lib/mqtt-contract'
import { enforcePublicRateLimit, rejectCrossOriginRequest } from '../../../lib/request-security'

export async function POST(request: Request) {
	try {
		const crossOriginResponse = rejectCrossOriginRequest(request)
		if (crossOriginResponse) return crossOriginResponse
		const rateLimitResponse = await enforcePublicRateLimit(request, 'gateway-register')
		if (rateLimitResponse) return rateLimitResponse
		const declaredLength = Number(request.headers.get('content-length') ?? '0')
		if (declaredLength > 8 * 1024) {
			return Response.json({ error: 'Gateway registration payload is too large.' }, { status: 413 })
		}
		const payload = (await request.json()) as {
			pairingCode?: string
			name?: string
			platform?: string
			brokerHost?: string
			brokerPort?: number
		}
		const pairingCode = normalizePairingCode(payload.pairingCode ?? '')
		if (pairingCode.length !== 8) {
			return Response.json({ error: 'Enter the eight-character Gateway setup code.' }, { status: 400 })
		}
		const brokerPort = Number(payload.brokerPort ?? MQTT_BROKER_PORT)
		if (brokerPort !== MQTT_BROKER_PORT) {
			return Response.json({ error: `This version of Neemo requires broker port ${MQTT_BROKER_PORT}.` }, { status: 400 })
		}

		const now = Date.now()
		const db = getHubDb()
		const codeHash = await hashSecret(pairingCode)
		const code = await db
			.prepare(
				`
        SELECT id, owner_sub, owner_email, gateway_name
        FROM mqtt_gateway_pairing_codes
        WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
        LIMIT 1
      `,
			)
			.bind(codeHash, now)
			.first<{ id: string; owner_sub: string; owner_email: string; gateway_name: string }>()
		if (!code) return Response.json({ error: 'This Gateway setup code is invalid or expired.' }, { status: 409 })

		const gatewayId = crypto.randomUUID()
		const gatewayToken = randomToken(48)
		const name = payload.name?.trim().slice(0, 60) || code.gateway_name
		const platform = payload.platform?.trim().slice(0, 80) || null
		const brokerHost = payload.brokerHost?.trim().slice(0, 255) || '127.0.0.1'
		const result = await db.batch([
			db
				.prepare(
					`
          INSERT INTO mqtt_gateways
            (id, owner_sub, owner_email, name, token_hash, platform, broker_host, broker_port,
             broker_connected, registered_at, last_seen_at, last_broker_message_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL)
        `,
				)
				.bind(
					gatewayId,
					code.owner_sub,
					code.owner_email,
					name,
					await hashSecret(gatewayToken),
					platform,
					brokerHost,
					brokerPort,
					now,
					now,
				),
			db.prepare('UPDATE mqtt_gateway_pairing_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(now, code.id),
		])
		if (Number(result[1]?.meta.changes ?? 0) !== 1) {
			return Response.json({ error: 'This setup code was already used.' }, { status: 409 })
		}

		return Response.json(
			{
				gatewayId,
				gatewayToken,
				gatewayName: name,
				mqtt: { brokerHost, brokerPort, subscription: MQTT_SUBSCRIPTION },
				heartbeatIntervalMs: 10_000,
			},
			{ status: 201 },
		)
	} catch (error) {
		console.error('Could not register Local Gateway', error)
		return Response.json({ error: 'The Local Gateway could not be registered.' }, { status: 500 })
	}
}

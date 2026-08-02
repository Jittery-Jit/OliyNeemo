import { getHubDb, hashSecret } from './hub-db'

export type AuthenticatedGateway = {
	id: string
	ownerSub: string
	ownerEmail: string
	name: string
}

export async function authenticateGateway(request: Request): Promise<AuthenticatedGateway | null> {
	const header = request.headers.get('authorization') ?? ''
	const match = header.match(/^Bearer\s+(.+)$/i)
	if (!match?.[1]) return null

	const tokenHash = await hashSecret(match[1].trim())
	const row = await getHubDb()
		.prepare(
			`
      SELECT id, owner_sub, owner_email, name
      FROM mqtt_gateways
      WHERE token_hash = ? AND revoked_at IS NULL
      LIMIT 1
    `,
		)
		.bind(tokenHash)
		.first<{ id: string; owner_sub: string; owner_email: string; name: string }>()
	return row ? { id: row.id, ownerSub: row.owner_sub, ownerEmail: row.owner_email, name: row.name } : null
}

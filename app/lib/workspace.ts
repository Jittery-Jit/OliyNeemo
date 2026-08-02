import { getHubDb } from './hub-db'

export type WorkspaceContext = {
	dataOwnerSub: string
	teamId: string | null
	teamName: string | null
	role: 'owner' | 'admin' | 'member' | null
}

export async function getWorkspaceContext(userSub: string): Promise<WorkspaceContext> {
	const membership = await getHubDb()
		.prepare(
			`
      SELECT t.id AS team_id, t.name AS team_name, t.owner_sub, m.role
      FROM team_members m
      INNER JOIN teams t ON t.id = m.team_id
      WHERE m.user_sub = ?
      LIMIT 1
    `,
		)
		.bind(userSub)
		.first<{ team_id: string; team_name: string; owner_sub: string; role: 'owner' | 'admin' | 'member' }>()

	return membership
		? {
				dataOwnerSub: membership.owner_sub,
				teamId: membership.team_id,
				teamName: membership.team_name,
				role: membership.role,
			}
		: { dataOwnerSub: userSub, teamId: null, teamName: null, role: null }
}

export function canManageWorkspace(context: WorkspaceContext) {
	return context.teamId === null || context.role === 'owner' || context.role === 'admin'
}

export function createTeamCode() {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
	const bytes = new Uint8Array(8)
	crypto.getRandomValues(bytes)
	return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

export function normalizeTeamCode(value: string) {
	return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

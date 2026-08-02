import { getHubDb } from '../../../lib/hub-db'
import { enforcePublicRateLimit, rejectCrossOriginRequest } from '../../../lib/request-security'
import { normalizeTeamCode } from '../../../lib/workspace'

type TeamIdRow = Readonly<{
	id: string
}>

export async function POST(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const rateLimitResponse = await enforcePublicRateLimit(request, 'scanner-team-id')
	if (rateLimitResponse) return rateLimitResponse

	try {
		const payload = (await request.json()) as unknown
		const rawInviteCode =
			payload && typeof payload === 'object' && !Array.isArray(payload) && 'inviteCode' in payload && typeof payload.inviteCode === 'string'
				? payload.inviteCode
				: ''
		const inviteCode = normalizeTeamCode(rawInviteCode)
		if (inviteCode.length !== 8) {
			return Response.json({ error: 'A valid eight-character invite code is required.' }, { status: 400 })
		}

		const team = await getHubDb().prepare('SELECT id FROM teams WHERE invite_code = ? LIMIT 1').bind(inviteCode).first<TeamIdRow>()
		if (!team) return Response.json({ error: 'Invite code was not found.' }, { status: 404 })

		const response = Response.json({ teamId: team.id })
		response.headers.set('cache-control', 'no-store')
		return response
	} catch (error) {
		if (error instanceof SyntaxError) return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
		console.error('Scanner Team ID could not be resolved', error)
		return Response.json({ error: 'Team ID could not be resolved.' }, { status: 500 })
	}
}

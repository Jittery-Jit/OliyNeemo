import { getHubDb } from '../../lib/hub-db'
import { rejectCrossOriginRequest } from '../../lib/request-security'
import { getRequestSession } from '../../lib/request-session'
import { createTeamCode, getWorkspaceContext, normalizeTeamCode } from '../../lib/workspace'

type TeamRole = 'owner' | 'admin' | 'member'

type TeamRow = {
	id: string
	name: string
	owner_sub: string
	invite_code: string
	role: TeamRole
}

type ProfileRow = {
	display_name: string
	workspace_name: string
	onboarding_complete: number
}

async function ensureProfile(session: { sub: string; email: string; name: string }) {
	const db = getHubDb()
	const now = Date.now()
	const firstName = session.name.trim().split(/\s+/)[0] || 'My'
	await db
		.prepare(
			`
      INSERT INTO user_profiles
        (user_sub, email, display_name, workspace_name, onboarding_complete, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(user_sub) DO UPDATE SET
        email = excluded.email,
        updated_at = excluded.updated_at
    `,
		)
		.bind(session.sub, session.email, session.name.trim() || session.email, `${firstName}'s workspace`, now, now)
		.run()
	return db
		.prepare('SELECT display_name, workspace_name, onboarding_complete FROM user_profiles WHERE user_sub = ?')
		.bind(session.sub)
		.first<ProfileRow>()
}

async function loadTeam(userSub: string) {
	const db = getHubDb()
	const profile = await db
		.prepare('SELECT display_name, workspace_name, onboarding_complete FROM user_profiles WHERE user_sub = ?')
		.bind(userSub)
		.first<ProfileRow>()
	const team = await db
		.prepare(
			`
      SELECT t.id, t.name, t.owner_sub, t.invite_code, m.role
      FROM team_members m
      INNER JOIN teams t ON t.id = m.team_id
      WHERE m.user_sub = ?
      LIMIT 1
    `,
		)
		.bind(userSub)
		.first<TeamRow>()
	if (!team) {
		return {
			team: null,
			members: [],
			profile: profile
				? {
						name: profile.display_name,
						workspaceName: profile.workspace_name,
						onboardingComplete: Boolean(profile.onboarding_complete),
					}
				: null,
		}
	}
	const members = await db
		.prepare(
			`
      SELECT user_sub, user_email, user_name, role, joined_at
      FROM team_members
      WHERE team_id = ?
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at ASC
    `,
		)
		.bind(team.id)
		.all<{ user_sub: string; user_email: string; user_name: string; role: TeamRole; joined_at: number }>()
	return {
		team: {
			id: team.id,
			name: team.name,
			inviteCode: team.invite_code,
			role: team.role,
			ownerSub: team.owner_sub,
		},
		members: members.results.map((member) => ({
			id: member.user_sub,
			email: member.user_email,
			name: member.user_name,
			role: member.role,
			joinedAt: member.joined_at,
		})),
		profile: profile
			? {
					name: profile.display_name,
					workspaceName: profile.workspace_name,
					onboardingComplete: Boolean(profile.onboarding_complete),
				}
			: null,
	}
}

export async function GET() {
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })
	try {
		await ensureProfile(session)
		await getHubDb().prepare('UPDATE team_members SET user_email = ? WHERE user_sub = ?').bind(session.email, session.sub).run()
		return Response.json(await loadTeam(session.sub))
	} catch (error) {
		console.error('Could not load team', error)
		return Response.json({ error: 'Team information could not be loaded.' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })
	try {
		const profile = await ensureProfile(session)
		const current = await getWorkspaceContext(session.sub)
		if (current.teamId) return Response.json({ error: 'Leave your current team before joining another.' }, { status: 409 })
		const payload = (await request.json()) as { action?: string; name?: string; code?: string }
		const db = getHubDb()
		const now = Date.now()
		const memberName = profile?.display_name || session.name

		if (payload.action === 'create') {
			const name = payload.name?.trim().slice(0, 80)
			if (!name) return Response.json({ error: 'Enter a team name.' }, { status: 400 })
			let inviteCode = createTeamCode()
			while (await db.prepare('SELECT id FROM teams WHERE invite_code = ?').bind(inviteCode).first()) {
				inviteCode = createTeamCode()
			}
			const teamId = crypto.randomUUID()
			await db.batch([
				db
					.prepare('INSERT INTO teams (id, name, owner_sub, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
					.bind(teamId, name, session.sub, inviteCode, now, now),
				db
					.prepare("INSERT INTO team_members (team_id, user_sub, user_email, user_name, role, joined_at) VALUES (?, ?, ?, ?, 'owner', ?)")
					.bind(teamId, session.sub, session.email, memberName, now),
				db.prepare('UPDATE user_profiles SET onboarding_complete = 1, updated_at = ? WHERE user_sub = ?').bind(now, session.sub),
			])
			return Response.json(await loadTeam(session.sub), { status: 201 })
		}

		if (payload.action === 'join') {
			const code = normalizeTeamCode(payload.code ?? '')
			const team = await db.prepare('SELECT id FROM teams WHERE invite_code = ?').bind(code).first<{ id: string }>()
			if (!team) return Response.json({ error: 'That team code is not valid.' }, { status: 404 })
			await db.batch([
				db
					.prepare("INSERT INTO team_members (team_id, user_sub, user_email, user_name, role, joined_at) VALUES (?, ?, ?, ?, 'member', ?)")
					.bind(team.id, session.sub, session.email, memberName, now),
				db.prepare('UPDATE user_profiles SET onboarding_complete = 1, updated_at = ? WHERE user_sub = ?').bind(now, session.sub),
			])
			return Response.json(await loadTeam(session.sub), { status: 201 })
		}

		return Response.json({ error: 'Choose whether to create or join a team.' }, { status: 400 })
	} catch (error) {
		console.error('Could not update team', error)
		return Response.json({ error: 'Team changes could not be saved.' }, { status: 500 })
	}
}

export async function PATCH(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })
	try {
		await ensureProfile(session)
		const context = await getWorkspaceContext(session.sub)
		const payload = (await request.json()) as {
			action?: string
			name?: string
			workspaceName?: string
			memberId?: string
			role?: 'admin' | 'member'
			rotateCode?: boolean
		}
		const db = getHubDb()
		const now = Date.now()

		if (payload.action === 'renameSelf') {
			const name = payload.name?.trim().slice(0, 80)
			if (!name) return Response.json({ error: 'Enter your name.' }, { status: 400 })
			await db.batch([
				db.prepare('UPDATE user_profiles SET display_name = ?, updated_at = ? WHERE user_sub = ?').bind(name, now, session.sub),
				db.prepare('UPDATE team_members SET user_name = ? WHERE user_sub = ?').bind(name, session.sub),
			])
			return Response.json(await loadTeam(session.sub))
		}

		if (payload.action === 'renameWorkspace') {
			const workspaceName = payload.workspaceName?.trim().slice(0, 80)
			if (!workspaceName) return Response.json({ error: 'Enter a workspace name.' }, { status: 400 })
			await db
				.prepare('UPDATE user_profiles SET workspace_name = ?, updated_at = ? WHERE user_sub = ?')
				.bind(workspaceName, now, session.sub)
				.run()
			return Response.json(await loadTeam(session.sub))
		}

		if (payload.action === 'skipOnboarding') {
			await db.prepare('UPDATE user_profiles SET onboarding_complete = 1, updated_at = ? WHERE user_sub = ?').bind(now, session.sub).run()
			return Response.json(await loadTeam(session.sub))
		}

		if (payload.action === 'setRole') {
			if (!context.teamId || context.role !== 'owner') {
				return Response.json({ error: 'Only the team owner can change admin access.' }, { status: 403 })
			}
			const memberId = payload.memberId?.trim()
			if (!memberId || memberId === session.sub || (payload.role !== 'admin' && payload.role !== 'member')) {
				return Response.json({ error: 'Choose another team member and a valid role.' }, { status: 400 })
			}
			const target = await db
				.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_sub = ?')
				.bind(context.teamId, memberId)
				.first<{ role: TeamRole }>()
			if (!target) return Response.json({ error: 'Team member was not found.' }, { status: 404 })
			if (target.role === 'owner') return Response.json({ error: 'The team owner role cannot be changed.' }, { status: 400 })
			await db
				.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_sub = ?')
				.bind(payload.role, context.teamId, memberId)
				.run()
			return Response.json(await loadTeam(session.sub))
		}

		if (!context.teamId || (context.role !== 'owner' && context.role !== 'admin')) {
			return Response.json({ error: 'Only the team owner or an admin can change team settings.' }, { status: 403 })
		}
		const name = payload.name?.trim().slice(0, 80)
		if (payload.name !== undefined && !name) {
			return Response.json({ error: 'Enter a team name.' }, { status: 400 })
		}
		if (name) {
			await db.prepare('UPDATE teams SET name = ?, updated_at = ? WHERE id = ?').bind(name, now, context.teamId).run()
		}
		if (payload.rotateCode) {
			let code = createTeamCode()
			while (await db.prepare('SELECT id FROM teams WHERE invite_code = ?').bind(code).first()) code = createTeamCode()
			await db.prepare('UPDATE teams SET invite_code = ?, updated_at = ? WHERE id = ?').bind(code, now, context.teamId).run()
		}
		return Response.json(await loadTeam(session.sub))
	} catch (error) {
		console.error('Could not edit team', error)
		return Response.json({ error: 'Team changes could not be saved.' }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })
	try {
		const context = await getWorkspaceContext(session.sub)
		if (!context.teamId) return Response.json({ error: 'You are not on a team.' }, { status: 404 })
		const payload = (await request.json()) as { memberId?: string; leave?: boolean }
		const db = getHubDb()
		if (payload.leave) {
			if (context.role === 'owner') {
				const count = await db
					.prepare('SELECT COUNT(*) AS count FROM team_members WHERE team_id = ?')
					.bind(context.teamId)
					.first<{ count: number }>()
				if ((count?.count ?? 0) > 1) return Response.json({ error: 'Remove other members before deleting the team.' }, { status: 409 })
				await db.batch([
					db.prepare('DELETE FROM team_members WHERE team_id = ?').bind(context.teamId),
					db.prepare('DELETE FROM teams WHERE id = ?').bind(context.teamId),
				])
			} else {
				await db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_sub = ?').bind(context.teamId, session.sub).run()
			}
			return Response.json(await loadTeam(session.sub))
		}

		if (context.role !== 'owner' && context.role !== 'admin') {
			return Response.json({ error: 'Only an owner or admin can remove members.' }, { status: 403 })
		}
		const memberId = payload.memberId?.trim()
		if (!memberId || memberId === session.sub) return Response.json({ error: 'Choose another team member.' }, { status: 400 })
		const target = await db
			.prepare('SELECT role, user_name FROM team_members WHERE team_id = ? AND user_sub = ?')
			.bind(context.teamId, memberId)
			.first<{ role: TeamRole; user_name: string }>()
		if (!target) return Response.json({ error: 'Team member was not found.' }, { status: 404 })
		if (target.role === 'owner') return Response.json({ error: 'The team owner cannot be removed.' }, { status: 400 })
		await db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_sub = ?').bind(context.teamId, memberId).run()
		return Response.json(await loadTeam(session.sub))
	} catch (error) {
		console.error('Could not remove team member', error)
		return Response.json({ error: 'Team member could not be removed.' }, { status: 500 })
	}
}

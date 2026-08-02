import { getHubDb } from '../../../lib/hub-db'
import { rejectCrossOriginRequest } from '../../../lib/request-security'
import { getRequestSession } from '../../../lib/request-session'
import { canManageWorkspace, getWorkspaceContext } from '../../../lib/workspace'

type LabelRow = {
	id: string
	name: string
	left_distance: number
	front_distance: number
	created_at: number
	updated_at: number
}

function serializeLabel(row: LabelRow) {
	return {
		id: row.id,
		name: row.name,
		leftDistance: row.left_distance,
		frontDistance: row.front_distance,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

export async function GET(request: Request) {
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })
	try {
		const roomId = new URL(request.url).searchParams.get('roomId')?.trim()
		if (!roomId) return Response.json({ labels: [] })
		const { dataOwnerSub } = await getWorkspaceContext(session.sub)
		const result = await getHubDb()
			.prepare(
				'SELECT id, name, left_distance, front_distance, created_at, updated_at FROM room_labels WHERE owner_sub = ? AND room_id = ? ORDER BY created_at ASC',
			)
			.bind(dataOwnerSub, roomId)
			.all<LabelRow>()
		return Response.json({ labels: result.results.map(serializeLabel) })
	} catch (error) {
		console.error('Could not load room labels', error)
		return Response.json({ error: 'Room labels could not be loaded.' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })
	try {
		const payload = (await request.json()) as { roomId?: string; name?: string; leftDistance?: number; frontDistance?: number }
		const roomId = payload.roomId?.trim()
		const name = payload.name?.trim().slice(0, 50)
		const leftDistance = Number(payload.leftDistance)
		const frontDistance = Number(payload.frontDistance)
		if (!roomId) return Response.json({ error: 'Choose a room.' }, { status: 400 })
		if (!name) return Response.json({ error: 'Enter a label name.' }, { status: 400 })
		if (![leftDistance, frontDistance].every((value) => Number.isFinite(value) && value >= 0)) {
			return Response.json({ error: 'Enter valid distances from the left and front walls.' }, { status: 400 })
		}

		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can edit room labels.' }, { status: 403 })
		}
		const { dataOwnerSub } = context
		const db = getHubDb()
		const room = await db
			.prepare('SELECT length, width FROM rooms WHERE id = ? AND owner_sub = ?')
			.bind(roomId, dataOwnerSub)
			.first<{ length: number; width: number }>()
		if (!room) return Response.json({ error: 'Measure your room before adding labels.' }, { status: 409 })
		if (leftDistance > room.length || frontDistance > room.width) {
			return Response.json({ error: 'That position falls outside the measured room.' }, { status: 400 })
		}
		const now = Date.now()
		const id = crypto.randomUUID()
		await db
			.prepare(
				'INSERT INTO room_labels (id, owner_sub, room_id, name, left_distance, front_distance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
			)
			.bind(id, dataOwnerSub, roomId, name, leftDistance, frontDistance, now, now)
			.run()
		return Response.json({ label: { id, name, leftDistance, frontDistance, createdAt: now, updatedAt: now } }, { status: 201 })
	} catch (error) {
		console.error('Could not add room label', error)
		return Response.json({ error: 'Room label could not be added.' }, { status: 500 })
	}
}

export async function DELETE(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })
	try {
		const payload = (await request.json()) as { id?: string; roomId?: string }
		const id = payload.id?.trim()
		const roomId = payload.roomId?.trim()
		if (!id || !roomId) return Response.json({ error: 'Choose a room label.' }, { status: 400 })
		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can edit room labels.' }, { status: 403 })
		}
		const { dataOwnerSub } = context
		const result = await getHubDb()
			.prepare('DELETE FROM room_labels WHERE id = ? AND owner_sub = ? AND room_id = ?')
			.bind(id, dataOwnerSub, roomId)
			.run()
		if (!result.meta.changes) return Response.json({ error: 'Room label was not found.' }, { status: 404 })
		return Response.json({ ok: true })
	} catch (error) {
		console.error('Could not remove room label', error)
		return Response.json({ error: 'Room label could not be removed.' }, { status: 500 })
	}
}

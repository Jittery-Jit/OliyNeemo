import { getHubDb } from '../../lib/hub-db'
import { rejectCrossOriginRequest } from '../../lib/request-security'
import { getRequestSession } from '../../lib/request-session'
import { canManageWorkspace, getWorkspaceContext } from '../../lib/workspace'

type RoomRow = {
	id: string
	name: string
	length: number
	width: number
	unit: 'ft' | 'm'
	created_at: number
	updated_at: number
}

function serializeRoom(room: RoomRow) {
	return {
		id: room.id,
		name: room.name,
		length: room.length,
		width: room.width,
		unit: room.unit,
		createdAt: room.created_at,
		updatedAt: room.updated_at,
	}
}

function readRoomInput(payload: { name?: string; length?: number; width?: number; unit?: string }) {
	const name = payload.name?.trim().slice(0, 60) ?? ''
	const length = Number(payload.length)
	const width = Number(payload.width)
	const unit = payload.unit === 'm' ? 'm' : 'ft'
	if (!name) return { error: 'Give this room a name.' } as const
	if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0 || length > 1000 || width > 1000) {
		return { error: 'Enter valid room measurements greater than zero.' } as const
	}
	return { name, length, width, unit } as const
}

export async function GET() {
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const context = await getWorkspaceContext(session.sub)
		const result = await getHubDb()
			.prepare('SELECT id, name, length, width, unit, created_at, updated_at FROM rooms WHERE owner_sub = ? ORDER BY created_at ASC')
			.bind(context.dataOwnerSub)
			.all<RoomRow>()
		return Response.json({
			rooms: result.results.map(serializeRoom),
			canManage: canManageWorkspace(context),
		})
	} catch (error) {
		console.error('Could not load rooms', error)
		return Response.json({ error: 'Rooms could not be loaded.' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const input = readRoomInput((await request.json()) as { name?: string; length?: number; width?: number; unit?: string })
		if ('error' in input) return Response.json({ error: input.error }, { status: 400 })
		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can add rooms.' }, { status: 403 })
		}
		const db = getHubDb()
		const now = Date.now()
		const id = crypto.randomUUID()
		await db
			.prepare(
				'INSERT INTO rooms (id, owner_sub, owner_email, name, length, width, unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
			)
			.bind(id, context.dataOwnerSub, session.email, input.name, input.length, input.width, input.unit, now, now)
			.run()
		return Response.json(
			{
				room: { id, ...input, createdAt: now, updatedAt: now },
			},
			{ status: 201 },
		)
	} catch (error) {
		console.error('Could not create room', error)
		return Response.json({ error: 'Room could not be created.' }, { status: 500 })
	}
}

export async function PATCH(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const payload = (await request.json()) as { id?: string; name?: string; length?: number; width?: number; unit?: string }
		const id = payload.id?.trim()
		if (!id) return Response.json({ error: 'Choose a room to edit.' }, { status: 400 })
		const input = readRoomInput(payload)
		if ('error' in input) return Response.json({ error: input.error }, { status: 400 })

		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can edit rooms.' }, { status: 403 })
		}
		const db = getHubDb()
		const existing = await db
			.prepare('SELECT id, length, width, unit, created_at FROM rooms WHERE id = ? AND owner_sub = ?')
			.bind(id, context.dataOwnerSub)
			.first<{ id: string; length: number; width: number; unit: string; created_at: number }>()
		if (!existing) return Response.json({ error: 'Room was not found.' }, { status: 404 })
		const now = Date.now()
		const dimensionsChanged = existing.length !== input.length || existing.width !== input.width || existing.unit !== input.unit
		const update = db
			.prepare('UPDATE rooms SET name = ?, length = ?, width = ?, unit = ?, owner_email = ?, updated_at = ? WHERE id = ? AND owner_sub = ?')
			.bind(input.name, input.length, input.width, input.unit, session.email, now, id, context.dataOwnerSub)
		if (dimensionsChanged) {
			await db.batch([
				update,
				db
					.prepare('DELETE FROM hub_placements WHERE owner_sub = ? AND hub_id IN (SELECT id FROM hubs WHERE owner_sub = ? AND room_id = ?)')
					.bind(context.dataOwnerSub, context.dataOwnerSub, id),
				db.prepare('DELETE FROM room_labels WHERE owner_sub = ? AND room_id = ?').bind(context.dataOwnerSub, id),
			])
		} else {
			await update.run()
		}
		return Response.json({
			room: { id, ...input, createdAt: existing.created_at, updatedAt: now },
		})
	} catch (error) {
		console.error('Could not save room', error)
		return Response.json({ error: 'Room changes could not be saved.' }, { status: 500 })
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
		if (!id) return Response.json({ error: 'Choose a room to remove.' }, { status: 400 })
		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can remove rooms.' }, { status: 403 })
		}
		const db = getHubDb()
		const usage = await db
			.prepare(
				`
        SELECT
          (SELECT COUNT(*) FROM hubs WHERE owner_sub = ? AND room_id = ?) AS hub_count,
          (SELECT COUNT(*) FROM items WHERE owner_sub = ? AND room_id = ?) AS item_count
      `,
			)
			.bind(context.dataOwnerSub, id, context.dataOwnerSub, id)
			.first<{ hub_count: number; item_count: number }>()
		if ((usage?.hub_count ?? 0) > 0 || (usage?.item_count ?? 0) > 0) {
			return Response.json({ error: "Move or remove this room's Hubs and items before deleting it." }, { status: 409 })
		}
		await db.batch([
			db.prepare('DELETE FROM room_labels WHERE owner_sub = ? AND room_id = ?').bind(context.dataOwnerSub, id),
			db.prepare('DELETE FROM rooms WHERE id = ? AND owner_sub = ?').bind(id, context.dataOwnerSub),
		])
		return Response.json({ ok: true })
	} catch (error) {
		console.error('Could not remove room', error)
		return Response.json({ error: 'Room could not be removed.' }, { status: 500 })
	}
}

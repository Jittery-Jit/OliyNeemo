import { getHubDb, normalizeEpc } from '../../lib/hub-db'
import { getItemImageBucket, itemImageUrl } from '../../lib/item-images'
import { rejectCrossOriginRequest } from '../../lib/request-security'
import { getRequestSession } from '../../lib/request-session'
import { canManageWorkspace, getWorkspaceContext } from '../../lib/workspace'

type ItemRow = {
	id: string
	room_id: string | null
	name: string
	image_key: string | null
	category: string
	tag_epc: string
	home_hub_id: string | null
	home_hub_name: string | null
	last_seen_hub_id: string | null
	last_seen_hub_name: string | null
	last_seen_at: number | null
	created_at: number
	updated_at: number
}

function serializeItem(row: ItemRow) {
	return {
		id: row.id,
		roomId: row.room_id,
		name: row.name,
		imageUrl: row.image_key ? itemImageUrl(row.id, row.updated_at) : null,
		category: row.category,
		tagEpc: row.tag_epc,
		homeHubId: row.home_hub_id,
		homeHubName: row.home_hub_name,
		lastSeenHubId: row.last_seen_hub_id,
		lastSeenHubName: row.last_seen_hub_name,
		lastSeenAt: row.last_seen_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

const itemSelect = `
  SELECT
    i.id, i.room_id, i.name, i.image_key, i.category, i.tag_epc, i.home_hub_id,
    home.name AS home_hub_name,
    i.last_seen_hub_id, seen.name AS last_seen_hub_name,
    i.last_seen_at, i.created_at, i.updated_at
  FROM items i
  LEFT JOIN hubs home ON home.id = i.home_hub_id AND home.owner_sub = i.owner_sub
  LEFT JOIN hubs seen ON seen.id = i.last_seen_hub_id AND seen.owner_sub = i.owner_sub
`

export async function GET(request: Request) {
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const roomId = new URL(request.url).searchParams.get('roomId')?.trim()
		if (!roomId) return Response.json({ items: [] })
		const context = await getWorkspaceContext(session.sub)
		const { dataOwnerSub } = context
		const result = await getHubDb()
			.prepare(`${itemSelect} WHERE i.owner_sub = ? AND i.room_id = ? ORDER BY COALESCE(i.last_seen_at, i.created_at) DESC, i.name ASC`)
			.bind(dataOwnerSub, roomId)
			.all<ItemRow>()
		return Response.json({ items: result.results.map(serializeItem) })
	} catch (error) {
		console.error('Could not load inventory', error)
		return Response.json({ error: 'Inventory could not be loaded.' }, { status: 500 })
	}
}

export async function POST(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const payload = (await request.json()) as {
			epc?: string
			roomId?: string
			name?: string
			category?: string
			homeHubId?: string | null
			scanId?: string
		}
		const epc = normalizeEpc(payload.epc ?? '')
		const roomId = payload.roomId?.trim() ?? ''
		const name = payload.name?.trim().slice(0, 100) ?? ''
		const category = payload.category?.trim().slice(0, 50) ?? ''
		const homeHubId = payload.homeHubId?.trim() || null

		if (!roomId) return Response.json({ error: 'Choose a room for this item.' }, { status: 400 })
		if (!/^[A-Z0-9:_-]{4,128}$/.test(epc)) {
			return Response.json({ error: 'Tag EPC is invalid.' }, { status: 400 })
		}
		if (!name) return Response.json({ error: 'Item name is required.' }, { status: 400 })
		if (!category) return Response.json({ error: 'Category is required.' }, { status: 400 })

		const { dataOwnerSub } = await getWorkspaceContext(session.sub)
		const db = getHubDb()
		const room = await db.prepare('SELECT id FROM rooms WHERE id = ? AND owner_sub = ?').bind(roomId, dataOwnerSub).first()
		if (!room) return Response.json({ error: 'Room was not found.' }, { status: 404 })
		if (homeHubId) {
			const homeHub = await db
				.prepare('SELECT id FROM hubs WHERE id = ? AND owner_sub = ? AND room_id = ?')
				.bind(homeHubId, dataOwnerSub, roomId)
				.first<{ id: string }>()
			if (!homeHub) return Response.json({ error: 'Home Hub was not found.' }, { status: 400 })
		}

		let observationCutoff = Date.now() - 2 * 60 * 1000
		if (payload.scanId?.trim()) {
			const scan = await db
				.prepare("SELECT created_at FROM scan_sessions WHERE id = ? AND owner_sub = ? AND room_id = ? AND mode = 'label'")
				.bind(payload.scanId.trim(), dataOwnerSub, roomId)
				.first<{ created_at: number }>()
			if (!scan) return Response.json({ error: 'The RFID labelling scan was not found.' }, { status: 409 })
			observationCutoff = scan.created_at
		}

		const observation = await db
			.prepare(
				`
        SELECT o.hub_id, o.last_seen_at
        FROM tag_observations o
        INNER JOIN hubs h ON h.id = o.hub_id AND h.owner_sub = o.owner_sub
        WHERE o.owner_sub = ? AND h.room_id = ? AND o.epc = ? AND o.last_seen_at >= ?
        ORDER BY o.last_seen_at DESC
        LIMIT 1
      `,
			)
			.bind(dataOwnerSub, roomId, epc, observationCutoff)
			.first<{ hub_id: string; last_seen_at: number }>()
		if (!observation) {
			return Response.json({ error: 'This tag has not been seen by one of your Hubs recently.' }, { status: 409 })
		}

		const now = Date.now()
		const id = crypto.randomUUID()
		await db
			.prepare(
				`
        INSERT INTO items
          (id, owner_sub, owner_email, name, category, tag_epc, home_hub_id,
           room_id, last_seen_hub_id, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
			)
			.bind(id, dataOwnerSub, session.email, name, category, epc, homeHubId, roomId, observation.hub_id, observation.last_seen_at, now, now)
			.run()

		const row = await db.prepare(`${itemSelect} WHERE i.id = ? AND i.owner_sub = ?`).bind(id, dataOwnerSub).first<ItemRow>()
		return Response.json({ item: row ? serializeItem(row) : null }, { status: 201 })
	} catch (error) {
		const message = error instanceof Error ? error.message : ''
		if (message.includes('UNIQUE constraint failed')) {
			return Response.json({ error: 'That RFID tag is already assigned to an item.' }, { status: 409 })
		}
		console.error('Could not save item', error)
		return Response.json({ error: 'Item could not be saved.' }, { status: 500 })
	}
}

export async function PATCH(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const payload = (await request.json()) as {
			id?: string
			roomId?: string
			name?: string
			category?: string
			homeHubId?: string | null
		}
		const id = payload.id?.trim()
		if (!id) return Response.json({ error: 'Item ID is required.' }, { status: 400 })

		const context = await getWorkspaceContext(session.sub)
		const { dataOwnerSub } = context
		const db = getHubDb()
		const existing = await db
			.prepare('SELECT name, category, home_hub_id, room_id, last_seen_hub_id, last_seen_at FROM items WHERE id = ? AND owner_sub = ?')
			.bind(id, dataOwnerSub)
			.first<{
				name: string
				category: string
				home_hub_id: string | null
				room_id: string | null
				last_seen_hub_id: string | null
				last_seen_at: number | null
			}>()
		if (!existing) return Response.json({ error: 'Item not found.' }, { status: 404 })

		const name = payload.name === undefined ? existing.name : payload.name.trim().slice(0, 100)
		const category = payload.category === undefined ? existing.category : payload.category.trim().slice(0, 50)
		const roomId = payload.roomId === undefined ? existing.room_id : payload.roomId?.trim() || null
		const homeHubId = payload.homeHubId === undefined ? existing.home_hub_id : payload.homeHubId?.trim() || null
		if (
			!canManageWorkspace(context) &&
			(category !== existing.category || roomId !== existing.room_id || homeHubId !== existing.home_hub_id)
		) {
			return Response.json(
				{ error: 'Members can rename items and change their images, but only an owner or admin can change item setup.' },
				{ status: 403 },
			)
		}
		if (!name) return Response.json({ error: 'Item name is required.' }, { status: 400 })
		if (!category) return Response.json({ error: 'Category is required.' }, { status: 400 })
		if (!roomId) return Response.json({ error: 'Choose a room for this item.' }, { status: 400 })
		const roomChanged = roomId !== existing.room_id
		const room = await db.prepare('SELECT id FROM rooms WHERE id = ? AND owner_sub = ?').bind(roomId, dataOwnerSub).first()
		if (!room) return Response.json({ error: 'Room was not found.' }, { status: 404 })

		if (homeHubId) {
			const homeHub = await db
				.prepare('SELECT id FROM hubs WHERE id = ? AND owner_sub = ? AND room_id = ?')
				.bind(homeHubId, dataOwnerSub, roomId)
				.first<{ id: string }>()
			if (!homeHub) return Response.json({ error: 'Home Hub was not found.' }, { status: 400 })
		}

		await db
			.prepare(
				'UPDATE items SET name = ?, category = ?, room_id = ?, home_hub_id = ?, last_seen_hub_id = ?, last_seen_at = ?, updated_at = ? WHERE id = ? AND owner_sub = ?',
			)
			.bind(
				name,
				category,
				roomId,
				homeHubId,
				roomChanged ? null : existing.last_seen_hub_id,
				roomChanged ? null : existing.last_seen_at,
				Date.now(),
				id,
				dataOwnerSub,
			)
			.run()
		const row = await db.prepare(`${itemSelect} WHERE i.id = ? AND i.owner_sub = ?`).bind(id, dataOwnerSub).first<ItemRow>()
		return Response.json({ item: row ? serializeItem(row) : null })
	} catch (error) {
		console.error('Could not update item', error)
		return Response.json({ error: 'Item changes could not be saved.' }, { status: 500 })
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
		if (!id) return Response.json({ error: 'Item ID is required.' }, { status: 400 })

		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can remove items.' }, { status: 403 })
		}
		const { dataOwnerSub } = context
		const db = getHubDb()
		const existing = await db
			.prepare('SELECT image_key FROM items WHERE id = ? AND owner_sub = ?')
			.bind(id, dataOwnerSub)
			.first<{ image_key: string | null }>()
		if (!existing) return Response.json({ error: 'Item not found.' }, { status: 404 })
		const result = await db.prepare('DELETE FROM items WHERE id = ? AND owner_sub = ?').bind(id, dataOwnerSub).run()
		if (!result.meta.changes) return Response.json({ error: 'Item not found.' }, { status: 404 })
		if (existing.image_key) {
			try {
				await getItemImageBucket().delete(existing.image_key)
			} catch (error) {
				console.error('Could not remove deleted item image', error)
			}
		}
		return Response.json({ ok: true })
	} catch (error) {
		console.error('Could not remove item', error)
		return Response.json({ error: 'Item could not be removed.' }, { status: 500 })
	}
}

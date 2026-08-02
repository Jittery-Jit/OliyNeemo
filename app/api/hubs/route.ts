import { getHubDb } from '../../lib/hub-db'
import { HUB_ACTIVE_WINDOW_MS, HUB_DELAYED_WINDOW_MS } from '../../lib/mqtt-contract'
import { rejectCrossOriginRequest } from '../../lib/request-security'
import { getRequestSession } from '../../lib/request-session'
import { canManageWorkspace, getWorkspaceContext } from '../../lib/workspace'

type HubRow = {
	id: string
	room_id: string | null
	name: string
	device_id: string
	mac_address: string | null
	ip_address: string | null
	ssid: string | null
	connection_state: string
	connection_error: string | null
	firmware_version: string | null
	wifi_rssi: number | null
	pos_x: number
	pos_y: number
	paired_at: number
	last_seen_at: number
	left_distance: number | null
	right_distance: number | null
	top_distance: number | null
	bottom_distance: number | null
}

function serializeHub(row: HubRow, now = Date.now()) {
	const age = now - row.last_seen_at
	const status =
		row.connection_state === 'FAILED'
			? 'needs-attention'
			: row.connection_state === 'UNPROVISIONED' || row.connection_state === 'CONNECTING' || row.connection_state === 'PORTAL_PENDING'
				? 'setting-up'
				: row.connection_state === 'ONLINE' && age <= HUB_ACTIVE_WINDOW_MS
					? 'online'
					: row.connection_state === 'ONLINE' && age <= HUB_DELAYED_WINDOW_MS
						? 'delayed'
						: 'offline'
	const shortDeviceId = (row.mac_address ?? row.device_id)
		.replace(/[^A-Fa-f0-9]/g, '')
		.slice(-4)
		.toUpperCase()

	return {
		id: row.id,
		roomId: row.room_id,
		name: row.name,
		deviceId: row.device_id,
		shortDeviceId,
		macAddress: row.mac_address,
		ipAddress: row.ip_address,
		ssid: row.ssid,
		connectionState: row.connection_state,
		errorCode: row.connection_error,
		firmwareVersion: row.firmware_version,
		wifiRssi: row.wifi_rssi,
		x: row.pos_x,
		y: row.pos_y,
		pairedAt: row.paired_at,
		lastSeenAt: row.last_seen_at,
		placement:
			row.left_distance === null
				? null
				: {
						left: row.left_distance,
						right: row.right_distance,
						top: row.top_distance,
						bottom: row.bottom_distance,
					},
		status,
	}
}

export async function GET(request: Request) {
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const roomId = new URL(request.url).searchParams.get('roomId')?.trim()
		if (!roomId) return Response.json({ hubs: [], serverTime: Date.now() })
		const { dataOwnerSub } = await getWorkspaceContext(session.sub)
		const result = await getHubDb()
			.prepare(
				`
        SELECT h.id, h.room_id, h.name, h.device_id, h.mac_address, h.ip_address, h.ssid,
               h.connection_state, h.connection_error, h.firmware_version, h.wifi_rssi, h.pos_x, h.pos_y,
               h.paired_at, h.last_seen_at, p.left_distance, p.right_distance, p.top_distance, p.bottom_distance
        FROM hubs h
        LEFT JOIN hub_placements p ON p.hub_id = h.id AND p.owner_sub = h.owner_sub
        WHERE h.owner_sub = ? AND h.room_id = ? AND h.device_id NOT LIKE 'web-test-%'
        ORDER BY paired_at ASC
      `,
			)
			.bind(dataOwnerSub, roomId)
			.all<HubRow>()

		const now = Date.now()
		return Response.json({ hubs: result.results.map((row) => serializeHub(row, now)), serverTime: now })
	} catch (error) {
		console.error('Could not load Hubs', error)
		return Response.json({ error: 'Hubs could not be loaded.' }, { status: 500 })
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
			x?: number
			y?: number
			placement?: { left?: number; right?: number; top?: number; bottom?: number }
		}
		const id = payload.id?.trim()
		if (!id) return Response.json({ error: 'Hub ID is required.' }, { status: 400 })

		const name = payload.name?.trim().slice(0, 60)
		const x = typeof payload.x === 'number' ? Math.min(96, Math.max(4, payload.x)) : null
		const y = typeof payload.y === 'number' ? Math.min(96, Math.max(4, payload.y)) : null
		if (!name && x === null && y === null && !payload.placement && !payload.roomId?.trim()) {
			return Response.json({ error: 'No Hub changes were provided.' }, { status: 400 })
		}

		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can edit Hubs.' }, { status: 403 })
		}
		const { dataOwnerSub } = context
		const db = getHubDb()
		const existing = await db
			.prepare('SELECT name, room_id, pos_x, pos_y FROM hubs WHERE id = ? AND owner_sub = ?')
			.bind(id, dataOwnerSub)
			.first<{ name: string; room_id: string | null; pos_x: number; pos_y: number }>()
		if (!existing) return Response.json({ error: 'Hub not found.' }, { status: 404 })
		const nextRoomId = payload.roomId?.trim() || existing.room_id
		if (!nextRoomId) return Response.json({ error: 'Choose a room for this Hub.' }, { status: 400 })
		const room = await db
			.prepare('SELECT length, width FROM rooms WHERE id = ? AND owner_sub = ?')
			.bind(nextRoomId, dataOwnerSub)
			.first<{ length: number; width: number }>()
		if (!room) return Response.json({ error: 'Room was not found.' }, { status: 404 })
		const roomChanged = existing.room_id !== nextRoomId

		let calibratedX = roomChanged ? 50 : x
		let calibratedY = roomChanged ? 50 : y
		const statements = []
		if (roomChanged) {
			statements.push(db.prepare('DELETE FROM hub_placements WHERE hub_id = ? AND owner_sub = ?').bind(id, dataOwnerSub))
		}
		if (payload.placement) {
			const left = Number(payload.placement.left)
			const right = Number(payload.placement.right)
			const top = Number(payload.placement.top)
			const bottom = Number(payload.placement.bottom)
			if (![left, right, top, bottom].every((value) => Number.isFinite(value) && value >= 0)) {
				return Response.json({ error: 'Enter all four wall distances.' }, { status: 400 })
			}

			const horizontalTolerance = Math.max(0.25, room.length * 0.1)
			const verticalTolerance = Math.max(0.25, room.width * 0.1)
			if (Math.abs(left + right - room.length) > horizontalTolerance) {
				return Response.json({ error: `Left and right measurements should add up to about ${room.length}.` }, { status: 400 })
			}
			if (Math.abs(top + bottom - room.width) > verticalTolerance) {
				return Response.json({ error: `Front and back measurements should add up to about ${room.width}.` }, { status: 400 })
			}

			calibratedX = Math.min(96, Math.max(4, (left / room.length) * 100))
			calibratedY = Math.min(96, Math.max(4, (top / room.width) * 100))
			statements.push(
				db
					.prepare(
						`
            INSERT INTO hub_placements
              (hub_id, owner_sub, left_distance, right_distance, top_distance, bottom_distance, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(hub_id) DO UPDATE SET
              owner_sub = excluded.owner_sub,
              left_distance = excluded.left_distance,
              right_distance = excluded.right_distance,
              top_distance = excluded.top_distance,
              bottom_distance = excluded.bottom_distance,
              updated_at = excluded.updated_at
          `,
					)
					.bind(id, dataOwnerSub, left, right, top, bottom, Date.now()),
			)
		}

		statements.push(
			db
				.prepare('UPDATE hubs SET name = ?, room_id = ?, pos_x = ?, pos_y = ?, updated_at = ? WHERE id = ? AND owner_sub = ?')
				.bind(
					name || existing.name,
					nextRoomId,
					calibratedX ?? existing.pos_x,
					calibratedY ?? existing.pos_y,
					Date.now(),
					id,
					dataOwnerSub,
				),
		)
		await db.batch(statements)

		return Response.json({ ok: true })
	} catch (error) {
		console.error('Could not update Hub', error)
		return Response.json({ error: 'Hub changes could not be saved.' }, { status: 500 })
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
		if (!id) return Response.json({ error: 'Hub ID is required.' }, { status: 400 })

		const context = await getWorkspaceContext(session.sub)
		if (!canManageWorkspace(context)) {
			return Response.json({ error: 'Only the team owner or an admin can disconnect Hubs.' }, { status: 403 })
		}
		const { dataOwnerSub } = context
		const db = getHubDb()
		const existing = await db.prepare('SELECT id FROM hubs WHERE id = ? AND owner_sub = ?').bind(id, dataOwnerSub).first<{ id: string }>()
		if (!existing) return Response.json({ error: 'Hub not found.' }, { status: 404 })

		const now = Date.now()
		await db.batch([
			db.prepare('UPDATE items SET home_hub_id = NULL, updated_at = ? WHERE owner_sub = ? AND home_hub_id = ?').bind(now, dataOwnerSub, id),
			db
				.prepare('UPDATE items SET last_seen_hub_id = NULL, updated_at = ? WHERE owner_sub = ? AND last_seen_hub_id = ?')
				.bind(now, dataOwnerSub, id),
			db.prepare('DELETE FROM tag_observations WHERE owner_sub = ? AND hub_id = ?').bind(dataOwnerSub, id),
			db.prepare('DELETE FROM hub_scan_jobs WHERE owner_sub = ? AND hub_id = ?').bind(dataOwnerSub, id),
			db.prepare('DELETE FROM hub_placements WHERE owner_sub = ? AND hub_id = ?').bind(dataOwnerSub, id),
			db.prepare('UPDATE mqtt_hub_discoveries SET claimed_hub_id = NULL WHERE owner_sub = ? AND claimed_hub_id = ?').bind(dataOwnerSub, id),
			db.prepare('DELETE FROM hubs WHERE id = ? AND owner_sub = ?').bind(id, dataOwnerSub),
		])
		return Response.json({ ok: true })
	} catch (error) {
		console.error('Could not disconnect Hub', error)
		return Response.json({ error: 'Hub could not be disconnected.' }, { status: 500 })
	}
}

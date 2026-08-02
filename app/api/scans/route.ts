import { getHubDb, HUB_ONLINE_WINDOW_MS, SCAN_EXPIRY_MS } from '../../lib/hub-db'
import { rejectCrossOriginRequest } from '../../lib/request-security'
import { getRequestSession } from '../../lib/request-session'
import {
	estimateLocation,
	type ScanMode,
	type ScanObservationRow,
	type ScanRow,
	summarizeUnlabelledTags,
	updateScanStatus,
} from '../../lib/scan-results'
import { getWorkspaceContext } from '../../lib/workspace'

type OnlineHubRow = {
	id: string
	name: string
	pos_x: number
	pos_y: number
	last_seen_at: number
}

export async function POST(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const payload = (await request.json()) as {
			mode?: ScanMode
			itemId?: string
			roomId?: string
		}
		const mode = payload.mode
		const roomId = payload.roomId?.trim()
		if (mode !== 'label' && mode !== 'locate') {
			return Response.json({ error: 'Scan mode must be label or locate.' }, { status: 400 })
		}
		if (!roomId) return Response.json({ error: 'Choose a room to scan.' }, { status: 400 })

		const { dataOwnerSub } = await getWorkspaceContext(session.sub)
		const db = getHubDb()
		const now = Date.now()
		const room = await db.prepare('SELECT id FROM rooms WHERE id = ? AND owner_sub = ?').bind(roomId, dataOwnerSub).first<{ id: string }>()
		if (!room) return Response.json({ error: 'Room was not found.' }, { status: 404 })
		const hubCandidates = await db
			.prepare(
				`
        SELECT h.id, h.name, h.pos_x, h.pos_y, h.last_seen_at
        FROM hubs h
        INNER JOIN hub_placements p ON p.hub_id = h.id AND p.owner_sub = h.owner_sub
        WHERE h.owner_sub = ? AND h.room_id = ?
          AND h.device_id NOT LIKE 'web-test-%'
        ORDER BY h.paired_at ASC
      `,
			)
			.bind(dataOwnerSub, roomId)
			.all<OnlineHubRow>()
		const hubs = hubCandidates.results.filter((hub) => hub.last_seen_at >= now - HUB_ONLINE_WINDOW_MS)
		if (!hubs.length) {
			return Response.json({ error: 'At least one online Hub is required to scan.' }, { status: 409 })
		}

		let targetItemId: string | null = null
		let targetEpc: string | null = null
		if (mode === 'locate') {
			targetItemId = payload.itemId?.trim() || null
			if (!targetItemId) return Response.json({ error: 'Choose an item to locate.' }, { status: 400 })
			const item = await db
				.prepare('SELECT tag_epc FROM items WHERE id = ? AND owner_sub = ? AND room_id = ?')
				.bind(targetItemId, dataOwnerSub, roomId)
				.first<{ tag_epc: string }>()
			if (!item) return Response.json({ error: 'Item not found.' }, { status: 404 })
			targetEpc = item.tag_epc
		}

		const scanId = crypto.randomUUID()
		const expiresAt = now + SCAN_EXPIRY_MS
		const statements = [
			db
				.prepare(
					`
          UPDATE hub_scan_jobs
          SET status = 'expired', completed_at = COALESCE(completed_at, ?)
          WHERE owner_sub = ?
            AND scan_id IN (
              SELECT id FROM scan_sessions
              WHERE owner_sub = ? AND room_id = ? AND status IN ('queued', 'scanning')
            )
        `,
				)
				.bind(now, dataOwnerSub, dataOwnerSub, roomId),
			db
				.prepare(
					`
          UPDATE scan_sessions
          SET status = 'expired', completed_at = COALESCE(completed_at, ?)
          WHERE owner_sub = ? AND room_id = ? AND status IN ('queued', 'scanning')
        `,
				)
				.bind(now, dataOwnerSub, roomId),
			db
				.prepare(
					`
          DELETE FROM scan_tag_observations
          WHERE scan_id IN (SELECT id FROM scan_sessions WHERE created_at < ?)
        `,
				)
				.bind(now - 24 * 60 * 60 * 1000),
			db
				.prepare(
					`
          INSERT INTO scan_sessions
            (id, owner_sub, owner_email, room_id, mode, target_item_id, target_epc, status, created_at, expires_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'scanning', ?, ?, NULL)
        `,
				)
				.bind(scanId, dataOwnerSub, session.email, roomId, mode, targetItemId, targetEpc, now, expiresAt),
		]
		for (const hub of hubs) {
			statements.push(
				db
					.prepare(
						`
            INSERT INTO hub_scan_jobs
              (scan_id, hub_id, owner_sub, status, requested_at, dispatched_at, completed_at, reading_count)
            VALUES (?, ?, ?, 'scanning', ?, ?, NULL, 0)
          `,
					)
					.bind(scanId, hub.id, dataOwnerSub, now, now),
			)
		}

		await db.batch(statements)

		return Response.json(
			{
				scan: {
					id: scanId,
					mode,
					status: 'scanning',
					createdAt: now,
					expiresAt,
					hubCount: hubs.length,
				},
			},
			{ status: 201 },
		)
	} catch (error) {
		console.error('Could not start RFID scan', error)
		return Response.json({ error: 'RFID scan could not be started.' }, { status: 500 })
	}
}

export async function GET(request: Request) {
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const scanId = new URL(request.url).searchParams.get('id')?.trim()
		if (!scanId) return Response.json({ error: 'Scan ID is required.' }, { status: 400 })

		const { dataOwnerSub } = await getWorkspaceContext(session.sub)
		const db = getHubDb()
		const scan = await db
			.prepare(
				`
        SELECT id, room_id, mode, target_item_id, target_epc, status, created_at, expires_at, completed_at
        FROM scan_sessions
        WHERE id = ? AND owner_sub = ?
      `,
			)
			.bind(scanId, dataOwnerSub)
			.first<ScanRow>()
		if (!scan) return Response.json({ error: 'Scan not found.' }, { status: 404 })

		const progress = await updateScanStatus(db, scan)
		const commonSelect = `
      SELECT o.epc, o.hub_id, h.name AS hub_name, h.pos_x AS hub_x, h.pos_y AS hub_y,
             r.length AS room_length, r.width AS room_width, r.unit AS room_unit,
             o.rssi, o.read_count, o.last_seen_at
      FROM scan_tag_observations o
      JOIN hubs h ON h.id = o.hub_id AND h.owner_sub = o.owner_sub
      JOIN rooms r ON r.id = h.room_id AND r.owner_sub = h.owner_sub
    `

		let tags: ReturnType<typeof summarizeUnlabelledTags> = []
		let estimate: ReturnType<typeof estimateLocation> = null
		if (scan.mode === 'label') {
			const result = await db
				.prepare(
					`
          ${commonSelect}
          LEFT JOIN items i ON i.owner_sub = o.owner_sub AND i.tag_epc = o.epc
          WHERE o.scan_id = ? AND o.owner_sub = ? AND h.room_id = ? AND i.id IS NULL
          ORDER BY o.last_seen_at DESC
          LIMIT 300
        `,
				)
				.bind(scan.id, dataOwnerSub, scan.room_id)
				.all<ScanObservationRow>()
			tags = summarizeUnlabelledTags(result.results)
		} else if (scan.target_epc) {
			const result = await db
				.prepare(
					`
          ${commonSelect}
          WHERE o.scan_id = ? AND o.owner_sub = ? AND h.room_id = ? AND o.epc = ?
          ORDER BY o.rssi DESC
        `,
				)
				.bind(scan.id, dataOwnerSub, scan.room_id, scan.target_epc)
				.all<ScanObservationRow>()
			estimate = estimateLocation(result.results)
		}

		return Response.json({
			scan: {
				id: scan.id,
				mode: scan.mode,
				status: progress.status,
				createdAt: scan.created_at,
				expiresAt: scan.expires_at,
				hubs: progress.hubs,
			},
			tags,
			estimate,
			serverTime: Date.now(),
		})
	} catch (error) {
		console.error('Could not load RFID scan', error)
		return Response.json({ error: 'RFID scan could not be loaded.' }, { status: 500 })
	}
}

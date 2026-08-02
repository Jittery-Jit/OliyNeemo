import { estimateByRssiTrilateration } from './trilateration'

export type ScanMode = 'label' | 'locate'

export type ScanRow = {
	id: string
	room_id: string | null
	mode: ScanMode
	target_item_id: string | null
	target_epc: string | null
	status: string
	created_at: number
	expires_at: number
	completed_at: number | null
}

export type ScanObservationRow = {
	epc: string
	hub_id: string
	hub_name: string
	hub_x: number
	hub_y: number
	room_length: number
	room_width: number
	room_unit: 'ft' | 'm'
	rssi: number
	read_count: number
	last_seen_at: number
}

type JobSummary = {
	total: number
	queued: number
	active: number
	completed: number
	reading_count: number
}

export function summarizeUnlabelledTags(rows: ScanObservationRow[]) {
	const grouped = new Map<
		string,
		{
			epc: string
			strongestRssi: number
			nearestHubId: string
			nearestHubName: string
			hubCount: number
			readCount: number
			lastSeenAt: number
			hubIds: Set<string>
		}
	>()

	for (const row of rows) {
		const existing = grouped.get(row.epc)
		if (!existing) {
			grouped.set(row.epc, {
				epc: row.epc,
				strongestRssi: row.rssi,
				nearestHubId: row.hub_id,
				nearestHubName: row.hub_name,
				hubCount: 1,
				readCount: row.read_count,
				lastSeenAt: row.last_seen_at,
				hubIds: new Set([row.hub_id]),
			})
			continue
		}

		existing.readCount += row.read_count
		existing.lastSeenAt = Math.max(existing.lastSeenAt, row.last_seen_at)
		existing.hubIds.add(row.hub_id)
		existing.hubCount = existing.hubIds.size
		if (row.rssi > existing.strongestRssi) {
			existing.strongestRssi = row.rssi
			existing.nearestHubId = row.hub_id
			existing.nearestHubName = row.hub_name
		}
	}

	return Array.from(grouped.values())
		.sort((a, b) => b.lastSeenAt - a.lastSeenAt || b.strongestRssi - a.strongestRssi)
		.slice(0, 50)
		.map((value) => {
			const { hubIds, ...tag } = value
			void hubIds
			return tag
		})
}

export function estimateLocation(rows: ScanObservationRow[]) {
	if (!rows.length) return null

	const room = rows[0]
	const unitScale = room.room_unit === 'ft' ? 0.3048 : 1
	const lengthMeters = room.room_length * unitScale
	const widthMeters = room.room_width * unitScale
	const solution = estimateByRssiTrilateration(
		rows.map((row) => ({
			hubId: row.hub_id,
			hubName: row.hub_name,
			xMeters: (row.hub_x / 100) * lengthMeters,
			yMeters: (row.hub_y / 100) * widthMeters,
			rssi: row.rssi,
			readCount: row.read_count,
			lastSeenAt: row.last_seen_at,
		})),
		{ lengthMeters, widthMeters },
	)
	if (!solution) return null

	return {
		x: Math.min(99, Math.max(1, Math.round((solution.xMeters / lengthMeters) * 1000) / 10)),
		y: Math.min(99, Math.max(1, Math.round((solution.yMeters / widthMeters) * 1000) / 10)),
		confidence: solution.confidence,
		radiusMeters: solution.radiusMeters,
		zone: `Near ${solution.nearestHubName}`,
		nearestHubId: solution.nearestHubId,
		nearestHubName: solution.nearestHubName,
		hubCount: solution.readings.length,
		lastSeenAt: Math.max(...solution.readings.map((row) => row.lastSeenAt)),
		readings: solution.readings.map((row) => ({
			hubId: row.hubId,
			hubName: row.hubName,
			rssi: row.rssi,
			readCount: row.readCount,
			lastSeenAt: row.lastSeenAt,
			estimatedDistanceMeters: row.estimatedDistanceMeters,
			residualDb: row.residualDb,
		})),
		method: solution.method,
		fitErrorDb: solution.fitErrorDb,
		geometryCoverage: solution.geometryCoverage,
	}
}

export async function updateScanStatus(db: D1Database, scan: ScanRow, now = Date.now()) {
	const jobs = await db
		.prepare(
			`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status IN ('dispatched', 'scanning') THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS completed,
        COALESCE(SUM(reading_count), 0) AS reading_count
      FROM hub_scan_jobs
      WHERE scan_id = ?
    `,
		)
		.bind(scan.id)
		.first<JobSummary>()

	const summary = {
		total: Number(jobs?.total ?? 0),
		queued: Number(jobs?.queued ?? 0),
		active: Number(jobs?.active ?? 0),
		completed: Number(jobs?.completed ?? 0),
		readingCount: Number(jobs?.reading_count ?? 0),
	}

	let status = scan.status
	if (summary.total > 0 && summary.completed === summary.total) status = 'complete'
	else if (now >= scan.expires_at) status = summary.readingCount > 0 ? 'complete' : 'expired'
	else if (summary.active > 0 || summary.readingCount > 0) status = 'scanning'
	else status = 'queued'

	if (status !== scan.status || ((status === 'complete' || status === 'expired') && !scan.completed_at)) {
		await db
			.prepare('UPDATE scan_sessions SET status = ?, completed_at = ? WHERE id = ?')
			.bind(status, status === 'complete' || status === 'expired' ? now : null, scan.id)
			.run()
	}

	return { status, hubs: summary }
}

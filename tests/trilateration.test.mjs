import assert from 'node:assert/strict'
import test from 'node:test'

import { estimateByRssiTrilateration } from '../app/lib/trilateration.ts'

const room = { lengthMeters: 10, widthMeters: 8 }
const hubs = [
	{ hubId: 'nw', hubName: 'Northwest', xMeters: 0.7, yMeters: 0.7 },
	{ hubId: 'ne', hubName: 'Northeast', xMeters: 9.3, yMeters: 0.7 },
	{ hubId: 'sw', hubName: 'Southwest', xMeters: 0.7, yMeters: 7.3 },
	{ hubId: 'se', hubName: 'Southeast', xMeters: 9.3, yMeters: 7.3 },
]

function readingsAt(x, y, { referenceRssi = -31, pathLossExponent = 2.4, noise = [] } = {}) {
	return hubs.map((hub, index) => {
		const distance = Math.max(0.12, Math.hypot(x - hub.xMeters, y - hub.yMeters))
		return {
			...hub,
			rssi: referenceRssi - 10 * pathLossExponent * Math.log10(distance) + (noise[index] ?? 0),
			readCount: 12 + index,
			lastSeenAt: 1_000_000 - index * 50,
		}
	})
}

test('four measured Hubs locate an item by RSSI-ratio trilateration', () => {
	const target = { x: 6.2, y: 2.7 }
	const result = estimateByRssiTrilateration(readingsAt(target.x, target.y, { noise: [0.25, -0.2, 0.15, -0.1] }), room)

	assert.ok(result)
	assert.equal(result.method, 'robust RSSI-ratio trilateration')
	assert.ok(Math.hypot(result.xMeters - target.x, result.yMeters - target.y) < 0.65)
	assert.ok(result.radiusMeters >= 0.45)
	assert.equal(result.readings.length, 4)
})

test('unknown tag strength cancels out of the relative-distance calculation', () => {
	const target = { x: 3.4, y: 5.6 }
	const strongTag = estimateByRssiTrilateration(readingsAt(target.x, target.y, { referenceRssi: -24 }), room)
	const weakTag = estimateByRssiTrilateration(readingsAt(target.x, target.y, { referenceRssi: -49 }), room)

	assert.ok(strongTag && weakTag)
	assert.ok(Math.abs(strongTag.xMeters - weakTag.xMeters) < 0.02)
	assert.ok(Math.abs(strongTag.yMeters - weakTag.yMeters) < 0.02)
})

test('robust weighting limits the damage from one reflected-signal outlier', () => {
	const target = { x: 7.1, y: 5.1 }
	const result = estimateByRssiTrilateration(readingsAt(target.x, target.y, { noise: [0, 0, 0, 7.5] }), room)

	assert.ok(result)
	assert.ok(Math.hypot(result.xMeters - target.x, result.yMeters - target.y) < 1.8)
	assert.ok(Number.isFinite(result.fitErrorDb))
})

test('fewer than three Hubs returns a bounded low-confidence proximity estimate', () => {
	const result = estimateByRssiTrilateration(readingsAt(4, 3).slice(0, 2), room)

	assert.ok(result)
	assert.equal(result.method, 'Hub proximity estimate')
	assert.equal(result.confidence, 'low')
	assert.ok(result.xMeters >= 0 && result.xMeters <= room.lengthMeters)
	assert.ok(result.yMeters >= 0 && result.yMeters <= room.widthMeters)
})

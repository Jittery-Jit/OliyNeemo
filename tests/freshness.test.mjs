import assert from 'node:assert/strict'
import test from 'node:test'
import {
	DEMO_FRESHNESS,
	DEMO_ITEM_FRESH_MS,
	freshnessLabel,
	lastSeenLabel,
	REAL_FRESHNESS,
	REAL_ITEM_FRESH_MS,
	SCANNER_IDLE_MS,
	SCANNER_OFFLINE_MS,
	scannerIsActive,
	scannerStatus,
	sourceAwareFreshness,
	tagFreshness,
} from '../app/lib/freshness.ts'

const now = Date.parse('2026-07-29T20:00:00.000Z')

test('demo tags are live for exactly 15 seconds after their latest message', () => {
	assert.equal(DEMO_ITEM_FRESH_MS, 15_000)
	assert.equal(DEMO_FRESHNESS.liveMs, 15_000)
	assert.equal(tagFreshness(now - 14_999, now, DEMO_FRESHNESS), 'live')
	// After the live window a demo tag is retained last-known history, with
	// no intermediate state — that is all the broker actually knows.
	assert.equal(tagFreshness(now - 15_000, now, DEMO_FRESHNESS), 'stale')
	assert.equal(tagFreshness(now - 90_000, now, DEMO_FRESHNESS), 'stale')
	assert.equal(tagFreshness(null, now, DEMO_FRESHNESS), 'never')
	assert.equal(tagFreshness(0, now, DEMO_FRESHNESS), 'never')
})

test('real items become historical after 30 seconds', () => {
	assert.equal(REAL_ITEM_FRESH_MS, 30_000)
	assert.equal(tagFreshness(now - 29_999, now, REAL_FRESHNESS), 'live')
	assert.equal(tagFreshness(now - 30_000, now, REAL_FRESHNESS), 'recent')
	assert.equal(tagFreshness(now - 5 * 60_000, now, REAL_FRESHNESS), 'recent')
	assert.equal(tagFreshness(now - 11 * 60_000, now, REAL_FRESHNESS), 'stale')
})

test('a reading cannot remain live after its source goes offline', () => {
	assert.equal(sourceAwareFreshness(now - 5_000, now, REAL_FRESHNESS, true), 'live')
	assert.equal(sourceAwareFreshness(now - 5_000, now, REAL_FRESHNESS, false), 'recent')
	assert.equal(sourceAwareFreshness(now - 5 * 60_000, now, REAL_FRESHNESS, false), 'recent')
	assert.equal(sourceAwareFreshness(now - 11 * 60_000, now, REAL_FRESHNESS, false), 'stale')
	assert.equal(sourceAwareFreshness(null, now, REAL_FRESHNESS, false), 'never')
})

test('the scanner moves from publishing to idle, then offline after 30 seconds', () => {
	assert.equal(SCANNER_IDLE_MS, 12_000)
	assert.equal(SCANNER_OFFLINE_MS, 30_000)
	assert.equal(scannerIsActive(now - 11_999, now), true)
	assert.equal(scannerIsActive(now - 12_000, now), false)
	assert.equal(scannerIsActive(0, now), false)
	assert.equal(scannerIsActive(now, 0), false)
	assert.equal(scannerStatus(now - 11_999, now), 'publishing')
	assert.equal(scannerStatus(now - 12_000, now), 'idle')
	assert.equal(scannerStatus(now - 29_999, now), 'idle')
	assert.equal(scannerStatus(now - 30_000, now), 'offline')
	assert.equal(scannerStatus(now - 90_000, now), 'offline')
	assert.equal(scannerStatus(0, now), 'offline')
})

test('freshness states have plain-language labels', () => {
	assert.equal(freshnessLabel('live'), 'Live now')
	assert.equal(freshnessLabel('recent'), 'Seen recently')
	assert.equal(freshnessLabel('stale'), 'Last known')
	assert.equal(freshnessLabel('never'), 'Not seen yet')
})

test('relative timestamps read naturally at every magnitude', () => {
	assert.equal(lastSeenLabel(null, now), 'not seen yet')
	assert.equal(lastSeenLabel(now - 3_000, now), 'just now')
	assert.equal(lastSeenLabel(now - 42_000, now), '42s ago')
	assert.equal(lastSeenLabel(now - 8 * 60_000, now), '8m ago')
	assert.equal(lastSeenLabel(now - 3 * 3_600_000, now), '3h ago')
	assert.equal(lastSeenLabel(now - 3 * 86_400_000, now), '3d ago')
})

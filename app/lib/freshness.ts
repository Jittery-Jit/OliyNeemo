// Shared freshness semantics for tags, items, and the demo scanner.
// A reading is only ever described from its real timestamp; these helpers
// translate age into the product's honest states.

export type Freshness = 'live' | 'recent' | 'stale' | 'never'
export type ScannerStatus = 'publishing' | 'idle' | 'offline'

export type FreshnessWindows = Readonly<{
	liveMs: number
	recentMs: number
}>

// Demo tags stay "live" for 15 seconds after their latest MQTT message and
// then read as retained last-known history straight away — that mirrors what
// the broker actually knows.
export const DEMO_ITEM_FRESH_MS = 15_000
export const DEMO_FRESHNESS: FreshnessWindows = { liveMs: DEMO_ITEM_FRESH_MS, recentMs: DEMO_ITEM_FRESH_MS }

// Real items remain live for the same 30-second window used to decide whether
// their scanner is still reporting. After that they become orange history.
export const REAL_ITEM_FRESH_MS = 30_000
export const REAL_FRESHNESS: FreshnessWindows = { liveMs: REAL_ITEM_FRESH_MS, recentMs: 10 * 60_000 }

// The mock scanner cycles every ~1.8 s. A short gap means it is idle; once
// thirty seconds pass without a publish, the product must call it offline.
export const SCANNER_IDLE_MS = 12_000
export const SCANNER_OFFLINE_MS = 30_000

export function tagFreshness(lastSeenAt: number | null | undefined, now: number, windows: FreshnessWindows): Freshness {
	if (!lastSeenAt || lastSeenAt <= 0) return 'never'
	const age = now - lastSeenAt
	if (age < windows.liveMs) return 'live'
	if (age < windows.recentMs) return 'recent'
	return 'stale'
}

export function sourceAwareFreshness(
	lastSeenAt: number | null | undefined,
	now: number,
	windows: FreshnessWindows,
	sourceIsOnline: boolean,
): Freshness {
	const freshness = tagFreshness(lastSeenAt, now, windows)
	return freshness === 'live' && !sourceIsOnline ? 'recent' : freshness
}

export function freshnessLabel(freshness: Freshness): string {
	if (freshness === 'live') return 'Live now'
	if (freshness === 'recent') return 'Seen recently'
	if (freshness === 'stale') return 'Last known'
	return 'Not seen yet'
}

export function scannerStatus(latestSeenAt: number, now: number): ScannerStatus {
	if (latestSeenAt <= 0 || now <= 0 || now - latestSeenAt >= SCANNER_OFFLINE_MS) return 'offline'
	return now - latestSeenAt < SCANNER_IDLE_MS ? 'publishing' : 'idle'
}

export function scannerIsActive(latestSeenAt: number, now: number): boolean {
	return scannerStatus(latestSeenAt, now) === 'publishing'
}

export function lastSeenLabel(timestamp: number | null | undefined, now: number): string {
	if (!timestamp || timestamp <= 0) return 'not seen yet'
	const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
	if (seconds < 10) return 'just now'
	if (seconds < 60) return `${seconds}s ago`
	const minutes = Math.round(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.round(minutes / 60)
	if (hours < 48) return `${hours}h ago`
	return `${Math.round(hours / 24)}d ago`
}

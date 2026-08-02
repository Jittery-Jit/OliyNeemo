import { getCloudflareEnv } from './cloudflare'

export function getHubDb(): D1Database {
	return getCloudflareEnv().DB
}

export async function hashSecret(value: string) {
	const bytes = new TextEncoder().encode(value)
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomToken(byteLength = 32) {
	const bytes = new Uint8Array(byteLength)
	crypto.getRandomValues(bytes)
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/g, '')
}

const pairingAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function createPairingCode() {
	const bytes = new Uint8Array(8)
	crypto.getRandomValues(bytes)
	const raw = Array.from(bytes, (byte) => pairingAlphabet[byte % pairingAlphabet.length]).join('')
	return { raw, display: `${raw.slice(0, 4)}-${raw.slice(4)}` }
}

export function normalizePairingCode(value: string) {
	return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function normalizeEpc(value: string) {
	return value.trim().toUpperCase().replace(/\s+/g, '')
}

export const HUB_ONLINE_WINDOW_MS = 30_000
export const SCAN_DURATION_MS = 8_000
export const SCAN_EXPIRY_MS = SCAN_DURATION_MS

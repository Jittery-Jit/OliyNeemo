import { jwtVerify, SignJWT } from 'jose'
import { getCloudflareEnv } from './cloudflare'

export type NeemoSession = {
	sub: string
	email: string
	name: string
	picture?: string
}

function sessionKey() {
	const secret = getCloudflareEnv().SESSION_SECRET
	if (secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters')
	return new TextEncoder().encode(secret)
}

export async function createSessionToken(user: NeemoSession) {
	const key = sessionKey()

	return new SignJWT({
		email: user.email,
		name: user.name,
		picture: user.picture,
	})
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setSubject(user.sub)
		.setIssuedAt()
		.setExpirationTime('365d')
		.sign(key)
}

export async function verifySessionToken(token?: string): Promise<NeemoSession | null> {
	if (!token) return null
	const key = sessionKey()

	try {
		const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
		if (!payload.sub || typeof payload.email !== 'string' || typeof payload.name !== 'string') return null

		return {
			sub: payload.sub,
			email: payload.email,
			name: payload.name,
			picture: typeof payload.picture === 'string' ? payload.picture : undefined,
		}
	} catch {
		return null
	}
}

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

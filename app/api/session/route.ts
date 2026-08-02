import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { enforcePublicRateLimit, rejectCrossOriginRequest } from '../../lib/request-security'
import { createSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken } from '../../lib/session'

export async function POST(request: Request) {
	try {
		const crossOriginResponse = rejectCrossOriginRequest(request)
		if (crossOriginResponse) return crossOriginResponse
		const rateLimitResponse = await enforcePublicRateLimit(request, 'session')
		if (rateLimitResponse) return rateLimitResponse

		const cookieStore = await cookies()
		const existing = await verifySessionToken(cookieStore.get('neemo_session')?.value)
		const deviceId = crypto.randomUUID()
		const shortId = deviceId.replaceAll('-', '').slice(0, 8).toUpperCase()
		const user = existing ?? {
			sub: `device:${deviceId}`,
			email: `device-${shortId.toLowerCase()}@anonymous.neemo`,
			name: 'Neemo User',
		}
		const session = await createSessionToken(user)
		const response = NextResponse.json({ ready: true })

		response.cookies.set('neemo_session', session, {
			httpOnly: true,
			secure: new URL(request.url).protocol === 'https:',
			sameSite: 'lax',
			path: '/',
			maxAge: SESSION_MAX_AGE_SECONDS,
		})
		response.headers.set('cache-control', 'no-store')

		return response
	} catch (error) {
		console.error('Anonymous Neemo session could not be created', error)
		return NextResponse.json({ error: 'Neemo could not create this device profile.' }, { status: 503 })
	}
}

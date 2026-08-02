import { cookies } from 'next/headers'
import { verifySessionToken } from './session'

export async function getRequestSession() {
	const cookieStore = await cookies()
	return verifySessionToken(cookieStore.get('neemo_session')?.value)
}

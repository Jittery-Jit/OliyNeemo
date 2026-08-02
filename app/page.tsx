import { cookies } from 'next/headers'
import AnonymousEntry from './AnonymousEntry'
import NeemoApp from './NeemoApp'
import { verifySessionToken } from './lib/session'

export const dynamic = 'force-dynamic'

export default async function Home() {
	const cookieStore = await cookies()
	const session = await verifySessionToken(cookieStore.get('neemo_session')?.value)

	if (!session) {
		return <AnonymousEntry />
	}

	return (
		<NeemoApp
			initialProfile={{
				name: session.name,
				email: session.email,
				role: 'Team admin',
			}}
		/>
	)
}

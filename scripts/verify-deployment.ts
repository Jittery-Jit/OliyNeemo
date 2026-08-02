import assert from 'node:assert/strict'
import process from 'node:process'

type JsonObject = Readonly<Record<string, unknown>>

function expectStatus(response: Response, status: number, label: string): void {
	assert.equal(response.status, status, `${label} returned ${response.status}`)
}

function deploymentUrl(): URL {
	const value = process.env.NEEMO_DEPLOYMENT_URL
	if (!value) throw new Error('Set NEEMO_DEPLOYMENT_URL to the deployed Worker URL.')
	const url = new URL(value)
	if (url.protocol !== 'https:') throw new Error('NEEMO_DEPLOYMENT_URL must use HTTPS.')
	return url
}

async function verifyDeployment(): Promise<void> {
	const baseUrl = deploymentUrl()
	const endpoint = (path: string) => new URL(path, baseUrl)

	const landing = await fetch(baseUrl)
	expectStatus(landing, 200, 'landing page')
	assert.match(await landing.text(), /Neemo/)
	const contentSecurityPolicy = landing.headers.get('content-security-policy') ?? ''
	assert.match(contentSecurityPolicy, /frame-ancestors 'none'/)
	assert.match(contentSecurityPolicy, /connect-src 'self' wss:\/\/neemo\.xy\.icu/)
	assert.equal(landing.headers.get('x-content-type-options'), 'nosniff')

	const session = await fetch(endpoint('/api/session'), {
		method: 'POST',
		headers: { origin: baseUrl.origin },
	})
	expectStatus(session, 200, 'session creation')
	assert.equal(session.headers.get('cache-control'), 'no-store')
	const setCookie = session.headers.get('set-cookie') ?? ''
	assert.match(setCookie, /^neemo_session=/)
	assert.match(setCookie, /;\s*HttpOnly/i)
	assert.match(setCookie, /;\s*Secure/i)
	assert.match(setCookie, /;\s*SameSite=Lax/i)
	const cookie = setCookie.split(';', 1)[0]

	const rooms = await fetch(endpoint('/api/room'), { headers: { cookie } })
	expectStatus(rooms, 200, 'authenticated D1 room query')
	const roomResult = (await rooms.json()) as JsonObject
	assert.ok(Array.isArray(roomResult.rooms))

	for (const origin of ['https://attacker.example', 'not a valid origin']) {
		const rejectedMutation = await fetch(endpoint('/api/room'), {
			method: 'POST',
			headers: { cookie, 'content-type': 'application/json', origin },
			body: JSON.stringify({ name: 'Rejected Room', length: 20, width: 12, unit: 'ft' }),
		})
		expectStatus(rejectedMutation, 403, `room mutation with origin ${origin}`)
	}

	const scannerTeamIdValidation = await fetch(endpoint('/api/scanners/team-id'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ inviteCode: 'BAD' }),
	})
	expectStatus(scannerTeamIdValidation, 400, 'scanner Team ID validation')

	const teamMqttWithoutTeam = await fetch(endpoint('/api/mqtt/ingest'), {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json', origin: baseUrl.origin },
		body: '{}',
	})
	expectStatus(teamMqttWithoutTeam, 409, 'team-scoped MQTT guard')

	console.log(`Deployment verification passed: ${baseUrl.origin}`)
}

await verifyDeployment()

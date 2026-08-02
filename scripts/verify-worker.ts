import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const projectDirectory = resolve(import.meta.dirname, '..')
const workerEntry = join(projectDirectory, '.open-next', 'worker.js')
const verificationPort = Number(process.env.NEEMO_VERIFY_PORT ?? 43_762)
const baseUrl = `http://127.0.0.1:${verificationPort}`
const sessionSecret = 'neemo-local-verification-session-secret-1234567890'

type JsonObject = Readonly<Record<string, unknown>>

function commandOutput(chunks: readonly Buffer[]): string {
	return Buffer.concat(chunks).toString('utf8')
}

async function run(command: string, arguments_: readonly string[]): Promise<void> {
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const child = spawn(command, arguments_, {
			cwd: projectDirectory,
			env: { ...process.env, SESSION_SECRET: sessionSecret, WRANGLER_SEND_METRICS: 'false' },
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		const output: Buffer[] = []
		child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
		child.stderr.on('data', (chunk: Buffer) => output.push(chunk))
		child.on('error', rejectPromise)
		child.on('exit', (code) => {
			if (code === 0) {
				resolvePromise()
				return
			}
			rejectPromise(new Error(`${command} exited with status ${code ?? 'unknown'}.\n${commandOutput(output)}`))
		})
	})
}

async function json(response: Response): Promise<JsonObject> {
	return (await response.json()) as JsonObject
}

function expectStatus(response: Response, status: number, label: string): void {
	assert.equal(response.status, status, `${label} returned ${response.status}`)
}

async function waitForWorker(): Promise<void> {
	for (const attempt of Array.from({ length: 60 }, (_, index) => index)) {
		try {
			const response = await fetch(baseUrl)
			if (response.ok) return
		} catch {
			// Wrangler is still starting.
		}
		await delay(attempt < 10 ? 250 : 500)
	}
	throw new Error('The local Worker did not become ready within 30 seconds.')
}

async function verifyHttpFlow(): Promise<void> {
	const landing = await fetch(baseUrl)
	expectStatus(landing, 200, 'landing page')
	assert.match(await landing.text(), /Neemo/)
	const contentSecurityPolicy = landing.headers.get('content-security-policy') ?? ''
	assert.match(contentSecurityPolicy, /frame-ancestors 'none'/)
	assert.match(contentSecurityPolicy, /connect-src 'self' wss:\/\/neemo\.xy\.icu/)

	const sessionResponse = await fetch(`${baseUrl}/api/session`, { method: 'POST' })
	expectStatus(sessionResponse, 200, 'session creation')
	const cookie = sessionResponse.headers.get('set-cookie')?.split(';', 1)[0]
	if (!cookie?.startsWith('neemo_session=')) throw new Error('Session cookie is missing.')

	const crossOrigin = await fetch(`${baseUrl}/api/room`, {
		method: 'POST',
		headers: {
			cookie,
			'content-type': 'application/json',
			origin: 'https://attacker.example',
		},
		body: JSON.stringify({ name: 'Unsafe Room', length: 20, width: 12, unit: 'ft' }),
	})
	expectStatus(crossOrigin, 403, 'cross-origin room creation')

	const team = await fetch(`${baseUrl}/api/team`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
		body: JSON.stringify({ action: 'create', name: 'Worker Verification Team' }),
	})
	expectStatus(team, 201, 'team creation')
	const teamResult = await json(team)
	const teamId = String((teamResult.team as JsonObject | undefined)?.id ?? '')
	const inviteCode = String((teamResult.team as JsonObject | undefined)?.inviteCode ?? '')
	assert.match(teamId, /^[0-9a-f-]{36}$/)
	assert.match(inviteCode, /^[A-Z0-9]{8}$/)

	const scannerTeam = await fetch(`${baseUrl}/api/scanners/team-id`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ inviteCode: inviteCode.toLowerCase() }),
	})
	expectStatus(scannerTeam, 200, 'scanner Team ID lookup')
	assert.equal((await json(scannerTeam)).teamId, teamId)
	assert.equal(scannerTeam.headers.get('cache-control'), 'no-store')

	const unknownScannerTeam = await fetch(`${baseUrl}/api/scanners/team-id`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ inviteCode: 'ZZZZZZZZ' }),
	})
	expectStatus(unknownScannerTeam, 404, 'unknown scanner invite code')

	const crossOriginScannerTeam = await fetch(`${baseUrl}/api/scanners/team-id`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
		body: JSON.stringify({ inviteCode }),
	})
	expectStatus(crossOriginScannerTeam, 403, 'cross-origin scanner Team ID lookup')

	const room = await fetch(`${baseUrl}/api/room`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
		body: JSON.stringify({ name: 'Robotics Lab', length: 20, width: 12, unit: 'ft' }),
	})
	expectStatus(room, 201, 'room creation')
	const roomResult = await json(room)
	const roomId = String((roomResult.room as JsonObject | undefined)?.id ?? '')
	assert.match(roomId, /^[0-9a-f-]{36}$/)

	const observedAt = new Date().toISOString()
	const hardwareId = 'A1B2C3D4E5F6'
	const heartbeatTopic = `/neemo/${teamId}/${hardwareId}/status/heartbeat`
	const heartbeat = {
		kind: 'heartbeat',
		eventType: 'hub.heartbeat',
		teamId,
		hubId: hardwareId,
		seenAt: observedAt,
	}
	const firstIngest = await fetch(`${baseUrl}/api/mqtt/ingest`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
		body: JSON.stringify({ topic: heartbeatTopic, message: heartbeat }),
	})
	expectStatus(firstIngest, 202, 'team MQTT Hub discovery')

	const duplicateIngest = await fetch(`${baseUrl}/api/mqtt/ingest`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
		body: JSON.stringify({ topic: heartbeatTopic, message: heartbeat }),
	})
	expectStatus(duplicateIngest, 200, 'duplicate team MQTT heartbeat')
	assert.equal((await json(duplicateIngest)).duplicate, true)

	const gateways = await fetch(`${baseUrl}/api/gateways`, { headers: { cookie } })
	expectStatus(gateways, 200, 'cloud MQTT discovery status')
	const gatewayResult = await json(gateways)
	assert.equal((gatewayResult.gateways as readonly JsonObject[])[0]?.platform, 'cloud-mqtt')
	assert.equal((gatewayResult.discoveries as readonly JsonObject[])[0]?.hardwareId, hardwareId)

	const claim = await fetch(`${baseUrl}/api/gateways/claim`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
		body: JSON.stringify({
			gatewayId: `cloud:${teamId}`,
			hardwareId,
			roomId,
			name: 'Verification Scanner',
		}),
	})
	expectStatus(claim, 201, 'cloud MQTT Hub claim')
	const claimResult = await json(claim)
	const claimedHubId = String(claimResult.hubId ?? '')
	assert.match(claimedHubId, /^[0-9a-f-]{36}$/)

	const tagId = 'E20034120123456789ABC005'
	const tagIngest = await fetch(`${baseUrl}/api/mqtt/ingest`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
		body: JSON.stringify({
			topic: `/neemo/${teamId}/${hardwareId}/tags/${tagId}`,
			message: {
				kind: 'tag',
				eventType: 'tag.seen',
				teamId,
				hubId: hardwareId,
				tagId,
				seenAt: new Date().toISOString(),
				sequence: 1,
				signalRssi: -47,
				powerLevel: null,
				readCount: 1,
			},
		}),
	})
	expectStatus(tagIngest, 200, 'claimed Hub tag ingestion')

	const item = await fetch(`${baseUrl}/api/items`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json', origin: baseUrl },
		body: JSON.stringify({
			epc: tagId,
			roomId,
			name: 'Verification Item',
			category: 'Tools',
			homeHubId: claimedHubId,
		}),
	})
	const itemResult = await json(item)
	if (item.status !== 201) {
		throw new Error(`MQTT-observed item creation returned ${item.status}: ${JSON.stringify(itemResult)}`)
	}
	assert.equal((itemResult.item as JsonObject | undefined)?.tagEpc, tagId)

	const hubs = await fetch(`${baseUrl}/api/hubs?roomId=${encodeURIComponent(roomId)}`, { headers: { cookie } })
	expectStatus(hubs, 200, 'claimed Hub status')
	const hubResult = await json(hubs)
	assert.equal((hubResult.hubs as readonly JsonObject[])[0]?.status, 'online')
}

async function main(): Promise<void> {
	await access(workerEntry)
	const persistenceDirectory = await mkdtemp(join(tmpdir(), 'neemo-worker-verification-'))
	const output: Buffer[] = []
	try {
		await run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistenceDirectory])
		const worker = spawn(
			'pnpm',
			[
				'exec',
				'wrangler',
				'dev',
				'--config',
				'wrangler.jsonc',
				'--local',
				'--ip',
				'0.0.0.0',
				'--port',
				String(verificationPort),
				'--persist-to',
				persistenceDirectory,
				'--var',
				`SESSION_SECRET:${sessionSecret}`,
			],
			{
				cwd: projectDirectory,
				env: { ...process.env, SESSION_SECRET: sessionSecret, WRANGLER_SEND_METRICS: 'false' },
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		)
		worker.stdout.on('data', (chunk: Buffer) => output.push(chunk))
		worker.stderr.on('data', (chunk: Buffer) => output.push(chunk))
		worker.on('error', (error) => output.push(Buffer.from(error.stack ?? error.message)))
		try {
			await waitForWorker()
			await verifyHttpFlow()
		} catch (error) {
			throw new Error(`${error instanceof Error ? error.message : String(error)}\n${commandOutput(output)}`)
		} finally {
			worker.kill('SIGTERM')
			await Promise.race([
				new Promise<void>((resolvePromise) => worker.once('exit', () => resolvePromise())),
				delay(5_000).then(() => {
					worker.kill('SIGKILL')
				}),
			])
		}
	} finally {
		await rm(persistenceDirectory, { recursive: true, force: true })
	}
	console.log('Worker verification passed: scanner provisioning, direct MQTT retries, Hub discovery, and observed-item creation.')
}

await main()

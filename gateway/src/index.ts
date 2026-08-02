import { Aedes } from 'aedes'
import mqtt from 'mqtt'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

type GatewayState = {
	apiBaseUrl: string
	gatewayId: string
	gatewayName: string
	gatewayToken: string
	registeredAt: string
}

type RegisterGatewayResponse = {
	error?: string
	gatewayId: string
	gatewayName: string
	gatewayToken: string
}

type TagReading = {
	epc: string
	powerLevel: number
}

type GatewayEvent = {
	eventId?: string
	gatewayQueuedAt?: number
	observedAt?: number
	type: 'gateway_heartbeat' | 'hub_heartbeat' | 'tag_readings'
	hardwareId?: string
	topic?: string
	readings?: TagReading[]
	brokerConnected?: boolean
	brokerHost?: string
	brokerPort?: number
}

type QueuedGatewayEvent = GatewayEvent & {
	eventId: string
	gatewayQueuedAt: number
}

type ParsedTopic = { kind: 'tag'; hardwareId: string } | { kind: 'heartbeat'; hardwareId: string }

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const gatewayDirectory = resolve(sourceDirectory, '..')
const dataDirectory = join(gatewayDirectory, 'data')
const statePath = join(gatewayDirectory, '.neemo-gateway.json')
const queuePath = join(dataDirectory, 'pending-events.json')
const topicRoot = 'rfid-hub'
const subscription = `${topicRoot}/#`
const expectedPort = 1883
const maxQueueLength = 10_000
const maxBufferAgeMs = 15 * 60 * 1_000
const maxReadingsPerEvent = 10
const brokerHost = process.env.MQTT_HOST || '127.0.0.1'
const brokerPort = Number(process.env.MQTT_PORT || expectedPort)

function localLanAddresses() {
	return Object.values(networkInterfaces())
		.flatMap((entries) => entries || [])
		.filter((entry) => entry.family === 'IPv4' && !entry.internal)
		.map((entry) => entry.address)
}

const advertisedBrokerHost = process.env.MQTT_ADVERTISED_HOST || localLanAddresses()[0] || brokerHost

function readArgument(name: string): string | undefined {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

function normalizeApiBaseUrl(value: string | undefined): string {
	const normalized = String(value || '')
		.trim()
		.replace(/\/+$/, '')
	if (!/^https:\/\/[^/]+$/i.test(normalized)) {
		throw new Error('Enter the HTTPS address of the Neemo website.')
	}
	return normalized
}

function normalizePairingCode(value: string | undefined): string {
	return String(value || '')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
}

function normalizeHardwareId(value: string | undefined): string {
	return String(value || '')
		.toUpperCase()
		.replace(/[^A-F0-9]/g, '')
}

function parseTopic(topic: string): ParsedTopic | null {
	const parts = String(topic).trim().split('/')
	if (parts.length !== 4 || parts[0] !== topicRoot) return null
	const hardwareId = normalizeHardwareId(parts[1])
	if (!/^[A-F0-9]{12}$/.test(hardwareId)) return null
	if (parts[2] === 'rfid' && parts[3] === 'tag') return { kind: 'tag', hardwareId }
	if (parts[2] === 'status' && parts[3] === 'hello') return { kind: 'heartbeat', hardwareId }
	return null
}

function parseTagPayload(payload: string): TagReading[] {
	const fields = String(payload)
		.trim()
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
	if (fields.length < 2) throw new Error('expected one or more EPCs followed by a power level')
	const rawPowerLevel = fields.at(-1)
	if (!rawPowerLevel || !/^\d+$/.test(rawPowerLevel)) throw new Error('final field is not an integer power level')
	const powerLevel = Number(rawPowerLevel)
	if (!Number.isInteger(powerLevel) || powerLevel < 0 || powerLevel > 30) {
		throw new Error('power level must be between 0 and 30')
	}
	const epcs = fields.slice(0, -1).map((epc) => epc.toUpperCase().replace(/\s+/g, ''))
	if (epcs.some((epc) => !/^[A-F0-9]{4,128}$/.test(epc))) {
		throw new Error('EPC must contain 4–128 hexadecimal characters')
	}
	return Array.from(new Set(epcs)).map((epc) => ({ epc, powerLevel }))
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await readFile(path, 'utf8'))
	} catch {
		return fallback
	}
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	const temporaryPath = `${path}.tmp`
	await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
	await chmod(temporaryPath, 0o600)
	await rename(temporaryPath, path)
}

async function promptForPairingCode() {
	if (!process.stdin.isTTY) return ''
	const terminal = createInterface({ input: process.stdin, output: process.stdout })
	try {
		return normalizePairingCode(await terminal.question('Paste the setup code from Neemo: '))
	} finally {
		terminal.close()
	}
}

async function promptForApiBaseUrl() {
	if (!process.stdin.isTTY) return ''
	const terminal = createInterface({ input: process.stdin, output: process.stdout })
	try {
		return terminal.question('Paste the Neemo website address: ')
	} finally {
		terminal.close()
	}
}

async function registerGateway(apiBaseUrl: string, existingState: GatewayState | null): Promise<GatewayState> {
	const suppliedCode =
		readArgument('--code') ||
		process.env.NEEMO_PAIRING_CODE ||
		(process.argv.includes('--pair') || !existingState?.gatewayToken ? await promptForPairingCode() : '')
	const pairingCode = normalizePairingCode(suppliedCode)
	if (pairingCode.length !== 8) {
		throw new Error('Open Neemo → Hubs → Find Hubs, create a setup code, then run pnpm connect.')
	}
	if (brokerPort !== expectedPort) throw new Error(`Neemo currently requires MQTT port ${expectedPort}.`)
	const response = await fetch(`${apiBaseUrl}/api/gateways/register`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			pairingCode,
			name: process.env.NEEMO_GATEWAY_NAME || `${process.platform === 'darwin' ? 'Mac' : 'Computer'} Gateway`,
			platform: `${process.platform}/${process.arch} Node ${process.version}`,
			brokerHost: advertisedBrokerHost,
			brokerPort,
		}),
	})
	const result = (await response.json()) as RegisterGatewayResponse
	if (!response.ok) throw new Error(result.error || `Gateway registration failed (${response.status}).`)
	const state = {
		apiBaseUrl,
		gatewayId: result.gatewayId,
		gatewayName: result.gatewayName,
		gatewayToken: result.gatewayToken,
		registeredAt: new Date().toISOString(),
	}
	await writePrivateJson(statePath, state)
	console.log(`Connected ${state.gatewayName} to Neemo.`)
	return state
}

async function startEmbeddedBroker() {
	const shouldStart =
		String(process.env.START_EMBEDDED_BROKER || 'true').toLowerCase() !== 'false' && ['127.0.0.1', 'localhost', '::1'].includes(brokerHost)
	if (!shouldStart) return null

	const broker = await Aedes.createBroker()
	broker.on('clientError', (client, error) => {
		console.warn(`Hub connection error${client?.id ? ` (${client.id})` : ''}: ${error.message}`)
	})
	broker.on('connectionError', (_client, error) => {
		console.warn(`Hub network error: ${error.message}`)
	})

	const server = createServer(broker.handle)
	try {
		await new Promise<void>((resolve, reject) => {
			const handleError = (error: Error) => {
				server.off('listening', handleListening)
				reject(error)
			}
			const handleListening = (): void => {
				server.off('error', handleError)
				resolve()
			}
			server.once('error', handleError)
			server.once('listening', handleListening)
			server.listen(brokerPort, '0.0.0.0')
		})
	} catch (error: unknown) {
		await broker.close()
		if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
			console.log(`Port ${brokerPort} is already in use; Neemo will connect to the existing local broker.`)
			return null
		}
		throw error
	}

	console.log(`Neemo's built-in Hub network is listening on port ${brokerPort}.`)
	return { broker, server }
}

const restoredEvents = await readJson<GatewayEvent[]>(queuePath, [])
const pendingEvents: QueuedGatewayEvent[] = Array.isArray(restoredEvents)
	? restoredEvents.map((event) => ({
			...event,
			eventId: event.eventId || crypto.randomUUID(),
			gatewayQueuedAt: event.gatewayQueuedAt ?? Date.now(),
		}))
	: []
let flushing = false
let brokerConnected = false
let retryDelayMs = 1_000
let nextRetryAt = 0
let retryTimer: NodeJS.Timeout | null = null

function eventDedupeKey(event: GatewayEvent): string {
	const timestampBucket = Math.floor(Number(event.observedAt || event.gatewayQueuedAt || Date.now()) / 2_000)
	return JSON.stringify({
		type: event.type,
		hardwareId: event.hardwareId || null,
		topic: event.topic || null,
		readings: event.readings || null,
		brokerConnected: event.brokerConnected ?? null,
		timestampBucket,
	})
}

async function saveQueue() {
	await writePrivateJson(queuePath, pendingEvents.slice(-maxQueueLength))
}

async function sendToNeemo(state: GatewayState, event: QueuedGatewayEvent): Promise<void> {
	const response = await fetch(`${state.apiBaseUrl}/api/gateways/ingest`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${state.gatewayToken}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify(event),
	})
	if (!response.ok) {
		const result = (await response.json().catch(() => ({}))) as { error?: string }
		throw new Error(result.error ?? `Neemo returned ${response.status}.`)
	}
}

async function flushQueue(state: GatewayState): Promise<void> {
	if (flushing || pendingEvents.length === 0) return
	if (Date.now() < nextRetryAt) {
		if (!retryTimer) {
			retryTimer = setTimeout(() => {
				retryTimer = null
				void flushQueue(state)
			}, nextRetryAt - Date.now())
		}
		return
	}
	flushing = true
	try {
		while (
			pendingEvents.length &&
			Number(pendingEvents[0].gatewayQueuedAt || pendingEvents[0].observedAt || Date.now()) < Date.now() - maxBufferAgeMs
		) {
			pendingEvents.shift()
		}
		while (pendingEvents.length) {
			await sendToNeemo(state, pendingEvents[0])
			pendingEvents.shift()
			if (pendingEvents.length % 20 === 0) await saveQueue()
		}
		retryDelayMs = 1_000
		nextRetryAt = 0
		await saveQueue()
	} catch (error: unknown) {
		nextRetryAt = Date.now() + retryDelayMs
		console.warn(
			`Neemo is temporarily unreachable; ${pendingEvents.length} event(s) remain buffered. Retrying in ${Math.round(retryDelayMs / 1_000)}s. ${errorMessage(error)}`,
		)
		retryDelayMs = Math.min(60_000, retryDelayMs * 2)
		await saveQueue()
		if (!retryTimer) {
			retryTimer = setTimeout(
				() => {
					retryTimer = null
					void flushQueue(state)
				},
				Math.max(0, nextRetryAt - Date.now()),
			)
		}
	} finally {
		flushing = false
	}
}

async function enqueue(state: GatewayState, event: GatewayEvent): Promise<void> {
	const queuedEvent: QueuedGatewayEvent = {
		...event,
		eventId: event.eventId || crypto.randomUUID(),
		gatewayQueuedAt: Date.now(),
	}
	const key = eventDedupeKey(queuedEvent)
	if (pendingEvents.slice(-100).some((pending) => eventDedupeKey(pending) === key)) return
	pendingEvents.push(queuedEvent)
	if (pendingEvents.length > maxQueueLength) pendingEvents.splice(0, pendingEvents.length - maxQueueLength)
	await flushQueue(state)
}

const existingState = await readJson<GatewayState | null>(statePath, null)
const apiBaseUrl = normalizeApiBaseUrl(
	readArgument('--api') || process.env.NEEMO_API_BASE_URL || existingState?.apiBaseUrl || (await promptForApiBaseUrl()),
)
let state = existingState
if (!state?.gatewayToken || process.argv.includes('--pair') || readArgument('--code')) {
	state = await registerGateway(apiBaseUrl, existingState)
} else if (state.apiBaseUrl !== apiBaseUrl) {
	state = { ...state, apiBaseUrl }
	await writePrivateJson(statePath, state)
}

const embeddedBroker = await startEmbeddedBroker()
if (brokerPort !== expectedPort) throw new Error(`Neemo currently requires MQTT port ${expectedPort}.`)
const mqttOptions = {
	clientId: `neemo-gateway-${state.gatewayId}`,
	keepalive: 30,
	clean: true,
	reconnectPeriod: 2_000,
	connectTimeout: 10_000,
	username: process.env.MQTT_USERNAME || undefined,
	password: process.env.MQTT_PASSWORD || undefined,
}
const client = mqtt.connect(`mqtt://${brokerHost}:${brokerPort}`, mqttOptions)

client.on('connect', () => {
	brokerConnected = true
	client.subscribe(subscription, { qos: 0 }, (error) => {
		if (error) console.error(`Could not subscribe to ${subscription}: ${error.message}`)
		else console.log(`Listening for Neemo Hubs on ${subscription} through port ${brokerPort}.`)
	})
	void enqueue(state, {
		type: 'gateway_heartbeat',
		brokerConnected: true,
		brokerHost: advertisedBrokerHost,
		brokerPort,
	})
})
client.on('reconnect', () => console.log('Reconnecting to the local Hub network…'))
client.on('offline', () => {
	brokerConnected = false
})
client.on('error', (error) => console.warn(`Local MQTT connection: ${error.message}`))
client.on('message', (topic, buffer) => {
	const parsed = parseTopic(topic)
	if (!parsed) return
	const observedAt = Date.now()
	const payload = buffer.toString('utf8')
	if (parsed.kind === 'heartbeat') {
		if (payload.trim() !== 'hello world') {
			console.warn(`Ignored malformed heartbeat from ${parsed.hardwareId}.`)
			return
		}
		void enqueue(state, {
			type: 'hub_heartbeat',
			hardwareId: parsed.hardwareId,
			topic,
			observedAt,
		})
		return
	}
	try {
		const readings = parseTagPayload(payload)
		for (let index = 0; index < readings.length; index += maxReadingsPerEvent) {
			void enqueue(state, {
				type: 'tag_readings',
				hardwareId: parsed.hardwareId,
				topic,
				observedAt,
				readings: readings.slice(index, index + maxReadingsPerEvent),
			})
		}
	} catch (error: unknown) {
		console.warn(`Ignored malformed tag payload from ${parsed.hardwareId}: ${errorMessage(error)}`)
	}
})

const heartbeatTimer = setInterval(() => {
	void enqueue(state, {
		type: 'gateway_heartbeat',
		brokerConnected,
		brokerHost: advertisedBrokerHost,
		brokerPort,
	})
}, 10_000)

await writeFile(join(gatewayDirectory, 'HUB ADDRESS.txt'), `MQTT_HOST=${advertisedBrokerHost}\nMQTT_PORT=${brokerPort}\n`)
if (process.platform === 'darwin') {
	const clipboard = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
	clipboard.on('error', () => {})
	clipboard.stdin.end(advertisedBrokerHost)
}
console.log(`\nNeemo is connected for ${state.gatewayName}. Keep this window open.`)
console.log(`Hub address: ${advertisedBrokerHost}:${brokerPort}`)
console.log('The Hub address was saved beside this launcher' + (process.platform === 'darwin' ? ' and copied to your clipboard.' : '.'))
if (pendingEvents.length) console.log(`Restoring ${pendingEvents.length} buffered event(s).`)
void flushQueue(state)

async function closeEmbeddedBroker(): Promise<void> {
	if (!embeddedBroker) return
	await new Promise<void>((resolve) => embeddedBroker.server.close(() => resolve()))
	await embeddedBroker.broker.close()
}

function shutdown(signal: NodeJS.Signals): void {
	console.log(`\n${signal} received; closing the Neemo Local Gateway.`)
	clearInterval(heartbeatTimer)
	client.end(true, () => {
		void Promise.all([saveQueue(), closeEmbeddedBroker()]).finally(() => process.exit(0))
	})
	setTimeout(() => process.exit(0), 3_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

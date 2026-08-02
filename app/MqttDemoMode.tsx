'use client'

// Demo mode's MQTT client and its slim status bar. This component is only
// mounted while demo mode is on (dynamically imported, so MQTT.js stays out
// of the main bundle). It subscribes to the public example namespace,
// validates every message, and reports a snapshot upward — it never writes
// to the real Neemo inventory.

import mqtt, { type IPublishPacket } from 'mqtt'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { IconCheck, IconClose, IconCopy, IconPlay, IconSparkle } from './components/icons'
import {
	DEMO_MQTT_WSS_URL,
	DEMO_TAGS,
	DEMO_TOPIC_PREFIX,
	DEMO_TOPIC_SUBSCRIPTION,
	parseDemoTagMessage,
	type DemoTagMessage,
} from './lib/demo-mqtt'
import { scannerStatus, type ScannerStatus } from './lib/freshness'

export type DemoConnectionState = 'connecting' | 'subscribing' | 'live' | 'reconnecting' | 'offline' | 'error'

export type DemoTagReading = Readonly<{
	message: DemoTagMessage
	topic: string
	receivedAt: number
	retained: boolean
	qos: number
	messageCount: number
}>

export type DemoActivity = Readonly<{
	id: string
	tagId: string
	displayName: string
	emoji: string
	seenAt: number
	signalRssi: number
	retained: boolean
}>

export type DemoModeSnapshot = Readonly<{
	connectionState: DemoConnectionState
	connectionDetail: string
	seenTags: Readonly<Record<string, DemoTagReading>>
	activity: readonly DemoActivity[]
	messageTotal: number
	scannerActive: boolean
	scannerStatus: ScannerStatus
	now: number
}>

const TOUR_STORAGE_KEY = 'neemo.demo-tour-dismissed'

const TOUR_STEPS: readonly { title: string; body: string }[] = [
	{
		title: 'Welcome to the sample workshop',
		body: 'You are looking at the fictional Neemo Robotics Club. Everything here is sample data and read-only — your real workspace is untouched and one toggle away.',
	},
	{
		title: 'The map is fed by real MQTT',
		body: 'Each tag chip on the map is a retained MQTT message. Tags glow green for 15 seconds after a read, then stay put as last-known history.',
	},
	{
		title: 'Bring it to life',
		body: 'Run the mock scanner from the repository to publish fresh reads — the map, inventory, and activity feed react in real time.',
	},
]

function statusLabel(status: DemoConnectionState): string {
	if (status === 'live') return 'MQTT connected'
	if (status === 'subscribing') return 'Subscribing…'
	if (status === 'reconnecting') return 'Reconnecting…'
	if (status === 'offline') return 'Broker offline'
	if (status === 'error') return 'Connection issue'
	return 'Connecting…'
}

export default function MqttDemoMode({ onSnapshot, onExit }: { onSnapshot: (snapshot: DemoModeSnapshot) => void; onExit: () => void }) {
	const [connectionState, setConnectionState] = useState<DemoConnectionState>('connecting')
	const [connectionDetail, setConnectionDetail] = useState('Opening a secure WebSocket…')
	const [seenTags, setSeenTags] = useState<Readonly<Record<string, DemoTagReading>>>({})
	const [activity, setActivity] = useState<readonly DemoActivity[]>([])
	const [messageTotal, setMessageTotal] = useState(0)
	const [connectionAttempt, setConnectionAttempt] = useState(0)
	const [now, setNow] = useState(() => Date.now())
	const [scannerHelpOpen, setScannerHelpOpen] = useState(false)
	const [copied, setCopied] = useState(false)
	const [tourStep, setTourStep] = useState<number | null>(() =>
		typeof window !== 'undefined' && window.localStorage.getItem(TOUR_STORAGE_KEY) !== 'true' ? 0 : null,
	)
	const helpId = useId()
	const helpRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1_000)
		return () => window.clearInterval(timer)
	}, [])

	useEffect(() => {
		let disposed = false
		const client = mqtt.connect(DEMO_MQTT_WSS_URL, {
			clean: true,
			clientId: `neemo_web_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
			connectTimeout: 10_000,
			forceNativeWebSocket: true,
			keepalive: 30,
			protocolVersion: 4,
			queueQoSZero: false,
			reconnectPeriod: 3_000,
			resubscribe: false,
		})

		client.on('connect', () => {
			if (disposed) return
			setConnectionState('subscribing')
			setConnectionDetail('Connected; requesting retained tag snapshots…')
			client.subscribe(DEMO_TOPIC_SUBSCRIPTION, { qos: 1 }, (error) => {
				if (disposed) return
				if (error) {
					setConnectionState('error')
					setConnectionDetail(error.message)
					return
				}
				setConnectionState('live')
				setConnectionDetail(`Subscribed to ${DEMO_TOPIC_SUBSCRIPTION}`)
			})
		})
		client.on('message', (topic: string, payload: Uint8Array, packet: IPublishPacket) => {
			if (disposed) return
			const tagId = topic.startsWith(DEMO_TOPIC_PREFIX) ? topic.slice(DEMO_TOPIC_PREFIX.length) : ''
			if (payload.byteLength === 0 && DEMO_TAGS.some((definition) => definition.tagId === tagId)) {
				// An empty retained payload deletes the tag's history.
				setSeenTags((current) => Object.fromEntries(Object.entries(current).filter(([currentTagId]) => currentTagId !== tagId)))
				return
			}

			const receivedAt = Date.now()
			const message = parseDemoTagMessage(topic, payload, receivedAt)
			if (!message) return
			const seenAt = Date.parse(message.seenAt)
			const retained = packet.retain
			setSeenTags((current) => ({
				...current,
				[message.tagId]: {
					message,
					topic,
					receivedAt,
					retained,
					qos: packet.qos,
					messageCount: (current[message.tagId]?.messageCount ?? 0) + 1,
				},
			}))
			setActivity((current) =>
				[
					{
						id: `${message.tagId}-${message.sequence}-${receivedAt}`,
						tagId: message.tagId,
						displayName: message.displayName,
						emoji: message.emoji,
						seenAt,
						signalRssi: message.signalRssi,
						retained,
					},
					...current,
				].slice(0, 12),
			)
			setMessageTotal((current) => current + 1)
		})
		client.on('reconnect', () => {
			if (disposed) return
			setConnectionState('reconnecting')
			setConnectionDetail('The connection dropped; MQTT.js is retrying…')
		})
		client.on('offline', () => {
			if (disposed) return
			setConnectionState('offline')
			setConnectionDetail('The broker is temporarily unreachable.')
		})
		client.on('error', (error) => {
			if (disposed) return
			setConnectionState('error')
			setConnectionDetail(error.message)
		})

		return () => {
			disposed = true
			client.removeAllListeners()
			// A late connect timeout on the disposed client must not surface
			// as an uncaught error.
			client.on('error', () => {})
			client.end(true)
		}
	}, [connectionAttempt])

	// Close the scanner popover on Escape or an outside click.
	useEffect(() => {
		if (!scannerHelpOpen) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setScannerHelpOpen(false)
		}
		const onClick = (event: MouseEvent) => {
			if (helpRef.current && !helpRef.current.contains(event.target as Node)) setScannerHelpOpen(false)
		}
		document.addEventListener('keydown', onKey)
		document.addEventListener('mousedown', onClick)
		return () => {
			document.removeEventListener('keydown', onKey)
			document.removeEventListener('mousedown', onClick)
		}
	}, [scannerHelpOpen])

	const latestSeenAt = Math.max(0, ...Object.values(seenTags).map((seen) => Date.parse(seen.message.seenAt)))
	const currentScannerStatus = scannerStatus(latestSeenAt, now)
	const scannerActive = currentScannerStatus === 'publishing'
	const snapshot = useMemo<DemoModeSnapshot>(
		() => ({
			connectionState,
			connectionDetail,
			seenTags,
			activity,
			messageTotal,
			scannerActive,
			scannerStatus: currentScannerStatus,
			now,
		}),
		[activity, connectionDetail, connectionState, currentScannerStatus, messageTotal, now, scannerActive, seenTags],
	)

	useEffect(() => onSnapshot(snapshot), [onSnapshot, snapshot])

	const copyCommand = useCallback(() => {
		void navigator.clipboard.writeText('pnpm mock:scanner').then(() => {
			setCopied(true)
			window.setTimeout(() => setCopied(false), 2_000)
		})
	}, [])

	const dismissTour = useCallback(() => {
		setTourStep(null)
		window.localStorage.setItem(TOUR_STORAGE_KEY, 'true')
	}, [])

	const seenCount = Object.keys(seenTags).length
	const connectionOk = connectionState === 'live'
	const connectionBad = connectionState === 'error' || connectionState === 'offline'

	return (
		<>
			<aside className="demo-bar" aria-label="Demo mode status">
				<div className="demo-bar-identity">
					<span className="demo-bar-mark" aria-hidden="true">
						<IconSparkle size={13} />
					</span>
					<p>
						<strong>Sample workspace</strong>
						<small>Read-only demo data</small>
					</p>
				</div>
				<div className="demo-bar-status" role="status" aria-live="polite">
					<span className={`demo-chip ${connectionOk ? 'ok' : connectionBad ? 'bad' : 'busy'}`} title={connectionDetail}>
						<i className="chip-dot" aria-hidden="true" />
						{statusLabel(connectionState)}
					</span>
					<span
						className={`demo-chip ${
							currentScannerStatus === 'publishing' ? 'ok pulsing' : currentScannerStatus === 'idle' ? 'idle' : 'bad'
						}`}
					>
						<i className="chip-dot" aria-hidden="true" />
						{currentScannerStatus === 'publishing'
							? 'Scanner publishing'
							: currentScannerStatus === 'idle'
								? 'Scanner idle'
								: 'Scanner offline'}
					</span>
					<span className="demo-chip plain">
						{seenCount}/{DEMO_TAGS.length} {currentScannerStatus === 'publishing' ? 'tags' : 'retained'}
					</span>
				</div>
				<div className="demo-bar-actions">
					{connectionBad && (
						<button
							type="button"
							className="demo-bar-button"
							onClick={() => {
								setConnectionState('connecting')
								setConnectionDetail('Opening a secure WebSocket…')
								setConnectionAttempt((current) => current + 1)
							}}
						>
							Reconnect
						</button>
					)}
					<div className="demo-help-anchor" ref={helpRef}>
						<button
							type="button"
							className={`demo-bar-button accent ${scannerHelpOpen ? 'open' : ''}`}
							aria-expanded={scannerHelpOpen}
							aria-controls={helpId}
							onClick={() => setScannerHelpOpen((open) => !open)}
						>
							<IconPlay size={14} /> Feed live data
						</button>
						{scannerHelpOpen && (
							<section className="demo-help-pop" id={helpId} aria-label="How to start the mock scanner">
								<header>
									<strong>Bring the workshop to life</strong>
									<button type="button" onClick={() => setScannerHelpOpen(false)} aria-label="Close">
										<IconClose size={14} />
									</button>
								</header>
								<p>From the Neemo repository, run the mock scanner in a terminal:</p>
								<div className="demo-command-row">
									<code>pnpm mock:scanner</code>
									<button type="button" onClick={copyCommand} aria-label="Copy command">
										{copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
										{copied ? 'Copied' : 'Copy'}
									</button>
								</div>
								<p>
									It publishes each of the six sample tags every couple of seconds over MQTT. A tag counts as <b>live</b> for 15 seconds
									after its latest read, then stays visible as <b>last-known</b> history because the broker retains the newest message per
									tag.
								</p>
								<p className="demo-help-footnote">
									Stop the scanner and tags settle into last-known within ~15–26 s. <code>pnpm mock:scanner --clear</code> wipes the
									retained history; this page empties out live.
								</p>
							</section>
						)}
					</div>
					<button type="button" className="demo-bar-button quiet" onClick={onExit}>
						Exit demo
					</button>
				</div>
			</aside>

			{tourStep !== null && TOUR_STEPS[tourStep] && (
				<aside className="demo-tour" role="complementary" aria-label="Demo tour hint">
					<header>
						<span className="demo-tour-step">
							{tourStep + 1}/{TOUR_STEPS.length}
						</span>
						<strong>{TOUR_STEPS[tourStep].title}</strong>
						<button type="button" onClick={dismissTour} aria-label="Dismiss tour">
							<IconClose size={15} />
						</button>
					</header>
					<p>{TOUR_STEPS[tourStep].body}</p>
					{tourStep === TOUR_STEPS.length - 1 && <code className="demo-tour-command">pnpm mock:scanner</code>}
					<footer>
						<button type="button" className="demo-tour-skip" onClick={dismissTour}>
							Skip tour
						</button>
						{tourStep < TOUR_STEPS.length - 1 ? (
							<button type="button" className="demo-tour-next" onClick={() => setTourStep(tourStep + 1)}>
								Next tip
							</button>
						) : (
							<button type="button" className="demo-tour-next" onClick={dismissTour}>
								Got it
							</button>
						)}
					</footer>
				</aside>
			)}
		</>
	)
}

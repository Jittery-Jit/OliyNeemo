'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cloudMqttGatewayId, TEAM_MQTT_TCP_URL, TEAM_MQTT_WSS_URL, teamMqttHeartbeatTopic, teamMqttTagTopic } from './lib/team-mqtt'
import type { TeamMqttSnapshot } from './TeamMqttMode'

type HubDiscovery = {
	gatewayId: string
	gatewayName: string
	hardwareId: string
	firstSeenAt: number
	lastSeenAt: number
	lastTopic: string
	claimedHubId: string | null
}

type GatewayApiResponse = {
	discoveries?: HubDiscovery[]
	canManage?: boolean
	error?: string
}

const EXAMPLE_HUB_ID = '5C013BBEDEBC'
const EXAMPLE_TAG_ID = 'E20034120123456789ABC005'

function timeAgo(timestamp: number | null) {
	if (!timestamp) return 'never'
	const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
	if (seconds < 10) return 'just now'
	if (seconds < 60) return `${seconds}s ago`
	const minutes = Math.round(seconds / 60)
	return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

function connectionLabel(snapshot: TeamMqttSnapshot) {
	if (snapshot.connectionState === 'live') return 'Browser connected'
	if (snapshot.connectionState === 'connecting' || snapshot.connectionState === 'subscribing') return 'Connecting…'
	if (snapshot.connectionState === 'reconnecting') return 'Reconnecting…'
	return 'Connection unavailable'
}

export default function HubPairingFlow({
	roomId,
	roomName,
	teamId,
	mqttSnapshot,
	onConnected,
	onCancel,
}: {
	roomId: string
	roomName: string
	teamId: string
	mqttSnapshot: TeamMqttSnapshot
	onConnected: () => Promise<void> | void
	onCancel: () => void
}) {
	const [discoveries, setDiscoveries] = useState<HubDiscovery[]>([])
	const [canManage, setCanManage] = useState(false)
	const [hubNames, setHubNames] = useState<Record<string, string>>({})
	const [loading, setLoading] = useState(true)
	const [workingId, setWorkingId] = useState('')
	const [copied, setCopied] = useState(false)
	const [message, setMessage] = useState('')
	const [error, setError] = useState('')
	const gatewayId = cloudMqttGatewayId(teamId)

	const refresh = useCallback(
		async (quiet = false) => {
			if (!quiet) setLoading(true)
			try {
				const response = await fetch('/api/gateways', { cache: 'no-store' })
				const data = (await response.json()) as GatewayApiResponse
				if (!response.ok) throw new Error(data.error || 'Cloud scanner status could not be checked.')
				setDiscoveries((data.discoveries ?? []).filter((discovery) => discovery.gatewayId === gatewayId))
				setCanManage(Boolean(data.canManage))
				setError('')
			} catch (requestError) {
				if (!quiet) setError(requestError instanceof Error ? requestError.message : 'Cloud scanner status could not be checked.')
			} finally {
				if (!quiet) setLoading(false)
			}
		},
		[gatewayId],
	)

	useEffect(() => {
		const initialTimer = window.setTimeout(() => void refresh(), 0)
		const timer = window.setInterval(() => void refresh(true), 3_000)
		return () => {
			window.clearTimeout(initialTimer)
			window.clearInterval(timer)
		}
	}, [refresh])

	useEffect(() => {
		if (!message) return
		const timer = window.setTimeout(() => setMessage(''), 4_000)
		return () => window.clearTimeout(timer)
	}, [message])

	const unclaimed = useMemo(() => discoveries.filter((discovery) => !discovery.claimedHubId), [discoveries])
	const heartbeatTopic = teamMqttHeartbeatTopic(teamId, EXAMPLE_HUB_ID)
	const tagTopic = teamMqttTagTopic(teamId, EXAMPLE_HUB_ID, EXAMPLE_TAG_ID)

	const copyTeamId = async () => {
		try {
			await navigator.clipboard.writeText(teamId)
			setCopied(true)
			window.setTimeout(() => setCopied(false), 2_000)
		} catch {
			setError('The Team ID could not be copied. Select it manually.')
		}
	}

	const claimHub = async (discovery: HubDiscovery) => {
		const name = hubNames[discovery.hardwareId]?.trim()
		if (!name) {
			setError('Give this Hub a name before connecting it.')
			return
		}
		setWorkingId(discovery.hardwareId)
		setError('')
		try {
			const response = await fetch('/api/gateways/claim', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					gatewayId: discovery.gatewayId,
					hardwareId: discovery.hardwareId,
					roomId,
					name,
				}),
			})
			const data = (await response.json()) as GatewayApiResponse
			if (!response.ok) throw new Error(data.error || 'The Hub could not be connected.')
			setMessage(`${name} is connected to ${roomName}.`)
			setHubNames((current) => ({ ...current, [discovery.hardwareId]: '' }))
			await Promise.all([refresh(true), onConnected()])
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : 'The Hub could not be connected.')
		} finally {
			setWorkingId('')
		}
	}

	return (
		<section className="pairing-flow network-pairing-flow" aria-labelledby="pairing-title">
			<div className="pairing-flow-head">
				<div>
					<p className="eyebrow">Cloud scanner · {roomName}</p>
					<h2 id="pairing-title">Connect scanner firmware</h2>
				</div>
				<button className="pairing-close" type="button" onClick={onCancel} aria-label="Close Hub setup">
					×
				</button>
			</div>

			{message && (
				<p className="pairing-running-total" role="status">
					{message}
				</p>
			)}
			{error && (
				<p className="pairing-message-card error" role="alert">
					{error}
				</p>
			)}

			<div className="gateway-status-grid" aria-live="polite">
				<article className={`gateway-status-card ${mqttSnapshot.connectionState === 'live' ? 'online' : 'offline'}`}>
					<span className="status-dot" />
					<div>
						<strong>{connectionLabel(mqttSnapshot)}</strong>
						<small>{mqttSnapshot.connectionDetail}</small>
						<small>
							{mqttSnapshot.lastMessageAt
								? `Latest valid scanner message ${timeAgo(mqttSnapshot.lastMessageAt)}`
								: 'No valid scanner message received in this browser session.'}
						</small>
						{mqttSnapshot.ingestError && <small className="hub-attention">{mqttSnapshot.ingestError}</small>}
					</div>
				</article>
			</div>

			<section className="gateway-setup-card mqtt-firmware-card" aria-labelledby="mqtt-firmware-title">
				<div className="pairing-step-heading">
					<span>1</span>
					<div>
						<strong id="mqtt-firmware-title">Configure the scanner</strong>
						<small>Use these values in the firmware.</small>
					</div>
				</div>
				<dl className="mqtt-settings">
					<div>
						<dt>MQTT broker</dt>
						<dd>
							<code>{TEAM_MQTT_TCP_URL}</code>
						</dd>
					</div>
					<div>
						<dt>Team ID</dt>
						<dd>
							<code>{teamId}</code>
							<button className="copy-inline" type="button" onClick={() => void copyTeamId()}>
								{copied ? 'Copied' : 'Copy'}
							</button>
						</dd>
					</div>
					<div>
						<dt>Browser WSS</dt>
						<dd>
							<code>{TEAM_MQTT_WSS_URL}</code>
						</dd>
					</div>
				</dl>
				<div className="mqtt-topic-contract">
					<strong>Heartbeat every 5 seconds · QoS 1 · retained</strong>
					<code>{heartbeatTopic}</code>
					<pre>{`{"eventType":"hub.heartbeat","teamId":"${teamId}","hubId":"${EXAMPLE_HUB_ID}","seenAt":"<ISO-8601 UTC>"}`}</pre>
				</div>
				<div className="mqtt-topic-contract">
					<strong>Tag observation · QoS 1 · retained</strong>
					<code>{tagTopic}</code>
					<pre>{`{"eventType":"tag.seen","teamId":"${teamId}","hubId":"${EXAMPLE_HUB_ID}","tagId":"${EXAMPLE_TAG_ID}","seenAt":"<ISO-8601 UTC>","sequence":1,"signalRssi":-47,"readCount":1}`}</pre>
				</div>
				<p className="pairing-warning">
					This prototype broker is public: the Team ID separates data but is not a secret or authentication credential. Keep this Neemo page
					open so its browser connection can store incoming scanner data.
				</p>
			</section>

			<section className="discovered-hubs" aria-labelledby="discovered-title">
				<div className="pairing-step-heading">
					<span>2</span>
					<div>
						<strong id="discovered-title">Discovered scanners</strong>
						<small>Name a scanner after its first valid heartbeat arrives.</small>
					</div>
				</div>
				{loading && (
					<div className="empty-state hub-empty">
						<span>H</span>
						<strong>Checking for scanners…</strong>
					</div>
				)}
				{!loading && unclaimed.length === 0 && (
					<div className="empty-state hub-empty">
						<span>H</span>
						<strong>No new scanners detected</strong>
						<p>Confirm the Team ID, Hub ID, topic, JSON body, QoS 1, and a current seenAt timestamp.</p>
					</div>
				)}
				{unclaimed.map((discovery) => (
					<article className="discovered-hub-card" key={`${discovery.gatewayId}-${discovery.hardwareId}`}>
						<div className="nearby-hub-icon">H</div>
						<div>
							<strong>Hub …{discovery.hardwareId.slice(-6)}</strong>
							<small>
								Seen {timeAgo(discovery.lastSeenAt)} · {discovery.hardwareId}
							</small>
						</div>
						<label>
							Hub name
							<input
								maxLength={60}
								placeholder="e.g. Workshop Entry Scanner"
								value={hubNames[discovery.hardwareId] ?? ''}
								onChange={(event) => setHubNames((current) => ({ ...current, [discovery.hardwareId]: event.target.value }))}
							/>
						</label>
						<button
							className="button primary"
							type="button"
							disabled={!canManage || workingId === discovery.hardwareId || !(hubNames[discovery.hardwareId] ?? '').trim()}
							onClick={() => void claimHub(discovery)}
						>
							{workingId === discovery.hardwareId ? 'Connecting…' : `Add to ${roomName}`}
						</button>
					</article>
				))}
			</section>
		</section>
	)
}

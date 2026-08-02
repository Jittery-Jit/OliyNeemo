'use client'

import mqtt from 'mqtt'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseTeamMqttMessage, TEAM_MQTT_WSS_URL, teamMqttSubscription } from './lib/team-mqtt'

export type TeamMqttConnectionState = 'connecting' | 'subscribing' | 'live' | 'reconnecting' | 'offline' | 'error'

export type TeamMqttSnapshot = Readonly<{
	connectionState: TeamMqttConnectionState
	connectionDetail: string
	messageTotal: number
	lastMessageAt: number | null
	invalidMessageTotal: number
	ingestError: string
}>

const EMPTY_PENDING_REFRESH = { hubs: false, items: false }

export default function TeamMqttMode({
	teamId,
	onSnapshot,
	onStored,
}: {
	teamId: string
	onSnapshot: (snapshot: TeamMqttSnapshot) => void
	onStored: (change: Readonly<{ hubs: boolean; items: boolean }>) => void
}) {
	const [connectionState, setConnectionState] = useState<TeamMqttConnectionState>('connecting')
	const [connectionDetail, setConnectionDetail] = useState('Opening the team MQTT connection…')
	const [messageTotal, setMessageTotal] = useState(0)
	const [lastMessageAt, setLastMessageAt] = useState<number | null>(null)
	const [invalidMessageTotal, setInvalidMessageTotal] = useState(0)
	const [ingestError, setIngestError] = useState('')
	const onStoredRef = useRef(onStored)
	const pendingRefreshRef = useRef({ ...EMPTY_PENDING_REFRESH })
	const refreshTimerRef = useRef<number | null>(null)

	useEffect(() => {
		onStoredRef.current = onStored
	}, [onStored])

	useEffect(() => {
		let disposed = false
		const subscription = teamMqttSubscription(teamId)
		const scheduleRefresh = (kind: 'heartbeat' | 'tag') => {
			pendingRefreshRef.current.hubs = true
			if (kind === 'tag') pendingRefreshRef.current.items = true
			if (refreshTimerRef.current !== null) return
			refreshTimerRef.current = window.setTimeout(() => {
				const change = { ...pendingRefreshRef.current }
				pendingRefreshRef.current = { ...EMPTY_PENDING_REFRESH }
				refreshTimerRef.current = null
				onStoredRef.current(change)
			}, 400)
		}
		const client = mqtt.connect(TEAM_MQTT_WSS_URL, {
			clean: true,
			clientId: `neemo_team_web_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
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
			setConnectionDetail(`Connected; subscribing to ${subscription}`)
			client.subscribe(subscription, { qos: 1 }, (error) => {
				if (disposed) return
				if (error) {
					setConnectionState('error')
					setConnectionDetail(error.message)
					return
				}
				setConnectionState('live')
				setConnectionDetail(`Subscribed to ${subscription}`)
			})
		})
		client.on('message', (topic, payload) => {
			if (disposed) return
			const message = parseTeamMqttMessage(topic, payload, teamId)
			if (!message) {
				setInvalidMessageTotal((current) => current + 1)
				return
			}
			setMessageTotal((current) => current + 1)
			setLastMessageAt((current) => Math.max(current ?? 0, Date.parse(message.seenAt)))
			void fetch('/api/mqtt/ingest', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ topic, message }),
			})
				.then(async (response) => {
					const data = (await response.json()) as { error?: string }
					if (!response.ok) throw new Error(data.error || `Neemo returned ${response.status}.`)
					if (disposed) return
					setIngestError('')
					scheduleRefresh(message.kind)
				})
				.catch((error: unknown) => {
					if (!disposed) setIngestError(error instanceof Error ? error.message : 'The MQTT observation could not be saved.')
				})
		})
		client.on('reconnect', () => {
			if (disposed) return
			setConnectionState('reconnecting')
			setConnectionDetail('The team MQTT connection dropped; retrying…')
		})
		client.on('offline', () => {
			if (disposed) return
			setConnectionState('offline')
			setConnectionDetail('The cloud MQTT broker is temporarily unreachable.')
		})
		client.on('error', (error) => {
			if (disposed) return
			setConnectionState('error')
			setConnectionDetail(error.message)
		})

		return () => {
			disposed = true
			if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
			refreshTimerRef.current = null
			pendingRefreshRef.current = { ...EMPTY_PENDING_REFRESH }
			client.removeAllListeners()
			client.on('error', () => {})
			client.end(true)
		}
	}, [teamId])

	const snapshot = useMemo<TeamMqttSnapshot>(
		() => ({ connectionState, connectionDetail, messageTotal, lastMessageAt, invalidMessageTotal, ingestError }),
		[connectionDetail, connectionState, ingestError, invalidMessageTotal, lastMessageAt, messageTotal],
	)
	useEffect(() => onSnapshot(snapshot), [onSnapshot, snapshot])

	return null
}

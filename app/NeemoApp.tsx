'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import DemoScannerMonitor from './components/DemoScannerMonitor'
import {
	IconActivity,
	IconArrowRight,
	IconBox,
	IconBroadcast,
	IconCheck,
	IconClose,
	IconCrosshair,
	IconHub,
	IconOverview,
	IconPin,
	IconRefresh,
	IconSearch,
	IconSparkle,
	IconTagPlus,
	IconUser,
} from './components/icons'
import RoomMap, { type MapEstimate, type MapHub, type MapItem, type MapSelection } from './components/RoomMap'
import HubPairingFlow from './HubPairingFlow'
import { DEMO_HUB_ID, DEMO_TAGS, type DemoTagDefinition } from './lib/demo-mqtt'
import { DEMO_FRESHNESS, freshnessLabel, lastSeenLabel, REAL_FRESHNESS, sourceAwareFreshness, type Freshness } from './lib/freshness'
import { measurementsFromRoomPercent, type Point } from './lib/map-viewport'
import type { DemoModeSnapshot } from './MqttDemoMode'
import type { TeamMqttSnapshot } from './TeamMqttMode'

const MqttDemoMode = dynamic(() => import('./MqttDemoMode'), {
	loading: () => (
		<div className="demo-bar demo-bar-loading" role="status">
			<span className="chip-dot busy" aria-hidden="true" />
			<strong>Connecting the demo workspace…</strong>
		</div>
	),
	ssr: false,
})
const TeamMqttMode = dynamic(() => import('./TeamMqttMode'), { ssr: false })

type Screen = 'home' | 'log' | 'hubs' | 'account'
type LocateState = 'idle' | 'searching' | 'found' | 'missing'
type ScanState = 'idle' | 'scanning' | 'ready'
type FinderFilter = 'all' | 'live' | 'history' | 'unseen'
type HubFirmwareState = 'UNPROVISIONED' | 'CONNECTING' | 'PORTAL_PENDING' | 'ONLINE' | 'RECONNECTING' | 'FAILED'

type Hub = {
	id: string
	roomId: string | null
	name: string
	x: number
	y: number
	status: 'online' | 'delayed' | 'offline' | 'setting-up' | 'needs-attention'
	deviceId: string
	shortDeviceId: string
	macAddress: string | null
	ipAddress: string | null
	ssid: string | null
	connectionState: HubFirmwareState
	errorCode: string | null
	firmwareVersion: string | null
	wifiRssi: number | null
	pairedAt: number
	lastSeenAt: number
	placement: {
		left: number
		right: number
		top: number
		bottom: number
	} | null
}

type RoomSpace = {
	id: string
	name: string
	length: number
	width: number
	unit: 'ft' | 'm'
	createdAt: number
	updatedAt: number
}

type Team = {
	id: string
	name: string
	inviteCode: string
	role: 'owner' | 'admin' | 'member'
	ownerSub: string
}

type TeamMember = {
	id: string
	email: string
	name: string
	role: 'owner' | 'admin' | 'member'
	joinedAt: number
}

type RoomLabel = {
	id: string
	name: string
	leftDistance: number
	frontDistance: number
	createdAt: number
	updatedAt: number
}

type Item = {
	id: string
	roomId: string | null
	name: string
	imageUrl: string | null
	category: string
	tagEpc: string
	homeHubId: string | null
	homeHubName: string | null
	lastSeenHubId: string | null
	lastSeenHubName: string | null
	lastSeenAt: number | null
	createdAt: number
	updatedAt: number
	demo?: {
		definition: DemoTagDefinition
		signalRssi: number | null
		readCount: number | null
		sequence: number | null
		retained: boolean
		qos: number | null
		scannerName: string | null
	}
}

type DiscoveredTag = {
	epc: string
	strongestRssi: number
	nearestHubId: string
	nearestHubName: string
	hubCount: number
	readCount: number
	lastSeenAt: number
}

export type NeemoProfile = {
	name: string
	email: string
	role: string
}

type StoredProfile = {
	name: string
	workspaceName: string
	onboardingComplete: boolean
}

type Estimate = {
	x: number
	y: number
	confidence: 'low' | 'medium' | 'high'
	radiusMeters: number
	zone: string
	nearestHubId: string
	nearestHubName: string
	hubCount: number
	lastSeenAt: number
	readings: {
		hubId: string
		hubName: string
		rssi: number
		readCount: number
		lastSeenAt: number
		estimatedDistanceMeters?: number
		residualDb?: number
	}[]
	method: string
	fitErrorDb?: number
	geometryCoverage?: number
}

type ScanProgress = {
	id: string
	mode: 'label' | 'locate'
	status: 'queued' | 'scanning' | 'complete' | 'expired'
	createdAt: number
	expiresAt: number
	hubs: { total: number; queued: number; active: number; completed: number; readingCount: number }
}

const navItems: { id: Screen; label: string; icon: (props: { size?: number }) => ReactNode }[] = [
	{ id: 'home', label: 'Overview', icon: (props) => <IconOverview {...props} /> },
	{ id: 'log', label: 'Log item', icon: (props) => <IconTagPlus {...props} /> },
	{ id: 'hubs', label: 'Hubs', icon: (props) => <IconHub {...props} /> },
	{ id: 'account', label: 'Account', icon: (props) => <IconUser {...props} /> },
]

const ITEM_CATEGORIES = ['Hand tools', 'Motors', 'Electrical', 'Measurement', 'Fasteners', 'Containers'] as const
const FINDER_FILTERS: readonly { id: FinderFilter; label: string }[] = [
	{ id: 'all', label: 'All' },
	{ id: 'live', label: 'Live' },
	{ id: 'history', label: 'History' },
	{ id: 'unseen', label: 'Unseen' },
]
const FRESHNESS_ORDER: Readonly<Record<Freshness, number>> = { live: 0, recent: 1, stale: 2, never: 3 }

const DEMO_MODE_STORAGE_KEY = 'neemo.demo-mode'
const DEMO_ROOM_ID = 'demo-robotics-workshop'
const DEMO_WORKSPACE_NAME = 'Neemo Robotics Club'
const DEMO_HUB_NAME = 'Workshop Entry Scanner'
const DEMO_ROOM: RoomSpace = {
	id: DEMO_ROOM_ID,
	name: 'Robotics Workshop',
	length: 32,
	width: 24,
	unit: 'ft',
	createdAt: 0,
	updatedAt: 0,
}
const DEMO_ROOM_LABELS: readonly RoomLabel[] = [
	{ id: 'demo-label-tools', name: 'Blue tool chest', leftDistance: 6, frontDistance: 5, createdAt: 0, updatedAt: 0 },
	{ id: 'demo-label-safety', name: 'Safety station', leftDistance: 25, frontDistance: 5, createdAt: 0, updatedAt: 0 },
	{ id: 'demo-label-electronics', name: 'Electronics cabinet', leftDistance: 7, frontDistance: 19, createdAt: 0, updatedAt: 0 },
	{ id: 'demo-label-rover', name: 'Rover cart', leftDistance: 25, frontDistance: 18, createdAt: 0, updatedAt: 0 },
]
const EMPTY_DEMO_SNAPSHOT: DemoModeSnapshot = {
	connectionState: 'connecting',
	connectionDetail: 'Opening a secure WebSocket…',
	seenTags: {},
	activity: [],
	messageTotal: 0,
	scannerActive: false,
	scannerStatus: 'offline',
	now: 0,
}
const EMPTY_TEAM_MQTT_SNAPSHOT: TeamMqttSnapshot = {
	connectionState: 'connecting',
	connectionDetail: 'Waiting for a team workspace…',
	messageTotal: 0,
	lastMessageAt: null,
	invalidMessageTotal: 0,
	ingestError: '',
}

function pause(milliseconds: number) {
	return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function roleLabel(role: 'owner' | 'admin' | 'member') {
	return role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member'
}

function hubStateLabel(state: HubFirmwareState) {
	if (state === 'UNPROVISIONED') return 'Ready to set up'
	if (state === 'ONLINE') return 'Already set up'
	if (state === 'FAILED') return 'Needs attention'
	if (state === 'PORTAL_PENDING') return 'Terms need approval'
	return state === 'RECONNECTING' ? 'Reconnecting' : 'Connecting'
}

function hubStatusText(status: Hub['status']) {
	if (status === 'online') return 'Online'
	if (status === 'delayed') return 'Delayed'
	if (status === 'needs-attention') return 'Check Hub'
	if (status === 'setting-up') return 'Setting up'
	return 'Offline'
}

function initialsOf(name: string, fallback: string) {
	return (
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('') || fallback
	)
}

function Brand() {
	return <img className="brand" src="/neemo-logo.png" alt="Neemo" />
}

function FreshnessBadge({ freshness }: { freshness: Freshness }) {
	return (
		<span className={`freshness-badge ${freshness}`}>
			<i className="chip-dot" aria-hidden="true" />
			{freshnessLabel(freshness)}
		</span>
	)
}

export default function NeemoApp({ initialProfile }: { initialProfile: NeemoProfile }) {
	const [screen, setScreen] = useState<Screen>('home')
	const [demoMode, setDemoMode] = useState(false)
	const [demoSnapshot, setDemoSnapshot] = useState<DemoModeSnapshot>(EMPTY_DEMO_SNAPSHOT)
	const [teamMqttSnapshot, setTeamMqttSnapshot] = useState<TeamMqttSnapshot>(EMPTY_TEAM_MQTT_SNAPSHOT)
	const [clock, setClock] = useState(() => Date.now())
	const [items, setItems] = useState<Item[]>([])
	const [hubs, setHubs] = useState<Hub[]>([])
	const [profile, setProfile] = useState<NeemoProfile>(initialProfile)
	const [query, setQuery] = useState('')
	const [finderFilter, setFinderFilter] = useState<FinderFilter>('all')
	const [selectedItemId, setSelectedItemId] = useState('')
	const [overviewHubId, setOverviewHubId] = useState('')
	const [focusTarget, setFocusTarget] = useState<{ kind: 'hub' | 'item'; id: string; token: number } | null>(null)
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [locateState, setLocateState] = useState<LocateState>('idle')
	const [scanState, setScanState] = useState<ScanState>('idle')
	const [activeLabelScanId, setActiveLabelScanId] = useState('')
	const [discoveredTags, setDiscoveredTags] = useState<DiscoveredTag[]>([])
	const [selectedTag, setSelectedTag] = useState('')
	const [itemForm, setItemForm] = useState({ name: '', category: 'Hand tools', homeHubId: '' })
	const [inventoryLoading, setInventoryLoading] = useState(true)
	const [itemSaving, setItemSaving] = useState(false)
	const [itemEditing, setItemEditing] = useState(false)
	const [itemMutating, setItemMutating] = useState(false)
	const [itemImageFile, setItemImageFile] = useState<File | null>(null)
	const [editItemForm, setEditItemForm] = useState({ name: '', category: 'Hand tools', homeHubId: '', roomId: '' })
	const [, setScanError] = useState('')
	const [selectedHubId, setSelectedHubId] = useState('')
	const [placementDraft, setPlacementDraft] = useState<{ left: string; right: string; top: string; bottom: string } | null>(null)
	const [showHubPairing, setShowHubPairing] = useState(false)
	const [hubLoading, setHubLoading] = useState(true)
	const [, setHubError] = useState('')
	const [teamCode, setTeamCode] = useState('')
	const [teamName, setTeamName] = useState('')
	const [onboardingChoice, setOnboardingChoice] = useState<'choose' | 'create' | 'join'>('choose')
	const [team, setTeam] = useState<Team | null>(null)
	const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
	const [teamLoading, setTeamLoading] = useState(true)
	const [teamSaving, setTeamSaving] = useState(false)
	const [, setTeamError] = useState('')
	const [notice, setNotice] = useState('')
	const [locationEstimate, setLocationEstimate] = useState<Estimate | null>(null)
	const [rooms, setRooms] = useState<RoomSpace[]>([])
	const [activeRoomId, setActiveRoomId] = useState('')
	const [canManageSetup, setCanManageSetup] = useState(true)
	const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null)
	const [personalWorkspaceName, setPersonalWorkspaceName] = useState('Personal workspace')
	const [roomLoading, setRoomLoading] = useState(true)
	const [roomSaving, setRoomSaving] = useState(false)
	const [, setRoomError] = useState('')
	const [roomLabels, setRoomLabels] = useState<RoomLabel[]>([])
	const [labelSaving, setLabelSaving] = useState(false)
	const drawerCloseRef = useRef<HTMLButtonElement>(null)
	const finderSearchRef = useRef<HTMLInputElement>(null)

	const refreshItems = useCallback(async () => {
		if (!activeRoomId) {
			setItems([])
			setInventoryLoading(false)
			return
		}
		setInventoryLoading(true)
		try {
			const response = await fetch(`/api/items?roomId=${encodeURIComponent(activeRoomId)}`, { cache: 'no-store' })
			const data = (await response.json()) as { items?: Item[]; error?: string }
			if (!response.ok || !data.items) throw new Error(data.error || 'Inventory could not be loaded.')
			setItems(data.items)
			setSelectedItemId((current) => (data.items?.some((item) => item.id === current) ? current : (data.items?.[0]?.id ?? '')))
		} catch (error) {
			setScanError(error instanceof Error ? error.message : 'Inventory could not be loaded.')
		} finally {
			setInventoryLoading(false)
		}
	}, [activeRoomId])

	const refreshHubs = useCallback(
		async (showNotice = false) => {
			if (!activeRoomId) {
				setHubs([])
				setHubLoading(false)
				return
			}
			setHubLoading(true)
			try {
				const response = await fetch(`/api/hubs?roomId=${encodeURIComponent(activeRoomId)}`, { cache: 'no-store' })
				const data = (await response.json()) as { hubs?: Hub[]; error?: string }
				if (!response.ok || !data.hubs) throw new Error(data.error || 'Hubs could not be refreshed.')

				setHubs(data.hubs)
				setHubError('')
				setSelectedHubId((current) => (data.hubs?.some((hub) => hub.id === current) ? current : (data.hubs?.[0]?.id ?? '')))
				setItemForm((current) => ({
					...current,
					homeHubId: data.hubs?.some((hub) => hub.id === current.homeHubId) ? current.homeHubId : (data.hubs?.[0]?.id ?? ''),
				}))

				if (showNotice) {
					setNotice('Hub connections refreshed.')
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Hubs could not be refreshed.'
				setHubError(message)
			} finally {
				setHubLoading(false)
			}
		},
		[activeRoomId],
	)

	const handleTeamMqttStored = useCallback(
		(change: Readonly<{ hubs: boolean; items: boolean }>) => {
			if (change.hubs) void refreshHubs()
			if (change.items) void refreshItems()
		},
		[refreshHubs, refreshItems],
	)

	const refreshRooms = useCallback(async () => {
		setRoomLoading(true)
		try {
			const response = await fetch('/api/room', { cache: 'no-store' })
			const data = (await response.json()) as { rooms?: RoomSpace[]; canManage?: boolean; error?: string }
			if (!response.ok || !data.rooms) throw new Error(data.error || 'Rooms could not be loaded.')
			setRooms(data.rooms)
			setCanManageSetup(data.canManage ?? true)
			setActiveRoomId((current) => (data.rooms?.some((candidate) => candidate.id === current) ? current : (data.rooms?.[0]?.id ?? '')))
			setRoomError('')
		} catch (error) {
			setRoomError(error instanceof Error ? error.message : 'Rooms could not be loaded.')
		} finally {
			setRoomLoading(false)
		}
	}, [])

	const refreshTeam = useCallback(async () => {
		setTeamLoading(true)
		try {
			const response = await fetch('/api/team', { cache: 'no-store' })
			const data = (await response.json()) as {
				team?: Team | null
				members?: TeamMember[]
				profile?: StoredProfile | null
				error?: string
			}
			if (!response.ok) throw new Error(data.error || 'Team information could not be loaded.')
			setTeam(data.team ?? null)
			setTeamMembers(data.members ?? [])
			if (data.profile) {
				setProfile((current) => ({ ...current, name: data.profile?.name ?? current.name }))
				setPersonalWorkspaceName(data.profile.workspaceName)
				setOnboardingComplete(data.profile.onboardingComplete)
			}
			setTeamError('')
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'Team information could not be loaded.')
		} finally {
			setTeamLoading(false)
		}
	}, [])

	const refreshRoomLabels = useCallback(async () => {
		if (!activeRoomId) {
			setRoomLabels([])
			return
		}
		try {
			const response = await fetch(`/api/room/labels?roomId=${encodeURIComponent(activeRoomId)}`, { cache: 'no-store' })
			const data = (await response.json()) as { labels?: RoomLabel[]; error?: string }
			if (!response.ok) throw new Error(data.error || 'Room labels could not be loaded.')
			setRoomLabels(data.labels ?? [])
		} catch (error) {
			setRoomError(error instanceof Error ? error.message : 'Room labels could not be loaded.')
		}
	}, [activeRoomId])

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetch('/api/session', { method: 'POST' })
			void refreshTeam()
			void refreshRooms()
		}, 0)
		return () => window.clearTimeout(timer)
	}, [refreshRooms, refreshTeam])

	useEffect(() => {
		const timer = window.setTimeout(() => setDemoMode(window.localStorage.getItem(DEMO_MODE_STORAGE_KEY) === 'true'), 0)
		return () => window.clearTimeout(timer)
	}, [])

	useEffect(() => {
		if (demoMode) return
		const timer = window.setTimeout(() => {
			void refreshHubs()
			void refreshItems()
			void refreshRoomLabels()
		}, 0)
		return () => window.clearTimeout(timer)
	}, [activeRoomId, demoMode, refreshHubs, refreshItems, refreshRoomLabels])

	useEffect(() => {
		if (demoMode || screen !== 'hubs') return
		const timer = window.setInterval(() => void refreshHubs(), 10_000)
		return () => window.clearInterval(timer)
	}, [demoMode, refreshHubs, screen])

	useEffect(() => {
		if (demoMode) return
		const timer = window.setInterval(() => void refreshItems(), 15_000)
		return () => window.clearInterval(timer)
	}, [demoMode, refreshItems])

	useEffect(() => {
		if (!notice) return
		const timer = window.setTimeout(() => setNotice(''), 4_000)
		return () => window.clearTimeout(timer)
	}, [notice])

	// Freshness labels only need a coarse clock outside demo mode.
	useEffect(() => {
		const timer = window.setInterval(() => setClock(Date.now()), 5_000)
		return () => window.clearInterval(timer)
	}, [])

	useEffect(() => {
		if (drawerOpen) drawerCloseRef.current?.focus()
	}, [drawerOpen])

	useEffect(() => {
		if (!drawerOpen) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setDrawerOpen(false)
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [drawerOpen])

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (screen !== 'home' || event.metaKey || event.ctrlKey || event.altKey) return
			const target = event.target as HTMLElement | null
			const isEditing =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement ||
				target?.isContentEditable
			if (event.key === '/' && !isEditing) {
				event.preventDefault()
				finderSearchRef.current?.focus()
				document.getElementById('find-items')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
			}
			if (event.key === 'Escape' && document.activeElement === finderSearchRef.current) {
				if (query) setQuery('')
				else finderSearchRef.current?.blur()
			}
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [query, screen])

	const now = demoMode && demoSnapshot.now ? demoSnapshot.now : clock
	const freshnessWindows = demoMode ? DEMO_FRESHNESS : REAL_FRESHNESS

	const demoItems: Item[] = useMemo(
		() =>
			DEMO_TAGS.map((definition) => {
				const reading = demoSnapshot.seenTags[definition.tagId]
				const message = reading?.message
				const lastSeenAt = message ? Date.parse(message.seenAt) : null
				return {
					id: `demo-item-${definition.tagId}`,
					roomId: DEMO_ROOM_ID,
					name: message?.displayName ?? definition.displayName,
					imageUrl: null,
					category: message?.category ?? definition.category,
					tagEpc: definition.tagId,
					homeHubId: DEMO_HUB_ID,
					homeHubName: DEMO_HUB_NAME,
					lastSeenHubId: lastSeenAt ? DEMO_HUB_ID : null,
					lastSeenHubName: lastSeenAt ? DEMO_HUB_NAME : null,
					lastSeenAt,
					createdAt: 0,
					updatedAt: lastSeenAt ?? 0,
					demo: {
						definition,
						signalRssi: message?.signalRssi ?? null,
						readCount: message?.readCount ?? null,
						sequence: message?.sequence ?? null,
						retained: reading?.retained ?? false,
						qos: reading?.qos ?? null,
						scannerName: message?.scannerName ?? null,
					},
				}
			}),
		[demoSnapshot.seenTags],
	)

	const demoLatestSeenAt = Math.max(0, ...Object.values(demoSnapshot.seenTags).map((seen) => Date.parse(seen.message.seenAt)))
	const demoHub: Hub = {
		id: DEMO_HUB_ID,
		roomId: DEMO_ROOM_ID,
		name: DEMO_HUB_NAME,
		x: 62,
		y: 34,
		status: demoSnapshot.scannerStatus === 'publishing' ? 'online' : demoSnapshot.scannerStatus === 'idle' ? 'delayed' : 'offline',
		deviceId: 'demo-examplehubid',
		shortDeviceId: 'DEMO01',
		macAddress: '02:4E:45:45:4D:4F',
		ipAddress: 'mqtt · WSS',
		ssid: 'Public prototype broker',
		connectionState: demoSnapshot.scannerStatus === 'publishing' ? 'ONLINE' : 'RECONNECTING',
		errorCode: null,
		firmwareVersion: 'mock-scanner/1.0',
		wifiRssi: Object.values(demoSnapshot.seenTags)[0]?.message.signalRssi ?? null,
		pairedAt: 0,
		lastSeenAt: demoLatestSeenAt,
		placement: { left: 20, right: 12, top: 8, bottom: 16 },
	}

	const workspaceRooms = demoMode ? [DEMO_ROOM] : rooms
	const workspaceItems = demoMode ? demoItems : items
	const workspaceHubs = demoMode ? [demoHub] : hubs
	const workspaceRoomLabels = demoMode ? [...DEMO_ROOM_LABELS] : roomLabels
	const room = demoMode ? DEMO_ROOM : (rooms.find((candidate) => candidate.id === activeRoomId) ?? null)
	const itemFreshness = (item: Item): Freshness =>
		sourceAwareFreshness(
			item.lastSeenAt,
			now,
			freshnessWindows,
			workspaceHubs.some((hub) => hub.id === item.lastSeenHubId && (hub.status === 'online' || hub.status === 'delayed')),
		)
	const itemSummaries = workspaceItems.map((item) => ({ item, freshness: itemFreshness(item) }))
	const selectedItem = workspaceItems.find((item) => item.id === selectedItemId) ?? workspaceItems[0]
	const selectedHub = workspaceHubs.find((hub) => hub.id === selectedHubId) ?? workspaceHubs[0] ?? null
	const activeSelectedHubId = selectedHub?.id ?? ''
	const normalizedQuery = query.trim().toLowerCase()
	const itemMatchesQuery = (item: Item): boolean =>
		[item.name, item.category, item.tagEpc, item.homeHubName ?? '', item.lastSeenHubName ?? '']
			.join(' ')
			.toLowerCase()
			.includes(normalizedQuery)
	const finderCounts: Readonly<Record<FinderFilter, number>> = {
		all: itemSummaries.length,
		live: itemSummaries.filter(({ freshness }) => freshness === 'live').length,
		history: itemSummaries.filter(({ freshness }) => freshness === 'recent' || freshness === 'stale').length,
		unseen: itemSummaries.filter(({ freshness }) => freshness === 'never').length,
	}
	const filteredItems = itemSummaries
		.filter(({ item }) => itemMatchesQuery(item))
		.filter(({ freshness }) => {
			if (finderFilter === 'all') return true
			if (finderFilter === 'live') return freshness === 'live'
			if (finderFilter === 'unseen') return freshness === 'never'
			return freshness === 'recent' || freshness === 'stale'
		})
		.sort(
			(left, right) =>
				FRESHNESS_ORDER[left.freshness] - FRESHNESS_ORDER[right.freshness] ||
				(right.item.lastSeenAt ?? 0) - (left.item.lastSeenAt ?? 0) ||
				left.item.name.localeCompare(right.item.name),
		)
		.map(({ item }) => item)
	const realHubs = hubs
	const onlineHubCount = workspaceHubs.filter((hub) => hub.status === 'online').length
	const calibratedHubs = workspaceHubs.filter((hub) => hub.placement)
	const realCalibratedHubs = calibratedHubs
	const scanReadyHubCount = realCalibratedHubs.filter((hub) => hub.status === 'online').length
	const calibratedHubIds = new Set(realCalibratedHubs.map((hub) => hub.id))
	const locatedItemCount = workspaceItems.filter(
		(item) => item.lastSeenAt && item.lastSeenHubId && calibratedHubIds.has(item.lastSeenHubId),
	).length
	const freshItemCount = finderCounts.live
	const selectedDiscoveredTag = discoveredTags.find((tag) => tag.epc === selectedTag)
	const initials = initialsOf(profile.name, 'N')
	const workspaceName = team?.name ?? personalWorkspaceName
	const activeWorkspaceName = demoMode ? DEMO_WORKSPACE_NAME : workspaceName
	const canManageTeamSettings = !team || team.role === 'owner' || team.role === 'admin'
	const canFullyEditItems = !team || team.role === 'owner' || team.role === 'admin'
	const workspaceInitials = initialsOf(activeWorkspaceName, 'NW')

	// Map-ready data ---------------------------------------------------------
	const mapHubs: MapHub[] = calibratedHubs.map((hub) => {
		if (screen === 'hubs' && placementDraft && hub.id === activeSelectedHubId && room) {
			const left = Number(placementDraft.left)
			const top = Number(placementDraft.top)
			if (Number.isFinite(left) && Number.isFinite(top) && room.length > 0 && room.width > 0) {
				return {
					id: hub.id,
					name: hub.name,
					status: hub.status,
					x: Math.min(100, Math.max(0, (left / room.length) * 100)),
					y: Math.min(100, Math.max(0, (top / room.width) * 100)),
				}
			}
		}
		return { id: hub.id, name: hub.name, status: hub.status, x: hub.x, y: hub.y }
	})
	const mapItems: MapItem[] = workspaceItems.flatMap((item) =>
		item.lastSeenHubId && item.lastSeenAt
			? [
					{
						id: item.id,
						name: item.name,
						hubId: item.lastSeenHubId,
						hubName: item.lastSeenHubName ?? '',
						lastSeenAt: item.lastSeenAt,
						freshness: itemFreshness(item),
						emoji: item.demo?.definition.emoji,
						highlighted: Boolean(normalizedQuery) && itemMatchesQuery(item),
						dimmed: (Boolean(normalizedQuery) && !itemMatchesQuery(item)) || (finderFilter !== 'all' && !filteredItems.includes(item)),
					},
				]
			: [],
	)
	const overviewSelection: MapSelection = overviewHubId
		? { kind: 'hub', id: overviewHubId }
		: selectedItem
			? { kind: 'item', id: selectedItem.id }
			: null
	const overviewSelectedHub = overviewHubId ? workspaceHubs.find((hub) => hub.id === overviewHubId) : null
	const mapEstimate: MapEstimate | null =
		!demoMode && locationEstimate && (locateState === 'found' || locateState === 'searching')
			? {
					x: locationEstimate.x,
					y: locationEstimate.y,
					radiusMeters: locationEstimate.radiusMeters,
					confidence: locationEstimate.confidence,
					zone: locationEstimate.zone,
				}
			: null

	const goTo = (next: Screen) => {
		setScreen(next)
		setNotice('')
		setDrawerOpen(false)
		if (next !== 'home') {
			setLocateState('idle')
			setLocationEstimate(null)
		}
		window.requestAnimationFrame(() => {
			document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
			window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
		})
	}

	const toggleDemoMode = () => {
		const next = !demoMode
		setDemoMode(next)
		window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, String(next))
		setScreen('home')
		setQuery('')
		setFinderFilter('all')
		setSelectedItemId(next ? `demo-item-${DEMO_TAGS[0]?.tagId}` : '')
		setSelectedHubId(next ? DEMO_HUB_ID : '')
		setOverviewHubId('')
		setDrawerOpen(false)
		setLocateState('idle')
		setLocationEstimate(null)
		setScanState('idle')
		setSelectedTag('')
		setDiscoveredTags([])
		setPlacementDraft(null)
		setNotice(next ? 'Demo mode is on. You are viewing live sample data.' : 'Demo mode is off. Your real workspace is back.')
	}

	const selectItemFromList = (item: Item, options: { fly?: boolean } = {}) => {
		setSelectedItemId(item.id)
		setOverviewHubId('')
		setLocateState('idle')
		setLocationEstimate(null)
		setItemEditing(false)
		if (options.fly !== false && item.lastSeenAt && item.lastSeenHubId) {
			setFocusTarget({ kind: 'item', id: item.id, token: Date.now() })
		}
		if (window.matchMedia('(max-width: 900px)').matches) setDrawerOpen(true)
	}

	const handleMapSelect = (selection: MapSelection) => {
		if (!selection) {
			setOverviewHubId('')
			return
		}
		if (selection.kind === 'hub') {
			setOverviewHubId(selection.id)
			if (window.matchMedia('(max-width: 900px)').matches) setDrawerOpen(true)
			return
		}
		const item = workspaceItems.find((candidate) => candidate.id === selection.id)
		if (item) selectItemFromList(item, { fly: false })
	}

	const loadScan = async (scanId: string) => {
		const response = await fetch(`/api/scans?id=${encodeURIComponent(scanId)}`, { cache: 'no-store' })
		const data = (await response.json()) as {
			scan?: ScanProgress
			tags?: DiscoveredTag[]
			estimate?: Estimate | null
			error?: string
		}
		if (!response.ok || !data.scan) throw new Error(data.error || 'Tag scan could not be loaded.')
		return data
	}

	const runLocate = async () => {
		if (demoMode || !selectedItem || !room || scanReadyHubCount === 0) return
		setLocateState('searching')
		setLocationEstimate(null)
		setNotice('')
		try {
			const response = await fetch('/api/scans', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					mode: 'locate',
					itemId: selectedItem.id,
					roomId: room.id,
				}),
			})
			const created = (await response.json()) as { scan?: { id: string }; error?: string }
			if (!response.ok || !created.scan?.id) throw new Error(created.error || 'Location scan could not be started.')

			let latestEstimate: Estimate | null = null
			for (let attempt = 0; attempt < 21; attempt += 1) {
				await pause(1_000)
				const data = await loadScan(created.scan.id)
				latestEstimate = data.estimate ?? latestEstimate
				if (data.estimate) setLocationEstimate(data.estimate)
				if (data.scan?.status === 'complete' || data.scan?.status === 'expired') break
			}
			setLocateState(latestEstimate ? 'found' : 'missing')
		} catch (error) {
			setLocateState('missing')
			setScanError(error instanceof Error ? error.message : 'Location scan failed.')
		}
	}

	const startTagScan = async () => {
		if (demoMode || !room) return
		setScanState('scanning')
		setSelectedTag('')
		setDiscoveredTags([])
		setActiveLabelScanId('')
		setScanError('')
		try {
			const response = await fetch('/api/scans', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					mode: 'label',
					roomId: room.id,
				}),
			})
			const created = (await response.json()) as { scan?: { id: string }; error?: string }
			if (!response.ok || !created.scan?.id) throw new Error(created.error || 'Tag scan could not be started.')
			setActiveLabelScanId(created.scan.id)

			let latestTags: DiscoveredTag[] = []
			for (let attempt = 0; attempt < 21; attempt += 1) {
				await pause(1_000)
				const data = await loadScan(created.scan.id)
				latestTags = data.tags ?? latestTags
				setDiscoveredTags(latestTags)
				if (data.scan?.status === 'complete' || data.scan?.status === 'expired') break
			}
			if (!latestTags.length) setScanError('No unlabelled tags were detected during this scan.')
			setScanState('ready')
		} catch (error) {
			setScanError(error instanceof Error ? error.message : 'Nearby tags could not be loaded.')
			setScanState('ready')
		}
	}

	const addItem = async (event: FormEvent) => {
		event.preventDefault()
		if (demoMode) {
			setNotice('Demo inventory is read-only. Turn off demo mode to log a real item.')
			return
		}
		if (!selectedTag || !itemForm.name.trim()) return
		setItemSaving(true)
		setScanError('')
		try {
			const response = await fetch('/api/items', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					epc: selectedTag,
					roomId: activeRoomId,
					name: itemForm.name.trim(),
					category: itemForm.category,
					homeHubId: itemForm.homeHubId || null,
					scanId: activeLabelScanId || undefined,
				}),
			})
			const data = (await response.json()) as { item?: Item; error?: string }
			if (!response.ok || !data.item) throw new Error(data.error || 'Item could not be saved.')

			setItems((current) => [data.item as Item, ...current.filter((item) => item.id !== data.item?.id)])
			setSelectedItemId(data.item.id)
			setQuery('')
			setItemForm({ name: '', category: 'Hand tools', homeHubId: realHubs[0]?.id ?? '' })
			setSelectedTag('')
			setActiveLabelScanId('')
			setDiscoveredTags((current) => current.filter((tag) => tag.epc !== data.item?.tagEpc))
			setScanState('idle')
			setNotice(`${data.item.name} is now tracked.`)
			setScreen('home')
			window.setTimeout(() => document.getElementById('find-items')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
		} catch (error) {
			setScanError(error instanceof Error ? error.message : 'Item could not be saved.')
		} finally {
			setItemSaving(false)
		}
	}

	const disconnectHub = async () => {
		if (!selectedHubId) return
		const hub = hubs.find((value) => value.id === selectedHubId)
		if (!hub) return
		if (!window.confirm(`Disconnect ${hub.name}? You can pair it again later.`)) return

		const response = await fetch('/api/hubs', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: hub.id }),
		})
		if (!response.ok) {
			setHubError('Hub could not be disconnected.')
			return
		}
		setNotice(`${hub.name} disconnected.`)
		await refreshHubs()
	}

	const renameHub = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!selectedHub) return
		const form = new FormData(event.currentTarget)
		const name = String(form.get('hubName') ?? '').trim()
		const roomId = String(form.get('hubRoomId') ?? activeRoomId).trim()
		if (!name || !roomId || (name === selectedHub.name && roomId === activeRoomId)) return

		const response = await fetch('/api/hubs', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: selectedHub.id, name, roomId }),
		})
		const data = (await response.json()) as { error?: string }
		if (!response.ok) {
			setHubError(data.error || 'Hub name could not be saved.')
			return
		}
		setNotice(roomId === activeRoomId ? `${name} updated.` : `${name} moved to another room.`)
		if (roomId !== activeRoomId) setActiveRoomId(roomId)
		else await refreshHubs()
	}

	const saveRoom = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		const roomId = String(form.get('roomId') ?? room?.id ?? '').trim()
		const targetRoom = rooms.find((candidate) => candidate.id === roomId)
		if (!targetRoom) return
		setRoomSaving(true)
		setRoomError('')
		try {
			const response = await fetch('/api/room', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					id: targetRoom.id,
					name: String(form.get('roomName') ?? ''),
					length: Number(form.get('roomLength')),
					width: Number(form.get('roomWidth')),
					unit: String(form.get('roomUnit') ?? 'ft'),
				}),
			})
			const data = (await response.json()) as { room?: RoomSpace; error?: string }
			if (!response.ok || !data.room) throw new Error(data.error || 'Room setup could not be saved.')
			setRooms((current) => current.map((candidate) => (candidate.id === data.room?.id ? (data.room as RoomSpace) : candidate)))
			setNotice(`${data.room.name} updated.`)
			await Promise.all([refreshHubs(), refreshRoomLabels()])
		} catch (error) {
			setRoomError(error instanceof Error ? error.message : 'Room setup could not be saved.')
		} finally {
			setRoomSaving(false)
		}
	}

	const createRoom = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		setRoomSaving(true)
		setRoomError('')
		try {
			const response = await fetch('/api/room', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: String(form.get('roomName') ?? ''),
					length: Number(form.get('roomLength')),
					width: Number(form.get('roomWidth')),
					unit: String(form.get('roomUnit') ?? 'ft'),
				}),
			})
			const data = (await response.json()) as { room?: RoomSpace; error?: string }
			if (!response.ok || !data.room) throw new Error(data.error || 'Room could not be created.')
			setRooms((current) => [...current, data.room as RoomSpace])
			setActiveRoomId(data.room.id)
			event.currentTarget.reset()
			setNotice(`${data.room.name} created.`)
		} catch (error) {
			setRoomError(error instanceof Error ? error.message : 'Room could not be created.')
		} finally {
			setRoomSaving(false)
		}
	}

	const removeRoom = async (targetRoom: RoomSpace | null = room) => {
		if (!targetRoom || !window.confirm(`Remove ${targetRoom.name}? Empty rooms can be removed permanently.`)) return
		setRoomSaving(true)
		setRoomError('')
		try {
			const response = await fetch('/api/room', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: targetRoom.id }),
			})
			const data = (await response.json()) as { error?: string }
			if (!response.ok) throw new Error(data.error || 'Room could not be removed.')
			const remaining = rooms.filter((candidate) => candidate.id !== targetRoom.id)
			setRooms(remaining)
			if (activeRoomId === targetRoom.id) setActiveRoomId(remaining[0]?.id ?? '')
			setNotice(`${targetRoom.name} removed.`)
		} catch (error) {
			setRoomError(error instanceof Error ? error.message : 'Room could not be removed.')
		} finally {
			setRoomSaving(false)
		}
	}

	const saveHubPlacement = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!selectedHub || !room) return
		const form = new FormData(event.currentTarget)
		setHubError('')
		const placement = {
			left: Number(form.get('leftDistance')),
			right: Number(form.get('rightDistance')),
			top: Number(form.get('topDistance')),
			bottom: Number(form.get('bottomDistance')),
		}

		const response = await fetch('/api/hubs', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				id: selectedHub.id,
				roomId: activeRoomId,
				placement,
			}),
		})
		const data = (await response.json()) as { error?: string }
		if (!response.ok) {
			setHubError(data.error || 'Hub measurements could not be saved.')
			setNotice(data.error || 'Hub measurements could not be saved. Opposite sides must add up to the room size.')
			return
		}
		setNotice(`${selectedHub.name} is placed on the room map.`)
		setPlacementDraft(null)
		await refreshHubs()
	}

	const applyMapPlacement = (point: Point) => {
		if (!room) return
		const measurements = measurementsFromRoomPercent(point, room)
		setPlacementDraft({
			left: String(measurements.left),
			right: String(measurements.right),
			top: String(measurements.top),
			bottom: String(measurements.bottom),
		})
	}

	const addRoomLabel = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		setLabelSaving(true)
		setRoomError('')
		try {
			const response = await fetch('/api/room/labels', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: String(form.get('labelName') ?? ''),
					roomId: activeRoomId,
					leftDistance: Number(form.get('labelLeft')),
					frontDistance: Number(form.get('labelFront')),
				}),
			})
			const data = (await response.json()) as { label?: RoomLabel; error?: string }
			if (!response.ok || !data.label) throw new Error(data.error || 'Room label could not be added.')
			setRoomLabels((current) => [...current, data.label as RoomLabel])
			event.currentTarget.reset()
			setNotice(`${data.label.name} added to the map.`)
		} catch (error) {
			setRoomError(error instanceof Error ? error.message : 'Room label could not be added.')
		} finally {
			setLabelSaving(false)
		}
	}

	const removeRoomLabel = async (label: RoomLabel) => {
		if (!window.confirm(`Remove ${label.name} from ${room?.name ?? 'this room'}?`)) return
		const response = await fetch('/api/room/labels', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: label.id, roomId: activeRoomId }),
		})
		const data = (await response.json()) as { error?: string }
		if (!response.ok) {
			setRoomError(data.error || 'Room label could not be removed.')
			return
		}
		setRoomLabels((current) => current.filter((candidate) => candidate.id !== label.id))
		setNotice(`${label.name} removed from the map.`)
	}

	const applyTeamResponse = async (response: Response) => {
		const data = (await response.json()) as {
			team?: Team | null
			members?: TeamMember[]
			profile?: StoredProfile | null
			error?: string
		}
		if (!response.ok) throw new Error(data.error || 'Team changes could not be saved.')
		setTeam(data.team ?? null)
		setTeamMembers(data.members ?? [])
		if (data.profile) {
			setProfile((current) => ({ ...current, name: data.profile?.name ?? current.name }))
			setPersonalWorkspaceName(data.profile.workspaceName)
			setOnboardingComplete(data.profile.onboardingComplete)
		}
		setTeamError('')
		await refreshRooms()
	}

	const createTeam = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!teamName.trim()) return
		setTeamSaving(true)
		setTeamError('')
		try {
			const response = await fetch('/api/team', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'create', name: teamName.trim() }),
			})
			await applyTeamResponse(response)
			setTeamName('')
			setNotice('Team created. Your Hubs and items are now shared with its members.')
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'Team could not be created.')
		} finally {
			setTeamSaving(false)
		}
	}

	const joinTeam = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!teamCode.trim()) return
		setTeamSaving(true)
		setTeamError('')
		try {
			const response = await fetch('/api/team', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'join', code: teamCode }),
			})
			await applyTeamResponse(response)
			setTeamCode('')
			setNotice('You joined the team workspace.')
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'Team could not be joined.')
		} finally {
			setTeamSaving(false)
		}
	}

	const renameTeam = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!team) return
		const form = new FormData(event.currentTarget)
		const name = String(form.get('teamName') ?? '').trim()
		if (!name) return
		setTeamSaving(true)
		try {
			const response = await fetch('/api/team', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name }),
			})
			await applyTeamResponse(response)
			setNotice('Team name updated.')
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'Team name could not be updated.')
		} finally {
			setTeamSaving(false)
		}
	}

	const rotateTeamCode = async () => {
		setTeamSaving(true)
		try {
			const response = await fetch('/api/team', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rotateCode: true }),
			})
			await applyTeamResponse(response)
			setNotice('A new invite code is ready.')
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'Invite code could not be changed.')
		} finally {
			setTeamSaving(false)
		}
	}

	const saveAccountSettings = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = new FormData(event.currentTarget)
		const name = String(form.get('displayName') ?? '').trim()
		const workspaceNameInput = String(form.get('workspaceName') ?? '').trim()
		if (!name || (!team && !workspaceNameInput)) return
		setTeamSaving(true)
		setTeamError('')
		try {
			const renameResponse = await fetch('/api/team', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'renameSelf', name }),
			})
			await applyTeamResponse(renameResponse)
			if (!team) {
				const workspaceResponse = await fetch('/api/team', {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'renameWorkspace', workspaceName: workspaceNameInput }),
				})
				await applyTeamResponse(workspaceResponse)
			}
			setNotice('Account settings updated.')
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'Account settings could not be updated.')
		} finally {
			setTeamSaving(false)
		}
	}

	const setMemberRole = async (member: TeamMember, role: 'admin' | 'member') => {
		const action = role === 'admin' ? 'make this person an admin' : "remove this person's admin title"
		if (!window.confirm(`Are you sure you want to ${action}?`)) return
		setTeamSaving(true)
		setTeamError('')
		try {
			const response = await fetch('/api/team', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'setRole', memberId: member.id, role }),
			})
			await applyTeamResponse(response)
			setNotice(role === 'admin' ? `${member.name} is now an admin.` : `${member.name} is now a member.`)
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'Member access could not be changed.')
		} finally {
			setTeamSaving(false)
		}
	}

	const skipOnboarding = async () => {
		setTeamSaving(true)
		try {
			const response = await fetch('/api/team', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'skipOnboarding' }),
			})
			await applyTeamResponse(response)
			setNotice('You can create a team or add rooms any time from Account or Hubs.')
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'Setup could not be skipped.')
		} finally {
			setTeamSaving(false)
		}
	}

	const removeTeamMember = async (member: TeamMember) => {
		if (!window.confirm(`Remove ${member.name} from ${team?.name}?`)) return
		setTeamSaving(true)
		try {
			const response = await fetch('/api/team', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ memberId: member.id }),
			})
			await applyTeamResponse(response)
			setNotice(`${member.name} was removed.`)
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'Team member could not be removed.')
		} finally {
			setTeamSaving(false)
		}
	}

	const leaveTeam = async () => {
		if (!team || !window.confirm(team.role === 'owner' ? `Delete ${team.name}? This cannot be undone.` : `Leave ${team.name}?`)) return
		setTeamSaving(true)
		try {
			const response = await fetch('/api/team', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ leave: true }),
			})
			await applyTeamResponse(response)
			setNotice('You left the team workspace.')
		} catch (error) {
			setTeamError(error instanceof Error ? error.message : 'The team could not be left.')
		} finally {
			setTeamSaving(false)
		}
	}

	const openItemEditor = (item: Item) => {
		setEditItemForm({
			name: item.name,
			category: item.category,
			homeHubId: item.homeHubId ?? '',
			roomId: item.roomId ?? activeRoomId,
		})
		setSelectedItemId(item.id)
		setItemImageFile(null)
		setItemEditing(true)
	}

	const beginItemEdit = () => {
		if (selectedItem) openItemEditor(selectedItem)
	}

	const saveItemChanges = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!selectedItem || !editItemForm.name.trim()) return
		setItemMutating(true)
		try {
			const response = await fetch('/api/items', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					id: selectedItem.id,
					name: editItemForm.name.trim(),
					...(canFullyEditItems
						? {
								category: editItemForm.category,
								roomId: editItemForm.roomId || activeRoomId,
								homeHubId: editItemForm.homeHubId || null,
							}
						: {}),
				}),
			})
			const data = (await response.json()) as { item?: Item; error?: string }
			if (!response.ok || !data.item) throw new Error(data.error || 'Item changes could not be saved.')
			let savedItem = data.item
			if (itemImageFile) {
				const imageResponse = await fetch(`/api/items/image?id=${encodeURIComponent(savedItem.id)}`, {
					method: 'PUT',
					headers: { 'content-type': itemImageFile.type },
					body: itemImageFile,
				})
				const imageData = (await imageResponse.json()) as { imageUrl?: string; updatedAt?: number; error?: string }
				if (!imageResponse.ok || !imageData.imageUrl || !imageData.updatedAt) {
					throw new Error(imageData.error || 'Item image could not be updated.')
				}
				savedItem = { ...savedItem, imageUrl: imageData.imageUrl, updatedAt: imageData.updatedAt }
			}
			setItems((current) => current.map((item) => (item.id === savedItem.id ? savedItem : item)))
			setItemEditing(false)
			setItemImageFile(null)
			setNotice(`${savedItem.name} updated.`)
			if (savedItem.roomId && savedItem.roomId !== activeRoomId) setActiveRoomId(savedItem.roomId)
		} catch (error) {
			setScanError(error instanceof Error ? error.message : 'Item changes could not be saved.')
		} finally {
			setItemMutating(false)
		}
	}

	const removeItem = async (targetItem: Item | undefined = selectedItem) => {
		if (!targetItem || !window.confirm(`Remove ${targetItem.name} from Neemo completely? The tag can be labelled again later.`)) return
		setItemMutating(true)
		try {
			const response = await fetch('/api/items', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: targetItem.id }),
			})
			const data = (await response.json()) as { error?: string }
			if (!response.ok) throw new Error(data.error || 'Item could not be removed.')
			setItems((current) => current.filter((item) => item.id !== targetItem.id))
			if (selectedItem?.id === targetItem.id) {
				setSelectedItemId('')
				setLocationEstimate(null)
				setLocateState('idle')
				setItemEditing(false)
				setDrawerOpen(false)
			}
			setNotice(`${targetItem.name} is no longer tracked.`)
		} catch (error) {
			setScanError(error instanceof Error ? error.message : 'Item could not be removed.')
		} finally {
			setItemMutating(false)
		}
	}

	// --- Shared detail renderers (plain functions so inputs keep focus) -----

	const renderItemDetail = (context: 'panel' | 'drawer') => {
		if (overviewSelectedHub) {
			const hubItemCount = workspaceItems.filter((item) => item.lastSeenHubId === overviewSelectedHub.id && item.lastSeenAt).length
			return (
				<div className="item-detail hub-detail-summary">
					<header className="detail-head">
						<span className="detail-symbol hub-symbol">
							<IconHub size={22} />
						</span>
						<div>
							<h3>{overviewSelectedHub.name}</h3>
							<p className="detail-sub">
								Hub · Neemo-{overviewSelectedHub.shortDeviceId} · {hubStatusText(overviewSelectedHub.status)}
							</p>
						</div>
						<span className={`hub-status-badge ${overviewSelectedHub.status}`}>{hubStatusText(overviewSelectedHub.status)}</span>
					</header>
					<dl className="detail-facts">
						<div>
							<dt>Last heartbeat</dt>
							<dd>{lastSeenLabel(overviewSelectedHub.lastSeenAt, now)}</dd>
						</div>
						<div>
							<dt>Items seen here</dt>
							<dd>{hubItemCount}</dd>
						</div>
						<div>
							<dt>Placement</dt>
							<dd>{overviewSelectedHub.placement ? 'Measured on map' : 'Not measured yet'}</dd>
						</div>
					</dl>
					<div className="detail-actions-row">
						<button className="button secondary" type="button" onClick={() => goTo('hubs')}>
							Manage in Hubs <IconArrowRight size={15} />
						</button>
					</div>
				</div>
			)
		}

		if (!selectedItem) {
			return (
				<div className="empty-state">
					<IconSearch size={22} />
					<strong>Select an item</strong>
					<p>Pick a result to see where it was last observed.</p>
				</div>
			)
		}

		const freshness = itemFreshness(selectedItem)
		return (
			<div className="item-detail">
				<header className="detail-head">
					<span className={`detail-symbol ${selectedItem.imageUrl ? 'has-image' : ''}`}>
						{selectedItem.imageUrl ? (
							<img src={selectedItem.imageUrl} alt="" />
						) : (
							(selectedItem.demo?.definition.emoji ?? selectedItem.category.charAt(0))
						)}
					</span>
					<div>
						<h3>{selectedItem.name}</h3>
						<p className="detail-sub">
							{selectedItem.category} · Tag …{selectedItem.tagEpc.slice(-6)}
						</p>
					</div>
					<FreshnessBadge freshness={freshness} />
				</header>

				<p className="detail-lastseen">
					{selectedItem.lastSeenAt && selectedItem.lastSeenHubName ? (
						<>
							Last seen near <strong>{selectedItem.lastSeenHubName}</strong> · {lastSeenLabel(selectedItem.lastSeenAt, now)}
						</>
					) : demoMode ? (
						'Not observed yet — run the mock scanner to publish this tag.'
					) : (
						'Not observed yet — it appears on the map after a Hub reads its tag.'
					)}
				</p>

				{demoMode && selectedItem.demo && (
					<div className="demo-story">
						<p>{selectedItem.demo.definition.description}</p>
						<dl>
							<div>
								<dt>Asset code</dt>
								<dd>{selectedItem.demo.definition.assetCode}</dd>
							</div>
							<div>
								<dt>Custodian</dt>
								<dd>{selectedItem.demo.definition.custodian}</dd>
							</div>
							<div>
								<dt>Project</dt>
								<dd>{selectedItem.demo.definition.project}</dd>
							</div>
							<div>
								<dt>Home</dt>
								<dd>{selectedItem.demo.definition.homeLocation}</dd>
							</div>
							<div>
								<dt>Model</dt>
								<dd>
									{selectedItem.demo.definition.manufacturer} · {selectedItem.demo.definition.model}
								</dd>
							</div>
							<div>
								<dt>Latest read</dt>
								<dd>
									{selectedItem.demo.signalRssi === null
										? 'Waiting for scanner'
										: `${selectedItem.demo.signalRssi} dBm · ${selectedItem.demo.readCount} reads · QoS ${selectedItem.demo.qos} · ${selectedItem.demo.retained ? 'retained' : 'live'}`}
								</dd>
							</div>
						</dl>
					</div>
				)}

				{!demoMode && itemEditing && context === 'panel' && (
					<form className="inline-item-editor" onSubmit={saveItemChanges}>
						<label>
							Item name
							<input
								required
								maxLength={100}
								value={editItemForm.name}
								onChange={(event) => setEditItemForm({ ...editItemForm, name: event.target.value })}
							/>
						</label>
						<label className="item-image-field">
							Item image
							<input
								type="file"
								accept="image/jpeg,image/png,image/webp,image/gif"
								onChange={(event) => setItemImageFile(event.target.files?.[0] ?? null)}
							/>
							<small>JPG, PNG, WebP, or GIF · up to 5 MB</small>
						</label>
						{canFullyEditItems && (
							<>
								<label>
									Category
									<select
										value={editItemForm.category}
										onChange={(event) => setEditItemForm({ ...editItemForm, category: event.target.value })}
									>
										{ITEM_CATEGORIES.map((category) => (
											<option key={category}>{category}</option>
										))}
									</select>
								</label>
								<label>
									Room
									<select
										value={editItemForm.roomId}
										onChange={(event) => setEditItemForm({ ...editItemForm, roomId: event.target.value, homeHubId: '' })}
									>
										{rooms.map((candidate) => (
											<option key={candidate.id} value={candidate.id}>
												{candidate.name}
											</option>
										))}
									</select>
								</label>
								<label>
									Home Hub
									<select
										value={editItemForm.homeHubId}
										onChange={(event) => setEditItemForm({ ...editItemForm, homeHubId: event.target.value })}
									>
										<option value="">No home Hub</option>
										{realHubs.map((hub) => (
											<option key={hub.id} value={hub.id}>
												{hub.name}
											</option>
										))}
									</select>
								</label>
							</>
						)}
						<div className="editor-actions">
							<button
								className="button ghost"
								type="button"
								onClick={() => {
									setItemEditing(false)
									setItemImageFile(null)
								}}
							>
								Cancel
							</button>
							<button className="button primary" type="submit" disabled={itemMutating || !editItemForm.name.trim()}>
								{itemMutating ? 'Saving…' : 'Save changes'}
							</button>
						</div>
					</form>
				)}

				{demoMode ? (
					<div className={`demo-location-truth ${demoSnapshot.scannerStatus}`} role="status">
						<strong>
							{demoSnapshot.scannerStatus === 'publishing' && freshness === 'live'
								? `Observed live by ${selectedItem.lastSeenHubName ?? DEMO_HUB_NAME}`
								: demoSnapshot.scannerStatus === 'offline'
									? 'Scanner offline · retained history only'
									: 'Last-known scanner observation'}
						</strong>
						<span>
							{selectedItem.lastSeenAt
								? `Last message ${lastSeenLabel(selectedItem.lastSeenAt, now)}. One scanner identifies proximity only; no position, distance, or confidence estimate is available.`
								: 'This tag has not been observed. Run the mock scanner to produce a live reading.'}
						</span>
					</div>
				) : (
					<div className={`locate-status ${locateState}`} role="status">
						{locateState === 'idle' && (
							<>
								<strong>Ready to locate</strong>
								<span>
									{scanReadyHubCount} measured {scanReadyHubCount === 1 ? 'Hub is' : 'Hubs are'} ready to scan this room.
								</span>
							</>
						)}
						{locateState === 'searching' && (
							<>
								<strong>Looking for this item…</strong>
								<span>Each connected Hub is checking for the tag now.</span>
							</>
						)}
						{locateState === 'found' && locationEstimate && (
							<>
								<strong>{locationEstimate.zone}</strong>
								<span>
									{locationEstimate.confidence} confidence · about ±{locationEstimate.radiusMeters.toFixed(1)} m ·{' '}
									{locationEstimate.hubCount} {locationEstimate.hubCount === 1 ? 'Hub' : 'Hubs'} reporting
								</span>
							</>
						)}
						{locateState === 'missing' && (
							<>
								<strong>Not detected in this scan</strong>
								<span>Move the item into reader range or check the Hub and reader connections.</span>
							</>
						)}
					</div>
				)}

				<div className="detail-actions-row">
					{!demoMode && (
						<button
							className="button primary locate-button"
							type="button"
							onClick={() => void runLocate()}
							disabled={locateState === 'searching' || scanReadyHubCount === 0}
						>
							<IconCrosshair size={16} />
							{locateState === 'searching' ? 'Locating…' : locateState === 'found' ? 'Refresh location' : 'Locate item'}
						</button>
					)}
					{selectedItem.lastSeenAt && selectedItem.lastSeenHubId && (
						<button
							className="button secondary"
							type="button"
							onClick={() => {
								setFocusTarget(
									demoMode
										? { kind: 'hub', id: selectedItem.lastSeenHubId as string, token: Date.now() }
										: { kind: 'item', id: selectedItem.id, token: Date.now() },
								)
								if (context === 'drawer') setDrawerOpen(false)
								document.getElementById('overview-map')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
							}}
						>
							<IconPin size={15} /> {demoMode ? 'Show scanner on map' : 'Show on map'}
						</button>
					)}
					{!demoMode && context === 'panel' && (
						<div className="detail-manage">
							<button className="button ghost" type="button" onClick={beginItemEdit} disabled={itemMutating}>
								Edit
							</button>
							{canManageSetup && (
								<button className="button ghost danger" type="button" onClick={() => void removeItem()} disabled={itemMutating}>
									Remove
								</button>
							)}
						</div>
					)}
				</div>

				{!demoMode && <p className="algorithm-note">Fresh Hub scan · relative-signal trilateration · uncertainty shown on the map</p>}
			</div>
		)
	}

	// ------------------------------------------------------------------------

	const hasWorkspaceContent = demoMode || rooms.length > 0

	return (
		<div className={`app-shell ${demoMode ? 'demo-mode-active' : ''}`}>
			<a className="skip-link" href="#main-content">
				Skip to content
			</a>
			<aside className="sidebar">
				<Brand />
				<div className="workspace-chip">
					<span aria-hidden="true">{demoMode ? <IconSparkle size={16} /> : workspaceInitials}</span>
					<div>
						<strong>{activeWorkspaceName}</strong>
						<small>
							{demoMode ? (
								'Sample workspace'
							) : (
								<>
									<i className={`chip-dot ${onlineHubCount > 0 ? 'ok' : 'off'}`} aria-hidden="true" /> {onlineHubCount}{' '}
									{onlineHubCount === 1 ? 'Hub' : 'Hubs'} online
								</>
							)}
						</small>
					</div>
				</div>
				<nav aria-label="Main navigation">
					{navItems.map((item) => (
						<button
							type="button"
							key={item.id}
							className={screen === item.id ? 'active' : ''}
							aria-current={screen === item.id ? 'page' : undefined}
							onClick={() => goTo(item.id)}
						>
							<span className="nav-icon">{item.icon({ size: 19 })}</span>
							{demoMode && item.id === 'log' ? 'Scanner' : item.label}
						</button>
					))}
				</nav>
				<div className="sidebar-foot">
					<p>{demoMode ? 'Demo data never touches your real inventory.' : 'Hubs send tag observations to your team workspace.'}</p>
				</div>
			</aside>

			<div className="workspace">
				<header className="topbar">
					<div className="topbar-left">
						<span className="mobile-brand">
							<Brand />
						</span>
						<label className="room-switcher">
							<span>Room</span>
							<select
								value={demoMode ? DEMO_ROOM_ID : activeRoomId}
								disabled={demoMode}
								onChange={(event) => {
									setActiveRoomId(event.target.value)
									setQuery('')
									setFinderFilter('all')
									setLocateState('idle')
									setLocationEstimate(null)
									setOverviewHubId('')
								}}
								aria-label="Choose active room"
							>
								{workspaceRooms.length === 0 && <option value="">{roomLoading ? 'Loading rooms…' : 'No rooms yet'}</option>}
								{workspaceRooms.map((candidate) => (
									<option key={candidate.id} value={candidate.id}>
										{candidate.name}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="topbar-actions">
						{!demoMode && hasWorkspaceContent && (
							<div className="topbar-metrics">
								{team && (
									<button
										className="status-chip"
										type="button"
										onClick={() => goTo('hubs')}
										title={teamMqttSnapshot.ingestError || teamMqttSnapshot.connectionDetail}
									>
										<i
											className={`chip-dot ${
												teamMqttSnapshot.connectionState === 'live'
													? 'ok'
													: teamMqttSnapshot.connectionState === 'connecting' ||
														  teamMqttSnapshot.connectionState === 'subscribing' ||
														  teamMqttSnapshot.connectionState === 'reconnecting'
														? 'busy'
														: 'off'
											}`}
											aria-hidden="true"
										/>
										{teamMqttSnapshot.connectionState === 'live'
											? 'Team MQTT connected'
											: teamMqttSnapshot.connectionState === 'connecting' ||
												  teamMqttSnapshot.connectionState === 'subscribing' ||
												  teamMqttSnapshot.connectionState === 'reconnecting'
												? 'MQTT connecting'
												: 'MQTT offline'}
									</button>
								)}
								<button
									className="status-chip"
									type="button"
									onClick={() => document.getElementById('find-items')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
								>
									<i className={`chip-dot ${locatedItemCount > 0 ? 'ok' : 'off'}`} aria-hidden="true" />
									{locatedItemCount}/{workspaceItems.length} items located
								</button>
								<button className="status-chip" type="button" onClick={() => goTo('hubs')}>
									<i className={`chip-dot ${onlineHubCount > 0 ? 'ok' : 'off'}`} aria-hidden="true" />
									{onlineHubCount}/{workspaceHubs.length} Hubs connected
								</button>
							</div>
						)}
						<button
							className={`demo-switch ${demoMode ? 'active' : ''}`}
							type="button"
							role="switch"
							aria-checked={demoMode}
							onClick={toggleDemoMode}
						>
							<span className="demo-switch-track" aria-hidden="true">
								<i />
							</span>
							<span className="demo-switch-text">
								<strong>Demo mode</strong>
								<small>{demoMode ? 'Sample data' : 'Try it out'}</small>
							</span>
						</button>
						<button className="avatar-button" type="button" onClick={() => goTo('account')} aria-label="Open account and team">
							{initials}
						</button>
					</div>
				</header>

				{demoMode && <MqttDemoMode onSnapshot={setDemoSnapshot} onExit={toggleDemoMode} />}
				{!demoMode && team?.id && <TeamMqttMode teamId={team.id} onSnapshot={setTeamMqttSnapshot} onStored={handleTeamMqttStored} />}

				{notice && (
					<div className="notice" role="status">
						<IconCheck size={15} />
						{notice}
					</div>
				)}

				{!demoMode && !teamLoading && onboardingComplete === false && !team && (
					<div className="room-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-setup-title">
						<div className="room-setup-card onboarding-card">
							<p className="eyebrow">Welcome to Neemo</p>
							<h1 id="welcome-setup-title">
								{onboardingChoice === 'choose'
									? 'Choose how to get started'
									: onboardingChoice === 'create'
										? 'Create your team'
										: 'Join a team'}
							</h1>
							{onboardingChoice === 'choose' ? (
								<>
									<p>
										Start a new team or join one that already uses Neemo. We will ask for the team name or invite code only after you
										choose.
									</p>
									<div className="onboarding-choices">
										<button
											type="button"
											onClick={() => {
												setTeamCode('')
												setOnboardingChoice('create')
											}}
										>
											<span aria-hidden="true">＋</span>
											<strong>Create a team</strong>
											<small>Start a new shared workspace</small>
											<b aria-hidden="true">→</b>
										</button>
										<button
											type="button"
											onClick={() => {
												setTeamName('')
												setOnboardingChoice('join')
											}}
										>
											<span aria-hidden="true">↗</span>
											<strong>Join a team</strong>
											<small>Use an invite code from a teammate</small>
											<b aria-hidden="true">→</b>
										</button>
									</div>
								</>
							) : onboardingChoice === 'create' ? (
								<>
									<p>Give your team a name. You can add a room next or skip room setup for now.</p>
									<form className="onboarding-option" onSubmit={createTeam}>
										<label>
											Team name
											<input
												autoFocus
												required
												value={teamName}
												onChange={(event) => setTeamName(event.target.value)}
												maxLength={80}
												placeholder="e.g. Northside Workshop"
											/>
										</label>
										<button className="button primary" disabled={!teamName.trim() || teamSaving} type="submit">
											Create team
										</button>
									</form>
								</>
							) : (
								<>
									<p>Enter the team’s invite code to load its rooms, Hubs, and tagged items.</p>
									<form className="onboarding-option" onSubmit={joinTeam}>
										<label>
											Team invite code
											<input
												autoFocus
												required
												value={teamCode}
												onChange={(event) => setTeamCode(event.target.value.toUpperCase())}
												maxLength={9}
												placeholder="ABCD EFGH"
											/>
										</label>
										<button className="button secondary" disabled={!teamCode.trim() || teamSaving} type="submit">
											Join team
										</button>
									</form>
								</>
							)}
							{onboardingChoice !== 'choose' && (
								<button
									className="text-button onboarding-back"
									disabled={teamSaving}
									type="button"
									onClick={() => setOnboardingChoice('choose')}
								>
									← Back to options
								</button>
							)}
							<button className="text-button onboarding-skip" disabled={teamSaving} type="button" onClick={() => void skipOnboarding()}>
								Skip for now
							</button>
						</div>
					</div>
				)}

				<main id="main-content">
					{!demoMode && screen !== 'account' && !roomLoading && rooms.length === 0 && (
						<div className="page roomless-page">
							<section className="panel roomless-card">
								<span className="roomless-icon" aria-hidden="true">
									<IconBox size={26} />
								</span>
								<p className="eyebrow">Start with a room</p>
								<h1>Add your first room</h1>
								<p>
									Rooms hold their own Hubs, tagged items, measurements, and map labels. There is nothing else to show until one is added.
								</p>
								{canManageSetup ? (
									<>
										<form className="roomless-form" onSubmit={createRoom}>
											<label>
												Room name
												<input name="roomName" required maxLength={60} placeholder="e.g. Tool Area" />
											</label>
											<label>
												Length
												<input name="roomLength" required type="number" min="0.1" max="1000" step="0.01" placeholder="20" />
											</label>
											<label>
												Width
												<input name="roomWidth" required type="number" min="0.1" max="1000" step="0.01" placeholder="15" />
											</label>
											<label>
												Unit
												<select name="roomUnit" defaultValue="ft">
													<option value="ft">Feet</option>
													<option value="m">Meters</option>
												</select>
											</label>
											<button className="button primary" type="submit" disabled={roomSaving}>
												{roomSaving ? 'Adding room…' : 'Add room'}
											</button>
										</form>
										<button className="text-button roomless-skip" type="button" onClick={() => goTo('account')}>
											Skip for now
										</button>
									</>
								) : (
									<div className="permission-note">
										<strong>An owner or admin needs to add the first room</strong>
										<p>You can view your account and team while you wait.</p>
										<button className="button secondary" type="button" onClick={() => goTo('account')}>
											Open account
										</button>
									</div>
								)}
							</section>
						</div>
					)}

					{screen === 'home' && hasWorkspaceContent && (
						<div className="page overview-page">
							<header className="page-head">
								<div>
									<p className="eyebrow">{demoMode ? 'Sample workspace · read-only' : activeWorkspaceName}</p>
									<h1>{room?.name ?? 'Overview'}</h1>
									<p className="page-sub">
										{demoMode
											? 'A fictional robotics club fed by live MQTT. Search the inventory and watch tags move through the room.'
											: 'See where your Hubs and tagged items were last observed.'}
									</p>
								</div>
								<div className="page-stats" aria-label="Room status">
									<span className="stat-chip">
										<strong>{workspaceItems.length}</strong> tracked
									</span>
									<span className={`stat-chip ${freshItemCount > 0 ? 'ok' : ''}`}>
										<strong>{freshItemCount}</strong> live now
									</span>
									<span className={`stat-chip ${onlineHubCount > 0 ? 'ok' : 'warn'}`}>
										<strong>
											{onlineHubCount}/{workspaceHubs.length}
										</strong>{' '}
										Hubs online
									</span>
								</div>
							</header>

							<div className="overview-grid">
								<div className="overview-main">
									<section className="panel map-panel" id="overview-map" aria-label="Room map">
										<RoomMap
											room={room}
											hubs={mapHubs}
											items={mapItems}
											labels={workspaceRoomLabels}
											estimate={mapEstimate}
											locating={!demoMode && locateState === 'searching'}
											selection={overviewSelection}
											onSelect={handleMapSelect}
											focusTarget={focusTarget}
											freshnessWindows={freshnessWindows}
											now={now}
											heightClass="tall"
											emptyState={
												demoMode ? (
													<div className="map-empty-hint">
														<strong>Waiting for the first MQTT snapshot…</strong>
														<p>Retained tags appear as soon as the WebSocket subscription is live.</p>
													</div>
												) : (
													<div className="map-empty-hint">
														<strong>No Hubs are placed in this room yet</strong>
														<p>Connect a Hub and measure its wall distances to light up this map.</p>
														<button className="button secondary" type="button" onClick={() => goTo('hubs')}>
															Set up Hubs <IconArrowRight size={15} />
														</button>
													</div>
												)
											}
										/>
									</section>

									<section className="panel detail-panel" aria-label="Selection details">
										{renderItemDetail('panel')}
									</section>
								</div>

								<section className="panel finder-panel" id="find-items" aria-label="Find an item">
									<div className="finder-search">
										<IconSearch size={17} />
										<input
											ref={finderSearchRef}
											value={query}
											onChange={(event) => setQuery(event.target.value)}
											placeholder="Search items, Hubs, or tag IDs…"
											aria-label="Search items, Hubs, or tag IDs"
											aria-keyshortcuts="/"
										/>
										{query ? (
											<button type="button" className="finder-clear" onClick={() => setQuery('')} aria-label="Clear search">
												<IconClose size={14} />
											</button>
										) : (
											<kbd className="finder-shortcut" aria-hidden="true">
												/
											</kbd>
										)}
									</div>
									<div className="finder-filter" role="group" aria-label="Filter items by observation state">
										{FINDER_FILTERS.map((filter) => (
											<button
												key={filter.id}
												type="button"
												className={finderFilter === filter.id ? 'active' : ''}
												aria-pressed={finderFilter === filter.id}
												onClick={() => setFinderFilter(filter.id)}
											>
												{filter.label}
												<b>{finderCounts[filter.id]}</b>
											</button>
										))}
									</div>
									<p className="finder-count" aria-live="polite">
										{inventoryLoading && !demoMode
											? 'Loading items…'
											: `${filteredItems.length} of ${workspaceItems.length} ${workspaceItems.length === 1 ? 'item' : 'items'}`}
									</p>
									<div className="finder-list">
										{filteredItems.map((item) => {
											const freshness = itemFreshness(item)
											const isSelected = !overviewHubId && selectedItem?.id === item.id
											return (
												<button
													type="button"
													className={`item-row ${freshness} ${isSelected ? 'selected' : ''}`}
													key={item.id}
													aria-pressed={isSelected}
													onClick={() => selectItemFromList(item)}
												>
													<span className={`item-symbol ${item.imageUrl ? 'has-image' : ''}`} aria-hidden="true">
														{item.imageUrl ? <img src={item.imageUrl} alt="" /> : (item.demo?.definition.emoji ?? item.category.charAt(0))}
													</span>
													<span className="item-row-main">
														<strong>{item.name}</strong>
														<small>{item.category}</small>
													</span>
													<span className={`item-row-state ${freshness}`}>
														<span>
															<i className="chip-dot" aria-hidden="true" />
															{freshnessLabel(freshness)}
														</span>
														<small>{lastSeenLabel(item.lastSeenAt, now)}</small>
													</span>
												</button>
											)
										})}
										{!inventoryLoading && filteredItems.length === 0 && (
											<div className="empty-state">
												<IconSearch size={20} />
												<strong>
													{query
														? `No items match “${query}”`
														: finderFilter !== 'all'
															? `No ${FINDER_FILTERS.find((filter) => filter.id === finderFilter)?.label.toLowerCase()} items`
															: 'No tagged items yet'}
												</strong>
												<p>
													{query || finderFilter !== 'all' ? 'Try another search or observation filter.' : 'Log a tag to start tracking.'}
												</p>
												{(query || finderFilter !== 'all') && (
													<button
														className="button secondary"
														type="button"
														onClick={() => {
															setQuery('')
															setFinderFilter('all')
														}}
													>
														Clear filters
													</button>
												)}
												{!demoMode && !query && finderFilter === 'all' && (
													<button className="button secondary" type="button" onClick={() => goTo('log')}>
														Log your first item
													</button>
												)}
											</div>
										)}
									</div>
								</section>
							</div>

							<div className="overview-secondary">
								<nav className="quick-row" aria-label="Quick actions">
									<button className="quick-card" type="button" onClick={() => goTo('log')}>
										<span className="quick-icon" aria-hidden="true">
											<IconTagPlus size={19} />
										</span>
										<span>
											<strong>{demoMode ? 'Inspect the scanner' : 'Log an item'}</strong>
											<small>{demoMode ? 'View current MQTT reader activity' : 'Label a new tag in this room'}</small>
										</span>
										<IconArrowRight size={17} />
									</button>
									<button className="quick-card" type="button" onClick={() => goTo('hubs')}>
										<span className="quick-icon" aria-hidden="true">
											<IconHub size={19} />
										</span>
										<span>
											<strong>Manage Hubs</strong>
											<small>{demoMode ? 'See the demo Hub and its MQTT link' : 'Placement, rooms, and map labels'}</small>
										</span>
										<IconArrowRight size={17} />
									</button>
								</nav>

								{demoMode && (
									<section className="panel activity-panel" aria-label="Live MQTT activity">
										<header className="panel-head">
											<div>
												<p className="eyebrow">Live feed</p>
												<h2>MQTT activity</h2>
											</div>
											<span className="activity-total">{demoSnapshot.messageTotal} messages this session</span>
										</header>
										<ul className="activity-list">
											{demoSnapshot.activity.slice(0, 5).map((event) => (
												<li key={event.id}>
													<span aria-hidden="true">{event.emoji}</span>
													<p>
														<strong>{event.displayName}</strong>
														<small>
															{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(
																event.seenAt,
															)}{' '}
															· {event.signalRssi} dBm · {event.retained ? 'retained history' : 'live read'}
														</small>
													</p>
												</li>
											))}
											{demoSnapshot.activity.length === 0 && (
												<li className="activity-empty">
													<span aria-hidden="true">
														<IconActivity size={16} />
													</span>
													<p>
														<strong>Waiting for MQTT messages</strong>
														<small>{demoSnapshot.connectionDetail}</small>
													</p>
												</li>
											)}
										</ul>
										<p className="activity-footnote">
											Retained messages are the broker’s memory of each tag’s newest read; live reads arrive while the mock scanner runs.
											Public prototype namespace — never written to the real Neemo inventory.
										</p>
									</section>
								)}
							</div>
						</div>
					)}

					{screen === 'log' &&
						hasWorkspaceContent &&
						(demoMode ? (
							<DemoScannerMonitor snapshot={demoSnapshot} onOpenOverview={() => goTo('home')} />
						) : (
							<div className="page log-page">
								<header className="page-head">
									<div>
										<p className="eyebrow">Add a tag</p>
										<h1>Log a new item</h1>
										<p className="page-sub">Bring one loose tag close to a Hub, select it, and give it a useful name.</p>
									</div>
								</header>
								<div className="step-strip" aria-label="Item setup steps">
									<span className={scanState !== 'idle' ? 'done' : 'active'}>
										<b>1</b> Scan tags
									</span>
									<i aria-hidden="true" />
									<span className={selectedTag ? 'done' : scanState === 'ready' ? 'active' : ''}>
										<b>2</b> Choose ID
									</span>
									<i aria-hidden="true" />
									<span className={selectedTag ? 'active' : ''}>
										<b>3</b> Label item
									</span>
								</div>
								<div className="log-grid">
									<section className="panel scanner-panel">
										<div className={`scanner-visual ${scanState}`} aria-hidden="true">
											<span className="scanner-hub">
												<IconHub size={22} />
											</span>
											<i className="scan-ring r1" />
											<i className="scan-ring r2" />
											<i className="scan-ring r3" />
										</div>
										<p className="eyebrow">Live Hub readings</p>
										<h2>
											{selectedDiscoveredTag?.nearestHubName ??
												discoveredTags[0]?.nearestHubName ??
												(scanReadyHubCount ? 'Hub network ready' : 'No measured Hubs ready')}
										</h2>
										<p role="status">
											{scanState === 'idle'
												? 'Ready to listen for a nearby tag.'
												: scanState === 'scanning'
													? 'Listening for new EPCs…'
													: `${discoveredTags.length} unlabelled tags found.`}
										</p>
										<button
											className="button secondary wide"
											type="button"
											onClick={() => void startTagScan()}
											disabled={scanState === 'scanning' || scanReadyHubCount === 0}
										>
											{scanState === 'idle' ? 'Scan nearby tags' : scanState === 'scanning' ? 'Scanning…' : 'Scan again'}
										</button>
										{scanReadyHubCount === 0 && (
											<p className="scanner-hint">
												A measured, online Hub is needed first.{' '}
												<button className="text-button" type="button" onClick={() => goTo('hubs')}>
													Set up Hubs
												</button>
											</p>
										)}
									</section>
									<section className="panel label-panel">
										<header className="panel-head">
											<div>
												<p className="eyebrow">Unlabelled tags</p>
												<h2>Choose a tag ID</h2>
											</div>
											{scanState === 'ready' && (
												<span className="live-label">
													<i className="chip-dot ok" aria-hidden="true" /> Fresh scan
												</span>
											)}
										</header>
										{scanState !== 'ready' ? (
											<div className="empty-state tag-empty">
												<IconBroadcast size={20} />
												<strong>No scan yet</strong>
												<p>Start a scan with the loose tag close to a Hub.</p>
											</div>
										) : discoveredTags.length === 0 ? (
											<div className="empty-state tag-empty">
												<IconBroadcast size={20} />
												<strong>No unlabelled tags detected</strong>
												<p>Keep the tag close to an online Hub, then scan again.</p>
											</div>
										) : (
											<div className="tag-list">
												{discoveredTags.map((tag) => (
													<button
														type="button"
														className={selectedTag === tag.epc ? 'selected' : ''}
														key={tag.epc}
														aria-pressed={selectedTag === tag.epc}
														onClick={() => setSelectedTag(tag.epc)}
													>
														<span className="tag-icon" aria-hidden="true">
															RF
														</span>
														<span>
															<strong>{tag.epc}</strong>
															<small>
																{tag.nearestHubName} · signal {tag.strongestRssi.toFixed(1)} dBm · {tag.hubCount}{' '}
																{tag.hubCount === 1 ? 'Hub' : 'Hubs'}
															</small>
														</span>
														<b>{selectedTag === tag.epc ? <IconCheck size={16} /> : 'Select'}</b>
													</button>
												))}
											</div>
										)}
										<form className="stack-form item-form" onSubmit={addItem}>
											<label>
												Item name
												<input
													required
													disabled={!selectedTag}
													value={itemForm.name}
													onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
													placeholder="e.g. 5 mm Allen key set"
												/>
											</label>
											<div className="form-grid">
												<label>
													Category
													<select
														disabled={!selectedTag}
														value={itemForm.category}
														onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })}
													>
														{ITEM_CATEGORIES.map((category) => (
															<option key={category}>{category}</option>
														))}
													</select>
												</label>
												<label>
													Home Hub
													<select
														disabled={!selectedTag}
														value={itemForm.homeHubId}
														onChange={(event) => setItemForm({ ...itemForm, homeHubId: event.target.value })}
													>
														<option value="">No home Hub</option>
														{realHubs.map((hub) => (
															<option key={hub.id} value={hub.id}>
																{hub.name}
															</option>
														))}
													</select>
												</label>
											</div>
											<button className="button primary wide" disabled={!selectedTag || !itemForm.name.trim() || itemSaving} type="submit">
												{itemSaving ? 'Saving item…' : 'Save and track item'} <IconArrowRight size={16} />
											</button>
										</form>
									</section>
								</div>
							</div>
						))}

					{screen === 'hubs' && hasWorkspaceContent && (
						<div className="page hubs-page">
							<header className="page-head">
								<div>
									<p className="eyebrow">{demoMode ? 'Live demo hardware' : 'Room setup'}</p>
									<h1>Hubs</h1>
									<p className="page-sub">
										{demoMode
											? 'Scanner health comes from its newest publish. It is marked offline after 30 seconds without a message.'
											: team
												? `${room ? `Managing real Hubs in ${room.name}.` : 'Create a named room before adding your first Hub.'} Scanners publish directly to this team’s cloud MQTT namespace.`
												: 'Create or join a team before connecting a cloud scanner.'}
									</p>
								</div>
								<div className="hub-page-actions">
									<span className="stat-chip">
										<i className={`chip-dot ${onlineHubCount > 0 ? 'ok' : 'off'}`} aria-hidden="true" /> {onlineHubCount} online
									</span>
									<button
										className="button secondary"
										type="button"
										onClick={() => void refreshHubs(true)}
										disabled={demoMode || hubLoading}
									>
										<IconRefresh size={15} /> {demoMode ? 'MQTT managed' : hubLoading ? 'Refreshing…' : 'Refresh Hubs'}
									</button>
								</div>
							</header>
							<div className="hubs-grid">
								<section className="panel hub-list-panel">
									<header className="panel-head">
										<div>
											<p className="eyebrow">Hub list</p>
											<h2>
												{workspaceHubs.length} {workspaceHubs.length === 1 ? 'Hub' : 'Hubs'}
											</h2>
										</div>
										{!demoMode && hubLoading && (
											<span className="hub-list-refreshing" role="status">
												Refreshing…
											</span>
										)}
									</header>
									<div className="hub-list" aria-busy={!demoMode && hubLoading}>
										{workspaceHubs.map((hub) => (
											<button
												className={`hub-row ${activeSelectedHubId === hub.id ? 'selected' : ''}`}
												type="button"
												key={hub.id}
												aria-pressed={activeSelectedHubId === hub.id}
												onClick={() => {
													setSelectedHubId(hub.id)
													setPlacementDraft(null)
												}}
											>
												<span className="hub-row-icon" aria-hidden="true">
													<IconHub size={18} />
												</span>
												<span className="hub-row-main">
													<strong>{hub.name}</strong>
													<small>
														{demoMode
															? `Mock scanner · ${hubStatusText(hub.status)}`
															: `Neemo-${hub.shortDeviceId} · ${hubStateLabel(hub.connectionState)}`}
													</small>
													<small>
														{hub.status === 'online'
															? `Active · seen ${lastSeenLabel(hub.lastSeenAt, now)}`
															: `Last seen ${lastSeenLabel(hub.lastSeenAt, now)}`}
														{!hub.placement && ' · not on map yet'}
													</small>
													{hub.errorCode && <small className="hub-attention">{hub.errorCode.replaceAll('_', ' ').toLowerCase()}</small>}
												</span>
												<span className={`hub-status-badge ${hub.status}`}>{hubStatusText(hub.status)}</span>
											</button>
										))}
										{workspaceHubs.length === 0 && (
											<div className="empty-state hub-empty">
												<IconHub size={20} />
												<strong>No Hubs connected</strong>
												<p>{team ? 'Power a configured scanner to discover it here.' : 'Create or join a team to connect a scanner.'}</p>
											</div>
										)}
									</div>
									{demoMode ? (
										<div className="demo-readonly-note">
											<IconBroadcast size={16} />
											<div>
												<strong>Controlled by the mock scanner</strong>
												<p>
													An MQTT browser connection does not make this scanner online. It is online only while messages arrive and offline
													after 30 seconds without a publish.
												</p>
											</div>
										</div>
									) : canManageSetup && room && team ? (
										showHubPairing ? (
											<HubPairingFlow
												roomId={room.id}
												roomName={room.name}
												teamId={team.id}
												mqttSnapshot={teamMqttSnapshot}
												onCancel={() => setShowHubPairing(false)}
												onConnected={() => refreshHubs()}
											/>
										) : (
											<section className="pair-form native-pair-cta">
												<div>
													<p className="eyebrow">Team cloud MQTT</p>
													<h2>Connect a scanner</h2>
												</div>
												<p className="selected-room-note">
													Adding to <strong>{room.name}</strong>
												</p>
												<p>Configure the firmware with this team’s ID. Neemo will discover the scanner from its first heartbeat.</p>
												<button className="button primary" type="button" onClick={() => setShowHubPairing(true)}>
													Connect cloud scanner <IconArrowRight size={16} />
												</button>
												<small>Publishes directly to neemo.xy.icu over MQTT.</small>
											</section>
										)
									) : (
										<div className="permission-note">
											<strong>{!team ? 'Team required' : room ? 'View-only Hub access' : 'Create a room first'}</strong>
											<p>
												{!team
													? 'Create or join a team from Account, then use that Team ID in the scanner firmware.'
													: room
														? 'Only the team owner or an admin can connect and edit Hubs.'
														: canManageSetup
															? 'Use the room tools beside the map to add one.'
															: 'Ask a team owner or admin to add a room.'}
											</p>
										</div>
									)}
									<section className="room-mini-list" aria-labelledby="hub-room-list-title">
										<header className="panel-head">
											<div>
												<p className="eyebrow">Room list</p>
												<h2 id="hub-room-list-title">Your rooms</h2>
											</div>
											<span className="panel-count">{workspaceRooms.length}</span>
										</header>
										{workspaceRooms.length > 0 ? (
											<div className="room-mini-items">
												{workspaceRooms.map((candidate) => {
													const isActive = candidate.id === (demoMode ? DEMO_ROOM_ID : activeRoomId)
													return (
														<button
															type="button"
															key={candidate.id}
															className={isActive ? 'selected' : ''}
															aria-pressed={isActive}
															disabled={demoMode}
															onClick={() => {
																setActiveRoomId(candidate.id)
																setQuery('')
																setFinderFilter('all')
															}}
														>
															<span className="room-mini-icon" aria-hidden="true">
																<IconBox size={16} />
															</span>
															<span>
																<strong>{candidate.name}</strong>
																<small>
																	{candidate.length} × {candidate.width} {candidate.unit}
																</small>
															</span>
															<b>{isActive ? 'Selected' : 'View'}</b>
														</button>
													)
												})}
											</div>
										) : (
											<p className="room-mini-empty">No rooms have been added yet.</p>
										)}
									</section>
								</section>

								<section className="panel map-edit-panel">
									<header className="panel-head">
										<div>
											<p className="eyebrow">Measured placement</p>
											<h2>{room?.name ?? 'Room'} map</h2>
										</div>
										<span className="edit-tip">{room ? `${room.length} × ${room.width} ${room.unit}` : 'Measure room first'}</span>
									</header>
									{room ? (
										<RoomMap
											room={room}
											hubs={mapHubs}
											labels={workspaceRoomLabels}
											selection={activeSelectedHubId ? { kind: 'hub', id: activeSelectedHubId } : null}
											onSelect={(selection) => {
												if (selection?.kind === 'hub') {
													setSelectedHubId(selection.id)
													setPlacementDraft(null)
												}
											}}
											placementHubId={!demoMode && canManageSetup && selectedHub ? selectedHub.id : undefined}
											onPlaceHub={!demoMode && canManageSetup && selectedHub ? applyMapPlacement : undefined}
											freshnessWindows={freshnessWindows}
											now={now}
											heightClass="medium"
											emptyState={
												<div className="map-empty-hint">
													<strong>No Hubs on this map yet</strong>
													<p>Select a connected Hub and measure it from each wall — or click the map once a Hub is selected.</p>
												</div>
											}
										/>
									) : (
										<div className="empty-state room-empty">
											<IconBox size={20} />
											<strong>No rooms yet</strong>
											<p>Rooms keep their own Hubs, items, measurements, and map labels.</p>
										</div>
									)}

									{!demoMode && selectedHub && canManageSetup && room && (
										<form className="hub-placement-form" key={`placement-${selectedHub.id}`} onSubmit={saveHubPlacement}>
											<header className="panel-head">
												<div>
													<p className="eyebrow">Place {selectedHub.name}</p>
													<h2>Measure from each wall</h2>
												</div>
												<span className="edit-tip">{room?.unit === 'm' ? 'Meters' : 'Feet'}</span>
											</header>
											<p>
												Measure from the center of the Hub — opposite sides should add up to the room size. Clicking the map fills these
												fields for you.
											</p>
											<div className="wall-measure-grid">
												<label>
													Left wall
													<input
														name="leftDistance"
														required
														type="number"
														min="0"
														step="0.01"
														value={placementDraft?.left ?? selectedHub.placement?.left ?? ''}
														onChange={(event) =>
															setPlacementDraft((current) => ({
																left: event.target.value,
																right: current?.right ?? String(selectedHub.placement?.right ?? ''),
																top: current?.top ?? String(selectedHub.placement?.top ?? ''),
																bottom: current?.bottom ?? String(selectedHub.placement?.bottom ?? ''),
															}))
														}
													/>
												</label>
												<label>
													Right wall
													<input
														name="rightDistance"
														required
														type="number"
														min="0"
														step="0.01"
														value={placementDraft?.right ?? selectedHub.placement?.right ?? ''}
														onChange={(event) =>
															setPlacementDraft((current) => ({
																left: current?.left ?? String(selectedHub.placement?.left ?? ''),
																right: event.target.value,
																top: current?.top ?? String(selectedHub.placement?.top ?? ''),
																bottom: current?.bottom ?? String(selectedHub.placement?.bottom ?? ''),
															}))
														}
													/>
												</label>
												<label>
													Front wall
													<input
														name="topDistance"
														required
														type="number"
														min="0"
														step="0.01"
														value={placementDraft?.top ?? selectedHub.placement?.top ?? ''}
														onChange={(event) =>
															setPlacementDraft((current) => ({
																left: current?.left ?? String(selectedHub.placement?.left ?? ''),
																right: current?.right ?? String(selectedHub.placement?.right ?? ''),
																top: event.target.value,
																bottom: current?.bottom ?? String(selectedHub.placement?.bottom ?? ''),
															}))
														}
													/>
												</label>
												<label>
													Back wall
													<input
														name="bottomDistance"
														required
														type="number"
														min="0"
														step="0.01"
														value={placementDraft?.bottom ?? selectedHub.placement?.bottom ?? ''}
														onChange={(event) =>
															setPlacementDraft((current) => ({
																left: current?.left ?? String(selectedHub.placement?.left ?? ''),
																right: current?.right ?? String(selectedHub.placement?.right ?? ''),
																top: current?.top ?? String(selectedHub.placement?.top ?? ''),
																bottom: event.target.value,
															}))
														}
													/>
												</label>
											</div>
											<div className="editor-actions">
												{placementDraft && (
													<button className="button ghost" type="button" onClick={() => setPlacementDraft(null)}>
														Reset
													</button>
												)}
												<button className="button primary" type="submit">
													{selectedHub.placement ? 'Update Hub position' : 'Place Hub on map'}
												</button>
											</div>
										</form>
									)}

									{!demoMode && selectedHub && canManageSetup && (
										<details className="room-tool">
											<summary>Hub name and room</summary>
											<form className="hub-rename-form" key={selectedHub.id} onSubmit={renameHub}>
												<label>
													Hub name
													<input name="hubName" defaultValue={selectedHub.name} maxLength={60} required />
												</label>
												<label>
													Room
													<select name="hubRoomId" defaultValue={activeRoomId}>
														{rooms.map((candidate) => (
															<option key={candidate.id} value={candidate.id}>
																{candidate.name}
															</option>
														))}
													</select>
												</label>
												<button className="button secondary" type="submit">
													Save Hub settings
												</button>
											</form>
											<button className="danger-text disconnect-hub" type="button" onClick={() => void disconnectHub()}>
												Disconnect this Hub
											</button>
										</details>
									)}

									{room && (
										<details className="room-tool" open={demoMode}>
											<summary>Map labels · {workspaceRoomLabels.length}</summary>
											<div className="map-label-manager">
												<p>
													<span className="eyebrow">Add a place to the map</span>
													Name a useful area, then measure its center from the left and front walls ({room.unit === 'm' ? 'meters' : 'feet'}
													).
												</p>
												{!demoMode && canManageSetup && (
													<form className="map-label-form" onSubmit={addRoomLabel}>
														<label>
															Place name
															<input name="labelName" required maxLength={50} placeholder="e.g. Workbench" />
														</label>
														<label>
															From left wall
															<input name="labelLeft" required type="number" min="0" max={room.length} step="0.01" />
														</label>
														<label>
															From front wall
															<input name="labelFront" required type="number" min="0" max={room.width} step="0.01" />
														</label>
														<button className="button secondary" disabled={labelSaving} type="submit">
															{labelSaving ? 'Adding…' : 'Add label'}
														</button>
													</form>
												)}
												{workspaceRoomLabels.length > 0 && (
													<div className="map-label-list">
														{workspaceRoomLabels.map((label) => (
															<span key={label.id}>
																<strong>{label.name}</strong>
																<small>
																	{label.leftDistance} from left · {label.frontDistance} from front
																</small>
																{!demoMode && canManageSetup && (
																	<button type="button" aria-label={`Remove ${label.name}`} onClick={() => void removeRoomLabel(label)}>
																		<IconClose size={13} />
																	</button>
																)}
															</span>
														))}
													</div>
												)}
											</div>
										</details>
									)}

									{!demoMode && canManageSetup && room && (
										<details className="room-tool">
											<summary>Edit room measurements</summary>
											<form className="room-edit-form" onSubmit={saveRoom}>
												<input type="hidden" name="roomId" value={room.id} />
												<label>
													Room name
													<input name="roomName" required defaultValue={room?.name} />
												</label>
												<label>
													Length
													<input name="roomLength" required type="number" min="0.1" max="1000" step="0.01" defaultValue={room?.length} />
												</label>
												<label>
													Width
													<input name="roomWidth" required type="number" min="0.1" max="1000" step="0.01" defaultValue={room?.width} />
												</label>
												<label>
													Unit
													<select name="roomUnit" defaultValue={room?.unit ?? 'ft'}>
														<option value="ft">Feet</option>
														<option value="m">Meters</option>
													</select>
												</label>
												<button className="button secondary" type="submit" disabled={roomSaving}>
													Save room
												</button>
											</form>
											<button className="danger-text" type="button" disabled={roomSaving} onClick={() => void removeRoom()}>
												Remove this empty room
											</button>
										</details>
									)}

									{!demoMode && canManageSetup && (
										<details className="room-tool" open={!room}>
											<summary>{room ? 'Add another room' : 'Create your first room'}</summary>
											<form className="room-edit-form" onSubmit={createRoom}>
												<label>
													Room name
													<input name="roomName" required maxLength={60} placeholder="e.g. Tool Area" />
												</label>
												<label>
													Length
													<input name="roomLength" required type="number" min="0.1" max="1000" step="0.01" placeholder="20" />
												</label>
												<label>
													Width
													<input name="roomWidth" required type="number" min="0.1" max="1000" step="0.01" placeholder="15" />
												</label>
												<label>
													Unit
													<select name="roomUnit" defaultValue="ft">
														<option value="ft">Feet</option>
														<option value="m">Meters</option>
													</select>
												</label>
												<button className="button primary" type="submit" disabled={roomSaving}>
													{roomSaving ? 'Saving…' : 'Create room'}
												</button>
											</form>
										</details>
									)}

									<div className="calibration-card">
										<span className="calibration-icon" aria-hidden="true">
											<IconBroadcast size={18} />
										</span>
										<div>
											<strong>{scanReadyHubCount > 0 ? 'Hub scanning is ready' : 'A measured, connected Hub is needed'}</strong>
											<p>Neemo checks nearby tags and shows their latest location using the Hubs in the selected room.</p>
										</div>
										<button className="button secondary" type="button" onClick={() => goTo('log')} disabled={scanReadyHubCount === 0}>
											Scan for tags
										</button>
									</div>
								</section>
							</div>
						</div>
					)}

					{screen === 'account' && (
						<div className="page account-page">
							<section className="profile-hero">
								<span className="profile-avatar" aria-hidden="true">
									{initials}
								</span>
								<div>
									<p className="eyebrow">Account and team</p>
									<h1>{profile.name}</h1>
									<p className="page-sub">{team ? `${roleLabel(team.role)} · ${team.name}` : personalWorkspaceName}</p>
								</div>
							</section>
							<div className="account-grid">
								<section className="panel profile-form-panel">
									<header className="panel-head">
										<div>
											<p className="eyebrow">Account settings</p>
											<h2>Your Neemo name</h2>
										</div>
									</header>
									<form className="stack-form" onSubmit={saveAccountSettings}>
										<label>
											Display name
											<input name="displayName" required maxLength={80} defaultValue={profile.name} />
										</label>
										{!team && (
											<label>
												Workspace name
												<input name="workspaceName" required maxLength={80} defaultValue={personalWorkspaceName} />
											</label>
										)}
										<label>
											Device profile
											<input value={profile.email} readOnly aria-describedby="device-profile-note" />
										</label>
										<button className="button secondary wide" disabled={teamSaving} type="submit">
											Save account settings
										</button>
									</form>
									<p className="account-note" id="device-profile-note">
										Your display name is how teammates see you. This device profile keeps your Neemo workspace separate without requiring
										sign-in.
									</p>
								</section>
								<section className="panel workspace-card">
									<p className="eyebrow">Your workspace</p>
									<h2>{workspaceName}</h2>
									<dl>
										<div>
											<dt>Rooms</dt>
											<dd>{rooms.length}</dd>
										</div>
										<div>
											<dt>Active room</dt>
											<dd>{room?.name ?? 'None'}</dd>
										</div>
										<div>
											<dt>Hubs in room</dt>
											<dd>{hubs.length}</dd>
										</div>
										<div>
											<dt>Items in room</dt>
											<dd>{items.length}</dd>
										</div>
										<div>
											<dt>Access</dt>
											<dd>{team ? roleLabel(team.role) : 'Owner'}</dd>
										</div>
									</dl>
								</section>
							</div>
							<section className="account-team-heading">
								<p className="eyebrow">Team workspace</p>
								<h2>{team ? 'Manage your team' : 'Create or join a team'}</h2>
								<p>
									{team
										? 'Everyone on this team sees the same rooms, Hubs, and tagged items.'
										: 'Create a named shared workspace, or enter an invite code from another Neemo user.'}
								</p>
							</section>
							{!teamLoading && !team && (
								<div className="team-grid">
									<section className="panel invite-card">
										<p className="eyebrow">Start a workspace</p>
										<h2>Create a team</h2>
										<form className="stack-form" onSubmit={createTeam}>
											<label>
												Team name
												<input
													value={teamName}
													onChange={(event) => setTeamName(event.target.value)}
													maxLength={80}
													placeholder="e.g. Northside Workshop"
												/>
											</label>
											<button className="button primary wide" disabled={!teamName.trim() || teamSaving} type="submit">
												Create team <IconArrowRight size={16} />
											</button>
										</form>
									</section>
									<section className="panel join-card">
										<p className="eyebrow">Have an invite?</p>
										<h2>Join a team</h2>
										<form className="stack-form" onSubmit={joinTeam}>
											<label>
												Eight-character invite code
												<input
													value={teamCode}
													onChange={(event) => setTeamCode(event.target.value.toUpperCase())}
													maxLength={9}
													autoCapitalize="characters"
													placeholder="ABCD EFGH"
												/>
											</label>
											<button className="button secondary wide" disabled={!teamCode.trim() || teamSaving} type="submit">
												Join workspace <IconArrowRight size={16} />
											</button>
										</form>
									</section>
								</div>
							)}
							{team && (
								<>
									<div className="team-grid">
										<section className="panel invite-card">
											<p className="eyebrow">{team.name}</p>
											<h2>Invite code</h2>
											<div className="team-code">
												{team.inviteCode.slice(0, 4)}&nbsp;{team.inviteCode.slice(4)}
											</div>
											<p>Share this code with another signed-in Neemo user.</p>
											<button
												className="button secondary wide"
												type="button"
												onClick={() => {
													void navigator.clipboard.writeText(team.inviteCode)
													setNotice('Invite code copied.')
												}}
											>
												Copy invite code
											</button>
											{canManageTeamSettings && (
												<button
													className="text-button rotate-code"
													disabled={teamSaving}
													type="button"
													onClick={() => void rotateTeamCode()}
												>
													Create a new code
												</button>
											)}
										</section>
										<section className="panel join-card">
											<p className="eyebrow">Team settings</p>
											<h2>{team.name}</h2>
											{canManageTeamSettings && (
												<form className="stack-form" onSubmit={renameTeam}>
													<label>
														Team name
														<input name="teamName" defaultValue={team.name} maxLength={80} required />
													</label>
													<button className="button secondary wide" disabled={teamSaving} type="submit">
														Save team name
													</button>
												</form>
											)}
											<button className="danger-text leave-team" disabled={teamSaving} type="button" onClick={() => void leaveTeam()}>
												{team.role === 'owner' ? 'Delete team' : 'Leave team'}
											</button>
										</section>
									</div>
									<section className="panel team-rooms-panel">
										<header className="panel-head">
											<div>
												<p className="eyebrow">Team rooms</p>
												<h2>
													{rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
												</h2>
											</div>
											<span>{canManageTeamSettings ? 'Owner/Admin controls' : 'Member access'}</span>
										</header>
										{rooms.length > 0 ? (
											<div className="team-room-list">
												{rooms.map((candidate) => (
													<article className={candidate.id === activeRoomId ? 'selected' : ''} key={candidate.id}>
														<button
															className="team-room-select"
															type="button"
															onClick={() => {
																setActiveRoomId(candidate.id)
																setQuery('')
																setFinderFilter('all')
															}}
														>
															<span aria-hidden="true">
																<IconBox size={16} />
															</span>
															<div>
																<strong>{candidate.name}</strong>
																<small>
																	{candidate.length} × {candidate.width} {candidate.unit}
																</small>
															</div>
															<b>{candidate.id === activeRoomId ? 'Selected' : 'View'}</b>
														</button>
														{canManageSetup && (
															<details>
																<summary>Edit room</summary>
																<form className="account-room-form" onSubmit={saveRoom}>
																	<input type="hidden" name="roomId" value={candidate.id} />
																	<label>
																		Room name
																		<input name="roomName" required maxLength={60} defaultValue={candidate.name} />
																	</label>
																	<label>
																		Length
																		<input
																			name="roomLength"
																			required
																			type="number"
																			min="0.1"
																			max="1000"
																			step="0.01"
																			defaultValue={candidate.length}
																		/>
																	</label>
																	<label>
																		Width
																		<input
																			name="roomWidth"
																			required
																			type="number"
																			min="0.1"
																			max="1000"
																			step="0.01"
																			defaultValue={candidate.width}
																		/>
																	</label>
																	<label>
																		Unit
																		<select name="roomUnit" defaultValue={candidate.unit}>
																			<option value="ft">Feet</option>
																			<option value="m">Meters</option>
																		</select>
																	</label>
																	<button className="button secondary" disabled={roomSaving} type="submit">
																		Save room
																	</button>
																</form>
																<button
																	className="danger-text"
																	disabled={roomSaving}
																	type="button"
																	onClick={() => void removeRoom(candidate)}
																>
																	Remove empty room
																</button>
															</details>
														)}
													</article>
												))}
											</div>
										) : (
											<div className="empty-state compact-empty">
												<IconBox size={20} />
												<strong>No rooms yet</strong>
												<p>An owner or admin can add the first room below.</p>
											</div>
										)}
										{canManageSetup && (
											<details className="account-create-room" open={rooms.length === 0}>
												<summary>Add a room</summary>
												<form className="account-room-form" onSubmit={createRoom}>
													<label>
														Room name
														<input name="roomName" required maxLength={60} placeholder="e.g. Tool Area" />
													</label>
													<label>
														Length
														<input name="roomLength" required type="number" min="0.1" max="1000" step="0.01" placeholder="20" />
													</label>
													<label>
														Width
														<input name="roomWidth" required type="number" min="0.1" max="1000" step="0.01" placeholder="15" />
													</label>
													<label>
														Unit
														<select name="roomUnit" defaultValue="ft">
															<option value="ft">Feet</option>
															<option value="m">Meters</option>
														</select>
													</label>
													<button className="button primary" disabled={roomSaving} type="submit">
														{roomSaving ? 'Adding…' : 'Add room'}
													</button>
												</form>
											</details>
										)}
										{room && (
											<div className="account-room-items">
												<div>
													<p className="eyebrow">Items in {room.name}</p>
													<h3>
														{items.length} logged {items.length === 1 ? 'item' : 'items'}
													</h3>
												</div>
												{items.length > 0 ? (
													items.map((item) => (
														<div className="account-item-row" key={item.id}>
															<span className={`item-symbol ${item.imageUrl ? 'has-image' : ''}`} aria-hidden="true">
																{item.imageUrl ? <img src={item.imageUrl} alt="" /> : item.category.charAt(0)}
															</span>
															<div>
																<strong>{item.name}</strong>
																<small>{item.category}</small>
															</div>
															<button
																type="button"
																onClick={() => {
																	openItemEditor(item)
																	goTo('home')
																	window.setTimeout(
																		() => document.getElementById('find-items')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
																		0,
																	)
																}}
															>
																Edit name/image
															</button>
															{canManageSetup && (
																<button className="danger-text" type="button" disabled={itemMutating} onClick={() => void removeItem(item)}>
																	Remove
																</button>
															)}
														</div>
													))
												) : (
													<p className="account-room-items-empty">No items have been logged in this room yet.</p>
												)}
											</div>
										)}
									</section>
									<section className="panel members-panel">
										<header className="panel-head">
											<div>
												<p className="eyebrow">Team members</p>
												<h2>
													{teamMembers.length} {teamMembers.length === 1 ? 'member' : 'members'}
												</h2>
											</div>
											<span>{teamMembers.filter((member) => member.role === 'admin').length} admins</span>
										</header>
										{teamMembers.map((member) => {
											const memberInitials = initialsOf(member.name, 'N')
											const isYou = member.email.toLowerCase() === profile.email.toLowerCase()
											return (
												<div className="member-row" key={member.id}>
													<span aria-hidden="true">{memberInitials}</span>
													<div>
														<strong>{member.name}</strong>
														<small>
															{member.email} · {roleLabel(member.role)}
														</small>
													</div>
													{isYou ? (
														<b>You</b>
													) : (
														<div className="member-actions">
															{team.role === 'owner' && member.role === 'member' && (
																<button type="button" disabled={teamSaving} onClick={() => void setMemberRole(member, 'admin')}>
																	Make admin
																</button>
															)}
															{team.role === 'owner' && member.role === 'admin' && (
																<button type="button" disabled={teamSaving} onClick={() => void setMemberRole(member, 'member')}>
																	Remove admin
																</button>
															)}
															{(team.role === 'owner' || team.role === 'admin') && member.role !== 'owner' && (
																<button
																	className="danger-text"
																	disabled={teamSaving}
																	type="button"
																	onClick={() => void removeTeamMember(member)}
																>
																	Remove
																</button>
															)}
														</div>
													)}
												</div>
											)
										})}
									</section>
								</>
							)}
						</div>
					)}
				</main>
			</div>

			{drawerOpen && (
				<>
					<div className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
					<section
						className="item-drawer"
						role="dialog"
						aria-modal="true"
						aria-label={overviewSelectedHub ? overviewSelectedHub.name : (selectedItem?.name ?? 'Item details')}
					>
						<header className="drawer-grip-row">
							<span className="drawer-grip" aria-hidden="true" />
							<button
								ref={drawerCloseRef}
								type="button"
								className="drawer-close"
								onClick={() => setDrawerOpen(false)}
								aria-label="Close details"
							>
								<IconClose size={17} />
							</button>
						</header>
						{renderItemDetail('drawer')}
					</section>
				</>
			)}

			<nav className="mobile-nav" aria-label="Mobile navigation">
				{navItems.map((item) => (
					<button
						type="button"
						key={item.id}
						className={screen === item.id ? 'active' : ''}
						aria-current={screen === item.id ? 'page' : undefined}
						onClick={() => goTo(item.id)}
					>
						<span aria-hidden="true">{item.icon({ size: 20 })}</span>
						{demoMode && item.id === 'log' ? 'Scanner' : item.label.replace(' item', '')}
					</button>
				))}
			</nav>
		</div>
	)
}

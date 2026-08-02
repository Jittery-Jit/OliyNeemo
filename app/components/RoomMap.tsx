'use client'

// The interactive indoor room map. One component renders every map in Neemo:
// the overview workspace, the locate view, and the Hubs placement editor.
//
// Coordinates: hubs/items/estimates use room percent (0–100 on both axes);
// labels use measured wall distances in room units. The visual "stage" keeps
// the room's true aspect ratio and a viewport transform provides pan/zoom.
// Marker chips counter-scale so they stay a constant screen size.

import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type WheelEvent as ReactWheelEvent,
} from 'react'
import { freshnessLabel, lastSeenLabel, tagFreshness, type Freshness, type FreshnessWindows } from '../lib/freshness'
import {
	centerOnRoomPoint,
	clampViewport,
	containerPointToRoomPercent,
	estimateRadiusPercent,
	FIT_VIEWPORT,
	fitStageSize,
	MAP_ZOOM_STEP,
	MAX_MAP_SCALE,
	MIN_MAP_SCALE,
	panBy,
	pointerDistance,
	pointerMidpoint,
	ringPosition,
	zoomAt,
	type MapViewport,
	type Point,
	type Size,
} from '../lib/map-viewport'
import { IconClose, IconFit, IconHelp, IconMinus, IconPlus } from './icons'

export type MapRoom = Readonly<{ name: string; length: number; width: number; unit: 'ft' | 'm' }>

export type MapHub = Readonly<{
	id: string
	name: string
	x: number
	y: number
	status: 'online' | 'delayed' | 'offline' | 'setting-up' | 'needs-attention'
}>

export type MapItem = Readonly<{
	id: string
	name: string
	hubId: string
	hubName: string
	lastSeenAt: number | null
	freshness?: Freshness
	emoji?: string
	highlighted?: boolean
	dimmed?: boolean
}>

export type MapLabel = Readonly<{ id: string; name: string; leftDistance: number; frontDistance: number }>

export type MapEstimate = Readonly<{
	x: number
	y: number
	radiusMeters: number
	confidence: 'low' | 'medium' | 'high'
	zone: string
}>

export type MapSelection = Readonly<{ kind: 'hub' | 'item'; id: string }> | null

type RoomMapData = Readonly<{
	room: MapRoom | null
	hubs: readonly MapHub[]
	items?: readonly MapItem[]
	labels?: readonly MapLabel[]
	estimate?: MapEstimate | null
	locating?: boolean
	selection?: MapSelection
	// Placement mode: clicking inside the room reports a position for this hub.
	placementHubId?: string
	focusTarget?: Readonly<{ kind: 'hub' | 'item'; id: string; token: number }> | null
	freshnessWindows: FreshnessWindows
	now: number
	heightClass?: 'tall' | 'medium' | 'compact'
	emptyState?: ReactNode
	interactive?: boolean
}>

type RoomMapHandlers = Readonly<{
	onSelect?: (selection: MapSelection) => void
	onPlaceHub?: (point: Point) => void
}>

export type RoomMapProps = RoomMapData & RoomMapHandlers

type PointerRecord = { id: number; point: Point; type: string }

const LABEL_ZOOM_THRESHOLD = 1.55

function statusWord(status: MapHub['status']): string {
	if (status === 'online') return 'online'
	if (status === 'delayed') return 'delayed'
	if (status === 'setting-up') return 'setting up'
	if (status === 'needs-attention') return 'needs attention'
	return 'offline'
}

export default function RoomMap({
	room,
	hubs,
	items = [],
	labels = [],
	estimate = null,
	locating = false,
	selection = null,
	onSelect,
	placementHubId,
	onPlaceHub,
	focusTarget = null,
	freshnessWindows,
	now,
	heightClass = 'tall',
	emptyState,
	interactive = true,
}: RoomMapProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })
	const [storedViewport, setStoredViewport] = useState<MapViewport>(FIT_VIEWPORT)
	const [animated, setAnimated] = useState(false)
	const [legendOpen, setLegendOpen] = useState(false)
	const [dragging, setDragging] = useState(false)
	const [handledFocusToken, setHandledFocusToken] = useState<number | null>(null)
	const pointers = useRef<Map<number, PointerRecord>>(new Map())
	const pinchStart = useRef<{ distance: number; scale: number } | null>(null)
	const movedSincePress = useRef(0)
	const legendId = useId()
	const liveRegionRef = useRef<HTMLParagraphElement>(null)

	const aspect = room ? room.length / room.width : 1
	const stage = useMemo(() => fitStageSize(containerSize, aspect, 0), [containerSize, aspect])
	// The clamped viewport is derived at render time, so a container resize can
	// never leave the room off screen.
	const viewport = clampViewport(storedViewport, containerSize, stage)
	const zoomedIn = viewport.scale > 1.04

	useEffect(() => {
		const element = containerRef.current
		if (!element) return
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (!entry) return
			const box = entry.contentRect
			setContainerSize((current) =>
				Math.abs(current.width - box.width) < 1 && Math.abs(current.height - box.height) < 1
					? current
					: { width: box.width, height: box.height },
			)
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	const applyViewport = useCallback(
		(next: MapViewport, animate = false) => {
			setAnimated(animate)
			setStoredViewport(clampViewport(next, containerSize, stage))
		},
		[containerSize, stage],
	)

	const zoomBy = useCallback(
		(factor: number, pointer?: Point, animate = true) => {
			const anchor = pointer ?? { x: containerSize.width / 2, y: containerSize.height / 2 }
			setAnimated(animate)
			setStoredViewport((current) =>
				zoomAt(clampViewport(current, containerSize, stage), anchor, current.scale * factor, containerSize, stage),
			)
		},
		[containerSize, stage],
	)

	const resetView = useCallback(() => {
		setAnimated(true)
		setStoredViewport(FIT_VIEWPORT)
	}, [])

	// Fly to a Hub or the visual group beside the Hub that last observed an
	// item. These grouped markers show reader proximity, not exact positions.
	if (focusTarget && focusTarget.token !== handledFocusToken && room && stage.width > 0) {
		setHandledFocusToken(focusTarget.token)
		const point =
			focusTarget.kind === 'hub'
				? (() => {
						const hub = hubs.find((candidate) => candidate.id === focusTarget.id)
						return hub ? { x: hub.x, y: hub.y } : null
					})()
				: (() => {
						const item = items.find((candidate) => candidate.id === focusTarget.id)
						if (!item) return null
						const hub = hubs.find((candidate) => candidate.id === item.hubId)
						if (!hub) return null
						const siblings = items.filter((candidate) => candidate.hubId === item.hubId && candidate.lastSeenAt)
						const ringIndex = Math.max(
							0,
							siblings.findIndex((candidate) => candidate.id === item.id),
						)
						return ringPosition({ x: hub.x, y: hub.y }, ringIndex)
					})()
		if (point) {
			setAnimated(true)
			setStoredViewport(centerOnRoomPoint(point, Math.max(2.1, viewport.scale), containerSize, stage))
		}
	}

	const announce = useCallback((message: string) => {
		if (liveRegionRef.current) liveRegionRef.current.textContent = message
	}, [])

	// --- Pointer handling: mouse drag pans; touch uses two fingers at fit
	// zoom (so the page still scrolls) and one finger once zoomed in.
	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!interactive) return
		// Never hijack presses on markers or controls — capturing the pointer
		// here would swallow their click events.
		if ((event.target as HTMLElement).closest('.map-marker, .map-toolbar, .map-legend')) return
		const record: PointerRecord = { id: event.pointerId, point: { x: event.clientX, y: event.clientY }, type: event.pointerType }
		pointers.current.set(event.pointerId, record)
		movedSincePress.current = 0
		if (pointers.current.size === 2) {
			const [a, b] = [...pointers.current.values()]
			pinchStart.current = { distance: pointerDistance(a.point, b.point), scale: viewport.scale }
		}
		if (event.pointerType === 'mouse' || pointers.current.size === 2 || zoomedIn) {
			event.currentTarget.setPointerCapture(event.pointerId)
			setDragging(true)
		}
	}

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!interactive) return
		const record = pointers.current.get(event.pointerId)
		if (!record) return
		const nextPoint = { x: event.clientX, y: event.clientY }
		const dx = nextPoint.x - record.point.x
		const dy = nextPoint.y - record.point.y
		record.point = nextPoint
		movedSincePress.current += Math.hypot(dx, dy)

		if (pointers.current.size === 2 && pinchStart.current) {
			const [a, b] = [...pointers.current.values()]
			const distance = pointerDistance(a.point, b.point)
			const box = containerRef.current?.getBoundingClientRect()
			if (!box || pinchStart.current.distance === 0) return
			const mid = pointerMidpoint(a.point, b.point)
			const anchor = { x: mid.x - box.left, y: mid.y - box.top }
			setAnimated(false)
			setStoredViewport((current) =>
				zoomAt(
					current,
					anchor,
					(pinchStart.current?.scale ?? current.scale) * (distance / (pinchStart.current?.distance ?? distance)),
					containerSize,
					stage,
				),
			)
			return
		}

		const isTouchPanAllowed = record.type !== 'touch' || zoomedIn
		if (dragging && isTouchPanAllowed && pointers.current.size === 1) {
			setAnimated(false)
			setStoredViewport((current) => panBy(current, dx, dy, containerSize, stage))
		}
	}

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		pointers.current.delete(event.pointerId)
		if (pointers.current.size < 2) pinchStart.current = null
		if (pointers.current.size === 0) setDragging(false)
	}

	const placementActive = Boolean(placementHubId && onPlaceHub && room)
	const handleStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
		if (!placementActive || !onPlaceHub) return
		if (movedSincePress.current > 6) return
		if ((event.target as HTMLElement).closest('.map-marker')) return
		const box = containerRef.current?.getBoundingClientRect()
		if (!box) return
		const point = containerPointToRoomPercent({ x: event.clientX - box.left, y: event.clientY - box.top }, viewport, containerSize, stage)
		if (point) {
			onPlaceHub(point)
			announce('Hub position updated from the map.')
		}
	}

	const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
		if (!interactive) return
		// Trackpad pinch arrives as ctrl+wheel; plain wheel keeps scrolling the page.
		if (!event.ctrlKey && !event.metaKey) return
		event.preventDefault()
		const box = containerRef.current?.getBoundingClientRect()
		if (!box) return
		const anchor = { x: event.clientX - box.left, y: event.clientY - box.top }
		const factor = Math.exp(-event.deltaY * 0.01)
		setAnimated(false)
		setStoredViewport((current) => zoomAt(current, anchor, current.scale * factor, containerSize, stage))
	}

	const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
		if (!interactive || placementActive) return
		if ((event.target as HTMLElement).closest('.map-marker, .map-toolbar, .map-legend')) return
		const box = containerRef.current?.getBoundingClientRect()
		if (!box) return
		zoomBy(MAP_ZOOM_STEP, { x: event.clientX - box.left, y: event.clientY - box.top })
	}

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!interactive) return
		if (event.target !== event.currentTarget) return
		const pan = 56
		let handled = true
		if (event.key === 'ArrowLeft') applyViewport(panBy(viewport, pan, 0, containerSize, stage))
		else if (event.key === 'ArrowRight') applyViewport(panBy(viewport, -pan, 0, containerSize, stage))
		else if (event.key === 'ArrowUp') applyViewport(panBy(viewport, 0, pan, containerSize, stage))
		else if (event.key === 'ArrowDown') applyViewport(panBy(viewport, 0, -pan, containerSize, stage))
		else if (event.key === '+' || event.key === '=') zoomBy(MAP_ZOOM_STEP)
		else if (event.key === '-' || event.key === '_') zoomBy(1 / MAP_ZOOM_STEP)
		else if (event.key === '0') resetView()
		else if (event.key === 'Escape' && selection) onSelect?.(null)
		else handled = false
		if (handled) event.preventDefault()
	}

	// --- Derived marker data ------------------------------------------------
	const itemsByHub = useMemo(() => {
		const groups = new Map<string, MapItem[]>()
		for (const item of items) {
			if (!item.lastSeenAt) continue
			const group = groups.get(item.hubId) ?? []
			group.push(item)
			groups.set(item.hubId, group)
		}
		return groups
	}, [items])

	const itemMarkers = useMemo(() => {
		const markers: { item: MapItem; point: Point; hub: MapHub; freshness: Freshness; flip: boolean }[] = []
		for (const hub of hubs) {
			const group = itemsByHub.get(hub.id) ?? []
			group.forEach((item, index) => {
				markers.push({
					item,
					hub,
					point: ringPosition({ x: hub.x, y: hub.y }, index),
					freshness: item.freshness ?? tagFreshness(item.lastSeenAt, now, freshnessWindows),
					flip: index % 2 === 1,
				})
			})
		}
		return markers
	}, [hubs, itemsByHub, now, freshnessWindows])

	const neverSeenCount = items.filter((item) => !item.lastSeenAt).length
	const liveCount = itemMarkers.filter((marker) => marker.freshness === 'live').length
	const scalePercent = Math.round(viewport.scale * 100)
	const showItemLabels = viewport.scale >= LABEL_ZOOM_THRESHOLD
	const markerScale = 1 / viewport.scale
	const estimateRadius = estimate && room ? estimateRadiusPercent(estimate.radiusMeters, room) : 0

	if (!room) {
		return (
			<div className={`room-map-shell ${heightClass}`}>
				<div className="room-map-empty">{emptyState ?? <p>Add a room with measurements to see its map.</p>}</div>
			</div>
		)
	}

	const stageStyle = {
		width: `${stage.width}px`,
		height: `${stage.height}px`,
		left: `${(containerSize.width - stage.width) / 2}px`,
		top: `${(containerSize.height - stage.height) / 2}px`,
		transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`,
	}

	return (
		<div className={`room-map-shell ${heightClass} ${placementActive ? 'placement-mode' : ''}`}>
			<div
				ref={containerRef}
				className={`room-map-viewport ${dragging ? 'dragging' : ''} ${zoomedIn ? 'zoomed' : ''}`}
				role="group"
				aria-label={`Interactive map of ${room.name}, ${room.length} by ${room.width} ${room.unit === 'm' ? 'meters' : 'feet'}. ${hubs.length} Hubs and ${itemMarkers.length} observed tags.`}
				tabIndex={interactive ? 0 : -1}
				onKeyDown={onKeyDown}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onWheel={onWheel}
				onDoubleClick={onDoubleClick}
				onClick={handleStageClick}
				style={{ touchAction: zoomedIn ? 'none' : 'pan-y' }}
			>
				<div className={`room-map-stage ${animated ? 'animated' : ''}`} style={stageStyle}>
					<div className="map-floor" aria-hidden="true">
						<div className="map-grid-lines" />
					</div>

					{labels.map((label) => (
						<span
							key={label.id}
							className="map-zone-label"
							style={{
								left: `${Math.min(97, Math.max(3, (label.leftDistance / room.length) * 100))}%`,
								top: `${Math.min(95, Math.max(5, (label.frontDistance / room.width) * 100))}%`,
								['--marker-scale' as string]: markerScale,
							}}
						>
							{label.name}
						</span>
					))}

					{estimate && (
						<div
							className={`estimate-layer ${locating ? 'locating' : ''}`}
							style={{ left: `${estimate.x}%`, top: `${estimate.y}%` }}
							aria-hidden="true"
						>
							<span className="estimate-circle" style={{ width: `${estimateRadius * 2}%` }} />
							<span className="estimate-ping" />
							<span className="estimate-dot" style={{ ['--marker-scale' as string]: markerScale }} />
						</div>
					)}
					{locating && !estimate && <div className="map-search-wave" aria-hidden="true" />}

					{itemMarkers.map(({ item, point, hub, freshness, flip }) => {
						const selected = selection?.kind === 'item' && selection.id === item.id
						const showLabel = showItemLabels || selected || item.highlighted
						return (
							<button
								key={item.id}
								type="button"
								className={`map-marker item-marker ${freshness} ${selected ? 'selected' : ''} ${item.highlighted ? 'highlighted' : ''} ${item.dimmed ? 'dimmed' : ''} ${flip ? 'flip' : ''} ${showLabel ? 'labelled' : ''}`}
								style={{ left: `${point.x}%`, top: `${point.y}%`, ['--marker-scale' as string]: markerScale }}
								aria-label={`${item.name}, ${freshnessLabel(freshness).toLowerCase()}, last seen near ${hub.name} ${lastSeenLabel(item.lastSeenAt, now)}`}
								aria-pressed={selected}
								onClick={(event) => {
									event.stopPropagation()
									onSelect?.(selected ? null : { kind: 'item', id: item.id })
									announce(selected ? '' : `${item.name} selected. Last seen near ${hub.name} ${lastSeenLabel(item.lastSeenAt, now)}.`)
								}}
							>
								<span className="marker-dot">
									<i aria-hidden="true">{item.emoji ?? '•'}</i>
								</span>
								<span className="marker-tip" role="presentation">
									<strong>{item.name}</strong>
									<small>
										{freshnessLabel(freshness)} · {lastSeenLabel(item.lastSeenAt, now)}
									</small>
								</span>
							</button>
						)
					})}

					{hubs.map((hub) => {
						const selected = selection?.kind === 'hub' && selection.id === hub.id
						const isPlacing = placementHubId === hub.id
						return (
							<button
								key={hub.id}
								type="button"
								className={`map-marker hub-marker ${hub.status} ${selected ? 'selected' : ''} ${isPlacing ? 'placing' : ''}`}
								style={{ left: `${hub.x}%`, top: `${hub.y}%`, ['--marker-scale' as string]: markerScale }}
								aria-label={`Hub ${hub.name}, ${statusWord(hub.status)}${isPlacing ? '. Click the map to move it.' : ''}`}
								aria-pressed={selected}
								onClick={(event) => {
									event.stopPropagation()
									onSelect?.(selected ? null : { kind: 'hub', id: hub.id })
								}}
							>
								<span className="hub-ring" aria-hidden="true" />
								<span className="marker-dot">
									<HubGlyph />
								</span>
								<span className="marker-tip hub-tip" role="presentation">
									<strong>{hub.name}</strong>
									<small>{statusWord(hub.status)}</small>
								</span>
							</button>
						)
					})}
				</div>

				<div className="map-room-tag" aria-hidden="true">
					{room.name} · {room.length} × {room.width} {room.unit}
				</div>

				{placementActive && (
					<p className="map-placement-hint" role="status">
						Click or tap where the Hub sits — measurements update automatically.
					</p>
				)}

				{interactive && (
					<div className="map-toolbar" role="toolbar" aria-label="Map controls">
						<button
							type="button"
							onClick={() => zoomBy(MAP_ZOOM_STEP)}
							aria-label="Zoom in"
							title="Zoom in"
							disabled={viewport.scale >= MAX_MAP_SCALE - 0.01}
						>
							<IconPlus size={17} />
						</button>
						<button
							type="button"
							onClick={() => zoomBy(1 / MAP_ZOOM_STEP)}
							aria-label="Zoom out"
							title="Zoom out"
							disabled={viewport.scale <= MIN_MAP_SCALE + 0.01}
						>
							<IconMinus size={17} />
						</button>
						<button type="button" onClick={resetView} aria-label="Fit whole room" title="Fit whole room" disabled={!zoomedIn}>
							<IconFit size={17} />
						</button>
						<button
							type="button"
							className={legendOpen ? 'active' : ''}
							aria-expanded={legendOpen}
							aria-controls={legendId}
							aria-label="Map legend and help"
							title="Map legend and keyboard controls"
							onClick={() => setLegendOpen((open) => !open)}
						>
							<IconHelp size={17} />
						</button>
					</div>
				)}

				{zoomedIn && (
					<span className="map-zoom-badge" aria-hidden="true">
						{scalePercent}%
					</span>
				)}

				{legendOpen && (
					<section className="map-legend" id={legendId} aria-label="Map legend">
						<header>
							<strong>Reading this map</strong>
							<button type="button" onClick={() => setLegendOpen(false)} aria-label="Close legend">
								<IconClose size={15} />
							</button>
						</header>
						<ul>
							<li>
								<span className="legend-swatch legend-hub" aria-hidden="true">
									<HubGlyph />
								</span>
								Hub — solid when online, grey when offline
							</li>
							<li>
								<span className="legend-swatch legend-live" aria-hidden="true" />
								Live tag — read in the last few seconds
							</li>
							<li>
								<span className="legend-swatch legend-recent" aria-hidden="true" />
								Recently seen tag
							</li>
							<li>
								<span className="legend-swatch legend-stale" aria-hidden="true" />
								Last-known tag — grouped beside the Hub that last read it
							</li>
							<li>
								<span className="legend-swatch legend-estimate" aria-hidden="true" />
								Location estimate with its uncertainty radius
							</li>
							{neverSeenCount > 0 && (
								<li className="legend-note">
									{neverSeenCount} tagged {neverSeenCount === 1 ? 'item has' : 'items have'} not been seen yet, so they stay off the map.
								</li>
							)}
						</ul>
						<p className="legend-help">
							Drag to pan · pinch or <kbd>Ctrl</kbd>+scroll to zoom · double-click to zoom in.
							<br />
							Keyboard: arrow keys pan, <kbd>+</kbd>/<kbd>−</kbd> zoom, <kbd>0</kbd> fits the room.
						</p>
					</section>
				)}

				{hubs.length === 0 && <div className="room-map-empty overlay">{emptyState ?? <p>No Hubs are placed in this room yet.</p>}</div>}

				<p ref={liveRegionRef} className="visually-hidden" aria-live="polite" />
			</div>

			<footer className="map-footline" aria-hidden="true">
				<span>
					{hubs.length} {hubs.length === 1 ? 'Hub' : 'Hubs'} · {itemMarkers.length} observed {itemMarkers.length === 1 ? 'tag' : 'tags'}
					{liveCount > 0 ? ` · ${liveCount} live` : ''}
				</span>
				{neverSeenCount > 0 && <span>{neverSeenCount} not seen yet</span>}
			</footer>
		</div>
	)
}

function HubGlyph() {
	return (
		<svg
			viewBox="0 0 24 24"
			width="13"
			height="13"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.4"
			strokeLinecap="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
			<path d="M7.6 16.4a6.2 6.2 0 0 1 0-8.8M16.4 7.6a6.2 6.2 0 0 1 0 8.8" />
		</svg>
	)
}

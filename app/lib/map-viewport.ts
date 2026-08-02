// Pure geometry for the interactive room map.
//
// Model: the room is rendered as a "stage" rectangle with the room's aspect
// ratio, sized to fit centred inside the container at scale 1. A viewport
// transform `translate(tx, ty) scale(scale)` (origin 0 0) is applied on top of
// that centred position. All math here is pure so it can be unit tested.

export type Size = Readonly<{ width: number; height: number }>
export type Point = Readonly<{ x: number; y: number }>
export type MapViewport = Readonly<{ scale: number; tx: number; ty: number }>
export type RoomDimensions = Readonly<{ length: number; width: number; unit: 'ft' | 'm' }>

export const MIN_MAP_SCALE = 1
export const MAX_MAP_SCALE = 8
export const MAP_ZOOM_STEP = 1.45
export const FIT_VIEWPORT: MapViewport = { scale: 1, tx: 0, ty: 0 }

const FEET_PER_METER = 3.28084

export function clampScale(scale: number): number {
	if (!Number.isFinite(scale)) return MIN_MAP_SCALE
	return Math.min(MAX_MAP_SCALE, Math.max(MIN_MAP_SCALE, scale))
}

// Largest rectangle with the room's aspect ratio that fits in the container.
export function fitStageSize(container: Size, roomAspect: number, padding = 0): Size {
	const availableWidth = Math.max(0, container.width - padding * 2)
	const availableHeight = Math.max(0, container.height - padding * 2)
	if (availableWidth === 0 || availableHeight === 0 || !Number.isFinite(roomAspect) || roomAspect <= 0) {
		return { width: availableWidth, height: availableHeight }
	}
	const width = Math.min(availableWidth, availableHeight * roomAspect)
	return { width, height: width / roomAspect }
}

// Offset of the unscaled, centred stage inside the container.
export function stageOffset(container: Size, stage: Size): Point {
	return { x: (container.width - stage.width) / 2, y: (container.height - stage.height) / 2 }
}

// Keep the room on screen: when the scaled stage is smaller than the container
// on an axis it is centred; when larger, its edges may never leave a gap.
export function clampViewport(viewport: MapViewport, container: Size, stage: Size): MapViewport {
	const scale = clampScale(viewport.scale)
	const offset = stageOffset(container, stage)

	const clampAxis = (translate: number, offsetValue: number, stageLength: number, containerLength: number): number => {
		const scaledLength = stageLength * scale
		if (scaledLength <= containerLength) {
			return (containerLength - scaledLength) / 2 - offsetValue
		}
		const minimum = containerLength - offsetValue - scaledLength
		const maximum = -offsetValue
		return Math.min(maximum, Math.max(minimum, translate))
	}

	return {
		scale,
		tx: clampAxis(viewport.tx, offset.x, stage.width, container.width),
		ty: clampAxis(viewport.ty, offset.y, stage.height, container.height),
	}
}

// Zoom while keeping the container point `pointer` visually fixed.
export function zoomAt(viewport: MapViewport, pointer: Point, nextScale: number, container: Size, stage: Size): MapViewport {
	const scale = clampScale(nextScale)
	const offset = stageOffset(container, stage)
	const ratio = scale / viewport.scale
	const ux = pointer.x - offset.x
	const uy = pointer.y - offset.y
	return clampViewport(
		{
			scale,
			tx: ux - (ux - viewport.tx) * ratio,
			ty: uy - (uy - viewport.ty) * ratio,
		},
		container,
		stage,
	)
}

export function panBy(viewport: MapViewport, dx: number, dy: number, container: Size, stage: Size): MapViewport {
	return clampViewport({ scale: viewport.scale, tx: viewport.tx + dx, ty: viewport.ty + dy }, container, stage)
}

// Centre the container on a room-percent point at the requested scale.
export function centerOnRoomPoint(roomPercent: Point, scale: number, container: Size, stage: Size): MapViewport {
	const clamped = clampScale(scale)
	const offset = stageOffset(container, stage)
	const stagePoint = { x: (roomPercent.x / 100) * stage.width, y: (roomPercent.y / 100) * stage.height }
	return clampViewport(
		{
			scale: clamped,
			tx: container.width / 2 - offset.x - stagePoint.x * clamped,
			ty: container.height / 2 - offset.y - stagePoint.y * clamped,
		},
		container,
		stage,
	)
}

// Convert a pointer position in container coordinates to room percent.
export function containerPointToRoomPercent(pointer: Point, viewport: MapViewport, container: Size, stage: Size): Point | null {
	if (stage.width <= 0 || stage.height <= 0) return null
	const offset = stageOffset(container, stage)
	const stageX = (pointer.x - offset.x - viewport.tx) / viewport.scale
	const stageY = (pointer.y - offset.y - viewport.ty) / viewport.scale
	const x = (stageX / stage.width) * 100
	const y = (stageY / stage.height) * 100
	if (x < 0 || x > 100 || y < 0 || y > 100) return null
	return { x, y }
}

// Wall measurements for a hub placed at a room-percent point.
export function measurementsFromRoomPercent(point: Point, room: RoomDimensions) {
	const clampPercent = (value: number) => Math.min(100, Math.max(0, value))
	const x = clampPercent(point.x)
	const y = clampPercent(point.y)
	const round = (value: number) => Math.round(value * 100) / 100
	return {
		left: round((x / 100) * room.length),
		right: round(room.length - (x / 100) * room.length),
		top: round((y / 100) * room.width),
		bottom: round(room.width - (y / 100) * room.width),
	}
}

// Deterministic ring layout for items that share a hub, in room percent.
// The golden-angle spacing keeps neighbouring markers apart, and the ring
// radius communicates "near this Hub", not an exact position.
export function ringPosition(hub: Point, index: number, ringRadiusPercent = 7): Point {
	const angle = (index * 137.5 * Math.PI) / 180
	const radius = ringRadiusPercent + (index % 3) * 2.6
	return {
		x: Math.min(96, Math.max(4, hub.x + Math.cos(angle) * radius)),
		y: Math.min(94, Math.max(6, hub.y + Math.sin(angle) * radius * 1.15)),
	}
}

export function metersToRoomUnits(meters: number, unit: 'ft' | 'm'): number {
	return unit === 'm' ? meters : meters * FEET_PER_METER
}

// Uncertainty radius as a percentage of the stage width (room length axis).
export function estimateRadiusPercent(radiusMeters: number, room: RoomDimensions): number {
	if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || room.length <= 0) return 0
	return Math.min(60, (metersToRoomUnits(radiusMeters, room.unit) / room.length) * 100)
}

// Distance between two pointers, for pinch gestures.
export function pointerDistance(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y)
}

export function pointerMidpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

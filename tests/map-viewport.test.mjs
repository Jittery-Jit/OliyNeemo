import assert from 'node:assert/strict'
import test from 'node:test'
import {
	centerOnRoomPoint,
	clampScale,
	clampViewport,
	containerPointToRoomPercent,
	estimateRadiusPercent,
	FIT_VIEWPORT,
	fitStageSize,
	MAX_MAP_SCALE,
	measurementsFromRoomPercent,
	metersToRoomUnits,
	MIN_MAP_SCALE,
	panBy,
	pointerDistance,
	pointerMidpoint,
	ringPosition,
	stageOffset,
	zoomAt,
} from '../app/lib/map-viewport.ts'

const container = { width: 800, height: 600 }
const room = { length: 32, width: 24, unit: 'ft' }
const stage = fitStageSize(container, room.length / room.width)

test('the stage keeps the room aspect ratio and fits the container', () => {
	assert.equal(Math.round(stage.width), 800)
	assert.equal(Math.round(stage.height), 600)

	const wideRoom = fitStageSize({ width: 800, height: 600 }, 4)
	assert.equal(wideRoom.width, 800)
	assert.equal(wideRoom.height, 200)

	const tallContainer = fitStageSize({ width: 400, height: 900 }, 2)
	assert.equal(tallContainer.width, 400)
	assert.equal(tallContainer.height, 200)

	const offset = stageOffset({ width: 400, height: 900 }, tallContainer)
	assert.equal(offset.x, 0)
	assert.equal(offset.y, 350)
})

test('scale is clamped to the supported zoom range', () => {
	assert.equal(clampScale(0.2), MIN_MAP_SCALE)
	assert.equal(clampScale(99), MAX_MAP_SCALE)
	assert.equal(clampScale(Number.NaN), MIN_MAP_SCALE)
})

test('the fit viewport is stable and centred', () => {
	const clamped = clampViewport(FIT_VIEWPORT, container, stage)
	assert.equal(clamped.scale, 1)
	assert.ok(Math.abs(clamped.tx) < 0.001)
	assert.ok(Math.abs(clamped.ty) < 0.001)
})

test('zooming at a point keeps that point fixed and stays clamped', () => {
	const pointer = { x: 200, y: 150 }
	const before = containerPointToRoomPercent(pointer, FIT_VIEWPORT, container, stage)
	const zoomed = zoomAt(FIT_VIEWPORT, pointer, 2, container, stage)
	assert.equal(zoomed.scale, 2)
	const after = containerPointToRoomPercent(pointer, zoomed, container, stage)
	assert.ok(Math.abs(before.x - after.x) < 0.001)
	assert.ok(Math.abs(before.y - after.y) < 0.001)
})

test('panning cannot push the zoomed room fully off screen', () => {
	const zoomed = zoomAt(FIT_VIEWPORT, { x: 400, y: 300 }, 3, container, stage)
	const dragged = panBy(zoomed, 100000, 100000, container, stage)
	// The stage's left/top edge may never pass the container's left/top edge.
	const offset = stageOffset(container, stage)
	assert.ok(offset.x + dragged.tx <= 0.001)
	assert.ok(offset.y + dragged.ty <= 0.001)
	const draggedBack = panBy(zoomed, -100000, -100000, container, stage)
	assert.ok(offset.x + draggedBack.tx + stage.width * 3 >= container.width - 0.001)
	assert.ok(offset.y + draggedBack.ty + stage.height * 3 >= container.height - 0.001)
})

test('a smaller-than-container zoom level stays centred on both axes', () => {
	const wideStage = fitStageSize({ width: 800, height: 600 }, 4)
	const clamped = clampViewport({ scale: 1.5, tx: 4000, ty: -4000 }, { width: 800, height: 600 }, wideStage)
	// Vertically the scaled stage (300px) is smaller than the container, so it centres.
	const offset = stageOffset({ width: 800, height: 600 }, wideStage)
	assert.ok(Math.abs(offset.y + clamped.ty - (600 - 300) / 2) < 0.001)
})

test('centering on a room point puts it in the middle of the container', () => {
	const target = { x: 25, y: 75 }
	const viewport = centerOnRoomPoint(target, 2.5, container, stage)
	const middle = containerPointToRoomPercent({ x: container.width / 2, y: container.height / 2 }, viewport, container, stage)
	assert.ok(Math.abs(middle.x - target.x) < 0.001)
	assert.ok(Math.abs(middle.y - target.y) < 0.001)
})

test('container points outside the room produce no placement', () => {
	assert.equal(containerPointToRoomPercent({ x: -50, y: 300 }, FIT_VIEWPORT, container, stage), null)
	const inside = containerPointToRoomPercent({ x: 400, y: 300 }, FIT_VIEWPORT, container, stage)
	assert.ok(Math.abs(inside.x - 50) < 0.001)
	assert.ok(Math.abs(inside.y - 50) < 0.001)
})

test('map placement produces wall measurements that add up to the room size', () => {
	const measurements = measurementsFromRoomPercent({ x: 25, y: 75 }, room)
	assert.equal(measurements.left, 8)
	assert.equal(measurements.right, 24)
	assert.equal(measurements.top, 18)
	assert.equal(measurements.bottom, 6)
	assert.equal(measurements.left + measurements.right, room.length)
	assert.equal(measurements.top + measurements.bottom, room.width)
})

test('ring positions stay inside the room and spread neighbouring tags apart', () => {
	const hub = { x: 50, y: 50 }
	const first = ringPosition(hub, 0)
	const second = ringPosition(hub, 1)
	assert.ok(pointerDistance(first, second) > 4)
	for (const index of [0, 1, 2, 3, 4, 5]) {
		const point = ringPosition({ x: 97, y: 3 }, index)
		assert.ok(point.x >= 4 && point.x <= 96)
		assert.ok(point.y >= 6 && point.y <= 94)
	}
})

test('the uncertainty radius converts meters into honest room units', () => {
	assert.ok(Math.abs(metersToRoomUnits(2, 'ft') - 6.56168) < 0.001)
	assert.equal(metersToRoomUnits(2, 'm'), 2)
	// 1.4 m in a 32 ft room: 4.593 ft ≈ 14.35% of the room length.
	assert.ok(Math.abs(estimateRadiusPercent(1.4, room) - 14.354) < 0.01)
	assert.equal(estimateRadiusPercent(0, room), 0)
	assert.equal(estimateRadiusPercent(500, room), 60)
})

test('pinch helpers measure distance and midpoint', () => {
	assert.equal(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5)
	assert.deepEqual(pointerMidpoint({ x: 0, y: 0 }, { x: 10, y: 20 }), { x: 5, y: 10 })
})

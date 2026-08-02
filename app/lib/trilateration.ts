export type TrilaterationReading = {
	hubId: string
	hubName: string
	xMeters: number
	yMeters: number
	rssi: number
	readCount: number
	lastSeenAt: number
}

export type TrilaterationRoom = {
	lengthMeters: number
	widthMeters: number
}

export type TrilaterationReadingResult = TrilaterationReading & {
	relativeDistance: number
	estimatedDistanceMeters: number
	residualDb: number
}

export type TrilaterationResult = {
	xMeters: number
	yMeters: number
	radiusMeters: number
	confidence: 'low' | 'medium' | 'high'
	method: 'robust RSSI-ratio trilateration' | 'Hub proximity estimate'
	nearestHubId: string
	nearestHubName: string
	geometryCoverage: number
	fitErrorDb: number
	readings: TrilaterationReadingResult[]
}

type PreparedReading = TrilaterationReading & {
	baseWeight: number
	logRelativeDistance: number
}

type PointEvaluation = {
	x: number
	y: number
	logScale: number
	loss: number
	residuals: number[]
}

const EPSILON_METERS = 0.12
const HUBER_DELTA = 0.32

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(maximum, Math.max(minimum, value))
}

function median(values: number[]) {
	if (!values.length) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function huberLoss(residual: number) {
	const absolute = Math.abs(residual)
	return absolute <= HUBER_DELTA ? 0.5 * residual * residual : HUBER_DELTA * (absolute - 0.5 * HUBER_DELTA)
}

function modelDistance(x: number, y: number, reading: PreparedReading) {
	return Math.sqrt((x - reading.xMeters) ** 2 + (y - reading.yMeters) ** 2 + EPSILON_METERS ** 2)
}

function evaluatePoint(x: number, y: number, readings: PreparedReading[], weights: number[]): PointEvaluation {
	const modeledLogs = readings.map((reading) => Math.log(modelDistance(x, y, reading)))
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
	const logScale =
		readings.reduce((sum, reading, index) => sum + weights[index] * (modeledLogs[index] - reading.logRelativeDistance), 0) /
		Math.max(totalWeight, Number.EPSILON)
	const residuals = readings.map((reading, index) => modeledLogs[index] - logScale - reading.logRelativeDistance)
	const loss =
		residuals.reduce((sum, residual, index) => sum + weights[index] * huberLoss(residual), 0) / Math.max(totalWeight, Number.EPSILON)

	return { x, y, logScale, loss, residuals }
}

function solvePosition(readings: PreparedReading[], weights: number[], room: TrilaterationRoom): PointEvaluation {
	let best = evaluatePoint(room.lengthMeters / 2, room.widthMeters / 2, readings, weights)
	const gridColumns = 24
	const gridRows = 24

	// The p5.js prototype visualizes one distance circle per Hub. This bounded
	// grid finds the room point where those circles agree best before the finer
	// nonlinear search begins.
	for (let column = 0; column <= gridColumns; column += 1) {
		const x = (column / gridColumns) * room.lengthMeters
		for (let row = 0; row <= gridRows; row += 1) {
			const y = (row / gridRows) * room.widthMeters
			const candidate = evaluatePoint(x, y, readings, weights)
			if (candidate.loss < best.loss) best = candidate
		}
	}

	let stepX = Math.max(room.lengthMeters / gridColumns, 0.04)
	let stepY = Math.max(room.widthMeters / gridRows, 0.04)
	for (let iteration = 0; iteration < 48 && Math.max(stepX, stepY) > 0.005; iteration += 1) {
		let improved = false
		for (const [dx, dy] of [
			[-stepX, 0],
			[stepX, 0],
			[0, -stepY],
			[0, stepY],
			[-stepX, -stepY],
			[-stepX, stepY],
			[stepX, -stepY],
			[stepX, stepY],
		]) {
			const candidate = evaluatePoint(clamp(best.x + dx, 0, room.lengthMeters), clamp(best.y + dy, 0, room.widthMeters), readings, weights)
			if (candidate.loss + 1e-12 < best.loss) {
				best = candidate
				improved = true
			}
		}
		if (!improved) {
			stepX *= 0.5
			stepY *= 0.5
		}
	}
	return best
}

function cross(origin: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
	return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
}

function geometryCoverage(readings: PreparedReading[], room: TrilaterationRoom) {
	const points = Array.from(
		new Map(readings.map((reading) => [`${reading.xMeters}:${reading.yMeters}`, { x: reading.xMeters, y: reading.yMeters }])).values(),
	).sort((a, b) => a.x - b.x || a.y - b.y)
	if (points.length < 3) return 0

	const lower: { x: number; y: number }[] = []
	for (const point of points) {
		while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
			lower.pop()
		}
		lower.push(point)
	}
	const upper: { x: number; y: number }[] = []
	for (let index = points.length - 1; index >= 0; index -= 1) {
		const point = points[index]
		while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
			upper.pop()
		}
		upper.push(point)
	}
	const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
	const doubledArea = Math.abs(
		hull.reduce((sum, point, index) => {
			const next = hull[(index + 1) % hull.length]
			return sum + point.x * next.y - next.x * point.y
		}, 0),
	)
	return clamp(doubledArea / 2 / Math.max(room.lengthMeters * room.widthMeters, Number.EPSILON), 0, 1)
}

function proximityEstimate(readings: PreparedReading[], room: TrilaterationRoom, pathLossExponent: number): TrilaterationResult {
	const inverseWeights = readings.map((reading) => reading.baseWeight * Math.exp(-2 * reading.logRelativeDistance))
	const totalWeight = inverseWeights.reduce((sum, weight) => sum + weight, 0)
	const x = readings.reduce((sum, reading, index) => sum + reading.xMeters * inverseWeights[index], 0) / totalWeight
	const y = readings.reduce((sum, reading, index) => sum + reading.yMeters * inverseWeights[index], 0) / totalWeight
	const evaluation = evaluatePoint(x, y, readings, inverseWeights)
	const scale = Math.exp(evaluation.logScale)
	const dbFactor = (10 * pathLossExponent) / Math.LN10
	const diagonal = Math.hypot(room.lengthMeters, room.widthMeters)
	const nearest = [...readings].sort((a, b) => Math.hypot(x - a.xMeters, y - a.yMeters) - Math.hypot(x - b.xMeters, y - b.yMeters))[0]

	return {
		xMeters: clamp(x, 0, room.lengthMeters),
		yMeters: clamp(y, 0, room.widthMeters),
		radiusMeters: Math.round(clamp(diagonal * (readings.length === 1 ? 0.48 : 0.3), 0.8, diagonal) * 10) / 10,
		confidence: 'low',
		method: 'Hub proximity estimate',
		nearestHubId: nearest.hubId,
		nearestHubName: nearest.hubName,
		geometryCoverage: 0,
		fitErrorDb:
			Math.round(Math.sqrt(evaluation.residuals.reduce((sum, residual) => sum + residual ** 2, 0) / readings.length) * dbFactor * 10) / 10,
		readings: readings.map((reading, index) => ({
			...reading,
			relativeDistance: Math.exp(reading.logRelativeDistance),
			estimatedDistanceMeters: Math.round(scale * Math.exp(reading.logRelativeDistance) * 100) / 100,
			residualDb: Math.round(evaluation.residuals[index] * dbFactor * 10) / 10,
		})),
	}
}

export function estimateByRssiTrilateration(
	inputReadings: TrilaterationReading[],
	inputRoom: TrilaterationRoom,
	options: { pathLossExponent?: number } = {},
): TrilaterationResult | null {
	const room = {
		lengthMeters: Number(inputRoom.lengthMeters),
		widthMeters: Number(inputRoom.widthMeters),
	}
	if (!Number.isFinite(room.lengthMeters) || !Number.isFinite(room.widthMeters) || room.lengthMeters <= 0 || room.widthMeters <= 0) {
		return null
	}

	const newestReading = Math.max(...inputReadings.map((reading) => reading.lastSeenAt), 0)
	const unique = new Map<string, TrilaterationReading>()
	for (const reading of inputReadings) {
		if (!reading.hubId || !Number.isFinite(reading.xMeters) || !Number.isFinite(reading.yMeters) || !Number.isFinite(reading.rssi)) {
			continue
		}
		const current = unique.get(reading.hubId)
		if (!current || reading.lastSeenAt > current.lastSeenAt || reading.readCount > current.readCount) {
			unique.set(reading.hubId, reading)
		}
	}
	const valid = Array.from(unique.values())
	if (!valid.length) return null

	const pathLossExponent = clamp(options.pathLossExponent ?? 2.4, 1.2, 5)
	const strongestRssi = Math.max(...valid.map((reading) => reading.rssi))
	const prepared: PreparedReading[] = valid.map((reading) => {
		const ageMilliseconds = Math.max(0, newestReading - reading.lastSeenAt)
		const recencyWeight = clamp(Math.exp(-ageMilliseconds / 15_000), 0.2, 1)
		const sampleWeight = clamp(Math.sqrt(Math.max(1, reading.readCount)), 1, 5)
		const relativeDistance = clamp(10 ** ((strongestRssi - reading.rssi) / (10 * pathLossExponent)), 1, 30)
		return {
			...reading,
			xMeters: clamp(reading.xMeters, 0, room.lengthMeters),
			yMeters: clamp(reading.yMeters, 0, room.widthMeters),
			baseWeight: recencyWeight * sampleWeight,
			logRelativeDistance: Math.log(relativeDistance),
		}
	})

	if (prepared.length < 3) return proximityEstimate(prepared, room, pathLossExponent)

	const initialWeights = prepared.map((reading) => reading.baseWeight)
	const initial = solvePosition(prepared, initialWeights, room)
	const absoluteResiduals = initial.residuals.map(Math.abs)
	const residualMedian = median(absoluteResiduals)
	const residualMad = median(absoluteResiduals.map((residual) => Math.abs(residual - residualMedian)))
	const outlierCutoff = Math.max(0.24, residualMedian + 2.5 * Math.max(residualMad, 0.04))
	const robustWeights = initialWeights.map((weight, index) => {
		const residual = absoluteResiduals[index]
		return weight * (residual <= outlierCutoff ? 1 : clamp(outlierCutoff / residual, 0.08, 1))
	})
	const solved = solvePosition(prepared, robustWeights, room)
	const scale = Math.exp(solved.logScale)
	const dbFactor = (10 * pathLossExponent) / Math.LN10
	const weightedSquareError =
		solved.residuals.reduce((sum, residual, index) => sum + robustWeights[index] * residual ** 2, 0) /
		robustWeights.reduce((sum, weight) => sum + weight, 0)
	const fitErrorDb = Math.sqrt(weightedSquareError) * dbFactor
	const coverage = geometryCoverage(prepared, room)
	const diagonal = Math.hypot(room.lengthMeters, room.widthMeters)
	const modeledDistances = prepared.map((reading) => modelDistance(solved.x, solved.y, reading))
	const averageDistance = modeledDistances.reduce((sum, distance) => sum + distance, 0) / modeledDistances.length
	const fitErrorMeters = Math.sqrt(weightedSquareError) * Math.max(0.5, averageDistance)
	const geometryPenalty = 1 / Math.sqrt(clamp(coverage * 2, 0.16, 1))
	const samplePenalty = prepared.length >= 4 ? 1 : 1.3
	const radiusMeters = clamp((diagonal * 0.035 + fitErrorMeters) * geometryPenalty * samplePenalty, 0.45, diagonal)
	const confidence =
		prepared.length >= 4 && coverage >= 0.12 && fitErrorDb <= 4.5 ? 'high' : coverage >= 0.035 && fitErrorDb <= 8 ? 'medium' : 'low'
	const nearest = prepared
		.map((reading, index) => ({ reading, distance: modeledDistances[index] }))
		.sort((a, b) => a.distance - b.distance)[0].reading

	return {
		xMeters: Math.round(clamp(solved.x, 0, room.lengthMeters) * 100) / 100,
		yMeters: Math.round(clamp(solved.y, 0, room.widthMeters) * 100) / 100,
		radiusMeters: Math.round(radiusMeters * 10) / 10,
		confidence,
		method: 'robust RSSI-ratio trilateration',
		nearestHubId: nearest.hubId,
		nearestHubName: nearest.hubName,
		geometryCoverage: Math.round(coverage * 1000) / 1000,
		fitErrorDb: Math.round(fitErrorDb * 10) / 10,
		readings: prepared.map((reading, index) => ({
			...reading,
			relativeDistance: Math.round(Math.exp(reading.logRelativeDistance) * 1000) / 1000,
			estimatedDistanceMeters: Math.round(scale * Math.exp(reading.logRelativeDistance) * 100) / 100,
			residualDb: Math.round(solved.residuals[index] * dbFactor * 10) / 10,
		})),
	}
}

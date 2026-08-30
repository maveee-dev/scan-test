import type {
  CoverageCellState,
  FinalizedSpatialScan,
  SpatialPoint,
} from '../../scanner/types'
import type {
  PlaneCandidate,
  PlaneOrientationCategory,
  RoomAnalysisResult,
} from '../types'

export interface PlaneExtractionConfig {
  readonly downsampleCellSizeMeters: number
  readonly connectivityBucketSizeMeters: number
  readonly connectivityDistanceMeters: number
  readonly maximumSeedPlaneErrorMeters: number
  readonly maximumPlaneErrorMeters: number
  readonly maximumNormalAngleDegrees: number
  readonly minimumSupportPointCount: number
  readonly minimumAreaSquareMeters: number
  readonly maximumRmsErrorMeters: number
  readonly maximumPlaneRefinementPasses: number
}

/** Conservative defaults for major-surface candidates, not semantic labels. */
export const DEFAULT_PLANE_EXTRACTION_CONFIG: PlaneExtractionConfig = {
  downsampleCellSizeMeters: 0.075,
  connectivityBucketSizeMeters: 0.12,
  connectivityDistanceMeters: 0.18,
  maximumSeedPlaneErrorMeters: 0.06,
  maximumPlaneErrorMeters: 0.045,
  maximumNormalAngleDegrees: 30,
  minimumSupportPointCount: 12,
  minimumAreaSquareMeters: 0.2,
  maximumRmsErrorMeters: 0.035,
  maximumPlaneRefinementPasses: 2,
}

interface AnalysisPoint {
  position: SpatialPoint
  normal: SpatialPoint
  weight: number
  sourceCount: number
}

interface DownsampleAggregate {
  positionX: number
  positionY: number
  positionZ: number
  normalX: number
  normalY: number
  normalZ: number
  weight: number
  sourceCount: number
}

interface FilteredPoint {
  position: SpatialPoint
  normal: SpatialPoint
  weight: number
}

interface AnalysisPointMapResult {
  inputPoints: number
  filteredPoints: number
  points: AnalysisPoint[]
  inputPreparationMs: number
  downsamplingMs: number
}

interface FitPlaneResult {
  centroid: SpatialPoint
  normal: SpatialPoint
  planeConstant: number
  rmsError: number
}

interface ExtractedPlane {
  support: readonly number[]
  fit: FitPlaneResult
}

function getTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function dot(left: SpatialPoint, right: SpatialPoint): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function length(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function normalize(point: SpatialPoint): SpatialPoint | null {
  const magnitude = length(point)
  if (!Number.isFinite(magnitude) || magnitude < 1e-7) {
    return null
  }

  return {
    x: point.x / magnitude,
    y: point.y / magnitude,
    z: point.z / magnitude,
  }
}

function isFinitePoint(point: SpatialPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

function subtract(left: SpatialPoint, right: SpatialPoint): SpatialPoint {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  }
}

function cross(left: SpatialPoint, right: SpatialPoint): SpatialPoint {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

function scale(point: SpatialPoint, amount: number): SpatialPoint {
  return {
    x: point.x * amount,
    y: point.y * amount,
    z: point.z * amount,
  }
}

function addScaled(target: SpatialPoint, point: SpatialPoint, amount: number): void {
  target.x += point.x * amount
  target.y += point.y * amount
  target.z += point.z * amount
}

function squaredDistance(left: SpatialPoint, right: SpatialPoint): number {
  const delta = subtract(left, right)
  return dot(delta, delta)
}

function quantize(value: number, cellSize: number): number {
  return Math.floor(value / cellSize)
}

function getBucketKey(point: SpatialPoint, bucketSize: number): string {
  return `${quantize(point.x, bucketSize)}:${quantize(point.y, bucketSize)}:${quantize(point.z, bucketSize)}`
}

function getQualityWeight(state: CoverageCellState, observationCount: number): number {
  const stateWeight = state === 'captured' ? 3 : state === 'partial' ? 2 : 1
  return stateWeight * clamp(observationCount, 1, 3)
}

function getNormalCompatibilityDot(maximumNormalAngleDegrees: number): number {
  return Math.cos((maximumNormalAngleDegrees * Math.PI) / 180)
}

function getOrientationCategory(angleDegrees: number): PlaneOrientationCategory {
  if (angleDegrees <= 20) {
    return 'horizontal-like'
  }
  if (angleDegrees >= 70) {
    return 'vertical-like'
  }
  return 'other'
}

function choosePlaneBasis(normal: SpatialPoint): { tangentU: SpatialPoint; tangentV: SpatialPoint } | null {
  const reference: SpatialPoint = Math.abs(normal.y) < 0.8
    ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 }
  const tangentU = normalize(cross(reference, normal))
  if (!tangentU) {
    return null
  }

  const tangentV = normalize(cross(normal, tangentU))
  if (!tangentV) {
    return null
  }

  return { tangentU, tangentV }
}

function getSmallestEigenvector(matrixInput: readonly number[]): SpatialPoint | null {
  const matrix = [...matrixInput]
  const eigenvectors = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]

  for (let iteration = 0; iteration < 12; iteration += 1) {
    let p = 0
    let q = 1
    let largest = Math.abs(matrix[1])
    const offDiagonalPairs: readonly [number, number][] = [[0, 1], [0, 2], [1, 2]]
    for (const [candidateP, candidateQ] of offDiagonalPairs) {
      const candidate = Math.abs(matrix[candidateP * 3 + candidateQ])
      if (candidate > largest) {
        largest = candidate
        p = candidateP
        q = candidateQ
      }
    }

    if (largest < 1e-8) {
      break
    }

    const app = matrix[p * 3 + p]
    const aqq = matrix[q * 3 + q]
    const apq = matrix[p * 3 + q]
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app)
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)

    for (let index = 0; index < 3; index += 1) {
      if (index === p || index === q) {
        continue
      }

      const indexP = matrix[index * 3 + p]
      const indexQ = matrix[index * 3 + q]
      matrix[index * 3 + p] = cosine * indexP - sine * indexQ
      matrix[p * 3 + index] = matrix[index * 3 + p]
      matrix[index * 3 + q] = sine * indexP + cosine * indexQ
      matrix[q * 3 + index] = matrix[index * 3 + q]
    }

    matrix[p * 3 + p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq
    matrix[q * 3 + q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq
    matrix[p * 3 + q] = 0
    matrix[q * 3 + p] = 0

    for (let index = 0; index < 3; index += 1) {
      const indexP = eigenvectors[index * 3 + p]
      const indexQ = eigenvectors[index * 3 + q]
      eigenvectors[index * 3 + p] = cosine * indexP - sine * indexQ
      eigenvectors[index * 3 + q] = sine * indexP + cosine * indexQ
    }
  }

  let smallestIndex = 0
  if (matrix[4] < matrix[smallestIndex]) {
    smallestIndex = 1
  }
  if (matrix[8] < matrix[smallestIndex * 3 + smallestIndex]) {
    smallestIndex = 2
  }

  return normalize({
    x: eigenvectors[smallestIndex],
    y: eigenvectors[3 + smallestIndex],
    z: eigenvectors[6 + smallestIndex],
  })
}

function fitPlane(points: readonly AnalysisPoint[], indices: readonly number[]): FitPlaneResult | null {
  if (indices.length < 3) {
    return null
  }

  const centroid = { x: 0, y: 0, z: 0 }
  const normalSum = { x: 0, y: 0, z: 0 }
  let totalWeight = 0
  let firstNormal: SpatialPoint | null = null

  for (const index of indices) {
    const point = points[index]
    totalWeight += point.weight
    addScaled(centroid, point.position, point.weight)
    if (!firstNormal) {
      firstNormal = point.normal
    }
    const alignedNormal = firstNormal && dot(firstNormal, point.normal) < 0
      ? scale(point.normal, -1)
      : point.normal
    addScaled(normalSum, alignedNormal, point.weight)
  }

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return null
  }
  centroid.x /= totalWeight
  centroid.y /= totalWeight
  centroid.z /= totalWeight

  const covariance = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const index of indices) {
    const point = points[index]
    const delta = subtract(point.position, centroid)
    const weight = point.weight / totalWeight
    covariance[0] += delta.x * delta.x * weight
    covariance[1] += delta.x * delta.y * weight
    covariance[2] += delta.x * delta.z * weight
    covariance[4] += delta.y * delta.y * weight
    covariance[5] += delta.y * delta.z * weight
    covariance[8] += delta.z * delta.z * weight
  }
  covariance[3] = covariance[1]
  covariance[6] = covariance[2]
  covariance[7] = covariance[5]

  let normal = getSmallestEigenvector(covariance)
  if (!normal) {
    normal = normalize(normalSum)
  }
  if (!normal) {
    return null
  }
  if (dot(normal, normalSum) < 0) {
    normal = scale(normal, -1)
  }

  const planeConstant = dot(normal, centroid)
  let squaredError = 0
  for (const index of indices) {
    const residual = dot(normal, points[index].position) - planeConstant
    squaredError += residual * residual * points[index].weight
  }

  return {
    centroid,
    normal,
    planeConstant,
    rmsError: Math.sqrt(squaredError / totalWeight),
  }
}

function createPlaneCandidate(
  id: string,
  points: readonly AnalysisPoint[],
  support: readonly number[],
  fit: FitPlaneResult,
  config: PlaneExtractionConfig,
): PlaneCandidate | null {
  const basis = choosePlaneBasis(fit.normal)
  if (!basis) {
    return null
  }

  const minimum = { x: Infinity, y: Infinity, z: Infinity }
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity

  for (const index of support) {
    const point = points[index].position
    minimum.x = Math.min(minimum.x, point.x)
    minimum.y = Math.min(minimum.y, point.y)
    minimum.z = Math.min(minimum.z, point.z)
    maximum.x = Math.max(maximum.x, point.x)
    maximum.y = Math.max(maximum.y, point.y)
    maximum.z = Math.max(maximum.z, point.z)

    const relative = subtract(point, fit.centroid)
    const u = dot(relative, basis.tangentU)
    const v = dot(relative, basis.tangentV)
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }

  const areaEstimate = Math.max(0, maxU - minU) * Math.max(0, maxV - minV)
  const up = { x: 0, y: 1, z: 0 }
  const orientationAngleDegrees = (Math.acos(clamp(Math.abs(dot(fit.normal, up)), 0, 1)) * 180) / Math.PI
  const supportPointCount = support.reduce(
    (count, index) => count + points[index].sourceCount,
    0,
  )
  const supportScore = clamp(support.length / (config.minimumSupportPointCount * 4), 0, 1)
  const areaScore = clamp(areaEstimate, 0, 1)
  const errorScore = 1 - clamp(fit.rmsError / config.maximumRmsErrorMeters, 0, 1)

  return {
    id,
    normal: fit.normal,
    centroid: fit.centroid,
    planeConstant: fit.planeConstant,
    supportPointCount,
    areaEstimate,
    rmsError: fit.rmsError,
    bounds: { min: minimum, max: maximum },
    localBounds: { minU, maxU, minV, maxV },
    tangentU: basis.tangentU,
    tangentV: basis.tangentV,
    orientationAngleDegrees,
    orientationCategory: getOrientationCategory(orientationAngleDegrees),
    confidence: clamp(0.45 * supportScore + 0.35 * areaScore + 0.2 * errorScore, 0, 1),
  }
}

function createAnalysisPointMap(
  scan: FinalizedSpatialScan,
  config: PlaneExtractionConfig,
): AnalysisPointMapResult {
  const preparationStartedAt = getTimestamp()
  const filtered: FilteredPoint[] = []
  for (const cell of scan.coverage) {
    if (!cell.normal || !isFinitePoint(cell.position) || !isFinitePoint(cell.normal)) {
      continue
    }

    const normal = normalize(cell.normal)
    if (!normal) {
      continue
    }
    filtered.push({
      position: cell.position,
      normal,
      weight: getQualityWeight(cell.coverageState, cell.observationCount),
    })
  }
  const preparationFinishedAt = getTimestamp()

  const aggregates = new Map<string, DownsampleAggregate>()
  for (const source of filtered) {
    const key = getBucketKey(source.position, config.downsampleCellSizeMeters)
    const aggregate = aggregates.get(key)
    if (!aggregate) {
      aggregates.set(key, {
        positionX: source.position.x * source.weight,
        positionY: source.position.y * source.weight,
        positionZ: source.position.z * source.weight,
        normalX: source.normal.x * source.weight,
        normalY: source.normal.y * source.weight,
        normalZ: source.normal.z * source.weight,
        weight: source.weight,
        sourceCount: 1,
      })
      continue
    }

    const aggregateNormal = normalize({
      x: aggregate.normalX,
      y: aggregate.normalY,
      z: aggregate.normalZ,
    })
    const alignedNormal = aggregateNormal && dot(aggregateNormal, source.normal) < 0
      ? scale(source.normal, -1)
      : source.normal
    aggregate.positionX += source.position.x * source.weight
    aggregate.positionY += source.position.y * source.weight
    aggregate.positionZ += source.position.z * source.weight
    aggregate.normalX += alignedNormal.x * source.weight
    aggregate.normalY += alignedNormal.y * source.weight
    aggregate.normalZ += alignedNormal.z * source.weight
    aggregate.weight += source.weight
    aggregate.sourceCount += 1
  }
  const downsamplingFinishedAt = getTimestamp()

  const points: AnalysisPoint[] = []
  for (const aggregate of aggregates.values()) {
    const position = {
      x: aggregate.positionX / aggregate.weight,
      y: aggregate.positionY / aggregate.weight,
      z: aggregate.positionZ / aggregate.weight,
    }
    const normal = normalize({
      x: aggregate.normalX,
      y: aggregate.normalY,
      z: aggregate.normalZ,
    })
    if (!normal || !isFinitePoint(position)) {
      continue
    }
    points.push({
      position,
      normal,
      weight: aggregate.weight,
      sourceCount: aggregate.sourceCount,
    })
  }

  // Prefer higher-quality representatives as seeds, while retaining all
  // downsampled positions for spatial connectivity and area estimation.
  points.sort((left, right) => right.weight - left.weight)
  return {
    inputPoints: scan.coverage.length,
    filteredPoints: filtered.length,
    points,
    inputPreparationMs: Math.max(0, preparationFinishedAt - preparationStartedAt),
    downsamplingMs: Math.max(0, downsamplingFinishedAt - preparationFinishedAt),
  }
}

function createSpatialIndex(
  points: readonly AnalysisPoint[],
  bucketSize: number,
): Map<string, number[]> {
  const buckets = new Map<string, number[]>()
  points.forEach((point, index) => {
    const key = getBucketKey(point.position, bucketSize)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(index)
    } else {
      buckets.set(key, [index])
    }
  })
  return buckets
}

function collectRegion(
  seedIndex: number,
  points: readonly AnalysisPoint[],
  buckets: ReadonlyMap<string, readonly number[]>,
  config: PlaneExtractionConfig,
  normalCompatibilityDot: number,
): number[] {
  const queue = [seedIndex]
  const queued = new Uint8Array(points.length)
  queued[seedIndex] = 1
  const seed = points[seedIndex]
  const seedPlaneConstant = dot(seed.normal, seed.position)
  const bucketRadius = Math.ceil(config.connectivityDistanceMeters / config.connectivityBucketSizeMeters)

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const current = points[queue[queueIndex]]
    const currentBucketX = quantize(current.position.x, config.connectivityBucketSizeMeters)
    const currentBucketY = quantize(current.position.y, config.connectivityBucketSizeMeters)
    const currentBucketZ = quantize(current.position.z, config.connectivityBucketSizeMeters)

    for (let xOffset = -bucketRadius; xOffset <= bucketRadius; xOffset += 1) {
      for (let yOffset = -bucketRadius; yOffset <= bucketRadius; yOffset += 1) {
        for (let zOffset = -bucketRadius; zOffset <= bucketRadius; zOffset += 1) {
          const bucket = buckets.get(
            `${currentBucketX + xOffset}:${currentBucketY + yOffset}:${currentBucketZ + zOffset}`,
          )
          if (!bucket) {
            continue
          }

          for (const candidateIndex of bucket) {
            if (queued[candidateIndex] === 1) {
              continue
            }
            const candidate = points[candidateIndex]
            if (squaredDistance(current.position, candidate.position) > config.connectivityDistanceMeters ** 2) {
              continue
            }
            if (Math.abs(dot(seed.normal, candidate.normal)) < normalCompatibilityDot) {
              continue
            }
            const seedResidual = Math.abs(dot(seed.normal, candidate.position) - seedPlaneConstant)
            if (seedResidual > config.maximumSeedPlaneErrorMeters) {
              continue
            }
            queued[candidateIndex] = 1
            queue.push(candidateIndex)
          }
        }
      }
    }
  }

  return queue
}

function refineRegion(
  points: readonly AnalysisPoint[],
  region: readonly number[],
  config: PlaneExtractionConfig,
  normalCompatibilityDot: number,
): ExtractedPlane | null {
  let support = [...region]
  let fit = fitPlane(points, support)
  if (!fit) {
    return null
  }

  for (let pass = 0; pass < config.maximumPlaneRefinementPasses; pass += 1) {
    const currentFit = fit
    const nextSupport = support.filter((index) => {
      const point = points[index]
      const residual = Math.abs(dot(currentFit.normal, point.position) - currentFit.planeConstant)
      return residual <= config.maximumPlaneErrorMeters &&
        Math.abs(dot(currentFit.normal, point.normal)) >= normalCompatibilityDot
    })
    if (nextSupport.length === support.length) {
      break
    }
    if (nextSupport.length < 3) {
      return null
    }
    support = nextSupport
    fit = fitPlane(points, support)
    if (!fit) {
      return null
    }
  }

  return { support, fit }
}

function extractPlanes(
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
): { planes: PlaneCandidate[]; assignedPointCount: number } {
  const buckets = createSpatialIndex(points, config.connectivityBucketSizeMeters)
  const assigned = new Uint8Array(points.length)
  const normalCompatibilityDot = getNormalCompatibilityDot(config.maximumNormalAngleDegrees)
  const extracted: Array<{ candidate: PlaneCandidate; support: readonly number[] }> = []

  for (let seedIndex = 0; seedIndex < points.length; seedIndex += 1) {
    if (assigned[seedIndex] === 1) {
      continue
    }

    const region = collectRegion(
      seedIndex,
      points,
      buckets,
      config,
      normalCompatibilityDot,
    )
    if (region.length < config.minimumSupportPointCount) {
      continue
    }

    const refined = refineRegion(points, region, config, normalCompatibilityDot)
    if (!refined || refined.support.length < config.minimumSupportPointCount) {
      continue
    }

    const candidate = createPlaneCandidate(
      `plane-${extracted.length + 1}`,
      points,
      refined.support,
      refined.fit,
      config,
    )
    if (
      !candidate ||
      candidate.areaEstimate < config.minimumAreaSquareMeters ||
      candidate.rmsError > config.maximumRmsErrorMeters
    ) {
      continue
    }

    for (const index of refined.support) {
      assigned[index] = 1
    }
    extracted.push({ candidate, support: refined.support })
  }

  extracted.sort((left, right) => right.candidate.areaEstimate - left.candidate.areaEstimate)
  const planes = extracted.map((entry, index) => ({
    ...entry.candidate,
    id: `plane-${index + 1}`,
  }))
  let assignedPointCount = 0
  for (const entry of extracted) {
    assignedPointCount += entry.support.length
  }
  return { planes, assignedPointCount }
}

export class PlaneExtractionService {
  private readonly config: PlaneExtractionConfig

  constructor(config: PlaneExtractionConfig = DEFAULT_PLANE_EXTRACTION_CONFIG) {
    this.config = config
  }

  public analyze(scan: FinalizedSpatialScan): RoomAnalysisResult {
    const analysisStartedAt = getTimestamp()
    const prepared = createAnalysisPointMap(scan, this.config)
    const preparationFinishedAt = getTimestamp()
    const extracted = extractPlanes(prepared.points, this.config)
    const extractionFinishedAt = getTimestamp()

    const result: RoomAnalysisResult = {
      sourceScanId: scan.id,
      planes: Object.freeze(extracted.planes),
      stats: {
        inputPoints: prepared.inputPoints,
        filteredPoints: prepared.filteredPoints,
        downsampledPoints: prepared.points.length,
        planeCount: extracted.planes.length,
        rejectedPoints: Math.max(0, prepared.points.length - extracted.assignedPointCount),
      },
      timings: {
        inputPreparationMs: prepared.inputPreparationMs,
        downsamplingMs: prepared.downsamplingMs,
        planeExtractionMs: Math.max(0, extractionFinishedAt - preparationFinishedAt),
        totalMs: Math.max(0, extractionFinishedAt - analysisStartedAt),
      },
    }

    return Object.freeze(result)
  }
}

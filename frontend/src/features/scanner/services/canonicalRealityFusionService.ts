import type {
  FinalizedRealitySurfel,
  RealityColorStatistics,
  SpatialBounds,
  SpatialPoint,
} from '../types'
import {
  RETAINED_REALITY_CONFIG,
  type RetainedRealityMeasurementFrame,
  type RetainedRealityMeasurementSnapshot,
} from './retainedRealityMeasurementService'

export const CANONICAL_REALITY_CONFIG = Object.freeze({
  cellSizeMeters: 0.025,
  maxSurfels: 60000,
  maxLayersPerCell: 4,
  matchTangentDistanceMeters: 0.046,
  matchPlaneResidualMeters: 0.022,
  minimumNormalDot: Math.cos(43 * Math.PI / 180),
  maximumUpdateMeters: 0.003,
  falseParallelMinimumMeters: 0.028,
  falseParallelMaximumMeters: 0.105,
})

/**
 * A deliberately small, transfer-safe audit trail for measured hypotheses that
 * were not carried into Final Reality.  This is diagnostic data only: no point
 * in this map is fed back into reconstruction or rendering of the Final model.
 */
export const PROVISIONAL_EXPIRY_MAP_CAPACITY = 12000
export const PROVISIONAL_EXPIRY_REASON = Object.freeze({
  insufficientTemporalSupport: 1,
  insufficientMultiViewSupport: 2,
  replacedByCanonical: 3,
  duplicateParallelLayer: 4,
  isolatedOrNoisy: 5,
  capacityOrLayerPolicy: 6,
  other: 7,
} as const)
export type ProvisionalExpiryReason = keyof typeof PROVISIONAL_EXPIRY_REASON
export interface ProvisionalExpiryMap {
  readonly capacity: number
  /** All measured hypotheses accounted for, including samples beyond capacity. */
  readonly total: number
  /** Prefix retained in the packed arrays; deterministic replay order. */
  readonly sampled: number
  readonly omitted: number
  /** xyz triples of actual observed hypothesis positions. */
  readonly positions: Float32Array
  /** One value per xyz triple, using PROVISIONAL_EXPIRY_REASON. */
  readonly reasonCodes: Uint8Array
}

export interface CanonicalRealityFusionDiagnostics {
  readonly inputFrames: number
  readonly inputObservations: number
  readonly consolidatedObservations: number
  readonly sameFrameConsolidated: number
  readonly matchedExisting: number
  readonly provisionalCreated: number
  readonly provisionalPromoted: number
  readonly provisionalExpired: number
  readonly canonicalMerges: number
  readonly falseParallelLayersCollapsed: number
  readonly trueSeparateLayersRetained: number
  readonly outliersRejected: number
  readonly layerCapacityRejected: number
  readonly canonicalSurfels: number
  readonly observationsPerCanonicalSurfel: number
  readonly wallThicknessP50Meters: number
  readonly wallThicknessP90Meters: number
  readonly wallThicknessP95Meters: number
  readonly workerTimeMs: number
  readonly numericMemoryBytes: number
  readonly transitionExistingCanonical: number
  readonly transitionExistingProvisional: number
  readonly transitionNewCoherent: number
  readonly transitionPossibleParallelDuplicate: number
  readonly transitionTrueSeparatedLayer: number
  readonly transitionOutlier: number
  readonly baseColorInputObservations: number
  readonly baseColorConsolidatedObservations: number
  readonly baseColorCanonicalSurfels: number
  readonly baseColorCoveragePercentage: number
  readonly expiryReasons: Readonly<{
    insufficientTemporalSupport: number
    insufficientMultiViewSupport: number
    replacedByCanonical: number
    isolatedOrNoisy: number
    duplicateParallelLayer: number
    capacityOrLayerPolicy: number
    other: number
  }>
  readonly provisionalExpiryMap: ProvisionalExpiryMap
  readonly trueSecondLayerReasons: Readonly<{
    recessTopology: number
    objectOrOccludingSurface: number
    separateWall: number
    unknown: number
  }>
  readonly dominantPlanarThicknessP50Meters: number
  readonly dominantPlanarThicknessP90Meters: number
  readonly dominantPlanarThicknessP95Meters: number
  readonly dominantPlanarSurfelCount: number
  readonly completenessStages: readonly CanonicalCompletenessStage[]
}

export interface CanonicalCompletenessStage {
  readonly name: 'retained-measured' | 'per-frame-consolidated' | 'provisional-created' | 'promoted-canonical'
  readonly count: number
  readonly percentageOfPrior: number
  readonly spatialCoverageCells: number
  readonly surfaceAreaProxySquareMeters: number
}

export interface CanonicalRealityFusionResult {
  readonly surfels: readonly FinalizedRealitySurfel[]
  readonly diagnostics: CanonicalRealityFusionDiagnostics
  readonly bounds: SpatialBounds | null
  readonly colorStatistics: RealityColorStatistics
}

export type CanonicalReconstructionStage = 'reconstructing-geometry' | 'cleaning-surfaces' | 'applying-room-appearance'

interface ConsolidatedObservation {
  readonly sourceIndex: number
  readonly position: SpatialPoint
  readonly normal: SpatialPoint
  color: MutableColor | null
  colorCount: number
}

interface MutableColor { r: number; g: number; b: number }

interface MutableCanonicalSurfel {
  position: SpatialPoint
  normal: SpatialPoint
  color: MutableColor | null
  colorCount: number
  observationCount: number
  firstTimestamp: number
  lastTimestamp: number
  lastFrameSequence: number
  firstCamera: SpatialPoint
  firstViewDirection: SpatialPoint
  viewCount: number
  maxBaseline: number
  maxViewAngle: number
  trackingQualitySum: number
  positionResidualSquaredSum: number
  depthResidualSquaredSum: number
  normalResidualSquaredSum: number
  provisional: boolean
  removed: boolean
  suspectedParallel: boolean
  sideSupport: boolean
}

const MATCH_OFFSETS = (() => {
  const values: Array<readonly [number, number, number]> = []
  for (let x = -2; x <= 2; x += 1) for (let y = -2; y <= 2; y += 1) for (let z = -2; z <= 2; z += 1) values.push([x, y, z])
  return values.sort((left, right) => left[0] ** 2 + left[1] ** 2 + left[2] ** 2 - right[0] ** 2 - right[1] ** 2 - right[2] ** 2)
})()

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))
const cell = (value: number): number => Math.floor(value / CANONICAL_REALITY_CONFIG.cellSizeMeters)
const key = (x: number, y: number, z: number): string => `${x}:${y}:${z}`
const pointKey = (point: SpatialPoint): string => key(cell(point.x), cell(point.y), cell(point.z))
const length = (point: SpatialPoint): number => Math.hypot(point.x, point.y, point.z)

function normalize(point: SpatialPoint): SpatialPoint {
  const magnitude = length(point)
  return magnitude > 1e-7
    ? { x: point.x / magnitude, y: point.y / magnitude, z: point.z / magnitude }
    : { x: 0, y: 0, z: 1 }
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

function consolidateFrame(frame: RetainedRealityMeasurementFrame): ConsolidatedObservation[] {
  const sourceToColor = new Int32Array(frame.denseFrame.valid.length)
  sourceToColor.fill(-1)
  for (let index = 0; index < frame.colorSourceIndices.length; index += 1) {
    const sourceIndex = frame.colorSourceIndices[index]
    if (sourceIndex >= 0 && sourceIndex < sourceToColor.length) sourceToColor[sourceIndex] = index
  }
  const representatives = new Map<string, ConsolidatedObservation>()
  for (let sourceIndex = 0; sourceIndex < frame.denseFrame.valid.length; sourceIndex += 1) {
    if (!frame.denseFrame.valid[sourceIndex] || !frame.normalValid[sourceIndex]) continue
    const offset = sourceIndex * 3
    const position = {
      x: frame.denseFrame.points[offset],
      y: frame.denseFrame.points[offset + 1],
      z: frame.denseFrame.points[offset + 2],
    }
    const normal = normalize({ x: frame.normals[offset], y: frame.normals[offset + 1], z: frame.normals[offset + 2] })
    if (![position.x, position.y, position.z, normal.x, normal.y, normal.z].every(Number.isFinite)) continue
    const consolidationCell = RETAINED_REALITY_CONFIG.consolidationCellMeters
    const spatialKey = `${Math.floor(position.x / consolidationCell)}:${Math.floor(position.y / consolidationCell)}:${Math.floor(position.z / consolidationCell)}`
    const colorIndex = sourceToColor[sourceIndex]
    const colorOffset = colorIndex * 3
    const color = colorIndex >= 0 ? {
      r: frame.srgbColors[colorOffset] / 255,
      g: frame.srgbColors[colorOffset + 1] / 255,
      b: frame.srgbColors[colorOffset + 2] / 255,
    } : null
    const existing = representatives.get(spatialKey)
    if (existing) {
      // Geometry remains an actual measured representative. Real registered
      // RGB is accumulated independently so an earlier uncolored sample in the
      // same voxel cannot erase available camera evidence.
      if (color) {
        if (!existing.color) existing.color = color
        else {
          const nextCount = existing.colorCount + 1
          existing.color.r += (color.r - existing.color.r) / nextCount
          existing.color.g += (color.g - existing.color.g) / nextCount
          existing.color.b += (color.b - existing.color.b) / nextCount
        }
        existing.colorCount += 1
      }
      continue
    }
    representatives.set(spatialKey, {
      sourceIndex,
      position,
      normal,
      color,
      colorCount: color ? 1 : 0,
    })
  }
  const observations = [...representatives.values()]
  if (observations.length <= RETAINED_REALITY_CONFIG.maxConsolidatedSamplesPerFrame) return observations
  const stride = observations.length / RETAINED_REALITY_CONFIG.maxConsolidatedSamplesPerFrame
  return Array.from({ length: RETAINED_REALITY_CONFIG.maxConsolidatedSamplesPerFrame }, (_unused, index) => observations[Math.floor(index * stride)])
}

function calculateBounds(surfels: readonly FinalizedRealitySurfel[]): SpatialBounds | null {
  if (!surfels.length) return null
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const surfel of surfels) {
    min.x = Math.min(min.x, surfel.position.x); min.y = Math.min(min.y, surfel.position.y); min.z = Math.min(min.z, surfel.position.z)
    max.x = Math.max(max.x, surfel.position.x); max.y = Math.max(max.y, surfel.position.y); max.z = Math.max(max.z, surfel.position.z)
  }
  return { min, max }
}

function calculateColorStatistics(surfels: readonly FinalizedRealitySurfel[]): RealityColorStatistics {
  const colors = surfels.flatMap((surfel) => surfel.colorRgb ? [surfel.colorRgb] : [])
  if (!colors.length) return { colorSpace: 'srgb', sampleCount: 0, min: { r: 0, g: 0, b: 0 }, max: { r: 0, g: 0, b: 0 }, mean: { r: 0, g: 0, b: 0 }, nonWhiteSampleCount: 0, uniqueApproximateColorCount: 0 }
  const min = { r: 1, g: 1, b: 1 }, max = { r: 0, g: 0, b: 0 }, mean = { r: 0, g: 0, b: 0 }, unique = new Set<string>()
  let nonWhite = 0
  for (const color of colors) {
    min.r = Math.min(min.r, color.r); min.g = Math.min(min.g, color.g); min.b = Math.min(min.b, color.b)
    max.r = Math.max(max.r, color.r); max.g = Math.max(max.g, color.g); max.b = Math.max(max.b, color.b)
    mean.r += color.r; mean.g += color.g; mean.b += color.b
    if (Math.min(color.r, color.g, color.b) < .98 || Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) > .01) nonWhite += 1
    if (unique.size < 1024) unique.add(`${Math.round(color.r * 31)}:${Math.round(color.g * 31)}:${Math.round(color.b * 31)}`)
  }
  mean.r /= colors.length; mean.g /= colors.length; mean.b /= colors.length
  return { colorSpace: 'srgb', sampleCount: colors.length, min, max, mean, nonWhiteSampleCount: nonWhite, uniqueApproximateColorCount: unique.size }
}

/** Deterministic, order-normalized post-scan surfel fusion. No structural/M7 input is accepted. */
export class CanonicalRealityFusionService {
  public reconstruct(
    snapshot: RetainedRealityMeasurementSnapshot,
    onStage?: (stage: CanonicalReconstructionStage) => void,
  ): CanonicalRealityFusionResult {
    const startedAt = performance.now()
    onStage?.('reconstructing-geometry')
    const frames = [...snapshot.frames].sort((left, right) => left.sequence - right.sequence || left.timestamp - right.timestamp)
    const surfels: MutableCanonicalSurfel[] = []
    const buckets = new Map<string, number[]>()
    let inputObservations = 0, consolidatedObservations = 0, sameFrameConsolidated = 0, matchedExisting = 0
    let provisionalCreated = 0, provisionalPromoted = 0, provisionalExpired = 0, canonicalMerges = 0
    let falseParallelLayersCollapsed = 0, trueSeparateLayersRetained = 0, outliersRejected = 0, layerCapacityRejected = 0
    let transitionExistingCanonical = 0, transitionExistingProvisional = 0, transitionNewCoherent = 0
    let transitionPossibleParallelDuplicate = 0, transitionTrueSeparatedLayer = 0, transitionOutlier = 0
    let baseColorInputObservations = 0, baseColorConsolidatedObservations = 0
    const retainedCoverage = new Set<string>(), consolidatedCoverage = new Set<string>()
    const expiryReasons = { insufficientTemporalSupport: 0, insufficientMultiViewSupport: 0,
      replacedByCanonical: 0, isolatedOrNoisy: 0, duplicateParallelLayer: 0, capacityOrLayerPolicy: 0, other: 0 }
    const expiryMapPositions: number[] = []
    const expiryMapReasonCodes: number[] = []
    let expiryMapTotal = 0
    const recordExpiry = (position: SpatialPoint, reason: ProvisionalExpiryReason): void => {
      expiryReasons[reason] += 1
      expiryMapTotal += 1
      if (expiryMapReasonCodes.length >= PROVISIONAL_EXPIRY_MAP_CAPACITY) return
      // Position is the measured observation/hypothesis position at the moment
      // it is removed; it is never inferred from a neighboring canonical surfel.
      expiryMapPositions.push(position.x, position.y, position.z)
      expiryMapReasonCodes.push(PROVISIONAL_EXPIRY_REASON[reason])
    }
    const trueSecondLayerReasons = { recessTopology: 0, objectOrOccludingSurface: 0, separateWall: 0, unknown: 0 }

    const addToBucket = (index: number): void => {
      const bucketKey = pointKey(surfels[index].position), entries = buckets.get(bucketKey)
      if (entries) entries.push(index); else buckets.set(bucketKey, [index])
    }
    const removeFromBucket = (index: number, oldKey: string): void => {
      const entries = buckets.get(oldKey)
      if (!entries) return
      const at = entries.indexOf(index)
      if (at >= 0) entries.splice(at, 1)
      if (!entries.length) buckets.delete(oldKey)
    }
    const coherentSupportCount = (index: number): number => {
      const source = surfels[index], cx = cell(source.position.x), cy = cell(source.position.y), cz = cell(source.position.z)
      let count = 0
      for (const [dxCell, dyCell, dzCell] of MATCH_OFFSETS) {
        const entries = buckets.get(key(cx + dxCell, cy + dyCell, cz + dzCell))
        if (!entries) continue
        for (const other of entries) {
          if (other === index || surfels[other].removed) continue
          const target = surfels[other]
          const distance = Math.hypot(source.position.x - target.position.x, source.position.y - target.position.y, source.position.z - target.position.z)
          const dot = Math.abs(source.normal.x * target.normal.x + source.normal.y * target.normal.y + source.normal.z * target.normal.z)
          if (distance <= .065 && dot >= .78 && target.observationCount >= 2) count += 1
          if (count >= 2) return count
        }
      }
      return count
    }
    const promoteDuringReplay = (index: number): void => {
      const surfel = surfels[index]
      if (!surfel.provisional || surfel.observationCount < 3 || surfel.lastTimestamp - surfel.firstTimestamp < 220) return
      if (surfel.viewCount < 2 && coherentSupportCount(index) < 2) return
      surfel.provisional = false
      provisionalPromoted += 1
    }

    for (const frame of frames) {
      inputObservations += frame.denseFrame.validPointCount
      baseColorInputObservations += frame.colorSourceIndices.length
      for (let sourceIndex = 0; sourceIndex < frame.denseFrame.valid.length; sourceIndex += 1) if (frame.denseFrame.valid[sourceIndex]) {
        const offset = sourceIndex * 3
        retainedCoverage.add(key(cell(frame.denseFrame.points[offset]), cell(frame.denseFrame.points[offset + 1]), cell(frame.denseFrame.points[offset + 2])))
      }
      const observations = consolidateFrame(frame)
      consolidatedObservations += observations.length
      baseColorConsolidatedObservations += observations.reduce((count, observation) => count + (observation.color ? 1 : 0), 0)
      observations.forEach((observation) => consolidatedCoverage.add(pointKey(observation.position)))
      sameFrameConsolidated += Math.max(0, frame.denseFrame.validPointCount - observations.length)
      for (const observation of observations) {
        const cellX = cell(observation.position.x), cellY = cell(observation.position.y), cellZ = cell(observation.position.z)
        let best = -1, bestScore = Infinity
        for (const [dxCell, dyCell, dzCell] of MATCH_OFFSETS) {
          const candidates = buckets.get(key(cellX + dxCell, cellY + dyCell, cellZ + dzCell))
          if (!candidates) continue
          for (const index of candidates) {
            const candidate = surfels[index]
            if (candidate.removed || candidate.lastFrameSequence === frame.sequence) continue
            const dx = observation.position.x - candidate.position.x
            const dy = observation.position.y - candidate.position.y
            const dz = observation.position.z - candidate.position.z
            const normalDot = Math.abs(observation.normal.x * candidate.normal.x + observation.normal.y * candidate.normal.y + observation.normal.z * candidate.normal.z)
            if (normalDot < CANONICAL_REALITY_CONFIG.minimumNormalDot) continue
            const planeResidual = Math.abs(dx * candidate.normal.x + dy * candidate.normal.y + dz * candidate.normal.z)
            if (planeResidual > CANONICAL_REALITY_CONFIG.matchPlaneResidualMeters) continue
            const distanceSquared = dx * dx + dy * dy + dz * dz
            const tangentDistance = Math.sqrt(Math.max(0, distanceSquared - planeResidual * planeResidual))
            if (tangentDistance > CANONICAL_REALITY_CONFIG.matchTangentDistanceMeters) continue
            const score = planeResidual / CANONICAL_REALITY_CONFIG.matchPlaneResidualMeters * 1.6 + tangentDistance / CANONICAL_REALITY_CONFIG.matchTangentDistanceMeters + (1 - normalDot)
            if (score < bestScore) { best = index; bestScore = score }
          }
        }

        if (best >= 0) {
          const candidate = surfels[best]
          const dx = observation.position.x - candidate.position.x
          const dy = observation.position.y - candidate.position.y
          const dz = observation.position.z - candidate.position.z
          const distance = Math.hypot(dx, dy, dz)
          const planeResidual = dx * candidate.normal.x + dy * candidate.normal.y + dz * candidate.normal.z
          const normalDot = clamp(Math.abs(observation.normal.x * candidate.normal.x + observation.normal.y * candidate.normal.y + observation.normal.z * candidate.normal.z), 0, 1)
          const denominator = Math.max(1, candidate.observationCount - 1)
          const establishedDepthRms = Math.sqrt(candidate.depthResidualSquaredSum / denominator)
          if (!candidate.provisional && candidate.observationCount >= 5 && Math.abs(planeResidual) > Math.max(.010, establishedDepthRms * 3.5)) {
            outliersRejected += 1; transitionOutlier += 1; continue
          }
          if (candidate.provisional) transitionExistingProvisional += 1
          else { transitionExistingCanonical += 1; canonicalMerges += 1 }
          const oldKey = pointKey(candidate.position)
          const blend = Math.min(.22, 1 / (candidate.observationCount + 1))
          const proposed = { x: dx * blend, y: dy * blend, z: dz * blend }
          const proposedLength = length(proposed)
          const scale = proposedLength > CANONICAL_REALITY_CONFIG.maximumUpdateMeters ? CANONICAL_REALITY_CONFIG.maximumUpdateMeters / proposedLength : 1
          candidate.position.x += proposed.x * scale; candidate.position.y += proposed.y * scale; candidate.position.z += proposed.z * scale
          const orientation = observation.normal.x * candidate.normal.x + observation.normal.y * candidate.normal.y + observation.normal.z * candidate.normal.z < 0 ? -1 : 1
          candidate.normal = normalize({
            x: candidate.normal.x + (observation.normal.x * orientation - candidate.normal.x) * blend,
            y: candidate.normal.y + (observation.normal.y * orientation - candidate.normal.y) * blend,
            z: candidate.normal.z + (observation.normal.z * orientation - candidate.normal.z) * blend,
          })
          candidate.positionResidualSquaredSum += distance * distance
          candidate.depthResidualSquaredSum += planeResidual * planeResidual
          candidate.normalResidualSquaredSum += (1 - normalDot) ** 2
          candidate.trackingQualitySum += frame.trackingQuality
          candidate.observationCount += 1
          candidate.lastTimestamp = frame.timestamp
          candidate.lastFrameSequence = frame.sequence
          const cameraDelta = {
            x: frame.cameraPosition.x - candidate.firstCamera.x,
            y: frame.cameraPosition.y - candidate.firstCamera.y,
            z: frame.cameraPosition.z - candidate.firstCamera.z,
          }
          const baseline = length(cameraDelta)
          const direction = normalize({ x: frame.cameraPosition.x - candidate.position.x, y: frame.cameraPosition.y - candidate.position.y, z: frame.cameraPosition.z - candidate.position.z })
          const angle = Math.acos(clamp(direction.x * candidate.firstViewDirection.x + direction.y * candidate.firstViewDirection.y + direction.z * candidate.firstViewDirection.z, -1, 1))
          candidate.maxBaseline = Math.max(candidate.maxBaseline, baseline); candidate.maxViewAngle = Math.max(candidate.maxViewAngle, angle)
          candidate.viewCount = baseline >= .3 && angle >= 5 * Math.PI / 180 ? 3 : baseline >= .08 || angle >= 3 * Math.PI / 180 ? Math.max(2, candidate.viewCount) : candidate.viewCount
          if (observation.color) {
            if (!candidate.color) candidate.color = { ...observation.color }
            else {
              const colorBlend = 1 / Math.min(8, candidate.colorCount + 1)
              candidate.color.r += (observation.color.r - candidate.color.r) * colorBlend
              candidate.color.g += (observation.color.g - candidate.color.g) * colorBlend
              candidate.color.b += (observation.color.b - candidate.color.b) * colorBlend
            }
            candidate.colorCount += 1
          }
          const newKey = pointKey(candidate.position)
          if (newKey !== oldKey) { removeFromBucket(best, oldKey); addToBucket(best) }
          matchedExisting += 1
          promoteDuringReplay(best)
          continue
        }

        if (surfels.length >= CANONICAL_REALITY_CONFIG.maxSurfels) { layerCapacityRejected += 1; recordExpiry(observation.position, 'capacityOrLayerPolicy'); continue }
        const localBucket = buckets.get(pointKey(observation.position))
        if (localBucket && localBucket.filter((index) => !surfels[index].removed).length >= CANONICAL_REALITY_CONFIG.maxLayersPerCell) { layerCapacityRejected += 1; recordExpiry(observation.position, 'capacityOrLayerPolicy'); continue }
        const viewDirection = normalize({
          x: frame.cameraPosition.x - observation.position.x,
          y: frame.cameraPosition.y - observation.position.y,
          z: frame.cameraPosition.z - observation.position.z,
        })
        const index = surfels.length
        surfels.push({
          position: { ...observation.position }, normal: { ...observation.normal }, color: observation.color ? { ...observation.color } : null,
          colorCount: observation.color ? 1 : 0, observationCount: 1, firstTimestamp: frame.timestamp, lastTimestamp: frame.timestamp,
          lastFrameSequence: frame.sequence, firstCamera: { ...frame.cameraPosition }, firstViewDirection: viewDirection, viewCount: 1,
          maxBaseline: 0, maxViewAngle: 0, trackingQualitySum: frame.trackingQuality, positionResidualSquaredSum: 0,
          depthResidualSquaredSum: 0, normalResidualSquaredSum: 0, provisional: true, removed: false,
          suspectedParallel: false, sideSupport: false,
        })
        addToBucket(index); provisionalCreated += 1; transitionNewCoherent += 1
      }
    }

    onStage?.('cleaning-surfaces')
    const topologyBuckets = new Map<string, number[]>()
    const topologyCell = .08
    for (let index = 0; index < surfels.length; index += 1) {
      const surfel = surfels[index]
      const topologyKey = key(Math.floor(surfel.position.x / topologyCell), Math.floor(surfel.position.y / topologyCell), Math.floor(surfel.position.z / topologyCell))
      const entries = topologyBuckets.get(topologyKey)
      if (entries) entries.push(index); else topologyBuckets.set(topologyKey, [index])
    }
    const nearby = (index: number, radius: number, visitor: (other: number, distance: number) => void): void => {
      const surfel = surfels[index], cx = Math.floor(surfel.position.x / topologyCell), cy = Math.floor(surfel.position.y / topologyCell), cz = Math.floor(surfel.position.z / topologyCell)
      const cells = Math.ceil(radius / topologyCell)
      for (let x = -cells; x <= cells; x += 1) for (let y = -cells; y <= cells; y += 1) for (let z = -cells; z <= cells; z += 1) {
        const entries = topologyBuckets.get(key(cx + x, cy + y, cz + z))
        if (!entries) continue
        for (const other of entries) if (other !== index && !surfels[other].removed) {
          const target = surfels[other]
          const distance = Math.hypot(surfel.position.x - target.position.x, surfel.position.y - target.position.y, surfel.position.z - target.position.z)
          if (distance <= radius) visitor(other, distance)
        }
      }
    }

    for (let index = 0; index < surfels.length; index += 1) {
      const surfel = surfels[index]
      let coherentNeighbors = 0
      nearby(index, .065, (other) => {
        const target = surfels[other]
        const dot = Math.abs(surfel.normal.x * target.normal.x + surfel.normal.y * target.normal.y + surfel.normal.z * target.normal.z)
        if (dot >= .78 && target.observationCount >= 2) coherentNeighbors += 1
        if (dot <= .62 && target.observationCount >= 2) surfel.sideSupport = true
      })
      const span = surfel.lastTimestamp - surfel.firstTimestamp
      const promotable = surfel.observationCount >= 3 && span >= 220 && (coherentNeighbors >= 2 || surfel.viewCount >= 2)
      if (!surfel.provisional) continue
      if (promotable) { surfel.provisional = false; provisionalPromoted += 1 }
      else {
        surfel.removed = true; provisionalExpired += 1
        if (surfel.observationCount < 3 || span < 220) recordExpiry(surfel.position, 'insufficientTemporalSupport')
        else if (coherentNeighbors === 0 && surfel.viewCount < 2) recordExpiry(surfel.position, 'isolatedOrNoisy')
        else if (surfel.viewCount < 2) recordExpiry(surfel.position, 'insufficientMultiViewSupport')
        else recordExpiry(surfel.position, 'other')
      }
    }

    // Resolve overlapping near-parallel hypotheses only after all frames have
    // contributed. This avoids arrival-order ownership and lets real side-face
    // topology or diverse views defend a physical second surface.
    for (let index = 0; index < surfels.length; index += 1) {
      const surfel = surfels[index]
      if (surfel.removed) continue
      nearby(index, CANONICAL_REALITY_CONFIG.falseParallelMaximumMeters, (other) => {
        if (other <= index || surfel.removed || surfels[other].removed) return
        const target = surfels[other]
        const dx = target.position.x - surfel.position.x, dy = target.position.y - surfel.position.y, dz = target.position.z - surfel.position.z
        const normalDot = Math.abs(surfel.normal.x * target.normal.x + surfel.normal.y * target.normal.y + surfel.normal.z * target.normal.z)
        if (normalDot < .94) return
        const separation = Math.abs(dx * surfel.normal.x + dy * surfel.normal.y + dz * surfel.normal.z)
        const tangent = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - separation * separation))
        if (separation < CANONICAL_REALITY_CONFIG.falseParallelMinimumMeters || separation > CANONICAL_REALITY_CONFIG.falseParallelMaximumMeters || tangent > .05) return
        surfel.suspectedParallel = true; target.suspectedParallel = true; transitionPossibleParallelDuplicate += 1
        const surfelStrength = surfel.observationCount + surfel.viewCount * 2 + (surfel.sideSupport ? 4 : 0)
        const targetStrength = target.observationCount + target.viewCount * 2 + (target.sideSupport ? 4 : 0)
        const weaker = surfelStrength <= targetStrength ? surfel : target
        const stronger = weaker === surfel ? target : surfel
        const defendedPhysicalLayer = weaker.sideSupport || (separation >= .07 && weaker.viewCount >= 2 && weaker.observationCount >= 3)
        if (defendedPhysicalLayer) {
          trueSeparateLayersRetained += 1; transitionTrueSeparatedLayer += 1
          if (weaker.sideSupport) trueSecondLayerReasons.recessTopology += 1
          else if (separation < .095) trueSecondLayerReasons.objectOrOccludingSurface += 1
          else trueSecondLayerReasons.unknown += 1
          return
        }
        if (stronger.observationCount >= weaker.observationCount * 1.45 || stronger.viewCount > weaker.viewCount) {
          weaker.removed = true; falseParallelLayersCollapsed += 1; recordExpiry(weaker.position, 'duplicateParallelLayer')
        }
      })
    }

    onStage?.('applying-room-appearance')
    const retained = surfels.filter((surfel) => !surfel.removed && !surfel.provisional)
    const finalSurfels = retained.map((surfel, id): FinalizedRealitySurfel => {
      const denominator = Math.max(1, surfel.observationCount - 1)
      const geometryConfidence = clamp(.35 + Math.min(1, surfel.observationCount / 6) * .3 + Math.min(1, surfel.viewCount / 2) * .2 + surfel.trackingQualitySum / Math.max(1, surfel.observationCount) * .15, 0, 1)
      return Object.freeze({
        id,
        position: Object.freeze({ ...surfel.position }),
        normal: Object.freeze({ ...surfel.normal }),
        radius: CANONICAL_REALITY_CONFIG.cellSizeMeters / 2,
        colorRgb: surfel.color ? Object.freeze({ ...surfel.color }) : null,
        colorSpace: 'srgb' as const,
        geometryConfidence,
        geometryObservationCount: surfel.observationCount,
        viewObservationCount: surfel.viewCount,
        firstObservedAt: surfel.firstTimestamp,
        lastObservedAt: surfel.lastTimestamp,
        positionVarianceMetersSquared: surfel.positionResidualSquaredSum / denominator,
        depthVarianceMetersSquared: surfel.depthResidualSquaredSum / denominator,
        normalVariance: surfel.normalResidualSquaredSum / denominator,
        trackingQuality: surfel.trackingQualitySum / Math.max(1, surfel.observationCount),
        duplicateSurfaceCandidate: surfel.suspectedParallel,
        stabilityClass: 'high' as const,
        colorConfidence: Math.min(1, surfel.colorCount / 4),
        colorObservationCount: surfel.colorCount,
      })
    })
    const thickness = retained.map((surfel) => Math.sqrt(surfel.depthResidualSquaredSum / Math.max(1, surfel.observationCount - 1)) * 2)
    const dominantPlanarThickness: number[] = []
    for (let index = 0; index < surfels.length; index += 1) {
      const surfel = surfels[index]
      if (surfel.removed || surfel.provisional || coherentSupportCount(index) < 2) continue
      dominantPlanarThickness.push(Math.sqrt(surfel.depthResidualSquaredSum / Math.max(1, surfel.observationCount - 1)) * 2)
    }
    const observations = retained.reduce((total, surfel) => total + surfel.observationCount, 0)
    const baseColorCanonicalSurfels = retained.reduce((count, surfel) => count + (surfel.color ? 1 : 0), 0)
    const summarizeStage = (name: CanonicalCompletenessStage['name'], count: number, prior: number, coverage: number): CanonicalCompletenessStage => Object.freeze({
      name, count, percentageOfPrior: prior > 0 ? count / prior * 100 : 0, spatialCoverageCells: coverage,
      surfaceAreaProxySquareMeters: coverage * CANONICAL_REALITY_CONFIG.cellSizeMeters ** 2,
    })
    const provisionalCoverage = new Set(surfels.map((surfel) => pointKey(surfel.position))).size
    const promotedCoverage = new Set(retained.map((surfel) => pointKey(surfel.position))).size
    const completenessStages = Object.freeze([
      summarizeStage('retained-measured', inputObservations, inputObservations, retainedCoverage.size),
      summarizeStage('per-frame-consolidated', consolidatedObservations, inputObservations, consolidatedCoverage.size),
      summarizeStage('provisional-created', provisionalCreated, consolidatedObservations, provisionalCoverage),
      summarizeStage('promoted-canonical', finalSurfels.length, provisionalCreated, promotedCoverage),
    ])
    const diagnostics: CanonicalRealityFusionDiagnostics = Object.freeze({
      inputFrames: frames.length, inputObservations, consolidatedObservations, sameFrameConsolidated, matchedExisting,
      provisionalCreated, provisionalPromoted, provisionalExpired, canonicalMerges, falseParallelLayersCollapsed,
      trueSeparateLayersRetained, outliersRejected, layerCapacityRejected, canonicalSurfels: finalSurfels.length,
      observationsPerCanonicalSurfel: observations / Math.max(1, finalSurfels.length),
      wallThicknessP50Meters: percentile(thickness, .5), wallThicknessP90Meters: percentile(thickness, .9), wallThicknessP95Meters: percentile(thickness, .95),
      workerTimeMs: performance.now() - startedAt,
      numericMemoryBytes: snapshot.diagnostics.memoryBytes + surfels.length * 128,
      transitionExistingCanonical, transitionExistingProvisional, transitionNewCoherent,
      transitionPossibleParallelDuplicate, transitionTrueSeparatedLayer, transitionOutlier,
      baseColorInputObservations, baseColorConsolidatedObservations, baseColorCanonicalSurfels,
      baseColorCoveragePercentage: baseColorCanonicalSurfels / Math.max(1, finalSurfels.length) * 100,
      expiryReasons: Object.freeze(expiryReasons),
      provisionalExpiryMap: Object.freeze({
        capacity: PROVISIONAL_EXPIRY_MAP_CAPACITY,
        total: expiryMapTotal,
        sampled: expiryMapReasonCodes.length,
        omitted: expiryMapTotal - expiryMapReasonCodes.length,
        positions: new Float32Array(expiryMapPositions),
        reasonCodes: new Uint8Array(expiryMapReasonCodes),
      }),
      trueSecondLayerReasons: Object.freeze(trueSecondLayerReasons),
      dominantPlanarThicknessP50Meters: percentile(dominantPlanarThickness, .5),
      dominantPlanarThicknessP90Meters: percentile(dominantPlanarThickness, .9),
      dominantPlanarThicknessP95Meters: percentile(dominantPlanarThickness, .95),
      dominantPlanarSurfelCount: dominantPlanarThickness.length,
      completenessStages,
    })
    return Object.freeze({ surfels: Object.freeze(finalSurfels), diagnostics, bounds: calculateBounds(finalSurfels), colorStatistics: calculateColorStatistics(finalSurfels) })
  }
}

import type {
  DenseRealityFusionDebug,
  DenseSpatialPointFrame,
  FinalizedDenseRealityReconstruction,
  FinalizedRealitySurfel,
  RealityCaptureSummary,
  RealityColorStatistics,
  RealityRgbColor,
  ScannerReferenceSpaceType,
  SpatialBounds,
  SpatialPoint,
  ViewerPosition,
} from '../types'
import type { PersistentLiveSurfaceService } from './persistentLiveSurfaceService'
import type { RgbDepthRegistrationResult } from './rgbDepthRegistrationService'
import type { RealityFrameConsistency } from './realityMeasurementStabilityService'

export interface DenseRealityMeasurementContext {
  readonly frameSequence: number
  readonly trackingQuality: number
}

export const DENSE_REALITY_CONFIG = Object.freeze({
  cellSizeMeters: 0.025,
  maxSamples: 60000,
  // The physical M8.7.1 median spacing was 2.2 cm. A 2.1 cm merge radius
  // therefore forced repeat phase samples to become new surfels. Tangential
  // matching may span a little more than one cell, while the tighter
  // point-to-plane limit continues to preserve separate depth layers.
  maxMergeDistanceMeters: 0.034,
  maxPointToPlaneResidualMeters: 0.014,
  minNormalDot: Math.cos(40 * Math.PI / 180),
  maxCandidatesPerSample: 96,
  minimumStableObservations: 2,
  sampleRadiusMeters: 0.0125,
})

const MAX_COLOR_WEIGHT = 16
const MIN_COLOR_OUTLIER_OBSERVATIONS = 3
const COLOR_OUTLIER_DISTANCE = 0.5
const VECTOR_EPSILON = 1e-6
const DENSITY_CELL_SIZE_METERS = 0.05
const SMALL_GAP_LIMIT_METERS = 0.04
const LARGE_GAP_LIMIT_METERS = 0.12
const MAX_DENSITY_CANDIDATES = 64
const VIEW_DIVERSITY_BASELINE_METERS = 0.06
const VIEW_DIVERSITY_ANGLE_RADIANS = 2.5 * Math.PI / 180
const STRONG_VIEW_BASELINE_METERS = 0.15
const STABLE_BUCKET_SIZE_METERS = 0.10

const MATCH_CELL_OFFSETS = (() => {
  const offsets: Array<readonly [number, number, number]> = []
  for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
    offsets.push([x, y, z])
  }
  return offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 + a[2] ** 2 - b[0] ** 2 - b[1] ** 2 - b[2] ** 2)
})()

function getTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function srgbToLinear(value: number): number {
  const normalized = clamp(value / 255, 0, 1)
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function linearToSrgb(value: number): number {
  const normalized = clamp(value, 0, 1)
  return normalized <= 0.0031308
    ? normalized * 12.92
    : 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055
}

function copyPoint(point: SpatialPoint): Readonly<SpatialPoint> {
  return Object.freeze({ x: point.x, y: point.y, z: point.z })
}

function normalize(point: SpatialPoint, target: SpatialPoint): boolean {
  const length = Math.hypot(point.x, point.y, point.z)
  if (!Number.isFinite(length) || length <= VECTOR_EPSILON) {
    return false
  }

  target.x = point.x / length
  target.y = point.y / length
  target.z = point.z / length
  return true
}

function getCellCoordinate(value: number): number {
  return Math.floor(value / DENSE_REALITY_CONFIG.cellSizeMeters)
}

function getCellKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`
}

function getPointCellKey(point: SpatialPoint): string {
  return getCellKey(
    getCellCoordinate(point.x),
    getCellCoordinate(point.y),
    getCellCoordinate(point.z),
  )
}

function getDensityCellKey(point: SpatialPoint): string {
  return `${Math.floor(point.x / DENSITY_CELL_SIZE_METERS)}:${Math.floor(point.y / DENSITY_CELL_SIZE_METERS)}:${Math.floor(point.z / DENSITY_CELL_SIZE_METERS)}`
}

function calculateBounds(surfels: readonly FinalizedRealitySurfel[]): SpatialBounds | null {
  if (surfels.length === 0) {
    return null
  }

  const minimum = { x: Infinity, y: Infinity, z: Infinity }
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const surfel of surfels) {
    minimum.x = Math.min(minimum.x, surfel.position.x)
    minimum.y = Math.min(minimum.y, surfel.position.y)
    minimum.z = Math.min(minimum.z, surfel.position.z)
    maximum.x = Math.max(maximum.x, surfel.position.x)
    maximum.y = Math.max(maximum.y, surfel.position.y)
    maximum.z = Math.max(maximum.z, surfel.position.z)
  }

  return Object.freeze({
    min: copyPoint(minimum),
    max: copyPoint(maximum),
  })
}

function calculateColorStatistics(
  surfels: readonly FinalizedRealitySurfel[],
): RealityColorStatistics {
  let sampleCount = 0
  let nonWhiteSampleCount = 0
  let redTotal = 0
  let greenTotal = 0
  let blueTotal = 0
  let minRed = Infinity
  let minGreen = Infinity
  let minBlue = Infinity
  let maxRed = -Infinity
  let maxGreen = -Infinity
  let maxBlue = -Infinity
  const uniqueColors = new Set<string>()

  for (const surfel of surfels) {
    const color = surfel.colorRgb
    if (!color) {
      continue
    }
    sampleCount += 1
    redTotal += color.r
    greenTotal += color.g
    blueTotal += color.b
    minRed = Math.min(minRed, color.r)
    minGreen = Math.min(minGreen, color.g)
    minBlue = Math.min(minBlue, color.b)
    maxRed = Math.max(maxRed, color.r)
    maxGreen = Math.max(maxGreen, color.g)
    maxBlue = Math.max(maxBlue, color.b)
    if (Math.min(color.r, color.g, color.b) < 0.98 || Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) > 0.01) {
      nonWhiteSampleCount += 1
    }
    if (uniqueColors.size < 1024) {
      uniqueColors.add(`${Math.round(color.r * 31)}:${Math.round(color.g * 31)}:${Math.round(color.b * 31)}`)
    }
  }

  if (sampleCount === 0) {
    return {
      colorSpace: 'srgb',
      sampleCount: 0,
      min: { r: 0, g: 0, b: 0 },
      max: { r: 0, g: 0, b: 0 },
      mean: { r: 0, g: 0, b: 0 },
      nonWhiteSampleCount: 0,
      uniqueApproximateColorCount: 0,
    }
  }

  return {
    colorSpace: 'srgb',
    sampleCount,
    min: { r: minRed, g: minGreen, b: minBlue },
    max: { r: maxRed, g: maxGreen, b: maxBlue },
    mean: {
      r: redTotal / sampleCount,
      g: greenTotal / sampleCount,
      b: blueTotal / sampleCount,
    },
    nonWhiteSampleCount,
    uniqueApproximateColorCount: uniqueColors.size,
  }
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index] ?? null
}

function createDensitySummary(
  surfels: readonly FinalizedRealitySurfel[],
  capacity: number,
  capacityUsed: number,
  capacityReached: boolean,
): Pick<
  RealityCaptureSummary,
  | 'averageNearestNeighborSpacingMeters'
  | 'medianNearestNeighborSpacingMeters'
  | 'p90NearestNeighborSpacingMeters'
  | 'approximateUncoveredGapMeters'
  | 'estimatedSmallGapRegionCount'
  | 'estimatedLargeUnsupportedGapCount'
  | 'surfelCapacity'
  | 'capacityUtilizationPercentage'
  | 'capacityReached'
> {
  const capacityUtilizationPercentage = capacity > 0
    ? Math.min(100, (capacityUsed / capacity) * 100)
    : 0
  if (surfels.length < 2) {
    return {
      averageNearestNeighborSpacingMeters: null,
      medianNearestNeighborSpacingMeters: null,
      p90NearestNeighborSpacingMeters: null,
      approximateUncoveredGapMeters: null,
      estimatedSmallGapRegionCount: 0,
      estimatedLargeUnsupportedGapCount: 0,
      surfelCapacity: capacity,
      capacityUtilizationPercentage,
      capacityReached,
    }
  }

  const cells = new Map<string, number[]>()
  for (let index = 0; index < surfels.length; index += 1) {
    const key = getDensityCellKey(surfels[index].position)
    const cell = cells.get(key)
    if (cell) {
      cell.push(index)
    } else {
      cells.set(key, [index])
    }
  }

  const nearestDistances: number[] = []
  let smallGapCount = 0
  let largeGapCount = 0
  let spacingTotal = 0
  for (let index = 0; index < surfels.length; index += 1) {
    const surfel = surfels[index]
    const cellX = Math.floor(surfel.position.x / DENSITY_CELL_SIZE_METERS)
    const cellY = Math.floor(surfel.position.y / DENSITY_CELL_SIZE_METERS)
    const cellZ = Math.floor(surfel.position.z / DENSITY_CELL_SIZE_METERS)
    let nearestDistanceSquared = Infinity
    let candidatesChecked = 0
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
          const neighborCell = cells.get(getCellKey(cellX + offsetX, cellY + offsetY, cellZ + offsetZ))
          if (!neighborCell) {
            continue
          }
          for (const neighborIndex of neighborCell) {
            if (neighborIndex === index || candidatesChecked >= MAX_DENSITY_CANDIDATES) {
              continue
            }
            candidatesChecked += 1
            const neighbor = surfels[neighborIndex]
            const dx = surfel.position.x - neighbor.position.x
            const dy = surfel.position.y - neighbor.position.y
            const dz = surfel.position.z - neighbor.position.z
            nearestDistanceSquared = Math.min(
              nearestDistanceSquared,
              dx * dx + dy * dy + dz * dz,
            )
          }
        }
      }
    }

    if (!Number.isFinite(nearestDistanceSquared)) {
      largeGapCount += 1
      continue
    }

    const nearestDistance = Math.sqrt(nearestDistanceSquared)
    nearestDistances.push(nearestDistance)
    spacingTotal += nearestDistance
    const gap = nearestDistance - surfel.radius * 2
    if (gap > 0 && gap <= SMALL_GAP_LIMIT_METERS) {
      smallGapCount += 1
    } else if (gap > LARGE_GAP_LIMIT_METERS) {
      largeGapCount += 1
    }
  }

  const averageSpacing = nearestDistances.length > 0
    ? spacingTotal / nearestDistances.length
    : null
  return {
    averageNearestNeighborSpacingMeters: averageSpacing,
    medianNearestNeighborSpacingMeters: percentile(nearestDistances, 0.5),
    p90NearestNeighborSpacingMeters: percentile(nearestDistances, 0.9),
    approximateUncoveredGapMeters: averageSpacing === null
      ? null
      : Math.max(0, averageSpacing - (surfels.reduce((total, surfel) => total + surfel.radius, 0) / surfels.length) * 2),
    estimatedSmallGapRegionCount: smallGapCount,
    estimatedLargeUnsupportedGapCount: largeGapCount,
    surfelCapacity: capacity,
    capacityUtilizationPercentage,
    capacityReached,
  }
}

function createInitialDiagnostics(): DenseRealityFusionDebug {
  return {
    status: 'idle',
    inputSampleCount: 0,
    inputColorSampleCount: 0,
    createdSampleCount: 0,
    fusedSampleCount: 0,
    rejectedSampleCount: 0,
    activeSampleCount: 0,
    stableSampleCount: 0,
    capacity: DENSE_REALITY_CONFIG.maxSamples,
    capacityUtilizationPercentage: 0,
    capacityReached: false,
    fusionMs: 0,
    lastCaptureTimestamp: null,
    lastCameraSequence: null,
    cameraCapturesUsed: 0,
  }
}

export function createInitialDenseRealityFusionDebug(): DenseRealityFusionDebug {
  return createInitialDiagnostics()
}

/**
 * Maintains a visual-only, finer RGB-D store. Structural geometry remains
 * owned by PersistentLiveSurfaceService; this service never matches or edits
 * structural surfels.
 */
export class DenseRealityReconstructionService {
  private readonly positions = new Float32Array(DENSE_REALITY_CONFIG.maxSamples * 3)

  private readonly normals = new Float32Array(DENSE_REALITY_CONFIG.maxSamples * 3)

  private readonly linearColors = new Float32Array(DENSE_REALITY_CONFIG.maxSamples * 3)

  private readonly colorWeights = new Float32Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly colorObservationCounts = new Uint32Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly geometryObservationCounts = new Uint32Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly viewMasks = new Uint16Array(DENSE_REALITY_CONFIG.maxSamples)
  // Bounded diagnostics/diversity state: centimetres, signed normalized
  // direction, centimetres and degrees respectively.
  private readonly firstViewPositions = new Int16Array(DENSE_REALITY_CONFIG.maxSamples * 3)
  private readonly firstViewDirections = new Int8Array(DENSE_REALITY_CONFIG.maxSamples * 3)
  private readonly maximumViewBaselines = new Uint8Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly maximumViewAngles = new Uint8Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly lastFrameSequences = new Uint32Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly trackingQualitySums = new Float32Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly positionResidualSquaredSums = new Float32Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly depthResidualSquaredSums = new Float32Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly normalResidualSquaredSums = new Float32Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly duplicateSurfaceCandidates = new Uint8Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly stable = new Uint8Array(DENSE_REALITY_CONFIG.maxSamples)
  private colorObservationBySource = new Int32Array(0)

  private readonly lastObservedAt = new Float64Array(DENSE_REALITY_CONFIG.maxSamples)
  private readonly createdAt = new Float64Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly active = new Uint8Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly nextInCell = new Int32Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly cellHeads = new Map<string, number>()
  private readonly stableBuckets = new Map<string, number[]>()
  private readonly stableBucketIndexed = new Uint8Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly samplePoint: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly sampleNormal: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly cameraVector: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly normalizedCameraVector: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly normalScratch: SpatialPoint = { x: 0, y: 0, z: 0 }

  private bestMatchDistance = 0
  private lastMatchFailure: 'distance' | 'normal' | 'depth-layer' | 'bucket' | 'candidate-budget' = 'bucket'

  private activeSampleCount = 0

  private stableSampleCount = 0

  private capacityReached = false
  private reclaimCursor = 0
  private reclaimedSamples = 0
  private capacityRejected = 0
  private sameFrameDuplicateCount = 0
  private duplicateSurfaceCandidateCount = 0
  private viewDiverseSampleCount = 0
  private singleViewSampleCount = 0
  private matchDistanceRejectCount = 0
  private matchNormalRejectCount = 0
  private matchDepthLayerRejectCount = 0
  private matchBucketMissCount = 0
  private matchCandidateBudgetRejectCount = 0
  private readonly fusionDurations: number[] = []

  private totalCreatedSampleCount = 0

  private totalFusedSampleCount = 0

  private totalRejectedSampleCount = 0

  private totalInputSampleCount = 0

  private totalInputColorSampleCount = 0

  private lastCameraSequence: number | null = null

  private cameraCapturesUsed = 0

  private diagnostics = createInitialDiagnostics()
  private fallbackFrameSequence = 0

  constructor() {
    this.nextInCell.fill(-1)
  }

  public process(
    registration: RgbDepthRegistrationResult | null,
    denseFrame: DenseSpatialPointFrame,
    persistentSurfaceService: PersistentLiveSurfaceService,
    cameraPosition: ViewerPosition | null,
    timestamp: number,
    context?: DenseRealityMeasurementContext,
  ): void {
    const startedAt = getTimestamp()
    this.totalInputSampleCount += denseFrame.validPointCount
    this.totalInputColorSampleCount += registration?.coloredSampleCount ?? 0
    if (registration && registration.cameraCopySequence >= 0 && registration.cameraCopySequence !== this.lastCameraSequence) {
      this.lastCameraSequence = registration.cameraCopySequence
      this.cameraCapturesUsed += 1
    }

    const frameSequence = context?.frameSequence ?? ++this.fallbackFrameSequence
    const trackingQuality = clamp(context?.trackingQuality ?? 1, 0, 1)
    let createdCount = 0
    let fusedCount = 0
    let rejectedCount = 0
    if(this.colorObservationBySource.length<denseFrame.valid.length)this.colorObservationBySource=new Int32Array(denseFrame.valid.length)
    this.colorObservationBySource.fill(-1,0,denseFrame.valid.length)
    if(registration)for(let observationIndex=0;observationIndex<registration.coloredSampleCount;observationIndex++)this.colorObservationBySource[registration.sourceSampleIndices[observationIndex]]=observationIndex
    for (let sourceIndex = 0; sourceIndex < denseFrame.valid.length; sourceIndex += 1) {
      if (
        sourceIndex < 0 ||
        sourceIndex >= denseFrame.valid.length ||
        denseFrame.valid[sourceIndex] !== 1
      ) {
        rejectedCount += 1
        continue
      }

      const pointOffset = sourceIndex * 3
      this.samplePoint.x = denseFrame.points[pointOffset]
      this.samplePoint.y = denseFrame.points[pointOffset + 1]
      this.samplePoint.z = denseFrame.points[pointOffset + 2]
      if (!Number.isFinite(this.samplePoint.x) || !Number.isFinite(this.samplePoint.y) || !Number.isFinite(this.samplePoint.z)) {
        rejectedCount += 1
        continue
      }

      if (!persistentSurfaceService.copySampleNormal(sourceIndex, this.sampleNormal)) {
        rejectedCount += 1
        continue
      }

      const colorObservation=this.colorObservationBySource[sourceIndex],colorOffset=colorObservation*3,hasColor=registration!==null&&colorObservation>=0
      const red = hasColor ? srgbToLinear(registration.srgbColors[colorOffset]) : 0
      const green = hasColor ? srgbToLinear(registration.srgbColors[colorOffset + 1]) : 0
      const blue = hasColor ? srgbToLinear(registration.srgbColors[colorOffset + 2]) : 0
      if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
        rejectedCount += 1
        continue
      }

      const matchIndex = this.findCompatibleSample(this.samplePoint, this.sampleNormal, frameSequence)
      if (matchIndex >= 0) {
        this.recordView(matchIndex, cameraPosition)
        if (this.fuseSample(matchIndex, this.bestMatchDistance, red, green, blue, cameraPosition, timestamp, hasColor, frameSequence, trackingQuality)) {
          fusedCount += 1
        } else {
          rejectedCount += 1
        }
        continue
      }

      if (this.lastMatchFailure === 'distance') this.matchDistanceRejectCount++
      else if (this.lastMatchFailure === 'normal') this.matchNormalRejectCount++
      else if (this.lastMatchFailure === 'depth-layer') this.matchDepthLayerRejectCount++
      else if (this.lastMatchFailure === 'candidate-budget') this.matchCandidateBudgetRejectCount++
      else this.matchBucketMissCount++

      if (this.activeSampleCount >= DENSE_REALITY_CONFIG.maxSamples) {
        this.capacityReached = true
        // Keep confirmed geometry. Reuse only a stale, never-confirmed slot,
        // examining a fixed budget so entering a new extension stays bounded.
        let reclaimed = -1
        for (let attempt = 0; attempt < 16; attempt++) {
          const slot = this.reclaimCursor++ % DENSE_REALITY_CONFIG.maxSamples
          if (this.geometryObservationCounts[slot] < 2 && timestamp - this.lastObservedAt[slot] > 8000) { reclaimed = slot; break }
        }
        if (reclaimed < 0) { this.capacityRejected++; rejectedCount++; continue }
        this.unlinkCell(reclaimed)
        this.createSample(this.samplePoint, this.sampleNormal, red, green, blue, timestamp, reclaimed, hasColor, frameSequence, trackingQuality)
        this.recordView(reclaimed, cameraPosition)
        this.reclaimedSamples++; createdCount++; continue
      }

      this.createSample(this.samplePoint, this.sampleNormal, red, green, blue, timestamp, undefined, hasColor, frameSequence, trackingQuality)
      this.recordView(this.activeSampleCount - 1, cameraPosition)
      createdCount += 1
    }

    this.totalCreatedSampleCount += createdCount
    this.totalFusedSampleCount += fusedCount
    this.totalRejectedSampleCount += rejectedCount
    const fusionMs = Math.max(0, getTimestamp() - startedAt)
    if (this.fusionDurations.length >= 128) this.fusionDurations.shift()
    this.fusionDurations.push(fusionMs)
    const sortedFusion = [...this.fusionDurations].sort((a, b) => a - b)
    const baselines: number[] = [], angles: number[] = []
    const diagnosticStride = Math.max(1, Math.ceil(this.activeSampleCount / 512))
    for (let index = 0; index < this.activeSampleCount; index += diagnosticStride) if (this.active[index]) {
      baselines.push(this.maximumViewBaselines[index] / 100); angles.push(this.maximumViewAngles[index])
    }
    baselines.sort((a, b) => a - b); angles.sort((a, b) => a - b)
    const p = (values: readonly number[], fraction: number) => values[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0
    this.diagnostics = {
      ...this.diagnostics,
      status: this.activeSampleCount > 0 ? 'active' : 'empty',
      inputSampleCount: this.totalInputSampleCount,
      inputColorSampleCount: this.totalInputColorSampleCount,
      createdSampleCount: this.totalCreatedSampleCount,
      fusedSampleCount: this.totalFusedSampleCount,
      rejectedSampleCount: this.totalRejectedSampleCount,
      activeSampleCount: this.activeSampleCount,
      stableSampleCount: this.stableSampleCount,
      capacity: DENSE_REALITY_CONFIG.maxSamples,
      capacityUtilizationPercentage: (this.activeSampleCount / DENSE_REALITY_CONFIG.maxSamples) * 100,
      capacityReached: this.capacityReached,
      fusionMs,
      lastCaptureTimestamp: timestamp,
      lastCameraSequence: this.lastCameraSequence,
      cameraCapturesUsed: this.cameraCapturesUsed,
      reclaimedSampleCount: this.reclaimedSamples,
      capacityRejectedSampleCount: this.capacityRejected,
      numericMemoryBytes: DENSE_REALITY_CONFIG.maxSamples * 104 + this.colorObservationBySource.byteLength,
      createdThisTick: createdCount,
      fusedThisTick: fusedCount,
      newGeometryRatio: createdCount / Math.max(1, createdCount + fusedCount),
      sameFrameDuplicateCount: this.sameFrameDuplicateCount,
      duplicateSurfaceCandidateCount: this.duplicateSurfaceCandidateCount,
      viewDiverseSampleCount: this.viewDiverseSampleCount,
      singleViewSampleCount: this.singleViewSampleCount,
      matchDistanceRejectCount: this.matchDistanceRejectCount,
      matchNormalRejectCount: this.matchNormalRejectCount,
      matchDepthLayerRejectCount: this.matchDepthLayerRejectCount,
      matchBucketMissCount: this.matchBucketMissCount,
      matchCandidateBudgetRejectCount: this.matchCandidateBudgetRejectCount,
      matchRatioPercentage: fusedCount / Math.max(1, createdCount + fusedCount) * 100,
      viewBaselineP50Meters: p(baselines, .5),
      viewBaselineP90Meters: p(baselines, .9),
      viewAngleP50Degrees: p(angles, .5),
      viewAngleP90Degrees: p(angles, .9),
      fusionP50Ms: p(sortedFusion, .5),
      fusionP95Ms: p(sortedFusion, .95),
      fusionMaxMs: sortedFusion.at(-1) ?? 0,
    }
  }

  public getDiagnostics(): DenseRealityFusionDebug {
    return { ...this.diagnostics }
  }

  /** Bounded preflight against established samples; it never mutates fusion. */
  public assessFrameConsistency(frame: DenseSpatialPointFrame, normals: Float32Array, normalValid: Uint8Array): RealityFrameConsistency {
    if (this.stableSampleCount < 32) return { consistentRatio: 0, duplicateRatio: 0, unknownRatio: 1, establishedSamples: this.stableSampleCount }
    const stride = Math.max(1, Math.ceil(frame.validPointCount / 256))
    let ordinal = 0, considered = 0, consistent = 0, duplicate = 0
    for (let sourceIndex=0;sourceIndex<frame.valid.length;sourceIndex++) {
      if (!frame.valid[sourceIndex] || !normalValid[sourceIndex] || ordinal++ % stride) continue
      const offset=sourceIndex*3
      this.samplePoint.x=frame.points[offset];this.samplePoint.y=frame.points[offset+1];this.samplePoint.z=frame.points[offset+2]
      this.sampleNormal.x=normals[offset];this.sampleNormal.y=normals[offset+1];this.sampleNormal.z=normals[offset+2]
      const state=this.classifyEstablishedRelation(this.samplePoint,this.sampleNormal);considered++
      if(state===1)consistent++;else if(state===2)duplicate++
    }
    return { consistentRatio: consistent/Math.max(1,considered), duplicateRatio: duplicate/Math.max(1,considered), unknownRatio: (considered-consistent-duplicate)/Math.max(1,considered), establishedSamples:this.stableSampleCount }
  }

  /** Bounded presentation copy; never exposes writable fusion arrays. */
  public copyLiveMap(positions: Float32Array, colors: Float32Array): number {
    const limit = positions.length / 3, stride = Math.max(1, Math.ceil(this.activeSampleCount / limit))
    let count = 0
    for (let index = 0; index < this.activeSampleCount && count < limit; index += stride) {
      if (!this.active[index] || this.geometryObservationCounts[index] < 2 || this.colorWeights[index] === 0) continue
      positions.set(this.positions.subarray(index * 3, index * 3 + 3), count * 3)
      colors.set(this.linearColors.subarray(index * 3, index * 3 + 3), count * 3)
      count++
    }
    return count
  }

  public createSnapshot(
    scanId: string,
    referenceSpaceType: ScannerReferenceSpaceType,
    cameraAvailable: boolean,
  ): FinalizedDenseRealityReconstruction | null {
    if (!cameraAvailable) {
      return null
    }

    const finalizedSurfels: FinalizedRealitySurfel[] = []
    const fusedRawSurfels: FinalizedRealitySurfel[] = []
    const colorSamples = [] as {
      position: Readonly<SpatialPoint>
      colorRgb: RealityRgbColor
      colorWeight: number
      colorConfidence: number
      colorObservationCount: number
    }[]
    let colorObservationTotal = 0
    let colorConfidenceTotal = 0
    for (let index = 0; index < this.activeSampleCount; index += 1) {
      if (this.active[index] !== 1) continue

      const positionOffset = index * 3
      const colorOffset = index * 3
      const hasColor = this.colorWeights[index] > 0
      const colorRgb: RealityRgbColor | null = hasColor
        ? Object.freeze({
          r: linearToSrgb(this.linearColors[colorOffset]),
          g: linearToSrgb(this.linearColors[colorOffset + 1]),
          b: linearToSrgb(this.linearColors[colorOffset + 2]),
        })
        : null
      const colorConfidence = hasColor
        ? clamp(this.colorWeights[index] / MAX_COLOR_WEIGHT, 0, 1)
        : 0
      const count=this.geometryObservationCounts[index],denominator=Math.max(1,count-1)
      const viewCount=this.viewMasks[index].toString(2).replaceAll('0','').length
      const finalizedSurfel = Object.freeze({
        id: index,
        position: Object.freeze({
          x: this.positions[positionOffset],
          y: this.positions[positionOffset + 1],
          z: this.positions[positionOffset + 2],
        }),
        normal: Object.freeze({
          x: this.normals[positionOffset],
          y: this.normals[positionOffset + 1],
          z: this.normals[positionOffset + 2],
        }),
        radius: DENSE_REALITY_CONFIG.sampleRadiusMeters,
        colorRgb,
        colorSpace: 'srgb' as const,
        geometryConfidence: clamp((count/5)*.45+(Math.min(2,viewCount)/2)*.25+(this.trackingQualitySums[index]/Math.max(1,count))*.2+(Math.min(2000,this.lastObservedAt[index]-this.createdAt[index])/2000)*.1,0,1),
        geometryObservationCount: count,
        viewObservationCount: viewCount,
        firstObservedAt: this.createdAt[index],
        lastObservedAt: this.lastObservedAt[index],
        positionVarianceMetersSquared:this.positionResidualSquaredSums[index]/denominator,
        depthVarianceMetersSquared:this.depthResidualSquaredSums[index]/denominator,
        normalVariance:this.normalResidualSquaredSums[index]/denominator,
        trackingQuality:this.trackingQualitySums[index]/Math.max(1,count),
        duplicateSurfaceCandidate:this.duplicateSurfaceCandidates[index]===1,
        stabilityClass:this.stable[index]?'high':count>=2?'low':'provisional',
        colorConfidence,
        colorObservationCount: this.colorObservationCounts[index],
      })
      fusedRawSurfels.push(finalizedSurfel)
      if(count<DENSE_REALITY_CONFIG.minimumStableObservations)continue
      finalizedSurfels.push(finalizedSurfel)
      colorObservationTotal += this.colorObservationCounts[index]
      colorConfidenceTotal += colorConfidence
      if (colorRgb && colorSamples.length < 8) {
        colorSamples.push(Object.freeze({
          position: finalizedSurfel.position,
          colorRgb,
          colorWeight: this.colorWeights[index],
          colorConfidence,
          colorObservationCount: this.colorObservationCounts[index],
        }))
      }
    }

    const frozenSurfels = Object.freeze(finalizedSurfels)
    const coloredSurfels = frozenSurfels.filter((surfel) => surfel.colorRgb !== null).length
    const densitySummary = createDensitySummary(
      frozenSurfels,
      DENSE_REALITY_CONFIG.maxSamples,
      this.activeSampleCount,
      this.capacityReached,
    )
    const captureSummary: RealityCaptureSummary = Object.freeze({
      totalSurfels: frozenSurfels.length,
      coloredSurfels,
      colorCoveragePercentage: frozenSurfels.length > 0
        ? (coloredSurfels / frozenSurfels.length) * 100
        : 0,
      averageColorObservations: coloredSurfels > 0 ? colorObservationTotal / coloredSurfels : 0,
      cameraCapturesUsed: this.cameraCapturesUsed,
      averageColorConfidence: coloredSurfels > 0 ? colorConfidenceTotal / coloredSurfels : 0,
      ...densitySummary,
    })
    const status = coloredSurfels > 0 ? 'available' : 'empty'
    return Object.freeze({
      scanId,
      referenceSpaceType,
      status,
      surfels: frozenSurfels,
      fusedRawSurfels:Object.freeze(fusedRawSurfels),
      bounds: calculateBounds(frozenSurfels),
      captureSummary,
      fusionDiagnostics: Object.freeze({ ...this.diagnostics, multiLayerBucketCount: [...this.cellHeads.values()].filter((index) => this.nextInCell[index] >= 0).length }),
      colorStatistics: calculateColorStatistics(frozenSurfels),
      colorSamples: Object.freeze(colorSamples),
    })
  }

  public reset(): void {
    this.positions.fill(0)
    this.normals.fill(0)
    this.linearColors.fill(0)
    this.colorWeights.fill(0)
    this.colorObservationCounts.fill(0)
    this.geometryObservationCounts.fill(0)
    this.viewMasks.fill(0)
    this.firstViewPositions.fill(0)
    this.firstViewDirections.fill(0)
    this.maximumViewBaselines.fill(0)
    this.maximumViewAngles.fill(0)
    this.lastFrameSequences.fill(0)
    this.trackingQualitySums.fill(0)
    this.positionResidualSquaredSums.fill(0)
    this.depthResidualSquaredSums.fill(0)
    this.normalResidualSquaredSums.fill(0)
    this.duplicateSurfaceCandidates.fill(0)
    this.stable.fill(0)
    this.lastObservedAt.fill(0)
    this.createdAt.fill(0)
    this.active.fill(0)
    this.nextInCell.fill(-1)
    this.cellHeads.clear()
    this.stableBuckets.clear()
    this.stableBucketIndexed.fill(0)
    this.activeSampleCount = 0
    this.stableSampleCount = 0
    this.capacityReached = false
    this.reclaimCursor = 0; this.reclaimedSamples = 0; this.capacityRejected = 0
    this.sameFrameDuplicateCount = 0
    this.duplicateSurfaceCandidateCount = 0;this.viewDiverseSampleCount=0;this.singleViewSampleCount=0
    this.matchDistanceRejectCount=0;this.matchNormalRejectCount=0;this.matchDepthLayerRejectCount=0;this.matchBucketMissCount=0;this.matchCandidateBudgetRejectCount=0
    this.fusionDurations.length=0
    this.totalCreatedSampleCount = 0
    this.totalFusedSampleCount = 0
    this.totalRejectedSampleCount = 0
    this.totalInputSampleCount = 0
    this.totalInputColorSampleCount = 0
    this.lastCameraSequence = null
    this.cameraCapturesUsed = 0
    this.diagnostics = createInitialDiagnostics()
    this.fallbackFrameSequence = 0
    this.colorObservationBySource = new Int32Array(0)
  }

  public dispose(): void {
    this.reset()
  }

  private findCompatibleSample(point: SpatialPoint, normal: SpatialPoint, frameSequence: number): number {
    const cellX = getCellCoordinate(point.x)
    const cellY = getCellCoordinate(point.y)
    const cellZ = getCellCoordinate(point.z)
    let candidateCount = 0
    let bestIndex = -1
    let bestDistance = Infinity
    let sawCandidate = false, sawDistance = false, sawNormal = false, exhausted = false
    for (const [offsetX, offsetY, offsetZ] of MATCH_CELL_OFFSETS) {
          const head = this.cellHeads.get(getCellKey(cellX + offsetX, cellY + offsetY, cellZ + offsetZ))
          let index = head ?? -1
          while (index >= 0) {
            if (candidateCount >= DENSE_REALITY_CONFIG.maxCandidatesPerSample) { exhausted = true; break }
            candidateCount += 1
            if (this.active[index] === 1) {
              sawCandidate = true
              const positionOffset = index * 3
              const dx = point.x - this.positions[positionOffset]
              const dy = point.y - this.positions[positionOffset + 1]
              const dz = point.z - this.positions[positionOffset + 2]
              const distanceSquared = dx * dx + dy * dy + dz * dz
              if (distanceSquared <= DENSE_REALITY_CONFIG.maxMergeDistanceMeters ** 2) {
                // A wider temporal match radius must not collapse adjacent
                // lattice samples captured in this same frame.
                if (this.lastFrameSequences[index] === frameSequence && distanceSquared > .010 ** 2) {
                  index = this.nextInCell[index]
                  continue
                }
                sawDistance = true
                const normalDot = Math.abs(
                  normal.x * this.normals[positionOffset] +
                  normal.y * this.normals[positionOffset + 1] +
                  normal.z * this.normals[positionOffset + 2],
                )
                const residual = Math.abs(
                  dx * this.normals[positionOffset] +
                  dy * this.normals[positionOffset + 1] +
                  dz * this.normals[positionOffset + 2],
                )
                if (
                  normalDot >= DENSE_REALITY_CONFIG.minNormalDot &&
                  residual <= DENSE_REALITY_CONFIG.maxPointToPlaneResidualMeters
                ) {
                  const distance = Math.sqrt(distanceSquared)
                  if (distance < bestDistance) {
                    bestIndex = index
                    bestDistance = distance
                  }
                } else if (normalDot >= DENSE_REALITY_CONFIG.minNormalDot) sawNormal = true
              }
            }
            index = this.nextInCell[index]
          }
          if (exhausted && bestIndex >= 0) break
    }
    this.bestMatchDistance = bestDistance
    this.lastMatchFailure = bestIndex >= 0 ? 'bucket'
      : exhausted ? 'candidate-budget'
        : sawNormal ? 'depth-layer'
          : sawDistance ? 'normal'
            : sawCandidate ? 'distance' : 'bucket'
    return bestIndex
  }

  private createSample(
    point: SpatialPoint,
    normal: SpatialPoint,
    red: number,
    green: number,
    blue: number,
    timestamp: number,
    reusedIndex?: number,
    hasColor = true,
    frameSequence = 0,
    trackingQuality = 1,
  ): void {
    const index = reusedIndex ?? this.activeSampleCount
    const offset = index * 3
    this.positions[offset] = point.x
    this.positions[offset + 1] = point.y
    this.positions[offset + 2] = point.z
    this.normals[offset] = normal.x
    this.normals[offset + 1] = normal.y
    this.normals[offset + 2] = normal.z
    this.linearColors[offset] = red
    this.linearColors[offset + 1] = green
    this.linearColors[offset + 2] = blue
    this.colorWeights[index] = hasColor ? 1 : 0
    this.colorObservationCounts[index] = hasColor ? 1 : 0
    if(reusedIndex!==undefined){if(this.duplicateSurfaceCandidates[index])this.duplicateSurfaceCandidateCount--;const views=this.viewMasks[index].toString(2).replaceAll('0','').length;if(views===1)this.singleViewSampleCount--;else if(views>=2)this.viewDiverseSampleCount--}
    this.viewMasks[index] = 0
    this.firstViewPositions.fill(0, offset, offset + 3)
    this.firstViewDirections.fill(0, offset, offset + 3)
    this.maximumViewBaselines[index] = 0
    this.maximumViewAngles[index] = 0
    this.lastFrameSequences[index] = frameSequence
    this.trackingQualitySums[index] = trackingQuality
    this.positionResidualSquaredSums[index] = 0
    this.depthResidualSquaredSums[index] = 0
    this.normalResidualSquaredSums[index] = 0
    this.duplicateSurfaceCandidates[index] = this.classifyEstablishedRelation(point,normal)===2?1:0
    if(this.duplicateSurfaceCandidates[index])this.duplicateSurfaceCandidateCount++
    this.stable[index] = 0
    this.geometryObservationCounts[index] = 1
    this.lastObservedAt[index] = timestamp
    this.createdAt[index] = timestamp
    this.active[index] = 1
    const key = getPointCellKey(point)
    this.nextInCell[index] = this.cellHeads.get(key) ?? -1
    this.cellHeads.set(key, index)
    if (reusedIndex === undefined) this.activeSampleCount += 1
  }

  private unlinkCell(index: number): void {
    const offset = index * 3
    const key = getCellKey(getCellCoordinate(this.positions[offset]), getCellCoordinate(this.positions[offset + 1]), getCellCoordinate(this.positions[offset + 2]))
    let current = this.cellHeads.get(key) ?? -1, previous = -1
    while (current >= 0) {
      if (current === index) {
        if (previous < 0) { if (this.nextInCell[current] < 0) this.cellHeads.delete(key); else this.cellHeads.set(key, this.nextInCell[current]) }
        else this.nextInCell[previous] = this.nextInCell[current]
        this.nextInCell[index] = -1; return
      }
      previous = current; current = this.nextInCell[current]
    }
  }

  private recordView(index: number, camera: ViewerPosition | null): void {
    if (!camera) return
    const offset = index * 3
    const x = camera.x - this.positions[offset], y = camera.y - this.positions[offset + 1], z = camera.z - this.positions[offset + 2]
    const length = Math.hypot(x, y, z)
    if (length <= VECTOR_EPSILON) return
    const before=this.viewMasks[index].toString(2).replaceAll('0','').length
    if (before === 0) {
      this.firstViewPositions[offset] = Math.max(-32768,Math.min(32767,Math.round(camera.x*100)))
      this.firstViewPositions[offset + 1] = Math.max(-32768,Math.min(32767,Math.round(camera.y*100)))
      this.firstViewPositions[offset + 2] = Math.max(-32768,Math.min(32767,Math.round(camera.z*100)))
      this.firstViewDirections[offset] = Math.round(x / length*127)
      this.firstViewDirections[offset + 1] = Math.round(y / length*127)
      this.firstViewDirections[offset + 2] = Math.round(z / length*127)
      this.viewMasks[index] = 1
    } else {
      const baseline = Math.hypot(
        camera.x - this.firstViewPositions[offset]/100,
        camera.y - this.firstViewPositions[offset + 1]/100,
        camera.z - this.firstViewPositions[offset + 2]/100,
      )
      const cosine = clamp(
        x / length * this.firstViewDirections[offset]/127 +
        y / length * this.firstViewDirections[offset + 1]/127 +
        z / length * this.firstViewDirections[offset + 2]/127,
        -1,
        1,
      )
      const angle = Math.acos(cosine)
      this.maximumViewBaselines[index] = Math.max(this.maximumViewBaselines[index],Math.min(255,Math.round(baseline*100)))
      this.maximumViewAngles[index] = Math.max(this.maximumViewAngles[index],Math.min(255,Math.round(angle*180/Math.PI)))
      if ((baseline >= VIEW_DIVERSITY_BASELINE_METERS && angle >= VIEW_DIVERSITY_ANGLE_RADIANS) || baseline >= STRONG_VIEW_BASELINE_METERS) {
        this.viewMasks[index] |= 2
      }
      if (baseline >= .30 && angle >= VIEW_DIVERSITY_ANGLE_RADIANS * 2) this.viewMasks[index] |= 4
    }
    const after=this.viewMasks[index].toString(2).replaceAll('0','').length
    if(before===0&&after===1)this.singleViewSampleCount++
    else if(before===1&&after===2){this.singleViewSampleCount--;this.viewDiverseSampleCount++}
  }

  private fuseSample(
    matchIndex: number,
    matchDistance: number,
    red: number,
    green: number,
    blue: number,
    cameraPosition: ViewerPosition | null,
    timestamp: number,
    hasColor = true,
    frameSequence = 0,
    trackingQuality = 1,
  ): boolean {
    const index = matchIndex
    const offset = index * 3
    const priorWeight = this.colorWeights[index]
    const priorCount = this.colorObservationCounts[index]
    // Several depth pixels can land in one 2.5 cm surfel during one XR tick.
    // They may refine neither stability nor variance more than once.
    if (this.lastFrameSequences[index] === frameSequence) { this.sameFrameDuplicateCount++; return true }
    this.lastFrameSequences[index] = frameSequence
    let observationWeight = clamp(
      1 - matchDistance / DENSE_REALITY_CONFIG.maxMergeDistanceMeters,
      0.4,
      1,
    )
    if (cameraPosition) {
      this.cameraVector.x = cameraPosition.x - this.positions[offset]
      this.cameraVector.y = cameraPosition.y - this.positions[offset + 1]
      this.cameraVector.z = cameraPosition.z - this.positions[offset + 2]
      if (normalize(this.cameraVector, this.normalizedCameraVector)) {
        const incidence = Math.abs(
          this.normals[offset] * this.normalizedCameraVector.x +
          this.normals[offset + 1] * this.normalizedCameraVector.y +
          this.normals[offset + 2] * this.normalizedCameraVector.z,
        )
        observationWeight *= 0.35 + 0.65 * clamp(incidence, 0, 1)
      }
    }

    if (priorCount >= MIN_COLOR_OUTLIER_OBSERVATIONS && priorWeight > 0) {
      const colorDistance = Math.hypot(
        red - this.linearColors[offset],
        green - this.linearColors[offset + 1],
        blue - this.linearColors[offset + 2],
      )
      if (colorDistance > COLOR_OUTLIER_DISTANCE) {
        observationWeight *= 0.1
        if (observationWeight < 0.08) {
          observationWeight = 0
        }
      } else {
        observationWeight *= clamp(1 - colorDistance * 0.45, 0.7, 1)
      }
    }

    if (!hasColor) observationWeight = 0
    const boundedWeight = Math.max(0.05, observationWeight)
    const nextWeight = Math.min(MAX_COLOR_WEIGHT, priorWeight + boundedWeight)
    const blend = boundedWeight / Math.max(Number.EPSILON, priorWeight + boundedWeight)
    // Fusion accepts normal orientation up to sign; align before averaging.
    const sign = this.sampleNormal.x * this.normals[offset] + this.sampleNormal.y * this.normals[offset + 1] + this.sampleNormal.z * this.normals[offset + 2] < 0 ? -1 : 1
    this.sampleNormal.x *= sign; this.sampleNormal.y *= sign; this.sampleNormal.z *= sign
    const dx=this.samplePoint.x-this.positions[offset],dy=this.samplePoint.y-this.positions[offset+1],dz=this.samplePoint.z-this.positions[offset+2]
    const normalDot=clamp(this.sampleNormal.x*this.normals[offset]+this.sampleNormal.y*this.normals[offset+1]+this.sampleNormal.z*this.normals[offset+2],-1,1)
    const depthResidual=dx*this.normals[offset]+dy*this.normals[offset+1]+dz*this.normals[offset+2]
    this.positionResidualSquaredSums[index]+=matchDistance*matchDistance
    this.depthResidualSquaredSums[index]+=depthResidual*depthResidual
    this.normalResidualSquaredSums[index]+=(1-normalDot)*(1-normalDot)
    this.trackingQualitySums[index]+=trackingQuality
    this.unlinkCell(index)
    const geometryBlend = 1 / Math.min(16, this.geometryObservationCounts[index] + 1)
    this.positions[offset] += (this.samplePoint.x - this.positions[offset]) * geometryBlend
    this.positions[offset + 1] += (this.samplePoint.y - this.positions[offset + 1]) * geometryBlend
    this.positions[offset + 2] += (this.samplePoint.z - this.positions[offset + 2]) * geometryBlend
    this.normals[offset] += (this.sampleNormal.x - this.normals[offset]) * geometryBlend
    this.normals[offset + 1] += (this.sampleNormal.y - this.normals[offset + 1]) * geometryBlend
    this.normals[offset + 2] += (this.sampleNormal.z - this.normals[offset + 2]) * geometryBlend
    this.normalScratch.x = this.normals[offset]
    this.normalScratch.y = this.normals[offset + 1]
    this.normalScratch.z = this.normals[offset + 2]
    if (normalize(this.normalScratch, this.sampleNormal)) {
      this.normals[offset] = this.sampleNormal.x
      this.normals[offset + 1] = this.sampleNormal.y
      this.normals[offset + 2] = this.sampleNormal.z
    }
    const newCell = getCellKey(getCellCoordinate(this.positions[offset]), getCellCoordinate(this.positions[offset + 1]), getCellCoordinate(this.positions[offset + 2]))
    // Even within the same bucket relink explicitly after unlinking.
    this.nextInCell[index] = this.cellHeads.get(newCell) ?? -1
    this.cellHeads.set(newCell, index)
    if (observationWeight > 0) {
      this.linearColors[offset] += (red - this.linearColors[offset]) * blend
      this.linearColors[offset + 1] += (green - this.linearColors[offset + 1]) * blend
      this.linearColors[offset + 2] += (blue - this.linearColors[offset + 2]) * blend
      this.colorWeights[index] = nextWeight
      this.colorObservationCounts[index] += 1
    }
    this.geometryObservationCounts[index] += 1
    this.lastObservedAt[index] = timestamp
    const wasStable=this.stable[index]===1,nextStable=this.isStableSample(index)
    if(!wasStable&&nextStable){this.stable[index]=1;this.stableSampleCount++;this.indexStableSample(index)}
    else if(wasStable&&!nextStable){this.stable[index]=0;this.stableSampleCount--}
    return true
  }

  private isStableSample(index:number):boolean {
    const count=this.geometryObservationCounts[index],denominator=Math.max(1,count-1)
    const span=this.lastObservedAt[index]-this.createdAt[index],views=this.viewMasks[index].toString(2).replaceAll('0','').length
    return count>=3&&span>=250&&this.trackingQualitySums[index]/count>=.55&&
      Math.sqrt(this.positionResidualSquaredSums[index]/denominator)<=.018&&
      Math.sqrt(this.depthResidualSquaredSums[index]/denominator)<=.012&&
      Math.sqrt(this.normalResidualSquaredSums[index]/denominator)<=.18&&
      (this.duplicateSurfaceCandidates[index]===0||(views>=2&&span>=600))
  }

  /** 0 unknown, 1 compatible existing surface, 2 suspicious parallel offset. */
  private classifyEstablishedRelation(point:SpatialPoint,normal:SpatialPoint):0|1|2 {
    if(this.stableSampleCount<32)return 0
    const coordinate=(value:number)=>Math.floor(value/STABLE_BUCKET_SIZE_METERS)
    const cx=coordinate(point.x),cy=coordinate(point.y),cz=coordinate(point.z)
    let result:0|1|2=0,candidates=0
    for(let x=-2;x<=2;x++)for(let y=-2;y<=2;y++)for(let z=-2;z<=2;z++){
      const bucket=this.stableBuckets.get(getCellKey(cx+x,cy+y,cz+z))
      if(!bucket)continue
      for(const index of bucket){if(candidates++>=96)return result;if(this.active[index]&&this.stable[index]){const o=index*3,dx=point.x-this.positions[o],dy=point.y-this.positions[o+1],dz=point.z-this.positions[o+2],distance=Math.hypot(dx,dy,dz),dot=Math.abs(normal.x*this.normals[o]+normal.y*this.normals[o+1]+normal.z*this.normals[o+2]),residual=Math.abs(dx*this.normals[o]+dy*this.normals[o+1]+dz*this.normals[o+2])
        if(distance<=.035&&dot>=.8)return 1
        if(distance<=.12&&residual>=.028&&dot>=.94)result=2
      }}
    }
    return result
  }

  private indexStableSample(index:number):void {
    if(this.stableBucketIndexed[index])return
    const offset=index*3,key=getCellKey(
      Math.floor(this.positions[offset]/STABLE_BUCKET_SIZE_METERS),
      Math.floor(this.positions[offset+1]/STABLE_BUCKET_SIZE_METERS),
      Math.floor(this.positions[offset+2]/STABLE_BUCKET_SIZE_METERS),
    )
    const bucket=this.stableBuckets.get(key)
    if(bucket)bucket.push(index);else this.stableBuckets.set(key,[index])
    this.stableBucketIndexed[index]=1
  }

}

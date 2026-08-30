import type {
  CoverageCellState,
  CoverageVisualConfidenceResult,
  DenseCoverageMesh,
  DenseMaskStabilizationOptions,
  DenseSpatialDiagnosticSample,
  DenseSpatialPointFrame,
  SpatialCoverageDenseDebug,
  SpatialPoint,
} from '../types'
import {
  COVERAGE_VISUAL_COLORS,
  COVERAGE_VISUAL_CONFIDENCE,
  COVERAGE_VISUAL_CONFIDENCE_CONFIG,
  COVERAGE_VISUAL_OPACITY,
  DEFAULT_DENSE_MASK_STABILIZATION_OPTIONS,
  DENSE_MASK_COLUMNS,
  DENSE_MASK_ROWS,
  DENSE_VISUAL_STABILIZATION_CONFIG,
} from './spatialCoverageVisualConfig'
import { SpatialCoverageService } from './spatialCoverageService'

const FLOATS_PER_VERTEX = 7
const VISUAL_CACHE_KEY_SIZE_METERS = 0.05
const VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS = 1
const CACHE_EXPIRATION_CHECKS_PER_UPDATE = 800

// These limits are deliberately tight at 80x45. They preserve object/wall and
// wall/ceiling seams without allowing a dense triangle to bridge a large gap.
const MAX_DEPTH_DISCONTINUITY_METERS = 0.22
const MAX_NEIGHBOR_SPAN_METERS = 0.22
const MIN_NEIGHBOR_SPAN_METERS = 0.08
const NEIGHBOR_SPAN_DEPTH_SCALE = 0.09

const HOLE_NEIGHBOR_COLUMN_OFFSETS = [-1, 1, 0, 0] as const
const HOLE_NEIGHBOR_ROW_OFFSETS = [0, 0, -1, 1] as const

function getPerformanceTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

interface VisualPointCacheEntry {
  key: string
  point: SpatialPoint
  normal: SpatialPoint | null
  lastState: CoverageCellState | null
  lastVisualConfidence: number
  lastSeenAt: number
  lastPreparedAt: number
}

interface VisualSurfaceGrid {
  columns: number
  rows: number
  valid: Uint8Array
  inferred: Uint8Array
  distancesMeters: Float32Array
  points: Float32Array
  normals: Float32Array
  normalValid: Uint8Array
}

interface VisualGridDiagnostics {
  holeFillSampleCount: number
  holeFillRejectCount: number
}

interface HoleEstimate {
  x: number
  y: number
  z: number
  depthMeters: number
}

interface VisualCachePreparationResult {
  smoothedSampleCount: number
  smoothingDurationMs: number
}

function createInitialDiagnostics(): SpatialCoverageDenseDebug {
  return {
    columns: DENSE_MASK_COLUMNS,
    rows: DENSE_MASK_ROWS,
    attemptedSampleCount: 0,
    validSampleCount: 0,
    generatedTriangleCount: 0,
    rejectedInvalidSampleCount: 0,
    rejectedDepthDiscontinuityCount: 0,
    unknownMaskSampleCount: 0,
    observedMaskSampleCount: 0,
    partialMaskSampleCount: 0,
    capturedMaskSampleCount: 0,
    exactCoverageLookupHitCount: 0,
    neighborCoverageLookupHitCount: 0,
    coverageLookupMissCount: 0,
    coverageLookupHitPercentage: null,
    depthMinMeters: null,
    depthMaxMeters: null,
    worldBounds: null,
    representativeSamples: [],
    updateCount: 0,
    updateRateHz: 0,
    processingDurationMs: 0,
    totalProcessingDurationMs: 0,
    depthReconstructionDurationMs: 0,
    coverageLookupDurationMs: 0,
    visualCacheDurationMs: 0,
    holeFillDurationMs: 0,
    smoothingDurationMs: 0,
    triangleGenerationDurationMs: 0,
    stabilizationOptions: { ...DEFAULT_DENSE_MASK_STABILIZATION_OPTIONS },
    visualCacheEntryCount: 0,
    visualCacheMaxEntries: DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries,
    visualCacheHitCount: 0,
    visualCacheRefreshCount: 0,
    visualCacheExpirationCount: 0,
    visualHoleFillSampleCount: 0,
    visualHoleFillRejectCount: 0,
    smoothedVisualFragmentCount: 0,
    directPersistentMatchCount: 0,
    neighborhoodConfidenceSampleCount: 0,
    visualConfidenceUnknownCount: 0,
    averageCompatibleNeighborCount: 0,
    averageVisualConfidence: 0,
    capturedDirectMatchCount: 0,
    neighborhoodHighConfidenceSampleCount: 0,
    visualConfidenceNormalRejectCount: 0,
    visualConfidencePointToPlaneRejectCount: 0,
    visualConfidenceDurationMs: 0,
    visualConfidenceSupportRadiusMeters:
      COVERAGE_VISUAL_CONFIDENCE_CONFIG.supportRadiusMeters,
    visualConfidenceCandidateLimit: COVERAGE_VISUAL_CONFIDENCE_CONFIG.maxCandidates,
  }
}

function getPoint(frame: DenseSpatialPointFrame, index: number): SpatialPoint {
  return {
    x: frame.points[index * 3],
    y: frame.points[index * 3 + 1],
    z: frame.points[index * 3 + 2],
  }
}

function getSampleIndex(
  frame: DenseSpatialPointFrame,
  normalizedX: number,
  normalizedY: number,
): number {
  const column = Math.round(normalizedX * (frame.columns - 1))
  const row = Math.round(normalizedY * (frame.rows - 1))
  return row * frame.columns + column
}

function getRepresentativeSamples(
  frame: DenseSpatialPointFrame,
): DenseSpatialDiagnosticSample[] {
  const coordinates = [
    { label: 'top-center' as const, x: 0.5, y: 0 },
    { label: 'center' as const, x: 0.5, y: 0.5 },
    { label: 'bottom-center' as const, x: 0.5, y: 1 },
    { label: 'left-center' as const, x: 0, y: 0.5 },
    { label: 'right-center' as const, x: 1, y: 0.5 },
  ]

  return coordinates.map(({ label, x, y }) => {
    const index = getSampleIndex(frame, x, y)
    if (frame.valid[index] !== 1) {
      return { label, depthMeters: null, point: null }
    }

    return {
      label,
      depthMeters: frame.distancesMeters[index],
      point: getPoint(frame, index),
    }
  })
}

function getVisualCacheKey(x: number, y: number, z: number): string {
  return `${Math.round(x / VISUAL_CACHE_KEY_SIZE_METERS)}:${Math.round(y / VISUAL_CACHE_KEY_SIZE_METERS)}:${Math.round(z / VISUAL_CACHE_KEY_SIZE_METERS)}`
}

function getPersistentLookupKey(x: number, y: number, z: number): string {
  return `${Math.floor(x / VISUAL_CACHE_KEY_SIZE_METERS)}:${Math.floor(y / VISUAL_CACHE_KEY_SIZE_METERS)}:${Math.floor(z / VISUAL_CACHE_KEY_SIZE_METERS)}`
}

function setGridPoint(points: Float32Array, index: number, x: number, y: number, z: number): void {
  const offset = index * 3
  points[offset] = x
  points[offset + 1] = y
  points[offset + 2] = z
}

function isGridPointContinuous(
  grid: VisualSurfaceGrid,
  firstIndex: number,
  secondIndex: number,
): boolean {
  if (grid.valid[firstIndex] !== 1 || grid.valid[secondIndex] !== 1) {
    return false
  }

  const firstDepth = grid.distancesMeters[firstIndex]
  const secondDepth = grid.distancesMeters[secondIndex]
  const firstOffset = firstIndex * 3
  const secondOffset = secondIndex * 3
  const firstX = grid.points[firstOffset]
  const firstY = grid.points[firstOffset + 1]
  const firstZ = grid.points[firstOffset + 2]
  const secondX = grid.points[secondOffset]
  const secondY = grid.points[secondOffset + 1]
  const secondZ = grid.points[secondOffset + 2]
  const maxNeighborSpan = Math.min(
    MAX_NEIGHBOR_SPAN_METERS,
    Math.max(
      MIN_NEIGHBOR_SPAN_METERS,
      Math.max(firstDepth, secondDepth) * NEIGHBOR_SPAN_DEPTH_SCALE,
    ),
  )

  return (
    Number.isFinite(firstDepth) &&
    Number.isFinite(secondDepth) &&
    Math.abs(firstDepth - secondDepth) <= MAX_DEPTH_DISCONTINUITY_METERS &&
    Math.hypot(secondX - firstX, secondY - firstY, secondZ - firstZ) <= maxNeighborSpan
  )
}

function estimateGridNormal(grid: VisualSurfaceGrid, index: number): boolean {
  const row = Math.floor(index / grid.columns)
  const column = index % grid.columns
  if (
    column <= 0 ||
    column >= grid.columns - 1 ||
    row <= 0 ||
    row >= grid.rows - 1
  ) {
    return false
  }

  const leftIndex = index - 1
  const rightIndex = index + 1
  const upIndex = index - grid.columns
  const downIndex = index + grid.columns
  if (
    !isGridPointContinuous(grid, leftIndex, rightIndex) ||
    !isGridPointContinuous(grid, upIndex, downIndex)
  ) {
    return false
  }

  const leftOffset = leftIndex * 3
  const rightOffset = rightIndex * 3
  const upOffset = upIndex * 3
  const downOffset = downIndex * 3
  const horizontalX = grid.points[rightOffset] - grid.points[leftOffset]
  const horizontalY = grid.points[rightOffset + 1] - grid.points[leftOffset + 1]
  const horizontalZ = grid.points[rightOffset + 2] - grid.points[leftOffset + 2]
  const verticalX = grid.points[downOffset] - grid.points[upOffset]
  const verticalY = grid.points[downOffset + 1] - grid.points[upOffset + 1]
  const verticalZ = grid.points[downOffset + 2] - grid.points[upOffset + 2]
  const normalX = horizontalY * verticalZ - horizontalZ * verticalY
  const normalY = horizontalZ * verticalX - horizontalX * verticalZ
  const normalZ = horizontalX * verticalY - horizontalY * verticalX
  const length = Math.hypot(normalX, normalY, normalZ)
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    return false
  }

  const normalOffset = index * 3
  grid.normalValid[index] = 1
  grid.normals[normalOffset] = normalX / length
  grid.normals[normalOffset + 1] = normalY / length
  grid.normals[normalOffset + 2] = normalZ / length
  return true
}

function estimateHolePoint(
  grid: VisualSurfaceGrid,
  index: number,
  result: HoleEstimate,
): boolean {
  const row = Math.floor(index / grid.columns)
  const column = index % grid.columns
  let neighborCount = 0
  let depthMin = Number.POSITIVE_INFINITY
  let depthMax = Number.NEGATIVE_INFINITY
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let normalCount = 0
  let normalX = 0
  let normalY = 0
  let normalZ = 0

  for (let direction = 0; direction < HOLE_NEIGHBOR_COLUMN_OFFSETS.length; direction += 1) {
    const neighborColumn = column + HOLE_NEIGHBOR_COLUMN_OFFSETS[direction]
    const neighborRow = row + HOLE_NEIGHBOR_ROW_OFFSETS[direction]
    if (
      neighborColumn < 0 ||
      neighborColumn >= grid.columns ||
      neighborRow < 0 ||
      neighborRow >= grid.rows
    ) {
      continue
    }

    const neighborIndex = neighborRow * grid.columns + neighborColumn
    if (grid.valid[neighborIndex] !== 1 || grid.inferred[neighborIndex] === 1) {
      continue
    }

    const depth = grid.distancesMeters[neighborIndex]
    if (!Number.isFinite(depth)) {
      return false
    }

    const pointOffset = neighborIndex * 3
    neighborCount += 1
    depthMin = Math.min(depthMin, depth)
    depthMax = Math.max(depthMax, depth)
    sumX += grid.points[pointOffset]
    sumY += grid.points[pointOffset + 1]
    sumZ += grid.points[pointOffset + 2]

    if (grid.normalValid[neighborIndex] === 1) {
      normalCount += 1
      normalX += grid.normals[pointOffset]
      normalY += grid.normals[pointOffset + 1]
      normalZ += grid.normals[pointOffset + 2]
    }
  }

  if (
    neighborCount < DENSE_VISUAL_STABILIZATION_CONFIG.holeFillMinNeighbors ||
    depthMax - depthMin > DENSE_VISUAL_STABILIZATION_CONFIG.holeFillMaxDepthSpreadMeters
  ) {
    return false
  }

  // Four fixed immediate-neighbor checks are enough for a conservative fill.
  for (let firstDirection = 0; firstDirection < HOLE_NEIGHBOR_COLUMN_OFFSETS.length; firstDirection += 1) {
    const firstColumn = column + HOLE_NEIGHBOR_COLUMN_OFFSETS[firstDirection]
    const firstRow = row + HOLE_NEIGHBOR_ROW_OFFSETS[firstDirection]
    if (
      firstColumn < 0 ||
      firstColumn >= grid.columns ||
      firstRow < 0 ||
      firstRow >= grid.rows
    ) {
      continue
    }
    const firstIndex = firstRow * grid.columns + firstColumn
    if (grid.valid[firstIndex] !== 1 || grid.inferred[firstIndex] === 1) {
      continue
    }
    const firstOffset = firstIndex * 3
    for (let secondDirection = firstDirection + 1; secondDirection < HOLE_NEIGHBOR_COLUMN_OFFSETS.length; secondDirection += 1) {
      const secondColumn = column + HOLE_NEIGHBOR_COLUMN_OFFSETS[secondDirection]
      const secondRow = row + HOLE_NEIGHBOR_ROW_OFFSETS[secondDirection]
      if (
        secondColumn < 0 ||
        secondColumn >= grid.columns ||
        secondRow < 0 ||
        secondRow >= grid.rows
      ) {
        continue
      }
      const secondIndex = secondRow * grid.columns + secondColumn
      if (grid.valid[secondIndex] !== 1 || grid.inferred[secondIndex] === 1) {
        continue
      }
      const secondOffset = secondIndex * 3
      if (
        Math.hypot(
          grid.points[secondOffset] - grid.points[firstOffset],
          grid.points[secondOffset + 1] - grid.points[firstOffset + 1],
          grid.points[secondOffset + 2] - grid.points[firstOffset + 2],
        ) > DENSE_VISUAL_STABILIZATION_CONFIG.holeFillMaxNeighborSpanMeters
      ) {
        return false
      }
    }
  }

  if (normalCount >= 2) {
    const normalLength = Math.hypot(normalX, normalY, normalZ)
    if (!Number.isFinite(normalLength) || normalLength <= Number.EPSILON) {
      return false
    }
    normalX /= normalLength
    normalY /= normalLength
    normalZ /= normalLength
    for (let direction = 0; direction < HOLE_NEIGHBOR_COLUMN_OFFSETS.length; direction += 1) {
      const neighborColumn = column + HOLE_NEIGHBOR_COLUMN_OFFSETS[direction]
      const neighborRow = row + HOLE_NEIGHBOR_ROW_OFFSETS[direction]
      if (
        neighborColumn < 0 ||
        neighborColumn >= grid.columns ||
        neighborRow < 0 ||
        neighborRow >= grid.rows
      ) {
        continue
      }
      const neighborIndex = neighborRow * grid.columns + neighborColumn
      if (grid.valid[neighborIndex] !== 1 || grid.normalValid[neighborIndex] !== 1) {
        continue
      }
      const normalOffset = neighborIndex * 3
      if (
        normalX * grid.normals[normalOffset] +
          normalY * grid.normals[normalOffset + 1] +
          normalZ * grid.normals[normalOffset + 2] <
        DENSE_VISUAL_STABILIZATION_CONFIG.smoothingMinNormalDot
      ) {
        return false
      }
    }
  }

  result.x = sumX / neighborCount
  result.y = sumY / neighborCount
  result.z = sumZ / neighborCount
  result.depthMeters = (depthMin + depthMax) / 2
  return (
    Number.isFinite(result.x) &&
    Number.isFinite(result.y) &&
    Number.isFinite(result.z) &&
    Number.isFinite(result.depthMeters)
  )
}

function getStateForVisualConfidence(confidence: number): CoverageCellState | null {
  if (confidence >= COVERAGE_VISUAL_CONFIDENCE.captured) {
    return 'captured'
  }
  if (confidence >= COVERAGE_VISUAL_CONFIDENCE.partial) {
    return 'partial'
  }
  if (confidence >= COVERAGE_VISUAL_CONFIDENCE.observed) {
    return 'observed'
  }
  return null
}

function getOpacityForVisualConfidence(confidence: number): number {
  const clampedConfidence = Math.max(0, Math.min(1, confidence))
  return COVERAGE_VISUAL_OPACITY.candidate * (1 - clampedConfidence)
}

function hasVisibleMask(
  firstOpacity: number,
  secondOpacity: number,
  thirdOpacity: number,
): boolean {
  return firstOpacity > Number.EPSILON ||
    secondOpacity > Number.EPSILON ||
    thirdOpacity > Number.EPSILON
}

function writeVertex(
  data: Float32Array,
  offset: number,
  points: Float32Array,
  pointIndex: number,
  state: CoverageCellState | null,
  opacity: number,
): void {
  const pointOffset = pointIndex * 3
  const color = state ? COVERAGE_VISUAL_COLORS[state] : COVERAGE_VISUAL_COLORS.observed
  data[offset] = points[pointOffset]
  data[offset + 1] = points[pointOffset + 1]
  data[offset + 2] = points[pointOffset + 2]
  data[offset + 3] = color[0]
  data[offset + 4] = color[1]
  data[offset + 5] = color[2]
  data[offset + 6] = opacity
}

/**
 * Builds a bounded world-space mask. The only retained visual history is a
 * short-lived spatial sample cache plus one reusable prepared mesh; no
 * triangle fragment objects or historical point cloud are stored.
 */
export class DenseSurfaceMaskService {
  private diagnostics = createInitialDiagnostics()

  private vertexData = new Float32Array(0)

  private cachedVertexData = new Float32Array(0)

  private cachedVertexCount = 0

  private cachedMeshLastSeenAt: number | null = null

  private revision = 0

  private grid: VisualSurfaceGrid | null = null

  private readonly visualPointCache = new Map<string, VisualPointCacheEntry>()

  /** Reused within one build so dense samples in one 5 cm bucket share work. */
  private readonly frameVisualMatchCache = new Map<string, VisualPointCacheEntry | null>()

  /** Reused only within one prepared frame; coverage cannot change mid-build. */
  private readonly coverageLookupCache = new Map<string, CoverageVisualConfidenceResult>()

  private cacheExpirationIterator: Iterator<[string, VisualPointCacheEntry]> | null = null

  private matchedCacheEntries: Array<VisualPointCacheEntry | null> = []

  private sampleStates: Array<CoverageCellState | null> = []

  private sampleOpacities = new Float32Array(0)

  private readonly lookupPoint: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly holeEstimate: HoleEstimate = { x: 0, y: 0, z: 0, depthMeters: 0 }

  private holeFillDurationMs = 0

  private visualCacheHitCount = 0

  private visualCacheRefreshCount = 0

  private visualCacheExpirationCount = 0

  private firstUpdateAt: number | null = null

  private stabilizationOptions: DenseMaskStabilizationOptions = {
    ...DEFAULT_DENSE_MASK_STABILIZATION_OPTIONS,
  }

  public setStabilizationOptions(options: DenseMaskStabilizationOptions): void {
    const cacheWasEnabled = this.stabilizationOptions.cacheEnabled
    this.stabilizationOptions = { ...options }
    if (cacheWasEnabled && !options.cacheEnabled) {
      this.visualPointCache.clear()
      this.cacheExpirationIterator = null
      this.cachedVertexCount = 0
      this.cachedMeshLastSeenAt = null
    }
  }

  public getStabilizationOptions(): DenseMaskStabilizationOptions {
    return { ...this.stabilizationOptions }
  }

  public build(
    frame: DenseSpatialPointFrame,
    coverageService: SpatialCoverageService,
    timestamp: number,
    depthReconstructionDurationMs = 0,
  ): DenseCoverageMesh {
    const processingStartedAt = getPerformanceTimestamp()
    const gridDiagnostics = this.prepareGrid(frame)

    const cacheStartedAt = getPerformanceTimestamp()
    this.expireVisualCacheEntries(timestamp)
    const smoothingResult = this.prepareVisualCache(timestamp)
    const cachePreparedAt = getPerformanceTimestamp()

    const diagnostics = createInitialDiagnostics()
    diagnostics.columns = frame.columns
    diagnostics.rows = frame.rows
    diagnostics.attemptedSampleCount = frame.attemptedSampleCount
    diagnostics.validSampleCount = frame.validPointCount
    diagnostics.representativeSamples = getRepresentativeSamples(frame)
    diagnostics.stabilizationOptions = this.getStabilizationOptions()
    diagnostics.depthReconstructionDurationMs = Math.max(0, depthReconstructionDurationMs)
    diagnostics.holeFillDurationMs = this.holeFillDurationMs
    diagnostics.visualCacheDurationMs = Math.max(0, cachePreparedAt - cacheStartedAt)
    diagnostics.smoothingDurationMs = smoothingResult.smoothingDurationMs
    diagnostics.visualHoleFillSampleCount = gridDiagnostics.holeFillSampleCount
    diagnostics.visualHoleFillRejectCount = gridDiagnostics.holeFillRejectCount
    diagnostics.smoothedVisualFragmentCount = smoothingResult.smoothedSampleCount

    let worldMinX = Number.POSITIVE_INFINITY
    let worldMinY = Number.POSITIVE_INFINITY
    let worldMinZ = Number.POSITIVE_INFINITY
    let worldMaxX = Number.NEGATIVE_INFINITY
    let worldMaxY = Number.NEGATIVE_INFINITY
    let worldMaxZ = Number.NEGATIVE_INFINITY
    let depthMinMeters = Number.POSITIVE_INFINITY
    let depthMaxMeters = Number.NEGATIVE_INFINITY
    this.ensureSampleCapacity(frame.columns * frame.rows)
    this.sampleStates.fill(null, 0, frame.columns * frame.rows)
    this.sampleOpacities.fill(0, 0, frame.columns * frame.rows)
    this.coverageLookupCache.clear()

    const lookupStartedAt = getPerformanceTimestamp()
    const grid = this.grid as VisualSurfaceGrid
    let visualConfidenceSampleCount = 0
    let visualConfidenceSum = 0
    let compatibleNeighborSum = 0
    for (let index = 0; index < frame.columns * frame.rows; index += 1) {
      if (grid.valid[index] !== 1) {
        diagnostics.rejectedInvalidSampleCount += 1
        continue
      }

      const pointOffset = index * 3
      this.lookupPoint.x = grid.points[pointOffset]
      this.lookupPoint.y = grid.points[pointOffset + 1]
      this.lookupPoint.z = grid.points[pointOffset + 2]
      const normalKey = grid.normalValid[index] === 1
        ? `${Math.round(grid.normals[pointOffset] * 10)}:${Math.round(grid.normals[pointOffset + 1] * 10)}:${Math.round(grid.normals[pointOffset + 2] * 10)}`
        : 'none'
      const lookupKey = `${getPersistentLookupKey(
        this.lookupPoint.x,
        this.lookupPoint.y,
        this.lookupPoint.z,
      )}:${normalKey}`
      let lookup = this.coverageLookupCache.get(lookupKey)
      if (!lookup) {
        lookup = coverageService.getCoverageVisualConfidenceAtPoint(
          this.lookupPoint,
          grid.normalValid[index] === 1
            ? {
                x: grid.normals[pointOffset],
                y: grid.normals[pointOffset + 1],
                z: grid.normals[pointOffset + 2],
              }
            : null,
        )
        this.coverageLookupCache.set(lookupKey, lookup)
      }
      const cacheEntry = this.matchedCacheEntries[index]
      const confidence = lookup.kind === 'miss' &&
        this.stabilizationOptions.cacheEnabled &&
        this.stabilizationOptions.hysteresisEnabled &&
        cacheEntry
        ? cacheEntry.lastVisualConfidence
        : lookup.confidence
      const state = getStateForVisualConfidence(confidence)
      this.sampleOpacities[index] = getOpacityForVisualConfidence(confidence)
      this.sampleStates[index] = state
      if (cacheEntry) {
        cacheEntry.lastVisualConfidence = confidence
        cacheEntry.lastState = state
      }

      if (frame.valid[index] !== 1) {
        continue
      }

      const framePointX = frame.points[pointOffset]
      const framePointY = frame.points[pointOffset + 1]
      const framePointZ = frame.points[pointOffset + 2]
      worldMinX = Math.min(worldMinX, framePointX)
      worldMinY = Math.min(worldMinY, framePointY)
      worldMinZ = Math.min(worldMinZ, framePointZ)
      worldMaxX = Math.max(worldMaxX, framePointX)
      worldMaxY = Math.max(worldMaxY, framePointY)
      worldMaxZ = Math.max(worldMaxZ, framePointZ)
      depthMinMeters = Math.min(depthMinMeters, frame.distancesMeters[index])
      depthMaxMeters = Math.max(depthMaxMeters, frame.distancesMeters[index])
      visualConfidenceSampleCount += 1
      visualConfidenceSum += confidence
      compatibleNeighborSum += lookup.compatibleNeighborCount
      diagnostics.directPersistentMatchCount += lookup.directMatch ? 1 : 0
      diagnostics.neighborhoodConfidenceSampleCount +=
        !lookup.directMatch && lookup.compatibleNeighborCount > 0 ? 1 : 0
      diagnostics.visualConfidenceNormalRejectCount += lookup.normalRejectedCount
      diagnostics.visualConfidencePointToPlaneRejectCount +=
        lookup.pointToPlaneRejectedCount
      if (
        !lookup.directMatch &&
        confidence >= COVERAGE_VISUAL_CONFIDENCE.partial
      ) {
        diagnostics.neighborhoodHighConfidenceSampleCount += 1
      }

      if (lookup.kind === 'exact') {
        diagnostics.exactCoverageLookupHitCount += 1
      } else if (lookup.kind === 'neighbor') {
        diagnostics.neighborCoverageLookupHitCount += 1
      } else {
        diagnostics.coverageLookupMissCount += 1
      }
      if (state === null) {
        diagnostics.unknownMaskSampleCount += 1
        diagnostics.visualConfidenceUnknownCount += 1
      } else if (state === 'observed') {
        diagnostics.observedMaskSampleCount += 1
      } else if (state === 'partial') {
        diagnostics.partialMaskSampleCount += 1
      } else {
        diagnostics.capturedMaskSampleCount += 1
      }

      if (lookup.directState === 'captured') {
        diagnostics.capturedDirectMatchCount += 1
      }
    }
    diagnostics.visualConfidenceDurationMs = Math.max(
      0,
      getPerformanceTimestamp() - lookupStartedAt,
    )
    diagnostics.coverageLookupDurationMs = diagnostics.visualConfidenceDurationMs
    diagnostics.averageCompatibleNeighborCount = visualConfidenceSampleCount > 0
      ? compatibleNeighborSum / visualConfidenceSampleCount
      : 0
    diagnostics.averageVisualConfidence = visualConfidenceSampleCount > 0
      ? visualConfidenceSum / visualConfidenceSampleCount
      : 0
    diagnostics.worldBounds = Number.isFinite(worldMinX)
      ? {
          min: { x: worldMinX, y: worldMinY, z: worldMinZ },
          max: { x: worldMaxX, y: worldMaxY, z: worldMaxZ },
        }
      : null
    diagnostics.depthMinMeters = Number.isFinite(depthMinMeters) ? depthMinMeters : null
    diagnostics.depthMaxMeters = Number.isFinite(depthMaxMeters) ? depthMaxMeters : null
    diagnostics.coverageLookupHitPercentage = diagnostics.validSampleCount > 0
      ? (
          (diagnostics.exactCoverageLookupHitCount + diagnostics.neighborCoverageLookupHitCount) /
          diagnostics.validSampleCount
        ) * 100
      : null

    const triangleStartedAt = getPerformanceTimestamp()
    const maximumTriangles = Math.max(0, (frame.columns - 1) * (frame.rows - 1) * 2)
    this.ensureVertexCapacity(maximumTriangles)
    let offset = 0
    for (let row = 0; row < frame.rows - 1; row += 1) {
      for (let column = 0; column < frame.columns - 1; column += 1) {
        const topLeft = row * frame.columns + column
        const topRight = topLeft + 1
        const bottomLeft = topLeft + frame.columns
        const bottomRight = bottomLeft + 1
        offset = this.appendTriangle(
          offset,
          topLeft,
          bottomLeft,
          topRight,
          diagnostics,
        )
        offset = this.appendTriangle(
          offset,
          topRight,
          bottomLeft,
          bottomRight,
          diagnostics,
        )
      }
    }
    diagnostics.triangleGenerationDurationMs = Math.max(
      0,
      getPerformanceTimestamp() - triangleStartedAt,
    )

    // A successful frame replaces the prepared visual cache in one copy. It
    // is reused when depth is absent, with no triangle-by-triangle lookups.
    if (this.stabilizationOptions.cacheEnabled) {
      this.ensureCachedVertexCapacity(offset)
      this.cachedVertexData.set(this.vertexData.subarray(0, offset), 0)
      this.cachedVertexCount = offset / FLOATS_PER_VERTEX
      this.cachedMeshLastSeenAt = timestamp
    }

    diagnostics.visualCacheEntryCount = this.visualPointCache.size
    diagnostics.visualCacheMaxEntries = DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries
    diagnostics.visualCacheHitCount = this.visualCacheHitCount
    diagnostics.visualCacheRefreshCount = this.visualCacheRefreshCount
    diagnostics.visualCacheExpirationCount = this.visualCacheExpirationCount
    return this.finishMesh(
      diagnostics,
      this.vertexData,
      offset,
      timestamp,
      processingStartedAt,
    )
  }

  public buildCached(timestamp: number): DenseCoverageMesh {
    const processingStartedAt = getPerformanceTimestamp()
    this.expireVisualCacheEntries(timestamp)
    const diagnostics = createInitialDiagnostics()
    diagnostics.attemptedSampleCount = 0
    diagnostics.validSampleCount = 0
    diagnostics.representativeSamples = []
    diagnostics.stabilizationOptions = this.getStabilizationOptions()
    diagnostics.visualCacheEntryCount = this.visualPointCache.size
    diagnostics.visualCacheHitCount = this.visualCacheHitCount
    diagnostics.visualCacheRefreshCount = this.visualCacheRefreshCount
    diagnostics.visualCacheExpirationCount = this.visualCacheExpirationCount

    const hasRecentMesh = this.stabilizationOptions.cacheEnabled &&
      this.cachedMeshLastSeenAt !== null &&
      timestamp - this.cachedMeshLastSeenAt <= DENSE_VISUAL_STABILIZATION_CONFIG.cacheLifetimeMs
    const vertexCount = hasRecentMesh ? this.cachedVertexCount : 0
    if (hasRecentMesh) {
      this.visualCacheHitCount += 1
      diagnostics.visualCacheHitCount = this.visualCacheHitCount
      diagnostics.generatedTriangleCount = vertexCount / 3
    }
    return this.finishMesh(
      diagnostics,
      this.cachedVertexData,
      vertexCount * FLOATS_PER_VERTEX,
      timestamp,
      processingStartedAt,
    )
  }

  private prepareGrid(frame: DenseSpatialPointFrame): VisualGridDiagnostics {
    const sampleCount = frame.columns * frame.rows
    this.ensureGridCapacity(frame.columns, frame.rows)
    const grid = this.grid as VisualSurfaceGrid
    grid.valid.set(frame.valid)
    grid.inferred.fill(0)
    grid.distancesMeters.set(frame.distancesMeters)
    grid.points.set(frame.points)
    grid.normals.fill(0)
    grid.normalValid.fill(0)

    for (let index = 0; index < sampleCount; index += 1) {
      if (grid.valid[index] === 1) {
        estimateGridNormal(grid, index)
      }
    }

    const diagnostics: VisualGridDiagnostics = {
      holeFillSampleCount: 0,
      holeFillRejectCount: 0,
    }
    this.holeFillDurationMs = 0
    if (!this.stabilizationOptions.holeFillEnabled) {
      return diagnostics
    }

    const holeFillStartedAt = getPerformanceTimestamp()
    for (let index = 0; index < sampleCount; index += 1) {
      if (grid.valid[index] === 1) {
        continue
      }
      if (!estimateHolePoint(grid, index, this.holeEstimate)) {
        diagnostics.holeFillRejectCount += 1
        continue
      }
      grid.valid[index] = 1
      grid.inferred[index] = 1
      setGridPoint(
        grid.points,
        index,
        this.holeEstimate.x,
        this.holeEstimate.y,
        this.holeEstimate.z,
      )
      grid.distancesMeters[index] = this.holeEstimate.depthMeters
      diagnostics.holeFillSampleCount += 1
    }

    grid.normals.fill(0)
    grid.normalValid.fill(0)
    for (let index = 0; index < sampleCount; index += 1) {
      if (grid.valid[index] === 1) {
        estimateGridNormal(grid, index)
      }
    }
    this.holeFillDurationMs = Math.max(0, getPerformanceTimestamp() - holeFillStartedAt)
    return diagnostics
  }

  private appendTriangle(
    offset: number,
    firstIndex: number,
    secondIndex: number,
    thirdIndex: number,
    diagnostics: SpatialCoverageDenseDebug,
  ): number {
    const grid = this.grid as VisualSurfaceGrid
    if (
      grid.valid[firstIndex] !== 1 ||
      grid.valid[secondIndex] !== 1 ||
      grid.valid[thirdIndex] !== 1
    ) {
      diagnostics.rejectedInvalidSampleCount += 1
      return offset
    }
    if (
      !isGridPointContinuous(grid, firstIndex, secondIndex) ||
      !isGridPointContinuous(grid, secondIndex, thirdIndex) ||
      !isGridPointContinuous(grid, thirdIndex, firstIndex)
    ) {
      diagnostics.rejectedDepthDiscontinuityCount += 1
      return offset
    }

    const firstState = this.sampleStates[firstIndex]
    const secondState = this.sampleStates[secondIndex]
    const thirdState = this.sampleStates[thirdIndex]
    const firstOpacity = this.sampleOpacities[firstIndex]
    const secondOpacity = this.sampleOpacities[secondIndex]
    const thirdOpacity = this.sampleOpacities[thirdIndex]
    if (!hasVisibleMask(firstOpacity, secondOpacity, thirdOpacity)) {
      return offset
    }

    diagnostics.generatedTriangleCount += 1
    writeVertex(
      this.vertexData,
      offset,
      grid.points,
      firstIndex,
      firstState,
      firstOpacity,
    )
    writeVertex(
      this.vertexData,
      offset + FLOATS_PER_VERTEX,
      grid.points,
      secondIndex,
      secondState,
      secondOpacity,
    )
    writeVertex(
      this.vertexData,
      offset + FLOATS_PER_VERTEX * 2,
      grid.points,
      thirdIndex,
      thirdState,
      thirdOpacity,
    )
    return offset + FLOATS_PER_VERTEX * 3
  }

  private prepareVisualCache(timestamp: number): VisualCachePreparationResult {
    const grid = this.grid as VisualSurfaceGrid
    const sampleCount = grid.columns * grid.rows
    this.ensureSampleCapacity(sampleCount)
    this.matchedCacheEntries.fill(null, 0, sampleCount)
    this.frameVisualMatchCache.clear()
    if (!this.stabilizationOptions.cacheEnabled) {
      return { smoothedSampleCount: 0, smoothingDurationMs: 0 }
    }

    const smoothingStartedAt = getPerformanceTimestamp()
    let smoothedSampleCount = 0
    for (let index = 0; index < sampleCount; index += 1) {
      if (grid.valid[index] !== 1 || grid.inferred[index] === 1) {
        continue
      }
      const pointOffset = index * 3
      const pointX = grid.points[pointOffset]
      const pointY = grid.points[pointOffset + 1]
      const pointZ = grid.points[pointOffset + 2]
      const hasNormal = grid.normalValid[index] === 1
      const normalX = grid.normals[pointOffset]
      const normalY = grid.normals[pointOffset + 1]
      const normalZ = grid.normals[pointOffset + 2]
      const visualKey = getVisualCacheKey(pointX, pointY, pointZ)
      let entry = this.frameVisualMatchCache.get(visualKey)
      if (entry === undefined && !this.frameVisualMatchCache.has(visualKey)) {
        entry = this.findCompatibleVisualPoint(
          pointX,
          pointY,
          pointZ,
          hasNormal ? normalX : 0,
          hasNormal ? normalY : 0,
          hasNormal ? normalZ : 0,
          hasNormal,
          timestamp,
        )
        this.frameVisualMatchCache.set(visualKey, entry)
      }
      if (entry) {
        this.matchedCacheEntries[index] = entry
        if (entry.lastPreparedAt !== timestamp) {
          this.visualCacheHitCount += 1
          this.visualCacheRefreshCount += 1
          entry.lastPreparedAt = timestamp
          entry.lastSeenAt = timestamp
          if (this.stabilizationOptions.smoothingEnabled) {
            const alpha = DENSE_VISUAL_STABILIZATION_CONFIG.smoothingAlpha
            entry.point.x += (pointX - entry.point.x) * alpha
            entry.point.y += (pointY - entry.point.y) * alpha
            entry.point.z += (pointZ - entry.point.z) * alpha
            if (hasNormal) {
              this.accumulateNormal(entry, normalX, normalY, normalZ)
            }
            smoothedSampleCount += 1
          } else {
            entry.point.x = pointX
            entry.point.y = pointY
            entry.point.z = pointZ
            if (hasNormal) {
              if (entry.normal) {
                entry.normal.x = normalX
                entry.normal.y = normalY
                entry.normal.z = normalZ
              } else {
                entry.normal = { x: normalX, y: normalY, z: normalZ }
              }
            }
          }
        }
        setGridPoint(grid.points, index, entry.point.x, entry.point.y, entry.point.z)
        continue
      }

      const key = visualKey
      this.insertVisualPoint({
        key,
        point: { x: pointX, y: pointY, z: pointZ },
        normal: hasNormal ? { x: normalX, y: normalY, z: normalZ } : null,
        lastState: null,
        lastVisualConfidence: 0,
        lastSeenAt: timestamp,
        lastPreparedAt: timestamp,
      })
      this.frameVisualMatchCache.set(key, this.visualPointCache.get(key) ?? null)
    }

    return {
      smoothedSampleCount,
      smoothingDurationMs: Math.max(0, getPerformanceTimestamp() - smoothingStartedAt),
    }
  }

  private accumulateNormal(
    entry: VisualPointCacheEntry,
    normalX: number,
    normalY: number,
    normalZ: number,
  ): void {
    if (!entry.normal) {
      entry.normal = { x: normalX, y: normalY, z: normalZ }
      return
    }
    if (
      entry.normal.x * normalX +
        entry.normal.y * normalY +
        entry.normal.z * normalZ < 0
    ) {
      normalX = -normalX
      normalY = -normalY
      normalZ = -normalZ
    }
    const x = entry.normal.x + normalX
    const y = entry.normal.y + normalY
    const z = entry.normal.z + normalZ
    const length = Math.hypot(x, y, z)
    if (Number.isFinite(length) && length > Number.EPSILON) {
      entry.normal.x = x / length
      entry.normal.y = y / length
      entry.normal.z = z / length
    }
  }

  private findCompatibleVisualPoint(
    pointX: number,
    pointY: number,
    pointZ: number,
    normalX: number,
    normalY: number,
    normalZ: number,
    hasNormal: boolean,
    timestamp: number,
  ): VisualPointCacheEntry | null {
    const coordinatesX = Math.round(pointX / VISUAL_CACHE_KEY_SIZE_METERS)
    const coordinatesY = Math.round(pointY / VISUAL_CACHE_KEY_SIZE_METERS)
    const coordinatesZ = Math.round(pointZ / VISUAL_CACHE_KEY_SIZE_METERS)
    let nearest: VisualPointCacheEntry | null = null
    let nearestDistance: number = DENSE_VISUAL_STABILIZATION_CONFIG.smoothingMaxDistanceMeters
    for (let xOffset = -VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS; xOffset <= VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS; xOffset += 1) {
      for (let yOffset = -VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS; yOffset <= VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS; yOffset += 1) {
        for (let zOffset = -VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS; zOffset <= VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS; zOffset += 1) {
          const candidate = this.visualPointCache.get(
            `${coordinatesX + xOffset}:${coordinatesY + yOffset}:${coordinatesZ + zOffset}`,
          )
          if (!candidate) {
            continue
          }
          if (
            timestamp - candidate.lastSeenAt >
            DENSE_VISUAL_STABILIZATION_CONFIG.cacheLifetimeMs
          ) {
            continue
          }
          const distance = Math.hypot(
            candidate.point.x - pointX,
            candidate.point.y - pointY,
            candidate.point.z - pointZ,
          )
          if (distance > nearestDistance) {
            continue
          }
          if (
            hasNormal &&
            candidate.normal &&
            candidate.normal.x * normalX +
              candidate.normal.y * normalY +
              candidate.normal.z * normalZ <
              DENSE_VISUAL_STABILIZATION_CONFIG.smoothingMinNormalDot
          ) {
            continue
          }
          if (
            candidate.normal &&
            Math.abs(
              (pointX - candidate.point.x) * candidate.normal.x +
                (pointY - candidate.point.y) * candidate.normal.y +
                (pointZ - candidate.point.z) * candidate.normal.z,
            ) > DENSE_VISUAL_STABILIZATION_CONFIG.smoothingMaxPointToPlaneMeters
          ) {
            continue
          }
          nearest = candidate
          nearestDistance = distance
        }
      }
    }
    return nearest
  }

  private insertVisualPoint(entry: VisualPointCacheEntry): void {
    while (this.visualPointCache.size >= DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries) {
      const oldestKey = this.visualPointCache.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      this.visualPointCache.delete(oldestKey)
      this.visualCacheExpirationCount += 1
    }
    this.visualPointCache.set(entry.key, entry)
  }

  private expireVisualCacheEntries(timestamp: number): void {
    if (!this.stabilizationOptions.cacheEnabled) {
      return
    }
    if (
      this.cachedMeshLastSeenAt !== null &&
      timestamp - this.cachedMeshLastSeenAt > DENSE_VISUAL_STABILIZATION_CONFIG.cacheLifetimeMs
    ) {
      this.cachedMeshLastSeenAt = null
      this.cachedVertexCount = 0
      this.visualCacheExpirationCount += 1
    }

    let iterator = this.cacheExpirationIterator ?? this.visualPointCache.entries()
    for (let check = 0; check < CACHE_EXPIRATION_CHECKS_PER_UPDATE; check += 1) {
      const next = iterator.next()
      if (next.done) {
        iterator = this.visualPointCache.entries()
        const restarted = iterator.next()
        if (restarted.done) {
          this.cacheExpirationIterator = null
          return
        }
        if (timestamp - restarted.value[1].lastSeenAt > DENSE_VISUAL_STABILIZATION_CONFIG.cacheLifetimeMs) {
          this.visualPointCache.delete(restarted.value[0])
          this.visualCacheExpirationCount += 1
        }
        continue
      }
      if (timestamp - next.value[1].lastSeenAt > DENSE_VISUAL_STABILIZATION_CONFIG.cacheLifetimeMs) {
        this.visualPointCache.delete(next.value[0])
        this.visualCacheExpirationCount += 1
      }
    }
    this.cacheExpirationIterator = iterator
  }

  private ensureGridCapacity(columns: number, rows: number): void {
    const sampleCount = columns * rows
    if (
      this.grid &&
      this.grid.columns === columns &&
      this.grid.rows === rows
    ) {
      return
    }
    this.grid = {
      columns,
      rows,
      valid: new Uint8Array(sampleCount),
      inferred: new Uint8Array(sampleCount),
      distancesMeters: new Float32Array(sampleCount),
      points: new Float32Array(sampleCount * 3),
      normals: new Float32Array(sampleCount * 3),
      normalValid: new Uint8Array(sampleCount),
    }
  }

  private ensureSampleCapacity(sampleCount: number): void {
    if (this.matchedCacheEntries.length < sampleCount) {
      this.matchedCacheEntries = new Array<VisualPointCacheEntry | null>(sampleCount).fill(null)
      this.sampleStates = new Array<CoverageCellState | null>(sampleCount).fill(null)
      this.sampleOpacities = new Float32Array(sampleCount)
    }
  }

  private ensureVertexCapacity(maximumTriangles: number): void {
    const requiredFloats = maximumTriangles * 3 * FLOATS_PER_VERTEX
    if (this.vertexData.length < requiredFloats) {
      this.vertexData = new Float32Array(requiredFloats)
    }
  }

  private ensureCachedVertexCapacity(requiredFloats: number): void {
    if (this.cachedVertexData.length < requiredFloats) {
      this.cachedVertexData = new Float32Array(requiredFloats)
    }
  }

  private finishMesh(
    diagnostics: SpatialCoverageDenseDebug,
    data: Float32Array,
    usedFloats: number,
    timestamp: number,
    processingStartedAt: number,
  ): DenseCoverageMesh {
    const updateTimestamp = Number.isFinite(timestamp) ? timestamp : getPerformanceTimestamp()
    const firstUpdateAt = this.firstUpdateAt ?? updateTimestamp
    this.firstUpdateAt = firstUpdateAt
    diagnostics.updateCount = this.diagnostics.updateCount + 1
    diagnostics.updateRateHz = diagnostics.updateCount /
      Math.max(1, (updateTimestamp - firstUpdateAt) / 1000)
    diagnostics.processingDurationMs = Math.max(0, getPerformanceTimestamp() - processingStartedAt)
    diagnostics.totalProcessingDurationMs = diagnostics.processingDurationMs
    diagnostics.visualCacheEntryCount = this.visualPointCache.size
    diagnostics.visualCacheMaxEntries = DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries
    this.diagnostics = diagnostics
    this.revision += 1
    return {
      revision: this.revision,
      vertexData: data.subarray(0, usedFloats),
      vertexCount: usedFloats / FLOATS_PER_VERTEX,
    }
  }

  public getDiagnostics(): SpatialCoverageDenseDebug {
    return { ...this.diagnostics, stabilizationOptions: { ...this.diagnostics.stabilizationOptions } }
  }

  public reset(): void {
    const options = this.getStabilizationOptions()
    this.diagnostics = createInitialDiagnostics()
    this.diagnostics.stabilizationOptions = options
    this.vertexData = new Float32Array(0)
    this.cachedVertexData = new Float32Array(0)
    this.cachedVertexCount = 0
    this.cachedMeshLastSeenAt = null
    this.revision = 0
    this.grid = null
    this.visualPointCache.clear()
    this.frameVisualMatchCache.clear()
    this.coverageLookupCache.clear()
    this.cacheExpirationIterator = null
    this.matchedCacheEntries = []
    this.sampleStates = []
    this.sampleOpacities = new Float32Array(0)
    this.holeFillDurationMs = 0
    this.visualCacheHitCount = 0
    this.visualCacheRefreshCount = 0
    this.visualCacheExpirationCount = 0
    this.firstUpdateAt = null
  }

  public dispose(): void {
    this.reset()
  }
}

import type {
  CoverageCell,
  CoverageCellState,
  CoverageLookupResult,
  CoverageGuidance,
  SpatialCoverageDebug,
  SpatialCoverageRenderDebug,
  SpatialCoverageDenseDebug,
  DenseSpatialPointFrame,
  SpatialPoint,
  SpatialPointObservation,
  ViewerDirection,
  ViewerPosition,
} from '../types'
import {
  DENSE_MASK_COLUMNS,
  DENSE_MASK_ROWS,
  COVERAGE_VISUAL_OPACITY,
  COVERAGE_VISUAL_PATCH_SIZE_METERS,
  DENSE_VISUAL_STABILIZATION_CONFIG,
} from './spatialCoverageVisualConfig'

/** A 5 cm cell gives the persistent mask enough spatial detail for fine reveal. */
export const COVERAGE_CELL_SIZE_METERS = 0.05

/** Mapping consumes the same dense world-point frame that drives the mask. */
export const COVERAGE_MAPPING_COLUMNS = DENSE_MASK_COLUMNS
export const COVERAGE_MAPPING_ROWS = DENSE_MASK_ROWS

/** About 7 mapping updates per second; the XR renderer still runs every frame. */
const COVERAGE_PROCESS_INTERVAL_MS = 140
const MAPPING_PHASE_COUNT = 4
/** A gentle translation threshold that still rejects a stationary phone. */
const DISTINCT_OBSERVATION_DISTANCE_METERS = 0.03
/** Rotation can make a useful new observation even when translation is small. */
const DISTINCT_VIEW_ANGLE_RADIANS = (10 * Math.PI) / 180
const COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS = 1
// Neighbor lookup only bridges small measurement jitter around a 5 cm cell;
// it is deliberately too small to behave like a general spatial search.
const COVERAGE_NEIGHBOR_LOOKUP_MAX_DISTANCE_METERS = 0.10
/** Coverage confidence is shared by a small, coplanar physical neighborhood. */
export const COVERAGE_REGION_SUPPORT_METERS = 0.10
const COVERAGE_REGION_BUCKET_SIZE_METERS = COVERAGE_REGION_SUPPORT_METERS
const COVERAGE_REGION_LOOKUP_RADIUS_BUCKETS = 1
const COVERAGE_REGION_MAX_POINT_TO_PLANE_METERS = 0.06
const COVERAGE_REGION_MIN_NORMAL_DOT = Math.cos((50 * Math.PI) / 180)
/** Fusion tolerates depth noise across adjacent 5 cm quantization buckets. */
const SURFEL_FUSION_MAX_DISTANCE_METERS = 0.10
/** Prevents a nearby point on a different plane from being fused. */
const SURFEL_FUSION_MAX_POINT_TO_PLANE_METERS = 0.06
const SURFEL_FUSION_MIN_NORMAL_DOT = Math.cos((50 * Math.PI) / 180)
// New cells are rejected once this deterministic hard cap is reached.
export const MAX_COVERAGE_CELLS = 50_000
const OBSERVED_THRESHOLD = 1
const PARTIAL_THRESHOLD = 2
const CAPTURED_THRESHOLD = 3
const MAX_NORMAL_DEPTH_DISCONTINUITY_METERS = 0.4
const MAX_NORMAL_NEIGHBOR_SPAN_METERS = 0.8
const VECTOR_EPSILON = 1e-6

type NormalRejectionReason = 'invalid' | 'depth-discontinuity'

interface SurfaceNormalResult {
  normal: SpatialPoint | null
  rejectionReason: NormalRejectionReason | null
}

type SurfaceMatchReason =
  | 'compatible'
  | 'no-compatible-surface'
  | 'normal-similarity'
  | 'point-to-plane'

interface SurfaceMatchResult {
  cell: CoverageCell | null
  reason: SurfaceMatchReason
  candidateCount: number
  compatibleCandidateCount: number
  distanceRejectedCount: number
  pointToPlaneRejectedCount: number
  normalRejectedCount: number
  normalComparisonCount: number
  normalCompatibilityPassCount: number
  normalAngleSumRadians: number
}

interface CoverageRegion {
  key: string
  bucketKey: string
  representativePosition: SpatialPoint
  representativeNormal: SpatialPoint | null
  observationCount: number
  state: CoverageCellState
  firstObservedAt: number
  lastObservedAt: number
  lastAcceptedCameraPosition: ViewerPosition
  lastAcceptedCameraDirection: ViewerDirection | null
  memberCellKeys: Set<string>
}

interface CoverageRegionMatchResult {
  region: CoverageRegion | null
  candidateCount: number
  compatibleCandidateCount: number
  distanceRejectedCount: number
  pointToPlaneRejectedCount: number
  normalRejectedCount: number
  normalComparisonCount: number
  normalCompatibilityPassCount: number
  normalAngleSumRadians: number
}

function createInitialRenderDebug(): SpatialCoverageRenderDebug {
  return {
    status: 'idle',
    visualPatchSizeMeters: COVERAGE_VISUAL_PATCH_SIZE_METERS,
    candidateOpacity: COVERAGE_VISUAL_OPACITY.candidate,
    observedOpacity: COVERAGE_VISUAL_OPACITY.observed,
    partialOpacity: COVERAGE_VISUAL_OPACITY.partial,
    capturedOpacity: COVERAGE_VISUAL_OPACITY.captured,
    denseVertexCount: 0,
    denseRenderUpdateCount: 0,
    gpuBufferUploadDurationMs: 0,
  }
}

function createInitialDenseDebug(): SpatialCoverageDenseDebug {
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
    stabilizationOptions: {
      cacheEnabled: true,
      smoothingEnabled: true,
      holeFillEnabled: true,
      hysteresisEnabled: true,
    },
    visualCacheEntryCount: 0,
    visualCacheMaxEntries: DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries,
    visualCacheHitCount: 0,
    visualCacheRefreshCount: 0,
    visualCacheExpirationCount: 0,
    visualHoleFillSampleCount: 0,
    visualHoleFillRejectCount: 0,
    smoothedVisualFragmentCount: 0,
  }
}

function createInitialCoverageDebug(): SpatialCoverageDebug {
  return {
    cellSizeMeters: COVERAGE_CELL_SIZE_METERS,
    mappingColumns: COVERAGE_MAPPING_COLUMNS,
    mappingRows: COVERAGE_MAPPING_ROWS,
    mappingUpdateRateHz: 1000 / COVERAGE_PROCESS_INTERVAL_MS,
    mappingPhase: 0,
    mappingUpdateCount: 0,
    mappingProcessingDurationMs: 0,
    incomingMeasuredSampleCount: 0,
    matchedExistingSurfaceSampleCount: 0,
    newSurfaceCreationCount: 0,
    fusionRatio: null,
    averageCompatibleCandidatesPerSample: 0,
    samplesRejectedByDistance: 0,
    samplesRejectedByPointToPlane: 0,
    samplesRejectedByNormalCompatibility: 0,
    existingSurfaceMatchRate: null,
    newSurfaceCreationRate: null,
    distinctObservationAcceptanceRate: null,
    normalCompatibilityPassRate: null,
    averageNormalAngleDegrees: null,
    surfelsWithOneObservation: 0,
    surfelsWithTwoObservations: 0,
    surfelsWithThreeOrMoreObservations: 0,
    coverageRegionSupportMeters: COVERAGE_REGION_SUPPORT_METERS,
    coverageRegionCount: 0,
    coverageRegionObservedCount: 0,
    coverageRegionPartialCount: 0,
    coverageRegionCapturedCount: 0,
    distinctObservationAcceptedCount: 0,
    distinctTranslationQualifiedCount: 0,
    distinctRotationQualifiedCount: 0,
    duplicateViewpointRejectedCount: 0,
    samplesWithNoCompatiblePersistentSurface: 0,
    matchedObservedSurfelCount: 0,
    matchedPartialSurfelCount: 0,
    matchedCapturedSurfelCount: 0,
    observationsRejectedInsufficientCameraMovement: 0,
    observationsRejectedInsufficientViewChange: 0,
    observationsRejectedFusion: 0,
    observationsRejectedNormalSimilarity: 0,
    observationsRejectedPointToPlane: 0,
    observedToPartialTransitionsPerSecond: 0,
    partialToCapturedTransitionsPerSecond: 0,
    totalUniqueCells: 0,
    observedCells: 0,
    partialCells: 0,
    capturedCells: 0,
    currentValidSamples: 0,
    currentCapturedSamples: 0,
    currentViewCoverage: null,
    acceptedObservationCount: 0,
    newCellsCreatedCount: 0,
    observedToPartialTransitionCount: 0,
    partialToCapturedTransitionCount: 0,
    rejectedDuplicateObservationCount: 0,
    capacityRejectedSampleCount: 0,
    maxCells: MAX_COVERAGE_CELLS,
    capacityReached: false,
    rejectedInvalidNormalCount: 0,
    rejectedDepthDiscontinuityCount: 0,
    guidance: 'move-slowly-across-unscanned-areas',
    statisticsInvariantError: null,
    render: createInitialRenderDebug(),
    dense: createInitialDenseDebug(),
  }
}

export function createInitialSpatialCoverageDebug(): SpatialCoverageDebug {
  return createInitialCoverageDebug()
}

function isFinitePosition(position: ViewerPosition | null): position is ViewerPosition {
  return (
    position !== null &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z)
  )
}

function isFiniteDirection(direction: ViewerDirection | null): direction is ViewerDirection {
  return (
    direction !== null &&
    Number.isFinite(direction.x) &&
    Number.isFinite(direction.y) &&
    Number.isFinite(direction.z)
  )
}

function isFinitePointObservation(observation: SpatialPointObservation): boolean {
  return (
    Number.isFinite(observation.normalizedX) &&
    observation.normalizedX >= 0 &&
    observation.normalizedX <= 1 &&
    Number.isFinite(observation.normalizedY) &&
    observation.normalizedY >= 0 &&
    observation.normalizedY <= 1 &&
    Number.isFinite(observation.depthMeters) &&
    observation.depthMeters > 0 &&
    Number.isFinite(observation.point.x) &&
    Number.isFinite(observation.point.y) &&
    Number.isFinite(observation.point.z)
  )
}

function getGridIndex(
  normalizedX: number,
  normalizedY: number,
  columns = COVERAGE_MAPPING_COLUMNS,
  rows = COVERAGE_MAPPING_ROWS,
): number {
  const column = Math.min(
    columns - 1,
    Math.max(0, Math.round(normalizedX * (columns - 1))),
  )
  const row = Math.min(
    rows - 1,
    Math.max(0, Math.round(normalizedY * (rows - 1))),
  )

  return row * columns + column
}

function getGridCoordinates(
  gridIndex: number,
  columns = COVERAGE_MAPPING_COLUMNS,
): { row: number; column: number } {
  return {
    row: Math.floor(gridIndex / columns),
    column: gridIndex % columns,
  }
}

function getNeighborIndex(
  row: number,
  column: number,
  columns = COVERAGE_MAPPING_COLUMNS,
  rows = COVERAGE_MAPPING_ROWS,
): number | null {
  if (
    row < 0 ||
    row >= rows ||
    column < 0 ||
    column >= columns
  ) {
    return null
  }

  return row * columns + column
}

function subtractPoints(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z,
  }
}

function addPoints(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z,
  }
}

function scalePoint(point: SpatialPoint, scale: number): SpatialPoint {
  return {
    x: point.x * scale,
    y: point.y * scale,
    z: point.z * scale,
  }
}

function dotPoints(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function crossPoints(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  }
}

function getPointLength(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function normalizePoint(point: SpatialPoint): SpatialPoint | null {
  const length = getPointLength(point)
  if (!Number.isFinite(length) || length <= VECTOR_EPSILON) {
    return null
  }

  const normalized = scalePoint(point, 1 / length)
  return Number.isFinite(normalized.x) &&
    Number.isFinite(normalized.y) &&
    Number.isFinite(normalized.z)
    ? normalized
    : null
}

function getSurfaceNormal(
  center: SpatialPointObservation,
  observationsByGridIndex: ReadonlyMap<number, SpatialPointObservation>,
  cameraPosition: ViewerPosition,
  columns = COVERAGE_MAPPING_COLUMNS,
  rows = COVERAGE_MAPPING_ROWS,
): SurfaceNormalResult {
  const { row, column } = getGridCoordinates(
    getGridIndex(center.normalizedX, center.normalizedY, columns, rows),
    columns,
  )
  const leftIndex = getNeighborIndex(row, column - 1, columns, rows)
  const rightIndex = getNeighborIndex(row, column + 1, columns, rows)
  const upIndex = getNeighborIndex(row - 1, column, columns, rows)
  const downIndex = getNeighborIndex(row + 1, column, columns, rows)

  if (leftIndex === null || rightIndex === null || upIndex === null || downIndex === null) {
    return { normal: null, rejectionReason: 'invalid' }
  }

  const left = observationsByGridIndex.get(leftIndex)
  const right = observationsByGridIndex.get(rightIndex)
  const up = observationsByGridIndex.get(upIndex)
  const down = observationsByGridIndex.get(downIndex)

  if (!left || !right || !up || !down) {
    return { normal: null, rejectionReason: 'invalid' }
  }

  const hasDepthDiscontinuity =
    Math.abs(left.depthMeters - center.depthMeters) > MAX_NORMAL_DEPTH_DISCONTINUITY_METERS ||
    Math.abs(right.depthMeters - center.depthMeters) > MAX_NORMAL_DEPTH_DISCONTINUITY_METERS ||
    Math.abs(up.depthMeters - center.depthMeters) > MAX_NORMAL_DEPTH_DISCONTINUITY_METERS ||
    Math.abs(down.depthMeters - center.depthMeters) > MAX_NORMAL_DEPTH_DISCONTINUITY_METERS
  const horizontal = {
    x: right.point.x - left.point.x,
    y: right.point.y - left.point.y,
    z: right.point.z - left.point.z,
  }
  const vertical = {
    x: down.point.x - up.point.x,
    y: down.point.y - up.point.y,
    z: down.point.z - up.point.z,
  }

  if (
    hasDepthDiscontinuity ||
    getPointLength(horizontal) > MAX_NORMAL_NEIGHBOR_SPAN_METERS ||
    getPointLength(vertical) > MAX_NORMAL_NEIGHBOR_SPAN_METERS
  ) {
    return { normal: null, rejectionReason: 'depth-discontinuity' }
  }

  let normal = normalizePoint(crossPoints(horizontal, vertical))
  if (!normal) {
    return { normal: null, rejectionReason: 'invalid' }
  }

  const towardCamera = subtractPoints(cameraPosition, center.point)
  if (dotPoints(normal, towardCamera) < 0) {
    normal = scalePoint(normal, -1)
  }

  return { normal, rejectionReason: null }
}

function getCellCoordinates(point: SpatialPoint): { x: number; y: number; z: number } {
  return {
    x: Math.floor(point.x / COVERAGE_CELL_SIZE_METERS),
    y: Math.floor(point.y / COVERAGE_CELL_SIZE_METERS),
    z: Math.floor(point.z / COVERAGE_CELL_SIZE_METERS),
  }
}

function getCellKeyFromCoordinates(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`
}

function getCellKey(coordinates: { x: number; y: number; z: number }): string {
  return getCellKeyFromCoordinates(coordinates.x, coordinates.y, coordinates.z)
}

function getCellCenter(coordinates: { x: number; y: number; z: number }): SpatialPoint {
  return {
    x: (coordinates.x + 0.5) * COVERAGE_CELL_SIZE_METERS,
    y: (coordinates.y + 0.5) * COVERAGE_CELL_SIZE_METERS,
    z: (coordinates.z + 0.5) * COVERAGE_CELL_SIZE_METERS,
  }
}

function getCoverageRegionBucketCoordinates(point: SpatialPoint): {
  x: number
  y: number
  z: number
} {
  return {
    x: Math.floor(point.x / COVERAGE_REGION_BUCKET_SIZE_METERS),
    y: Math.floor(point.y / COVERAGE_REGION_BUCKET_SIZE_METERS),
    z: Math.floor(point.z / COVERAGE_REGION_BUCKET_SIZE_METERS),
  }
}

function getCoverageRegionBucketKey(coordinates: {
  x: number
  y: number
  z: number
}): string {
  return getCellKeyFromCoordinates(coordinates.x, coordinates.y, coordinates.z)
}

function getCoverageRegionState(region: CoverageRegion): CoverageCellState {
  return getStateForObservationCount(region.observationCount)
}

function getStateForObservationCount(observationCount: number): CoverageCellState {
  if (observationCount >= CAPTURED_THRESHOLD) {
    return 'captured'
  }

  if (observationCount >= PARTIAL_THRESHOLD) {
    return 'partial'
  }

  return 'observed'
}

function hasCameraMoved(
  previous: ViewerPosition,
  current: ViewerPosition,
): boolean {
  const deltaX = current.x - previous.x
  const deltaY = current.y - previous.y
  const deltaZ = current.z - previous.z

  return (
    deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ >=
    DISTINCT_OBSERVATION_DISTANCE_METERS ** 2
  )
}

interface ViewpointChange {
  translationChanged: boolean
  viewChanged: boolean
  meaningful: boolean
}

function getViewpointChange(
  previousPosition: ViewerPosition,
  currentPosition: ViewerPosition,
  previousDirection: ViewerDirection | null,
  currentDirection: ViewerDirection | null,
): ViewpointChange {
  const translationChanged = hasCameraMoved(previousPosition, currentPosition)

  let viewChanged = false
  if (isFiniteDirection(previousDirection) && isFiniteDirection(currentDirection)) {
    const normalizedPrevious = normalizePoint(previousDirection)
    const normalizedCurrent = normalizePoint(currentDirection)
    if (normalizedPrevious && normalizedCurrent) {
      const directionDot = Math.max(
        -1,
        Math.min(1, dotPoints(normalizedPrevious, normalizedCurrent)),
      )
      viewChanged = Math.acos(directionDot) >= DISTINCT_VIEW_ANGLE_RADIANS
    }
  }

  return {
    translationChanged,
    viewChanged,
    meaningful: translationChanged || viewChanged,
  }
}

function getPerformanceTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function getGuidance(currentViewCoverage: number | null): CoverageGuidance {
  if (currentViewCoverage === null || currentViewCoverage < 35) {
    return 'move-slowly-across-unscanned-areas'
  }

  if (currentViewCoverage < 75) {
    return 'continue-scanning-from-another-angle'
  }

  return 'area-captured-move-to-a-new-surface'
}

function mergeNormals(
  existingNormal: SpatialPoint | null,
  newNormal: SpatialPoint | null,
): SpatialPoint | null {
  if (!newNormal) {
    return existingNormal
  }

  if (!existingNormal) {
    return newNormal
  }

  const alignedNormal = dotPoints(existingNormal, newNormal) < 0
    ? scalePoint(newNormal, -1)
    : newNormal
  return normalizePoint(addPoints(existingNormal, alignedNormal)) ?? existingNormal
}

interface RepresentativeSurface {
  representativePosition: SpatialPoint
  observationCount: number
}

function updateRepresentativePosition(
  surface: RepresentativeSurface,
  point: SpatialPoint,
): void {
  const weight = 1 / surface.observationCount
  surface.representativePosition = addPoints(
    surface.representativePosition,
    scalePoint(subtractPoints(point, surface.representativePosition), weight),
  )
}

function findCompatibleCell(
  cellBuckets: ReadonlyMap<string, readonly CoverageCell[]>,
  point: SpatialPoint,
  normal: SpatialPoint | null,
): SurfaceMatchResult {
  const coordinates = getCellCoordinates(point)
  const maxDistanceSquared = SURFEL_FUSION_MAX_DISTANCE_METERS ** 2
  let nearestCell: CoverageCell | null = null
  let nearestDistanceSquared = maxDistanceSquared
  let nearbyCandidateFound = false
  let normalMismatchFound = false
  let pointToPlaneMismatchFound = false
  let candidateCount = 0
  let compatibleCandidateCount = 0
  let distanceRejectedCount = 0
  let pointToPlaneRejectedCount = 0
  let normalRejectedCount = 0
  let normalComparisonCount = 0
  let normalCompatibilityPassCount = 0
  let normalAngleSumRadians = 0

  for (
    let xOffset = -COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
    xOffset <= COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
    xOffset += 1
  ) {
    for (
      let yOffset = -COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
      yOffset <= COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
      yOffset += 1
    ) {
      for (
        let zOffset = -COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
        zOffset <= COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
        zOffset += 1
      ) {
        const candidates = cellBuckets.get(
          getCellKeyFromCoordinates(
            coordinates.x + xOffset,
            coordinates.y + yOffset,
            coordinates.z + zOffset,
          ),
        )
        if (!candidates) {
          continue
        }

        for (const candidate of candidates) {
          candidateCount += 1

          const delta = subtractPoints(candidate.representativePosition, point)
          const distanceSquared = dotPoints(delta, delta)
          if (distanceSquared > maxDistanceSquared) {
            distanceRejectedCount += 1
            continue
          }
          nearbyCandidateFound = true

          if (normal && candidate.representativeNormal) {
            const normalDot = dotPoints(normal, candidate.representativeNormal)
            normalComparisonCount += 1
            if (normalDot < SURFEL_FUSION_MIN_NORMAL_DOT) {
              normalMismatchFound = true
              normalRejectedCount += 1
              continue
            }
            normalCompatibilityPassCount += 1
            normalAngleSumRadians += Math.acos(
              Math.max(-1, Math.min(1, normalDot)),
            )
          }

          if (candidate.representativeNormal) {
            const pointToPlaneDistance = Math.abs(
              dotPoints(delta, candidate.representativeNormal),
            )
            if (pointToPlaneDistance > SURFEL_FUSION_MAX_POINT_TO_PLANE_METERS) {
              pointToPlaneMismatchFound = true
              pointToPlaneRejectedCount += 1
              continue
            }
          }

          compatibleCandidateCount += 1

          if (distanceSquared < nearestDistanceSquared) {
            nearestCell = candidate
            nearestDistanceSquared = distanceSquared
          }
        }
      }
    }
  }

  if (nearestCell) {
    return {
      cell: nearestCell,
      reason: 'compatible',
      candidateCount,
      compatibleCandidateCount,
      distanceRejectedCount,
      pointToPlaneRejectedCount,
      normalRejectedCount,
      normalComparisonCount,
      normalCompatibilityPassCount,
      normalAngleSumRadians,
    }
  }

  if (normalMismatchFound) {
    return {
      cell: null,
      reason: 'normal-similarity',
      candidateCount,
      compatibleCandidateCount,
      distanceRejectedCount,
      pointToPlaneRejectedCount,
      normalRejectedCount,
      normalComparisonCount,
      normalCompatibilityPassCount,
      normalAngleSumRadians,
    }
  }

  if (pointToPlaneMismatchFound) {
    return {
      cell: null,
      reason: 'point-to-plane',
      candidateCount,
      compatibleCandidateCount,
      distanceRejectedCount,
      pointToPlaneRejectedCount,
      normalRejectedCount,
      normalComparisonCount,
      normalCompatibilityPassCount,
      normalAngleSumRadians,
    }
  }

  return {
    cell: null,
    reason: nearbyCandidateFound ? 'point-to-plane' : 'no-compatible-surface',
    candidateCount,
    compatibleCandidateCount,
    distanceRejectedCount,
    pointToPlaneRejectedCount,
    normalRejectedCount,
    normalComparisonCount,
    normalCompatibilityPassCount,
    normalAngleSumRadians,
  }
}

function findCompatibleCoverageRegion(
  regionBuckets: ReadonlyMap<string, readonly CoverageRegion[]>,
  point: SpatialPoint,
  normal: SpatialPoint | null,
): CoverageRegionMatchResult {
  const coordinates = getCoverageRegionBucketCoordinates(point)
  const maxDistanceSquared = COVERAGE_REGION_SUPPORT_METERS ** 2
  let nearestRegion: CoverageRegion | null = null
  let nearestDistanceSquared = maxDistanceSquared
  let candidateCount = 0
  let compatibleCandidateCount = 0
  let distanceRejectedCount = 0
  let pointToPlaneRejectedCount = 0
  let normalRejectedCount = 0
  let normalComparisonCount = 0
  let normalCompatibilityPassCount = 0
  let normalAngleSumRadians = 0

  for (
    let xOffset = -COVERAGE_REGION_LOOKUP_RADIUS_BUCKETS;
    xOffset <= COVERAGE_REGION_LOOKUP_RADIUS_BUCKETS;
    xOffset += 1
  ) {
    for (
      let yOffset = -COVERAGE_REGION_LOOKUP_RADIUS_BUCKETS;
      yOffset <= COVERAGE_REGION_LOOKUP_RADIUS_BUCKETS;
      yOffset += 1
    ) {
      for (
        let zOffset = -COVERAGE_REGION_LOOKUP_RADIUS_BUCKETS;
        zOffset <= COVERAGE_REGION_LOOKUP_RADIUS_BUCKETS;
        zOffset += 1
      ) {
        const bucket = regionBuckets.get(
          getCoverageRegionBucketKey({
            x: coordinates.x + xOffset,
            y: coordinates.y + yOffset,
            z: coordinates.z + zOffset,
          }),
        )
        if (!bucket) {
          continue
        }

        for (const region of bucket) {
          candidateCount += 1
          const delta = subtractPoints(region.representativePosition, point)
          const distanceSquared = dotPoints(delta, delta)
          if (distanceSquared > maxDistanceSquared) {
            distanceRejectedCount += 1
            continue
          }

          if (normal && region.representativeNormal) {
            const normalDot = dotPoints(normal, region.representativeNormal)
            normalComparisonCount += 1
            if (normalDot < COVERAGE_REGION_MIN_NORMAL_DOT) {
              normalRejectedCount += 1
              continue
            }
            normalCompatibilityPassCount += 1
            normalAngleSumRadians += Math.acos(
              Math.max(-1, Math.min(1, normalDot)),
            )
          }

          if (region.representativeNormal) {
            const pointToPlaneDistance = Math.abs(
              dotPoints(delta, region.representativeNormal),
            )
            if (pointToPlaneDistance > COVERAGE_REGION_MAX_POINT_TO_PLANE_METERS) {
              pointToPlaneRejectedCount += 1
              continue
            }
          }

          compatibleCandidateCount += 1
          if (distanceSquared < nearestDistanceSquared) {
            nearestRegion = region
            nearestDistanceSquared = distanceSquared
          }
        }
      }
    }
  }

  return {
    region: nearestRegion,
    candidateCount,
    compatibleCandidateCount,
    distanceRejectedCount,
    pointToPlaneRejectedCount,
    normalRejectedCount,
    normalComparisonCount,
    normalCompatibilityPassCount,
    normalAngleSumRadians,
  }
}

/**
 * Accumulates bounded world-space coverage cells and surface metadata. Repeat
 * observations are fused into nearby coplanar surface neighborhoods and are
 * accepted only after a modest camera translation or view-direction change.
 */
export class SpatialCoverageService {
  private readonly cells = new Map<string, CoverageCell>()

  /** Fine geometry buckets may contain more than one surface at a corner. */
  private readonly cellBuckets = new Map<string, CoverageCell[]>()

  /**
   * Confidence lives in a coarser local surface neighborhood than the
   * 5 cm geometry index. Each bucket can hold a few coplanar regions so a
   * wall/ceiling corner is not merged merely because it shares a bucket.
   */
  private readonly coverageRegions = new Map<string, CoverageRegion>()

  private readonly coverageRegionBuckets = new Map<string, CoverageRegion[]>()

  private readonly mappingObservations: SpatialPointObservation[] = []

  private mappingObservationCursor = 0

  private readonly observationsByGridIndex = new Map<number, SpatialPointObservation>()

  private readonly currentGridKeys = new Map<number, string>()

  private readonly currentFrameKeys = new Set<string>()

  /** One raw 5 cm world bucket is considered at most once per mapping update. */
  private readonly currentMappingCellKeys = new Set<string>()

  /** A local coverage region receives at most one confidence event per update. */
  private readonly currentFrameRegionKeys = new Set<string>()

  private normalCompatibilityCandidateCount = 0

  private normalCompatibilityPassCount = 0

  private normalAngleSumRadians = 0

  private diagnostics = createInitialCoverageDebug()

  private lastProcessedAt = Number.NEGATIVE_INFINITY

  private transitionRateStartedAt: number | null = null

  /**
   * Uses all valid dense world points as the source of truth. The mapper is
   * throttled and deduplicates repeated 5 cm cells inside processFrame.
   */
  public processDenseFrame(
    denseFrame: DenseSpatialPointFrame,
    cameraPosition: ViewerPosition | null,
    cameraDirection: ViewerDirection | null,
    timestamp: number,
    phase: number,
  ): void {
    const normalizedPhase = ((phase % MAPPING_PHASE_COUNT) + MAPPING_PHASE_COUNT) % MAPPING_PHASE_COUNT
    this.mappingObservationCursor = 0

    // Rotate traversal order between phases so a cell receiving several
    // samples does not always choose the same dense-grid representative.
    const rowStart = normalizedPhase % denseFrame.rows
    const columnStart = Math.floor(normalizedPhase / 2) % denseFrame.columns
    for (let rowOffset = 0; rowOffset < denseFrame.rows; rowOffset += 1) {
      const row = (rowOffset + rowStart) % denseFrame.rows
      for (let columnOffset = 0; columnOffset < denseFrame.columns; columnOffset += 1) {
        const column = (columnOffset + columnStart) % denseFrame.columns
        const sourceIndex = row * denseFrame.columns + column

        if (denseFrame.valid[sourceIndex] === 1) {
          const pointOffset = sourceIndex * 3
          const observationIndex = this.mappingObservationCursor
          const observation = this.mappingObservations[observationIndex]
          this.mappingObservationCursor += 1
          if (observation) {
            observation.normalizedX = denseFrame.normalizedX[sourceIndex]
            observation.normalizedY = denseFrame.normalizedY[sourceIndex]
            observation.depthMeters = denseFrame.distancesMeters[sourceIndex]
            observation.point.x = denseFrame.points[pointOffset]
            observation.point.y = denseFrame.points[pointOffset + 1]
            observation.point.z = denseFrame.points[pointOffset + 2]
          } else {
            this.mappingObservations.push({
              normalizedX: denseFrame.normalizedX[sourceIndex],
              normalizedY: denseFrame.normalizedY[sourceIndex],
              depthMeters: denseFrame.distancesMeters[sourceIndex],
              point: {
                x: denseFrame.points[pointOffset],
                y: denseFrame.points[pointOffset + 1],
                z: denseFrame.points[pointOffset + 2],
              },
            })
          }
        }
      }
    }

    this.mappingObservations.length = this.mappingObservationCursor

    this.diagnostics.mappingPhase = normalizedPhase
    const mappingStartedAt = getPerformanceTimestamp()
    if (this.processFrame(
      this.mappingObservations,
      cameraPosition,
      cameraDirection,
      timestamp,
      denseFrame.columns,
      denseFrame.rows,
    )) {
      this.diagnostics.mappingUpdateCount += 1
    }
    this.diagnostics.mappingProcessingDurationMs = Math.max(
      0,
      getPerformanceTimestamp() - mappingStartedAt,
    )
  }

  public processFrame(
    observations: readonly SpatialPointObservation[],
    cameraPosition: ViewerPosition | null,
    cameraDirection: ViewerDirection | null,
    timestamp: number,
    gridColumns = COVERAGE_MAPPING_COLUMNS,
    gridRows = COVERAGE_MAPPING_ROWS,
  ): boolean {
    if (
      !Number.isFinite(timestamp) ||
      timestamp - this.lastProcessedAt < COVERAGE_PROCESS_INTERVAL_MS
    ) {
      return false
    }

    this.lastProcessedAt = timestamp
    this.resetCurrentFrameDiagnostics()

    if (!isFinitePosition(cameraPosition)) {
      return false
    }

    if (this.transitionRateStartedAt === null) {
      this.transitionRateStartedAt = timestamp
    }

    const observationsByGridIndex = this.observationsByGridIndex
    observationsByGridIndex.clear()
    for (const observation of observations) {
      if (isFinitePointObservation(observation)) {
        observationsByGridIndex.set(
          getGridIndex(
            observation.normalizedX,
            observation.normalizedY,
            gridColumns,
            gridRows,
          ),
          observation,
        )
      }
    }

    const currentGridKeys = this.currentGridKeys
    currentGridKeys.clear()
    const currentFrameKeys = this.currentFrameKeys
    currentFrameKeys.clear()
    const currentMappingCellKeys = this.currentMappingCellKeys
    currentMappingCellKeys.clear()
    const currentFrameRegionKeys = this.currentFrameRegionKeys
    currentFrameRegionKeys.clear()

    // Rates below use the samples that survive the per-update 5 cm spatial
    // deduplication, which is the actual bounded mapper input.
    this.diagnostics.incomingMeasuredSampleCount = 0
    let compatibleCandidateTotal = 0
    let distinctAcceptedThisUpdate = 0

    for (const observation of observationsByGridIndex.values()) {
      const gridIndex = getGridIndex(
        observation.normalizedX,
        observation.normalizedY,
        gridColumns,
        gridRows,
      )
      const coordinates = getCellCoordinates(observation.point)
      const mappingCellKey = getCellKey(coordinates)
      if (currentMappingCellKeys.has(mappingCellKey)) {
        this.diagnostics.rejectedDuplicateObservationCount += 1
        continue
      }
      currentMappingCellKeys.add(mappingCellKey)
      this.diagnostics.incomingMeasuredSampleCount += 1
      const normalResult = getSurfaceNormal(
        observation,
        observationsByGridIndex,
        cameraPosition,
        gridColumns,
        gridRows,
      )
      if (normalResult.rejectionReason === 'invalid') {
        this.diagnostics.rejectedInvalidNormalCount += 1
      } else if (normalResult.rejectionReason === 'depth-discontinuity') {
        this.diagnostics.rejectedDepthDiscontinuityCount += 1
      }

      const surfaceMatch = findCompatibleCell(
        this.cellBuckets,
        observation.point,
        normalResult.normal,
      )
      this.diagnostics.samplesRejectedByDistance += surfaceMatch.distanceRejectedCount
      this.diagnostics.samplesRejectedByPointToPlane +=
        surfaceMatch.pointToPlaneRejectedCount
      this.diagnostics.samplesRejectedByNormalCompatibility +=
        surfaceMatch.normalRejectedCount
      compatibleCandidateTotal += surfaceMatch.compatibleCandidateCount
      this.normalCompatibilityCandidateCount += surfaceMatch.normalComparisonCount
      this.normalCompatibilityPassCount += surfaceMatch.normalCompatibilityPassCount
      this.normalAngleSumRadians += surfaceMatch.normalAngleSumRadians
      if (surfaceMatch.cell) {
        this.diagnostics.matchedExistingSurfaceSampleCount += 1
        if (surfaceMatch.cell.state === 'observed') {
          this.diagnostics.matchedObservedSurfelCount += 1
        } else if (surfaceMatch.cell.state === 'partial') {
          this.diagnostics.matchedPartialSurfelCount += 1
        } else {
          this.diagnostics.matchedCapturedSurfelCount += 1
        }
      } else {
        this.diagnostics.samplesWithNoCompatiblePersistentSurface += 1
        if (surfaceMatch.reason === 'normal-similarity') {
          this.diagnostics.observationsRejectedNormalSimilarity += 1
          this.diagnostics.observationsRejectedFusion += 1
        } else if (surfaceMatch.reason === 'point-to-plane') {
          this.diagnostics.observationsRejectedPointToPlane += 1
          this.diagnostics.observationsRejectedFusion += 1
        }
      }

      if (currentGridKeys.has(gridIndex)) {
        this.diagnostics.rejectedDuplicateObservationCount += 1
        continue
      }
      const bucketKey = getCellKey(coordinates)
      const key = surfaceMatch.cell?.key ?? this.getAvailableCellKey(bucketKey)

      const existingCell = surfaceMatch.cell
      const isDuplicateInCurrentFrame = currentFrameKeys.has(key)
      currentFrameKeys.add(key)

      if (!existingCell) {
        if (this.cells.size >= MAX_COVERAGE_CELLS) {
          this.diagnostics.capacityRejectedSampleCount += 1
          this.diagnostics.capacityReached = true
          continue
        }

        const regionMatch = findCompatibleCoverageRegion(
          this.coverageRegionBuckets,
          observation.point,
          normalResult.normal,
        )
        this.diagnostics.samplesRejectedByDistance += regionMatch.distanceRejectedCount
        this.diagnostics.samplesRejectedByPointToPlane +=
          regionMatch.pointToPlaneRejectedCount
        this.diagnostics.samplesRejectedByNormalCompatibility +=
          regionMatch.normalRejectedCount
        compatibleCandidateTotal += regionMatch.compatibleCandidateCount
        this.normalCompatibilityCandidateCount += regionMatch.normalComparisonCount
        this.normalCompatibilityPassCount += regionMatch.normalCompatibilityPassCount
        this.normalAngleSumRadians += regionMatch.normalAngleSumRadians
        let region = regionMatch.region
        let createdRegion = false
        if (!region) {
          region = this.createCoverageRegion(
            observation.point,
            normalResult.normal,
            cameraPosition,
            cameraDirection,
            timestamp,
          )
          createdRegion = region !== null
        }
        if (!region) {
          this.diagnostics.capacityRejectedSampleCount += 1
          this.diagnostics.capacityReached = true
          continue
        }

        const cell: CoverageCell = {
          key,
          coverageRegionKey: region.key,
          center: getCellCenter(coordinates),
          representativePosition: { ...observation.point },
          representativeNormal: normalResult.normal,
          observationCount: region.observationCount,
          state: region.state,
          firstObservedAt: timestamp,
          lastObservedAt: timestamp,
          lastAcceptedCameraPosition: { ...cameraPosition },
          lastAcceptedCameraDirection: cameraDirection
            ? { ...cameraDirection }
            : null,
        }
        this.cells.set(key, cell)
        this.addCellToSpatialBucket(bucketKey, cell)
        this.incrementStateCount(cell.state)
        region.memberCellKeys.add(cell.key)
        currentGridKeys.set(gridIndex, key)
        this.diagnostics.newCellsCreatedCount += 1
        this.diagnostics.newSurfaceCreationCount += 1
        if (createdRegion) {
          currentFrameRegionKeys.add(region.key)
          this.diagnostics.acceptedObservationCount += 1
          this.diagnostics.distinctObservationAcceptedCount += 1
          distinctAcceptedThisUpdate += 1
          continue
        }
      }

      currentGridKeys.set(gridIndex, key)

      if (isDuplicateInCurrentFrame) {
        this.diagnostics.rejectedDuplicateObservationCount += 1
        continue
      }

      const region = this.getOrCreateCoverageRegionForCell(
        existingCell ?? this.cells.get(key)!,
        observation.point,
        normalResult.normal,
      )
      if (!region) {
        this.diagnostics.capacityRejectedSampleCount += 1
        this.diagnostics.capacityReached = true
        continue
      }

      if (currentFrameRegionKeys.has(region.key)) {
        this.diagnostics.rejectedDuplicateObservationCount += 1
        continue
      }
      currentFrameRegionKeys.add(region.key)

      const viewpointChange = getViewpointChange(
        region.lastAcceptedCameraPosition,
        cameraPosition,
        region.lastAcceptedCameraDirection,
        cameraDirection,
      )
      if (!viewpointChange.meaningful) {
        if (!viewpointChange.translationChanged) {
          this.diagnostics.observationsRejectedInsufficientCameraMovement += 1
        }
        if (!viewpointChange.viewChanged) {
          this.diagnostics.observationsRejectedInsufficientViewChange += 1
        }
        this.diagnostics.rejectedDuplicateObservationCount += 1
        this.diagnostics.duplicateViewpointRejectedCount += 1
        continue
      }

      const previousState = region.state
      region.observationCount += 1
      region.state = getCoverageRegionState(region)
      if (previousState === 'observed' && region.state === 'partial') {
        this.diagnostics.observedToPartialTransitionCount += 1
      } else if (previousState === 'partial' && region.state === 'captured') {
        this.diagnostics.partialToCapturedTransitionCount += 1
      }
      region.lastObservedAt = timestamp
      region.lastAcceptedCameraPosition = { ...cameraPosition }
      region.lastAcceptedCameraDirection = cameraDirection
        ? { ...cameraDirection }
        : null
      updateRepresentativePosition(region, observation.point)
      region.representativeNormal = mergeNormals(
        region.representativeNormal,
        normalResult.normal,
      )
      this.synchronizeRegionCells(region)
      this.updateCellRepresentation(
        existingCell ?? this.cells.get(key)!,
        observation.point,
        normalResult.normal,
        timestamp,
      )
      this.diagnostics.acceptedObservationCount += 1
      this.diagnostics.distinctObservationAcceptedCount += 1
      distinctAcceptedThisUpdate += 1
      if (viewpointChange.translationChanged) {
        this.diagnostics.distinctTranslationQualifiedCount += 1
      }
      if (viewpointChange.viewChanged) {
        this.diagnostics.distinctRotationQualifiedCount += 1
      }
    }

    const incomingSamples = this.diagnostics.incomingMeasuredSampleCount
    this.diagnostics.fusionRatio = incomingSamples > 0
      ? this.diagnostics.matchedExistingSurfaceSampleCount / incomingSamples
      : null
    this.diagnostics.existingSurfaceMatchRate = this.diagnostics.fusionRatio
    this.diagnostics.newSurfaceCreationRate = incomingSamples > 0
      ? this.diagnostics.newSurfaceCreationCount / incomingSamples
      : null
    this.diagnostics.distinctObservationAcceptanceRate = incomingSamples > 0
      ? distinctAcceptedThisUpdate / incomingSamples
      : null
    this.diagnostics.averageCompatibleCandidatesPerSample = incomingSamples > 0
      ? compatibleCandidateTotal / incomingSamples
      : 0
    this.diagnostics.normalCompatibilityPassRate =
      this.normalCompatibilityCandidateCount > 0
        ? this.normalCompatibilityPassCount / this.normalCompatibilityCandidateCount
        : null
    this.diagnostics.averageNormalAngleDegrees =
      this.normalCompatibilityPassCount > 0
        ? (this.normalAngleSumRadians / this.normalCompatibilityPassCount) * (180 / Math.PI)
        : null

    this.diagnostics.currentValidSamples = currentGridKeys.size
    let currentCapturedSamples = 0
    for (const key of currentGridKeys.values()) {
      const cell = this.cells.get(key)
      if (cell && this.getCoverageStateForCell(cell) === 'captured') {
        currentCapturedSamples += 1
      }
    }
    this.diagnostics.currentCapturedSamples = currentCapturedSamples
    this.diagnostics.currentViewCoverage =
      this.diagnostics.currentValidSamples > 0
        ? (this.diagnostics.currentCapturedSamples / this.diagnostics.currentValidSamples) * 100
        : null
    this.diagnostics.guidance = getGuidance(this.diagnostics.currentViewCoverage)
    const elapsedSeconds = Math.max(
      1,
      (timestamp - (this.transitionRateStartedAt ?? timestamp)) / 1000,
    )
    this.diagnostics.observedToPartialTransitionsPerSecond =
      this.diagnostics.observedToPartialTransitionCount / elapsedSeconds
    this.diagnostics.partialToCapturedTransitionsPerSecond =
      this.diagnostics.partialToCapturedTransitionCount / elapsedSeconds
    return true
  }

  private createCoverageRegion(
    point: SpatialPoint,
    normal: SpatialPoint | null,
    cameraPosition: ViewerPosition,
    cameraDirection: ViewerDirection | null,
    timestamp: number,
  ): CoverageRegion | null {
    if (this.coverageRegions.size >= MAX_COVERAGE_CELLS) {
      return null
    }

    const bucketCoordinates = getCoverageRegionBucketCoordinates(point)
    const bucketKey = getCoverageRegionBucketKey(bucketCoordinates)
    const region: CoverageRegion = {
      key: `${bucketKey}#${this.coverageRegions.size}`,
      bucketKey,
      representativePosition: { ...point },
      representativeNormal: normal ? { ...normal } : null,
      observationCount: OBSERVED_THRESHOLD,
      state: 'observed',
      firstObservedAt: timestamp,
      lastObservedAt: timestamp,
      lastAcceptedCameraPosition: { ...cameraPosition },
      lastAcceptedCameraDirection: cameraDirection ? { ...cameraDirection } : null,
      memberCellKeys: new Set<string>(),
    }
    this.coverageRegions.set(region.key, region)
    const bucket = this.coverageRegionBuckets.get(bucketKey)
    if (bucket) {
      bucket.push(region)
    } else {
      this.coverageRegionBuckets.set(bucketKey, [region])
    }
    return region
  }

  private createCoverageRegionFromCell(cell: CoverageCell): CoverageRegion | null {
    const region = this.createCoverageRegion(
      cell.representativePosition,
      cell.representativeNormal,
      cell.lastAcceptedCameraPosition,
      cell.lastAcceptedCameraDirection,
      cell.lastObservedAt,
    )
    if (!region) {
      return null
    }

    region.observationCount = cell.observationCount
    region.state = cell.state
    region.firstObservedAt = cell.firstObservedAt
    region.lastObservedAt = cell.lastObservedAt
    return region
  }

  private getOrCreateCoverageRegionForCell(
    cell: CoverageCell,
    point: SpatialPoint,
    normal: SpatialPoint | null,
  ): CoverageRegion | null {
    const linkedRegion = this.coverageRegions.get(cell.coverageRegionKey)
    if (linkedRegion) {
      linkedRegion.memberCellKeys.add(cell.key)
      return linkedRegion
    }

    const nearbyRegion = findCompatibleCoverageRegion(
      this.coverageRegionBuckets,
      point,
      normal,
    ).region
    const region = nearbyRegion ?? this.createCoverageRegionFromCell(cell)
    if (!region) {
      return null
    }

    this.attachCellToRegion(cell, region)
    return region
  }

  private attachCellToRegion(cell: CoverageCell, region: CoverageRegion): void {
    region.memberCellKeys.add(cell.key)
    cell.coverageRegionKey = region.key
    if (cell.state !== region.state) {
      this.incrementStateCount(cell.state, -1)
      cell.state = region.state
      this.incrementStateCount(cell.state)
    }
    cell.observationCount = region.observationCount
    cell.lastObservedAt = region.lastObservedAt
  }

  private synchronizeRegionCells(region: CoverageRegion): void {
    for (const cellKey of region.memberCellKeys) {
      const cell = this.cells.get(cellKey)
      if (!cell) {
        continue
      }

      if (cell.state !== region.state) {
        this.incrementStateCount(cell.state, -1)
        cell.state = region.state
        this.incrementStateCount(cell.state)
      }
      cell.observationCount = region.observationCount
      cell.lastObservedAt = region.lastObservedAt
    }
  }

  private updateCellRepresentation(
    cell: CoverageCell,
    point: SpatialPoint,
    normal: SpatialPoint | null,
    timestamp: number,
  ): void {
    updateRepresentativePosition(cell, point)
    cell.representativeNormal = mergeNormals(cell.representativeNormal, normal)
    cell.lastObservedAt = timestamp
  }

  private getCoverageStateForCell(cell: CoverageCell): CoverageCellState {
    return this.coverageRegions.get(cell.coverageRegionKey)?.state ?? cell.state
  }

  private getAvailableCellKey(bucketKey: string): string {
    if (!this.cells.has(bucketKey)) {
      return bucketKey
    }

    return `${bucketKey}#${this.cells.size}`
  }

  private addCellToSpatialBucket(bucketKey: string, cell: CoverageCell): void {
    const bucket = this.cellBuckets.get(bucketKey)
    if (bucket) {
      bucket.push(cell)
    } else {
      this.cellBuckets.set(bucketKey, [cell])
    }
  }

  public getCoverageLookupAtPoint(point: SpatialPoint): CoverageLookupResult {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    ) {
      return { state: null, kind: 'miss' }
    }

    const coordinates = getCellCoordinates(point)
    const exactCandidates = this.cellBuckets.get(
      getCellKeyFromCoordinates(coordinates.x, coordinates.y, coordinates.z),
    )
    if (exactCandidates && exactCandidates.length > 0) {
      let nearestExactCell = exactCandidates[0]
      let nearestExactDistanceSquared = Number.POSITIVE_INFINITY
      for (const candidate of exactCandidates) {
        const delta = subtractPoints(candidate.representativePosition, point)
        const distanceSquared = dotPoints(delta, delta)
        if (distanceSquared < nearestExactDistanceSquared) {
          nearestExactCell = candidate
          nearestExactDistanceSquared = distanceSquared
        }
      }
      return {
        state: this.getCoverageStateForCell(nearestExactCell),
        kind: 'exact',
      }
    }

    // Dense samples can land in a neighboring 5 cm bucket because of depth
    // noise. Resolve the larger coplanar coverage neighborhood before falling
    // back to the fine geometry-cell index.
    const nearbyRegion = findCompatibleCoverageRegion(
      this.coverageRegionBuckets,
      point,
      null,
    ).region
    if (nearbyRegion) {
      return { state: nearbyRegion.state, kind: 'neighbor' }
    }

    let nearestCell: CoverageCell | null = null
    let nearestDistanceSquared = COVERAGE_NEIGHBOR_LOOKUP_MAX_DISTANCE_METERS ** 2
    for (
      let xOffset = -COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
      xOffset <= COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
      xOffset += 1
    ) {
      for (
        let yOffset = -COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
        yOffset <= COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
        yOffset += 1
      ) {
        for (
          let zOffset = -COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
          zOffset <= COVERAGE_NEIGHBOR_LOOKUP_RADIUS_CELLS;
          zOffset += 1
        ) {
          if (xOffset === 0 && yOffset === 0 && zOffset === 0) {
            continue
          }

          const candidates = this.cellBuckets.get(
            getCellKeyFromCoordinates(
              coordinates.x + xOffset,
              coordinates.y + yOffset,
              coordinates.z + zOffset,
            ),
          )
          if (!candidates) {
            continue
          }

          for (const candidate of candidates) {
            const deltaX = candidate.representativePosition.x - point.x
            const deltaY = candidate.representativePosition.y - point.y
            const deltaZ = candidate.representativePosition.z - point.z
            const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ
            if (distanceSquared < nearestDistanceSquared) {
              nearestCell = candidate
              nearestDistanceSquared = distanceSquared
            }
          }
        }
      }
    }

    return nearestCell
      ? { state: this.getCoverageStateForCell(nearestCell), kind: 'neighbor' }
      : { state: null, kind: 'miss' }
  }

  public getCoverageStateAtPoint(point: SpatialPoint): CoverageCellState | null {
    return this.getCoverageLookupAtPoint(point).state
  }

  public getFinalizationCells(): readonly CoverageCell[] {
    return Array.from(this.cells.values(), (cell) => ({
      ...cell,
      center: { ...cell.center },
      representativePosition: { ...cell.representativePosition },
      representativeNormal: cell.representativeNormal
        ? { ...cell.representativeNormal }
        : null,
      lastAcceptedCameraPosition: { ...cell.lastAcceptedCameraPosition },
      lastAcceptedCameraDirection: cell.lastAcceptedCameraDirection
        ? { ...cell.lastAcceptedCameraDirection }
        : null,
    }))
  }

  public getDiagnostics(
    render: SpatialCoverageRenderDebug,
    dense: SpatialCoverageDenseDebug,
  ): SpatialCoverageDebug {
    const totalUniqueCells = this.cells.size
    let surfelsWithOneObservation = 0
    let surfelsWithTwoObservations = 0
    let surfelsWithThreeOrMoreObservations = 0
    for (const cell of this.cells.values()) {
      if (cell.observationCount === 1) {
        surfelsWithOneObservation += 1
      } else if (cell.observationCount === 2) {
        surfelsWithTwoObservations += 1
      } else if (cell.observationCount >= 3) {
        surfelsWithThreeOrMoreObservations += 1
      }
    }

    let coverageRegionObservedCount = 0
    let coverageRegionPartialCount = 0
    let coverageRegionCapturedCount = 0
    for (const region of this.coverageRegions.values()) {
      if (region.state === 'observed') {
        coverageRegionObservedCount += 1
      } else if (region.state === 'partial') {
        coverageRegionPartialCount += 1
      } else {
        coverageRegionCapturedCount += 1
      }
    }

    const statisticsInvariantError =
      this.diagnostics.capturedCells > totalUniqueCells
        ? 'Captured coverage cells exceed total unique coverage cells.'
        : null

    return {
      ...this.diagnostics,
      totalUniqueCells,
      capturedCells: Math.min(this.diagnostics.capturedCells, totalUniqueCells),
      surfelsWithOneObservation,
      surfelsWithTwoObservations,
      surfelsWithThreeOrMoreObservations,
      coverageRegionCount: this.coverageRegions.size,
      coverageRegionObservedCount,
      coverageRegionPartialCount,
      coverageRegionCapturedCount,
      statisticsInvariantError,
      render: { ...render },
      dense: { ...dense },
    }
  }

  public reset(): void {
    this.cells.clear()
    this.cellBuckets.clear()
    this.coverageRegions.clear()
    this.coverageRegionBuckets.clear()
    this.mappingObservations.length = 0
    this.mappingObservationCursor = 0
    this.observationsByGridIndex.clear()
    this.currentGridKeys.clear()
    this.currentFrameKeys.clear()
    this.currentMappingCellKeys.clear()
    this.currentFrameRegionKeys.clear()
    this.normalCompatibilityCandidateCount = 0
    this.normalCompatibilityPassCount = 0
    this.normalAngleSumRadians = 0
    this.lastProcessedAt = Number.NEGATIVE_INFINITY
    this.transitionRateStartedAt = null
    this.diagnostics = createInitialCoverageDebug()
  }

  public dispose(): void {
    this.reset()
  }

  private resetCurrentFrameDiagnostics(): void {
    this.diagnostics.incomingMeasuredSampleCount = 0
    this.diagnostics.matchedExistingSurfaceSampleCount = 0
    this.diagnostics.newSurfaceCreationCount = 0
    this.diagnostics.fusionRatio = null
    this.diagnostics.averageCompatibleCandidatesPerSample = 0
    this.diagnostics.existingSurfaceMatchRate = null
    this.diagnostics.newSurfaceCreationRate = null
    this.diagnostics.distinctObservationAcceptanceRate = null
    this.diagnostics.currentValidSamples = 0
    this.diagnostics.currentCapturedSamples = 0
    this.diagnostics.currentViewCoverage = null
    this.diagnostics.guidance = 'move-slowly-across-unscanned-areas'
    this.diagnostics.rejectedInvalidNormalCount = 0
    this.diagnostics.rejectedDepthDiscontinuityCount = 0
  }

  private incrementStateCount(state: CoverageCellState, amount = 1): void {
    if (state === 'observed') {
      this.diagnostics.observedCells += amount
    } else if (state === 'partial') {
      this.diagnostics.partialCells += amount
    } else {
      this.diagnostics.capturedCells += amount
    }
  }
}

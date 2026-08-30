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
const COVERAGE_NEIGHBOR_LOOKUP_MAX_DISTANCE_METERS = 0.08
/** Fusion tolerates depth noise across adjacent 5 cm quantization buckets. */
const SURFEL_FUSION_MAX_DISTANCE_METERS = 0.08
/** Prevents a nearby point on a different plane from being fused. */
const SURFEL_FUSION_MAX_POINT_TO_PLANE_METERS = 0.045
const SURFEL_FUSION_MIN_NORMAL_DOT = Math.cos((40 * Math.PI) / 180)
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

  const neighborDepths = [left, right, up, down]
  const hasDepthDiscontinuity = neighborDepths.some(
    (neighbor) =>
      Math.abs(neighbor.depthMeters - center.depthMeters) >
      MAX_NORMAL_DEPTH_DISCONTINUITY_METERS,
  )
  const horizontal = subtractPoints(right.point, left.point)
  const vertical = subtractPoints(down.point, up.point)

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

function getCellKey(coordinates: { x: number; y: number; z: number }): string {
  return `${coordinates.x}:${coordinates.y}:${coordinates.z}`
}

function getCellCenter(coordinates: { x: number; y: number; z: number }): SpatialPoint {
  return {
    x: (coordinates.x + 0.5) * COVERAGE_CELL_SIZE_METERS,
    y: (coordinates.y + 0.5) * COVERAGE_CELL_SIZE_METERS,
    z: (coordinates.z + 0.5) * COVERAGE_CELL_SIZE_METERS,
  }
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

function updateRepresentativePosition(cell: CoverageCell, point: SpatialPoint): void {
  const weight = 1 / cell.observationCount
  cell.representativePosition = addPoints(
    cell.representativePosition,
    scalePoint(subtractPoints(point, cell.representativePosition), weight),
  )
}

function findCompatibleCell(
  cells: ReadonlyMap<string, CoverageCell>,
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
        const candidate = cells.get(
          getCellKey({
            x: coordinates.x + xOffset,
            y: coordinates.y + yOffset,
            z: coordinates.z + zOffset,
          }),
        )
        if (!candidate) {
          continue
        }

        const delta = subtractPoints(candidate.representativePosition, point)
        const distanceSquared = dotPoints(delta, delta)
        if (distanceSquared > maxDistanceSquared) {
          continue
        }
        nearbyCandidateFound = true

        if (normal && candidate.representativeNormal) {
          const normalDot = dotPoints(normal, candidate.representativeNormal)
          if (normalDot < SURFEL_FUSION_MIN_NORMAL_DOT) {
            normalMismatchFound = true
            continue
          }
        }

        if (candidate.representativeNormal) {
          const pointToPlaneDistance = Math.abs(
            dotPoints(delta, candidate.representativeNormal),
          )
          if (pointToPlaneDistance > SURFEL_FUSION_MAX_POINT_TO_PLANE_METERS) {
            pointToPlaneMismatchFound = true
            continue
          }
        }

        if (distanceSquared < nearestDistanceSquared) {
          nearestCell = candidate
          nearestDistanceSquared = distanceSquared
        }
      }
    }
  }

  if (nearestCell) {
    return { cell: nearestCell, reason: 'compatible' }
  }

  if (normalMismatchFound) {
    return { cell: null, reason: 'normal-similarity' }
  }

  if (pointToPlaneMismatchFound) {
    return { cell: null, reason: 'point-to-plane' }
  }

  return {
    cell: null,
    reason: nearbyCandidateFound ? 'point-to-plane' : 'no-compatible-surface',
  }
}

/**
 * Accumulates bounded world-space coverage cells and surface metadata. Repeat
 * observations are fused into nearby coplanar surface neighborhoods and are
 * accepted only after a modest camera translation or view-direction change.
 */
export class SpatialCoverageService {
  private readonly cells = new Map<string, CoverageCell>()

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
    const mappingObservations: SpatialPointObservation[] = []

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
          mappingObservations.push({
            normalizedX: denseFrame.normalizedX[sourceIndex],
            normalizedY: denseFrame.normalizedY[sourceIndex],
            depthMeters: denseFrame.distancesMeters[sourceIndex],
            point: {
              x: denseFrame.points[sourceIndex * 3],
              y: denseFrame.points[sourceIndex * 3 + 1],
              z: denseFrame.points[sourceIndex * 3 + 2],
            },
          })
        }
      }
    }

    this.diagnostics.mappingPhase = normalizedPhase
    const mappingStartedAt = getPerformanceTimestamp()
    if (this.processFrame(
      mappingObservations,
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

    const observationsByGridIndex = new Map<number, SpatialPointObservation>()
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

    const currentGridKeys = new Map<number, string>()
    const currentFrameKeys = new Set<string>()

    for (const observation of observationsByGridIndex.values()) {
      const gridIndex = getGridIndex(
        observation.normalizedX,
        observation.normalizedY,
        gridColumns,
        gridRows,
      )
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
        this.cells,
        observation.point,
        normalResult.normal,
      )
      if (surfaceMatch.cell) {
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
      const coordinates = getCellCoordinates(observation.point)
      const key = surfaceMatch.cell?.key ?? getCellKey(coordinates)
      currentGridKeys.set(gridIndex, key)

      const existingCell = surfaceMatch.cell
      const isDuplicateInCurrentFrame = currentFrameKeys.has(key)
      currentFrameKeys.add(key)

      if (!existingCell) {
        if (this.cells.size >= MAX_COVERAGE_CELLS) {
          this.diagnostics.capacityRejectedSampleCount += 1
          this.diagnostics.capacityReached = true
          continue
        }

        const cell: CoverageCell = {
          key,
          center: getCellCenter(coordinates),
          representativePosition: { ...observation.point },
          representativeNormal: normalResult.normal,
          observationCount: OBSERVED_THRESHOLD,
          state: 'observed',
          firstObservedAt: timestamp,
          lastObservedAt: timestamp,
          lastAcceptedCameraPosition: { ...cameraPosition },
          lastAcceptedCameraDirection: cameraDirection
            ? { ...cameraDirection }
            : null,
        }
        this.cells.set(key, cell)
        this.incrementStateCount(cell.state)
        this.diagnostics.newCellsCreatedCount += 1
        this.diagnostics.acceptedObservationCount += 1
        continue
      }

      if (isDuplicateInCurrentFrame) {
        this.diagnostics.rejectedDuplicateObservationCount += 1
        continue
      }

      const viewpointChange = getViewpointChange(
        existingCell.lastAcceptedCameraPosition,
        cameraPosition,
        existingCell.lastAcceptedCameraDirection,
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
        continue
      }

      const previousState = existingCell.state
      this.incrementStateCount(previousState, -1)
      existingCell.observationCount += 1
      existingCell.state = getStateForObservationCount(existingCell.observationCount)
      if (previousState === 'observed' && existingCell.state === 'partial') {
        this.diagnostics.observedToPartialTransitionCount += 1
      } else if (previousState === 'partial' && existingCell.state === 'captured') {
        this.diagnostics.partialToCapturedTransitionCount += 1
      }
      existingCell.lastObservedAt = timestamp
      existingCell.lastAcceptedCameraPosition = { ...cameraPosition }
      existingCell.lastAcceptedCameraDirection = cameraDirection
        ? { ...cameraDirection }
        : null
      updateRepresentativePosition(existingCell, observation.point)
      existingCell.representativeNormal = mergeNormals(
        existingCell.representativeNormal,
        normalResult.normal,
      )
      this.incrementStateCount(existingCell.state)
      this.diagnostics.acceptedObservationCount += 1
    }

    this.diagnostics.currentValidSamples = currentGridKeys.size
    this.diagnostics.currentCapturedSamples = Array.from(currentGridKeys.values()).filter(
      (key) => this.cells.get(key)?.state === 'captured',
    ).length
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

  public getCoverageLookupAtPoint(point: SpatialPoint): CoverageLookupResult {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    ) {
      return { state: null, kind: 'miss' }
    }

    const coordinates = getCellCoordinates(point)
    const exactCell = this.cells.get(getCellKey(coordinates))
    if (exactCell) {
      return { state: exactCell.state, kind: 'exact' }
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

          const candidate = this.cells.get(
            getCellKey({
              x: coordinates.x + xOffset,
              y: coordinates.y + yOffset,
              z: coordinates.z + zOffset,
            }),
          )
          if (!candidate) {
            continue
          }

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

    return nearestCell
      ? { state: nearestCell.state, kind: 'neighbor' }
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
    const statisticsInvariantError =
      this.diagnostics.capturedCells > totalUniqueCells
        ? 'Captured coverage cells exceed total unique coverage cells.'
        : null

    return {
      ...this.diagnostics,
      totalUniqueCells,
      capturedCells: Math.min(this.diagnostics.capturedCells, totalUniqueCells),
      statisticsInvariantError,
      render: { ...render },
      dense: { ...dense },
    }
  }

  public reset(): void {
    this.cells.clear()
    this.lastProcessedAt = Number.NEGATIVE_INFINITY
    this.transitionRateStartedAt = null
    this.diagnostics = createInitialCoverageDebug()
  }

  public dispose(): void {
    this.reset()
  }

  private resetCurrentFrameDiagnostics(): void {
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

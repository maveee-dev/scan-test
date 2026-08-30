import type {
  CoverageCell,
  CoverageCellState,
  CoverageGuidance,
  SpatialCoverageDebug,
  SpatialCoverageRenderDebug,
  SpatialCoverageDenseDebug,
  DenseSpatialPointFrame,
  SpatialPoint,
  SpatialPointObservation,
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

/** Persistent mapping is intentionally lower resolution than the live mask. */
export const COVERAGE_MAPPING_COLUMNS = 32
export const COVERAGE_MAPPING_ROWS = 18

/** About 7 mapping updates per second; the XR renderer still runs every frame. */
const COVERAGE_PROCESS_INTERVAL_MS = 140
const MAPPING_PHASE_COUNT = 4
const MAPPING_PHASE_OFFSETS = [
  { x: 0, y: 0 },
  { x: 0.22, y: 0 },
  { x: 0, y: 0.22 },
  { x: 0.22, y: 0.22 },
] as const
const DISTINCT_OBSERVATION_DISTANCE_METERS = 0.05
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
    totalUniqueCells: 0,
    observedCells: 0,
    partialCells: 0,
    capturedCells: 0,
    currentValidSamples: 0,
    currentCapturedSamples: 0,
    currentViewCoverage: null,
    acceptedObservationCount: 0,
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

function getGridIndex(normalizedX: number, normalizedY: number): number {
  const column = Math.min(
    COVERAGE_MAPPING_COLUMNS - 1,
    Math.max(0, Math.round(normalizedX * (COVERAGE_MAPPING_COLUMNS - 1))),
  )
  const row = Math.min(
    COVERAGE_MAPPING_ROWS - 1,
    Math.max(0, Math.round(normalizedY * (COVERAGE_MAPPING_ROWS - 1))),
  )

  return row * COVERAGE_MAPPING_COLUMNS + column
}

function getGridCoordinates(gridIndex: number): { row: number; column: number } {
  return {
    row: Math.floor(gridIndex / COVERAGE_MAPPING_COLUMNS),
    column: gridIndex % COVERAGE_MAPPING_COLUMNS,
  }
}

function getNeighborIndex(row: number, column: number): number | null {
  if (
    row < 0 ||
    row >= COVERAGE_MAPPING_ROWS ||
    column < 0 ||
    column >= COVERAGE_MAPPING_COLUMNS
  ) {
    return null
  }

  return row * COVERAGE_MAPPING_COLUMNS + column
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
): SurfaceNormalResult {
  const { row, column } = getGridCoordinates(getGridIndex(center.normalizedX, center.normalizedY))
  const leftIndex = getNeighborIndex(row, column - 1)
  const rightIndex = getNeighborIndex(row, column + 1)
  const upIndex = getNeighborIndex(row - 1, column)
  const downIndex = getNeighborIndex(row + 1, column)

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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
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

/**
 * Accumulates bounded world-space coverage cells and surface metadata. Repeat
 * observations are accepted only after 5 cm of camera displacement from the
 * cell's last accepted observation.
 */
export class SpatialCoverageService {
  private readonly cells = new Map<string, CoverageCell>()

  private diagnostics = createInitialCoverageDebug()

  private lastProcessedAt = Number.NEGATIVE_INFINITY

  /**
   * Uses the dense frame as the source of truth, then selects a bounded,
   * phase-shifted 32x18 subset for persistent world-space accumulation.
   */
  public processDenseFrame(
    denseFrame: DenseSpatialPointFrame,
    cameraPosition: ViewerPosition | null,
    timestamp: number,
    phase: number,
  ): void {
    const normalizedPhase = ((phase % MAPPING_PHASE_COUNT) + MAPPING_PHASE_COUNT) % MAPPING_PHASE_COUNT
    const offset = MAPPING_PHASE_OFFSETS[normalizedPhase]
    const mappingObservations: SpatialPointObservation[] = []

    for (let row = 0; row < COVERAGE_MAPPING_ROWS; row += 1) {
      for (let column = 0; column < COVERAGE_MAPPING_COLUMNS; column += 1) {
        const normalizedX = clamp(
          (column + offset.x) / (COVERAGE_MAPPING_COLUMNS - 1),
          0,
          1,
        )
        const normalizedY = clamp(
          (row + offset.y) / (COVERAGE_MAPPING_ROWS - 1),
          0,
          1,
        )
        const sourceColumn = clamp(
          Math.round(normalizedX * (denseFrame.columns - 1)),
          0,
          denseFrame.columns - 1,
        )
        const sourceRow = clamp(
          Math.round(normalizedY * (denseFrame.rows - 1)),
          0,
          denseFrame.rows - 1,
        )
        const sourceIndex = sourceRow * denseFrame.columns + sourceColumn

        if (denseFrame.valid[sourceIndex] !== 1) {
          continue
        }

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

    this.diagnostics.mappingPhase = normalizedPhase
    if (this.processFrame(mappingObservations, cameraPosition, timestamp)) {
      this.diagnostics.mappingUpdateCount += 1
    }
  }

  public processFrame(
    observations: readonly SpatialPointObservation[],
    cameraPosition: ViewerPosition | null,
    timestamp: number,
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

    const observationsByGridIndex = new Map<number, SpatialPointObservation>()
    for (const observation of observations) {
      if (isFinitePointObservation(observation)) {
        observationsByGridIndex.set(
          getGridIndex(observation.normalizedX, observation.normalizedY),
          observation,
        )
      }
    }

    const currentGridKeys = new Map<number, string>()
    const currentFrameKeys = new Set<string>()

    for (const observation of observationsByGridIndex.values()) {
      const gridIndex = getGridIndex(observation.normalizedX, observation.normalizedY)
      const coordinates = getCellCoordinates(observation.point)
      const key = getCellKey(coordinates)
      const normalResult = getSurfaceNormal(
        observation,
        observationsByGridIndex,
        cameraPosition,
      )
      if (normalResult.rejectionReason === 'invalid') {
        this.diagnostics.rejectedInvalidNormalCount += 1
      } else if (normalResult.rejectionReason === 'depth-discontinuity') {
        this.diagnostics.rejectedDepthDiscontinuityCount += 1
      }

      if (currentGridKeys.has(gridIndex)) {
        this.diagnostics.rejectedDuplicateObservationCount += 1
        continue
      }
      currentGridKeys.set(gridIndex, key)

      const existingCell = this.cells.get(key)
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
        }
        this.cells.set(key, cell)
        this.incrementStateCount(cell.state)
        this.diagnostics.acceptedObservationCount += 1
        continue
      }

      if (
        isDuplicateInCurrentFrame ||
        !hasCameraMoved(existingCell.lastAcceptedCameraPosition, cameraPosition)
      ) {
        this.diagnostics.rejectedDuplicateObservationCount += 1
        continue
      }

      this.incrementStateCount(existingCell.state, -1)
      existingCell.observationCount += 1
      existingCell.state = getStateForObservationCount(existingCell.observationCount)
      existingCell.lastObservedAt = timestamp
      existingCell.lastAcceptedCameraPosition = { ...cameraPosition }
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
    return true
  }

  public getCoverageStateAtPoint(point: SpatialPoint): CoverageCellState | null {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z)
    ) {
      return null
    }

    return this.cells.get(getCellKey(getCellCoordinates(point)))?.state ?? null
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

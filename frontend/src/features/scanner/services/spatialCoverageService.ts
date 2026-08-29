import type {
  CoverageCell,
  CoverageCellState,
  CoverageRenderTile,
  CoverageGuidance,
  SpatialCoverageDebug,
  SpatialCoverageRenderDebug,
  SpatialPoint,
  SpatialPointObservation,
  ViewerPosition,
} from '../types'

/** A 10 cm world-space cell balances surface continuity with mobile memory. */
export const COVERAGE_CELL_SIZE_METERS = 0.1

/** A slightly overlapping patch helps adjacent world cells read as a mask. */
export const COVERAGE_VISUAL_PATCH_SIZE_METERS = 0.11

export const COVERAGE_GRID_COLUMNS = 16
export const COVERAGE_GRID_ROWS = 9

const COVERAGE_PROCESS_INTERVAL_MS = 120
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

export interface SpatialCoverageRenderSnapshot {
  revision: number
  tiles: readonly CoverageRenderTile[]
}

function createInitialRenderDebug(): SpatialCoverageRenderDebug {
  return {
    status: 'idle',
    renderedTiles: 0,
    renderCapacity: MAX_COVERAGE_CELLS,
    renderUpdateCount: 0,
    visualPatchSizeMeters: COVERAGE_VISUAL_PATCH_SIZE_METERS,
  }
}

function createInitialCoverageDebug(): SpatialCoverageDebug {
  return {
    cellSizeMeters: COVERAGE_CELL_SIZE_METERS,
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
    COVERAGE_GRID_COLUMNS - 1,
    Math.max(0, Math.round(normalizedX * (COVERAGE_GRID_COLUMNS - 1))),
  )
  const row = Math.min(
    COVERAGE_GRID_ROWS - 1,
    Math.max(0, Math.round(normalizedY * (COVERAGE_GRID_ROWS - 1))),
  )

  return row * COVERAGE_GRID_COLUMNS + column
}

function getGridCoordinates(gridIndex: number): { row: number; column: number } {
  return {
    row: Math.floor(gridIndex / COVERAGE_GRID_COLUMNS),
    column: gridIndex % COVERAGE_GRID_COLUMNS,
  }
}

function getNeighborIndex(row: number, column: number): number | null {
  if (
    row < 0 ||
    row >= COVERAGE_GRID_ROWS ||
    column < 0 ||
    column >= COVERAGE_GRID_COLUMNS
  ) {
    return null
  }

  return row * COVERAGE_GRID_COLUMNS + column
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

function updateRenderTile(
  renderTiles: Map<string, CoverageRenderTile>,
  cell: CoverageCell,
): boolean {
  if (!cell.representativeNormal) {
    return false
  }

  renderTiles.set(cell.key, {
    position: { ...cell.representativePosition },
    normal: { ...cell.representativeNormal },
    coverageState: cell.state,
  })
  return true
}

/**
 * Accumulates bounded world-space coverage cells and surface metadata. Repeat
 * observations are accepted only after 5 cm of camera displacement from the
 * cell's last accepted observation.
 */
export class SpatialCoverageService {
  private readonly cells = new Map<string, CoverageCell>()

  private readonly renderTiles = new Map<string, CoverageRenderTile>()

  private diagnostics = createInitialCoverageDebug()

  private lastProcessedAt = Number.NEGATIVE_INFINITY

  private renderRevision = 0

  private renderSnapshotRevision = -1

  private renderSnapshot: SpatialCoverageRenderSnapshot = {
    revision: 0,
    tiles: [],
  }

  public processFrame(
    observations: readonly SpatialPointObservation[],
    cameraPosition: ViewerPosition | null,
    timestamp: number,
  ): void {
    if (
      !Number.isFinite(timestamp) ||
      timestamp - this.lastProcessedAt < COVERAGE_PROCESS_INTERVAL_MS
    ) {
      return
    }

    this.lastProcessedAt = timestamp
    this.resetCurrentFrameDiagnostics()

    if (!isFinitePosition(cameraPosition)) {
      return
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
        this.updateRenderTile(cell)
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
      this.updateRenderTile(existingCell)
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
  }

  public getRenderSnapshot(): SpatialCoverageRenderSnapshot {
    if (this.renderSnapshotRevision !== this.renderRevision) {
      const tiles = Array.from(this.renderTiles.values(), (tile) => ({
        position: { ...tile.position },
        normal: { ...tile.normal },
        coverageState: tile.coverageState,
      }))
      this.renderSnapshot = { revision: this.renderRevision, tiles }
      this.renderSnapshotRevision = this.renderRevision
    }

    return this.renderSnapshot
  }

  public getDiagnostics(render: SpatialCoverageRenderDebug): SpatialCoverageDebug {
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
    }
  }

  public reset(): void {
    this.cells.clear()
    this.renderTiles.clear()
    this.lastProcessedAt = Number.NEGATIVE_INFINITY
    this.renderRevision += 1
    this.renderSnapshot = { revision: this.renderRevision, tiles: [] }
    this.renderSnapshotRevision = this.renderRevision
    this.diagnostics = createInitialCoverageDebug()
  }

  public dispose(): void {
    this.reset()
  }

  private updateRenderTile(cell: CoverageCell): void {
    const previousTile = this.renderTiles.get(cell.key)
    const hasTile = updateRenderTile(this.renderTiles, cell)
    if (!hasTile) {
      return
    }

    const nextTile = this.renderTiles.get(cell.key)
    if (
      !previousTile ||
      previousTile.coverageState !== nextTile?.coverageState ||
      previousTile.position.x !== nextTile?.position.x ||
      previousTile.position.y !== nextTile?.position.y ||
      previousTile.position.z !== nextTile?.position.z ||
      previousTile.normal.x !== nextTile?.normal.x ||
      previousTile.normal.y !== nextTile?.normal.y ||
      previousTile.normal.z !== nextTile?.normal.z
    ) {
      this.renderRevision += 1
    }
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

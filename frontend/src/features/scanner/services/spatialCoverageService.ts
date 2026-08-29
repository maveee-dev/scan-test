import type {
  CoverageCell,
  CoverageCellState,
  CoverageGridCell,
  CoverageGuidance,
  SpatialCoverageDebug,
  SpatialPoint,
  SpatialPointObservation,
  ViewerPosition,
} from '../types'

/**
 * A 10 cm world-space cell is large enough to keep this prototype bounded
 * while still showing meaningful changes as the phone moves around a room.
 */
export const COVERAGE_CELL_SIZE_METERS = 0.1

export const COVERAGE_GRID_COLUMNS = 16
export const COVERAGE_GRID_ROWS = 9

const COVERAGE_PROCESS_INTERVAL_MS = 120
const DISTINCT_OBSERVATION_DISTANCE_METERS = 0.05
// New cells are rejected once this deterministic hard cap is reached.
const MAX_COVERAGE_CELLS = 50_000
const OBSERVED_THRESHOLD = 1
const PARTIAL_THRESHOLD = 2
const CAPTURED_THRESHOLD = 3

function createInitialGrid(): CoverageGridCell[] {
  const grid: CoverageGridCell[] = []

  for (let row = 0; row < COVERAGE_GRID_ROWS; row += 1) {
    for (let column = 0; column < COVERAGE_GRID_COLUMNS; column += 1) {
      grid.push({
        normalizedX: column / (COVERAGE_GRID_COLUMNS - 1),
        normalizedY: row / (COVERAGE_GRID_ROWS - 1),
        state: 'unobserved',
        valid: false,
      })
    }
  }

  return grid
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
    guidance: 'move-slowly-across-unscanned-areas',
    grid: createInitialGrid(),
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

function getCellCoordinates(point: SpatialPointObservation['point']): {
  x: number
  y: number
  z: number
} {
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

function isCaptured(cell: CoverageGridCell): boolean {
  return cell.valid && cell.state === 'captured'
}

/**
 * Accumulates bounded world-space coverage cells. It never stores the full
 * point history and only accepts a repeat when the camera moved by 5 cm from
 * the cell's last accepted observation.
 */
export class SpatialCoverageService {
  private readonly cells = new Map<string, CoverageCell>()

  private diagnostics = createInitialCoverageDebug()

  private lastProcessedAt = Number.NEGATIVE_INFINITY

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

    const currentFrameKeys = new Set<string>()
    const currentGridKeys: Array<string | null> = Array.from(
      { length: this.diagnostics.grid.length },
      () => null,
    )

    for (const observation of observations) {
      if (!isFinitePointObservation(observation)) {
        continue
      }

      const gridIndex = getGridIndex(observation.normalizedX, observation.normalizedY)
      const gridCell = this.diagnostics.grid[gridIndex]
      if (gridCell.valid) {
        this.diagnostics.rejectedDuplicateObservationCount += 1
        continue
      }

      const coordinates = getCellCoordinates(observation.point)
      const key = getCellKey(coordinates)
      const existingCell = this.cells.get(key)
      const isDuplicateInCurrentFrame = currentFrameKeys.has(key)
      currentFrameKeys.add(key)
      currentGridKeys[gridIndex] = key

      if (!existingCell) {
        if (this.cells.size >= MAX_COVERAGE_CELLS) {
          this.diagnostics.capacityRejectedSampleCount += 1
          this.diagnostics.capacityReached = true
          gridCell.valid = true
          continue
        }

        const cell: CoverageCell = {
          key,
          center: getCellCenter(coordinates),
          observationCount: OBSERVED_THRESHOLD,
          state: 'observed',
          firstObservedAt: timestamp,
          lastObservedAt: timestamp,
          lastAcceptedCameraPosition: { ...cameraPosition },
        }
        this.cells.set(key, cell)
        this.incrementStateCount(cell.state)
        this.diagnostics.acceptedObservationCount += 1
        gridCell.valid = true
        gridCell.state = cell.state
        continue
      }

      gridCell.valid = true
      gridCell.state = existingCell.state

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
      this.incrementStateCount(existingCell.state)
      this.diagnostics.acceptedObservationCount += 1
      gridCell.state = existingCell.state
    }

    for (let index = 0; index < currentGridKeys.length; index += 1) {
      const key = currentGridKeys[index]
      if (!key) {
        continue
      }

      const cell = this.cells.get(key)
      if (cell) {
        this.diagnostics.grid[index].state = cell.state
      }
    }

    this.diagnostics.currentValidSamples = this.diagnostics.grid.filter(
      (cell) => cell.valid,
    ).length
    this.diagnostics.currentCapturedSamples = this.diagnostics.grid.filter(isCaptured).length
    this.diagnostics.currentViewCoverage =
      this.diagnostics.currentValidSamples > 0
        ? (this.diagnostics.currentCapturedSamples / this.diagnostics.currentValidSamples) * 100
        : null
    this.diagnostics.guidance = getGuidance(this.diagnostics.currentViewCoverage)
  }

  public getDiagnostics(): SpatialCoverageDebug {
    return {
      ...this.diagnostics,
      grid: this.diagnostics.grid.map((cell) => ({ ...cell })),
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
    this.diagnostics.grid = createInitialGrid()
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

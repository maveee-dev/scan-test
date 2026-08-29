import type {
  CoverageCell,
  FinalizedCoverageCell,
  FinalizedSpatialScan,
  FinalizedSpatialScanStatistics,
  ScannerReferenceSpaceType,
} from '../types'

export interface FinalizeSpatialScanInput {
  startedAtMs: number
  finishedAtMs: number
  referenceSpaceType: ScannerReferenceSpaceType
  coverageCells: readonly CoverageCell[]
}

let scanSequence = 0

function createScanId(): string {
  scanSequence += 1

  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `scan-${Date.now().toString(36)}-${scanSequence.toString(36)}`
}

function copyPoint(point: { x: number; y: number; z: number }): Readonly<{ x: number; y: number; z: number }> {
  return Object.freeze({ x: point.x, y: point.y, z: point.z })
}

function copyCoverageCell(cell: CoverageCell): FinalizedCoverageCell {
  return Object.freeze({
    position: copyPoint(cell.representativePosition),
    normal: cell.representativeNormal ? copyPoint(cell.representativeNormal) : null,
    coverageState: cell.state,
    observationCount: cell.observationCount,
  })
}

function calculateStatistics(
  coverage: readonly FinalizedCoverageCell[],
): FinalizedSpatialScanStatistics {
  let observedCells = 0
  let partialCells = 0
  let capturedCells = 0

  for (const cell of coverage) {
    if (cell.coverageState === 'observed') {
      observedCells += 1
    } else if (cell.coverageState === 'partial') {
      partialCells += 1
    } else {
      capturedCells += 1
    }
  }

  return Object.freeze({
    uniqueCells: coverage.length,
    observedCells,
    partialCells,
    capturedCells,
  })
}

/** Converts active coverage into independent, serializable application data. */
export class FinalizedSpatialScanService {
  public createSnapshot(input: FinalizeSpatialScanInput): FinalizedSpatialScan {
    const startedAtMs = Number.isFinite(input.startedAtMs)
      ? input.startedAtMs
      : input.finishedAtMs
    const finishedAtMs = Number.isFinite(input.finishedAtMs)
      ? input.finishedAtMs
      : startedAtMs
    const coverage = Object.freeze(input.coverageCells.map(copyCoverageCell))
    const statistics = calculateStatistics(coverage)

    return Object.freeze({
      id: createScanId(),
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      referenceSpaceType: input.referenceSpaceType,
      coverage,
      statistics,
    })
  }
}

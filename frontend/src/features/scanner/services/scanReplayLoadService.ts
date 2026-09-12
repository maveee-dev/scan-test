import type { FinalizedDenseRealityReconstruction, RealityCaptureSummary } from '../types'
import { createInitialDenseRealityFusionDebug, DENSE_REALITY_CONFIG } from './denseRealityReconstructionService'
import { reconstructCanonicalReality } from './postScanCanonicalFusionService'
import { decodeScanReplay, MAX_SCAN_REPLAY_BYTES } from './scanReplayCaptureService'

export type ScanReplayLoadStage =
  | 'reading-file'
  | 'reconstructing-geometry'
  | 'cleaning-surfaces'
  | 'applying-room-appearance'

export interface LoadedScanReplayReview {
  readonly fileName: string
  readonly capturedBuild: string
  readonly frameCount: number
  readonly sampleCount: number
  readonly reconstruction: FinalizedDenseRealityReconstruction
}

function createCaptureSummary(
  surfels: FinalizedDenseRealityReconstruction['surfels'],
  cameraCapturesUsed: number,
): RealityCaptureSummary {
  const coloredSurfels = surfels.filter((surfel) => surfel.colorRgb !== null)
  const colorObservationTotal = coloredSurfels.reduce((total, surfel) => total + surfel.colorObservationCount, 0)
  const colorConfidenceTotal = coloredSurfels.reduce((total, surfel) => total + surfel.colorConfidence, 0)
  const capacity = DENSE_REALITY_CONFIG.maxSamples

  return {
    totalSurfels: surfels.length,
    coloredSurfels: coloredSurfels.length,
    colorCoveragePercentage: surfels.length > 0 ? 100 * coloredSurfels.length / surfels.length : 0,
    averageColorObservations: coloredSurfels.length > 0 ? colorObservationTotal / coloredSurfels.length : 0,
    cameraCapturesUsed,
    averageColorConfidence: coloredSurfels.length > 0 ? colorConfidenceTotal / coloredSurfels.length : 0,
    averageNearestNeighborSpacingMeters: null,
    medianNearestNeighborSpacingMeters: null,
    p90NearestNeighborSpacingMeters: null,
    approximateUncoveredGapMeters: null,
    estimatedSmallGapRegionCount: 0,
    estimatedLargeUnsupportedGapCount: 0,
    surfelCapacity: capacity,
    capacityUtilizationPercentage: 100 * surfels.length / capacity,
    capacityReached: surfels.length >= capacity,
  }
}

/** Rebuild a saved local capture with the same deterministic replay path used by the CLI. */
export async function loadScanReplayFile(
  file: File,
  onStage?: (stage: ScanReplayLoadStage) => void,
): Promise<LoadedScanReplayReview> {
  if (file.size > MAX_SCAN_REPLAY_BYTES) {
    throw new Error('Scan captures must be 128 MiB or smaller.')
  }

  onStage?.('reading-file')
  const capture = decodeScanReplay(await file.arrayBuffer())
  if (capture.measurements.frames.length === 0) {
    throw new Error('This scan capture does not contain any spatial frames to replay.')
  }

  const replay = await reconstructCanonicalReality(capture.measurements, (stage) => onStage?.(stage))
  const surfels = replay.surfels
  const initialFusionDiagnostics = createInitialDenseRealityFusionDebug()
  const reconstruction: FinalizedDenseRealityReconstruction = {
    scanId: capture.scanId,
    referenceSpaceType: capture.referenceSpaceType,
    status: surfels.length > 0 ? 'available' : 'empty',
    surfels,
    canonicalSurfels: surfels,
    bounds: replay.bounds,
    captureSummary: createCaptureSummary(surfels, capture.measurements.frames.length),
    fusionDiagnostics: initialFusionDiagnostics,
    colorStatistics: replay.colorStatistics,
    colorSamples: [],
    retainedMeasurementDiagnostics: capture.measurements.diagnostics,
    canonicalFusionDiagnostics: replay.diagnostics,
    consolidatedMeasurementMap: replay.consolidatedMeasurementMap,
    appearanceKeyframes: capture.appearance ?? undefined,
  }

  return {
    fileName: file.name,
    capturedBuild: capture.build,
    frameCount: capture.measurements.frames.length,
    sampleCount: capture.measurements.diagnostics.samplesRetained,
    reconstruction,
  }
}

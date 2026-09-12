import type { FinalizedDenseRealityReconstruction, RealityCaptureSummary } from '../types'
import { createInitialDenseRealityFusionDebug, DENSE_REALITY_CONFIG } from './denseRealityReconstructionService'
import { reconstructCanonicalReality } from './postScanCanonicalFusionService'
import { decodeScanReplay, MAX_SCAN_REPLAY_BYTES } from './scanReplayCaptureService'
import { MAX_SCAN_JSON_EXPORT_BYTES, parseScanJsonExport, parseScanJsonExportStream } from './scanJsonExportService'

export type ScanReplayLoadStage =
  | 'reading-file'
  | 'parsing-json'
  | 'reconstructing-geometry'
  | 'cleaning-surfaces'
  | 'applying-room-appearance'

export interface LoadedScanReplayReview {
  readonly fileName: string
  readonly capturedBuild: string
  readonly frameCount: number | null
  readonly sampleCount: number | null
  readonly sampleLabel: string
  readonly previewDescription: string
  readonly reconstruction: FinalizedDenseRealityReconstruction
}

interface ScanJsonWorkerMessage {
  readonly id: number
  readonly stage?: 'parsing-json'
  readonly review?: LoadedScanReplayReview
  readonly error?: string
}

let nextJsonWorkerId = 0

function loadJsonScanFile(file: File, onStage?: (stage: ScanReplayLoadStage) => void): Promise<LoadedScanReplayReview> {
  onStage?.('parsing-json')
  if (typeof Worker === 'undefined') {
    if (typeof file.stream === 'function') return parseScanJsonExportStream(file.stream(), file.name)
    return file.text().then((text) => parseScanJsonExport(text, file.name))
  }

  return new Promise((resolve, reject) => {
    const id = ++nextJsonWorkerId
    const worker = new Worker(new URL('./scanJsonImport.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = (): void => {
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      worker.terminate()
    }
    const handleMessage = (event: MessageEvent<ScanJsonWorkerMessage>): void => {
      const message = event.data
      if (message.id !== id) return
      if (message.stage) {
        onStage?.(message.stage)
        return
      }
      cleanup()
      if (message.review) resolve(message.review)
      else reject(new Error(message.error ?? 'Could not load this JSON scan file.'))
    }
    const handleError = (event: ErrorEvent): void => {
      cleanup()
      reject(new Error(event.message || 'Could not read this JSON scan file.'))
    }
    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    worker.postMessage({ id, file })
  })
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
  const isJsonExport = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json'
  if (isJsonExport) {
    if (file.size > MAX_SCAN_JSON_EXPORT_BYTES) {
      throw new Error('JSON scan exports must be 512 MiB or smaller.')
    }
    return loadJsonScanFile(file, onStage)
  }
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
    sampleLabel: 'Retained measurements',
    previewDescription: 'This room was rebuilt locally from the saved depth and camera measurements. Live scan coverage history is not included in the capture file.',
    reconstruction,
  }
}

/// <reference lib="webworker" />
import { CanonicalRealityFusionService } from './canonicalRealityFusionService'
import type { RetainedRealityMeasurementSnapshot } from './retainedRealityMeasurementService'
import { createRetainedRealityMeasurementSnapshotSignature } from './layeredMeasuredSurfaceFieldService'
import type { PostScanCanonicalFusionResult, PostScanWorkerStageTiming } from './postScanCanonicalFusionService'

function epochMs(): number { return Date.now() }

self.onmessage = (event: MessageEvent<{ id: number; snapshot: RetainedRealityMeasurementSnapshot; inputSnapshotSignature?: string }>) => {
  const workerReceiveEpochMs = epochMs()
  const workerStartEpochMs = epochMs()
  const workerStageEpochs: PostScanWorkerStageTiming[] = []
  try {
    const signature = event.data.inputSnapshotSignature ?? createRetainedRealityMeasurementSnapshotSignature(event.data.snapshot)
    const baselineReplay = new CanonicalRealityFusionService().reconstruct(event.data.snapshot, (stage) => {
      const epoch = epochMs()
      workerStageEpochs.push({ arm: 'baseline', stage, epochMs: epoch })
      // The original stage envelope remains the compatibility contract:
      // self.postMessage({ id: event.data.id, stage })
      self.postMessage({ id: event.data.id, stage, stageArm: 'baseline', stageEpochMs: epoch })
    })
    const baseline = Object.freeze({ ...baselineReplay, diagnostics: Object.freeze({ ...baselineReplay.diagnostics, inputSnapshotSignature: signature }) })
    const result: PostScanCanonicalFusionResult = Object.freeze({
      ...baseline,
      baseline,
      inputSnapshotSignature: signature,
      baselineInputSnapshotSignature: signature,
    })
    const workerResultPostEpochMs = epochMs()
    const transport = Object.freeze({ workerReceiveEpochMs, workerStartEpochMs, workerResultPostEpochMs, workerStageEpochs: Object.freeze(workerStageEpochs) })
    const transferList = [
      result.baseline.consolidatedMeasurementMap.positions.buffer,
      result.baseline.diagnostics.provisionalExpiryMap.positions.buffer,
      result.baseline.diagnostics.provisionalExpiryMap.reasonCodes.buffer,
    ]
    self.postMessage({ id: event.data.id, result, transport }, [...new Set(transferList)])
  } catch (error) {
    const workerError = error instanceof Error ? error : null
    self.postMessage({
      id: event.data.id,
      error: workerError?.message ?? 'Canonical reconstruction failed.',
      errorName: workerError?.name,
      errorStack: workerError?.stack,
    })
  }
}

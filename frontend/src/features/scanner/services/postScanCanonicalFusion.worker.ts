/// <reference lib="webworker" />
import { CanonicalRealityFusionService } from './canonicalRealityFusionService'
import type { RetainedRealityMeasurementSnapshot } from './retainedRealityMeasurementService'
import {
  buildSnapshotSignaturePair,
  createRetainedRealityMeasurementSnapshotSignature,
  LayeredMeasuredSurfaceFieldService,
} from './layeredMeasuredSurfaceFieldService'
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
    const experimental = new LayeredMeasuredSurfaceFieldService().reconstruct(event.data.snapshot, baseline, signature, (stage) => {
      const epoch = epochMs()
      workerStageEpochs.push({ arm: 'experimental', stage, epochMs: epoch })
      self.postMessage({ id: event.data.id, stage, stageArm: 'experimental', stageEpochMs: epoch })
    })
    const signaturePair = buildSnapshotSignaturePair(event.data.snapshot, baseline, experimental, signature)
    const result: PostScanCanonicalFusionResult = Object.freeze({
      ...baseline,
      baseline,
      experimental,
      ...signaturePair,
    })
    const workerResultPostEpochMs = epochMs()
    const transport = Object.freeze({ workerReceiveEpochMs, workerStartEpochMs, workerResultPostEpochMs, workerStageEpochs: Object.freeze(workerStageEpochs) })
    self.postMessage({ id: event.data.id, result, transport }, [
      result.baseline.consolidatedMeasurementMap.positions.buffer,
      result.baseline.diagnostics.provisionalExpiryMap.positions.buffer,
      result.baseline.diagnostics.provisionalExpiryMap.reasonCodes.buffer,
    ])
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : 'Canonical reconstruction failed.',
    })
  }
}

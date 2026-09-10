/// <reference lib="webworker" />
import { CanonicalRealityFusionService } from './canonicalRealityFusionService'
import type { RetainedRealityMeasurementSnapshot } from './retainedRealityMeasurementService'
import { createRetainedRealityMeasurementSnapshotSignature } from './layeredMeasuredSurfaceFieldService'
import { buildM810DepthKeyframePatchAtlas } from './m810DepthKeyframePatchAtlasService'
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
    const m810 = buildM810DepthKeyframePatchAtlas(event.data.snapshot, signature)
    const result: PostScanCanonicalFusionResult = Object.freeze({
      ...baseline,
      baseline,
      m810,
      inputSnapshotSignature: signature,
      baselineInputSnapshotSignature: signature,
      candidateInputSnapshotSignature: m810.diagnostics.inputSnapshotSignature,
      identicalInput: signature === m810.diagnostics.inputSnapshotSignature,
    })
    const workerResultPostEpochMs = epochMs()
    const transport = Object.freeze({ workerReceiveEpochMs, workerStartEpochMs, workerResultPostEpochMs, workerStageEpochs: Object.freeze(workerStageEpochs) })
    const transferList = [
      result.baseline.consolidatedMeasurementMap.positions.buffer,
      result.baseline.diagnostics.provisionalExpiryMap.positions.buffer,
      result.baseline.diagnostics.provisionalExpiryMap.reasonCodes.buffer,
      result.m810.vertices.positions.buffer,
      result.m810.vertices.normals.buffer,
      result.m810.vertices.colors.buffer,
      result.m810.vertices.colorValid.buffer,
      result.m810.vertices.sourceGridUvs.buffer,
      result.m810.vertices.sourceFrameSequences.buffer,
      result.m810.vertices.sourceSampleIndices.buffer,
      result.m810.indices.buffer,
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

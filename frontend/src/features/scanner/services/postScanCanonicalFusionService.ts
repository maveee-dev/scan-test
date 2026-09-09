import { CanonicalRealityFusionService, type CanonicalRealityFusionResult, type CanonicalReconstructionStage } from './canonicalRealityFusionService'
import {
  buildSnapshotSignaturePair,
  createRetainedRealityMeasurementSnapshotSignature,
  LayeredMeasuredSurfaceFieldService,
  type LayeredMeasuredSurfaceFieldResult,
} from './layeredMeasuredSurfaceFieldService'
import type { RetainedRealityMeasurementSnapshot } from './retainedRealityMeasurementService'

function transferBuffers(snapshot: RetainedRealityMeasurementSnapshot): ArrayBuffer[] {
  const buffers = snapshot.frames.flatMap((frame) => [
    frame.denseFrame.valid.buffer,
    frame.denseFrame.normalizedX.buffer,
    frame.denseFrame.normalizedY.buffer,
    frame.denseFrame.distancesMeters.buffer,
    frame.denseFrame.points.buffer,
    frame.normals.buffer,
    frame.normalValid.buffer,
    frame.colorSourceIndices.buffer,
    frame.srgbColors.buffer,
  ] as ArrayBuffer[])
  return [...new Set(buffers)]
}

export interface PostScanWorkerStageTiming {
  readonly arm: 'baseline' | 'experimental'
  readonly stage: CanonicalReconstructionStage
  readonly epochMs: number
}

export interface PostScanCanonicalFusionTransportDiagnostics {
  readonly mainPostMessageBeginEpochMs: number | null
  readonly mainPostMessageEndEpochMs: number | null
  /** Backward-compatible alias for the end of the actual postMessage call. */
  readonly mainPostMessageEpochMs: number | null
  readonly mainResultReceiveEpochMs: number | null
  readonly workerReceiveEpochMs: number | null
  readonly workerStartEpochMs: number | null
  readonly workerResultPostEpochMs: number | null
  readonly workerStageEpochs: readonly PostScanWorkerStageTiming[]
}

export interface PostScanCanonicalFusionResult extends CanonicalRealityFusionResult {
  /** The unchanged M8.7.1.6 arm; spread fields remain backward-compatible. */
  readonly baseline: CanonicalRealityFusionResult
  /** Isolated M8.8 arm. It never becomes the production `surfels` field. */
  readonly experimental: LayeredMeasuredSurfaceFieldResult
  readonly inputSnapshotSignature: string
  readonly baselineInputSnapshotSignature: string
  readonly candidateInputSnapshotSignature: string
  readonly identicalInput: boolean
  readonly transportDiagnostics?: PostScanCanonicalFusionTransportDiagnostics
}

export interface PostScanCanonicalFusionInstrumentation {
  onTransport?: (transport: PostScanCanonicalFusionTransportDiagnostics) => void
}

function localEpochMs(): number {
  return Date.now()
}

/** Runs final reconstruction away from the XR/UI path. */
export function reconstructCanonicalReality(
  snapshot: RetainedRealityMeasurementSnapshot,
  onStage?: (stage: CanonicalReconstructionStage) => void,
  instrumentation?: PostScanCanonicalFusionInstrumentation,
): Promise<PostScanCanonicalFusionResult> {
  if (typeof Worker === 'undefined') {
    const inputSnapshotSignature = createRetainedRealityMeasurementSnapshotSignature(snapshot)
    const baselineReplay = new CanonicalRealityFusionService().reconstruct(snapshot, onStage)
    const baseline = Object.freeze({ ...baselineReplay, diagnostics: Object.freeze({ ...baselineReplay.diagnostics, inputSnapshotSignature }) })
    const experimental = new LayeredMeasuredSurfaceFieldService().reconstruct(snapshot, baseline, inputSnapshotSignature, onStage)
    const signaturePair = buildSnapshotSignaturePair(snapshot, baseline, experimental, inputSnapshotSignature)
    return Promise.resolve(Object.freeze({
      ...baseline,
      baseline,
      experimental,
      ...signaturePair,
      transportDiagnostics: Object.freeze({
        mainPostMessageBeginEpochMs: null,
        mainPostMessageEndEpochMs: null,
        mainPostMessageEpochMs: null,
        mainResultReceiveEpochMs: localEpochMs(),
        workerReceiveEpochMs: null,
        workerStartEpochMs: null,
        workerResultPostEpochMs: null,
        workerStageEpochs: Object.freeze([]),
      }),
    }))
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./postScanCanonicalFusion.worker.ts', import.meta.url), { type: 'module' })
    const id = 1
    let mainPostMessageBeginEpochMs: number | null = null
    let mainPostMessageEndEpochMs: number | null = null
    const workerStageEpochs: PostScanWorkerStageTiming[] = []
    worker.onmessage = (event: MessageEvent<{
      id: number
      stage?: CanonicalReconstructionStage
      stageArm?: 'baseline' | 'experimental'
      stageEpochMs?: number
      result?: PostScanCanonicalFusionResult
      transport?: Omit<PostScanCanonicalFusionTransportDiagnostics, 'mainPostMessageBeginEpochMs' | 'mainPostMessageEndEpochMs' | 'mainPostMessageEpochMs' | 'mainResultReceiveEpochMs'>
      error?: string
      errorName?: string
      errorStack?: string
    }>) => {
      if (event.data.id !== id) return
      if (event.data.stage) {
        if (event.data.stageArm && event.data.stageEpochMs !== undefined) workerStageEpochs.push({ arm: event.data.stageArm, stage: event.data.stage, epochMs: event.data.stageEpochMs })
        onStage?.(event.data.stage)
        return
      }
      const mainResultReceiveEpochMs = localEpochMs()
      worker.terminate()
      if (event.data.error || !event.data.result) {
        const workerError = new Error(event.data.error ?? 'Canonical reconstruction returned no result.')
        if (event.data.errorName) workerError.name = event.data.errorName
        if (event.data.errorStack) workerError.stack = event.data.errorStack
        reject(workerError)
      }
      else {
        const workerTransport = event.data.transport ?? event.data.result.transportDiagnostics
        const transport = Object.freeze({
          mainPostMessageBeginEpochMs,
          mainPostMessageEndEpochMs,
          mainPostMessageEpochMs: mainPostMessageEndEpochMs,
          mainResultReceiveEpochMs,
          workerReceiveEpochMs: workerTransport?.workerReceiveEpochMs ?? null,
          workerStartEpochMs: workerTransport?.workerStartEpochMs ?? null,
          workerResultPostEpochMs: workerTransport?.workerResultPostEpochMs ?? null,
          workerStageEpochs: Object.freeze(workerTransport?.workerStageEpochs?.length ? workerTransport.workerStageEpochs : workerStageEpochs),
        })
        instrumentation?.onTransport?.(transport)
        resolve(Object.freeze({ ...event.data.result, transportDiagnostics: transport }))
      }
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('Canonical reconstruction worker failed.'))
    }
    // The signature is computed in the worker so Finish does not synchronously
    // hash the full retained capture on the main thread before posting it.
    mainPostMessageBeginEpochMs = localEpochMs()
    worker.postMessage({ id, snapshot }, transferBuffers(snapshot))
    mainPostMessageEndEpochMs = localEpochMs()
  })
}

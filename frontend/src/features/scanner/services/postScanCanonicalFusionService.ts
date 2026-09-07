import { CanonicalRealityFusionService, type CanonicalRealityFusionResult } from './canonicalRealityFusionService'
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

/** Runs final reconstruction away from the XR/UI path. */
export function reconstructCanonicalReality(
  snapshot: RetainedRealityMeasurementSnapshot,
): Promise<CanonicalRealityFusionResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(new CanonicalRealityFusionService().reconstruct(snapshot))
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./postScanCanonicalFusion.worker.ts', import.meta.url), { type: 'module' })
    const id = 1
    worker.onmessage = (event: MessageEvent<{ id: number; result?: CanonicalRealityFusionResult; error?: string }>) => {
      if (event.data.id !== id) return
      worker.terminate()
      if (event.data.error || !event.data.result) reject(new Error(event.data.error ?? 'Canonical reconstruction returned no result.'))
      else resolve(event.data.result)
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('Canonical reconstruction worker failed.'))
    }
    worker.postMessage({ id, snapshot }, transferBuffers(snapshot))
  })
}

/// <reference lib="webworker" />
import { CanonicalRealityFusionService } from './canonicalRealityFusionService'
import type { RetainedRealityMeasurementSnapshot } from './retainedRealityMeasurementService'

self.onmessage = (event: MessageEvent<{ id: number; snapshot: RetainedRealityMeasurementSnapshot }>) => {
  try {
    const result = new CanonicalRealityFusionService().reconstruct(event.data.snapshot)
    self.postMessage({ id: event.data.id, result })
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : 'Canonical reconstruction failed.',
    })
  }
}


/// <reference lib="webworker" />
import { CanonicalRealityFusionService } from './canonicalRealityFusionService'
import type { RetainedRealityMeasurementSnapshot } from './retainedRealityMeasurementService'

self.onmessage = (event: MessageEvent<{ id: number; snapshot: RetainedRealityMeasurementSnapshot }>) => {
  try {
    const result = new CanonicalRealityFusionService().reconstruct(event.data.snapshot, (stage) => {
      self.postMessage({ id: event.data.id, stage })
    })
    self.postMessage({ id: event.data.id, result }, [
      result.consolidatedMeasurementMap.positions.buffer,
      result.diagnostics.provisionalExpiryMap.positions.buffer,
      result.diagnostics.provisionalExpiryMap.reasonCodes.buffer,
    ])
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : 'Canonical reconstruction failed.',
    })
  }
}

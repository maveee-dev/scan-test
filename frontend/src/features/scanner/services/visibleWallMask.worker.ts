import type { FinalizedRealityRgbKeyframes, FinalizedRealitySurfel } from '../types'
import type { RealityStructuralAssociationTable } from './realityStructuralAssociationService'
import { GeometricRgbVisibleWallMaskProvider } from './visibleWallMaskProvider'

self.onmessage = (event: MessageEvent<{ surfels: readonly FinalizedRealitySurfel[]; table: RealityStructuralAssociationTable; keyframes: FinalizedRealityRgbKeyframes }>) => {
  try {
    const result = new GeometricRgbVisibleWallMaskProvider().build(event.data.surfels, event.data.table, event.data.keyframes)
    if (!result) { self.postMessage({ result: null }); return }
    const transfer: Transferable[] = [result.sampleLogicalSurfaceIndices.buffer, result.sampleConfidence.buffer]
    for (const surface of result.surfaces) for (const mask of surface.masks) {
      transfer.push(mask.mask.buffer, mask.evidence.buffer, mask.terminalReasons.buffer, mask.seedPixels.buffer, mask.rawObjectFragmentPixels.buffer, mask.completedObjectEnvelopePixels.buffer)
      for (const region of mask.preservedVisualRegions) transfer.push(region.pixelIndices.buffer)
      for (const cluster of mask.preservedVisualObjectClusters) transfer.push(cluster.pixelIndices.buffer)
    }
    for (const surface of result.surfaces) {
      transfer.push(
        surface.threeDSampleClassifications.buffer,
        surface.threeDSampleObservationCounts.buffer,
        surface.threeDSampleWallConfidence.buffer,
        surface.threeDSampleTerminalReasons.buffer,
        surface.threeDCompletedEnvelopeSampleMask.buffer,
      )
      if (surface.wallLocalPreservedObjectFusion) transfer.push(
        surface.wallLocalPreservedObjectFusion.objectVotes.buffer,
        surface.wallLocalPreservedObjectFusion.wallVotes.buffer,
        surface.wallLocalPreservedObjectFusion.protectedCells.buffer,
        surface.wallLocalPreservedObjectFusion.keyframeSupport.buffer,
        surface.wallLocalPreservedObjectFusion.protectedSampleMask.buffer,
      )
    }
    self.postMessage({ result }, { transfer })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'RGB wall-mask preparation failed.' })
  }
}

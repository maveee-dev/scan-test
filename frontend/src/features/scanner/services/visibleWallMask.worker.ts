import type { FinalizedRealityRgbKeyframes, FinalizedRealitySurfel } from '../types'
import type { RealityStructuralAssociationTable } from './realityStructuralAssociationService'
import { GeometricRgbVisibleWallMaskProvider } from './visibleWallMaskProvider'

self.onmessage = (event: MessageEvent<{ surfels: readonly FinalizedRealitySurfel[]; table: RealityStructuralAssociationTable; keyframes: FinalizedRealityRgbKeyframes }>) => {
  try {
    const result = new GeometricRgbVisibleWallMaskProvider().build(event.data.surfels, event.data.table, event.data.keyframes)
    if (!result) { self.postMessage({ result: null }); return }
    const transfer: Transferable[] = [result.sampleLogicalSurfaceIndices.buffer, result.sampleConfidence.buffer]
    for (const surface of result.surfaces) for (const mask of surface.masks) {
      transfer.push(mask.mask.buffer, mask.seedPixels.buffer)
    }
    self.postMessage({ result }, { transfer })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'RGB wall-mask preparation failed.' })
  }
}

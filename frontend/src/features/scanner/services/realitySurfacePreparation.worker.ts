import type { FinalizedRealitySurfel } from '../types'
import { createRealitySurfaceRenderResources, packRealitySurface, type RealitySurfaceRenderMode } from './realitySurfaceRenderingService'
import {
  buildRealityDesignColors,
  type RealityDebugColorMode,
  type RealityDesignColorInput,
  type RealityStructuralAssociationTable,
} from './realityStructuralAssociationService'
import {
  buildRealityDesignCompositePlan,
  type RealityDesignCompositeMode,
} from './realityDesignCompositingService'

self.onmessage = (event: MessageEvent<{
  surfels: readonly FinalizedRealitySurfel[]
  mode: RealitySurfaceRenderMode
  association: RealityStructuralAssociationTable | null
  designInputs: readonly RealityDesignColorInput[]
  debugColorMode?: RealityDebugColorMode
  designCompositeMode?: RealityDesignCompositeMode
}>) => {
  try {
    const debugMode = event.data.debugColorMode ?? 'none'
    const composite = event.data.association && event.data.designInputs.length > 0 && debugMode === 'none'
      ? buildRealityDesignCompositePlan(
        event.data.surfels,
        event.data.association,
        event.data.designInputs,
        event.data.designCompositeMode ?? 'composite',
      )
      : null
    const renderSurfels = composite
      ? event.data.surfels.filter((_surfel, index) => composite.visibilityMask[index] === 1)
      : event.data.surfels
    const displayColors = composite?.diagnosticColors ?? (event.data.association && (event.data.designInputs.length > 0 || debugMode !== 'none')
      ? buildRealityDesignColors(event.data.surfels, event.data.association, event.data.designInputs, debugMode)
      : undefined)
    const resources = createRealitySurfaceRenderResources({ surfels: renderSurfels }, event.data.mode, displayColors)
    const prepared = packRealitySurface(resources)
    if (composite) {
      prepared.designComposite = {
        mode: composite.mode,
        structuralPatchIds: composite.structuralPatchIds,
        masks: composite.masks,
        stats: composite.stats,
      }
    }
    const buffers = new Set<ArrayBuffer>()
    for (const geometry of prepared.geometries) for (const attribute of geometry.attributes) buffers.add(attribute.array.buffer as ArrayBuffer)
    for (const mask of prepared.designComposite?.masks ?? []) {
      buffers.add(mask.paintableCells.buffer as ArrayBuffer)
      buffers.add(mask.preservedCells.buffer as ArrayBuffer)
    }
    self.postMessage({ prepared }, { transfer: [...buffers] })
    for (const geometry of resources.geometries) geometry.dispose()
    for (const material of resources.materials) material.dispose()
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Reality preparation failed.' })
  }
}

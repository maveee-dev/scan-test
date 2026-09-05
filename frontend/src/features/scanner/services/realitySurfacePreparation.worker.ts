import type { FinalizedRealitySurfel } from '../types'
import { createRealitySurfaceRenderResources, packRealitySurface, type RealitySurfaceRenderMode } from './realitySurfaceRenderingService'
import {
  buildRealityDesignColors,
  type RealityDebugColorMode,
  type RealityDesignColorInput,
  type RealityStructuralAssociationTable,
} from './realityStructuralAssociationService'

self.onmessage = (event: MessageEvent<{
  surfels: readonly FinalizedRealitySurfel[]
  mode: RealitySurfaceRenderMode
  association: RealityStructuralAssociationTable | null
  designInputs: readonly RealityDesignColorInput[]
  debugColorMode?: RealityDebugColorMode
}>) => {
  try {
    const debugMode = event.data.debugColorMode ?? 'none'
    const displayColors = event.data.association && (event.data.designInputs.length > 0 || debugMode !== 'none')
      ? buildRealityDesignColors(event.data.surfels, event.data.association, event.data.designInputs, debugMode)
      : undefined
    const resources = createRealitySurfaceRenderResources({ surfels: event.data.surfels }, event.data.mode, displayColors)
    const prepared = packRealitySurface(resources)
    const buffers = new Set<ArrayBuffer>()
    for (const geometry of prepared.geometries) for (const attribute of geometry.attributes) buffers.add(attribute.array.buffer as ArrayBuffer)
    self.postMessage({ prepared }, { transfer: [...buffers] })
    for (const geometry of resources.geometries) geometry.dispose()
    for (const material of resources.materials) material.dispose()
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Reality preparation failed.' })
  }
}

import type { FinalizedRealitySurfel } from '../types'
import { createRealitySurfaceRenderResources, packRealitySurface, type RealitySurfaceRenderMode } from './realitySurfaceRenderingService'

self.onmessage = (event: MessageEvent<{ surfels: readonly FinalizedRealitySurfel[]; mode: RealitySurfaceRenderMode }>) => {
  try {
    const resources = createRealitySurfaceRenderResources({ surfels: event.data.surfels }, event.data.mode)
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

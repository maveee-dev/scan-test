import type { RoomSurfacePatch } from '../../room-analysis/types'
import type { FinalizedRealitySurfel } from '../types'
import { associateRealitySurfels } from './realityStructuralAssociationService'

self.onmessage = (event: MessageEvent<{ surfels: readonly FinalizedRealitySurfel[]; patches: readonly RoomSurfacePatch[] }>) => {
  try {
    const table = associateRealitySurfels(event.data.surfels, event.data.patches)
    self.postMessage({ table }, { transfer: [table.surfaceIndices.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Structural association failed.' })
  }
}

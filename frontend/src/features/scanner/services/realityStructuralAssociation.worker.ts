import type { RoomSurfacePatch } from '../../room-analysis/types'
import type { FinalizedRealitySurfel, FinalizedSurfaceSurfel } from '../types'
import { associateRealitySurfels } from './realityStructuralAssociationService'

self.onmessage = (event: MessageEvent<{
  surfels: readonly FinalizedRealitySurfel[]
  patches: readonly RoomSurfacePatch[]
  structuralSurfels?: readonly FinalizedSurfaceSurfel[]
}>) => {
  try {
    const table = associateRealitySurfels(
      event.data.surfels,
      event.data.patches,
      event.data.structuralSurfels,
    )
    self.postMessage(
      { table },
      {
        transfer: [
          table.memberships.buffer,
          table.samplePositions.buffer,
          table.logicalSurfaceIndices.buffer,
          table.patchIndices.buffer,
        ],
      },
    )
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Structural association failed.' })
  }
}

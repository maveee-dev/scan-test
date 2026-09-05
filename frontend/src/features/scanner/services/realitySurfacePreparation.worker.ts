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
import { associateRealityWallTriangles } from './realityWallTriangleAssociationService'

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
    // Build one stable, all-logical-surface barrier map after analysis. It is
    // reused by automatic association and later frontmost user-hit ownership;
    // paint swatches never rebuild it.
    const ownershipInputs = event.data.association?.logicalSurfaces.map((surface) => ({ surfaceId: surface.id, paintColor: '#000000' })) ?? []
    const ownershipComposite = event.data.association
      ? buildRealityDesignCompositePlan(event.data.surfels, event.data.association, ownershipInputs)
      : null
    const composite = event.data.association && event.data.designInputs.length > 0 && debugMode === 'none'
      ? buildRealityDesignCompositePlan(
        event.data.surfels,
        event.data.association,
        event.data.designInputs,
        event.data.designCompositeMode ?? 'composite',
      )
      : null
    // Normal M8.5.6 Design keeps the complete measured Reality scene. Only the
    // confirmed connected triangle components receive derived color below.
    const renderSurfels = composite && composite.mode !== 'composite'
      ? event.data.surfels.filter((_surfel, index) => composite.visibilityMask[index] === 1)
      : event.data.surfels
    // M8.5.6 normal Design must begin from original Reality RGB. Applying the
    // earlier per-surfel Design palette here would leak paint outside confirmed
    // triangle components before the triangle pass runs on the preview side.
    const displayColors = composite
      ? composite.diagnosticColors ?? undefined
      : event.data.association && debugMode !== 'none'
        ? buildRealityDesignColors(event.data.surfels, event.data.association, event.data.designInputs, debugMode)
        : undefined
    const resources = createRealitySurfaceRenderResources({ surfels: renderSurfels }, event.data.mode, displayColors)
    const prepared = packRealitySurface(resources)
    if (composite && event.data.association) {
      prepared.designComposite = {
        mode: composite.mode,
        structuralPatchIds: composite.structuralPatchIds,
        masks: composite.masks,
        stats: composite.stats,
      }
    }
    if (event.data.association && ownershipComposite) {
      prepared.ownershipClassifications = ownershipComposite.classifications
      if (resources.triangleTopology) {
        // Keep automatic M8.5.6 components as a fallback/reference, but use
        // one all-surface M8.5.5 barrier map. M8.5.7 can then grow from the
        // actual frontmost raycast triangle without rerunning this work.
        prepared.designTriangleAssociation = associateRealityWallTriangles(
          event.data.surfels,
          resources.triangleTopology,
          event.data.association,
          ownershipComposite.classifications,
        )
      }
    }
    const buffers = new Set<ArrayBuffer>()
    for (const geometry of prepared.geometries) for (const attribute of geometry.attributes) buffers.add(attribute.array.buffer as ArrayBuffer)
    for (const mask of prepared.designComposite?.masks ?? []) {
      buffers.add(mask.paintableCells.buffer as ArrayBuffer)
      buffers.add(mask.preservedCells.buffer as ArrayBuffer)
    }
    if (prepared.triangleTopology) buffers.add(prepared.triangleTopology.vertexSurfelIds.buffer as ArrayBuffer)
    if (prepared.ownershipClassifications) buffers.add(prepared.ownershipClassifications.buffer as ArrayBuffer)
    if (prepared.designTriangleAssociation) {
      buffers.add(prepared.designTriangleAssociation.logicalSurfaceIndices.buffer as ArrayBuffer)
      buffers.add(prepared.designTriangleAssociation.componentIds.buffer as ArrayBuffer)
      buffers.add(prepared.designTriangleAssociation.seedMask.buffer as ArrayBuffer)
    }
    self.postMessage({ prepared }, { transfer: [...buffers] })
    for (const geometry of resources.geometries) geometry.dispose()
    for (const material of resources.materials) material.dispose()
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Reality preparation failed.' })
  }
}

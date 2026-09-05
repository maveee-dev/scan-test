import type { RoomSurfacePatch } from '../../room-analysis/types'
import type { FinalizedRealitySurfel, RealityRgbColor, SpatialPoint } from '../types'
import {
  RealityMembershipCode,
  polygonStatus,
  type RealityDesignColorInput,
  type RealityStructuralAssociationTable,
} from './realityStructuralAssociationService'

export type RealityDesignCompositeMode = 'composite' | 'structural-only' | 'foreground-only' | 'classification'

export const RealityDesignCompositeClassification = {
  OUTSIDE: 0,
  STRUCTURAL_SURFACE: 1,
  FOREGROUND: 2,
  AMBIGUOUS: 3,
} as const

export interface RealityDesignCompositorSurfaceStats {
  readonly logicalSurfaceId: string
  readonly structuralAreaMetersSquared: number
  readonly domainSampleCount: number
  readonly foregroundSampleCount: number
  readonly suppressedWallSampleCount: number
  readonly ambiguousSampleCount: number
}

export interface RealityDesignCompositorStats {
  readonly preparationMs: number
  readonly foregroundClassificationMs: number
  readonly structuralDesignPatchCount: number
  readonly realityMaskedSampleCount: number
  readonly realityForegroundSampleCount: number
  readonly realityAmbiguousSampleCount: number
  readonly realityOutsideSampleCount: number
  readonly memoryBytes: number
  readonly surfaces: readonly RealityDesignCompositorSurfaceStats[]
}

export interface RealityDesignCompositePlan {
  readonly mode: RealityDesignCompositeMode
  /** One byte per original dense-Reality sample; never mutates the scan. */
  readonly classifications: Uint8Array
  /** One byte per original dense-Reality sample for the derived render pass. */
  readonly visibilityMask: Uint8Array
  readonly structuralPatchIds: readonly string[]
  readonly diagnosticColors: ReadonlyMap<number, RealityRgbColor> | null
  readonly stats: RealityDesignCompositorStats
}

const EPSILON = 1e-8
const PATCH_EDGE_TOLERANCE_METERS = 0.012
const COMPOSITOR_DOMAIN_MAX_RESIDUAL_METERS = 0.12
const POSITIVE_FOREGROUND_OFFSET_METERS = 0.04
const INCOMPATIBLE_NORMAL_FOREGROUND_OFFSET_METERS = 0.02
const CLASSIFICATION_COLORS: Record<number, RealityRgbColor> = {
  [RealityDesignCompositeClassification.OUTSIDE]: { r: 0.22, g: 0.27, b: 0.34 },
  [RealityDesignCompositeClassification.STRUCTURAL_SURFACE]: { r: 0.18, g: 0.54, b: 0.98 },
  [RealityDesignCompositeClassification.FOREGROUND]: { r: 0.15, g: 0.9, b: 0.42 },
  [RealityDesignCompositeClassification.AMBIGUOUS]: { r: 0.95, g: 0.66, b: 0.12 },
}

function timestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function normalizedDot(first: SpatialPoint, second: SpatialPoint): number {
  const firstLength = Math.hypot(first.x, first.y, first.z)
  const secondLength = Math.hypot(second.x, second.y, second.z)
  if (firstLength <= EPSILON || secondLength <= EPSILON) return 0
  return Math.abs((first.x * second.x + first.y * second.y + first.z * second.z) / (firstLength * secondLength))
}

function localPoint(point: SpatialPoint, patch: RoomSurfacePatch): { u: number; v: number } {
  const dx = point.x - patch.basis.origin.x
  const dy = point.y - patch.basis.origin.y
  const dz = point.z - patch.basis.origin.z
  return {
    u: dx * patch.basis.axisU.x + dy * patch.basis.axisU.y + dz * patch.basis.axisU.z,
    v: dx * patch.basis.axisV.x + dy * patch.basis.axisV.y + dz * patch.basis.axisV.z,
  }
}

function isInsidePatchDomain(point: SpatialPoint, patch: RoomSurfacePatch): boolean {
  const polygon = polygonStatus(localPoint(point, patch), patch)
  return polygon.inside || polygon.edgeDistance <= PATCH_EDGE_TOLERANCE_METERS
}

function paintSurfaceIds(
  table: RealityStructuralAssociationTable,
  inputs: readonly RealityDesignColorInput[],
): Set<string> {
  const inputIds = new Set(inputs.map((input) => input.surfaceId))
  const result = new Set<string>()
  for (const logical of table.logicalSurfaces) {
    if (inputIds.has(logical.id) || logical.memberPatchIds.some((id) => inputIds.has(id))) {
      result.add(logical.id)
    }
  }
  return result
}

/**
 * Classifies only the render-time relationship between Dense Reality and an
 * already customized structural patch. This intentionally reverses the old
 * paint-mask question: ambiguous samples no longer block the structural paint;
 * only positive foreground evidence survives in front of it.
 */
export function buildRealityDesignCompositePlan(
  surfels: readonly FinalizedRealitySurfel[],
  table: RealityStructuralAssociationTable,
  inputs: readonly RealityDesignColorInput[],
  mode: RealityDesignCompositeMode = 'composite',
): RealityDesignCompositePlan {
  const startedAt = timestamp()
  const customizedLogicalIds = paintSurfaceIds(table, inputs)
  const classifications = new Uint8Array(surfels.length)
  const visibilityMask = new Uint8Array(surfels.length)
  visibilityMask.fill(1)
  const surfaceStats = new Map<string, {
    structuralAreaMetersSquared: number
    domainSampleCount: number
    foregroundSampleCount: number
    suppressedWallSampleCount: number
    ambiguousSampleCount: number
  }>()
  const structuralPatchIds: string[] = []
  const patchesByLogicalId = new Map<string, RoomSurfacePatch[]>()
  const referenceOffsetByLogicalId = new Map<string, number>()

  for (let logicalIndex = 0; logicalIndex < table.logicalSurfaces.length; logicalIndex++) {
    const logical = table.logicalSurfaces[logicalIndex]
    if (!customizedLogicalIds.has(logical.id)) continue
    const patches = table.patches.filter((patch) => logical.memberPatchIds.includes(patch.id))
    patchesByLogicalId.set(logical.id, patches)
    for (const patch of patches) structuralPatchIds.push(patch.id)
    const diagnostic = table.perLogicalSurface.find((item) => item.logicalSurfaceId === logical.id)
    referenceOffsetByLogicalId.set(logical.id, diagnostic?.membershipReferenceApplied
      ? diagnostic.membershipReferenceOffsetMeters
      : 0)
    surfaceStats.set(logical.id, {
      structuralAreaMetersSquared: patches.reduce((sum, patch) => sum + patch.areaMetersSquared, 0),
      domainSampleCount: 0,
      foregroundSampleCount: 0,
      suppressedWallSampleCount: 0,
      ambiguousSampleCount: 0,
    })
  }

  const foregroundStartedAt = timestamp()
  let outsideCount = 0
  let foregroundCount = 0
  let suppressedCount = 0
  let ambiguousCount = 0
  for (let index = 0; index < surfels.length; index++) {
    const surfel = surfels[index]
    let selectedLogicalIndex = -1
    let selectedPlaneDistance = Infinity
    for (let logicalIndex = 0; logicalIndex < table.logicalSurfaces.length; logicalIndex++) {
      const logical = table.logicalSurfaces[logicalIndex]
      if (!customizedLogicalIds.has(logical.id)) continue
      const patches = patchesByLogicalId.get(logical.id) ?? []
      if (!patches.some((patch) => isInsidePatchDomain(surfel.position, patch))) continue
      const normalLength = Math.hypot(logical.representativeNormal.x, logical.representativeNormal.y, logical.representativeNormal.z)
      if (normalLength <= EPSILON) continue
      const signed = (
        logical.representativeNormal.x * surfel.position.x +
        logical.representativeNormal.y * surfel.position.y +
        logical.representativeNormal.z * surfel.position.z -
        logical.representativePlaneConstant
      ) / normalLength
      const planeDistance = Math.abs(signed - (referenceOffsetByLogicalId.get(logical.id) ?? 0))
      if (planeDistance > COMPOSITOR_DOMAIN_MAX_RESIDUAL_METERS) continue
      if (planeDistance < selectedPlaneDistance) {
        selectedPlaneDistance = planeDistance
        selectedLogicalIndex = logicalIndex
      }
    }

    if (selectedLogicalIndex < 0) {
      classifications[index] = RealityDesignCompositeClassification.OUTSIDE
      outsideCount++
      continue
    }

    const logical = table.logicalSurfaces[selectedLogicalIndex]
    const stats = surfaceStats.get(logical.id)
    if (stats) stats.domainSampleCount++
    const membership = table.memberships[index]
    const normalAgreement = normalizedDot(surfel.normal, logical.representativeNormal)
    // `foregroundMask` is M8.5.x's positive-evidence output (offset or depth
    // barrier), not a generic failed-wall label. A non-member without that
    // evidence is intentionally suppressed so it cannot cover structural paint.
    const positiveForeground = table.foregroundMask[index] === 1 ||
      selectedPlaneDistance >= POSITIVE_FOREGROUND_OFFSET_METERS ||
      (membership === RealityMembershipCode.NON_WALL &&
        normalAgreement < 0.5 &&
        selectedPlaneDistance >= INCOMPATIBLE_NORMAL_FOREGROUND_OFFSET_METERS)
    if (positiveForeground) {
      classifications[index] = RealityDesignCompositeClassification.FOREGROUND
      foregroundCount++
      if (stats) stats.foregroundSampleCount++
      continue
    }

    if (membership === RealityMembershipCode.CORE_WALL_MEMBER ||
      membership === RealityMembershipCode.EXPANDED_WALL_MEMBER ||
      normalAgreement >= 0.65) {
      classifications[index] = RealityDesignCompositeClassification.STRUCTURAL_SURFACE
      suppressedCount++
      if (stats) stats.suppressedWallSampleCount++
    } else {
      // Conservative only for preservation: uncertain geometry is allowed to
      // reveal the structural surface, but is separately visible in diagnostics.
      classifications[index] = RealityDesignCompositeClassification.AMBIGUOUS
      ambiguousCount++
      if (stats) stats.ambiguousSampleCount++
    }
  }
  const foregroundClassificationMs = timestamp() - foregroundStartedAt

  const diagnosticColors = mode === 'classification'
    ? new Map<number, RealityRgbColor>(surfels.map((surfel, index) => [surfel.id, CLASSIFICATION_COLORS[classifications[index]]]))
    : null
  if (mode === 'structural-only') {
    visibilityMask.fill(0)
  } else if (mode === 'foreground-only') {
    for (let index = 0; index < classifications.length; index++) {
      visibilityMask[index] = classifications[index] === RealityDesignCompositeClassification.FOREGROUND ? 1 : 0
    }
  } else if (mode === 'composite') {
    for (let index = 0; index < classifications.length; index++) {
      const classification = classifications[index]
      visibilityMask[index] = classification === RealityDesignCompositeClassification.OUTSIDE ||
        classification === RealityDesignCompositeClassification.FOREGROUND ? 1 : 0
    }
  }

  return {
    mode,
    classifications,
    visibilityMask,
    structuralPatchIds,
    diagnosticColors,
    stats: {
      preparationMs: timestamp() - startedAt,
      foregroundClassificationMs,
      structuralDesignPatchCount: structuralPatchIds.length,
      realityMaskedSampleCount: suppressedCount,
      realityForegroundSampleCount: foregroundCount,
      realityAmbiguousSampleCount: ambiguousCount,
      realityOutsideSampleCount: outsideCount,
      memoryBytes: classifications.byteLength + visibilityMask.byteLength,
      surfaces: [...surfaceStats.entries()].map(([logicalSurfaceId, stats]) => ({ logicalSurfaceId, ...stats })),
    },
  }
}

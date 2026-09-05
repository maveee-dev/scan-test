import type { RoomSurfacePatch } from '../../room-analysis/types'
import type { FinalizedRealitySurfel, RealityRgbColor, SpatialPoint } from '../types'
import { RealityMembershipCode, polygonStatus, type RealityDesignColorInput, type RealityStructuralAssociationTable } from './realityStructuralAssociationService'

/** Development views. Normal Design uses `composite`. */
export type RealityDesignCompositeMode = 'composite' | 'structural-only' | 'foreground-only' | 'classification' | 'exposed-wall-mask' | 'preserved-object-mask' | 'reality-wall-components' | 'selected-wall-triangles' | 'object-non-wall-triangles' | 'all-reality-components' | 'hit-component' | 'logical-wall-owned-components' | 'rejected-nearby-components'

/** Render-time only: original Dense Reality data is never modified. */
export const RealityDesignCompositeClassification = {
  OUTSIDE: 0,
  EXPOSED_STRUCTURAL_SURFACE: 1,
  FOREGROUND_OBJECT: 2,
  ATTACHED_OR_NEAR_WALL_OBJECT: 3,
  UNCERTAIN: 4,
} as const

export interface RealityPaintablePatchMask {
  readonly logicalSurfaceId: string
  readonly patchId: string
  readonly width: number
  readonly height: number
  readonly cellSizeMeters: number
  readonly minU: number
  readonly minV: number
  /** 1 means the structural material is allowed to render in this wall-local cell. */
  readonly paintableCells: Uint8Array
  /** 1 means Reality content is deliberately retained in this wall-local cell. */
  readonly preservedCells: Uint8Array
  readonly paintableAreaMetersSquared: number
  readonly preservedAreaMetersSquared: number
  readonly unsupportedAreaMetersSquared: number
}

export interface RealityDesignCompositorSurfaceStats {
  readonly logicalSurfaceId: string
  readonly structuralAreaMetersSquared: number
  readonly domainSampleCount: number
  readonly exposedSampleCount: number
  readonly foregroundSampleCount: number
  readonly attachedSampleCount: number
  readonly uncertainSampleCount: number
  readonly paintableMaskAreaMetersSquared: number
  readonly preservedMaskAreaMetersSquared: number
  readonly unsupportedMaskAreaMetersSquared: number
  readonly maskWidth: number
  readonly maskHeight: number
  readonly componentCount: number
  readonly preservedComponentCount: number
  readonly largestPreservedComponentAreaMetersSquared: number
}

export interface RealityDesignCompositorStats {
  readonly preparationMs: number
  readonly foregroundClassificationMs: number
  readonly structuralDesignPatchCount: number
  readonly realityMaskedSampleCount: number
  readonly realityForegroundSampleCount: number
  readonly realityAttachedSampleCount: number
  readonly realityUncertainSampleCount: number
  readonly realityOutsideSampleCount: number
  readonly maskPreparationMs: number
  readonly memoryBytes: number
  readonly surfaces: readonly RealityDesignCompositorSurfaceStats[]
}

export interface RealityDesignCompositePlan {
  readonly mode: RealityDesignCompositeMode
  readonly classifications: Uint8Array
  readonly visibilityMask: Uint8Array
  readonly structuralPatchIds: readonly string[]
  readonly masks: readonly RealityPaintablePatchMask[]
  readonly diagnosticColors: ReadonlyMap<number, RealityRgbColor> | null
  readonly stats: RealityDesignCompositorStats
}

const EPSILON = 1e-8
const PATCH_EDGE_TOLERANCE_METERS = 0.012
const DOMAIN_MAX_RESIDUAL_METERS = 0.12
const CONFIRMED_FOREGROUND_OFFSET_METERS = 0.04
const NEAR_OBJECT_OFFSET_METERS = 0.012
const COMPONENT_LINK_METERS = 0.07
const MIN_COMPONENT_SAMPLES = 3
const COLOR_DISCONTINUITY = 0.22
const MASK_TARGET_CELL_METERS = 0.03
const MASK_MAX_AXIS_CELLS = 160

const CLASSIFICATION_COLORS: Record<number, RealityRgbColor> = {
  [RealityDesignCompositeClassification.OUTSIDE]: { r: 0.22, g: 0.27, b: 0.34 },
  [RealityDesignCompositeClassification.EXPOSED_STRUCTURAL_SURFACE]: { r: 0.12, g: 0.67, b: 0.96 },
  [RealityDesignCompositeClassification.FOREGROUND_OBJECT]: { r: 0.16, g: 0.9, b: 0.37 },
  [RealityDesignCompositeClassification.ATTACHED_OR_NEAR_WALL_OBJECT]: { r: 0.91, g: 0.23, b: 0.72 },
  [RealityDesignCompositeClassification.UNCERTAIN]: { r: 0.96, g: 0.68, b: 0.13 },
}

interface PatchRuntime {
  readonly logicalId: string
  readonly patch: RoomSurfacePatch
  readonly referenceOffset: number
  readonly minU: number
  readonly minV: number
  readonly width: number
  readonly height: number
  readonly cellSizeMeters: number
  readonly candidateIndices: number[]
  readonly paintableCells: Uint8Array
  readonly preservedCells: Uint8Array
  componentCount: number
  preservedComponentCount: number
  largestPreservedComponentCells: number
}

interface Candidate {
  readonly surfelIndex: number
  readonly runtime: PatchRuntime
  readonly u: number
  readonly v: number
  readonly offset: number
  readonly normalAgreement: number
  readonly explicitForeground: boolean
  readonly geometricAnomaly: boolean
  readonly colorAnomaly: boolean
}

function timestamp(): number { return typeof performance === 'undefined' ? Date.now() : performance.now() }

function normalizedDot(first: SpatialPoint, second: SpatialPoint): number {
  const firstLength = Math.hypot(first.x, first.y, first.z), secondLength = Math.hypot(second.x, second.y, second.z)
  if (firstLength <= EPSILON || secondLength <= EPSILON) return 0
  return Math.abs((first.x * second.x + first.y * second.y + first.z * second.z) / (firstLength * secondLength))
}

function localPoint(point: SpatialPoint, patch: RoomSurfacePatch): { u: number; v: number } {
  const dx = point.x - patch.basis.origin.x, dy = point.y - patch.basis.origin.y, dz = point.z - patch.basis.origin.z
  return { u: dx * patch.basis.axisU.x + dy * patch.basis.axisU.y + dz * patch.basis.axisU.z, v: dx * patch.basis.axisV.x + dy * patch.basis.axisV.y + dz * patch.basis.axisV.z }
}

function patchDomain(point: SpatialPoint, patch: RoomSurfacePatch): boolean {
  const status = polygonStatus(localPoint(point, patch), patch)
  return status.inside || status.edgeDistance <= PATCH_EDGE_TOLERANCE_METERS
}

function signedDistance(point: SpatialPoint, patch: RoomSurfacePatch): number {
  const length = Math.hypot(patch.normal.x, patch.normal.y, patch.normal.z)
  return length <= EPSILON ? Infinity : (patch.normal.x * point.x + patch.normal.y * point.y + patch.normal.z * point.z - patch.planeConstant) / length
}

function surfaceIds(table: RealityStructuralAssociationTable, inputs: readonly RealityDesignColorInput[]): Set<string> {
  const requested = new Set(inputs.map((input) => input.surfaceId))
  return new Set(table.logicalSurfaces.filter((logical) => requested.has(logical.id) || logical.memberPatchIds.some((id) => requested.has(id))).map((logical) => logical.id))
}

function makeRuntime(logicalId: string, patch: RoomSurfacePatch, referenceOffset: number): PatchRuntime {
  const us = patch.vertices2DLocal.map((vertex) => vertex.u), vs = patch.vertices2DLocal.map((vertex) => vertex.v)
  const minU = Math.min(...us), maxU = Math.max(...us), minV = Math.min(...vs), maxV = Math.max(...vs)
  const spanU = Math.max(MASK_TARGET_CELL_METERS, maxU - minU), spanV = Math.max(MASK_TARGET_CELL_METERS, maxV - minV)
  const cellSizeMeters = Math.max(MASK_TARGET_CELL_METERS, spanU / MASK_MAX_AXIS_CELLS, spanV / MASK_MAX_AXIS_CELLS)
  const width = Math.max(1, Math.ceil(spanU / cellSizeMeters)), height = Math.max(1, Math.ceil(spanV / cellSizeMeters))
  return { logicalId, patch, referenceOffset, minU, minV, width, height, cellSizeMeters, candidateIndices: [], paintableCells: new Uint8Array(width * height), preservedCells: new Uint8Array(width * height), componentCount: 0, preservedComponentCount: 0, largestPreservedComponentCells: 0 }
}

function cellIndex(runtime: PatchRuntime, u: number, v: number): number {
  const x = Math.max(0, Math.min(runtime.width - 1, Math.floor((u - runtime.minU) / runtime.cellSizeMeters)))
  const y = Math.max(0, Math.min(runtime.height - 1, Math.floor((v - runtime.minV) / runtime.cellSizeMeters)))
  return y * runtime.width + x
}

function markCellAndBoundary(runtime: PatchRuntime, target: Uint8Array, cell: number): void {
  target[cell] = 1
  const x = cell % runtime.width, y = Math.floor(cell / runtime.width)
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue
    const nextX = x + dx, nextY = y + dy
    if (nextX < 0 || nextX >= runtime.width || nextY < 0 || nextY >= runtime.height) continue
    const u = runtime.minU + (nextX + 0.5) * runtime.cellSizeMeters, v = runtime.minV + (nextY + 0.5) * runtime.cellSizeMeters
    if (polygonStatus({ u, v }, runtime.patch).inside) target[nextY * runtime.width + nextX] = 1
  }
}

function colorDistance(first: RealityRgbColor | null, second: RealityRgbColor | null): number { return first && second ? Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b) : 0 }

function averageColor(surfels: readonly FinalizedRealitySurfel[], indices: readonly number[]): RealityRgbColor | null {
  let r = 0, g = 0, b = 0
  let count = 0
  for (const index of indices) { const color = surfels[index].colorRgb; if (color) { r += color.r; g += color.g; b += color.b; count++ } }
  return count > 0 ? { r: r / count, g: g / count, b: b / count } : null
}

function maskArea(runtime: PatchRuntime, cells: Uint8Array): number { let count = 0; for (const cell of cells) if (cell) count++; return count * runtime.cellSizeMeters * runtime.cellSizeMeters }

/** Fill only a one-cell unsupported interruption when it is surrounded by the
 * same measured exposed material. Preserved cells always remain hard barriers. */
function bridgeTinyExposedGaps(runtime: PatchRuntime): void {
  const additions: number[] = []
  for (let y = 1; y < runtime.height - 1; y++) for (let x = 1; x < runtime.width - 1; x++) {
    const index = y * runtime.width + x
    if (runtime.paintableCells[index] || runtime.preservedCells[index]) continue
    const u = runtime.minU + (x + 0.5) * runtime.cellSizeMeters, v = runtime.minV + (y + 0.5) * runtime.cellSizeMeters
    if (!polygonStatus({ u, v }, runtime.patch).inside) continue
    let support = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dy !== 0) support += runtime.paintableCells[(y + dy) * runtime.width + x + dx]
    if (support >= 5) additions.push(index)
  }
  for (const index of additions) runtime.paintableCells[index] = 1
}

/**
 * M8.5.5 derives a wall-local visibility/material mask. RGB can only support
 * geometric evidence; it is never enough by itself to erase an exposed wall.
 */
export function buildRealityDesignCompositePlan(surfels: readonly FinalizedRealitySurfel[], table: RealityStructuralAssociationTable, inputs: readonly RealityDesignColorInput[], mode: RealityDesignCompositeMode = 'composite'): RealityDesignCompositePlan {
  const startedAt = timestamp(), selectedLogicalIds = surfaceIds(table, inputs)
  const classifications = new Uint8Array(surfels.length), visibilityMask = new Uint8Array(surfels.length)
  visibilityMask.fill(1)
  const runtimes: PatchRuntime[] = [], structuralPatchIds: string[] = []
  for (const logical of table.logicalSurfaces) {
    if (!selectedLogicalIds.has(logical.id)) continue
    const diagnostic = table.perLogicalSurface.find((entry) => entry.logicalSurfaceId === logical.id)
    const offset = diagnostic?.membershipReferenceApplied ? diagnostic.membershipReferenceOffsetMeters : 0
    for (const patch of table.patches) if (logical.memberPatchIds.includes(patch.id)) { runtimes.push(makeRuntime(logical.id, patch, offset)); structuralPatchIds.push(patch.id) }
  }

  const candidates: Candidate[] = [], coreIndicesByRuntime = new Map<PatchRuntime, number[]>()
  for (let index = 0; index < surfels.length; index++) {
    const surfel = surfels[index]
    let chosen: PatchRuntime | null = null, nearest = Infinity
    for (const runtime of runtimes) {
      if (!patchDomain(surfel.position, runtime.patch)) continue
      const distance = Math.abs(signedDistance(surfel.position, runtime.patch) - runtime.referenceOffset)
      if (distance <= DOMAIN_MAX_RESIDUAL_METERS && distance < nearest) { chosen = runtime; nearest = distance }
    }
    if (!chosen) { classifications[index] = RealityDesignCompositeClassification.OUTSIDE; continue }
    chosen.candidateIndices.push(index)
    const membership = table.memberships[index]
    if (membership === RealityMembershipCode.CORE_WALL_MEMBER || membership === RealityMembershipCode.EXPANDED_WALL_MEMBER) { const values = coreIndicesByRuntime.get(chosen) ?? []; values.push(index); coreIndicesByRuntime.set(chosen, values) }
  }

  for (const runtime of runtimes) {
    const baseline = averageColor(surfels, coreIndicesByRuntime.get(runtime) ?? [])
    for (const index of runtime.candidateIndices) {
      const surfel = surfels[index], local = localPoint(surfel.position, runtime.patch), offset = signedDistance(surfel.position, runtime.patch) - runtime.referenceOffset
      const normalAgreement = normalizedDot(surfel.normal, runtime.patch.normal), membership = table.memberships[index]
      const explicitForeground = table.foregroundMask[index] === 1 || offset >= CONFIRMED_FOREGROUND_OFFSET_METERS || (membership === RealityMembershipCode.NON_WALL && normalAgreement < 0.5 && offset >= 0.02)
      const geometricAnomaly = explicitForeground || Math.abs(offset) >= NEAR_OBJECT_OFFSET_METERS || normalAgreement < 0.75
      candidates.push({ surfelIndex: index, runtime, u: local.u, v: local.v, offset, normalAgreement, explicitForeground, geometricAnomaly, colorAnomaly: colorDistance(surfel.colorRgb, baseline) >= COLOR_DISCONTINUITY })
    }
  }

  // Group only geometrically anomalous nearby samples. A photo-colored wall is not preserved unless it also has local geometry evidence.
  const byRuntime = new Map<PatchRuntime, Candidate[]>()
  for (const candidate of candidates) if (candidate.geometricAnomaly) { const entries = byRuntime.get(candidate.runtime) ?? []; entries.push(candidate); byRuntime.set(candidate.runtime, entries) }
  const preserved = new Set<number>(), explicit = new Set<number>()
  for (const [runtime, entries] of byRuntime) {
    const buckets = new Map<string, number[]>()
    for (let i = 0; i < entries.length; i++) { const candidate = entries[i], key = `${Math.floor(candidate.u / COMPONENT_LINK_METERS)}:${Math.floor(candidate.v / COMPONENT_LINK_METERS)}`, values = buckets.get(key) ?? []; values.push(i); buckets.set(key, values) }
    const visited = new Uint8Array(entries.length)
    for (let start = 0; start < entries.length; start++) {
      if (visited[start]) continue
      const queue = [start], component: Candidate[] = []; visited[start] = 1
      while (queue.length) {
        const current = entries[queue.pop() as number]; component.push(current)
        const bx = Math.floor(current.u / COMPONENT_LINK_METERS), by = Math.floor(current.v / COMPONENT_LINK_METERS)
        for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) for (const neighborIndex of buckets.get(`${x}:${y}`) ?? []) {
          if (visited[neighborIndex]) continue
          const neighbor = entries[neighborIndex]
          if (Math.hypot(current.u - neighbor.u, current.v - neighbor.v) > COMPONENT_LINK_METERS) continue
          visited[neighborIndex] = 1; queue.push(neighborIndex)
        }
      }
      runtime.componentCount++
      const hasOffset = component.some((item) => Math.abs(item.offset) >= 0.018), hasNormalBreak = component.some((item) => item.normalAgreement < 0.65), hasColorSupport = component.some((item) => item.colorAnomaly), hasExplicitForeground = component.some((item) => item.explicitForeground)
      const preserveComponent = hasExplicitForeground || (component.length >= MIN_COMPONENT_SAMPLES && (hasOffset || hasNormalBreak) && hasColorSupport)
      if (!preserveComponent) continue
      runtime.preservedComponentCount++; runtime.largestPreservedComponentCells = Math.max(runtime.largestPreservedComponentCells, component.length)
      for (const item of component) { preserved.add(item.surfelIndex); if (hasExplicitForeground) explicit.add(item.surfelIndex) }
    }
  }

  const classificationStarted = timestamp()
  let exposed = 0, foreground = 0, attached = 0, uncertain = 0, outside = 0
  for (const candidate of candidates) {
    const { runtime, surfelIndex } = candidate, cell = cellIndex(runtime, candidate.u, candidate.v)
    if (preserved.has(surfelIndex)) {
      classifications[surfelIndex] = explicit.has(surfelIndex) ? RealityDesignCompositeClassification.FOREGROUND_OBJECT : RealityDesignCompositeClassification.ATTACHED_OR_NEAR_WALL_OBJECT
      markCellAndBoundary(runtime, runtime.preservedCells, cell)
      if (explicit.has(surfelIndex)) foreground++; else attached++
      continue
    }
    const membership = table.memberships[surfelIndex]
    const wallLike = membership === RealityMembershipCode.CORE_WALL_MEMBER || membership === RealityMembershipCode.EXPANDED_WALL_MEMBER || (Math.abs(candidate.offset) <= 0.014 && candidate.normalAgreement >= 0.75 && !candidate.colorAnomaly)
    if (wallLike) { classifications[surfelIndex] = RealityDesignCompositeClassification.EXPOSED_STRUCTURAL_SURFACE; runtime.paintableCells[cell] = 1; exposed++ }
    else { classifications[surfelIndex] = RealityDesignCompositeClassification.UNCERTAIN; markCellAndBoundary(runtime, runtime.preservedCells, cell); uncertain++ }
  }
  for (const value of classifications) if (value === RealityDesignCompositeClassification.OUTSIDE) outside++
  const foregroundClassificationMs = timestamp() - classificationStarted

  const masks: RealityPaintablePatchMask[] = runtimes.map((runtime) => {
    for (let index = 0; index < runtime.paintableCells.length; index++) if (runtime.preservedCells[index]) runtime.paintableCells[index] = 0
    bridgeTinyExposedGaps(runtime)
    const paintableAreaMetersSquared = maskArea(runtime, runtime.paintableCells), preservedAreaMetersSquared = maskArea(runtime, runtime.preservedCells)
    return { logicalSurfaceId: runtime.logicalId, patchId: runtime.patch.id, width: runtime.width, height: runtime.height, cellSizeMeters: runtime.cellSizeMeters, minU: runtime.minU, minV: runtime.minV, paintableCells: runtime.paintableCells, preservedCells: runtime.preservedCells, paintableAreaMetersSquared, preservedAreaMetersSquared, unsupportedAreaMetersSquared: Math.max(0, runtime.patch.areaMetersSquared - paintableAreaMetersSquared - preservedAreaMetersSquared) }
  })
  const diagnosticColors = mode === 'classification' ? new Map(surfels.map((surfel, index) => [surfel.id, CLASSIFICATION_COLORS[classifications[index]]])) : null
  for (let index = 0; index < classifications.length; index++) {
    const value = classifications[index]
    if (mode === 'structural-only' || mode === 'exposed-wall-mask') visibilityMask[index] = 0
    else if (mode === 'foreground-only' || mode === 'preserved-object-mask') visibilityMask[index] = value === RealityDesignCompositeClassification.FOREGROUND_OBJECT || value === RealityDesignCompositeClassification.ATTACHED_OR_NEAR_WALL_OBJECT || value === RealityDesignCompositeClassification.UNCERTAIN ? 1 : 0
    else if (mode === 'composite') visibilityMask[index] = value === RealityDesignCompositeClassification.OUTSIDE || value === RealityDesignCompositeClassification.FOREGROUND_OBJECT || value === RealityDesignCompositeClassification.ATTACHED_OR_NEAR_WALL_OBJECT || value === RealityDesignCompositeClassification.UNCERTAIN ? 1 : 0
  }
  const surfaces: RealityDesignCompositorSurfaceStats[] = runtimes.map((runtime) => {
    const mask = masks.find((item) => item.patchId === runtime.patch.id) as RealityPaintablePatchMask, classified = runtime.candidateIndices.map((index) => classifications[index])
    return { logicalSurfaceId: runtime.logicalId, structuralAreaMetersSquared: runtime.patch.areaMetersSquared, domainSampleCount: runtime.candidateIndices.length, exposedSampleCount: classified.filter((value) => value === RealityDesignCompositeClassification.EXPOSED_STRUCTURAL_SURFACE).length, foregroundSampleCount: classified.filter((value) => value === RealityDesignCompositeClassification.FOREGROUND_OBJECT).length, attachedSampleCount: classified.filter((value) => value === RealityDesignCompositeClassification.ATTACHED_OR_NEAR_WALL_OBJECT).length, uncertainSampleCount: classified.filter((value) => value === RealityDesignCompositeClassification.UNCERTAIN).length, paintableMaskAreaMetersSquared: mask.paintableAreaMetersSquared, preservedMaskAreaMetersSquared: mask.preservedAreaMetersSquared, unsupportedMaskAreaMetersSquared: mask.unsupportedAreaMetersSquared, maskWidth: runtime.width, maskHeight: runtime.height, componentCount: runtime.componentCount, preservedComponentCount: runtime.preservedComponentCount, largestPreservedComponentAreaMetersSquared: runtime.largestPreservedComponentCells * runtime.cellSizeMeters * runtime.cellSizeMeters }
  })
  const memoryBytes = classifications.byteLength + visibilityMask.byteLength + masks.reduce((sum, mask) => sum + mask.paintableCells.byteLength + mask.preservedCells.byteLength, 0)
  return { mode, classifications, visibilityMask, structuralPatchIds, masks, diagnosticColors, stats: { preparationMs: timestamp() - startedAt, foregroundClassificationMs, structuralDesignPatchCount: structuralPatchIds.length, realityMaskedSampleCount: exposed, realityForegroundSampleCount: foreground, realityAttachedSampleCount: attached, realityUncertainSampleCount: uncertain, realityOutsideSampleCount: outside, maskPreparationMs: timestamp() - classificationStarted, memoryBytes, surfaces } }
}

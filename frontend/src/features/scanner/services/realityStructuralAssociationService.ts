import type { RoomSurfacePatch } from '../../room-analysis/types'
import type { FinalizedRealitySurfel, RealityRgbColor, SpatialPoint } from '../types'

export type RealityStructuralAssociationStrength = 'strong' | 'partial' | 'none'

export interface RealityStructuralAssociationCandidate {
  readonly surfaceId: string
  readonly role: RoomSurfacePatch['role']
  readonly planeDistanceMeters: number | null
  readonly insidePatch: boolean
  readonly withinEdgeTolerance: boolean
  readonly normalCompatibility: number | null
  readonly accepted: boolean
}

export interface RealityStructuralAssociation {
  readonly strength: RealityStructuralAssociationStrength
  readonly surfaceId: string | null
  readonly role: RoomSurfacePatch['role'] | null
  readonly planeDistanceMeters: number | null
  readonly insidePatch: boolean
  readonly withinEdgeTolerance: boolean
  readonly normalCompatibility: number | null
  readonly confidence: number
  readonly reason: string
  readonly candidates: readonly RealityStructuralAssociationCandidate[]
}

export interface RealityStructuralAssociationTable {
  /** Matches the supplied Reality surfel array by index; -1 is intentionally unassociated. */
  readonly surfaceIndices: Int32Array
  readonly surfaceIds: readonly string[]
  readonly associatedSampleCount: number
  readonly preservedForegroundSampleCount: number
  readonly rejectedSampleCount: number
  readonly elapsedMs: number
}

export interface RealityDesignColorInput {
  readonly surfaceId: string
  readonly paintColor: string
}

const WALL_SAMPLE_PLANE_BAND_METERS = 0.025
const HIT_PLANE_TOLERANCE_METERS = 0.05
const PATCH_EDGE_TOLERANCE_METERS = 0.025
const MIN_NORMAL_COMPATIBILITY = 0.65
const EPSILON = 1e-8

function timestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function normalizedDot(first: SpatialPoint, second: SpatialPoint): number | null {
  const firstLength = Math.hypot(first.x, first.y, first.z)
  const secondLength = Math.hypot(second.x, second.y, second.z)
  if (firstLength <= EPSILON || secondLength <= EPSILON) return null
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

function distanceToSegment(point: { u: number; v: number }, start: { u: number; v: number }, end: { u: number; v: number }): number {
  const du = end.u - start.u, dv = end.v - start.v
  const lengthSquared = du * du + dv * dv
  if (lengthSquared <= EPSILON) return Math.hypot(point.u - start.u, point.v - start.v)
  const t = Math.max(0, Math.min(1, ((point.u - start.u) * du + (point.v - start.v) * dv) / lengthSquared))
  return Math.hypot(point.u - (start.u + du * t), point.v - (start.v + dv * t))
}

function polygonStatus(point: { u: number; v: number }, patch: RoomSurfacePatch): { inside: boolean; edgeDistance: number } {
  const vertices = patch.vertices2DLocal
  let inside = false
  let edgeDistance = Infinity
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const current = vertices[index], prior = vertices[previous]
    edgeDistance = Math.min(edgeDistance, distanceToSegment(point, prior, current))
    const crosses = (current.v > point.v) !== (prior.v > point.v)
    if (crosses && point.u < (prior.u - current.u) * (point.v - current.v) / (prior.v - current.v) + current.u) inside = !inside
  }
  return { inside, edgeDistance }
}

type CandidateEvaluation = Omit<RealityStructuralAssociation, 'candidates'>

function candidateAssociation(point: SpatialPoint, normal: SpatialPoint | null, patch: RoomSurfacePatch, planeTolerance: number): CandidateEvaluation {
  const planeNormalLength = Math.hypot(patch.normal.x, patch.normal.y, patch.normal.z)
  if (planeNormalLength <= EPSILON || patch.vertices2DLocal.length < 3) {
    return { strength: 'none', surfaceId: null, role: null, planeDistanceMeters: null, insidePatch: false, withinEdgeTolerance: false, normalCompatibility: null, confidence: 0, reason: 'invalid structural patch' }
  }
  const planeDistance = Math.abs((patch.normal.x * point.x + patch.normal.y * point.y + patch.normal.z * point.z - patch.planeConstant) / planeNormalLength)
  const polygon = polygonStatus(localPoint(point, patch), patch)
  const normalCompatibility = normal ? normalizedDot(normal, patch.normal) : null
  const withinEdgeTolerance = polygon.edgeDistance <= PATCH_EDGE_TOLERANCE_METERS
  const inside = polygon.inside || withinEdgeTolerance
  const normalPass = normalCompatibility === null || normalCompatibility >= MIN_NORMAL_COMPATIBILITY
  if (planeDistance > planeTolerance || !inside || !normalPass) {
    return { strength: 'none', surfaceId: null, role: null, planeDistanceMeters: planeDistance, insidePatch: polygon.inside, withinEdgeTolerance, normalCompatibility, confidence: 0, reason: planeDistance > planeTolerance ? 'outside structural plane band' : !inside ? 'outside structural patch' : 'incompatible surface normal' }
  }
  const confidence = Math.max(0, Math.min(1,
    0.55 * (1 - planeDistance / planeTolerance) +
    0.25 * (polygon.inside ? 1 : .6) +
    0.20 * (normalCompatibility ?? .8),
  ))
  return { strength: confidence >= .72 && polygon.inside ? 'strong' : 'partial', surfaceId: patch.id, role: patch.role, planeDistanceMeters: planeDistance, insidePatch: polygon.inside, withinEdgeTolerance, normalCompatibility, confidence, reason: polygon.inside ? 'plane, polygon, and normal compatible' : 'within bounded patch edge tolerance' }
}

/** Resolves a measured world point against real M7.4 patch planes and polygons. */
export function associateRealityPoint(
  point: SpatialPoint,
  normal: SpatialPoint | null,
  patches: readonly RoomSurfacePatch[],
  planeTolerance = HIT_PLANE_TOLERANCE_METERS,
): RealityStructuralAssociation {
  const candidates: RealityStructuralAssociationCandidate[] = []
  let best: RealityStructuralAssociation | null = null
  for (const patch of patches) {
    const candidate = candidateAssociation(point, normal, patch, planeTolerance)
    candidates.push({ surfaceId: patch.id, role: patch.role, planeDistanceMeters: candidate.planeDistanceMeters, insidePatch: candidate.insidePatch, withinEdgeTolerance: candidate.withinEdgeTolerance, normalCompatibility: candidate.normalCompatibility, accepted: candidate.strength !== 'none' })
    if (candidate.strength === 'none') continue
    const withCandidates = { ...candidate, candidates }
    if (!best || candidate.confidence > best.confidence ||
      (candidate.confidence === best.confidence && (candidate.planeDistanceMeters ?? Infinity) < (best.planeDistanceMeters ?? Infinity))) best = withCandidates
  }
  return best ? { ...best, candidates } : { strength: 'none', surfaceId: null, role: null, planeDistanceMeters: null, insidePatch: false, withinEdgeTolerance: false, normalCompatibility: null, confidence: 0, reason: 'no structural patch is sufficiently compatible', candidates }
}

/** Conservative post-analysis map. It is derived data, never Reality snapshot state. */
export function associateRealitySurfels(
  surfels: readonly FinalizedRealitySurfel[],
  patches: readonly RoomSurfacePatch[],
): RealityStructuralAssociationTable {
  const started = timestamp()
  const surfaceIds = patches.map((patch) => patch.id)
  const surfaceIndices = new Int32Array(surfels.length).fill(-1)
  let associatedSampleCount = 0, preservedForegroundSampleCount = 0, rejectedSampleCount = 0
  for (let index = 0; index < surfels.length; index++) {
    const surfel = surfels[index]
    // The narrower band is deliberately more conservative than tap matching:
    // a curtain/furniture surface offset from the wall stays original Reality RGB.
    const association = associateRealityPoint(surfel.position, surfel.normal, patches, WALL_SAMPLE_PLANE_BAND_METERS)
    if (association.strength === 'strong' && association.surfaceId) {
      surfaceIndices[index] = surfaceIds.indexOf(association.surfaceId)
      associatedSampleCount++
    } else if (patches.some((patch) => {
      const polygon = polygonStatus(localPoint(surfel.position, patch), patch)
      return polygon.inside || polygon.edgeDistance <= PATCH_EDGE_TOLERANCE_METERS
    })) {
      preservedForegroundSampleCount++
    } else {
      rejectedSampleCount++
    }
  }
  return { surfaceIndices, surfaceIds, associatedSampleCount, preservedForegroundSampleCount, rejectedSampleCount, elapsedMs: timestamp() - started }
}

function srgbToLinear(value: number): number {
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
}

function hexToLinearRgb(hex: string): RealityRgbColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return { r: srgbToLinear(((value >> 16) & 255) / 255), g: srgbToLinear(((value >> 8) & 255) / 255), b: srgbToLinear((value & 255) / 255) }
}

/** Returns linear display colors; original fused RGB is never modified. */
export function buildRealityDesignColors(
  surfels: readonly FinalizedRealitySurfel[],
  table: RealityStructuralAssociationTable,
  paintInputs: readonly RealityDesignColorInput[],
): Map<number, RealityRgbColor> {
  const paints = new Map(paintInputs.map((input) => [input.surfaceId, hexToLinearRgb(input.paintColor)]))
  const output = new Map<number, RealityRgbColor>()
  for (let index = 0; index < surfels.length; index++) {
    const surfaceIndex = table.surfaceIndices[index]
    const paint = surfaceIndex >= 0 ? paints.get(table.surfaceIds[surfaceIndex]) : null
    const original = surfels[index].colorRgb
    if (!paint || !original) continue
    const originalLinear = { r: srgbToLinear(original.r), g: srgbToLinear(original.g), b: srgbToLinear(original.b) }
    const sourceLuminance = originalLinear.r * .2126 + originalLinear.g * .7152 + originalLinear.b * .0722
    const paintLuminance = Math.max(.04, paint.r * .2126 + paint.g * .7152 + paint.b * .0722)
    const shading = Math.max(.38, Math.min(1.55, sourceLuminance / paintLuminance))
    output.set(surfels[index].id, { r: Math.min(1, paint.r * shading), g: Math.min(1, paint.g * shading), b: Math.min(1, paint.b * shading) })
  }
  return output
}

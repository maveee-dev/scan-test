import type { RoomSurfacePatch, RoomSurfacePatchRole } from '../../room-analysis/types'
import type { FinalizedRealitySurfel, FinalizedSurfaceSurfel, RealityRgbColor, SpatialPoint } from '../types'
import {
  groupPatchesIntoLogicalSurfaces,
  type LogicalStructuralSurface,
} from './logicalSurfaceService'

export { groupPatchesIntoLogicalSurfaces, type LogicalStructuralSurface }

export type RealityStructuralAssociationStrength = 'strong' | 'partial' | 'none'

export type RealityWallMembership = 'core-wall-member' | 'expanded-wall-member' | 'non-wall' | 'uncertain'

/**
 * Membership codes deliberately stay compact because they are produced in the
 * post-scan worker for up to 60,000 dense Reality samples.
 */
export const RealityMembershipCode = {
  NON_WALL: 0,
  CORE_WALL_MEMBER: 1,
  UNCERTAIN: 2,
  EXPANDED_WALL_MEMBER: 3,
} as const

export function isPaintableRealityMembership(membership: number): boolean {
  return membership === RealityMembershipCode.CORE_WALL_MEMBER ||
    membership === RealityMembershipCode.EXPANDED_WALL_MEMBER
}

export type RealityMembershipRejectionReason =
  | 'no trusted seed nearby'
  | 'outside member patch extent'
  | 'plane residual too high'
  | 'plane normal mismatch'
  | 'predecessor normal mismatch'
  | 'depth-step rejection'
  | 'neighbor-distance rejection'
  | 'unreachable from seed'
  | 'conflicting logical surface'
  | 'insufficient local support'
  | 'foreground evidence'
  | 'other'

export interface RealityMembershipDistribution {
  readonly median: number | null
  readonly p75: number | null
  readonly p90: number | null
  readonly p95: number | null
}

export interface LogicalSurfaceMembershipDiagnostics {
  readonly logicalSurfaceId: string
  readonly role: RoomSurfacePatchRole
  readonly memberPatchCount: number
  readonly candidateSampleCount: number
  readonly coreMemberCount: number
  readonly expandedMemberCount: number
  readonly totalPaintableCount: number
  readonly uncertainCount: number
  readonly nonWallCount: number
  readonly rejectionCounts: Readonly<Record<RealityMembershipRejectionReason, number>>
  readonly planeResidualMeters: RealityMembershipDistribution
  readonly normalAngleDegrees: RealityMembershipDistribution
  readonly neighborDepthStepMeters: RealityMembershipDistribution
  readonly expansionPlaneResidualMeters: number
  readonly expansionMinimumLocalNormalDot: number
  readonly expansionMaximumDepthStepMeters: number
  readonly expansionNeighborRadiusMeters: number
  readonly seedPassMs: number
  readonly localEvidenceMs: number
  readonly regionGrowthMs: number
  readonly finalizationMs: number
}

export type RealityDebugColorMode = 'none' | 'patch' | 'logical-wall' | 'wall-mask'

export interface RealityStructuralAssociationCandidate {
  readonly surfaceId: string
  readonly role: RoomSurfacePatchRole
  readonly planeDistanceMeters: number | null
  readonly insidePatch: boolean
  readonly withinEdgeTolerance: boolean
  readonly normalCompatibility: number | null
  readonly accepted: boolean
}

export interface RealityStructuralAssociation {
  readonly strength: RealityStructuralAssociationStrength
  readonly surfaceId: string | null
  readonly role: RoomSurfacePatchRole | null
  readonly planeDistanceMeters: number | null
  readonly insidePatch: boolean
  readonly withinEdgeTolerance: boolean
  readonly normalCompatibility: number | null
  readonly confidence: number
  readonly reason: string
  readonly candidates: readonly RealityStructuralAssociationCandidate[]
}

export interface RealityTapHitEvaluation {
  readonly hitPosition: SpatialPoint
  readonly vertexSampleIds: readonly number[]
  readonly membershipVotes: {
    readonly wallMember: number
    readonly nonWall: number
    readonly uncertain: number
  }
  readonly logicalSurfaceId: string | null
  readonly role: RoomSurfacePatchRole | null
  readonly confidence: number
  readonly accepted: boolean
  readonly reason: string
  readonly candidates: readonly RealityStructuralAssociationCandidate[]
}

export interface RealityStructuralAssociationTable {
  /** 0 = non-wall, 1 = strict core, 2 = uncertain, 3 = expanded wall-member */
  readonly memberships: Uint8Array
  /** Compact world positions used only for conservative post-scan tap membership lookup. */
  readonly samplePositions: Float32Array
  /** Index into logicalSurfaces array; -1 is unassigned/non-wall */
  readonly logicalSurfaceIndices: Int32Array
  readonly logicalSurfaces: readonly LogicalStructuralSurface[]
  /** Index into patches array; -1 is unassigned */
  readonly patchIndices: Int32Array
  readonly patches: readonly RoomSurfacePatch[]
  /** Backward compatibility aliases matching previous M8.5 interface */
  readonly surfaceIndices: Int32Array
  readonly surfaceIds: readonly string[]
  readonly associatedSampleCount: number
  readonly preservedForegroundSampleCount: number
  readonly rejectedSampleCount: number
  readonly wallMemberCount: number
  readonly coreWallMemberCount: number
  readonly expandedWallMemberCount: number
  readonly nonWallCount: number
  readonly uncertainCount: number
  readonly candidateCount: number
  readonly perLogicalSurface: readonly LogicalSurfaceMembershipDiagnostics[]
  readonly seedPassMs: number
  readonly neighborIndexMs: number
  readonly regionGrowthMs: number
  readonly classificationFinalizationMs: number
  readonly elapsedMs: number
}

export interface RealityDesignColorInput {
  readonly surfaceId: string
  readonly paintColor: string
}

const HIT_PLANE_TOLERANCE_METERS = 0.05
const PATCH_EDGE_TOLERANCE_METERS = 0.025
const MIN_NORMAL_COMPATIBILITY = 0.65
const EPSILON = 1e-8

// Conservative wall membership constants
const SEED_MAX_PLANE_RESIDUAL_METERS = 0.018
const SEED_MIN_NORMAL_DOT = 0.85
const SEED_MAX_STRUCTURAL_SUPPORT_DISTANCE_METERS = 0.12

// The strict seed values above are intentionally unchanged from M8.5.1.
// Expansion values are calibrated per logical surface from strict-core local
// measurements and are clamped to these safe, orientation-independent bounds.
const CANDIDATE_MAX_PLANE_RESIDUAL_METERS = 0.065
const CLEAR_FOREGROUND_PLANE_OFFSET_METERS = 0.04
const EXPANSION_MIN_PLANE_RESIDUAL_METERS = 0.025
const EXPANSION_MAX_PLANE_RESIDUAL_METERS = 0.04
const EXPANSION_MIN_LOCAL_NORMAL_DOT = 0.68
const EXPANSION_MAX_LOCAL_NORMAL_DOT = 0.82
const EXPANSION_MIN_DEPTH_STEP_METERS = 0.012
const EXPANSION_MAX_DEPTH_STEP_METERS = 0.022
const EXPANSION_MIN_NEIGHBOR_RADIUS_METERS = 0.045
const EXPANSION_MAX_NEIGHBOR_RADIUS_METERS = 0.07
const MAX_LOCAL_NEIGHBORS = 28
const MAX_GROW_ATTEMPTS = 4

function timestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function planeSignedDistance(point: SpatialPoint, normal: SpatialPoint, planeConstant: number): number {
  return normal.x * point.x + normal.y * point.y + normal.z * point.z - planeConstant
}

function pointDistanceSquared(first: SpatialPoint, second: SpatialPoint): number {
  const dx = first.x - second.x
  const dy = first.y - second.y
  const dz = first.z - second.z
  return dx * dx + dy * dy + dz * dz
}

function normalized(point: SpatialPoint): SpatialPoint | null {
  const length = Math.hypot(point.x, point.y, point.z)
  return length > EPSILON ? { x: point.x / length, y: point.y / length, z: point.z / length } : null
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((first, second) => first - second)
  const position = clamp(quantile, 0, 1) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function distribution(values: readonly number[]): RealityMembershipDistribution {
  return {
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
  }
}

function normalAngleDegrees(normalDot: number): number {
  return Math.acos(clamp(normalDot, -1, 1)) * 180 / Math.PI
}

const REJECTION_REASONS: readonly RealityMembershipRejectionReason[] = [
  'no trusted seed nearby',
  'outside member patch extent',
  'plane residual too high',
  'plane normal mismatch',
  'predecessor normal mismatch',
  'depth-step rejection',
  'neighbor-distance rejection',
  'unreachable from seed',
  'conflicting logical surface',
  'insufficient local support',
  'foreground evidence',
  'other',
]

function emptyRejectionCounts(): Record<RealityMembershipRejectionReason, number> {
  return Object.fromEntries(REJECTION_REASONS.map((reason) => [reason, 0])) as Record<RealityMembershipRejectionReason, number>
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

export function polygonStatus(point: { u: number; v: number }, patch: RoomSurfacePatch): { inside: boolean; edgeDistance: number } {
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
    0.25 * (polygon.inside ? 1 : 0.6) +
    0.20 * (normalCompatibility ?? 0.8),
  ))
  return { strength: confidence >= 0.72 && polygon.inside ? 'strong' : 'partial', surfaceId: patch.id, role: patch.role, planeDistanceMeters: planeDistance, insidePatch: polygon.inside, withinEdgeTolerance, normalCompatibility, confidence, reason: polygon.inside ? 'plane, polygon, and normal compatible' : 'within bounded patch edge tolerance' }
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

/**
 * Robust evaluation of a Reality raycast hit against the precomputed wall-membership table.
 * When hitting a triangle mesh, uses majority/agreement voting across the triangle's 3 vertices.
 * Avoids cross-boundary triangles and foreground objects (e.g. curtains) becoming selectable walls.
 */
function classifyPointMembership(
  point: SpatialPoint,
  normal: SpatialPoint | null,
  logicalSurfaces: readonly LogicalStructuralSurface[],
  patches: readonly RoomSurfacePatch[],
): { logicalSurface: LogicalStructuralSurface | null; role: RoomSurfacePatchRole | null; status: 'wall-member' | 'uncertain' | 'non-wall'; planeDistance: number; confidence: number } {
  let bestLogical: LogicalStructuralSurface | null = null
  let bestRole: RoomSurfacePatchRole | null = null
  let bestDist = Infinity
  let isInside = false
  let isNearEdge = false
  let bestConfidence = 0

  for (const logical of logicalSurfaces) {
    const repNormal = logical.representativeNormal
    const planeDistance = Math.abs(
      repNormal.x * point.x +
      repNormal.y * point.y +
      repNormal.z * point.z -
      logical.representativePlaneConstant,
    )
    if (planeDistance > 0.045) continue

    const normalComp = normal ? normalizedDot(normal, repNormal) : null
    if (normalComp !== null && normalComp < MIN_NORMAL_COMPATIBILITY) continue

    for (const patchId of logical.memberPatchIds) {
      const patch = patches.find((p) => p.id === patchId)
      if (!patch) continue
      const polygon = polygonStatus(localPoint(point, patch), patch)
      if (polygon.inside) {
        if (planeDistance < bestDist) {
          bestDist = planeDistance
          bestLogical = logical
          bestRole = logical.role
          isInside = true
          isNearEdge = true
          bestConfidence = Math.max(0, Math.min(1,
            0.55 * (1 - planeDistance / 0.04) +
            0.25 * 1.0 +
            0.20 * (normalComp ?? 0.8),
          ))
        }
      } else if (polygon.edgeDistance <= PATCH_EDGE_TOLERANCE_METERS && planeDistance < bestDist) {
        bestDist = planeDistance
        bestLogical = logical
        bestRole = logical.role
        isNearEdge = true
        bestConfidence = Math.max(0, Math.min(1,
          0.55 * (1 - planeDistance / 0.04) +
          0.25 * 0.6 +
          0.20 * (normalComp ?? 0.8),
        ))
      }
    }
  }

  if (bestLogical && isInside && bestDist <= 0.03) {
    return { logicalSurface: bestLogical, role: bestRole, status: 'wall-member', planeDistance: bestDist, confidence: bestConfidence }
  }
  if (bestLogical && (isNearEdge || bestDist <= 0.04)) {
    return { logicalSurface: bestLogical, role: bestRole, status: 'uncertain', planeDistance: bestDist, confidence: bestConfidence }
  }
  return { logicalSurface: null, role: null, status: 'non-wall', planeDistance: bestDist, confidence: 0 }
}

/**
 * Robust evaluation of a Reality raycast hit against the precomputed wall-membership table.
 * When hitting a triangle mesh, uses majority/agreement voting across the triangle's 3 vertices.
 * Avoids cross-boundary triangles and foreground objects (e.g. curtains) becoming selectable walls.
 */
export function evaluateRealityTapHit(
  hitPoint: SpatialPoint,
  hitNormal: SpatialPoint | null,
  vertexPositions: readonly SpatialPoint[] | null,
  table: RealityStructuralAssociationTable,
): RealityTapHitEvaluation {
  const candidates: RealityStructuralAssociationCandidate[] = []

  // Evaluate candidate logical surfaces for diagnostic reporting
  for (const logicalSurface of table.logicalSurfaces) {
    const repNormal = logicalSurface.representativeNormal
    const planeDistance = Math.abs(repNormal.x * hitPoint.x + repNormal.y * hitPoint.y + repNormal.z * hitPoint.z - logicalSurface.representativePlaneConstant)
    const normalComp = hitNormal ? normalizedDot(hitNormal, repNormal) : null

    let insideMemberPatch = false
    let withinEdgeTolerance = false
    for (const patchId of logicalSurface.memberPatchIds) {
      const patch = table.patches.find((p) => p.id === patchId)
      if (!patch) continue
      const polygon = polygonStatus(localPoint(hitPoint, patch), patch)
      if (polygon.inside) {
        insideMemberPatch = true
        withinEdgeTolerance = true
        break
      }
      if (polygon.edgeDistance <= PATCH_EDGE_TOLERANCE_METERS) {
        withinEdgeTolerance = true
      }
    }

    candidates.push({
      surfaceId: logicalSurface.id,
      role: logicalSurface.role,
      planeDistanceMeters: planeDistance,
      insidePatch: insideMemberPatch,
      withinEdgeTolerance,
      normalCompatibility: normalComp,
      accepted: planeDistance <= HIT_PLANE_TOLERANCE_METERS && (insideMemberPatch || withinEdgeTolerance) && (normalComp === null || normalComp >= MIN_NORMAL_COMPATIBILITY),
    })
  }

  const membershipAtPosition = (position: SpatialPoint): { membership: number; logicalIndex: number; distanceSquared: number } | null => {
    const maximumDistanceSquared = 0.06 ** 2
    let bestIndex = -1
    let bestDistanceSquared = maximumDistanceSquared
    for (let index = 0; index < table.memberships.length; index++) {
      const dx = table.samplePositions[index * 3] - position.x
      const dy = table.samplePositions[index * 3 + 1] - position.y
      const dz = table.samplePositions[index * 3 + 2] - position.z
      const distanceSquared = dx * dx + dy * dy + dz * dz
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared
        bestIndex = index
      }
    }
    return bestIndex >= 0
      ? { membership: table.memberships[bestIndex], logicalIndex: table.logicalSurfaceIndices[bestIndex], distanceSquared: bestDistanceSquared }
      : null
  }

  const classifyTapPosition = (position: SpatialPoint): { status: 'wall-member' | 'uncertain' | 'non-wall'; logicalSurface: LogicalStructuralSurface | null; role: RoomSurfacePatchRole | null; confidence: number } => {
    // A tap that lands on a measured component materially offset from an
    // actual patch plane is foreground even if the nearest wall sample is
    // spatially close (for example, a curtain 4–8 cm in front of a wall).
    for (const logicalSurface of table.logicalSurfaces) {
      const planeDistance = Math.abs(planeSignedDistance(position, logicalSurface.representativeNormal, logicalSurface.representativePlaneConstant))
      if (planeDistance <= CLEAR_FOREGROUND_PLANE_OFFSET_METERS) continue
      for (const patchId of logicalSurface.memberPatchIds) {
        const patch = table.patches.find((candidate) => candidate.id === patchId)
        if (!patch) continue
        const polygon = polygonStatus(localPoint(position, patch), patch)
        if (polygon.inside || polygon.edgeDistance <= PATCH_EDGE_TOLERANCE_METERS) {
          return { status: 'non-wall', logicalSurface: null, role: null, confidence: 0 }
        }
      }
    }
    const membership = membershipAtPosition(position)
    if (membership) {
      const logicalSurface = membership.logicalIndex >= 0 ? table.logicalSurfaces[membership.logicalIndex] ?? null : null
      if (logicalSurface && isPaintableRealityMembership(membership.membership)) {
        return { status: 'wall-member', logicalSurface, role: logicalSurface.role, confidence: membership.membership === RealityMembershipCode.CORE_WALL_MEMBER ? 0.94 : 0.82 }
      }
      if (membership.membership === RealityMembershipCode.UNCERTAIN) {
        return { status: 'uncertain', logicalSurface, role: logicalSurface?.role ?? null, confidence: 0.35 }
      }
      // A nearby measured NON_WALL sample is stronger foreground evidence than
      // a fresh plane-only hit test, so keep it conservatively rejected.
      if (membership.distanceSquared <= 0.035 ** 2) {
        return { status: 'non-wall', logicalSurface: null, role: null, confidence: 0 }
      }
    }
    const direct = classifyPointMembership(position, hitNormal, table.logicalSurfaces, table.patches)
    return {
      status: direct.status,
      logicalSurface: direct.logicalSurface,
      role: direct.role,
      confidence: direct.confidence,
    }
  }

  const hitClassification = classifyTapPosition(hitPoint)

  let wallMemberVotes = 0
  let nonWallVotes = 0
  let uncertainVotes = 0

  if (vertexPositions && vertexPositions.length === 3) {
    // Classify all 3 triangle vertices
    const vertexClassifications = vertexPositions.map(classifyTapPosition)
    for (const vc of vertexClassifications) {
      if (vc.status === 'wall-member') wallMemberVotes++
      else if (vc.status === 'uncertain') uncertainVotes++
      else nonWallVotes++
    }
  } else {
    // Single-point fallback
    if (hitClassification.status === 'wall-member') {
      wallMemberVotes = 3
    } else if (hitClassification.status === 'uncertain') {
      wallMemberVotes = 1
      uncertainVotes = 2
    } else {
      nonWallVotes = 3
    }
  }

  let accepted = false
  let reason = 'no structural surface detected at tap'
  let targetLogicalId: string | null = null
  let targetRole: RoomSurfacePatchRole | null = null
  let confidence = 0

  // Decision logic based on majority voting and conservative object rejection
  if (wallMemberVotes < 2) {
    accepted = false
    reason = `Tap rejected: foreground object detected (${nonWallVotes} of 3 triangle vertices classified non-wall)`
  } else if (hitClassification.status === 'non-wall') {
    accepted = false
    reason = 'Tap rejected: tap hit is foreground object in front of wall'
  } else if (hitClassification.status === 'uncertain') {
    accepted = false
    reason = 'Tap rejected: tap hit is in an uncertain boundary region'
  } else {
    // Wall-member accepted with high confidence
    accepted = true
    targetLogicalId = hitClassification.logicalSurface?.id ?? null
    targetRole = hitClassification.role
    confidence = hitClassification.confidence
    reason = `Hit matched ${targetLogicalId} with ${(confidence * 100).toFixed(0)}% confidence`
  }

  return {
    hitPosition: hitPoint,
    vertexSampleIds: [],
    membershipVotes: {
      wallMember: wallMemberVotes,
      nonWall: nonWallVotes,
      uncertain: uncertainVotes,
    },
    logicalSurfaceId: targetLogicalId,
    role: targetRole,
    confidence,
    accepted,
    reason,
    candidates,
  }
}

/**
 * 3D spatial grid helper for fast neighbor queries during region growth.
 */
class SpatialGrid3D {
  private readonly cellSize: number
  private readonly cells = new Map<string, number[]>()

  constructor(cellSize: number) {
    this.cellSize = cellSize
  }

  private key(x: number, y: number, z: number): string {
    const ix = Math.floor(x / this.cellSize)
    const iy = Math.floor(y / this.cellSize)
    const iz = Math.floor(z / this.cellSize)
    return `${ix},${iy},${iz}`
  }

  public insert(index: number, position: SpatialPoint): void {
    const k = this.key(position.x, position.y, position.z)
    const list = this.cells.get(k)
    if (list) {
      list.push(index)
    } else {
      this.cells.set(k, [index])
    }
  }

  public query(position: SpatialPoint, radius: number, limit = Number.POSITIVE_INFINITY): number[] {
    const result: number[] = []
    const minX = Math.floor((position.x - radius) / this.cellSize)
    const maxX = Math.floor((position.x + radius) / this.cellSize)
    const minY = Math.floor((position.y - radius) / this.cellSize)
    const maxY = Math.floor((position.y + radius) / this.cellSize)
    const minZ = Math.floor((position.z - radius) / this.cellSize)
    const maxZ = Math.floor((position.z + radius) / this.cellSize)

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const list = this.cells.get(`${x},${y},${z}`)
          if (!list) continue
          for (const idx of list) {
            result.push(idx)
            if (result.length >= limit) return result
          }
        }
      }
    }
    return result
  }
}

/**
 * M8.5.2 structural membership pass.
 *
 * Strict M8.5.1 seeds remain precision anchors. This pass intentionally
 * separates those anchors from a bounded, local, multi-neighbor expansion so
 * noisy depth normals do not turn genuine observed walls/ceilings into the
 * default NON_WALL state. It runs only after Finish in the association worker.
 */
export function associateRealitySurfels(
  surfels: readonly FinalizedRealitySurfel[],
  patches: readonly RoomSurfacePatch[],
  structuralSurfels?: readonly FinalizedSurfaceSurfel[],
): RealityStructuralAssociationTable {
  const started = timestamp()
  const logicalSurfaces = groupPatchesIntoLogicalSurfaces(patches)
  const patchIds = patches.map((p) => p.id)
  const n = surfels.length
  const memberships = new Uint8Array(n)
  const samplePositions = new Float32Array(n * 3)
  for (let index = 0; index < n; index++) {
    const position = surfels[index].position
    samplePositions[index * 3] = position.x
    samplePositions[index * 3 + 1] = position.y
    samplePositions[index * 3 + 2] = position.z
  }
  const logicalSurfaceIndices = new Int32Array(n).fill(-1)
  const patchIndices = new Int32Array(n).fill(-1)

  if (patches.length === 0 || surfels.length === 0) {
    return {
      memberships,
      samplePositions,
      logicalSurfaceIndices,
      logicalSurfaces,
      patchIndices,
      patches,
      surfaceIndices: patchIndices,
      surfaceIds: patchIds,
      associatedSampleCount: 0,
      preservedForegroundSampleCount: 0,
      rejectedSampleCount: n,
      wallMemberCount: 0,
      coreWallMemberCount: 0,
      expandedWallMemberCount: 0,
      nonWallCount: n,
      uncertainCount: 0,
      candidateCount: 0,
      perLogicalSurface: [],
      seedPassMs: 0,
      neighborIndexMs: 0,
      regionGrowthMs: 0,
      classificationFinalizationMs: 0,
      elapsedMs: timestamp() - started,
    }
  }

  const neighborIndexStarted = timestamp()
  const structuralSupportGridByLogical = new Map<string, SpatialGrid3D>()
  if (structuralSurfels && structuralSurfels.length > 0) {
    for (const logicalSurface of logicalSurfaces) {
      const grid = new SpatialGrid3D(0.1)
      let count = 0
      for (let sIdx = 0; sIdx < structuralSurfels.length; sIdx++) {
        const s = structuralSurfels[sIdx]
        const dist = Math.abs(planeSignedDistance(s.position, logicalSurface.representativeNormal, logicalSurface.representativePlaneConstant))
        const nDot = normalizedDot(s.normal, logicalSurface.representativeNormal) ?? 0
        if (dist <= 0.08 && nDot >= 0.65) {
          grid.insert(sIdx, s.position)
          count++
        }
      }
      if (count > 0) {
        structuralSupportGridByLogical.set(logicalSurface.id, grid)
      }
    }
  }

  const denseGrid = new SpatialGrid3D(EXPANSION_MIN_NEIGHBOR_RADIUS_METERS)
  for (let i = 0; i < n; i++) {
    denseGrid.insert(i, surfels[i].position)
  }
  const neighborIndexMs = timestamp() - neighborIndexStarted

  let candidateCount = 0
  let seedPassMs = 0
  let regionGrowthMs = 0
  let classificationFinalizationMs = 0
  const foregroundEvidence = new Uint8Array(n)
  const perLogicalSurface: LogicalSurfaceMembershipDiagnostics[] = []

  // A later logical surface is allowed to replace an UNCERTAIN earlier
  // candidate, but never to steal a strict/expanded result without recording
  // a conflict. This protects corners and overlapping patch edge tolerance.
  for (let lIdx = 0; lIdx < logicalSurfaces.length; lIdx++) {
    const logical = logicalSurfaces[lIdx]
    const memberPatches = patches.filter((p) => logical.memberPatchIds.includes(p.id))
    const structuralGrid = structuralSupportGridByLogical.get(logical.id)
    const seedIndices: number[] = []
    const seedMask = new Uint8Array(n)
    const candidateState = new Uint8Array(n) // 0=outside, 1=plausible, 2=clear foreground/residual
    const matchingPatchForSample = new Int32Array(n).fill(-1)
    const planeResiduals = new Float32Array(n)
    const rawNormalDots = new Float32Array(n)
    const failureFlags = new Uint16Array(n)
    const residualDistributionInput: number[] = []
    const normalAngleDistributionInput: number[] = []
    const coreResiduals: number[] = []
    const coreNeighborSteps: number[] = []
    const coreNeighborDistances: number[] = []
    const rejectionCounts = emptyRejectionCounts()
    let candidateSampleCount = 0
    let positiveNonWallCandidateCount = 0

    const seedPassStarted = timestamp()
    for (let i = 0; i < n; i++) {
      const surfel = surfels[i]
      const signedOffset = planeSignedDistance(surfel.position, logical.representativeNormal, logical.representativePlaneConstant)
      const planeDistance = Math.abs(signedOffset)
      const normalComp = surfel.normal ? (normalizedDot(surfel.normal, logical.representativeNormal) ?? 0) : 0
      let bestPatchIdx = -1
      let insideAny = false
      let withinEdgeAny = false
      for (let pIdx = 0; pIdx < memberPatches.length; pIdx++) {
        const patch = memberPatches[pIdx]
        const polygon = polygonStatus(localPoint(surfel.position, patch), patch)
        if (polygon.inside) {
          insideAny = true
          withinEdgeAny = true
          bestPatchIdx = patches.indexOf(patch)
          break
        }
        if (polygon.edgeDistance <= PATCH_EDGE_TOLERANCE_METERS) {
          withinEdgeAny = true
          if (bestPatchIdx === -1) {
            bestPatchIdx = patches.indexOf(patch)
          }
        }
      }
      if (!withinEdgeAny) {
        if (planeDistance <= CANDIDATE_MAX_PLANE_RESIDUAL_METERS) {
          rejectionCounts['outside member patch extent']++
        }
        continue
      }

      // This is the logical surface's *union* domain. Individual M7.4 member
      // patches remain immutable; their observed extents are simply evaluated
      // together for propagation over a fragmented physical wall.
      if (planeDistance > CANDIDATE_MAX_PLANE_RESIDUAL_METERS) {
        rejectionCounts['plane residual too high']++
        continue
      }

      candidateSampleCount++
      candidateCount++
      matchingPatchForSample[i] = bestPatchIdx
      planeResiduals[i] = planeDistance
      rawNormalDots[i] = normalComp
      residualDistributionInput.push(planeDistance)
      if (normalComp > 0) normalAngleDistributionInput.push(normalAngleDegrees(normalComp))

      // A substantial offset inside the patch is positive evidence of a
      // foreground/background component, not merely failed wall proof.
      if (planeDistance > CLEAR_FOREGROUND_PLANE_OFFSET_METERS) {
        candidateState[i] = 2
        foregroundEvidence[i] = 1
        positiveNonWallCandidateCount++
        rejectionCounts['foreground evidence']++
        continue
      }
      candidateState[i] = 1

      // Strict seed definition is intentionally the M8.5.1 definition.
      const isStrictSeedGeometry = planeDistance <= SEED_MAX_PLANE_RESIDUAL_METERS &&
        normalComp >= SEED_MIN_NORMAL_DOT && insideAny
      let hasStructuralSupport = true
      if (structuralGrid) {
        hasStructuralSupport = structuralGrid.query(surfel.position, SEED_MAX_STRUCTURAL_SUPPORT_DISTANCE_METERS, 1).length > 0
      }
      if (isStrictSeedGeometry && hasStructuralSupport) {
        seedIndices.push(i)
        seedMask[i] = 1
        coreResiduals.push(planeDistance)
      } else if (!isStrictSeedGeometry && normalComp < MIN_NORMAL_COMPATIBILITY) {
        failureFlags[i] |= 1
      }
    }
    const thisSeedPassMs = timestamp() - seedPassStarted
    seedPassMs += thisSeedPassMs

    // Derive expansion limits from local strict-core measurements. The clamps
    // prevent a small/noisy scan from silently becoming an overly broad mask.
    for (const seedIdx of seedIndices) {
      const seed = surfels[seedIdx]
      const neighbors = denseGrid.query(seed.position, EXPANSION_MAX_NEIGHBOR_RADIUS_METERS, MAX_LOCAL_NEIGHBORS)
      for (const neighborIdx of neighbors) {
        if (neighborIdx <= seedIdx || seedMask[neighborIdx] === 0) continue
        const distance = Math.sqrt(pointDistanceSquared(seed.position, surfels[neighborIdx].position))
        if (distance <= EPSILON || distance > EXPANSION_MAX_NEIGHBOR_RADIUS_METERS) continue
        coreNeighborDistances.push(distance)
        coreNeighborSteps.push(Math.abs(
          planeSignedDistance(surfels[neighborIdx].position, logical.representativeNormal, logical.representativePlaneConstant) -
          planeSignedDistance(seed.position, logical.representativeNormal, logical.representativePlaneConstant),
        ))
      }
    }
    const expansionPlaneResidual = clamp((percentile(coreResiduals, 0.9) ?? SEED_MAX_PLANE_RESIDUAL_METERS) * 1.9, EXPANSION_MIN_PLANE_RESIDUAL_METERS, EXPANSION_MAX_PLANE_RESIDUAL_METERS)
    const expansionNeighborRadius = clamp((percentile(coreNeighborDistances, 0.9) ?? EXPANSION_MIN_NEIGHBOR_RADIUS_METERS) * 1.55, EXPANSION_MIN_NEIGHBOR_RADIUS_METERS, EXPANSION_MAX_NEIGHBOR_RADIUS_METERS)
    const expansionMaximumDepthStep = clamp((percentile(coreNeighborSteps, 0.9) ?? 0.015) * 1.65, EXPANSION_MIN_DEPTH_STEP_METERS, EXPANSION_MAX_DEPTH_STEP_METERS)
    const normalDistribution = normalAngleDistributionInput.map((angle) => Math.cos(angle * Math.PI / 180))
    const expansionMinimumLocalNormalDot = clamp(percentile(normalDistribution, 0.15) ?? 0.78, EXPANSION_MIN_LOCAL_NORMAL_DOT, EXPANSION_MAX_LOCAL_NORMAL_DOT)

    // Robust local normal consensus lets a planar ceiling/wall cross isolated
    // depth-normal noise, without averaging across a discontinuity.
    const localEvidenceStarted = timestamp()
    const localNormalDots = new Float32Array(n)
    const localSupportCounts = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      if (candidateState[i] !== 1) continue
      const nearby = denseGrid.query(surfels[i].position, expansionNeighborRadius, MAX_LOCAL_NEIGHBORS)
      let sumX = 0, sumY = 0, sumZ = 0, support = 0
      for (const neighborIdx of nearby) {
        if (candidateState[neighborIdx] !== 1 || planeResiduals[neighborIdx] > expansionPlaneResidual) continue
        const normal = surfels[neighborIdx].normal
        if (!normal) continue
        const compatibility = normalizedDot(normal, logical.representativeNormal) ?? 0
        if (compatibility < 0.35) continue
        const orientation = normal.x * logical.representativeNormal.x + normal.y * logical.representativeNormal.y + normal.z * logical.representativeNormal.z < 0 ? -1 : 1
        sumX += normal.x * orientation
        sumY += normal.y * orientation
        sumZ += normal.z * orientation
        support++
      }
      const averaged = normalized({ x: sumX, y: sumY, z: sumZ })
      localNormalDots[i] = averaged ? (normalizedDot(averaged, logical.representativeNormal) ?? 0) : rawNormalDots[i]
      localSupportCounts[i] = Math.min(255, support)
    }
    const thisLocalEvidenceMs = timestamp() - localEvidenceStarted

    // Strict core membership is set before any growth. Core and expanded are
    // separate diagnostics but both are paintable in normal Design mode.
    for (const seedIdx of seedIndices) {
      if (memberships[seedIdx] !== RealityMembershipCode.NON_WALL && logicalSurfaceIndices[seedIdx] !== lIdx) continue
      memberships[seedIdx] = RealityMembershipCode.CORE_WALL_MEMBER
      logicalSurfaceIndices[seedIdx] = lIdx
      patchIndices[seedIdx] = matchingPatchForSample[seedIdx]
    }

    const growthStarted = timestamp()
    const queue = [...seedIndices]
    const growthAttempts = new Uint8Array(n)
    let head = 0
    while (head < queue.length) {
      const currentIndex = queue[head++]
      const current = surfels[currentIndex]
      const neighbors = denseGrid.query(current.position, expansionNeighborRadius, MAX_LOCAL_NEIGHBORS)
      for (const neighborIndex of neighbors) {
        if (neighborIndex === currentIndex || candidateState[neighborIndex] !== 1) continue
        if (isPaintableRealityMembership(memberships[neighborIndex])) continue
        if (memberships[neighborIndex] === RealityMembershipCode.UNCERTAIN && logicalSurfaceIndices[neighborIndex] !== -1 && logicalSurfaceIndices[neighborIndex] !== lIdx) {
          failureFlags[neighborIndex] |= 32
          continue
        }
        if (growthAttempts[neighborIndex] >= MAX_GROW_ATTEMPTS) continue
        growthAttempts[neighborIndex]++

        const neighbor = surfels[neighborIndex]
        const neighborDistance = Math.sqrt(pointDistanceSquared(neighbor.position, current.position))
        if (neighborDistance > expansionNeighborRadius || neighborDistance <= EPSILON) {
          failureFlags[neighborIndex] |= 16
          continue
        }
        if (planeResiduals[neighborIndex] > expansionPlaneResidual) {
          failureFlags[neighborIndex] |= 2
          continue
        }
        if (localNormalDots[neighborIndex] < expansionMinimumLocalNormalDot || localSupportCounts[neighborIndex] < 3) {
          failureFlags[neighborIndex] |= localSupportCounts[neighborIndex] < 3 ? 64 : 1
          continue
        }
        const depthStep = Math.abs(planeSignedDistance(neighbor.position, logical.representativeNormal, logical.representativePlaneConstant) - planeSignedDistance(current.position, logical.representativeNormal, logical.representativePlaneConstant))
        if (depthStep > expansionMaximumDepthStep) {
          failureFlags[neighborIndex] |= 8
          continue
        }
        const predecessorNormalDot = current.normal && neighbor.normal ? (normalizedDot(current.normal, neighbor.normal) ?? 0) : 1
        // An individual predecessor normal is noisy on mobile depth. It is a
        // barrier only when the local consensus on either side is also weak.
        if (predecessorNormalDot < 0.58 &&
          (localNormalDots[currentIndex] < expansionMinimumLocalNormalDot || localNormalDots[neighborIndex] < expansionMinimumLocalNormalDot)) {
          failureFlags[neighborIndex] |= 4
          continue
        }

        let supportingMembers = 0
        for (const supportIndex of denseGrid.query(neighbor.position, expansionNeighborRadius, MAX_LOCAL_NEIGHBORS)) {
          if (logicalSurfaceIndices[supportIndex] === lIdx && isPaintableRealityMembership(memberships[supportIndex])) supportingMembers++
        }
        const directCoreConnection = memberships[currentIndex] === RealityMembershipCode.CORE_WALL_MEMBER
        if (supportingMembers < 2 && !(directCoreConnection && localSupportCounts[neighborIndex] >= 4 && depthStep <= expansionMaximumDepthStep * 0.8)) {
          failureFlags[neighborIndex] |= 64
          continue
        }

        memberships[neighborIndex] = RealityMembershipCode.EXPANDED_WALL_MEMBER
        logicalSurfaceIndices[neighborIndex] = lIdx
        patchIndices[neighborIndex] = matchingPatchForSample[neighborIndex]
        queue.push(neighborIndex)
      }
    }
    const thisRegionGrowthMs = timestamp() - growthStarted
    regionGrowthMs += thisRegionGrowthMs

    const finalizationStarted = timestamp()
    for (let i = 0; i < n; i++) {
      if (candidateState[i] === 0) continue
      if (isPaintableRealityMembership(memberships[i]) && logicalSurfaceIndices[i] === lIdx) continue
      if (candidateState[i] === 2) {
        // Positive foreground evidence remains NON_WALL and is never painted.
        continue
      }
      if (isPaintableRealityMembership(memberships[i]) && logicalSurfaceIndices[i] !== lIdx) {
        rejectionCounts['conflicting logical surface']++
        continue
      }
      memberships[i] = RealityMembershipCode.UNCERTAIN
      logicalSurfaceIndices[i] = lIdx
      patchIndices[i] = matchingPatchForSample[i]
      const hasSeedNearby = denseGrid.query(surfels[i].position, expansionNeighborRadius * 2, MAX_LOCAL_NEIGHBORS)
        .some((index) => logicalSurfaceIndices[index] === lIdx && memberships[index] === RealityMembershipCode.CORE_WALL_MEMBER)
      if (!hasSeedNearby) rejectionCounts['no trusted seed nearby']++
      else if (failureFlags[i] & 2) rejectionCounts['plane residual too high']++
      else if (failureFlags[i] & 1) rejectionCounts['plane normal mismatch']++
      else if (failureFlags[i] & 4) rejectionCounts['predecessor normal mismatch']++
      else if (failureFlags[i] & 8) rejectionCounts['depth-step rejection']++
      else if (failureFlags[i] & 16) rejectionCounts['neighbor-distance rejection']++
      else if (failureFlags[i] & 32) rejectionCounts['conflicting logical surface']++
      else if (failureFlags[i] & 64) rejectionCounts['insufficient local support']++
      else rejectionCounts['unreachable from seed']++
    }

    let coreMemberCount = 0, expandedMemberCount = 0, uncertainCount = 0, nonWallCount = positiveNonWallCandidateCount
    for (let i = 0; i < n; i++) {
      if (logicalSurfaceIndices[i] !== lIdx) continue
      if (memberships[i] === RealityMembershipCode.CORE_WALL_MEMBER) coreMemberCount++
      else if (memberships[i] === RealityMembershipCode.EXPANDED_WALL_MEMBER) expandedMemberCount++
      else if (memberships[i] === RealityMembershipCode.UNCERTAIN) uncertainCount++
      else nonWallCount++
    }
    const thisFinalizationMs = timestamp() - finalizationStarted
    classificationFinalizationMs += thisFinalizationMs
    perLogicalSurface.push({
      logicalSurfaceId: logical.id,
      role: logical.role,
      memberPatchCount: memberPatches.length,
      candidateSampleCount,
      coreMemberCount,
      expandedMemberCount,
      totalPaintableCount: coreMemberCount + expandedMemberCount,
      uncertainCount,
      nonWallCount,
      rejectionCounts,
      planeResidualMeters: distribution(residualDistributionInput),
      normalAngleDegrees: distribution(normalAngleDistributionInput),
      neighborDepthStepMeters: distribution(coreNeighborSteps),
      expansionPlaneResidualMeters: expansionPlaneResidual,
      expansionMinimumLocalNormalDot,
      expansionMaximumDepthStepMeters: expansionMaximumDepthStep,
      expansionNeighborRadiusMeters: expansionNeighborRadius,
      seedPassMs: thisSeedPassMs,
      localEvidenceMs: thisLocalEvidenceMs,
      regionGrowthMs: thisRegionGrowthMs,
      finalizationMs: thisFinalizationMs,
    })
  }

  let coreWallMemberCount = 0
  let expandedWallMemberCount = 0
  let uncertainCount = 0
  let nonWallCount = 0
  let preservedForegroundCount = 0
  for (let i = 0; i < n; i++) {
    if (memberships[i] === RealityMembershipCode.CORE_WALL_MEMBER) {
      coreWallMemberCount++
    } else if (memberships[i] === RealityMembershipCode.EXPANDED_WALL_MEMBER) {
      expandedWallMemberCount++
    } else if (memberships[i] === RealityMembershipCode.UNCERTAIN) {
      uncertainCount++
    } else {
      nonWallCount++
    }
    if (foregroundEvidence[i] === 1) preservedForegroundCount++
  }
  const wallMemberCount = coreWallMemberCount + expandedWallMemberCount
  const elapsedMs = timestamp() - started
  return {
    memberships,
    samplePositions,
    logicalSurfaceIndices,
    logicalSurfaces,
    patchIndices,
    patches,
    // Backward compatibility aliases
    surfaceIndices: patchIndices,
    surfaceIds: patchIds,
    associatedSampleCount: wallMemberCount,
    preservedForegroundSampleCount: preservedForegroundCount,
    rejectedSampleCount: nonWallCount + uncertainCount,
    wallMemberCount,
    coreWallMemberCount,
    expandedWallMemberCount,
    nonWallCount,
    uncertainCount,
    candidateCount,
    perLogicalSurface,
    seedPassMs,
    neighborIndexMs,
    regionGrowthMs,
    classificationFinalizationMs,
    elapsedMs,
  }
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function hexToLinearRgb(hex: string): RealityRgbColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return { r: srgbToLinear(((value >> 16) & 255) / 255), g: srgbToLinear(((value >> 8) & 255) / 255), b: srgbToLinear((value & 255) / 255) }
}

// Distinct deterministic color palette for diagnostic visualization modes
const DIAGNOSTIC_PALETTE: readonly RealityRgbColor[] = [
  { r: 0.15, g: 0.55, b: 0.95 }, // Blue
  { r: 0.95, g: 0.45, b: 0.15 }, // Orange
  { r: 0.25, g: 0.85, b: 0.35 }, // Green
  { r: 0.85, g: 0.25, b: 0.85 }, // Magenta
  { r: 0.95, g: 0.85, b: 0.15 }, // Yellow
  { r: 0.25, g: 0.85, b: 0.85 }, // Cyan
  { r: 0.85, g: 0.35, b: 0.45 }, // Red-Pink
  { r: 0.55, g: 0.35, b: 0.95 }, // Purple
]

function getDiagnosticColor(index: number): RealityRgbColor {
  return DIAGNOSTIC_PALETTE[Math.abs(index) % DIAGNOSTIC_PALETTE.length]
}

/**
 * Returns linear display colors for Reality Preview.
 * Original fused camera RGB is NEVER modified.
 *
 * Supports:
 * - Normal Design mode: strict core and expanded wall-member samples receive
 *   paint with natural luminance preservation.
 * - Diagnostic modes (Part U):
 *   - 'patch': Color by M7.4 patch
 *   - 'logical-wall': Color by logical wall group
 *   - 'wall-mask': core = cyan, expanded = green, uncertain = amber,
 *     non-wall = dark red.
 */
export function buildRealityDesignColors(
  surfels: readonly FinalizedRealitySurfel[],
  table: RealityStructuralAssociationTable,
  paintInputs: readonly RealityDesignColorInput[],
  debugColorMode: RealityDebugColorMode = 'none',
): Map<number, RealityRgbColor> {
  const output = new Map<number, RealityRgbColor>()

  // Diagnostic mode: Wall-Membership Mask (Part U.3)
  if (debugColorMode === 'wall-mask') {
    const coreMemberColor: RealityRgbColor = { r: 0.1, g: 0.8, b: 0.96 } // Cyan
    const expandedMemberColor: RealityRgbColor = { r: 0.15, g: 0.88, b: 0.45 } // Green
    const uncertainColor: RealityRgbColor = { r: 0.95, g: 0.75, b: 0.1 }   // Amber / Yellow
    const nonWallColor: RealityRgbColor = { r: 0.65, g: 0.18, b: 0.18 }    // Dark Red
    for (let i = 0; i < surfels.length; i++) {
      const membership = table.memberships[i]
      output.set(surfels[i].id,
        membership === RealityMembershipCode.CORE_WALL_MEMBER ? coreMemberColor :
          membership === RealityMembershipCode.EXPANDED_WALL_MEMBER ? expandedMemberColor :
            membership === RealityMembershipCode.UNCERTAIN ? uncertainColor : nonWallColor,
      )
    }
    return output
  }

  // Diagnostic mode: Color by Logical Wall (Part U.2)
  if (debugColorMode === 'logical-wall') {
    for (let i = 0; i < surfels.length; i++) {
      const lIdx = table.logicalSurfaceIndices[i]
      if (isPaintableRealityMembership(table.memberships[i]) && lIdx >= 0) {
        output.set(surfels[i].id, getDiagnosticColor(lIdx))
      }
    }
    return output
  }

  // Diagnostic mode: Color by M7.4 Patch (Part U.1)
  if (debugColorMode === 'patch') {
    for (let i = 0; i < surfels.length; i++) {
      const pIdx = table.patchIndices[i]
      if (pIdx >= 0) {
        output.set(surfels[i].id, getDiagnosticColor(pIdx))
      }
    }
    return output
  }

  // Normal Design mode (Part S, T)
  const paintsBySurfaceId = new Map(paintInputs.map((input) => [input.surfaceId, hexToLinearRgb(input.paintColor)]))

  for (let index = 0; index < surfels.length; index++) {
    // Core + evidence-backed expanded samples are eligible. Uncertain and
    // non-wall samples always preserve their original captured RGB.
    if (!isPaintableRealityMembership(table.memberships[index])) {
      continue
    }

    const logicalIdx = table.logicalSurfaceIndices[index]
    const patchIdx = table.patchIndices[index]
    if (logicalIdx < 0 && patchIdx < 0) {
      continue
    }

    // Resolve paint color from logical surface ID or member patch ID
    let paint: RealityRgbColor | null = null
    if (logicalIdx >= 0 && logicalIdx < table.logicalSurfaces.length) {
      const logicalSurface = table.logicalSurfaces[logicalIdx]
      paint = paintsBySurfaceId.get(logicalSurface.id) ?? null
      if (!paint) {
        for (const memberId of logicalSurface.memberPatchIds) {
          const memberPaint = paintsBySurfaceId.get(memberId)
          if (memberPaint) {
            paint = memberPaint
            break
          }
        }
      }
    }
    if (!paint && patchIdx >= 0 && patchIdx < table.patches.length) {
      paint = paintsBySurfaceId.get(table.patches[patchIdx].id) ?? null
    }

    const original = surfels[index].colorRgb
    if (!paint || !original) continue

    // Natural luminance preservation
    const originalLinear = { r: srgbToLinear(original.r), g: srgbToLinear(original.g), b: srgbToLinear(original.b) }
    const sourceLuminance = originalLinear.r * 0.2126 + originalLinear.g * 0.7152 + originalLinear.b * 0.0722
    const paintLuminance = Math.max(0.04, paint.r * 0.2126 + paint.g * 0.7152 + paint.b * 0.0722)
    const shading = Math.max(0.38, Math.min(1.55, sourceLuminance / paintLuminance))
    output.set(surfels[index].id, {
      r: Math.min(1, paint.r * shading),
      g: Math.min(1, paint.g * shading),
      b: Math.min(1, paint.b * shading),
    })
  }

  return output
}

import type { FinalizedSpatialScan, SpatialPoint } from '../../scanner/types'
import type {
  RoomStructureInterpretationResult,
  RoomSurfaceBoundaryProvenance,
  RoomSurfaceConstructionResult,
  RoomSurfaceLocalPoint,
  RoomSurfacePatch,
  RoomSurfacePatchBoundary,
  RoomSurfacePatchCompletionStatus,
  RoomSurfacePatchRole,
  RoomSurfacePlaneBasis,
  RoomSurfaceConstraintClassification,
  RoomSurfaceConstraintDiagnostic,
  RoomSurfaceClipDiagnostic,
  RoomSurfaceSurfaceDiagnostic,
  RoomBoundaryResult,
  StructuralBoundaryEdge,
  StructuralBoundaryStatus,
  StructuralCorner,
  StructuralSurfaceCandidate,
} from '../types'
import {
  associateFinalizedSupportPoints,
  type SupportPlaneGeometry,
} from './structuralSupportGeometry'

export interface RoomSurfaceConstructionConfig {
  /** Residual used when associating finalized fused support with a selected plane. */
  maximumSupportPlaneResidualMeters: number
  /** Keep the same soft normal guard used by post-scan support validation. */
  minimumSupportNormalDot: number
  /** Margin used only for support association against final plane bounds. */
  supportBoundsPaddingMeters: number
  /** Robust support trimming used to avoid isolated extent outliers. */
  supportTrimFraction: number
  /** Local distance for removing duplicate polygon vertices. */
  vertexMergeToleranceMeters: number
  /** Local distance for recognizing a structural constraint on a polygon edge. */
  boundaryMatchToleranceMeters: number
  /** Smallest planar patch area retained as renderable geometry. */
  minimumPatchAreaMetersSquared: number
  /** Fraction of meaningful support that must survive a structural clip. */
  minimumRetainedSupportFraction: number
  /** Dominant-side ratio required before a line is treated as an exterior boundary. */
  minimumBoundarySideDominance: number
  /** Minimum opposing-side ratio that marks a line as internal or ambiguous. */
  maximumExteriorOpposingSideFraction: number
  /** Numerical tolerance used while clipping a polygon against a local line. */
  polygonClipEpsilonMeters: number
}

export const DEFAULT_ROOM_SURFACE_CONSTRUCTION_CONFIG: RoomSurfaceConstructionConfig = {
  maximumSupportPlaneResidualMeters: 0.12,
  minimumSupportNormalDot: 0.45,
  supportBoundsPaddingMeters: 0.2,
  supportTrimFraction: 0.05,
  vertexMergeToleranceMeters: 0.01,
  boundaryMatchToleranceMeters: 0.04,
  minimumPatchAreaMetersSquared: 0.01,
  minimumRetainedSupportFraction: 0.2,
  minimumBoundarySideDominance: 0.72,
  maximumExteriorOpposingSideFraction: 0.18,
  polygonClipEpsilonMeters: 1e-7,
}

interface LocalPoint extends RoomSurfaceLocalPoint {}

interface BoundaryConstraint {
  readonly id: string
  readonly start: LocalPoint
  readonly end: LocalPoint
  readonly worldStart: SpatialPoint
  readonly worldEnd: SpatialPoint
  readonly sourceIds: readonly string[]
  readonly sourceIntersectionId: string
  readonly status: StructuralBoundaryStatus
  readonly confidence: number
  readonly canonicalCornerBacked: boolean
}

interface LocalAnchor {
  readonly point: LocalPoint
  readonly world: SpatialPoint
  readonly source: 'corner' | 'edge'
  readonly sourceIds: readonly string[]
}

interface SurfaceConstructionContext {
  readonly basis: RoomSurfacePlaneBasis
  readonly normalizedNormal: SpatialPoint
  readonly normalizedPlaneConstant: number
  readonly supportPoints: readonly SpatialPoint[]
  readonly projectedSupport: readonly LocalPoint[]
  readonly constraints: readonly BoundaryConstraint[]
  readonly anchors: readonly LocalAnchor[]
}

interface BasisData {
  readonly basis: RoomSurfacePlaneBasis
  readonly normal: SpatialPoint
  readonly planeConstant: number
}

interface SupportSidedness {
  readonly positiveSupportCount: number
  readonly negativeSupportCount: number
  readonly nearLineSupportCount: number
  readonly positiveSupportAreaMetersSquared: number
  readonly negativeSupportAreaMetersSquared: number
  readonly supportCentroidSignedDistanceMeters: number
  readonly dominantSide: -1 | 0 | 1
}

interface ClassifiedConstraint {
  readonly constraint: BoundaryConstraint
  readonly classification: RoomSurfaceConstraintClassification
  readonly sidedness: SupportSidedness
  readonly reason: string
  readonly keepSide: -1 | 0 | 1
}

interface PatchBuildOutcome {
  readonly patch: RoomSurfacePatch | null
  readonly diagnostic: RoomSurfaceSurfaceDiagnostic
}

const ROLE_ORDER: Record<RoomSurfacePatchRole, number> = {
  wall: 0,
  ceiling: 1,
  floor: 2,
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function dot(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function cross(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  }
}

function add(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z }
}

function subtract(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }
}

function scale(point: SpatialPoint, scalar: number): SpatialPoint {
  return { x: point.x * scalar, y: point.y * scalar, z: point.z * scalar }
}

function magnitude(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function normalize(point: SpatialPoint): SpatialPoint | null {
  const length = magnitude(point)
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    return null
  }
  return scale(point, 1 / length)
}

function isFinitePoint(point: SpatialPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

function isFiniteLocalPoint(point: LocalPoint): boolean {
  return Number.isFinite(point.u) && Number.isFinite(point.v)
}

function localDistance(first: LocalPoint, second: LocalPoint): number {
  return Math.hypot(first.u - second.u, first.v - second.v)
}

function localCross(first: LocalPoint, second: LocalPoint, third: LocalPoint): number {
  return (second.u - first.u) * (third.v - first.v) -
    (second.v - first.v) * (third.u - first.u)
}

function signedArea(points: readonly LocalPoint[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length]
    const current = points[index]
    area += current.u * next.v - next.u * current.v
  }
  return area * 0.5
}

function quantile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return 0
  }
  const position = clamp(fraction, 0, 1) * (sortedValues.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) {
    return sortedValues[lower]
  }
  const amount = position - lower
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * amount
}

function robustSupportPoints(
  points: readonly LocalPoint[],
  trimFraction: number,
): LocalPoint[] {
  if (points.length < 8) {
    return [...points]
  }
  const sortedU = points.map((point) => point.u).sort((first, second) => first - second)
  const sortedV = points.map((point) => point.v).sort((first, second) => first - second)
  const boundedTrim = clamp(trimFraction, 0, 0.25)
  const minimumU = quantile(sortedU, boundedTrim)
  const maximumU = quantile(sortedU, 1 - boundedTrim)
  const minimumV = quantile(sortedV, boundedTrim)
  const maximumV = quantile(sortedV, 1 - boundedTrim)
  const trimmed = points.filter((point) => point.u >= minimumU && point.u <= maximumU && point.v >= minimumV && point.v <= maximumV)
  return trimmed.length >= 3 ? trimmed : [...points]
}

function convexHull(points: readonly LocalPoint[]): LocalPoint[] {
  const sorted = [...points]
    .filter(isFiniteLocalPoint)
    .sort((first, second) => first.u - second.u || first.v - second.v)
  const unique: LocalPoint[] = []
  for (const point of sorted) {
    if (unique.length === 0 || localDistance(unique[unique.length - 1], point) > Number.EPSILON) {
      unique.push(point)
    }
  }
  if (unique.length <= 2) {
    return unique
  }

  const lower: LocalPoint[] = []
  for (const point of unique) {
    while (lower.length >= 2 && localCross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper: LocalPoint[] = []
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]
    while (upper.length >= 2 && localCross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function removeDuplicateAndCollinearVertices(
  points: readonly LocalPoint[],
  toleranceMeters: number,
): LocalPoint[] {
  if (points.length < 3) {
    return [...points]
  }
  const deduplicated: LocalPoint[] = []
  for (const point of points) {
    if (deduplicated.length === 0 || localDistance(deduplicated[deduplicated.length - 1], point) > toleranceMeters) {
      deduplicated.push(point)
    }
  }
  if (deduplicated.length > 1 && localDistance(deduplicated[0], deduplicated[deduplicated.length - 1]) <= toleranceMeters) {
    deduplicated.pop()
  }

  let changed = true
  while (changed && deduplicated.length >= 3) {
    changed = false
    for (let index = 0; index < deduplicated.length; index += 1) {
      const previous = deduplicated[(index + deduplicated.length - 1) % deduplicated.length]
      const current = deduplicated[index]
      const next = deduplicated[(index + 1) % deduplicated.length]
      const edgeLength = localDistance(previous, next)
      if (edgeLength <= toleranceMeters || Math.abs(localCross(previous, current, next)) <= toleranceMeters * Math.max(edgeLength, 1)) {
        deduplicated.splice(index, 1)
        changed = true
        break
      }
    }
  }
  return deduplicated
}

function snapStructuralAnchors(
  points: readonly LocalPoint[],
  anchors: readonly LocalAnchor[],
  toleranceMeters: number,
): LocalPoint[] {
  return points.map((point) => {
    const corner = nearestAnchor(point, anchors.filter((anchor) => anchor.source === 'corner'), toleranceMeters)
    return corner?.point ?? point
  })
}

function pointInTriangle(point: LocalPoint, first: LocalPoint, second: LocalPoint, third: LocalPoint): boolean {
  const firstCross = localCross(first, second, point)
  const secondCross = localCross(second, third, point)
  const thirdCross = localCross(third, first, point)
  const hasNegative = firstCross < -1e-9 || secondCross < -1e-9 || thirdCross < -1e-9
  const hasPositive = firstCross > 1e-9 || secondCross > 1e-9 || thirdCross > 1e-9
  return !(hasNegative && hasPositive)
}

/** Bounded ear-clipping triangulation for a simple 2D polygon. */
function triangulatePolygon(points: readonly LocalPoint[]): number[] {
  if (points.length < 3 || Math.abs(signedArea(points)) <= Number.EPSILON) {
    return []
  }
  const polygon = signedArea(points) > 0
    ? [...points]
    : [...points].reverse()
  const sourceIndices = signedArea(points) > 0
    ? points.map((_point, index) => index)
    : points.map((_point, index) => points.length - 1 - index)
  const remaining = polygon.map((_point, index) => index)
  const triangles: number[] = []
  let guard = 0
  const maximumIterations = points.length * points.length
  while (remaining.length > 3 && guard < maximumIterations) {
    let earFound = false
    for (let index = 0; index < remaining.length; index += 1) {
      const previousIndex = remaining[(index + remaining.length - 1) % remaining.length]
      const currentIndex = remaining[index]
      const nextIndex = remaining[(index + 1) % remaining.length]
      const previous = polygon[previousIndex]
      const current = polygon[currentIndex]
      const next = polygon[nextIndex]
      if (localCross(previous, current, next) <= 1e-9) {
        continue
      }
      const containsOtherVertex = remaining.some((candidateIndex) => {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) {
          return false
        }
        return pointInTriangle(polygon[candidateIndex], previous, current, next)
      })
      if (containsOtherVertex) {
        continue
      }
      triangles.push(sourceIndices[previousIndex], sourceIndices[currentIndex], sourceIndices[nextIndex])
      remaining.splice(index, 1)
      earFound = true
      break
    }
    if (!earFound) {
      return []
    }
    guard += 1
  }
  if (remaining.length === 3) {
    triangles.push(
      sourceIndices[remaining[0]],
      sourceIndices[remaining[1]],
      sourceIndices[remaining[2]],
    )
  }
  return triangles
}

function createBasis(surface: StructuralSurfaceCandidate): BasisData | null {
  const normal = normalize(surface.normal)
  const normalLength = magnitude(surface.normal)
  if (!normal || !Number.isFinite(surface.planeConstant) || !Number.isFinite(normalLength)) {
    return null
  }
  const planeConstant = surface.planeConstant / normalLength
  const worldUp = { x: 0, y: 1, z: 0 }
  const worldX = { x: 1, y: 0, z: 0 }
  const upProjection = subtract(worldUp, scale(normal, dot(worldUp, normal)))
  const horizontalAxis = normalize(upProjection) ?? normalize(subtract(worldX, scale(normal, dot(worldX, normal))))
  if (!horizontalAxis) {
    return null
  }
  const axisU = surface.role === 'wall'
    ? normalize(cross(horizontalAxis, normal))
    : normalize(subtract(worldX, scale(normal, dot(worldX, normal)))) ?? normalize(cross(horizontalAxis, normal))
  if (!axisU) {
    return null
  }
  const axisV = surface.role === 'wall'
    ? horizontalAxis
    : normalize(cross(normal, axisU))
  if (!axisV) {
    return null
  }
  const origin = scale(normal, planeConstant)
  return {
    basis: { origin, axisU, axisV },
    normal,
    planeConstant,
  }
}

function worldToLocal(point: SpatialPoint, basis: RoomSurfacePlaneBasis): LocalPoint {
  const relative = subtract(point, basis.origin)
  return { u: dot(relative, basis.axisU), v: dot(relative, basis.axisV) }
}

function localToWorld(point: LocalPoint, basis: RoomSurfacePlaneBasis): SpatialPoint {
  return add(basis.origin, add(scale(basis.axisU, point.u), scale(basis.axisV, point.v)))
}

function edgeInvolvesSurface(edge: StructuralBoundaryEdge, surfaceId: string): boolean {
  return edge.surfaceAId === surfaceId || edge.surfaceBId === surfaceId
}

function cornerInvolvesSurface(corner: StructuralCorner, surfaceId: string): boolean {
  return corner.status !== 'rejected' && corner.surfaceIds.includes(surfaceId)
}

function projectBoundaryConstraint(
  edge: StructuralBoundaryEdge,
  basis: RoomSurfacePlaneBasis,
  canonicalCornerIntersectionIds: ReadonlySet<string>,
): BoundaryConstraint {
  return {
    id: edge.id,
    start: worldToLocal(edge.start, basis),
    end: worldToLocal(edge.end, basis),
    worldStart: edge.start,
    worldEnd: edge.end,
    sourceIds: [edge.id, edge.sourceIntersectionId],
    sourceIntersectionId: edge.sourceIntersectionId,
    status: edge.status,
    confidence: edge.confidence,
    canonicalCornerBacked: canonicalCornerIntersectionIds.has(edge.sourceIntersectionId),
  }
}

function createConstructionContext(
  surface: StructuralSurfaceCandidate,
  boundary: RoomBoundaryResult,
  supportPointsBySurfaceId: ReadonlyMap<string, readonly SpatialPoint[]>,
  basisData: BasisData,
): SurfaceConstructionContext | null {
  const supportPoints = supportPointsBySurfaceId.get(surface.planeId) ?? []
  const projectedSupport = supportPoints.filter(isFinitePoint).map((point) => worldToLocal(point, basisData.basis)).filter(isFiniteLocalPoint)
  const selectedEdges = boundary.edges
    .filter((edge) => edge.status !== 'rejected' && edgeInvolvesSurface(edge, surface.planeId))
  const anchors = boundary.corners
    .filter((corner) => cornerInvolvesSurface(corner, surface.planeId))
    .map((corner) => ({
      point: worldToLocal(corner.position, basisData.basis),
      world: corner.position,
      source: 'corner' as const,
      sourceIds: [corner.id, ...corner.sourceEdgeIds, ...corner.sourceIntersectionIds],
    }))
  const canonicalCornerIntersectionIds = new Set(boundary.corners
    .filter((corner) => cornerInvolvesSurface(corner, surface.planeId))
    .flatMap((corner) => corner.sourceIntersectionIds))
  const constraints = selectedEdges.map((edge) => projectBoundaryConstraint(edge, basisData.basis, canonicalCornerIntersectionIds))
  const edgeAnchors = constraints.flatMap((constraint) => [
    { point: constraint.start, world: constraint.worldStart, source: 'edge' as const, sourceIds: constraint.sourceIds },
    { point: constraint.end, world: constraint.worldEnd, source: 'edge' as const, sourceIds: constraint.sourceIds },
  ])
  return {
    basis: basisData.basis,
    normalizedNormal: basisData.normal,
    normalizedPlaneConstant: basisData.planeConstant,
    supportPoints,
    projectedSupport,
    constraints,
    anchors: [...anchors, ...edgeAnchors],
  }
}

function localSignedDistanceToConstraint(point: LocalPoint, constraint: BoundaryConstraint): number {
  const lineLength = localDistance(constraint.start, constraint.end)
  if (lineLength <= Number.EPSILON) {
    return NaN
  }
  return localCross(constraint.start, constraint.end, point) / lineLength
}

function supportAreaOnSide(points: readonly LocalPoint[]): number {
  const hull = convexHull(points)
  return hull.length >= 3 ? Math.abs(signedArea(hull)) : 0
}

function calculateSupportSidedness(
  points: readonly LocalPoint[],
  constraint: BoundaryConstraint,
  nearLineToleranceMeters: number,
): SupportSidedness {
  const positivePoints: LocalPoint[] = []
  const negativePoints: LocalPoint[] = []
  let positiveSupportCount = 0
  let negativeSupportCount = 0
  let nearLineSupportCount = 0
  let signedDistanceTotal = 0
  let finiteDistanceCount = 0
  for (const point of points) {
    const signedDistance = localSignedDistanceToConstraint(point, constraint)
    if (!Number.isFinite(signedDistance)) {
      continue
    }
    signedDistanceTotal += signedDistance
    finiteDistanceCount += 1
    if (Math.abs(signedDistance) <= nearLineToleranceMeters) {
      nearLineSupportCount += 1
    } else if (signedDistance > 0) {
      positiveSupportCount += 1
      positivePoints.push(point)
    } else {
      negativeSupportCount += 1
      negativePoints.push(point)
    }
  }
  const dominantSide: -1 | 0 | 1 = positiveSupportCount === negativeSupportCount
    ? 0
    : positiveSupportCount > negativeSupportCount ? 1 : -1
  return {
    positiveSupportCount,
    negativeSupportCount,
    nearLineSupportCount,
    positiveSupportAreaMetersSquared: supportAreaOnSide(positivePoints),
    negativeSupportAreaMetersSquared: supportAreaOnSide(negativePoints),
    supportCentroidSignedDistanceMeters: finiteDistanceCount > 0 ? signedDistanceTotal / finiteDistanceCount : 0,
    dominantSide,
  }
}

function classifyConstraint(
  constraint: BoundaryConstraint,
  supportPoints: readonly LocalPoint[],
  config: RoomSurfaceConstructionConfig,
): ClassifiedConstraint {
  const lineLength = localDistance(constraint.start, constraint.end)
  const sidedness = calculateSupportSidedness(supportPoints, constraint, config.boundaryMatchToleranceMeters)
  if (!Number.isFinite(lineLength) || lineLength <= Number.EPSILON) {
    return {
      constraint,
      classification: 'rejected',
      sidedness,
      keepSide: 0,
      reason: 'structural boundary line is degenerate',
    }
  }
  const nonNearSupportCount = sidedness.positiveSupportCount + sidedness.negativeSupportCount
  if (nonNearSupportCount === 0) {
    return {
      constraint,
      classification: 'ambiguous',
      sidedness,
      keepSide: 0,
      reason: 'support is concentrated on the structural line without a measurable side',
    }
  }
  const opposingSideFraction = Math.min(sidedness.positiveSupportCount, sidedness.negativeSupportCount) / nonNearSupportCount
  if (opposingSideFraction >= config.maximumExteriorOpposingSideFraction) {
    return {
      constraint,
      classification: 'internal/non-boundary',
      sidedness,
      keepSide: 0,
      reason: 'substantial occupied support exists on both sides of the line',
    }
  }
  const dominantSideCount = Math.max(sidedness.positiveSupportCount, sidedness.negativeSupportCount)
  const dominantSideFraction = dominantSideCount / nonNearSupportCount
  if (dominantSideFraction < config.minimumBoundarySideDominance || sidedness.dominantSide === 0) {
    return {
      constraint,
      classification: 'ambiguous',
      sidedness,
      keepSide: 0,
      reason: 'support sidedness is not dominant enough to define an exterior boundary',
    }
  }
  return {
    constraint,
    classification: 'usable-boundary',
    sidedness,
    keepSide: sidedness.dominantSide,
    reason: constraint.canonicalCornerBacked
      ? 'support is one-sided and the boundary participates in a canonical corner'
      : constraint.status === 'partial'
        ? 'support is one-sided; partial structural boundary retained conservatively'
        : 'support is predominantly on one side of the structural line',
  }
}

function clipPolygonToConstraint(
  polygon: readonly LocalPoint[],
  constraint: BoundaryConstraint,
  keepSide: -1 | 1,
  epsilonMeters: number,
): LocalPoint[] {
  if (polygon.length === 0) {
    return []
  }
  const isInside = (point: LocalPoint): boolean => {
    const signedDistance = localSignedDistanceToConstraint(point, constraint)
    return Number.isFinite(signedDistance) && keepSide * signedDistance >= -epsilonMeters
  }
  const intersection = (first: LocalPoint, second: LocalPoint): LocalPoint => {
    const firstValue = keepSide * localSignedDistanceToConstraint(first, constraint)
    const secondValue = keepSide * localSignedDistanceToConstraint(second, constraint)
    const denominator = firstValue - secondValue
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= Number.EPSILON) {
      return first
    }
    return {
      u: first.u + (second.u - first.u) * (firstValue / denominator),
      v: first.v + (second.v - first.v) * (firstValue / denominator),
    }
  }
  const clipped: LocalPoint[] = []
  let previous = polygon[polygon.length - 1]
  let previousInside = isInside(previous)
  for (const current of polygon) {
    const currentInside = isInside(current)
    if (currentInside !== previousInside) {
      clipped.push(intersection(previous, current))
    }
    if (currentInside) {
      clipped.push(current)
    }
    previous = current
    previousInside = currentInside
  }
  return clipped.filter(isFiniteLocalPoint)
}

function pointSatisfiesConstraints(
  point: LocalPoint,
  constraints: readonly ClassifiedConstraint[],
  epsilonMeters: number,
): boolean {
  return constraints.every((classified) => {
    if (classified.classification !== 'usable-boundary' || classified.keepSide === 0) {
      return true
    }
    const signedDistance = localSignedDistanceToConstraint(point, classified.constraint)
    return Number.isFinite(signedDistance) && classified.keepSide * signedDistance >= -epsilonMeters
  })
}

function retainedSupportFraction(
  supportPoints: readonly LocalPoint[],
  constraints: readonly ClassifiedConstraint[],
  epsilonMeters: number,
): number {
  if (supportPoints.length === 0) {
    return 0
  }
  const retainedCount = supportPoints.filter((point) => pointSatisfiesConstraints(point, constraints, epsilonMeters)).length
  return retainedCount / supportPoints.length
}

function pointMatches(first: LocalPoint, second: LocalPoint, tolerance: number): boolean {
  return localDistance(first, second) <= tolerance
}

function constraintMatchesPolygonEdge(
  first: LocalPoint,
  second: LocalPoint,
  constraint: BoundaryConstraint,
  tolerance: number,
): boolean {
  const lineLength = localDistance(constraint.start, constraint.end)
  if (lineLength <= Number.EPSILON) {
    return false
  }
  const firstLineDistance = Math.abs(localSignedDistanceToConstraint(first, constraint))
  const secondLineDistance = Math.abs(localSignedDistanceToConstraint(second, constraint))
  if (firstLineDistance > tolerance || secondLineDistance > tolerance) {
    return false
  }
  const direction = {
    u: (constraint.end.u - constraint.start.u) / lineLength,
    v: (constraint.end.v - constraint.start.v) / lineLength,
  }
  const firstParameter = (first.u - constraint.start.u) * direction.u + (first.v - constraint.start.v) * direction.v
  const secondParameter = (second.u - constraint.start.u) * direction.u + (second.v - constraint.start.v) * direction.v
  return Math.max(Math.min(firstParameter, secondParameter), 0) <=
    Math.min(Math.max(firstParameter, secondParameter), lineLength) + tolerance
}

function nearestAnchor(
  point: LocalPoint,
  anchors: readonly LocalAnchor[],
  tolerance: number,
): LocalAnchor | null {
  let closest: LocalAnchor | null = null
  let closestDistance = Infinity
  for (const anchor of anchors) {
    const candidateDistance = localDistance(point, anchor.point)
    const sameDistancePrefersCanonicalCorner = closest !== null &&
      Math.abs(candidateDistance - closestDistance) <= 1e-9 &&
      anchor.source === 'corner' && closest.source !== 'corner'
    if (candidateDistance <= tolerance &&
      (candidateDistance < closestDistance || sameDistancePrefersCanonicalCorner)) {
      closest = anchor
      closestDistance = candidateDistance
    }
  }
  return closest
}

function createPolygonBoundaryProvenance(
  points: readonly LocalPoint[],
  worldPoints: readonly SpatialPoint[],
  context: SurfaceConstructionContext,
  acceptedConstraints: readonly ClassifiedConstraint[],
  config: RoomSurfaceConstructionConfig,
): RoomSurfacePatchBoundary[] {
  return points.map((point, index) => {
    const nextIndex = (index + 1) % points.length
    const nextPoint = points[nextIndex]
    const constraint = acceptedConstraints.find((candidate) => constraintMatchesPolygonEdge(point, nextPoint, candidate.constraint, config.boundaryMatchToleranceMeters))?.constraint
    const pointAnchor = nearestAnchor(point, context.anchors, config.boundaryMatchToleranceMeters)
    const nextAnchor = nearestAnchor(nextPoint, context.anchors, config.boundaryMatchToleranceMeters)
    const provenance: RoomSurfaceBoundaryProvenance = constraint
      ? 'structural-intersection'
      : pointAnchor?.source === 'corner' || nextAnchor?.source === 'corner'
        ? 'canonical-corner'
        : context.supportPoints.length > 0
          ? 'observed-support-extent'
          : 'partial-completion'
    const sourceIds = constraint?.sourceIds ?? [
      ...(pointAnchor?.sourceIds ?? []),
      ...(nextAnchor?.sourceIds ?? []),
    ]
    return {
      start: worldPoints[index],
      end: worldPoints[nextIndex],
      provenance,
      sourceIds: [...new Set(sourceIds)].sort((first, second) => first.localeCompare(second)),
    }
  })
}

function classifyCompletion(
  provenance: readonly RoomSurfacePatchBoundary[],
  supportPointCount: number,
): RoomSurfacePatchCompletionStatus {
  const hasStructuralConstraint = provenance.some((boundary) => boundary.provenance === 'structural-intersection' || boundary.provenance === 'canonical-corner')
  const allBoundariesMeasured = provenance.length > 0 && provenance.every((boundary) => boundary.provenance === 'structural-intersection' || boundary.provenance === 'canonical-corner')
  if (allBoundariesMeasured) {
    return 'structurally-completed'
  }
  if (hasStructuralConstraint || supportPointCount < 3) {
    return 'partial'
  }
  return 'observed'
}

function calculateConfidence(
  surface: StructuralSurfaceCandidate,
  supportPointCount: number,
  provenance: readonly RoomSurfacePatchBoundary[],
  canonicalCornerCount: number,
): number {
  const supportQuality = clamp(supportPointCount / Math.max(1, surface.finalOwnedSupport), 0, 1)
  const structuralQuality = provenance.length === 0
    ? 0
    : provenance.filter((boundary) => boundary.provenance === 'structural-intersection' || boundary.provenance === 'canonical-corner').length / provenance.length
  const cornerQuality = canonicalCornerCount > 0 ? 1 : 0
  return clamp(surface.confidence * 0.5 + supportQuality * 0.25 + structuralQuality * 0.15 + cornerQuality * 0.1, 0, 1)
}

function polygonArea(points: readonly LocalPoint[]): number {
  return Math.abs(signedArea(points))
}

function polygonIsValid(points: readonly LocalPoint[], minimumArea: number): boolean {
  return points.length >= 3 &&
    points.every(isFiniteLocalPoint) &&
    Number.isFinite(polygonArea(points)) &&
    polygonArea(points) >= minimumArea
}

function createConstraintDiagnostic(
  classified: ClassifiedConstraint,
  accepted: boolean,
  retainedSupportFractionValue: number,
  polygonBefore: readonly LocalPoint[],
  polygonAfter: readonly LocalPoint[],
  reason: string,
): RoomSurfaceConstraintDiagnostic {
  return {
    id: classified.constraint.id,
    sourceIntersectionId: classified.constraint.sourceIntersectionId,
    classification: classified.classification,
    accepted,
    status: classified.constraint.status,
    confidence: classified.constraint.confidence,
    positiveSupportCount: classified.sidedness.positiveSupportCount,
    negativeSupportCount: classified.sidedness.negativeSupportCount,
    nearLineSupportCount: classified.sidedness.nearLineSupportCount,
    positiveSupportAreaMetersSquared: classified.sidedness.positiveSupportAreaMetersSquared,
    negativeSupportAreaMetersSquared: classified.sidedness.negativeSupportAreaMetersSquared,
    supportCentroidSignedDistanceMeters: classified.sidedness.supportCentroidSignedDistanceMeters,
    dominantSide: classified.sidedness.dominantSide,
    retainedSupportFraction: retainedSupportFractionValue,
    polygonVertexCountBefore: polygonBefore.length,
    polygonVertexCountAfter: polygonAfter.length,
    polygonAreaBeforeMetersSquared: polygonArea(polygonBefore),
    polygonAreaAfterMetersSquared: polygonArea(polygonAfter),
    reason,
  }
}

function createClipDiagnostic(
  constraintId: string,
  accepted: boolean,
  polygonBefore: readonly LocalPoint[],
  polygonAfter: readonly LocalPoint[],
  retainedSupportFractionValue: number,
  reason: string,
): RoomSurfaceClipDiagnostic {
  return {
    constraintId,
    accepted,
    polygonVertexCountBefore: polygonBefore.length,
    polygonVertexCountAfter: polygonAfter.length,
    polygonAreaBeforeMetersSquared: polygonArea(polygonBefore),
    polygonAreaAfterMetersSquared: polygonArea(polygonAfter),
    retainedSupportFraction: retainedSupportFractionValue,
    reason,
  }
}

function createSkippedSurfaceDiagnostic(
  surface: ConstructibleSurface,
  context: SurfaceConstructionContext | null,
  reason: string,
  initialHull: readonly LocalPoint[] = [],
  robustSupportPointCount = 0,
): RoomSurfaceSurfaceDiagnostic {
  const projectedSupportCount = context?.projectedSupport.length ?? 0
  const initialArea = polygonArea(initialHull)
  return {
    sourceSurfaceId: surface.planeId,
    role: surface.role,
    ownedSupportCount: context?.supportPoints.length ?? 0,
    projectedSupportCount,
    finiteProjectedSupportCount: projectedSupportCount,
    robustSupportPointCount,
    initialSupportHullVertexCount: initialHull.length,
    initialSupportHullAreaMetersSquared: initialArea,
    structuralConstraintsFound: context?.constraints.length ?? 0,
    structuralConstraints: [],
    acceptedStructuralBoundaryIds: [],
    ignoredStructuralBoundaryIds: context?.constraints.map((constraint) => constraint.id) ?? [],
    clipSequence: [],
    finalPolygonVertexCount: 0,
    finalPolygonAreaMetersSquared: 0,
    finalRetainedSupportFraction: 0,
    triangulationAttempted: false,
    triangulationValid: false,
    completionStatus: null,
    valid: false,
    skipReason: reason,
  }
}

function buildPatch(
  surface: ConstructibleSurface,
  context: SurfaceConstructionContext | null,
  config: RoomSurfaceConstructionConfig,
): PatchBuildOutcome {
  if (!context) {
    return {
      patch: null,
      diagnostic: createSkippedSurfaceDiagnostic(surface, context, 'plane basis could not be constructed'),
    }
  }

  const finiteProjectedSupport = context.projectedSupport.filter(isFiniteLocalPoint)
  const robustSupport = robustSupportPoints(finiteProjectedSupport, config.supportTrimFraction)
  const initialHull = convexHull(robustSupport)
  const initialHullArea = polygonArea(initialHull)
  if (!polygonIsValid(initialHull, config.minimumPatchAreaMetersSquared)) {
    const preliminaryConstraints = context.constraints
      .map((constraint) => classifyConstraint(constraint, robustSupport, config))
      .sort((first, second) => second.constraint.confidence - first.constraint.confidence || first.constraint.id.localeCompare(second.constraint.id))
    const invalidBaselineConstraintDiagnostics = preliminaryConstraints.map((classified) => createConstraintDiagnostic(
      classified,
      false,
      0,
      initialHull,
      initialHull,
      'support hull is invalid; structural constraint was not applied',
    ))
    return {
      patch: null,
      diagnostic: {
        ...createSkippedSurfaceDiagnostic(
          surface,
          context,
          robustSupport.length < 3
            ? 'support hull has fewer than three finite vertices'
            : 'support hull has no meaningful finite area',
          initialHull,
          robustSupport.length,
        ),
        structuralConstraints: invalidBaselineConstraintDiagnostics,
        ignoredStructuralBoundaryIds: preliminaryConstraints.map((classified) => classified.constraint.id),
        initialSupportHullAreaMetersSquared: initialHullArea,
      },
    }
  }

  const classifiedConstraints = context.constraints
    .map((constraint) => classifyConstraint(constraint, robustSupport, config))
    .sort((first, second) => second.constraint.confidence - first.constraint.confidence || first.constraint.id.localeCompare(second.constraint.id))
  const acceptedConstraints: ClassifiedConstraint[] = []
  const constraintDiagnostics: RoomSurfaceConstraintDiagnostic[] = []
  const clipSequence: RoomSurfaceClipDiagnostic[] = []
  let polygon = initialHull

  for (const classified of classifiedConstraints) {
    const before = polygon
    if (classified.classification !== 'usable-boundary' || classified.keepSide === 0) {
      const retained = retainedSupportFraction(robustSupport, acceptedConstraints, config.polygonClipEpsilonMeters)
      constraintDiagnostics.push(createConstraintDiagnostic(classified, false, retained, before, before, classified.reason))
      continue
    }

    const clipped = removeDuplicateAndCollinearVertices(
      clipPolygonToConstraint(before, classified.constraint, classified.keepSide, config.polygonClipEpsilonMeters),
      config.vertexMergeToleranceMeters,
    )
    const candidateConstraints = [...acceptedConstraints, classified]
    const retained = retainedSupportFraction(robustSupport, candidateConstraints, config.polygonClipEpsilonMeters)
    const valid = polygonIsValid(clipped, config.minimumPatchAreaMetersSquared) &&
      retained >= config.minimumRetainedSupportFraction
    const reason = valid
      ? 'support-sided structural clip retained a meaningful measured patch'
      : !polygonIsValid(clipped, config.minimumPatchAreaMetersSquared)
        ? 'clip would remove the valid support-hull polygon'
        : `clip would retain only ${(retained * 100).toFixed(1)}% of robust support`
    clipSequence.push(createClipDiagnostic(classified.constraint.id, valid, before, valid ? clipped : before, retained, reason))
    constraintDiagnostics.push(createConstraintDiagnostic(classified, valid, retained, before, valid ? clipped : before, reason))
    if (valid) {
      polygon = clipped
      acceptedConstraints.push(classified)
    }
  }

  const anchoredPolygon = removeDuplicateAndCollinearVertices(
    snapStructuralAnchors(polygon, context.anchors, config.boundaryMatchToleranceMeters),
    config.vertexMergeToleranceMeters,
  )
  const finalPolygonArea = polygonArea(anchoredPolygon)
  const polygonValid = polygonIsValid(anchoredPolygon, config.minimumPatchAreaMetersSquared)
  const acceptedStructuralBoundaryIds = acceptedConstraints.map((classified) => classified.constraint.id).sort((first, second) => first.localeCompare(second))
  const ignoredStructuralBoundaryIds = classifiedConstraints
    .filter((classified) => !acceptedStructuralBoundaryIds.includes(classified.constraint.id))
    .map((classified) => classified.constraint.id)
    .sort((first, second) => first.localeCompare(second))
  const finalRetainedSupportFraction = retainedSupportFraction(
    robustSupport,
    acceptedConstraints,
    config.polygonClipEpsilonMeters,
  )

  if (!polygonValid) {
    return {
      patch: null,
      diagnostic: {
        sourceSurfaceId: surface.planeId,
        role: surface.role,
        ownedSupportCount: context.supportPoints.length,
        projectedSupportCount: context.projectedSupport.length,
        finiteProjectedSupportCount: finiteProjectedSupport.length,
        robustSupportPointCount: robustSupport.length,
        initialSupportHullVertexCount: initialHull.length,
        initialSupportHullAreaMetersSquared: initialHullArea,
        structuralConstraintsFound: context.constraints.length,
        structuralConstraints: constraintDiagnostics,
        acceptedStructuralBoundaryIds,
        ignoredStructuralBoundaryIds,
        clipSequence,
        finalPolygonVertexCount: anchoredPolygon.length,
        finalPolygonAreaMetersSquared: finalPolygonArea,
        finalRetainedSupportFraction,
        triangulationAttempted: false,
        triangulationValid: false,
        completionStatus: null,
        valid: false,
        skipReason: 'polygon became invalid after structural clipping or anchor cleanup',
      },
    }
  }

  const triangleIndices = triangulatePolygon(anchoredPolygon)
  const triangulationValid = triangleIndices.length >= 3 && triangleIndices.length % 3 === 0
  if (!triangulationValid) {
    return {
      patch: null,
      diagnostic: {
        sourceSurfaceId: surface.planeId,
        role: surface.role,
        ownedSupportCount: context.supportPoints.length,
        projectedSupportCount: context.projectedSupport.length,
        finiteProjectedSupportCount: finiteProjectedSupport.length,
        robustSupportPointCount: robustSupport.length,
        initialSupportHullVertexCount: initialHull.length,
        initialSupportHullAreaMetersSquared: initialHullArea,
        structuralConstraintsFound: context.constraints.length,
        structuralConstraints: constraintDiagnostics,
        acceptedStructuralBoundaryIds,
        ignoredStructuralBoundaryIds,
        clipSequence,
        finalPolygonVertexCount: anchoredPolygon.length,
        finalPolygonAreaMetersSquared: finalPolygonArea,
        finalRetainedSupportFraction,
        triangulationAttempted: true,
        triangulationValid: false,
        completionStatus: null,
        valid: false,
        skipReason: 'bounded polygon triangulation returned no valid triangles',
      },
    }
  }

  const localVertices = anchoredPolygon
  const worldVertices = localVertices.map((point) => nearestAnchor(point, context.anchors, config.boundaryMatchToleranceMeters)?.world ?? localToWorld(point, context.basis))
  if (worldVertices.some((point) => !isFinitePoint(point))) {
    return {
      patch: null,
      diagnostic: {
        sourceSurfaceId: surface.planeId,
        role: surface.role,
        ownedSupportCount: context.supportPoints.length,
        projectedSupportCount: context.projectedSupport.length,
        finiteProjectedSupportCount: finiteProjectedSupport.length,
        robustSupportPointCount: robustSupport.length,
        initialSupportHullVertexCount: initialHull.length,
        initialSupportHullAreaMetersSquared: initialHullArea,
        structuralConstraintsFound: context.constraints.length,
        structuralConstraints: constraintDiagnostics,
        acceptedStructuralBoundaryIds,
        ignoredStructuralBoundaryIds,
        clipSequence,
        finalPolygonVertexCount: localVertices.length,
        finalPolygonAreaMetersSquared: finalPolygonArea,
        finalRetainedSupportFraction,
        triangulationAttempted: true,
        triangulationValid: false,
        completionStatus: null,
        valid: false,
        skipReason: 'polygon reconstruction produced non-finite world vertices',
      },
    }
  }
  const boundaryProvenance = createPolygonBoundaryProvenance(localVertices, worldVertices, context, acceptedConstraints, config)
  const canonicalCornerCount = new Set(
    localVertices.flatMap((point) => context.anchors
      .filter((anchor) => anchor.source === 'corner' && pointMatches(point, anchor.point, config.boundaryMatchToleranceMeters))
      .map((anchor) => anchor.sourceIds[0])
      .filter((sourceId): sourceId is string => Boolean(sourceId))),
  ).size
  const structuralEdgeCount = boundaryProvenance.filter((boundary) => boundary.provenance === 'structural-intersection').length
  const supportDerivedEdgeCount = boundaryProvenance.filter((boundary) => boundary.provenance === 'observed-support-extent' || boundary.provenance === 'partial-completion').length
  const maximumPlaneResidualMeters = worldVertices.reduce((maximum, point) => Math.max(
    maximum,
    Math.abs(dot(context.normalizedNormal, point) - context.normalizedPlaneConstant),
  ), 0)
  const maximumBasisRoundTripResidualMeters = worldVertices.reduce((maximum, point) => {
    const roundTrip = localToWorld(worldToLocal(point, context.basis), context.basis)
    return Math.max(maximum, magnitude(subtract(roundTrip, point)))
  }, 0)
  const completionStatus = classifyCompletion(boundaryProvenance, context.supportPoints.length)
  const patch = Object.freeze({
    id: `room-surface-${surface.role}-${surface.planeId}`,
    sourceSurfaceId: surface.planeId,
    role: surface.role,
    vertices3D: worldVertices,
    vertices2DLocal: localVertices,
    triangleIndices,
    boundaryProvenance,
    confidence: calculateConfidence(surface, context.supportPoints.length, boundaryProvenance, canonicalCornerCount),
    completionStatus,
    areaMetersSquared: finalPolygonArea,
    supportPointCount: context.supportPoints.length,
    normal: context.normalizedNormal,
    planeConstant: context.normalizedPlaneConstant,
    basis: context.basis,
    structuralEdgeCount,
    supportDerivedEdgeCount,
    canonicalCornerCount,
    maximumPlaneResidualMeters,
    maximumBasisRoundTripResidualMeters,
    triangulationValid,
  })
  return {
    patch,
    diagnostic: {
      sourceSurfaceId: surface.planeId,
      role: surface.role,
      ownedSupportCount: context.supportPoints.length,
      projectedSupportCount: context.projectedSupport.length,
      finiteProjectedSupportCount: finiteProjectedSupport.length,
      robustSupportPointCount: robustSupport.length,
      initialSupportHullVertexCount: initialHull.length,
      initialSupportHullAreaMetersSquared: initialHullArea,
      structuralConstraintsFound: context.constraints.length,
      structuralConstraints: constraintDiagnostics,
      acceptedStructuralBoundaryIds,
      ignoredStructuralBoundaryIds,
      clipSequence,
      finalPolygonVertexCount: localVertices.length,
      finalPolygonAreaMetersSquared: finalPolygonArea,
      finalRetainedSupportFraction,
      triangulationAttempted: true,
      triangulationValid,
      completionStatus,
      valid: true,
      skipReason: null,
    },
  }
}

type ConstructibleSurface = StructuralSurfaceCandidate & { readonly role: RoomSurfacePatchRole }

function isConstructibleSurface(surface: StructuralSurfaceCandidate): surface is ConstructibleSurface {
  return surface.role === 'wall' || surface.role === 'floor' || surface.role === 'ceiling'
}

function selectedSurfaces(interpretation: RoomStructureInterpretationResult): ConstructibleSurface[] {
  const surfaces = [
    ...interpretation.selectedWalls,
    ...(interpretation.selectedFloor ? [interpretation.selectedFloor] : []),
    ...(interpretation.selectedCeiling ? [interpretation.selectedCeiling] : []),
  ]
  return [...new Map(surfaces.filter(isConstructibleSurface).map((surface) => [surface.planeId, surface])).values()]
    .sort((first, second) => ROLE_ORDER[first.role] - ROLE_ORDER[second.role] || first.planeId.localeCompare(second.planeId))
}

export class RoomSurfaceConstructionService {
  private readonly config: RoomSurfaceConstructionConfig

  public constructor(config: Partial<RoomSurfaceConstructionConfig> = {}) {
    this.config = { ...DEFAULT_ROOM_SURFACE_CONSTRUCTION_CONFIG, ...config }
  }

  public construct(
    interpretation: RoomStructureInterpretationResult,
    boundary: RoomBoundaryResult,
    scan: FinalizedSpatialScan,
  ): RoomSurfaceConstructionResult {
    const startedAt = now()
    const surfaces = selectedSurfaces(interpretation)
    const supportPlanes: SupportPlaneGeometry[] = surfaces.map((surface) => ({
      id: surface.planeId,
      normal: surface.normal,
      planeConstant: surface.planeConstant,
      centroid: surface.centroid,
      localBounds: surface.localBounds,
      tangentU: surface.tangentU,
      tangentV: surface.tangentV,
    }))
    const association = associateFinalizedSupportPoints(scan, supportPlanes, {
      maximumPlaneResidualMeters: this.config.maximumSupportPlaneResidualMeters,
      minimumNormalDot: this.config.minimumSupportNormalDot,
      boundsPaddingMeters: this.config.supportBoundsPaddingMeters,
    })

    const basisStartedAt = now()
    const basisData = surfaces.map((surface) => ({ surface, data: createBasis(surface) }))
    const basisConstructionMs = now() - basisStartedAt

    const supportProjectionStartedAt = now()
    const contexts = basisData.map(({ surface, data }) => ({
      surface,
      context: data
        ? createConstructionContext(surface, boundary, association.pointsBySurfaceId, data)
        : null,
    }))
    const supportProjectionMs = now() - supportProjectionStartedAt

    const polygonStartedAt = now()
    const buildOutcomes = contexts.map(({ surface, context }) => buildPatch(surface, context, this.config))
    const polygonConstructionMs = now() - polygonStartedAt

    const triangulationStartedAt = now()
    const patches = buildOutcomes.flatMap((outcome) => outcome.patch ? [outcome.patch] : [])
    const triangulationMs = now() - triangulationStartedAt
    const surfaceDiagnostics = buildOutcomes.map((outcome) => outcome.diagnostic)
    const skippedSurfaceIds = surfaceDiagnostics.filter((diagnostic) => !diagnostic.valid).map((diagnostic) => diagnostic.sourceSurfaceId)
    const supportPointCounts = Object.fromEntries(contexts.map(({ surface, context }) => [surface.planeId, context?.supportPoints.length ?? 0]))
    const structuralBoundaryCounts = Object.fromEntries(contexts.map(({ surface, context }) => [surface.planeId, context?.constraints.length ?? 0]))
    const totalMs = now() - startedAt
    const warnings = surfaceDiagnostics
      .filter((diagnostic) => diagnostic.skipReason !== null)
      .map((diagnostic) => `${diagnostic.sourceSurfaceId}: ${diagnostic.skipReason}`)
    return Object.freeze({
      sourceScanId: scan.id,
      surfaces: Object.freeze(patches),
      diagnostics: Object.freeze({
        inputSelectedSurfaceCount: surfaces.length,
        constructedPatchCount: patches.length,
        wallPatchCount: patches.filter((patch) => patch.role === 'wall').length,
        floorPatchCount: patches.filter((patch) => patch.role === 'floor').length,
        ceilingPatchCount: patches.filter((patch) => patch.role === 'ceiling').length,
        skippedSurfaceIds,
        supportPointCounts,
        structuralBoundaryCounts,
        surfaceDiagnostics,
        warnings,
      }),
      timings: Object.freeze({
        basisConstructionMs,
        supportProjectionMs,
        polygonConstructionMs,
        triangulationMs,
        totalMs,
      }),
    })
  }
}

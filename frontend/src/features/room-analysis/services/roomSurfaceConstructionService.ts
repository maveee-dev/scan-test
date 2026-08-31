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
  RoomBoundaryResult,
  StructuralBoundaryEdge,
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
}

export const DEFAULT_ROOM_SURFACE_CONSTRUCTION_CONFIG: RoomSurfaceConstructionConfig = {
  maximumSupportPlaneResidualMeters: 0.12,
  minimumSupportNormalDot: 0.45,
  supportBoundsPaddingMeters: 0.2,
  supportTrimFraction: 0.05,
  vertexMergeToleranceMeters: 0.01,
  boundaryMatchToleranceMeters: 0.04,
  minimumPatchAreaMetersSquared: 0.01,
}

interface LocalPoint extends RoomSurfaceLocalPoint {}

interface BoundaryConstraint {
  readonly id: string
  readonly start: LocalPoint
  readonly end: LocalPoint
  readonly worldStart: SpatialPoint
  readonly worldEnd: SpatialPoint
  readonly sourceIds: readonly string[]
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
  readonly fallbackPoints: readonly SpatialPoint[]
}

interface BasisData {
  readonly basis: RoomSurfacePlaneBasis
  readonly normal: SpatialPoint
  readonly planeConstant: number
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

function constrainSupportToStructuralBoundaries(
  points: readonly LocalPoint[],
  constraints: readonly BoundaryConstraint[],
  toleranceMeters: number,
): LocalPoint[] {
  if (points.length < 3 || constraints.length === 0) {
    return [...points]
  }
  const constrained = points.filter((point) => constraints.every((constraint) => {
    const lineLength = localDistance(constraint.start, constraint.end)
    if (lineLength <= Number.EPSILON) {
      return true
    }
    const pointSide = localCross(constraint.start, constraint.end, point)
    const supportSide = points.reduce((total, supportPoint) => total + localCross(constraint.start, constraint.end, supportPoint), 0) / points.length
    const side = Math.abs(supportSide) <= toleranceMeters * lineLength
      ? 0
      : Math.sign(supportSide)
    return side === 0 || side * pointSide >= -toleranceMeters * lineLength
  }))
  return constrained.length >= 3 ? constrained : [...points]
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

function createFallbackSupportPoints(surface: StructuralSurfaceCandidate): SpatialPoint[] {
  const { minU, maxU, minV, maxV } = surface.localBounds
  return [
    add(surface.centroid, add(scale(surface.tangentU, minU), scale(surface.tangentV, minV))),
    add(surface.centroid, add(scale(surface.tangentU, maxU), scale(surface.tangentV, minV))),
    add(surface.centroid, add(scale(surface.tangentU, maxU), scale(surface.tangentV, maxV))),
    add(surface.centroid, add(scale(surface.tangentU, minU), scale(surface.tangentV, maxV))),
  ].filter(isFinitePoint)
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
): BoundaryConstraint {
  return {
    id: edge.id,
    start: worldToLocal(edge.start, basis),
    end: worldToLocal(edge.end, basis),
    worldStart: edge.start,
    worldEnd: edge.end,
    sourceIds: [edge.id, edge.sourceIntersectionId],
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
  const constraints = boundary.edges
    .filter((edge) => edge.status !== 'rejected' && edgeInvolvesSurface(edge, surface.planeId))
    .map((edge) => projectBoundaryConstraint(edge, basisData.basis))
  const anchors = boundary.corners
    .filter((corner) => cornerInvolvesSurface(corner, surface.planeId))
    .map((corner) => ({
      point: worldToLocal(corner.position, basisData.basis),
      world: corner.position,
      source: 'corner' as const,
      sourceIds: [corner.id, ...corner.sourceEdgeIds, ...corner.sourceIntersectionIds],
    }))
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
    fallbackPoints: supportPoints.length > 0 ? [] : createFallbackSupportPoints(surface),
  }
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
  return (pointMatches(first, constraint.start, tolerance) && pointMatches(second, constraint.end, tolerance)) ||
    (pointMatches(first, constraint.end, tolerance) && pointMatches(second, constraint.start, tolerance))
}

function nearestAnchor(
  point: LocalPoint,
  anchors: readonly LocalAnchor[],
  tolerance: number,
): LocalAnchor | null {
  let closest: LocalAnchor | null = null
  let closestDistance = tolerance
  for (const anchor of anchors) {
    const candidateDistance = localDistance(point, anchor.point)
    const sameDistancePrefersCanonicalCorner = closest !== null &&
      Math.abs(candidateDistance - closestDistance) <= 1e-9 &&
      anchor.source === 'corner' && closest.source !== 'corner'
    if (candidateDistance < closestDistance || sameDistancePrefersCanonicalCorner || closest === null) {
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
  config: RoomSurfaceConstructionConfig,
): RoomSurfacePatchBoundary[] {
  return points.map((point, index) => {
    const nextIndex = (index + 1) % points.length
    const nextPoint = points[nextIndex]
    const constraint = context.constraints.find((candidate) => constraintMatchesPolygonEdge(point, nextPoint, candidate, config.boundaryMatchToleranceMeters))
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

function buildPatch(
  surface: ConstructibleSurface,
  context: SurfaceConstructionContext,
  config: RoomSurfaceConstructionConfig,
): RoomSurfacePatch | null {
  const constrainedSupport = constrainSupportToStructuralBoundaries(
    context.projectedSupport,
    context.constraints,
    config.boundaryMatchToleranceMeters,
  )
  const supportPoints = robustSupportPoints(constrainedSupport, config.supportTrimFraction)
  const fallbackPoints = context.fallbackPoints.map((point) => worldToLocal(point, context.basis))
  const candidatePoints = [...supportPoints, ...fallbackPoints, ...context.anchors.map((anchor) => anchor.point)]
  const hull = convexHull(candidatePoints)
  const anchoredHull = snapStructuralAnchors(hull, context.anchors, config.boundaryMatchToleranceMeters)
  const localVertices = removeDuplicateAndCollinearVertices(anchoredHull, config.vertexMergeToleranceMeters)
  if (localVertices.length < 3 || Math.abs(signedArea(localVertices)) < config.minimumPatchAreaMetersSquared) {
    return null
  }
  const triangleIndices = triangulatePolygon(localVertices)
  if (triangleIndices.length < 3) {
    return null
  }
  const worldVertices = localVertices.map((point) => nearestAnchor(point, context.anchors, config.boundaryMatchToleranceMeters)?.world ?? localToWorld(point, context.basis))
  if (worldVertices.some((point) => !isFinitePoint(point))) {
    return null
  }
  const boundaryProvenance = createPolygonBoundaryProvenance(localVertices, worldVertices, context, config)
  const canonicalCornerCount = new Set(
    localVertices.flatMap((point) => context.anchors
      .filter((anchor) => anchor.source === 'corner' && pointMatches(point, anchor.point, config.boundaryMatchToleranceMeters))
      .map((anchor) => anchor.sourceIds[0])
      .filter((sourceId): sourceId is string => Boolean(sourceId))),
  ).size
  const structuralEdgeCount = boundaryProvenance.filter((boundary) => boundary.provenance === 'structural-intersection').length
  const supportDerivedEdgeCount = boundaryProvenance.filter((boundary) => boundary.provenance === 'observed-support-extent' || boundary.provenance === 'partial-completion').length
  const areaMetersSquared = Math.abs(signedArea(localVertices))
  const maximumPlaneResidualMeters = worldVertices.reduce((maximum, point) => Math.max(
    maximum,
    Math.abs(dot(context.normalizedNormal, point) - context.normalizedPlaneConstant),
  ), 0)
  const maximumBasisRoundTripResidualMeters = worldVertices.reduce((maximum, point) => {
    const roundTrip = localToWorld(worldToLocal(point, context.basis), context.basis)
    return Math.max(maximum, magnitude(subtract(roundTrip, point)))
  }, 0)
  const completionStatus = classifyCompletion(boundaryProvenance, context.supportPoints.length)
  return Object.freeze({
    id: `room-surface-${surface.role}-${surface.planeId}`,
    sourceSurfaceId: surface.planeId,
    role: surface.role,
    vertices3D: worldVertices,
    vertices2DLocal: localVertices,
    triangleIndices,
    boundaryProvenance,
    confidence: calculateConfidence(surface, context.supportPoints.length, boundaryProvenance, canonicalCornerCount),
    completionStatus,
    areaMetersSquared,
    supportPointCount: context.supportPoints.length,
    normal: context.normalizedNormal,
    planeConstant: context.normalizedPlaneConstant,
    basis: context.basis,
    structuralEdgeCount,
    supportDerivedEdgeCount,
    canonicalCornerCount,
    maximumPlaneResidualMeters,
    maximumBasisRoundTripResidualMeters,
    triangulationValid: triangleIndices.length >= 3 && triangleIndices.length % 3 === 0,
  })
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
    const patchesInSurfaceOrder = contexts.map(({ surface, context }) => context ? buildPatch(surface, context, this.config) : null)
    const polygonConstructionMs = now() - polygonStartedAt

    const triangulationStartedAt = now()
    const patches = patchesInSurfaceOrder.flatMap((patch) => patch ? [patch] : [])
    const triangulationMs = now() - triangulationStartedAt
    const skippedSurfaceIds = contexts.flatMap(({ surface }, index) => patchesInSurfaceOrder[index] ? [] : [surface.planeId])
    const supportPointCounts = Object.fromEntries(contexts.map(({ surface, context }) => [surface.planeId, context?.supportPoints.length ?? 0]))
    const structuralBoundaryCounts = Object.fromEntries(contexts.map(({ surface, context }) => [surface.planeId, context?.constraints.length ?? 0]))
    const totalMs = now() - startedAt
    const warnings = skippedSurfaceIds.map((surfaceId) => `No valid bounded polygon could be constructed for ${surfaceId}.`)
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

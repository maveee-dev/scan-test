import type { SpatialPoint } from '../../scanner/types'
import type {
  ObservedWallBoundary,
  RoomBoundaryResult,
  RoomStructureInterpretationResult,
  StructuralBoundaryComponent,
  StructuralBoundaryEdge,
  StructuralBoundaryExtension,
  StructuralBoundaryNode,
  StructuralBoundaryStatus,
  StructuralCorner,
  StructuralCornerCandidateDiagnostic,
  StructuralCornerEdgeEvaluation,
  StructuralCornerSupport,
  StructuralIntersectionResult,
  StructuralIntersectionCandidate,
  StructuralMultiSurfaceCoherenceDiagnostic,
  StructuralPlaneResidual,
  StructuralSurfaceCandidate,
} from '../types'
import {
  computeThreePlaneIntersectionPoint,
  distancePointToLine,
  type NormalizedSupportPlane,
} from './structuralSupportGeometry'

export interface RoomBoundaryReconstructionConfig {
  endpointClusterToleranceMeters: number
  maximumEndpointExtensionMeters: number
  maximumSegmentPointDistanceMeters: number
  maximumSegmentGapMeters: number
  minimumThreePlaneDeterminant: number
  maximumPlaneResidualMeters: number
  /** Separate bounded allowance for a validated triad corner beyond M7.2's robust interval. */
  maximumStructuralCornerExtensionMeters: number
  /** Numerical line/plane consistency epsilon, not a scan-quality tolerance. */
  structuralCornerNumericalEpsilonMeters: number
  /** Minimum finalized-support samples reported by M7.1 near each triad corner. */
  minimumStructuralCornerSupportCountPerSurface: number
  /** Lower support floor for retaining a partial, explicitly uncertain corner. */
  minimumPartialStructuralCornerSupportCountPerSurface: number
}

export const DEFAULT_ROOM_BOUNDARY_RECONSTRUCTION_CONFIG: RoomBoundaryReconstructionConfig = {
  endpointClusterToleranceMeters: 0.12,
  maximumEndpointExtensionMeters: 0.12,
  maximumSegmentPointDistanceMeters: 0.12,
  maximumSegmentGapMeters: 0.12,
  minimumThreePlaneDeterminant: 0.001,
  maximumPlaneResidualMeters: 0.1,
  maximumStructuralCornerExtensionMeters: 0.25,
  structuralCornerNumericalEpsilonMeters: 1e-5,
  minimumStructuralCornerSupportCountPerSurface: 2,
  minimumPartialStructuralCornerSupportCountPerSurface: 1,
}

interface NormalizedPlane {
  surface: StructuralSurfaceCandidate
  normal: SpatialPoint
  planeConstant: number
}

interface BoundaryEdgeDraft {
  edge: StructuralBoundaryEdge
}

interface EndpointObservation {
  edgeIndex: number
  edgeId: string
  endpoint: 'start' | 'end'
  position: SpatialPoint
  confidence: number
  surfaceIds: readonly string[]
}

interface EndpointCluster {
  endpointIndices: number[]
  position: SpatialPoint
  surfaceIds: string[]
}

interface SegmentPointInfo {
  distanceMeters: number
  extensionMeters: number
}

interface CornerSolution {
  position: SpatialPoint
  planeResiduals: StructuralPlaneResidual[]
  extensionDistances: StructuralBoundaryExtension[]
  segmentGapMeters: number
  status: StructuralBoundaryStatus
  confidence: number
}

interface TriadCornerCandidate {
  readonly diagnostic: StructuralCornerCandidateDiagnostic
  readonly edgeEndpointNodeIds: ReadonlyMap<string, string>
}

const STATUS_ORDER: Record<StructuralBoundaryStatus, number> = {
  supported: 0,
  partial: 1,
  inferred: 2,
  rejected: 3,
}

function timestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function dot(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function subtract(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }
}

function addScaled(first: SpatialPoint, second: SpatialPoint, scalar: number): SpatialPoint {
  return {
    x: first.x + second.x * scalar,
    y: first.y + second.y * scalar,
    z: first.z + second.z * scalar,
  }
}

function scale(point: SpatialPoint, scalar: number): SpatialPoint {
  return { x: point.x * scalar, y: point.y * scalar, z: point.z * scalar }
}

function magnitude(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function distance(first: SpatialPoint, second: SpatialPoint): number {
  return magnitude(subtract(first, second))
}

function isFinitePoint(point: SpatialPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((first, second) => first.localeCompare(second))
}

function normalizePlane(surface: StructuralSurfaceCandidate): NormalizedPlane | null {
  const normalLength = magnitude(surface.normal)
  if (!Number.isFinite(normalLength) || normalLength <= Number.EPSILON) {
    return null
  }
  const normal = scale(surface.normal, 1 / normalLength)
  const planeConstant = surface.planeConstant / normalLength
  return isFinitePoint(normal) && Number.isFinite(planeConstant)
    ? { surface, normal, planeConstant }
    : null
}

function makeSelectedSurfaceMap(
  interpretation: RoomStructureInterpretationResult,
): Map<string, StructuralSurfaceCandidate> {
  return new Map(
    interpretation.surfaces
      .filter((surface) => surface.selection === 'selected')
      .map((surface) => [surface.planeId, surface]),
  )
}

function createBoundaryEdgeDrafts(
  interpretation: RoomStructureInterpretationResult,
  intersections: StructuralIntersectionResult,
): { drafts: BoundaryEdgeDraft[]; rejectedIntersectionCount: number } {
  const selectedIds = new Set(makeSelectedSurfaceMap(interpretation).keys())
  const candidates = intersections.intersections
    .filter((intersection) => intersection.status !== 'rejected' && intersection.segment !== null)
    .filter((intersection) => selectedIds.has(intersection.surfaceAId) && selectedIds.has(intersection.surfaceBId))
    .sort((first, second) => STATUS_ORDER[first.status === 'supported' ? 'supported' : 'partial'] - STATUS_ORDER[second.status === 'supported' ? 'supported' : 'partial'] ||
      first.type.localeCompare(second.type) || first.id.localeCompare(second.id))
  const drafts = candidates.flatMap((intersection) => {
    if (!intersection.segment) {
      return []
    }
    const edge: StructuralBoundaryEdge = {
      id: `boundary-${intersection.id}`,
      type: intersection.type,
      surfaceAId: intersection.surfaceAId,
      surfaceBId: intersection.surfaceBId,
      sourceIntersectionId: intersection.id,
      start: intersection.segment.start,
      end: intersection.segment.end,
      lengthMeters: intersection.lengthMeters,
      confidence: intersection.confidence,
      status: intersection.status === 'supported' ? 'supported' : 'partial',
      startNodeId: null,
      endNodeId: null,
      extensionDistances: [],
    }
    return [{ edge }]
  })
  return {
    drafts,
    rejectedIntersectionCount: intersections.intersections.filter((intersection) => intersection.status === 'rejected').length,
  }
}

function clusterContainsEndpointFromEdge(
  cluster: EndpointCluster,
  endpointIndex: number,
  endpoints: readonly EndpointObservation[],
): boolean {
  const edgeId = endpoints[endpointIndex].edgeId
  return cluster.endpointIndices.some((index) => endpoints[index].edgeId === edgeId)
}

function recalculateClusterPosition(
  cluster: EndpointCluster,
  endpoints: readonly EndpointObservation[],
): SpatialPoint {
  let weightTotal = 0
  let weighted = { x: 0, y: 0, z: 0 }
  for (const endpointIndex of cluster.endpointIndices) {
    const endpoint = endpoints[endpointIndex]
    const weight = Math.max(0.1, endpoint.confidence)
    weighted = addScaled(weighted, endpoint.position, weight)
    weightTotal += weight
  }
  return weightTotal > 0 ? scale(weighted, 1 / weightTotal) : endpoints[cluster.endpointIndices[0]].position
}

function createEndpointClusters(endpoints: readonly EndpointObservation[], toleranceMeters: number): EndpointCluster[] {
  const clusters: EndpointCluster[] = []
  endpoints.forEach((endpoint, endpointIndex) => {
    let matchingCluster: EndpointCluster | null = null
    for (const cluster of clusters) {
      if (clusterContainsEndpointFromEdge(cluster, endpointIndex, endpoints)) {
        continue
      }
      if (!cluster.surfaceIds.some((surfaceId) => endpoint.surfaceIds.includes(surfaceId))) {
        continue
      }
      const allMembersAreClose = cluster.endpointIndices.every((memberIndex) =>
        distance(endpoints[memberIndex].position, endpoint.position) <= toleranceMeters)
      if (allMembersAreClose) {
        matchingCluster = cluster
        break
      }
    }
    if (!matchingCluster) {
      clusters.push({
        endpointIndices: [endpointIndex],
        position: endpoint.position,
        surfaceIds: [...endpoint.surfaceIds],
      })
      return
    }
    matchingCluster.endpointIndices.push(endpointIndex)
    matchingCluster.surfaceIds = uniqueSorted([...matchingCluster.surfaceIds, ...endpoint.surfaceIds])
    matchingCluster.position = recalculateClusterPosition(matchingCluster, endpoints)
  })
  return clusters
}

function pointToSegmentInfo(point: SpatialPoint, start: SpatialPoint, end: SpatialPoint): SegmentPointInfo {
  const direction = subtract(end, start)
  const lengthSquared = dot(direction, direction)
  if (lengthSquared <= Number.EPSILON) {
    return { distanceMeters: distance(point, start), extensionMeters: 0 }
  }
  const rawParameter = dot(subtract(point, start), direction) / lengthSquared
  const clampedParameter = clamp(rawParameter, 0, 1)
  const closest = addScaled(start, direction, clampedParameter)
  const segmentLength = Math.sqrt(lengthSquared)
  const extensionMeters = rawParameter < 0
    ? -rawParameter * segmentLength
    : rawParameter > 1 ? (rawParameter - 1) * segmentLength : 0
  return {
    distanceMeters: distance(point, closest),
    extensionMeters,
  }
}

function segmentSegmentDistance(
  firstStart: SpatialPoint,
  firstEnd: SpatialPoint,
  secondStart: SpatialPoint,
  secondEnd: SpatialPoint,
): number {
  const firstDirection = subtract(firstEnd, firstStart)
  const secondDirection = subtract(secondEnd, secondStart)
  const betweenStarts = subtract(firstStart, secondStart)
  const a = dot(firstDirection, firstDirection)
  const e = dot(secondDirection, secondDirection)
  const f = dot(secondDirection, betweenStarts)
  const epsilon = 1e-10

  if (a <= epsilon && e <= epsilon) {
    return distance(firstStart, secondStart)
  }
  if (a <= epsilon) {
    return pointToSegmentInfo(firstStart, secondStart, secondEnd).distanceMeters
  }
  if (e <= epsilon) {
    return pointToSegmentInfo(secondStart, firstStart, firstEnd).distanceMeters
  }

  const b = dot(firstDirection, secondDirection)
  const c = dot(firstDirection, betweenStarts)
  const denominator = a * e - b * b
  let firstParameter = denominator > epsilon ? clamp((b * f - c * e) / denominator, 0, 1) : 0
  let secondParameter = (b * firstParameter + f) / e
  if (secondParameter < 0) {
    secondParameter = 0
    firstParameter = clamp(-c / a, 0, 1)
  } else if (secondParameter > 1) {
    secondParameter = 1
    firstParameter = clamp((b - c) / a, 0, 1)
  }
  const firstClosest = addScaled(firstStart, firstDirection, firstParameter)
  const secondClosest = addScaled(secondStart, secondDirection, secondParameter)
  return distance(firstClosest, secondClosest)
}

function calculateClusterSegmentGap(
  cluster: EndpointCluster,
  endpoints: readonly EndpointObservation[],
  edgeById: Map<string, StructuralBoundaryEdge>,
): number {
  const edgeIds = uniqueSorted(cluster.endpointIndices.map((index) => endpoints[index].edgeId))
  let maximumGap = 0
  for (let firstIndex = 0; firstIndex < edgeIds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < edgeIds.length; secondIndex += 1) {
      const first = edgeById.get(edgeIds[firstIndex])
      const second = edgeById.get(edgeIds[secondIndex])
      if (!first || !second) {
        continue
      }
      maximumGap = Math.max(maximumGap, segmentSegmentDistance(first.start, first.end, second.start, second.end))
    }
  }
  return maximumGap
}

function solveThreePlanes(
  first: NormalizedPlane,
  second: NormalizedPlane,
  third: NormalizedPlane,
  minimumDeterminant: number,
): SpatialPoint | null {
  const result = computeThreePlaneIntersectionPoint(
    first as NormalizedSupportPlane,
    second as NormalizedSupportPlane,
    third as NormalizedSupportPlane,
    minimumDeterminant,
  )
  return result.point
}

function calculatePlaneResiduals(
  point: SpatialPoint,
  surfaceIds: readonly string[],
  planesById: ReadonlyMap<string, NormalizedPlane>,
): StructuralPlaneResidual[] {
  return surfaceIds.flatMap((surfaceId) => {
    const plane = planesById.get(surfaceId)
    if (!plane) {
      return []
    }
    return [{ surfaceId, residualMeters: Math.abs(dot(plane.normal, point) - plane.planeConstant) }]
  })
}

function weightedEndpointPosition(
  cluster: EndpointCluster,
  endpoints: readonly EndpointObservation[],
): SpatialPoint {
  return recalculateClusterPosition(cluster, endpoints)
}

function evaluateCornerPoint(
  point: SpatialPoint,
  cluster: EndpointCluster,
  endpoints: readonly EndpointObservation[],
  edgeById: Map<string, StructuralBoundaryEdge>,
  planesById: Map<string, NormalizedPlane>,
  config: RoomBoundaryReconstructionConfig,
): { extensions: StructuralBoundaryExtension[]; maximumDistance: number; valid: boolean } {
  const extensions: StructuralBoundaryExtension[] = []
  let maximumDistance = 0
  let valid = true
  for (const edgeId of uniqueSorted(cluster.endpointIndices.map((index) => endpoints[index].edgeId))) {
    const edge = edgeById.get(edgeId)
    if (!edge) {
      valid = false
      continue
    }
    const info = pointToSegmentInfo(point, edge.start, edge.end)
    maximumDistance = Math.max(maximumDistance, info.distanceMeters)
    extensions.push({ edgeId, distanceMeters: info.extensionMeters })
    if (info.distanceMeters > config.maximumSegmentPointDistanceMeters ||
      info.extensionMeters > config.maximumEndpointExtensionMeters) {
      valid = false
    }
  }
  const residuals = calculatePlaneResiduals(point, cluster.surfaceIds, planesById)
  if (residuals.some((residual) => residual.residualMeters > config.maximumPlaneResidualMeters)) {
    valid = false
  }
  return { extensions, maximumDistance, valid }
}

function scoreCornerSolution(
  edgeIds: readonly string[],
  edgeById: Map<string, StructuralBoundaryEdge>,
  segmentGapMeters: number,
  maximumDistanceMeters: number,
  maximumExtensionMeters: number,
  planeResiduals: readonly StructuralPlaneResidual[],
  allEdgesSupported: boolean,
  config: RoomBoundaryReconstructionConfig,
): { status: StructuralBoundaryStatus; confidence: number } {
  const edgeConfidence = edgeIds.length === 0
    ? 0
    : edgeIds.reduce((total, edgeId) => total + (edgeById.get(edgeId)?.confidence ?? 0), 0) / edgeIds.length
  const gapQuality = clamp(1 - segmentGapMeters / Math.max(config.maximumSegmentGapMeters, Number.EPSILON), 0, 1)
  const distanceQuality = clamp(1 - maximumDistanceMeters / Math.max(config.maximumSegmentPointDistanceMeters, Number.EPSILON), 0, 1)
  const extensionQuality = clamp(1 - maximumExtensionMeters / Math.max(config.maximumEndpointExtensionMeters, Number.EPSILON), 0, 1)
  const residualQuality = planeResiduals.length === 0
    ? 0
    : planeResiduals.reduce((total, residual) => total + clamp(1 - residual.residualMeters / Math.max(config.maximumPlaneResidualMeters, Number.EPSILON), 0, 1), 0) / planeResiduals.length
  const status: StructuralBoundaryStatus = allEdgesSupported &&
    gapQuality > 0 && distanceQuality > 0 && extensionQuality > 0 && residualQuality > 0.25
    ? 'supported'
    : 'partial'
  return {
    status,
    confidence: clamp(
      edgeConfidence * 0.4 + gapQuality * 0.2 + distanceQuality * 0.15 + extensionQuality * 0.1 + residualQuality * 0.15,
      0,
      1,
    ),
  }
}

function solveCorner(
  cluster: EndpointCluster,
  endpoints: readonly EndpointObservation[],
  edgeById: Map<string, StructuralBoundaryEdge>,
  planesById: Map<string, NormalizedPlane>,
  config: RoomBoundaryReconstructionConfig,
): CornerSolution | null {
  const edgeIds = uniqueSorted(cluster.endpointIndices.map((index) => endpoints[index].edgeId))
  if (edgeIds.length < 2 || cluster.surfaceIds.length < 3) {
    return null
  }

  const allEdgesSupported = edgeIds.every((edgeId) => edgeById.get(edgeId)?.status === 'supported')
  const segmentGapMeters = calculateClusterSegmentGap(cluster, endpoints, edgeById)
  let bestSolution: CornerSolution | null = null
  for (let firstIndex = 0; firstIndex < cluster.surfaceIds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < cluster.surfaceIds.length; secondIndex += 1) {
      for (let thirdIndex = secondIndex + 1; thirdIndex < cluster.surfaceIds.length; thirdIndex += 1) {
        const first = planesById.get(cluster.surfaceIds[firstIndex])
        const second = planesById.get(cluster.surfaceIds[secondIndex])
        const third = planesById.get(cluster.surfaceIds[thirdIndex])
        if (!first || !second || !third) {
          continue
        }
        const point = solveThreePlanes(first, second, third, config.minimumThreePlaneDeterminant)
        if (!point) {
          continue
        }
        const evaluation = evaluateCornerPoint(point, cluster, endpoints, edgeById, planesById, config)
        if (!evaluation.valid) {
          continue
        }
        const planeResiduals = calculatePlaneResiduals(point, cluster.surfaceIds, planesById)
        const maximumExtensionMeters = Math.max(...evaluation.extensions.map((extension) => extension.distanceMeters), 0)
        const quality = scoreCornerSolution(
          edgeIds,
          edgeById,
          segmentGapMeters,
          evaluation.maximumDistance,
          maximumExtensionMeters,
          planeResiduals,
          allEdgesSupported,
          config,
        )
        const solution: CornerSolution = {
          position: point,
          planeResiduals,
          extensionDistances: evaluation.extensions,
          segmentGapMeters,
          ...quality,
        }
        if (!bestSolution || solution.confidence > bestSolution.confidence) {
          bestSolution = solution
        }
      }
    }
  }

  if (bestSolution) {
    return bestSolution
  }

  const fallbackPosition = weightedEndpointPosition(cluster, endpoints)
  const fallbackEvaluation = evaluateCornerPoint(fallbackPosition, cluster, endpoints, edgeById, planesById, config)
  if (!fallbackEvaluation.valid) {
    return null
  }
  const planeResiduals = calculatePlaneResiduals(fallbackPosition, cluster.surfaceIds, planesById)
  const maximumExtensionMeters = Math.max(...fallbackEvaluation.extensions.map((extension) => extension.distanceMeters), 0)
  const quality = scoreCornerSolution(
    edgeIds,
    edgeById,
    segmentGapMeters,
    fallbackEvaluation.maximumDistance,
    maximumExtensionMeters,
    planeResiduals,
    allEdgesSupported,
    config,
  )
  return {
    position: fallbackPosition,
    planeResiduals,
    extensionDistances: fallbackEvaluation.extensions,
    segmentGapMeters,
    status: quality.status === 'supported' ? 'partial' : quality.status,
    confidence: quality.confidence * 0.85,
  }
}

function intersectionMatchesPair(
  intersection: StructuralIntersectionCandidate,
  firstSurfaceId: string,
  secondSurfaceId: string,
): boolean {
  return (intersection.surfaceAId === firstSurfaceId && intersection.surfaceBId === secondSurfaceId) ||
    (intersection.surfaceAId === secondSurfaceId && intersection.surfaceBId === firstSurfaceId)
}

function findIntersectionForPair(
  intersections: StructuralIntersectionResult,
  firstSurfaceId: string,
  secondSurfaceId: string,
  preferredType: StructuralIntersectionCandidate['type'],
): StructuralIntersectionCandidate | null {
  const candidates = intersections.intersections
    .filter((intersection) => intersectionMatchesPair(intersection, firstSurfaceId, secondSurfaceId))
    .sort((first, second) => {
      const firstPreferred = first.type === preferredType ? 0 : 1
      const secondPreferred = second.type === preferredType ? 0 : 1
      const firstStatus = first.status === 'supported' ? 0 : first.status === 'partial' ? 1 : 2
      const secondStatus = second.status === 'supported' ? 0 : second.status === 'partial' ? 1 : 2
      return firstPreferred - secondPreferred || firstStatus - secondStatus ||
        second.confidence - first.confidence || first.id.localeCompare(second.id)
    })
  return candidates[0] ?? null
}

function getTriadKey(
  candidatePlaneId: string,
  existingWallPlaneId: string,
  horizontalPlaneId: string,
): string {
  return `${candidatePlaneId}/${existingWallPlaneId}/${horizontalPlaneId}`
}

function hasCompleteEndpointCluster(
  edgeIds: readonly string[],
  clusters: readonly EndpointCluster[],
  endpoints: readonly EndpointObservation[],
): boolean {
  return clusters.some((cluster) => {
    const clusterEdgeIds = new Set(cluster.endpointIndices.map((index) => endpoints[index].edgeId))
    return edgeIds.every((edgeId) => clusterEdgeIds.has(edgeId))
  })
}

function getLineParameter(point: SpatialPoint, line: { origin: SpatialPoint; direction: SpatialPoint }): number | null {
  const directionLength = magnitude(line.direction)
  if (!Number.isFinite(directionLength) || directionLength <= Number.EPSILON) {
    return null
  }
  return dot(subtract(point, line.origin), scale(line.direction, 1 / directionLength))
}

function evaluateStructuralCornerEdge(
  intersection: StructuralIntersectionCandidate,
  point: SpatialPoint,
  config: RoomBoundaryReconstructionConfig,
): StructuralCornerEdgeEvaluation {
  const status: StructuralBoundaryStatus = intersection.status === 'supported' ? 'supported' :
    intersection.status === 'partial' ? 'partial' : 'rejected'
  if (!intersection.line) {
    return {
      edgeId: `boundary-${intersection.id}`,
      sourceIntersectionId: intersection.id,
      status,
      tCorner: null,
      tStart: null,
      tEnd: null,
      extensionBeforeMeters: 0,
      extensionAfterMeters: 0,
      extensionDistanceMeters: 0,
      nearestFiniteEndpointDistanceMeters: Infinity,
      lineDistanceMeters: null,
      withinStructuralExtensionLimit: false,
      reason: 'intersection line is unavailable',
    }
  }
  const tCorner = getLineParameter(point, intersection.line)
  const segmentStartParameter = intersection.segment
    ? getLineParameter(intersection.segment.start, intersection.line)
    : null
  const segmentEndParameter = intersection.segment
    ? getLineParameter(intersection.segment.end, intersection.line)
    : null
  const tStart = intersection.tStart ?? segmentStartParameter
  const tEnd = intersection.tEnd ?? segmentEndParameter
  const minimum = tStart !== null && tEnd !== null ? Math.min(tStart, tEnd) : null
  const maximum = tStart !== null && tEnd !== null ? Math.max(tStart, tEnd) : null
  const extensionBeforeMeters = tCorner !== null && minimum !== null ? Math.max(0, minimum - tCorner) : 0
  const extensionAfterMeters = tCorner !== null && maximum !== null ? Math.max(0, tCorner - maximum) : 0
  const extensionDistanceMeters = Math.max(extensionBeforeMeters, extensionAfterMeters)
  const nearestFiniteEndpointDistanceMeters = tCorner !== null && minimum !== null && maximum !== null
    ? Math.min(Math.abs(tCorner - minimum), Math.abs(tCorner - maximum))
    : Infinity
  const lineDistanceMeters = distancePointToLine(point, intersection.line)
  const withinStructuralExtensionLimit = tCorner !== null && minimum !== null && maximum !== null &&
    Number.isFinite(lineDistanceMeters) &&
    lineDistanceMeters <= config.structuralCornerNumericalEpsilonMeters &&
    extensionDistanceMeters <= config.maximumStructuralCornerExtensionMeters
  return {
    edgeId: `boundary-${intersection.id}`,
    sourceIntersectionId: intersection.id,
    status,
    tCorner,
    tStart: minimum,
    tEnd: maximum,
    extensionBeforeMeters,
    extensionAfterMeters,
    extensionDistanceMeters,
    nearestFiniteEndpointDistanceMeters,
    lineDistanceMeters,
    withinStructuralExtensionLimit,
    reason: !intersection.segment
      ? 'finite source segment is unavailable'
      : !withinStructuralExtensionLimit
        ? 'corner is outside the bounded structural extension or line-consistency limit'
        : null,
  }
}

function createCornerSupport(
  surfaceIds: readonly string[],
  counts: readonly number[],
): StructuralCornerSupport[] {
  return surfaceIds.map((surfaceId, index) => ({
    surfaceId,
    supportCount: counts[index] ?? 0,
  }))
}

function calculateTriadSegmentGap(edges: readonly StructuralIntersectionCandidate[]): number {
  const segments = edges.flatMap((edge) => edge.segment ? [edge.segment] : [])
  let maximumGap = 0
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      maximumGap = Math.max(
        maximumGap,
        segmentSegmentDistance(
          segments[firstIndex].start,
          segments[firstIndex].end,
          segments[secondIndex].start,
          segments[secondIndex].end,
        ),
      )
    }
  }
  return maximumGap
}

function calculateTriadCornerConfidence(
  triad: StructuralMultiSurfaceCoherenceDiagnostic,
  surfaces: readonly StructuralSurfaceCandidate[],
  edges: readonly StructuralIntersectionCandidate[],
  edgeEvaluations: readonly StructuralCornerEdgeEvaluation[],
  supportNearCorner: readonly StructuralCornerSupport[],
  segmentGapMeters: number,
  config: RoomBoundaryReconstructionConfig,
  status: StructuralBoundaryStatus,
): number {
  const edgeConfidence = edges.length > 0
    ? edges.reduce((total, edge) => total + edge.confidence, 0) / edges.length
    : 0
  const surfaceConfidence = surfaces.length > 0
    ? Math.pow(surfaces.reduce((total, surface) => total * clamp(surface.roleConfidence, 0, 1), 1), 1 / surfaces.length)
    : 0
  const supportQuality = supportNearCorner.length > 0
    ? Math.min(...supportNearCorner.map((support) => clamp(support.supportCount / 8, 0, 1)))
    : 0
  const maximumExtensionMeters = Math.max(...edgeEvaluations.map((evaluation) => evaluation.extensionDistanceMeters), 0)
  const extensionQuality = clamp(1 - maximumExtensionMeters / Math.max(config.maximumStructuralCornerExtensionMeters, Number.EPSILON), 0, 1)
  const lineQuality = edgeEvaluations.length > 0
    ? Math.min(...edgeEvaluations.map((evaluation) => evaluation.lineDistanceMeters === null
      ? 0
      : clamp(1 - evaluation.lineDistanceMeters / Math.max(config.structuralCornerNumericalEpsilonMeters, Number.EPSILON), 0, 1)))
    : 0
  const gapQuality = clamp(1 - segmentGapMeters / Math.max(config.maximumSegmentGapMeters, Number.EPSILON), 0, 1)
  const statusFactor = status === 'supported' ? 1 : status === 'partial' ? 0.68 : 0.2
  return clamp(
    statusFactor * (
      edgeConfidence * 0.25 +
      surfaceConfidence * 0.2 +
      supportQuality * 0.2 +
      extensionQuality * 0.15 +
      lineQuality * 0.1 +
      gapQuality * 0.05 +
      triad.triplePointSupportScore * 0.05
    ),
    0,
    1,
  )
}

function createTriadCornerCandidate(
  triad: StructuralMultiSurfaceCoherenceDiagnostic,
  intersections: StructuralIntersectionResult,
  selectedSurfaceMap: ReadonlyMap<string, StructuralSurfaceCandidate>,
  planesById: ReadonlyMap<string, NormalizedPlane>,
  clusters: readonly EndpointCluster[],
  endpoints: readonly EndpointObservation[],
  config: RoomBoundaryReconstructionConfig,
): TriadCornerCandidate {
  const surfaceIds = uniqueSorted([triad.candidatePlaneId, triad.existingWallPlaneId, triad.horizontalPlaneId])
  const horizontalSurface = selectedSurfaceMap.get(triad.horizontalPlaneId)
  const horizontalType: StructuralIntersectionCandidate['type'] = horizontalSurface?.role === 'floor'
    ? 'wall-floor'
    : 'wall-ceiling'
  const sourceIntersectionCandidates = [
    findIntersectionForPair(intersections, triad.candidatePlaneId, triad.existingWallPlaneId, 'wall-wall'),
    findIntersectionForPair(intersections, triad.candidatePlaneId, triad.horizontalPlaneId, horizontalType),
    findIntersectionForPair(intersections, triad.existingWallPlaneId, triad.horizontalPlaneId, horizontalType),
  ]
  const sourceEdges = sourceIntersectionCandidates.filter((edge): edge is StructuralIntersectionCandidate => edge !== null)
  const sourceEdgeIds = sourceEdges.map((edge) => `boundary-${edge.id}`)
  const sourceIntersectionIds = sourceEdges.map((edge) => edge.id)
  const triadKey = getTriadKey(triad.candidatePlaneId, triad.existingWallPlaneId, triad.horizontalPlaneId)
  const candidateId = `corner-candidate-${triadKey.replaceAll('/', '-')}`
  const endpointClusterCandidate = hasCompleteEndpointCluster(sourceEdgeIds, clusters, endpoints)
  const firstPlane = planesById.get(triad.candidatePlaneId)
  const secondPlane = planesById.get(triad.existingWallPlaneId)
  const thirdPlane = planesById.get(triad.horizontalPlaneId)
  let point: SpatialPoint | null = null
  let threePlaneSolverStatus: StructuralCornerCandidateDiagnostic['threePlaneSolverStatus'] = 'not-attempted'
  let determinant: number | null = null
  if (firstPlane && secondPlane && thirdPlane) {
    const solveResult = computeThreePlaneIntersectionPoint(firstPlane, secondPlane, thirdPlane, config.minimumThreePlaneDeterminant)
    determinant = solveResult.determinant
    point = solveResult.point
    threePlaneSolverStatus = point ? 'solved' : 'unstable'
  }
  const edgeEvaluations = point
    ? sourceEdges.map((edge) => evaluateStructuralCornerEdge(edge, point, config))
    : []
  const supportNearCorner = createCornerSupport(
    [triad.candidatePlaneId, triad.existingWallPlaneId, triad.horizontalPlaneId],
    [
      triad.triplePointSupportCounts.candidate,
      triad.triplePointSupportCounts.existing,
      triad.triplePointSupportCounts.horizontal,
    ],
  )
  const planeResiduals = point
    ? calculatePlaneResiduals(point, surfaceIds, planesById)
    : []
  const maximumPlaneResidual = Math.max(...planeResiduals.map((residual) => residual.residualMeters), 0)
  const allEdgesPresent = sourceEdges.length === 3
  const allEdgesHaveFiniteGeometry = sourceEdges.every((edge) => edge.line !== null && edge.segment !== null)
  const allEdgesSupportedOrPartial = sourceEdges.length === 3 && sourceEdges.every((edge) => edge.status === 'supported' || edge.status === 'partial')
  const lineConsistencyPass = edgeEvaluations.length === 3 && edgeEvaluations.every((evaluation) =>
    evaluation.lineDistanceMeters !== null && evaluation.lineDistanceMeters <= config.structuralCornerNumericalEpsilonMeters)
  const supportPass = supportNearCorner.every((support) => support.supportCount >= config.minimumStructuralCornerSupportCountPerSurface)
  const partialSupportPass = supportNearCorner.every((support) => support.supportCount >= config.minimumPartialStructuralCornerSupportCountPerSurface)
  const extensionPass = edgeEvaluations.length === 3 && edgeEvaluations.every((evaluation) => evaluation.withinStructuralExtensionLimit)
  const planeConsistencyPass = planeResiduals.length === 3 && maximumPlaneResidual <= config.structuralCornerNumericalEpsilonMeters
  let failedGate: string | null = null
  let reason = 'triad-backed corner validated from exact three-plane point and bounded finite-segment extensions'
  if (!allEdgesPresent) {
    failedGate = sourceIntersectionCandidates[0] === null ? 'missing wall-wall boundary' : 'missing wall-horizontal boundary'
    reason = failedGate
  } else if (threePlaneSolverStatus !== 'solved') {
    failedGate = 'three-plane solve is unstable'
    reason = failedGate
  } else if (!allEdgesHaveFiniteGeometry) {
    failedGate = 'required boundary does not have a finite theoretical line and segment'
    reason = failedGate
  } else if (!lineConsistencyPass) {
    failedGate = 'pairwise lines do not converge mathematically'
    reason = failedGate
  } else if (!planeConsistencyPass) {
    failedGate = 'three-plane point has a non-numerical plane residual'
    reason = failedGate
  } else if (!allEdgesSupportedOrPartial) {
    failedGate = 'required intersection is rejected'
    reason = failedGate
  } else if (!partialSupportPass) {
    failedGate = 'insufficient support near triple point'
    reason = failedGate
  } else if (!extensionPass) {
    const failedExtension = edgeEvaluations.find((evaluation) => !evaluation.withinStructuralExtensionLimit)
    failedGate = failedExtension ? `${failedExtension.edgeId} extension exceeds structural-corner limit` : 'structural-corner extension exceeds limit'
    reason = failedGate
  }
  const status: StructuralBoundaryStatus = failedGate
    ? 'rejected'
    : sourceEdges.every((edge) => edge.status === 'supported') && supportPass ? 'supported' : 'partial'
  if (!failedGate && status === 'partial') {
    reason = 'triad-backed corner validated with a partial source boundary'
  }
  const sourceSurfaces = surfaceIds.flatMap((surfaceId) => {
    const surface = selectedSurfaceMap.get(surfaceId)
    return surface ? [surface] : []
  })
  const segmentGapMeters = calculateTriadSegmentGap(sourceEdges)
  const confidence = calculateTriadCornerConfidence(
    triad,
    sourceSurfaces,
    sourceEdges,
    edgeEvaluations,
    supportNearCorner,
    segmentGapMeters,
    config,
    status,
  )
  const maximumExtensionMeters = Math.max(...edgeEvaluations.map((evaluation) => evaluation.extensionDistanceMeters), 0)
  const meanExtensionMeters = edgeEvaluations.length > 0
    ? edgeEvaluations.reduce((total, evaluation) => total + evaluation.extensionDistanceMeters, 0) / edgeEvaluations.length
    : 0
  const diagnostic: StructuralCornerCandidateDiagnostic = {
    id: candidateId,
    source: 'triad-backed',
    triadKey,
    endpointClusterCandidate,
    surfaceIds,
    sourceEdgeIds,
    sourceIntersectionIds,
    position: point,
    threePlaneSolverStatus,
    threePlaneDeterminant: determinant,
    supportNearCorner,
    edgeEvaluations,
    planeResiduals,
    maximumExtensionMeters,
    meanExtensionMeters,
    segmentGapMeters,
    confidence,
    status,
    failedGate,
    reason,
  }
  const edgeEndpointNodeIds = new Map<string, string>()
  if (point && status !== 'rejected') {
    for (const edge of sourceEdges) {
      if (!edge.segment) {
        continue
      }
      const startDistance = distance(point, edge.segment.start)
      const endDistance = distance(point, edge.segment.end)
      edgeEndpointNodeIds.set(
        `${`boundary-${edge.id}`}:${startDistance <= endDistance ? 'start' : 'end'}`,
        candidateId,
      )
    }
  }
  return { diagnostic, edgeEndpointNodeIds }
}

function createEndpointClusterDiagnostic(
  cluster: EndpointCluster,
  endpoints: readonly EndpointObservation[],
  edgeById: ReadonlyMap<string, StructuralBoundaryEdge>,
  solution: CornerSolution | null,
): StructuralCornerCandidateDiagnostic | null {
  const sourceEdgeIds = uniqueSorted(cluster.endpointIndices.map((index) => endpoints[index].edgeId))
  if (sourceEdgeIds.length < 2 || cluster.surfaceIds.length < 3) {
    return null
  }
  const sourceIntersectionIds = uniqueSorted(sourceEdgeIds.flatMap((edgeId) => {
    const edge = edgeById.get(edgeId)
    return edge ? [edge.sourceIntersectionId] : []
  }))
  const position = solution?.position ?? cluster.position
  const extensionDistances = solution?.extensionDistances ?? sourceEdgeIds.map((edgeId) => ({
    edgeId,
    distanceMeters: edgeById.get(edgeId)
      ? pointToSegmentInfo(position, edgeById.get(edgeId)!.start, edgeById.get(edgeId)!.end).extensionMeters
      : 0,
  }))
  const maximumExtensionMeters = Math.max(...extensionDistances.map((extension) => extension.distanceMeters), 0)
  return {
    id: `corner-candidate-endpoint-${sourceEdgeIds.join('-')}`,
    source: 'endpoint-cluster',
    triadKey: null,
    endpointClusterCandidate: true,
    surfaceIds: uniqueSorted(cluster.surfaceIds),
    sourceEdgeIds,
    sourceIntersectionIds,
    position,
    threePlaneSolverStatus: solution ? 'solved' : 'not-attempted',
    threePlaneDeterminant: null,
    supportNearCorner: [],
    edgeEvaluations: [],
    planeResiduals: solution?.planeResiduals ?? [],
    maximumExtensionMeters,
    meanExtensionMeters: extensionDistances.length > 0
      ? extensionDistances.reduce((total, extension) => total + extension.distanceMeters, 0) / extensionDistances.length
      : 0,
    segmentGapMeters: calculateClusterSegmentGap(cluster, endpoints, new Map(edgeById)),
    confidence: solution?.confidence ?? 0,
    status: solution?.status ?? 'rejected',
    failedGate: solution ? null : 'endpoint-cluster-validation',
    reason: solution ? 'endpoint-cluster corner validated' : 'endpoint cluster did not produce a validated three-plane corner',
  }
}

function createBoundaryNode(
  id: string,
  cluster: EndpointCluster,
  endpoints: readonly EndpointObservation[],
  edgeById: Map<string, StructuralBoundaryEdge>,
  corner: CornerSolution | null,
): StructuralBoundaryNode {
  const edgeIds = uniqueSorted(cluster.endpointIndices.map((index) => endpoints[index].edgeId))
  const sourceIntersectionIds = uniqueSorted(edgeIds.flatMap((edgeId) => {
    const edge = edgeById.get(edgeId)
    return edge ? [edge.sourceIntersectionId] : []
  }))
  const position = corner?.position ?? cluster.position
  const extensionDistances = corner?.extensionDistances ?? edgeIds.map((edgeId) => {
    const edge = edgeById.get(edgeId)
    return {
      edgeId,
      distanceMeters: edge ? pointToSegmentInfo(position, edge.start, edge.end).extensionMeters : 0,
    }
  })
  const status = corner?.status ?? (edgeIds.every((edgeId) => edgeById.get(edgeId)?.status === 'supported') ? 'supported' : 'partial')
  const confidence = corner?.confidence ?? edgeIds.reduce((total, edgeId) => total + (edgeById.get(edgeId)?.confidence ?? 0), 0) / Math.max(1, edgeIds.length)
  return {
    id,
    position,
    surfaceIds: [...cluster.surfaceIds],
    sourceEdgeIds: edgeIds,
    sourceIntersectionIds,
    status,
    confidence,
    segmentGapMeters: corner?.segmentGapMeters ?? calculateClusterSegmentGap(cluster, endpoints, edgeById),
    extensionDistances,
    planeResiduals: corner?.planeResiduals ?? [],
    cornerId: corner ? `corner-${id}` : null,
    candidateDiagnosticId: null,
    threePlaneSolverStatus: corner ? 'solved' : 'not-attempted',
    supportNearCorner: [],
    edgeEvaluations: [],
    maximumExtensionMeters: Math.max(...extensionDistances.map((extension) => extension.distanceMeters), 0),
    meanExtensionMeters: extensionDistances.length > 0
      ? extensionDistances.reduce((total, extension) => total + extension.distanceMeters, 0) / extensionDistances.length
      : 0,
    reason: corner ? 'endpoint-cluster corner validated' : 'endpoint cluster did not produce a validated corner',
  }
}

function createTriadBoundaryNode(
  candidate: StructuralCornerCandidateDiagnostic,
  index: number,
): StructuralBoundaryNode | null {
  if (!candidate.position || candidate.status === 'rejected') {
    return null
  }
  const id = `boundary-triad-node-${index + 1}`
  return {
    id,
    position: candidate.position,
    surfaceIds: candidate.surfaceIds,
    sourceEdgeIds: candidate.sourceEdgeIds,
    sourceIntersectionIds: candidate.sourceIntersectionIds,
    status: candidate.status,
    confidence: candidate.confidence,
    segmentGapMeters: candidate.segmentGapMeters,
    extensionDistances: candidate.edgeEvaluations.map((evaluation) => ({
      edgeId: evaluation.edgeId,
      distanceMeters: evaluation.extensionDistanceMeters,
    })),
    planeResiduals: candidate.planeResiduals,
    cornerId: `corner-${id}`,
    candidateDiagnosticId: candidate.id,
    threePlaneSolverStatus: candidate.threePlaneSolverStatus,
    supportNearCorner: candidate.supportNearCorner,
    edgeEvaluations: candidate.edgeEvaluations,
    maximumExtensionMeters: candidate.maximumExtensionMeters,
    meanExtensionMeters: candidate.meanExtensionMeters,
    reason: candidate.reason,
  }
}

function createCornerFromNode(node: StructuralBoundaryNode): StructuralCorner | null {
  if (!node.cornerId) {
    return null
  }
  return {
    id: node.cornerId,
    nodeId: node.id,
    position: node.position,
    surfaceIds: node.surfaceIds,
    sourceEdgeIds: node.sourceEdgeIds,
    sourceIntersectionIds: node.sourceIntersectionIds,
    status: node.status,
    confidence: node.confidence,
    segmentGapMeters: node.segmentGapMeters,
    extensionDistances: node.extensionDistances,
    planeResiduals: node.planeResiduals,
    candidateDiagnosticId: node.candidateDiagnosticId,
    threePlaneSolverStatus: node.threePlaneSolverStatus,
    supportNearCorner: node.supportNearCorner,
    edgeEvaluations: node.edgeEvaluations,
    maximumExtensionMeters: node.maximumExtensionMeters,
    meanExtensionMeters: node.meanExtensionMeters,
    reason: node.reason,
  }
}

function createBoundaryEdges(
  drafts: readonly BoundaryEdgeDraft[],
  endpoints: readonly EndpointObservation[],
  clusters: readonly EndpointCluster[],
  nodes: readonly StructuralBoundaryNode[],
  triadEndpointNodeIds: ReadonlyMap<string, string>,
): StructuralBoundaryEdge[] {
  const nodeIdByEndpointIndex = new Map<number, string>()
  clusters.forEach((cluster, clusterIndex) => {
    for (const endpointIndex of cluster.endpointIndices) {
      nodeIdByEndpointIndex.set(endpointIndex, nodes[clusterIndex].id)
    }
  })
  return drafts.map((draft, edgeIndex) => {
    const startEndpointIndex = endpoints.findIndex((endpoint) => endpoint.edgeIndex === edgeIndex && endpoint.endpoint === 'start')
    const endEndpointIndex = endpoints.findIndex((endpoint) => endpoint.edgeIndex === edgeIndex && endpoint.endpoint === 'end')
    const startNodeId = triadEndpointNodeIds.get(`${draft.edge.id}:start`) ?? nodeIdByEndpointIndex.get(startEndpointIndex) ?? null
    const endNodeId = triadEndpointNodeIds.get(`${draft.edge.id}:end`) ?? nodeIdByEndpointIndex.get(endEndpointIndex) ?? null
    const extensionDistances = [startNodeId, endNodeId]
      .filter((nodeId, index, ids): nodeId is string => nodeId !== null && ids.indexOf(nodeId) === index)
      .flatMap((nodeId) => {
        const node = nodes.find((candidate) => candidate.id === nodeId)
        const extension = node?.extensionDistances.find((candidate) => candidate.edgeId === draft.edge.id)
        return extension ? [extension] : []
      })
    return {
      ...draft.edge,
      startNodeId,
      endNodeId,
      extensionDistances,
    }
  })
}

function createComponents(
  selectedSurfaceIds: readonly string[],
  edges: readonly StructuralBoundaryEdge[],
  nodes: readonly StructuralBoundaryNode[],
): StructuralBoundaryComponent[] {
  const parent = new Map(selectedSurfaceIds.map((surfaceId) => [surfaceId, surfaceId]))
  const find = (surfaceId: string): string => {
    const currentParent = parent.get(surfaceId)
    if (!currentParent || currentParent === surfaceId) {
      return currentParent ?? surfaceId
    }
    const root = find(currentParent)
    parent.set(surfaceId, root)
    return root
  }
  const union = (first: string, second: string): void => {
    const firstRoot = find(first)
    const secondRoot = find(second)
    if (firstRoot !== secondRoot) {
      parent.set(secondRoot, firstRoot)
    }
  }
  for (const edge of edges) {
    union(edge.surfaceAId, edge.surfaceBId)
  }
  const rootToSurfaceIds = new Map<string, string[]>()
  for (const surfaceId of selectedSurfaceIds) {
    const root = find(surfaceId)
    const ids = rootToSurfaceIds.get(root) ?? []
    ids.push(surfaceId)
    rootToSurfaceIds.set(root, ids)
  }
  const components = [...rootToSurfaceIds.values()]
    .map((surfaceIds) => surfaceIds.sort((first, second) => first.localeCompare(second)))
    .sort((first, second) => first[0].localeCompare(second[0]))
  return components.map((surfaceIds, index) => {
    const surfaceSet = new Set(surfaceIds)
    const edgeIds = edges.filter((edge) => surfaceSet.has(edge.surfaceAId) || surfaceSet.has(edge.surfaceBId)).map((edge) => edge.id)
    const nodeIds = nodes.filter((node) => node.surfaceIds.some((surfaceId) => surfaceSet.has(surfaceId))).map((node) => node.id)
    return {
      id: `boundary-component-${index + 1}`,
      surfaceIds,
      edgeIds,
      nodeIds,
    }
  })
}

function createWallBoundaries(
  interpretation: RoomStructureInterpretationResult,
  edges: readonly StructuralBoundaryEdge[],
): ObservedWallBoundary[] {
  const selectedWalls = interpretation.selectedWalls
    .filter((surface) => surface.selection === 'selected' && surface.role === 'wall')
    .sort((first, second) => first.planeId.localeCompare(second.planeId))
  return selectedWalls.map((wall) => {
    const wallEdges = edges.filter((edge) => edge.surfaceAId === wall.planeId || edge.surfaceBId === wall.planeId)
    return {
      wallId: wall.planeId,
      wallWallEdgeIds: wallEdges.filter((edge) => edge.type === 'wall-wall').map((edge) => edge.id),
      upperBoundaryEdgeIds: wallEdges.filter((edge) => edge.type === 'wall-ceiling').map((edge) => edge.id),
      lowerBoundaryEdgeIds: wallEdges.filter((edge) => edge.type === 'wall-floor').map((edge) => edge.id),
    }
  })
}

function compareEdges(first: StructuralBoundaryEdge, second: StructuralBoundaryEdge): number {
  return STATUS_ORDER[first.status] - STATUS_ORDER[second.status] ||
    first.type.localeCompare(second.type) ||
    second.confidence - first.confidence ||
    first.id.localeCompare(second.id)
}

export class RoomBoundaryReconstructionService {
  private readonly config: RoomBoundaryReconstructionConfig

  public constructor(config: Partial<RoomBoundaryReconstructionConfig> = {}) {
    this.config = { ...DEFAULT_ROOM_BOUNDARY_RECONSTRUCTION_CONFIG, ...config }
  }

  public reconstruct(
    interpretation: RoomStructureInterpretationResult,
    intersections: StructuralIntersectionResult,
  ): RoomBoundaryResult {
    const startedAt = timestamp()
    const preparationStartedAt = timestamp()
    const selectedSurfaceMap = makeSelectedSurfaceMap(interpretation)
    const selectedSurfaceIds = [...selectedSurfaceMap.keys()].sort((first, second) => first.localeCompare(second))
    const { drafts, rejectedIntersectionCount } = createBoundaryEdgeDrafts(interpretation, intersections)
    const edgeById = new Map(drafts.map((draft) => [draft.edge.id, draft.edge]))
    const endpoints: EndpointObservation[] = drafts.flatMap((draft, edgeIndex) => [
      {
        edgeIndex,
        edgeId: draft.edge.id,
        endpoint: 'start' as const,
        position: draft.edge.start,
        confidence: draft.edge.confidence,
        surfaceIds: [draft.edge.surfaceAId, draft.edge.surfaceBId],
      },
      {
        edgeIndex,
        edgeId: draft.edge.id,
        endpoint: 'end' as const,
        position: draft.edge.end,
        confidence: draft.edge.confidence,
        surfaceIds: [draft.edge.surfaceAId, draft.edge.surfaceBId],
      },
    ])
    const preparationMs = timestamp() - preparationStartedAt

    const graphStartedAt = timestamp()
    const clusters = createEndpointClusters(endpoints, this.config.endpointClusterToleranceMeters)
    const normalizedPlanes = selectedSurfaceIds.flatMap((surfaceId) => {
      const surface = selectedSurfaceMap.get(surfaceId)
      const normalized = surface ? normalizePlane(surface) : null
      return normalized ? [normalized] : []
    })
    const planesById = new Map(normalizedPlanes.map((plane) => [plane.surface.planeId, plane]))
    const graphConstructionMs = timestamp() - graphStartedAt

    const cornerStartedAt = timestamp()
    const cornersByCluster = clusters.map((cluster) => solveCorner(cluster, endpoints, edgeById, planesById, this.config))
    const endpointNodes = clusters.map((cluster, clusterIndex) => createBoundaryNode(
      `boundary-node-${clusterIndex + 1}`,
      cluster,
      endpoints,
      edgeById,
      cornersByCluster[clusterIndex],
    ))
    const endpointClusterCandidates = clusters.flatMap((cluster, clusterIndex) => {
      const candidate = createEndpointClusterDiagnostic(cluster, endpoints, edgeById, cornersByCluster[clusterIndex])
      return candidate ? [candidate] : []
    })
    const triadCornerCandidates = [...new Map(
      interpretation.multiSurfaceCoherenceDiagnostics
        .filter((triad) => triad.selected && triad.finalDecision === 'selected')
        .sort((first, second) => getTriadKey(first.candidatePlaneId, first.existingWallPlaneId, first.horizontalPlaneId)
          .localeCompare(getTriadKey(second.candidatePlaneId, second.existingWallPlaneId, second.horizontalPlaneId)))
        .map((triad) => {
          const candidate = createTriadCornerCandidate(
            triad,
            intersections,
            selectedSurfaceMap,
            planesById,
            clusters,
            endpoints,
            this.config,
          )
          return [candidate.diagnostic.triadKey ?? candidate.diagnostic.id, candidate] as const
        }),
    ).values()]
    const genericCorners = endpointNodes.flatMap((node) => {
      const corner = createCornerFromNode(node)
      return corner ? [corner] : []
    })
    const genericCornerEdgeKeys = new Set(genericCorners.map((corner) => [...corner.sourceEdgeIds].sort((first, second) => first.localeCompare(second)).join('|')))
    const acceptedTriadCornerCandidates = triadCornerCandidates.filter((candidate) =>
      candidate.diagnostic.status !== 'rejected' && candidate.diagnostic.position !== null &&
      !genericCornerEdgeKeys.has([...candidate.diagnostic.sourceEdgeIds].sort((first, second) => first.localeCompare(second)).join('|')))
    const triadNodes: StructuralBoundaryNode[] = []
    const triadEndpointNodeIds = new Map<string, string>()
    acceptedTriadCornerCandidates.forEach((candidate, candidateIndex) => {
      const node = createTriadBoundaryNode(candidate.diagnostic, candidateIndex)
      if (!node) {
        return
      }
      triadNodes.push(node)
      for (const [endpointKey, candidateId] of candidate.edgeEndpointNodeIds) {
        if (candidateId === candidate.diagnostic.id && !triadEndpointNodeIds.has(endpointKey)) {
          triadEndpointNodeIds.set(endpointKey, node.id)
        }
      }
    })
    const nodes = [...endpointNodes, ...triadNodes]
    const corners = [...genericCorners, ...triadNodes.flatMap((node) => {
      const corner = createCornerFromNode(node)
      return corner ? [corner] : []
    })]
    const cornerCandidates = [...endpointClusterCandidates, ...triadCornerCandidates.map((candidate) => candidate.diagnostic)]
      .sort((first, second) => STATUS_ORDER[first.status] - STATUS_ORDER[second.status] || first.id.localeCompare(second.id))
    const cornerSolvingMs = timestamp() - cornerStartedAt

    const edges = createBoundaryEdges(drafts, endpoints, clusters, nodes, triadEndpointNodeIds).sort(compareEdges)
    const components = createComponents(selectedSurfaceIds, edges, nodes)
    const wallBoundaries = createWallBoundaries(interpretation, edges)
    const finalCorners = [...corners].sort((first, second) => STATUS_ORDER[first.status] - STATUS_ORDER[second.status] || second.confidence - first.confidence || first.id.localeCompare(second.id))
    const totalMs = timestamp() - startedAt
    return {
      sourceScanId: intersections.sourceScanId,
      selectedSurfaceIds,
      edges,
      nodes,
      corners: finalCorners,
      cornerCandidates,
      wallBoundaries,
      components,
      stats: {
        selectedSurfaceCount: selectedSurfaceIds.length,
        boundaryEdgeCount: edges.length,
        wallWallEdgeCount: edges.filter((edge) => edge.type === 'wall-wall').length,
        wallCeilingEdgeCount: edges.filter((edge) => edge.type === 'wall-ceiling').length,
        wallFloorEdgeCount: edges.filter((edge) => edge.type === 'wall-floor').length,
        cornerNodeCount: finalCorners.length,
        cornerCandidateCount: cornerCandidates.length,
        supportedCornerCount: finalCorners.filter((corner) => corner.status === 'supported').length,
        partialCornerCount: finalCorners.filter((corner) => corner.status === 'partial').length,
        rejectedCornerCandidateCount: cornerCandidates.filter((candidate) => candidate.status === 'rejected').length,
        connectedComponentCount: components.length,
        rejectedIntersectionCount,
      },
      timings: {
        preparationMs,
        graphConstructionMs,
        cornerSolvingMs,
        totalMs,
      },
    }
  }
}

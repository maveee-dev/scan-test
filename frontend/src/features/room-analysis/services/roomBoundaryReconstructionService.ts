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
  StructuralIntersectionResult,
  StructuralPlaneResidual,
  StructuralSurfaceCandidate,
} from '../types'

export interface RoomBoundaryReconstructionConfig {
  endpointClusterToleranceMeters: number
  maximumEndpointExtensionMeters: number
  maximumSegmentPointDistanceMeters: number
  maximumSegmentGapMeters: number
  minimumThreePlaneDeterminant: number
  maximumPlaneResidualMeters: number
}

export const DEFAULT_ROOM_BOUNDARY_RECONSTRUCTION_CONFIG: RoomBoundaryReconstructionConfig = {
  endpointClusterToleranceMeters: 0.12,
  maximumEndpointExtensionMeters: 0.12,
  maximumSegmentPointDistanceMeters: 0.12,
  maximumSegmentGapMeters: 0.12,
  minimumThreePlaneDeterminant: 0.001,
  maximumPlaneResidualMeters: 0.1,
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

function cross(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  }
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
  const secondCrossThird = cross(second.normal, third.normal)
  const determinant = dot(first.normal, secondCrossThird)
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= minimumDeterminant) {
    return null
  }
  const thirdCrossFirst = cross(third.normal, first.normal)
  const firstCrossSecond = cross(first.normal, second.normal)
  const numerator = {
    x: secondCrossThird.x * first.planeConstant + thirdCrossFirst.x * second.planeConstant + firstCrossSecond.x * third.planeConstant,
    y: secondCrossThird.y * first.planeConstant + thirdCrossFirst.y * second.planeConstant + firstCrossSecond.y * third.planeConstant,
    z: secondCrossThird.z * first.planeConstant + thirdCrossFirst.z * second.planeConstant + firstCrossSecond.z * third.planeConstant,
  }
  const point = scale(numerator, 1 / determinant)
  return isFinitePoint(point) ? point : null
}

function calculatePlaneResiduals(
  point: SpatialPoint,
  surfaceIds: readonly string[],
  planesById: Map<string, NormalizedPlane>,
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
  }
}

function createBoundaryEdges(
  drafts: readonly BoundaryEdgeDraft[],
  endpoints: readonly EndpointObservation[],
  clusters: readonly EndpointCluster[],
  nodes: readonly StructuralBoundaryNode[],
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
    const startNodeId = nodeIdByEndpointIndex.get(startEndpointIndex) ?? null
    const endNodeId = nodeIdByEndpointIndex.get(endEndpointIndex) ?? null
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
    const nodes = clusters.map((cluster, clusterIndex) => createBoundaryNode(
      `boundary-node-${clusterIndex + 1}`,
      cluster,
      endpoints,
      edgeById,
      cornersByCluster[clusterIndex],
    ))
    const corners: StructuralCorner[] = nodes.flatMap((node) => {
      if (!node.cornerId) {
        return []
      }
      return [{
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
      }]
    })
    const cornerSolvingMs = timestamp() - cornerStartedAt

    const edges = createBoundaryEdges(drafts, endpoints, clusters, nodes).sort(compareEdges)
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
      wallBoundaries,
      components,
      stats: {
        selectedSurfaceCount: selectedSurfaceIds.length,
        boundaryEdgeCount: edges.length,
        wallWallEdgeCount: edges.filter((edge) => edge.type === 'wall-wall').length,
        wallCeilingEdgeCount: edges.filter((edge) => edge.type === 'wall-ceiling').length,
        wallFloorEdgeCount: edges.filter((edge) => edge.type === 'wall-floor').length,
        cornerNodeCount: finalCorners.length,
        supportedCornerCount: finalCorners.filter((corner) => corner.status === 'supported').length,
        partialCornerCount: finalCorners.filter((corner) => corner.status === 'partial').length,
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

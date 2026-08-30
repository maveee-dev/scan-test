import type {
  CoverageCellState,
  FinalizedSpatialScan,
  FinalizedSurfaceSurfel,
  SpatialPoint,
} from '../../scanner/types'
import type {
  PlaneCandidate,
  PlaneOrientationCategory,
  PlaneRelationshipDiagnostic,
  RoomAnalysisResult,
} from '../types'

export interface PlaneExtractionConfig {
  readonly downsampleCellSizeMeters: number
  readonly projectedAreaCellSizeMeters: number
  readonly connectivityBucketSizeMeters: number
  readonly connectivityDistanceMeters: number
  readonly maximumSeedPlaneErrorMeters: number
  readonly maximumPlaneErrorMeters: number
  readonly maximumNormalAngleDegrees: number
  readonly consolidationAngleDegrees: number
  readonly consolidationOffsetToleranceMeters: number
  readonly consolidationAdjacencyMeters: number
  readonly minimumProjectedOverlapRatio: number
  readonly highOverlapRatio: number
  readonly minimumSupportPointCount: number
  readonly minimumAreaSquareMeters: number
  readonly maximumRmsErrorMeters: number
  readonly maximumPlaneRefinementPasses: number
  readonly maximumConsolidationPasses: number
  readonly ownershipBoundsPaddingMeters: number
  /** Point residual allowed while reassembling spatially separated fragments. */
  readonly expansionResidualToleranceMeters: number
  /** Full 3D normal agreement used by dominant-plane expansion. */
  readonly expansionNormalAngleDegrees: number
  /** Maximum gap between connected support regions during expansion. */
  readonly expansionConnectivityGapMeters: number
  readonly maximumExpansionPasses: number
  /** Strict full-normal tolerance for global coplanar clustering. */
  readonly globalPlaneClusterAngleDegrees: number
  /** Plane-equation offset tolerance for global coplanar clustering. */
  readonly globalPlaneClusterOffsetToleranceMeters: number
  /** Residual tolerance for global support expansion and robust fitting. */
  readonly globalPlaneResidualToleranceMeters: number
  /** Full-normal tolerance for support expansion against a global plane. */
  readonly globalPlaneExpansionAngleDegrees: number
  /** Bounded plane-space search padding; gaps are not a merge prerequisite. */
  readonly globalPlaneSearchPaddingMeters: number
  readonly maximumGlobalExpansionPasses: number
  readonly maximumGlobalFitPasses: number
  /** Optional comparison-only path; never feeds normal final candidates. */
  readonly enableLegacyDiagnostics?: boolean
  /** Position-only RANSAC inlier tolerance for mobile-depth geometry. */
  readonly ransacInlierDistanceMeters: number
  /** Bounded hypothesis budget per dominant plane search. */
  readonly ransacHypothesisCount: number
  readonly ransacSeed: number
  /** Minimum cross-product magnitude for a non-degenerate point triplet. */
  readonly minimumHypothesisCrossMagnitude: number
  readonly ransacSupportCellSizeMeters: number
  readonly ransacSupportGapMeters: number
  readonly maximumDominantPlanes: number
  readonly ransacEarlyTerminationFraction: number
  readonly minimumRansacSupportFraction: number
}

/** Conservative defaults for major-surface candidates, not semantic labels. */
export const DEFAULT_PLANE_EXTRACTION_CONFIG: PlaneExtractionConfig = {
  downsampleCellSizeMeters: 0.075,
  projectedAreaCellSizeMeters: 0.1,
  connectivityBucketSizeMeters: 0.12,
  connectivityDistanceMeters: 0.18,
  maximumSeedPlaneErrorMeters: 0.06,
  maximumPlaneErrorMeters: 0.045,
  maximumNormalAngleDegrees: 30,
  consolidationAngleDegrees: 8,
  consolidationOffsetToleranceMeters: 0.05,
  consolidationAdjacencyMeters: 0.12,
  minimumProjectedOverlapRatio: 0.12,
  highOverlapRatio: 0.5,
  minimumSupportPointCount: 12,
  minimumAreaSquareMeters: 0.2,
  maximumRmsErrorMeters: 0.035,
  maximumPlaneRefinementPasses: 2,
  maximumConsolidationPasses: 8,
  ownershipBoundsPaddingMeters: 0.12,
  expansionResidualToleranceMeters: 0.05,
  expansionNormalAngleDegrees: 13,
  expansionConnectivityGapMeters: 0.3,
  maximumExpansionPasses: 8,
  globalPlaneClusterAngleDegrees: 13,
  globalPlaneClusterOffsetToleranceMeters: 0.06,
  globalPlaneResidualToleranceMeters: 0.05,
  globalPlaneExpansionAngleDegrees: 13,
  globalPlaneSearchPaddingMeters: 0.35,
  maximumGlobalExpansionPasses: 4,
  maximumGlobalFitPasses: 3,
  enableLegacyDiagnostics: false,
  ransacInlierDistanceMeters: 0.04,
  ransacHypothesisCount: 320,
  ransacSeed: 0x6d2b79f5,
  minimumHypothesisCrossMagnitude: 0.0001,
  ransacSupportCellSizeMeters: 0.1,
  ransacSupportGapMeters: 0.3,
  maximumDominantPlanes: 12,
  ransacEarlyTerminationFraction: 0.7,
  minimumRansacSupportFraction: 0.01,
}

interface AnalysisPoint {
  position: SpatialPoint
  normal: SpatialPoint
  weight: number
  sourceCount: number
}

interface DownsampleAggregate {
  positionX: number
  positionY: number
  positionZ: number
  normalX: number
  normalY: number
  normalZ: number
  weight: number
  sourceCount: number
}

interface FilteredPoint {
  position: SpatialPoint
  normal: SpatialPoint
  weight: number
}

interface AnalysisPointMapResult {
  inputPoints: number
  coverageGeometryPoints: number
  finalizedFusedSurfelCount: number
  filteredPoints: number
  analysisFilteredSurfelCount: number
  points: AnalysisPoint[]
  analysisDownsampledSurfelCount: number
  inputPreparationMs: number
  downsamplingMs: number
}

interface FitPlaneResult {
  centroid: SpatialPoint
  normal: SpatialPoint
  planeConstant: number
  rmsError: number
}

interface ExtractedPlane {
  support: readonly number[]
  fit: FitPlaneResult
}

interface CandidateGroup {
  candidate: PlaneCandidate
  support: readonly number[]
}

interface ConsolidationDiagnostics {
  candidatePairsTested: number
  highOverlapCandidatePairs: number
  candidatesMerged: number
  averageSupportOverlap: number
}

interface OwnershipResult {
  groups: CandidateGroup[]
  assignedPointCount: number
}

interface CanonicalPlane {
  normal: SpatialPoint
  /** Canonical equation is n · x + offset = 0. */
  offset: number
}

interface GlobalPlaneCluster {
  members: CandidateGroup[]
  support: number[]
  fit: FitPlaneResult
  candidate: PlaneCandidate
}

interface GlobalReassemblyDiagnostics {
  planeParameterClusterCount: number
  globalPlanesAttempted: number
  globalPlanesAccepted: number
  globalPointsAbsorbed: number
  globalFragmentsAbsorbed: number
  globalExpansionPasses: number
  globalPlaneRefits: number
  globalResidualRejects: number
  globalNormalRejects: number
  globalSupportRejects: number
}

interface GlobalReassemblyResult {
  groups: CandidateGroup[]
  diagnostics: GlobalReassemblyDiagnostics
}

interface RansacHypothesis {
  normal: SpatialPoint
  offset: number
  support: number[]
  inlierCount: number
  weightedSupport: number
  rmsError: number
  occupiedBoundsArea: number
  score: number
}

interface RansacDiagnostics {
  hypothesesTested: number
  degenerateHypothesesRejected: number
  bestHypothesisInitialInliers: number
  bestHypothesisWeightedSupport: number
  bestHypothesisInitialRms: number
  refinedSupportPointCount: number
  refinedRmsError: number
  refinedOccupiedArea: number
  acceptedDominantPlanes: number
  iterationsPerAcceptedPlane: number[]
  ransacMs: number
  refinementMs: number
}

interface RansacExtractionResult {
  groups: CandidateGroup[]
  diagnostics: RansacDiagnostics
}

interface SpatialBounds {
  min: SpatialPoint
  max: SpatialPoint
}

function getTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function dot(left: SpatialPoint, right: SpatialPoint): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function length(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function normalize(point: SpatialPoint): SpatialPoint | null {
  const magnitude = length(point)
  if (!Number.isFinite(magnitude) || magnitude < 1e-7) {
    return null
  }

  return {
    x: point.x / magnitude,
    y: point.y / magnitude,
    z: point.z / magnitude,
  }
}

function isFinitePoint(point: SpatialPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

function subtract(left: SpatialPoint, right: SpatialPoint): SpatialPoint {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  }
}

function cross(left: SpatialPoint, right: SpatialPoint): SpatialPoint {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

function scale(point: SpatialPoint, amount: number): SpatialPoint {
  return {
    x: point.x * amount,
    y: point.y * amount,
    z: point.z * amount,
  }
}

function addScaled(target: SpatialPoint, point: SpatialPoint, amount: number): void {
  target.x += point.x * amount
  target.y += point.y * amount
  target.z += point.z * amount
}

function squaredDistance(left: SpatialPoint, right: SpatialPoint): number {
  const delta = subtract(left, right)
  return dot(delta, delta)
}

function quantize(value: number, cellSize: number): number {
  return Math.floor(value / cellSize)
}

function getBucketKey(point: SpatialPoint, bucketSize: number): string {
  return `${quantize(point.x, bucketSize)}:${quantize(point.y, bucketSize)}:${quantize(point.z, bucketSize)}`
}

function getQualityWeight(state: CoverageCellState, observationCount: number): number {
  const stateWeight = state === 'captured' ? 3 : state === 'partial' ? 2 : 1
  return stateWeight * clamp(observationCount, 1, 3)
}

function getFusedSurfaceQualityWeight(surfel: FinalizedSurfaceSurfel): number {
  const coverageWeight = surfel.coverageState === 'captured'
    ? 1.25
    : surfel.coverageState === 'partial'
      ? 1.1
      : 1
  const geometryWeight = 1 + clamp(surfel.geometryConfidence, 0, 1)
  const observationWeight = clamp(surfel.observationWeight, 1, 3)
  return coverageWeight * geometryWeight * observationWeight
}

function getNormalCompatibilityDot(maximumNormalAngleDegrees: number): number {
  return Math.cos((maximumNormalAngleDegrees * Math.PI) / 180)
}

function getOrientationCategory(angleDegrees: number): PlaneOrientationCategory {
  if (angleDegrees <= 20) {
    return 'horizontal-like'
  }
  if (angleDegrees >= 70) {
    return 'vertical-like'
  }
  return 'other'
}

function choosePlaneBasis(normal: SpatialPoint): { tangentU: SpatialPoint; tangentV: SpatialPoint } | null {
  const reference: SpatialPoint = Math.abs(normal.y) < 0.8
    ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 }
  const tangentU = normalize(cross(reference, normal))
  if (!tangentU) {
    return null
  }

  const tangentV = normalize(cross(normal, tangentU))
  if (!tangentV) {
    return null
  }

  return { tangentU, tangentV }
}

interface ProjectedRange {
  minU: number
  maxU: number
  minV: number
  maxV: number
}

function getProjectedRange(
  points: readonly AnalysisPoint[],
  support: readonly number[],
  origin: SpatialPoint,
  tangentU: SpatialPoint,
  tangentV: SpatialPoint,
): ProjectedRange {
  const range: ProjectedRange = {
    minU: Infinity,
    maxU: -Infinity,
    minV: Infinity,
    maxV: -Infinity,
  }
  for (const index of support) {
    const relative = subtract(points[index].position, origin)
    const u = dot(relative, tangentU)
    const v = dot(relative, tangentV)
    range.minU = Math.min(range.minU, u)
    range.maxU = Math.max(range.maxU, u)
    range.minV = Math.min(range.minV, v)
    range.maxV = Math.max(range.maxV, v)
  }
  return range
}

function getRangeGap(firstMinimum: number, firstMaximum: number, secondMinimum: number, secondMaximum: number): number {
  return Math.max(0, Math.max(firstMinimum - secondMaximum, secondMinimum - firstMaximum))
}

function getRangeOverlap(firstMinimum: number, firstMaximum: number, secondMinimum: number, secondMaximum: number): number {
  return Math.max(0, Math.min(firstMaximum, secondMaximum) - Math.max(firstMinimum, secondMinimum))
}

function getRangeSize(minimum: number, maximum: number): number {
  return Math.max(0, maximum - minimum)
}

function getProjectedOverlapRatio(first: ProjectedRange, second: ProjectedRange): number {
  const firstArea = getRangeSize(first.minU, first.maxU) * getRangeSize(first.minV, first.maxV)
  const secondArea = getRangeSize(second.minU, second.maxU) * getRangeSize(second.minV, second.maxV)
  const smallerArea = Math.min(firstArea, secondArea)
  if (smallerArea <= 0) {
    return 0
  }

  const overlapArea = getRangeOverlap(first.minU, first.maxU, second.minU, second.maxU) *
    getRangeOverlap(first.minV, first.maxV, second.minV, second.maxV)
  return overlapArea / smallerArea
}

function countSupportOverlap(first: readonly number[], second: readonly number[]): number {
  const smaller = first.length <= second.length ? first : second
  const larger = first.length <= second.length ? second : first
  const largerSet = new Set(larger)
  let overlap = 0
  for (const index of smaller) {
    if (largerSet.has(index)) {
      overlap += 1
    }
  }
  return overlap
}

function getSmallestEigenvector(matrixInput: readonly number[]): SpatialPoint | null {
  const matrix = [...matrixInput]
  const eigenvectors = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]

  for (let iteration = 0; iteration < 12; iteration += 1) {
    let p = 0
    let q = 1
    let largest = Math.abs(matrix[1])
    const offDiagonalPairs: readonly [number, number][] = [[0, 1], [0, 2], [1, 2]]
    for (const [candidateP, candidateQ] of offDiagonalPairs) {
      const candidate = Math.abs(matrix[candidateP * 3 + candidateQ])
      if (candidate > largest) {
        largest = candidate
        p = candidateP
        q = candidateQ
      }
    }

    if (largest < 1e-8) {
      break
    }

    const app = matrix[p * 3 + p]
    const aqq = matrix[q * 3 + q]
    const apq = matrix[p * 3 + q]
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app)
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)

    for (let index = 0; index < 3; index += 1) {
      if (index === p || index === q) {
        continue
      }

      const indexP = matrix[index * 3 + p]
      const indexQ = matrix[index * 3 + q]
      matrix[index * 3 + p] = cosine * indexP - sine * indexQ
      matrix[p * 3 + index] = matrix[index * 3 + p]
      matrix[index * 3 + q] = sine * indexP + cosine * indexQ
      matrix[q * 3 + index] = matrix[index * 3 + q]
    }

    matrix[p * 3 + p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq
    matrix[q * 3 + q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq
    matrix[p * 3 + q] = 0
    matrix[q * 3 + p] = 0

    for (let index = 0; index < 3; index += 1) {
      const indexP = eigenvectors[index * 3 + p]
      const indexQ = eigenvectors[index * 3 + q]
      eigenvectors[index * 3 + p] = cosine * indexP - sine * indexQ
      eigenvectors[index * 3 + q] = sine * indexP + cosine * indexQ
    }
  }

  let smallestIndex = 0
  if (matrix[4] < matrix[smallestIndex]) {
    smallestIndex = 1
  }
  if (matrix[8] < matrix[smallestIndex * 3 + smallestIndex]) {
    smallestIndex = 2
  }

  return normalize({
    x: eigenvectors[smallestIndex],
    y: eigenvectors[3 + smallestIndex],
    z: eigenvectors[6 + smallestIndex],
  })
}

function fitPlane(points: readonly AnalysisPoint[], indices: readonly number[]): FitPlaneResult | null {
  if (indices.length < 3) {
    return null
  }

  const centroid = { x: 0, y: 0, z: 0 }
  const normalSum = { x: 0, y: 0, z: 0 }
  let totalWeight = 0
  let firstNormal: SpatialPoint | null = null

  for (const index of indices) {
    const point = points[index]
    totalWeight += point.weight
    addScaled(centroid, point.position, point.weight)
    if (!firstNormal) {
      firstNormal = point.normal
    }
    const alignedNormal = firstNormal && dot(firstNormal, point.normal) < 0
      ? scale(point.normal, -1)
      : point.normal
    addScaled(normalSum, alignedNormal, point.weight)
  }

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return null
  }
  centroid.x /= totalWeight
  centroid.y /= totalWeight
  centroid.z /= totalWeight

  const covariance = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const index of indices) {
    const point = points[index]
    const delta = subtract(point.position, centroid)
    const weight = point.weight / totalWeight
    covariance[0] += delta.x * delta.x * weight
    covariance[1] += delta.x * delta.y * weight
    covariance[2] += delta.x * delta.z * weight
    covariance[4] += delta.y * delta.y * weight
    covariance[5] += delta.y * delta.z * weight
    covariance[8] += delta.z * delta.z * weight
  }
  covariance[3] = covariance[1]
  covariance[6] = covariance[2]
  covariance[7] = covariance[5]

  let normal = getSmallestEigenvector(covariance)
  if (!normal) {
    normal = normalize(normalSum)
  }
  if (!normal) {
    return null
  }
  if (dot(normal, normalSum) < 0) {
    normal = scale(normal, -1)
  }

  const planeConstant = dot(normal, centroid)
  let squaredError = 0
  for (const index of indices) {
    const residual = dot(normal, points[index].position) - planeConstant
    squaredError += residual * residual * points[index].weight
  }

  return {
    centroid,
    normal,
    planeConstant,
    rmsError: Math.sqrt(squaredError / totalWeight),
  }
}

function createPlaneCandidate(
  id: string,
  points: readonly AnalysisPoint[],
  support: readonly number[],
  fit: FitPlaneResult,
  config: PlaneExtractionConfig,
): PlaneCandidate | null {
  const basis = choosePlaneBasis(fit.normal)
  if (!basis) {
    return null
  }

  const minimum = { x: Infinity, y: Infinity, z: Infinity }
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity

  for (const index of support) {
    const point = points[index].position
    minimum.x = Math.min(minimum.x, point.x)
    minimum.y = Math.min(minimum.y, point.y)
    minimum.z = Math.min(minimum.z, point.z)
    maximum.x = Math.max(maximum.x, point.x)
    maximum.y = Math.max(maximum.y, point.y)
    maximum.z = Math.max(maximum.z, point.z)

    const relative = subtract(point, fit.centroid)
    const u = dot(relative, basis.tangentU)
    const v = dot(relative, basis.tangentV)
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }

  const areaEstimate = Math.max(0, maxU - minU) * Math.max(0, maxV - minV)
  const occupiedCells = new Set<string>()
  for (const index of support) {
    const point = points[index].position
    const relative = subtract(point, fit.centroid)
    const u = dot(relative, basis.tangentU)
    const v = dot(relative, basis.tangentV)
    occupiedCells.add(`${Math.floor(u / config.projectedAreaCellSizeMeters)}:${Math.floor(v / config.projectedAreaCellSizeMeters)}`)
  }
  const occupiedAreaEstimate = occupiedCells.size * config.projectedAreaCellSizeMeters ** 2
  const up = { x: 0, y: 1, z: 0 }
  const orientationAngleDegrees = (Math.acos(clamp(Math.abs(dot(fit.normal, up)), 0, 1)) * 180) / Math.PI
  const supportPointCount = support.reduce(
    (count, index) => count + points[index].sourceCount,
    0,
  )
  const supportScore = clamp(support.length / (config.minimumSupportPointCount * 4), 0, 1)
  const areaScore = clamp(occupiedAreaEstimate, 0, 1)
  const errorScore = 1 - clamp(fit.rmsError / config.maximumRmsErrorMeters, 0, 1)

  return {
    id,
    normal: fit.normal,
    centroid: fit.centroid,
    planeConstant: fit.planeConstant,
    supportPointCount,
    areaEstimate: occupiedAreaEstimate,
    projectedBoundsAreaEstimate: areaEstimate,
    rmsError: fit.rmsError,
    bounds: { min: minimum, max: maximum },
    localBounds: { minU, maxU, minV, maxV },
    tangentU: basis.tangentU,
    tangentV: basis.tangentV,
    orientationAngleDegrees,
    orientationCategory: getOrientationCategory(orientationAngleDegrees),
    confidence: clamp(0.45 * supportScore + 0.35 * areaScore + 0.2 * errorScore, 0, 1),
  }
}

function createAnalysisPointMap(
  scan: FinalizedSpatialScan,
  config: PlaneExtractionConfig,
): AnalysisPointMapResult {
  const preparationStartedAt = getTimestamp()
  const filtered: FilteredPoint[] = []
  const fusedSurface = scan.fusedSurface
  if (fusedSurface.length > 0) {
    for (const surfel of fusedSurface) {
      if (!isFinitePoint(surfel.position) || !isFinitePoint(surfel.normal)) {
        continue
      }

      const normal = normalize(surfel.normal)
      if (!normal) {
        continue
      }
      filtered.push({
        position: surfel.position,
        normal,
        weight: getFusedSurfaceQualityWeight(surfel),
      })
    }
  } else {
    // Compatibility fallback for snapshots created before fused-surface
    // finalization was introduced. New snapshots always use fused surfels.
    for (const cell of scan.coverage) {
      if (!cell.normal || !isFinitePoint(cell.position) || !isFinitePoint(cell.normal)) {
        continue
      }

      const normal = normalize(cell.normal)
      if (!normal) {
        continue
      }
      filtered.push({
        position: cell.position,
        normal,
        weight: getQualityWeight(cell.coverageState, cell.observationCount),
      })
    }
  }
  const preparationFinishedAt = getTimestamp()

  const aggregates = new Map<string, DownsampleAggregate>()
  for (const source of filtered) {
    const key = getBucketKey(source.position, config.downsampleCellSizeMeters)
    const aggregate = aggregates.get(key)
    if (!aggregate) {
      aggregates.set(key, {
        positionX: source.position.x * source.weight,
        positionY: source.position.y * source.weight,
        positionZ: source.position.z * source.weight,
        normalX: source.normal.x * source.weight,
        normalY: source.normal.y * source.weight,
        normalZ: source.normal.z * source.weight,
        weight: source.weight,
        sourceCount: 1,
      })
      continue
    }

    const aggregateNormal = normalize({
      x: aggregate.normalX,
      y: aggregate.normalY,
      z: aggregate.normalZ,
    })
    const alignedNormal = aggregateNormal && dot(aggregateNormal, source.normal) < 0
      ? scale(source.normal, -1)
      : source.normal
    aggregate.positionX += source.position.x * source.weight
    aggregate.positionY += source.position.y * source.weight
    aggregate.positionZ += source.position.z * source.weight
    aggregate.normalX += alignedNormal.x * source.weight
    aggregate.normalY += alignedNormal.y * source.weight
    aggregate.normalZ += alignedNormal.z * source.weight
    aggregate.weight += source.weight
    aggregate.sourceCount += 1
  }
  const downsamplingFinishedAt = getTimestamp()

  const points: AnalysisPoint[] = []
  for (const aggregate of aggregates.values()) {
    const position = {
      x: aggregate.positionX / aggregate.weight,
      y: aggregate.positionY / aggregate.weight,
      z: aggregate.positionZ / aggregate.weight,
    }
    const normal = normalize({
      x: aggregate.normalX,
      y: aggregate.normalY,
      z: aggregate.normalZ,
    })
    if (!normal || !isFinitePoint(position)) {
      continue
    }
    points.push({
      position,
      normal,
      weight: aggregate.weight,
      sourceCount: aggregate.sourceCount,
    })
  }

  // Prefer higher-quality representatives as seeds, while retaining all
  // downsampled positions for spatial connectivity and area estimation.
  points.sort((left, right) => right.weight - left.weight)
  return {
    inputPoints: fusedSurface.length > 0 ? fusedSurface.length : scan.coverage.length,
    coverageGeometryPoints: scan.coverage.length,
    finalizedFusedSurfelCount: fusedSurface.length,
    filteredPoints: filtered.length,
    analysisFilteredSurfelCount: filtered.length,
    points,
    analysisDownsampledSurfelCount: points.length,
    inputPreparationMs: Math.max(0, preparationFinishedAt - preparationStartedAt),
    downsamplingMs: Math.max(0, downsamplingFinishedAt - preparationFinishedAt),
  }
}

function createSpatialIndex(
  points: readonly AnalysisPoint[],
  bucketSize: number,
): Map<string, number[]> {
  const buckets = new Map<string, number[]>()
  points.forEach((point, index) => {
    const key = getBucketKey(point.position, bucketSize)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(index)
    } else {
      buckets.set(key, [index])
    }
  })
  return buckets
}

function collectRegion(
  seedIndex: number,
  points: readonly AnalysisPoint[],
  buckets: ReadonlyMap<string, readonly number[]>,
  config: PlaneExtractionConfig,
  normalCompatibilityDot: number,
): number[] {
  const queue = [seedIndex]
  const queued = new Uint8Array(points.length)
  queued[seedIndex] = 1
  const seed = points[seedIndex]
  const seedPlaneConstant = dot(seed.normal, seed.position)
  const bucketRadius = Math.ceil(config.connectivityDistanceMeters / config.connectivityBucketSizeMeters)

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const current = points[queue[queueIndex]]
    const currentBucketX = quantize(current.position.x, config.connectivityBucketSizeMeters)
    const currentBucketY = quantize(current.position.y, config.connectivityBucketSizeMeters)
    const currentBucketZ = quantize(current.position.z, config.connectivityBucketSizeMeters)

    for (let xOffset = -bucketRadius; xOffset <= bucketRadius; xOffset += 1) {
      for (let yOffset = -bucketRadius; yOffset <= bucketRadius; yOffset += 1) {
        for (let zOffset = -bucketRadius; zOffset <= bucketRadius; zOffset += 1) {
          const bucket = buckets.get(
            `${currentBucketX + xOffset}:${currentBucketY + yOffset}:${currentBucketZ + zOffset}`,
          )
          if (!bucket) {
            continue
          }

          for (const candidateIndex of bucket) {
            if (queued[candidateIndex] === 1) {
              continue
            }
            const candidate = points[candidateIndex]
            if (squaredDistance(current.position, candidate.position) > config.connectivityDistanceMeters ** 2) {
              continue
            }
            if (Math.abs(dot(seed.normal, candidate.normal)) < normalCompatibilityDot) {
              continue
            }
            const seedResidual = Math.abs(dot(seed.normal, candidate.position) - seedPlaneConstant)
            if (seedResidual > config.maximumSeedPlaneErrorMeters) {
              continue
            }
            queued[candidateIndex] = 1
            queue.push(candidateIndex)
          }
        }
      }
    }
  }

  return queue
}

function refineRegion(
  points: readonly AnalysisPoint[],
  region: readonly number[],
  config: PlaneExtractionConfig,
  normalCompatibilityDot: number,
): ExtractedPlane | null {
  let support = [...region]
  let fit = fitPlane(points, support)
  if (!fit) {
    return null
  }

  for (let pass = 0; pass < config.maximumPlaneRefinementPasses; pass += 1) {
    const currentFit = fit
    const nextSupport = support.filter((index) => {
      const point = points[index]
      const residual = Math.abs(dot(currentFit.normal, point.position) - currentFit.planeConstant)
      return residual <= config.maximumPlaneErrorMeters &&
        Math.abs(dot(currentFit.normal, point.normal)) >= normalCompatibilityDot
    })
    if (nextSupport.length === support.length) {
      break
    }
    if (nextSupport.length < 3) {
      return null
    }
    support = nextSupport
    fit = fitPlane(points, support)
    if (!fit) {
      return null
    }
  }

  return { support, fit }
}

function isMergeCompatible(
  first: CandidateGroup,
  second: CandidateGroup,
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
): { compatible: boolean; projectedOverlapRatio: number } {
  const normalAlignment = Math.abs(dot(first.candidate.normal, second.candidate.normal))
  const mergeNormalDot = getNormalCompatibilityDot(config.consolidationAngleDegrees)
  if (normalAlignment < mergeNormalDot) {
    return { compatible: false, projectedOverlapRatio: 0 }
  }

  const planeOffset = Math.abs(
    dot(first.candidate.normal, second.candidate.centroid) - first.candidate.planeConstant,
  )
  if (planeOffset > config.consolidationOffsetToleranceMeters) {
    return { compatible: false, projectedOverlapRatio: 0 }
  }

  const firstRange = getProjectedRange(
    points,
    first.support,
    first.candidate.centroid,
    first.candidate.tangentU,
    first.candidate.tangentV,
  )
  const secondRange = getProjectedRange(
    points,
    second.support,
    first.candidate.centroid,
    first.candidate.tangentU,
    first.candidate.tangentV,
  )
  const projectedOverlapRatio = getProjectedOverlapRatio(firstRange, secondRange)
  const gapU = getRangeGap(firstRange.minU, firstRange.maxU, secondRange.minU, secondRange.maxU)
  const gapV = getRangeGap(firstRange.minV, firstRange.maxV, secondRange.minV, secondRange.maxV)
  const isAdjacent = gapU <= config.consolidationAdjacencyMeters &&
    gapV <= config.consolidationAdjacencyMeters

  return {
    compatible: projectedOverlapRatio >= config.minimumProjectedOverlapRatio || isAdjacent,
    projectedOverlapRatio,
  }
}

function mergeCandidateGroups(
  first: CandidateGroup,
  second: CandidateGroup,
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
  id: string,
): CandidateGroup | null {
  const support = Array.from(new Set([...first.support, ...second.support]))
  const normalCompatibilityDot = getNormalCompatibilityDot(config.maximumNormalAngleDegrees)
  const refined = refineRegion(points, support, config, normalCompatibilityDot)
  if (!refined || refined.support.length < config.minimumSupportPointCount) {
    return null
  }

  const candidate = createPlaneCandidate(id, points, refined.support, refined.fit, config)
  if (
    !candidate ||
    candidate.areaEstimate < config.minimumAreaSquareMeters ||
    candidate.rmsError > config.maximumRmsErrorMeters
  ) {
    return null
  }
  return { candidate, support: refined.support }
}

function consolidateCandidates(
  provisional: readonly CandidateGroup[],
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
): { groups: CandidateGroup[]; diagnostics: ConsolidationDiagnostics } {
  const groups: CandidateGroup[] = provisional.map((group) => ({
    candidate: group.candidate,
    support: [...group.support],
  }))
  let candidatePairsTested = 0
  let highOverlapCandidatePairs = 0
  let candidatesMerged = 0
  let supportOverlapSum = 0

  for (let pass = 0; pass < config.maximumConsolidationPasses; pass += 1) {
    let mergedThisPass = false
    for (let firstIndex = 0; firstIndex < groups.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < groups.length; secondIndex += 1) {
        const first = groups[firstIndex]
        const second = groups[secondIndex]
        candidatePairsTested += 1
        const supportSize = Math.min(first.support.length, second.support.length)
        if (supportSize > 0) {
          supportOverlapSum += countSupportOverlap(first.support, second.support) / supportSize
        }

        const compatibility = isMergeCompatible(first, second, points, config)
        if (compatibility.projectedOverlapRatio >= config.highOverlapRatio) {
          highOverlapCandidatePairs += 1
        }
        if (!compatibility.compatible) {
          continue
        }

        const merged = mergeCandidateGroups(
          first,
          second,
          points,
          config,
          `provisional-merge-${candidatesMerged + 1}`,
        )
        if (!merged) {
          continue
        }

        groups[firstIndex] = merged
        groups.splice(secondIndex, 1)
        candidatesMerged += 1
        mergedThisPass = true
        break
      }
      if (mergedThisPass) {
        break
      }
    }
    if (!mergedThisPass) {
      break
    }
  }

  return {
    groups,
    diagnostics: {
      candidatePairsTested,
      highOverlapCandidatePairs,
      candidatesMerged,
      averageSupportOverlap: candidatePairsTested > 0
        ? supportOverlapSum / candidatePairsTested
        : 0,
    },
  }
}

function getPlaneSeedScore(group: CandidateGroup): number {
  return group.support.length +
    group.candidate.areaEstimate * 100 +
    group.candidate.confidence * 10 -
    group.candidate.rmsError * 100
}

function getCanonicalPlane(candidate: PlaneCandidate): CanonicalPlane {
  return {
    normal: candidate.normal,
    offset: -candidate.planeConstant,
  }
}

function getPlaneRelation(
  first: PlaneCandidate,
  second: PlaneCandidate,
): { angularDifferenceDegrees: number; planeOffsetDifferenceMeters: number } {
  const firstPlane = getCanonicalPlane(first)
  let secondNormal = second.normal
  let secondOffset = -second.planeConstant
  if (dot(firstPlane.normal, secondNormal) < 0) {
    secondNormal = scale(secondNormal, -1)
    secondOffset = -secondOffset
  }

  return {
    angularDifferenceDegrees: (Math.acos(clamp(dot(firstPlane.normal, secondNormal), -1, 1)) * 180) / Math.PI,
    planeOffsetDifferenceMeters: Math.abs(firstPlane.offset - secondOffset),
  }
}

function getPlaneSeedCompatibility(
  first: PlaneCandidate,
  second: PlaneCandidate,
  config: PlaneExtractionConfig,
): boolean {
  const relation = getPlaneRelation(first, second)
  return relation.angularDifferenceDegrees <= config.globalPlaneClusterAngleDegrees &&
    relation.planeOffsetDifferenceMeters <= config.globalPlaneClusterOffsetToleranceMeters
}

function getMedian(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

interface RobustFitResult {
  support: number[]
  fit: FitPlaneResult
  passes: number
}

function fitRobustPlane(
  points: readonly AnalysisPoint[],
  initialSupport: readonly number[],
  config: PlaneExtractionConfig,
): RobustFitResult | null {
  let support = Array.from(new Set(initialSupport))
  let fit = fitPlane(points, support)
  if (!fit) {
    return null
  }

  let passes = 0
  for (; passes < config.maximumGlobalFitPasses; passes += 1) {
    const currentFit = fit
    const residuals = support.map((index) => Math.abs(
      dot(currentFit.normal, points[index].position) - currentFit.planeConstant,
    ))
    const median = getMedian(residuals)
    const deviations = residuals.map((residual) => Math.abs(residual - median))
    const mad = getMedian(deviations)
    const adaptiveThreshold = median + Math.max(0.005, mad * 3)
    const threshold = Math.min(
      config.globalPlaneResidualToleranceMeters,
      Math.max(config.maximumPlaneErrorMeters, adaptiveThreshold),
    )
    const nextSupport = support.filter((_, supportIndex) => residuals[supportIndex] <= threshold)
    if (nextSupport.length === support.length) {
      break
    }
    if (nextSupport.length < 3) {
      return null
    }
    support = nextSupport
    fit = fitPlane(points, support)
    if (!fit) {
      return null
    }
  }

  return { support, fit, passes }
}

function createGlobalCluster(
  group: CandidateGroup,
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
): GlobalPlaneCluster | null {
  const robust = fitRobustPlane(points, group.support, config)
  if (!robust) {
    return null
  }
  const candidate = createPlaneCandidate(
    `global-seed-${group.candidate.id}`,
    points,
    robust.support,
    robust.fit,
    config,
  )
  if (!candidate) {
    return null
  }
  return {
    members: [group],
    support: robust.support,
    fit: robust.fit,
    candidate,
  }
}

function mergeGlobalClusters(
  first: GlobalPlaneCluster,
  second: GlobalPlaneCluster,
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
): GlobalPlaneCluster | null {
  const robust = fitRobustPlane(points, [...first.support, ...second.support], config)
  if (!robust) {
    return null
  }
  const candidate = createPlaneCandidate(
    `global-cluster-${first.members.length + second.members.length}`,
    points,
    robust.support,
    robust.fit,
    config,
  )
  if (!candidate) {
    return null
  }
  return {
    members: [...first.members, ...second.members],
    support: robust.support,
    fit: robust.fit,
    candidate,
  }
}

function clusterCoplanarCandidates(
  provisional: readonly CandidateGroup[],
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
): GlobalPlaneCluster[] {
  const clusters: GlobalPlaneCluster[] = []
  const seeds = provisional
    .slice()
    .sort((left, right) => getPlaneSeedScore(right) - getPlaneSeedScore(left))

  for (const seed of seeds) {
    const fresh = createGlobalCluster(seed, points, config)
    if (!fresh) {
      continue
    }
    const compatibleIndex = clusters.findIndex((cluster) => getPlaneSeedCompatibility(
      cluster.candidate,
      fresh.candidate,
      config,
    ))
    if (compatibleIndex < 0) {
      clusters.push(fresh)
      continue
    }
    const merged = mergeGlobalClusters(clusters[compatibleIndex], fresh, points, config)
    if (merged) {
      clusters[compatibleIndex] = merged
    } else {
      clusters.push(fresh)
    }
  }

  for (let pass = 0; pass < config.maximumConsolidationPasses; pass += 1) {
    let mergedThisPass = false
    for (let firstIndex = 0; firstIndex < clusters.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < clusters.length; secondIndex += 1) {
        if (!getPlaneSeedCompatibility(clusters[firstIndex].candidate, clusters[secondIndex].candidate, config)) {
          continue
        }
        const merged = mergeGlobalClusters(
          clusters[firstIndex],
          clusters[secondIndex],
          points,
          config,
        )
        if (!merged) {
          continue
        }
        clusters[firstIndex] = merged
        clusters.splice(secondIndex, 1)
        mergedThisPass = true
        break
      }
      if (mergedThisPass) {
        break
      }
    }
    if (!mergedThisPass) {
      break
    }
  }

  return clusters
}

function getSpatialBounds(
  points: readonly AnalysisPoint[],
  support: readonly number[],
): SpatialBounds {
  const minimum = { x: Infinity, y: Infinity, z: Infinity }
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const index of support) {
    const position = points[index].position
    minimum.x = Math.min(minimum.x, position.x)
    minimum.y = Math.min(minimum.y, position.y)
    minimum.z = Math.min(minimum.z, position.z)
    maximum.x = Math.max(maximum.x, position.x)
    maximum.y = Math.max(maximum.y, position.y)
    maximum.z = Math.max(maximum.z, position.z)
  }
  return { min: minimum, max: maximum }
}

function getExpandedBounds(bounds: SpatialBounds, padding: number): SpatialBounds {
  return {
    min: {
      x: bounds.min.x - padding,
      y: bounds.min.y - padding,
      z: bounds.min.z - padding,
    },
    max: {
      x: bounds.max.x + padding,
      y: bounds.max.y + padding,
      z: bounds.max.z + padding,
    },
  }
}

function forEachSpatialBucketInBounds(
  bounds: SpatialBounds,
  bucketSize: number,
  buckets: ReadonlyMap<string, readonly number[]>,
  callback: (index: number) => void,
): void {
  const minX = quantize(bounds.min.x, bucketSize)
  const minY = quantize(bounds.min.y, bucketSize)
  const minZ = quantize(bounds.min.z, bucketSize)
  const maxX = quantize(bounds.max.x, bucketSize)
  const maxY = quantize(bounds.max.y, bucketSize)
  const maxZ = quantize(bounds.max.z, bucketSize)
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const bucket = buckets.get(`${x}:${y}:${z}`)
        if (!bucket) {
          continue
        }
        for (const index of bucket) {
          callback(index)
        }
      }
    }
  }
}

function getProjectedOutsideDistanceForFit(
  candidate: PlaneCandidate,
  fit: FitPlaneResult,
  point: SpatialPoint,
): number {
  const relative = subtract(point, fit.centroid)
  const u = dot(relative, candidate.tangentU)
  const v = dot(relative, candidate.tangentV)
  const outsideU = Math.max(candidate.localBounds.minU - u, 0, u - candidate.localBounds.maxU)
  const outsideV = Math.max(candidate.localBounds.minV - v, 0, v - candidate.localBounds.maxV)
  return Math.hypot(outsideU, outsideV)
}

interface GlobalExpansionResult {
  group: CandidateGroup
  initialSupportCount: number
  fitPasses: number
}

function expandGlobalPlane(
  cluster: GlobalPlaneCluster,
  points: readonly AnalysisPoint[],
  buckets: ReadonlyMap<string, readonly number[]>,
  available: Uint8Array,
  config: PlaneExtractionConfig,
  diagnostics: GlobalReassemblyDiagnostics,
  id: string,
): GlobalExpansionResult | null {
  const support = cluster.support.filter((index) => available[index] === 1)
  if (support.length < config.minimumSupportPointCount) {
    return null
  }

  let robust = fitRobustPlane(points, support, config)
  if (!robust) {
    return null
  }
  diagnostics.globalPlaneRefits += 1 + robust.passes
  const included = new Uint8Array(points.length)
  for (const index of robust.support) {
    included[index] = 1
  }

  for (let pass = 0; pass < config.maximumGlobalExpansionPasses; pass += 1) {
    diagnostics.globalExpansionPasses += 1
    const supportBeforePass = robust.support.length
    const searchBounds = getExpandedBounds(
      getSpatialBounds(points, robust.support),
      config.globalPlaneSearchPaddingMeters,
    )
    const candidate = createPlaneCandidate(
      id,
      points,
      robust.support,
      robust.fit,
      config,
    )
    if (!candidate) {
      return null
    }
    const currentRobust = robust
    const normalCompatibilityDot = getNormalCompatibilityDot(config.globalPlaneExpansionAngleDegrees)
    forEachSpatialBucketInBounds(
      searchBounds,
      config.connectivityBucketSizeMeters,
      buckets,
      (candidateIndex) => {
        if (available[candidateIndex] === 0 || included[candidateIndex] === 1) {
          return
        }
        const point = points[candidateIndex]
        const residual = Math.abs(dot(currentRobust.fit.normal, point.position) - currentRobust.fit.planeConstant)
        if (residual > config.globalPlaneResidualToleranceMeters) {
          diagnostics.globalResidualRejects += 1
          return
        }
        const normalAgreement = Math.abs(dot(currentRobust.fit.normal, point.normal))
        if (normalAgreement < normalCompatibilityDot) {
          diagnostics.globalNormalRejects += 1
          return
        }
        if (getProjectedOutsideDistanceForFit(candidate, currentRobust.fit, point.position) > config.globalPlaneSearchPaddingMeters) {
          diagnostics.globalSupportRejects += 1
          return
        }
        included[candidateIndex] = 1
        currentRobust.support.push(candidateIndex)
      },
    )

    if (robust.support.length === supportBeforePass) {
      break
    }
    const nextRobust = fitRobustPlane(points, robust.support, config)
    if (!nextRobust) {
      return null
    }
    robust = nextRobust
    diagnostics.globalPlaneRefits += 1 + robust.passes
  }

  const candidate = createPlaneCandidate(id, points, robust.support, robust.fit, config)
  if (
    !candidate ||
    candidate.areaEstimate < config.minimumAreaSquareMeters ||
    candidate.rmsError > config.maximumRmsErrorMeters
  ) {
    return null
  }
  return {
    group: { candidate, support: robust.support },
    initialSupportCount: cluster.support.length,
    fitPasses: robust.passes,
  }
}

function reassembleGlobalPlanes(
  provisional: readonly CandidateGroup[],
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
): GlobalReassemblyResult {
  const diagnostics: GlobalReassemblyDiagnostics = {
    planeParameterClusterCount: 0,
    globalPlanesAttempted: 0,
    globalPlanesAccepted: 0,
    globalPointsAbsorbed: 0,
    globalFragmentsAbsorbed: 0,
    globalExpansionPasses: 0,
    globalPlaneRefits: 0,
    globalResidualRejects: 0,
    globalNormalRejects: 0,
    globalSupportRejects: 0,
  }
  if (provisional.length === 0 || points.length === 0) {
    return { groups: [], diagnostics }
  }

  const clusters = clusterCoplanarCandidates(provisional, points, config)
  diagnostics.planeParameterClusterCount = clusters.length
  clusters.sort((left, right) => getPlaneSeedScore({
    candidate: right.candidate,
    support: right.support,
  }) - getPlaneSeedScore({
    candidate: left.candidate,
    support: left.support,
  }))

  const available = new Uint8Array(points.length)
  available.fill(1)
  const buckets = createSpatialIndex(points, config.connectivityBucketSizeMeters)
  const groups: CandidateGroup[] = []
  for (const cluster of clusters) {
    diagnostics.globalPlanesAttempted += 1
    const expanded = expandGlobalPlane(
      cluster,
      points,
      buckets,
      available,
      config,
      diagnostics,
      `global-plane-${groups.length + 1}`,
    )
    if (!expanded) {
      continue
    }
    for (const index of expanded.group.support) {
      available[index] = 0
    }
    diagnostics.globalPlanesAccepted += 1
    diagnostics.globalPointsAbsorbed += Math.max(
      0,
      expanded.group.support.length - expanded.initialSupportCount,
    )
    diagnostics.globalFragmentsAbsorbed += Math.max(0, cluster.members.length - 1)
    groups.push(expanded.group)
  }

  return { groups, diagnostics }
}

function getProjectedOutsideDistance(
  candidate: PlaneCandidate,
  point: SpatialPoint,
): number {
  const relative = subtract(point, candidate.centroid)
  const u = dot(relative, candidate.tangentU)
  const v = dot(relative, candidate.tangentV)
  const outsideU = Math.max(candidate.localBounds.minU - u, 0, u - candidate.localBounds.maxU)
  const outsideV = Math.max(candidate.localBounds.minV - v, 0, v - candidate.localBounds.maxV)
  return Math.hypot(outsideU, outsideV)
}

function assignPointOwnership(
  points: readonly AnalysisPoint[],
  groups: readonly CandidateGroup[],
  config: PlaneExtractionConfig,
): OwnershipResult {
  const ownedSupports = groups.map(() => [] as number[])

  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex]
    let bestGroupIndex = -1
    let bestScore = Number.POSITIVE_INFINITY

    groups.forEach((group, groupIndex) => {
      const residual = Math.abs(dot(group.candidate.normal, point.position) - group.candidate.planeConstant)
      if (residual > config.maximumPlaneErrorMeters) {
        return
      }
      const normalAgreement = Math.abs(dot(group.candidate.normal, point.normal))
      const outsideDistance = getProjectedOutsideDistance(group.candidate, point.position)
      if (outsideDistance > config.ownershipBoundsPaddingMeters) {
        return
      }

      const score = residual / config.maximumPlaneErrorMeters +
        (1 - normalAgreement) * 0.75 +
        outsideDistance / Math.max(1e-6, config.ownershipBoundsPaddingMeters)
      if (score < bestScore) {
        bestScore = score
        bestGroupIndex = groupIndex
      }
    })

    if (bestGroupIndex >= 0) {
      ownedSupports[bestGroupIndex].push(pointIndex)
    }
  }

  const finalGroups: CandidateGroup[] = []
  let assignedPointCount = 0
  ownedSupports.forEach((support) => {
    if (support.length < config.minimumSupportPointCount) {
      return
    }
    const refined = fitRobustPlane(points, support, config)
    if (!refined || refined.support.length < config.minimumSupportPointCount) {
      return
    }
    const candidate = createPlaneCandidate(
      `plane-${finalGroups.length + 1}`,
      points,
      refined.support,
      refined.fit,
      config,
    )
    if (
      !candidate ||
      candidate.areaEstimate < config.minimumAreaSquareMeters ||
      candidate.rmsError > config.maximumRmsErrorMeters
    ) {
      return
    }
    finalGroups.push({ candidate, support: refined.support })
    assignedPointCount += refined.support.length
  })

  return { groups: finalGroups, assignedPointCount }
}

function createPlaneRelationshipDiagnostics(
  planes: readonly PlaneCandidate[],
): PlaneRelationshipDiagnostic[] {
  const relationships: PlaneRelationshipDiagnostic[] = []
  const limit = Math.min(planes.length, 5)
  for (let firstIndex = 0; firstIndex < limit; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < limit; secondIndex += 1) {
      const relation = getPlaneRelation(planes[firstIndex], planes[secondIndex])
      relationships.push({
        firstPlaneId: planes[firstIndex].id,
        secondPlaneId: planes[secondIndex].id,
        angularDifferenceDegrees: relation.angularDifferenceDegrees,
        planeOffsetDifferenceMeters: relation.planeOffsetDifferenceMeters,
      })
    }
  }
  return relationships
}

function extractProvisionalPlanes(
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
): CandidateGroup[] {
  const buckets = createSpatialIndex(points, config.connectivityBucketSizeMeters)
  const assigned = new Uint8Array(points.length)
  const normalCompatibilityDot = getNormalCompatibilityDot(config.maximumNormalAngleDegrees)
  const extracted: CandidateGroup[] = []

  for (let seedIndex = 0; seedIndex < points.length; seedIndex += 1) {
    if (assigned[seedIndex] === 1) {
      continue
    }

    const region = collectRegion(
      seedIndex,
      points,
      buckets,
      config,
      normalCompatibilityDot,
    )
    if (region.length < config.minimumSupportPointCount) {
      continue
    }

    const refined = refineRegion(points, region, config, normalCompatibilityDot)
    if (!refined || refined.support.length < config.minimumSupportPointCount) {
      continue
    }

    const candidate = createPlaneCandidate(
      `plane-${extracted.length + 1}`,
      points,
      refined.support,
      refined.fit,
      config,
    )
    if (
      !candidate ||
      candidate.areaEstimate < config.minimumAreaSquareMeters ||
      candidate.rmsError > config.maximumRmsErrorMeters
    ) {
      continue
    }

    for (const index of refined.support) {
      assigned[index] = 1
    }
    extracted.push({ candidate, support: refined.support })
  }

  return extracted
}

function nextDeterministicSeed(seed: number): number {
  let next = seed >>> 0
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  return next >>> 0
}

function createPointPlaneHypothesis(
  first: AnalysisPoint,
  second: AnalysisPoint,
  third: AnalysisPoint,
  minimumCrossMagnitude: number,
): { normal: SpatialPoint; offset: number } | null {
  const firstEdge = subtract(second.position, first.position)
  const secondEdge = subtract(third.position, first.position)
  const crossProduct = cross(firstEdge, secondEdge)
  const crossMagnitude = length(crossProduct)
  if (!Number.isFinite(crossMagnitude) || crossMagnitude < minimumCrossMagnitude) {
    return null
  }

  const normal = normalize(crossProduct)
  if (!normal) {
    return null
  }
  return {
    normal,
    offset: -dot(normal, first.position),
  }
}

interface RansacEvaluation {
  inlierCount: number
  weightedSupport: number
  rmsError: number
  occupiedBoundsArea: number
  score: number
}

function evaluateRansacHypothesis(
  points: readonly AnalysisPoint[],
  eligible: readonly number[],
  normal: SpatialPoint,
  offset: number,
  config: PlaneExtractionConfig,
): RansacEvaluation {
  const basis = choosePlaneBasis(normal)
  let inlierCount = 0
  let weightedSupport = 0
  let weightedSquaredError = 0
  let totalWeight = 0
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  const origin = points[eligible[0]].position

  for (const index of eligible) {
    const point = points[index]
    totalWeight += point.weight
    const residual = Math.abs(dot(normal, point.position) + offset)
    if (residual > config.ransacInlierDistanceMeters) {
      continue
    }

    inlierCount += 1
    weightedSupport += point.weight
    weightedSquaredError += residual * residual * point.weight
    if (basis) {
      const relative = subtract(point.position, origin)
      const u = dot(relative, basis.tangentU)
      const v = dot(relative, basis.tangentV)
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
  }

  const rmsError = weightedSupport > 0
    ? Math.sqrt(weightedSquaredError / weightedSupport)
    : config.ransacInlierDistanceMeters
  const occupiedBoundsArea = Number.isFinite(minU) && Number.isFinite(minV)
    ? Math.max(0, maxU - minU) * Math.max(0, maxV - minV)
    : 0
  const areaReference = Math.max(config.minimumAreaSquareMeters * 2, 1)
  const areaQuality = 0.5 + 0.5 * clamp(occupiedBoundsArea / areaReference, 0, 1)
  const residualQuality = 1 - clamp(rmsError / config.ransacInlierDistanceMeters, 0, 1)

  return {
    inlierCount,
    weightedSupport,
    rmsError,
    occupiedBoundsArea,
    score: weightedSupport * areaQuality * (0.5 + 0.5 * residualQuality),
  }
}

function collectRansacInliers(
  points: readonly AnalysisPoint[],
  eligible: readonly number[],
  normal: SpatialPoint,
  offset: number,
  tolerance: number,
  target: number[],
): void {
  target.length = 0
  for (const index of eligible) {
    const residual = Math.abs(dot(normal, points[index].position) + offset)
    if (residual <= tolerance) {
      target.push(index)
    }
  }
}

interface RansacSearchResult {
  hypothesis: RansacHypothesis | null
  hypothesesTested: number
  degenerateHypothesesRejected: number
  iterationsUsed: number
}

function findBestRansacHypothesis(
  points: readonly AnalysisPoint[],
  eligible: readonly number[],
  config: PlaneExtractionConfig,
  planeOrdinal: number,
): RansacSearchResult {
  let seed = (config.ransacSeed + Math.imul(planeOrdinal + 1, 0x9e3779b9)) >>> 0
  let best: RansacHypothesis | null = null
  let hypothesesTested = 0
  let degenerateHypothesesRejected = 0
  let iterationsUsed = 0
  const bestSupport: number[] = []

  const pickIndex = (): number => {
    seed = nextDeterministicSeed(seed)
    return eligible[seed % eligible.length]
  }

  for (let iteration = 0; iteration < config.ransacHypothesisCount; iteration += 1) {
    iterationsUsed = iteration + 1
    hypothesesTested += 1
    const firstIndex = pickIndex()
    let secondIndex = pickIndex()
    let thirdIndex = pickIndex()
    for (let retry = 0; secondIndex === firstIndex && retry < 8; retry += 1) {
      secondIndex = pickIndex()
    }
    for (let retry = 0; (thirdIndex === firstIndex || thirdIndex === secondIndex) && retry < 8; retry += 1) {
      thirdIndex = pickIndex()
    }
    const hypothesis = createPointPlaneHypothesis(
      points[firstIndex],
      points[secondIndex],
      points[thirdIndex],
      config.minimumHypothesisCrossMagnitude,
    )
    if (!hypothesis) {
      degenerateHypothesesRejected += 1
      continue
    }

    const evaluation = evaluateRansacHypothesis(
      points,
      eligible,
      hypothesis.normal,
      hypothesis.offset,
      config,
    )
    if (
      best &&
      evaluation.score <= best.score &&
      evaluation.inlierCount <= best.inlierCount
    ) {
      continue
    }

    collectRansacInliers(
      points,
      eligible,
      hypothesis.normal,
      hypothesis.offset,
      config.ransacInlierDistanceMeters,
      bestSupport,
    )
    best = {
      normal: hypothesis.normal,
      offset: hypothesis.offset,
      support: [...bestSupport],
      inlierCount: evaluation.inlierCount,
      weightedSupport: evaluation.weightedSupport,
      rmsError: evaluation.rmsError,
      occupiedBoundsArea: evaluation.occupiedBoundsArea,
      score: evaluation.score,
    }

    if (evaluation.inlierCount >= eligible.length * config.ransacEarlyTerminationFraction) {
      break
    }
  }

  return {
    hypothesis: best,
    hypothesesTested,
    degenerateHypothesesRejected,
    iterationsUsed,
  }
}

interface ProjectedSupportCell {
  u: number
  v: number
  indices: number[]
}

function filterRansacSupportComponents(
  points: readonly AnalysisPoint[],
  support: readonly number[],
  fit: FitPlaneResult,
  config: PlaneExtractionConfig,
): number[] {
  const basis = choosePlaneBasis(fit.normal)
  if (!basis || support.length < 3) {
    return [...support]
  }

  const cells = new Map<string, ProjectedSupportCell>()
  for (const index of support) {
    const relative = subtract(points[index].position, fit.centroid)
    const u = Math.floor(dot(relative, basis.tangentU) / config.ransacSupportCellSizeMeters)
    const v = Math.floor(dot(relative, basis.tangentV) / config.ransacSupportCellSizeMeters)
    const key = `${u}:${v}`
    const cell = cells.get(key)
    if (cell) {
      cell.indices.push(index)
    } else {
      cells.set(key, { u, v, indices: [index] })
    }
  }

  const unvisited = new Set(cells.keys())
  const components: { indices: number[]; cellCount: number }[] = []
  const cellRadius = Math.ceil(config.ransacSupportGapMeters / config.ransacSupportCellSizeMeters)
  while (unvisited.size > 0) {
    const firstKey = unvisited.values().next().value
    if (typeof firstKey !== 'string') {
      break
    }
    unvisited.delete(firstKey)
    const firstCell = cells.get(firstKey)
    if (!firstCell) {
      continue
    }
    const queue = [firstCell]
    const componentIndices: number[] = []
    let cellCount = 0
    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const cell = queue[queueIndex]
      cellCount += 1
      componentIndices.push(...cell.indices)
      for (let uOffset = -cellRadius; uOffset <= cellRadius; uOffset += 1) {
        for (let vOffset = -cellRadius; vOffset <= cellRadius; vOffset += 1) {
          if (uOffset === 0 && vOffset === 0) {
            continue
          }
          const neighborKey = `${cell.u + uOffset}:${cell.v + vOffset}`
          if (!unvisited.delete(neighborKey)) {
            continue
          }
          const neighbor = cells.get(neighborKey)
          if (neighbor) {
            queue.push(neighbor)
          }
        }
      }
    }
    components.push({ indices: componentIndices, cellCount })
  }

  const minimumComponentArea = config.minimumAreaSquareMeters * 0.25
  const retained = components
    .filter((component) => component.indices.length >= config.minimumSupportPointCount ||
      component.cellCount * config.ransacSupportCellSizeMeters ** 2 >= minimumComponentArea)
    .flatMap((component) => component.indices)
  return retained.length >= 3 ? retained : [...support]
}

interface DominantPlaneRefinement {
  support: number[]
  fit: FitPlaneResult
  passes: number
}

function refineDominantRansacSupport(
  points: readonly AnalysisPoint[],
  eligible: readonly number[],
  initialSupport: readonly number[],
  config: PlaneExtractionConfig,
): DominantPlaneRefinement | null {
  let robust = fitRobustPlane(points, initialSupport, config)
  if (!robust) {
    return null
  }
  let support = filterRansacSupportComponents(points, robust.support, robust.fit, config)
  robust = fitRobustPlane(points, support, config)
  if (!robust) {
    return null
  }

  let passes = robust.passes
  for (let pass = 0; pass < config.maximumGlobalExpansionPasses; pass += 1) {
    const included = new Uint8Array(points.length)
    for (const index of robust.support) {
      included[index] = 1
    }
    const supportBeforeExpansion = robust.support.length
    for (const index of eligible) {
      if (included[index] === 1) {
        continue
      }
      const residual = Math.abs(dot(robust.fit.normal, points[index].position) - robust.fit.planeConstant)
      if (residual <= config.ransacInlierDistanceMeters) {
        robust.support.push(index)
      }
    }
    support = filterRansacSupportComponents(points, robust.support, robust.fit, config)
    const nextRobust = fitRobustPlane(points, support, config)
    if (!nextRobust) {
      return null
    }
    robust = nextRobust
    passes += 1 + robust.passes
    if (support.length === supportBeforeExpansion) {
      break
    }
  }

  return { support: robust.support, fit: robust.fit, passes }
}

function extractDominantPlanesByRansac(
  points: readonly AnalysisPoint[],
  config: PlaneExtractionConfig,
): RansacExtractionResult {
  const diagnostics: RansacDiagnostics = {
    hypothesesTested: 0,
    degenerateHypothesesRejected: 0,
    bestHypothesisInitialInliers: 0,
    bestHypothesisWeightedSupport: 0,
    bestHypothesisInitialRms: 0,
    refinedSupportPointCount: 0,
    refinedRmsError: 0,
    refinedOccupiedArea: 0,
    acceptedDominantPlanes: 0,
    iterationsPerAcceptedPlane: [],
    ransacMs: 0,
    refinementMs: 0,
  }
  const available = new Uint8Array(points.length)
  available.fill(1)
  const groups: CandidateGroup[] = []
  let firstPlane = true

  for (let planeOrdinal = 0; planeOrdinal < config.maximumDominantPlanes; planeOrdinal += 1) {
    const eligible: number[] = []
    for (let index = 0; index < points.length; index += 1) {
      if (available[index] === 1) {
        eligible.push(index)
      }
    }
    if (eligible.length < config.minimumSupportPointCount) {
      break
    }

    const searchStartedAt = getTimestamp()
    const search = findBestRansacHypothesis(points, eligible, config, planeOrdinal)
    diagnostics.ransacMs += Math.max(0, getTimestamp() - searchStartedAt)
    diagnostics.hypothesesTested += search.hypothesesTested
    diagnostics.degenerateHypothesesRejected += search.degenerateHypothesesRejected
    const hypothesis = search.hypothesis
    if (!hypothesis || hypothesis.inlierCount < config.minimumSupportPointCount) {
      break
    }
    if (firstPlane) {
      diagnostics.bestHypothesisInitialInliers = hypothesis.inlierCount
      diagnostics.bestHypothesisWeightedSupport = hypothesis.weightedSupport
      diagnostics.bestHypothesisInitialRms = hypothesis.rmsError
    }

    const refinementStartedAt = getTimestamp()
    const refined = refineDominantRansacSupport(points, eligible, hypothesis.support, config)
    diagnostics.refinementMs += Math.max(0, getTimestamp() - refinementStartedAt)
    if (!refined) {
      break
    }
    const candidate = createPlaneCandidate(
      `ransac-plane-${groups.length + 1}`,
      points,
      refined.support,
      refined.fit,
      config,
    )
    if (
      !candidate ||
      refined.support.length < config.minimumSupportPointCount ||
      candidate.areaEstimate < config.minimumAreaSquareMeters ||
      candidate.rmsError > config.maximumRmsErrorMeters
    ) {
      break
    }
    const supportFraction = refined.support.length / eligible.length
    if (
      supportFraction < config.minimumRansacSupportFraction &&
      candidate.areaEstimate < config.minimumAreaSquareMeters * 2
    ) {
      break
    }

    for (const index of refined.support) {
      available[index] = 0
    }
    groups.push({ candidate, support: refined.support })
    diagnostics.acceptedDominantPlanes += 1
    diagnostics.iterationsPerAcceptedPlane.push(search.iterationsUsed)
    if (firstPlane) {
      diagnostics.refinedSupportPointCount = refined.support.length
      diagnostics.refinedRmsError = refined.fit.rmsError
      diagnostics.refinedOccupiedArea = candidate.areaEstimate
      firstPlane = false
    }
  }

  return { groups, diagnostics }
}

function createEmptyConsolidationDiagnostics(): ConsolidationDiagnostics {
  return {
    candidatePairsTested: 0,
    highOverlapCandidatePairs: 0,
    candidatesMerged: 0,
    averageSupportOverlap: 0,
  }
}

function createEmptyGlobalReassemblyDiagnostics(): GlobalReassemblyDiagnostics {
  return {
    planeParameterClusterCount: 0,
    globalPlanesAttempted: 0,
    globalPlanesAccepted: 0,
    globalPointsAbsorbed: 0,
    globalFragmentsAbsorbed: 0,
    globalExpansionPasses: 0,
    globalPlaneRefits: 0,
    globalResidualRejects: 0,
    globalNormalRejects: 0,
    globalSupportRejects: 0,
  }
}

export class PlaneExtractionService {
  private readonly config: PlaneExtractionConfig

  constructor(config: PlaneExtractionConfig = DEFAULT_PLANE_EXTRACTION_CONFIG) {
    this.config = config
  }

  public analyze(scan: FinalizedSpatialScan): RoomAnalysisResult {
    const analysisStartedAt = getTimestamp()
    const prepared = createAnalysisPointMap(scan, this.config)
    let legacyProvisionalGroups: CandidateGroup[] = []
    let legacyConsolidationDiagnostics = createEmptyConsolidationDiagnostics()
    let legacyGlobalDiagnostics = createEmptyGlobalReassemblyDiagnostics()
    let legacyAnalysisMs = 0
    if (this.config.enableLegacyDiagnostics === true) {
      const legacyStartedAt = getTimestamp()
      legacyProvisionalGroups = extractProvisionalPlanes(prepared.points, this.config)
      const consolidated = consolidateCandidates(legacyProvisionalGroups, prepared.points, this.config)
      legacyConsolidationDiagnostics = consolidated.diagnostics
      legacyGlobalDiagnostics = reassembleGlobalPlanes(
        legacyProvisionalGroups,
        prepared.points,
        this.config,
      ).diagnostics
      legacyAnalysisMs = Math.max(0, getTimestamp() - legacyStartedAt)
    }
    const ransac = extractDominantPlanesByRansac(prepared.points, this.config)
    const ownershipStartedAt = getTimestamp()
    const owned = assignPointOwnership(prepared.points, ransac.groups, this.config)
    const ownershipFinishedAt = getTimestamp()
    const rankedGroups = owned.groups
      .slice()
      .sort((left, right) => right.candidate.areaEstimate - left.candidate.areaEstimate)
    const planes = rankedGroups
      .map((group) => group.candidate)
      .map((plane, index) => ({ ...plane, id: `plane-${index + 1}` }))
    const largestPlane = planes[0]
    const secondLargestPlane = planes[1]
    const largestGroup = rankedGroups[0]
    const assignedPercentage = prepared.points.length > 0
      ? (owned.assignedPointCount / prepared.points.length) * 100
      : 0
    const largestPlaneSupportPercentage = owned.assignedPointCount > 0 && largestGroup
      ? (largestGroup.support.length / owned.assignedPointCount) * 100
      : 0
    const secondLargestPlaneSupportPercentage = owned.assignedPointCount > 0 && rankedGroups[1]
      ? (rankedGroups[1].support.length / owned.assignedPointCount) * 100
      : 0
    const topThreePlaneSupportPercentage = owned.assignedPointCount > 0
      ? (rankedGroups.slice(0, 3).reduce((total, group) => total + group.support.length, 0) /
        owned.assignedPointCount) * 100
      : 0
    const planeRelationships = createPlaneRelationshipDiagnostics(planes)

    const result: RoomAnalysisResult = {
      sourceScanId: scan.id,
      planes: Object.freeze(planes),
      stats: {
        inputPoints: prepared.inputPoints,
        coverageGeometryPoints: prepared.coverageGeometryPoints,
        finalizedFusedSurfelCount: prepared.finalizedFusedSurfelCount,
        filteredPoints: prepared.filteredPoints,
        analysisFilteredSurfelCount: prepared.analysisFilteredSurfelCount,
        downsampledPoints: prepared.points.length,
        analysisDownsampledSurfelCount: prepared.analysisDownsampledSurfelCount,
        provisionalPlaneCount: legacyProvisionalGroups.length,
        planeCount: planes.length,
        assignedPoints: owned.assignedPointCount,
        unassignedPoints: Math.max(0, prepared.points.length - owned.assignedPointCount),
        assignedPercentage,
        rejectedPoints: Math.max(0, prepared.points.length - owned.assignedPointCount),
        candidatePairsTested: legacyConsolidationDiagnostics.candidatePairsTested,
        highOverlapCandidatePairs: legacyConsolidationDiagnostics.highOverlapCandidatePairs,
        candidatesMerged: legacyConsolidationDiagnostics.candidatesMerged,
        duplicateCandidatesSuppressed: Math.max(0, legacyProvisionalGroups.length - planes.length),
        averageSupportOverlap: legacyConsolidationDiagnostics.averageSupportOverlap,
        planeParameterClusterCount: legacyGlobalDiagnostics.planeParameterClusterCount,
        globalPlanesAttempted: legacyGlobalDiagnostics.globalPlanesAttempted,
        globalPlanesAccepted: legacyGlobalDiagnostics.globalPlanesAccepted,
        globalPointsAbsorbed: legacyGlobalDiagnostics.globalPointsAbsorbed,
        globalFragmentsAbsorbed: legacyGlobalDiagnostics.globalFragmentsAbsorbed,
        globalExpansionPasses: legacyGlobalDiagnostics.globalExpansionPasses,
        globalPlaneRefits: legacyGlobalDiagnostics.globalPlaneRefits,
        globalResidualRejects: legacyGlobalDiagnostics.globalResidualRejects,
        globalNormalRejects: legacyGlobalDiagnostics.globalNormalRejects,
        globalSupportRejects: legacyGlobalDiagnostics.globalSupportRejects,
        ransacHypothesesTested: ransac.diagnostics.hypothesesTested,
        degenerateHypothesesRejected: ransac.diagnostics.degenerateHypothesesRejected,
        bestHypothesisInitialInliers: ransac.diagnostics.bestHypothesisInitialInliers,
        bestHypothesisWeightedSupport: ransac.diagnostics.bestHypothesisWeightedSupport,
        bestHypothesisInitialRms: ransac.diagnostics.bestHypothesisInitialRms,
        refinedSupportPointCount: ransac.diagnostics.refinedSupportPointCount,
        refinedRmsError: ransac.diagnostics.refinedRmsError,
        refinedOccupiedArea: ransac.diagnostics.refinedOccupiedArea,
        acceptedDominantPlaneCount: ransac.diagnostics.acceptedDominantPlanes,
        largestPlaneSupportPointCount: largestPlane?.supportPointCount ?? 0,
        largestPlaneOccupiedArea: largestPlane?.areaEstimate ?? 0,
        largestPlaneRmsError: largestPlane?.rmsError ?? 0,
        secondLargestPlaneSupportPointCount: secondLargestPlane?.supportPointCount ?? 0,
        secondLargestPlaneOccupiedArea: secondLargestPlane?.areaEstimate ?? 0,
        secondLargestPlaneRmsError: secondLargestPlane?.rmsError ?? 0,
        largestPlaneSupportPercentage,
        secondLargestPlaneSupportPercentage,
        topThreePlaneSupportPercentage,
        dominantSeedsAttempted: ransac.diagnostics.acceptedDominantPlanes,
        dominantPlanesAccepted: ransac.diagnostics.acceptedDominantPlanes,
        pointsAbsorbedDuringExpansion: 0,
        fragmentsAbsorbedDuringExpansion: 0,
        expansionPasses: 0,
        planeRefits: 0,
        expansionResidualRejects: 0,
        expansionNormalRejects: 0,
        expansionConnectivityRejects: 0,
      },
      planeRelationships: Object.freeze(planeRelationships),
      ransacIterationsPerPlane: Object.freeze([...ransac.diagnostics.iterationsPerAcceptedPlane]),
      timings: {
        inputPreparationMs: prepared.inputPreparationMs,
        downsamplingMs: prepared.downsamplingMs,
        initialExtractionMs: ransac.diagnostics.ransacMs,
        consolidationMs: legacyAnalysisMs,
        ransacMs: ransac.diagnostics.ransacMs,
        refinementMs: ransac.diagnostics.refinementMs,
        globalReassemblyMs: ransac.diagnostics.refinementMs,
        dominantExpansionMs: ransac.diagnostics.refinementMs,
        ownershipMs: Math.max(0, ownershipFinishedAt - ownershipStartedAt),
        totalMs: Math.max(0, ownershipFinishedAt - analysisStartedAt),
      },
    }

    return Object.freeze(result)
  }
}

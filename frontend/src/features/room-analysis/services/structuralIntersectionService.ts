import type { FinalizedSpatialScan, SpatialPoint } from '../../scanner/types'
import type {
  RoomStructureInterpretationResult,
  StructuralIntersectionCandidate,
  StructuralIntersectionLine,
  StructuralIntersectionRange,
  StructuralIntersectionResult,
  StructuralIntersectionSegment,
  StructuralIntersectionStatus,
  StructuralIntersectionType,
  StructuralSurfaceCandidate,
} from '../types'
import {
  associateFinalizedSupportPoints,
  collectNearLineSupport,
  computePlanePlaneIntersectionLine,
  type SupportAssociation,
  type SupportPlaneGeometry,
} from './structuralSupportGeometry'

export interface StructuralIntersectionConfig {
  /** Reject planes whose normalized cross product is too small to define a line. */
  minimumPlaneCrossMagnitude: number
  /** Maximum distance from a selected plane for a finalized surfel to be support. */
  maximumSupportPlaneResidualMeters: number
  /** Soft normal guard used while associating finalized surfels with selected planes. */
  minimumSupportNormalDot: number
  /** Additional tangent-space margin around a selected plane's observed bounds. */
  supportBoundsPaddingMeters: number
  /** Maximum distance from the mathematical line for support to count. */
  maximumLineSupportDistanceMeters: number
  /** Fraction trimmed from each end of a sufficiently large support interval. */
  intervalTrimFraction: number
  /** Size of line-interval occupancy bins used for continuity. */
  continuityBinSizeMeters: number
  /** Smallest supported finite segment worth presenting as supported. */
  minimumSupportedSegmentLengthMeters: number
  /** Smallest partial segment worth preserving as a finite candidate. */
  minimumPartialSegmentLengthMeters: number
  /** Minimum near-line support on each surface for a supported result. */
  minimumSupportPointsPerSurface: number
  /** Minimum two-sided continuity for a supported result. */
  minimumSupportedContinuity: number
  /** Minimum two-sided continuity for a partial result. */
  minimumPartialContinuity: number
  /** Bounded interval gap that can be reported as a partial scan gap. */
  supportIntervalGapToleranceMeters: number
}

export const DEFAULT_STRUCTURAL_INTERSECTION_CONFIG: StructuralIntersectionConfig = {
  minimumPlaneCrossMagnitude: 0.001,
  maximumSupportPlaneResidualMeters: 0.12,
  minimumSupportNormalDot: 0.45,
  supportBoundsPaddingMeters: 0.2,
  maximumLineSupportDistanceMeters: 0.15,
  intervalTrimFraction: 0.1,
  continuityBinSizeMeters: 0.1,
  minimumSupportedSegmentLengthMeters: 0.12,
  minimumPartialSegmentLengthMeters: 0.03,
  minimumSupportPointsPerSurface: 2,
  minimumSupportedContinuity: 0.5,
  minimumPartialContinuity: 0.12,
  supportIntervalGapToleranceMeters: 0.2,
}

interface NormalizedSurface {
  surface: StructuralSurfaceCandidate
  normal: SpatialPoint
  /** Internal representation of n dot x = planeConstant. */
  planeConstant: number
}

interface PairDefinition {
  surfaceA: StructuralSurfaceCandidate
  surfaceB: StructuralSurfaceCandidate
  type: StructuralIntersectionType
}

interface PreparedPair extends PairDefinition {
  normalizedA: NormalizedSurface | null
  normalizedB: NormalizedSurface | null
  line: StructuralIntersectionLine | null
  lineRejectionReason: string | null
}

const TYPE_ORDER: Record<StructuralIntersectionType, number> = {
  'wall-wall': 0,
  'wall-ceiling': 1,
  'wall-floor': 2,
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function isFinitePoint(point: SpatialPoint): boolean {
  return isFiniteNumber(point.x) && isFiniteNumber(point.y) && isFiniteNumber(point.z)
}

function dot(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function subtract(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z,
  }
}

function addScaled(first: SpatialPoint, second: SpatialPoint, scale: number): SpatialPoint {
  return {
    x: first.x + second.x * scale,
    y: first.y + second.y * scale,
    z: first.z + second.z * scale,
  }
}

function scale(point: SpatialPoint, scalar: number): SpatialPoint {
  return { x: point.x * scalar, y: point.y * scalar, z: point.z * scalar }
}

function magnitude(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function normalizeSurface(surface: StructuralSurfaceCandidate): NormalizedSurface | null {
  const normalLength = magnitude(surface.normal)
  if (!isFiniteNumber(normalLength) || normalLength <= Number.EPSILON) {
    return null
  }
  const normal = scale(surface.normal, 1 / normalLength)
  const planeConstant = surface.planeConstant / normalLength
  if (!isFinitePoint(normal) || !isFiniteNumber(planeConstant)) {
    return null
  }
  return { surface, normal, planeConstant }
}

function calculateContinuity(
  values: readonly number[],
  interval: StructuralIntersectionRange | null,
  config: StructuralIntersectionConfig,
): number {
  if (!interval || interval.maximum <= interval.minimum || values.length === 0) {
    return 0
  }
  const binCount = Math.max(1, Math.ceil((interval.maximum - interval.minimum) / config.continuityBinSizeMeters))
  const occupiedBins = new Uint8Array(binCount)
  for (const value of values) {
    if (value < interval.minimum || value > interval.maximum) {
      continue
    }
    const normalized = (value - interval.minimum) / Math.max(interval.maximum - interval.minimum, Number.EPSILON)
    const bin = Math.min(binCount - 1, Math.floor(normalized * binCount))
    occupiedBins[bin] = 1
  }
  let occupiedCount = 0
  for (const occupied of occupiedBins) {
    occupiedCount += occupied
  }
  return occupiedCount / binCount
}

function createSegment(
  line: StructuralIntersectionLine,
  interval: StructuralIntersectionRange | null,
): StructuralIntersectionSegment | null {
  if (!interval || !isFiniteNumber(interval.minimum) || !isFiniteNumber(interval.maximum) || interval.maximum <= interval.minimum) {
    return null
  }
  const start = addScaled(line.origin, line.direction, interval.minimum)
  const end = addScaled(line.origin, line.direction, interval.maximum)
  return isFinitePoint(start) && isFinitePoint(end) ? { start, end } : null
}

function getStatusFactor(status: StructuralIntersectionStatus): number {
  return status === 'supported' ? 1 : status === 'partial' ? 0.68 : 0.25
}

function calculateConfidence(
  first: StructuralSurfaceCandidate,
  second: StructuralSurfaceCandidate,
  surfaceAngleDegrees: number,
  closestSupportDistanceMeters: number | null,
  segmentLength: number,
  continuity: number,
  firstSupportRms: number,
  secondSupportRms: number,
  status: StructuralIntersectionStatus,
  config: StructuralIntersectionConfig,
): number {
  const structuralQuality = Math.sqrt(clamp(first.roleConfidence, 0, 1) * clamp(second.roleConfidence, 0, 1))
  const angleQuality = clamp(1 - Math.abs(90 - surfaceAngleDegrees) / 90, 0, 1)
  const supportQuality = Math.min(
    clamp(first.finalOwnedSupport / 12, 0, 1),
    clamp(second.finalOwnedSupport / 12, 0, 1),
  )
  const proximityQuality = closestSupportDistanceMeters === null
    ? 0
    : clamp(1 - closestSupportDistanceMeters / Math.max(config.maximumLineSupportDistanceMeters, Number.EPSILON), 0, 1)
  const lengthQuality = clamp(segmentLength / 0.5, 0, 1)
  const fitQuality = Math.sqrt(
    clamp(1 - firstSupportRms / Math.max(config.maximumSupportPlaneResidualMeters, Number.EPSILON), 0, 1) *
    clamp(1 - secondSupportRms / Math.max(config.maximumSupportPlaneResidualMeters, Number.EPSILON), 0, 1),
  )
  return clamp(
    getStatusFactor(status) * (
      structuralQuality * 0.25 +
      angleQuality * 0.15 +
      supportQuality * 0.15 +
      continuity * 0.2 +
      proximityQuality * 0.1 +
      lengthQuality * 0.05 +
      fitQuality * 0.1
    ),
    0,
    1,
  )
}

function createRejectedCandidate(
  pair: PreparedPair,
  reason: string,
  angleDegrees: number,
): StructuralIntersectionCandidate {
  return {
    id: `intersection-${pair.type}-${pair.surfaceA.planeId}-${pair.surfaceB.planeId}`,
    surfaceAId: pair.surfaceA.planeId,
    surfaceBId: pair.surfaceB.planeId,
    type: pair.type,
    relationship: 'rejected',
    status: 'rejected',
    line: pair.line,
    segment: null,
    lengthMeters: 0,
    surfaceAngleDegrees: angleDegrees,
    verticalityScore: pair.line ? Math.abs(pair.line.direction.y) : 0,
    supportNearIntersection: false,
    closestSupportDistanceMeters: null,
    supportCountA: 0,
    supportCountB: 0,
    intervalSupportCountA: 0,
    intervalSupportCountB: 0,
    supportIntervalA: null,
    supportIntervalB: null,
    segmentContinuity: 0,
    supportCoverage: 0,
    confidence: 0,
    rejectionReason: reason,
  }
}

function buildCandidate(
  pair: PreparedPair,
  association: SupportAssociation,
  config: StructuralIntersectionConfig,
): StructuralIntersectionCandidate {
  const firstNormal = pair.normalizedA?.normal
  const secondNormal = pair.normalizedB?.normal
  const normalAgreement = firstNormal && secondNormal
    ? Math.abs(dot(firstNormal, secondNormal))
    : 0
  const surfaceAngleDegrees = firstNormal && secondNormal
    ? Math.acos(clamp(normalAgreement, -1, 1)) * 180 / Math.PI
    : 0

  if (!pair.normalizedA || !pair.normalizedB) {
    return createRejectedCandidate(pair, 'selected surface normal is invalid', surfaceAngleDegrees)
  }
  if (!pair.line) {
    return createRejectedCandidate(pair, pair.lineRejectionReason ?? 'intersection line could not be calculated', surfaceAngleDegrees)
  }

  const pointsA = association.pointsBySurfaceId.get(pair.surfaceA.planeId) ?? []
  const pointsB = association.pointsBySurfaceId.get(pair.surfaceB.planeId) ?? []
  const supportA = collectNearLineSupport(
    pointsA,
    pair.line,
    config.maximumLineSupportDistanceMeters,
    config.intervalTrimFraction,
  )
  const supportB = collectNearLineSupport(
    pointsB,
    pair.line,
    config.maximumLineSupportDistanceMeters,
    config.intervalTrimFraction,
  )
  const supportNearIntersection = supportA.nearLineValues.length > 0 && supportB.nearLineValues.length > 0
  const closestSupportDistanceMeters = supportNearIntersection
    ? Math.max(supportA.minimumDistance, supportB.minimumDistance)
    : null
  const overlapMinimum = supportA.interval && supportB.interval
    ? Math.max(supportA.interval.minimum, supportB.interval.minimum)
    : 0
  const overlapMaximum = supportA.interval && supportB.interval
    ? Math.min(supportA.interval.maximum, supportB.interval.maximum)
    : 0
  const overlapLength = Math.max(0, overlapMaximum - overlapMinimum)
  const overlapInterval = overlapLength > 0
    ? { minimum: overlapMinimum, maximum: overlapMaximum }
    : null
  const segment = createSegment(pair.line, overlapInterval)
  const segmentLength = segment ? magnitude(subtract(segment.end, segment.start)) : 0
  const continuityA = calculateContinuity(supportA.nearLineValues, overlapInterval, config)
  const continuityB = calculateContinuity(supportB.nearLineValues, overlapInterval, config)
  const segmentContinuity = Math.min(continuityA, continuityB)
  const supportCoverage = segmentContinuity
  const intervalGap = supportA.interval && supportB.interval
    ? Math.max(
      0,
      Math.max(supportA.interval.minimum, supportB.interval.minimum) -
        Math.min(supportA.interval.maximum, supportB.interval.maximum),
    )
    : Infinity
  const enoughSupport = supportA.nearLineValues.length >= config.minimumSupportPointsPerSurface &&
    supportB.nearLineValues.length >= config.minimumSupportPointsPerSurface
  const hasPartialSupport = supportNearIntersection && enoughSupport &&
    (segmentLength >= config.minimumPartialSegmentLengthMeters || intervalGap <= config.supportIntervalGapToleranceMeters)
  const isSupported = enoughSupport &&
    segmentLength >= config.minimumSupportedSegmentLengthMeters &&
    segmentContinuity >= config.minimumSupportedContinuity
  const status: StructuralIntersectionStatus = isSupported
    ? 'supported'
    : hasPartialSupport && (
      segmentContinuity >= config.minimumPartialContinuity ||
      intervalGap <= config.supportIntervalGapToleranceMeters
    )
      ? 'partial'
      : 'rejected'
  const rejectionReason = status === 'rejected'
    ? !supportNearIntersection
      ? 'both selected surfaces lack support near the theoretical intersection line'
      : !enoughSupport
        ? 'insufficient near-line support on one or both selected surfaces'
        : segmentLength < config.minimumPartialSegmentLengthMeters && intervalGap > config.supportIntervalGapToleranceMeters
          ? 'support does not form a finite overlapping interval'
          : 'support continuity or segment length is below the supported threshold'
    : null
  const intervalSupportCountA = overlapInterval
    ? supportA.nearLineValues.filter((value) => value >= overlapInterval.minimum && value <= overlapInterval.maximum).length
    : 0
  const intervalSupportCountB = overlapInterval
    ? supportB.nearLineValues.filter((value) => value >= overlapInterval.minimum && value <= overlapInterval.maximum).length
    : 0
  const confidence = calculateConfidence(
    pair.surfaceA,
    pair.surfaceB,
    surfaceAngleDegrees,
    closestSupportDistanceMeters,
    segmentLength,
    segmentContinuity,
    association.rmsBySurfaceId.get(pair.surfaceA.planeId) ?? 0,
    association.rmsBySurfaceId.get(pair.surfaceB.planeId) ?? 0,
    status,
    config,
  )

  return {
    id: `intersection-${pair.type}-${pair.surfaceA.planeId}-${pair.surfaceB.planeId}`,
    surfaceAId: pair.surfaceA.planeId,
    surfaceBId: pair.surfaceB.planeId,
    type: pair.type,
    relationship: status === 'supported' ? 'supported' : status === 'partial' ? 'candidate' : 'rejected',
    status,
    line: pair.line,
    segment,
    lengthMeters: segmentLength,
    surfaceAngleDegrees,
    verticalityScore: Math.abs(pair.line.direction.y),
    supportNearIntersection,
    closestSupportDistanceMeters,
    supportCountA: supportA.nearLineValues.length,
    supportCountB: supportB.nearLineValues.length,
    intervalSupportCountA,
    intervalSupportCountB,
    supportIntervalA: supportA.interval,
    supportIntervalB: supportB.interval,
    segmentContinuity,
    supportCoverage,
    confidence,
    rejectionReason,
  }
}

function compareCandidates(
  first: StructuralIntersectionCandidate,
  second: StructuralIntersectionCandidate,
): number {
  const statusRank = (status: StructuralIntersectionStatus): number => status === 'supported' ? 0 : status === 'partial' ? 1 : 2
  return statusRank(first.status) - statusRank(second.status) ||
    TYPE_ORDER[first.type] - TYPE_ORDER[second.type] ||
    second.confidence - first.confidence ||
    first.surfaceAId.localeCompare(second.surfaceAId) ||
    first.surfaceBId.localeCompare(second.surfaceBId)
}

/**
 * Development-only audit helper. It never changes selection or intersection
 * status; it only catches drift between M7.1 relationship claims and M7.2's
 * two-sided finalized-support validation.
 */
export function getStructuralSupportConsistencyWarnings(
  interpretation: RoomStructureInterpretationResult,
  result: StructuralIntersectionResult,
): readonly string[] {
  const warnings: string[] = []
  for (const intersection of result.intersections) {
    const relationship = interpretation.relationships.find((candidate) =>
      (candidate.firstPlaneId === intersection.surfaceAId && candidate.secondPlaneId === intersection.surfaceBId) ||
      (candidate.firstPlaneId === intersection.surfaceBId && candidate.secondPlaneId === intersection.surfaceAId))
    if (!relationship || !relationship.supportsNearTheoreticalIntersection) {
      continue
    }
    if (intersection.supportCountA === 0 || intersection.supportCountB === 0) {
      warnings.push(
        `${intersection.id}: M7.1 claimed two-sided theoretical-line support, but M7.2 found ${intersection.supportCountA}/${intersection.supportCountB} near-line support points`,
      )
    }
  }
  return Object.freeze(warnings)
}

function createPairDefinitions(interpretation: RoomStructureInterpretationResult): PairDefinition[] {
  const walls = interpretation.selectedWalls
    .filter((surface) => surface.selection === 'selected' && surface.role === 'wall')
    .sort((first, second) => first.planeId.localeCompare(second.planeId))
  const pairs: PairDefinition[] = []
  for (let firstIndex = 0; firstIndex < walls.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < walls.length; secondIndex += 1) {
      pairs.push({ surfaceA: walls[firstIndex], surfaceB: walls[secondIndex], type: 'wall-wall' })
    }
  }

  const horizontalPairs = [
    { surface: interpretation.selectedCeiling, type: 'wall-ceiling' as const },
    { surface: interpretation.selectedFloor, type: 'wall-floor' as const },
  ]
  for (const pair of horizontalPairs) {
    if (!pair.surface || pair.surface.selection !== 'selected') {
      continue
    }
    for (const wall of walls) {
      pairs.push({ surfaceA: wall, surfaceB: pair.surface, type: pair.type })
    }
  }
  return pairs.sort((first, second) => TYPE_ORDER[first.type] - TYPE_ORDER[second.type] ||
    first.surfaceA.planeId.localeCompare(second.surfaceA.planeId) ||
    first.surfaceB.planeId.localeCompare(second.surfaceB.planeId))
}

export class StructuralIntersectionService {
  private readonly config: StructuralIntersectionConfig

  public constructor(config: Partial<StructuralIntersectionConfig> = {}) {
    this.config = { ...DEFAULT_STRUCTURAL_INTERSECTION_CONFIG, ...config }
  }

  public analyze(
    interpretation: RoomStructureInterpretationResult,
    scan: FinalizedSpatialScan,
  ): StructuralIntersectionResult {
    const startedAt = now()
    const pairPreparationStartedAt = now()
    const pairs = createPairDefinitions(interpretation)
    const pairPreparationMs = now() - pairPreparationStartedAt

    const lineCalculationStartedAt = now()
    const preparedPairs: PreparedPair[] = pairs.map((pair) => {
      const normalizedA = normalizeSurface(pair.surfaceA)
      const normalizedB = normalizeSurface(pair.surfaceB)
      const lineResult = normalizedA && normalizedB
        ? computePlanePlaneIntersectionLine(normalizedA, normalizedB, this.config.minimumPlaneCrossMagnitude)
        : { line: null, reason: 'selected surface normal is invalid' }
      return { ...pair, normalizedA, normalizedB, line: lineResult.line, lineRejectionReason: lineResult.reason }
    })
    const lineCalculationMs = now() - lineCalculationStartedAt

    const supportValidationStartedAt = now()
    const normalizedSurfaces = preparedPairs.flatMap((pair) => [pair.normalizedA, pair.normalizedB])
      .filter((surface): surface is NormalizedSurface => surface !== null)
      .filter((surface, index, surfaces) => surfaces.findIndex((candidate) => candidate.surface.planeId === surface.surface.planeId) === index)
    const supportPlanes: SupportPlaneGeometry[] = normalizedSurfaces.map((surface) => ({
      id: surface.surface.planeId,
      normal: surface.normal,
      planeConstant: surface.planeConstant,
      centroid: surface.surface.centroid,
      localBounds: surface.surface.localBounds,
      tangentU: surface.surface.tangentU,
      tangentV: surface.surface.tangentV,
    }))
    const association = associateFinalizedSupportPoints(scan, supportPlanes, {
      maximumPlaneResidualMeters: this.config.maximumSupportPlaneResidualMeters,
      minimumNormalDot: this.config.minimumSupportNormalDot,
      boundsPaddingMeters: this.config.supportBoundsPaddingMeters,
    })
    const intersections = preparedPairs.map((pair) => buildCandidate(pair, association, this.config))
    const supportValidationMs = now() - supportValidationStartedAt
    const sortedIntersections = intersections.sort(compareCandidates)

    const supportedCount = sortedIntersections.filter((candidate) => candidate.status === 'supported').length
    const partialCount = sortedIntersections.filter((candidate) => candidate.status === 'partial').length
    const rejectedCount = sortedIntersections.length - supportedCount - partialCount
    const totalMs = now() - startedAt

    return {
      sourceScanId: scan.id,
      intersections: sortedIntersections,
      stats: {
        candidateCount: sortedIntersections.length,
        supportedCount,
        partialCount,
        rejectedCount,
        wallWallCount: sortedIntersections.filter((candidate) => candidate.type === 'wall-wall').length,
        wallCeilingCount: sortedIntersections.filter((candidate) => candidate.type === 'wall-ceiling').length,
        wallFloorCount: sortedIntersections.filter((candidate) => candidate.type === 'wall-floor').length,
        supportPointsEvaluated: association.supportPointsEvaluated,
        selectedSurfaceCount: normalizedSurfaces.length,
      },
      timings: {
        pairPreparationMs,
        lineCalculationMs,
        supportValidationMs,
        totalMs,
      },
    }
  }
}

import type { FinalizedSpatialScan, SpatialPoint } from '../../scanner/types'
import type {
  PlaneCandidate,
  RoomAnalysisResult,
  RoomStructureInterpretationResult,
  StructuralDirectionGroup,
  StructuralGraphEdge,
  StructuralGraphComponent,
  StructuralGraphNode,
  StructuralCorePairCandidate,
  StructuralMultiSurfaceCoherenceDiagnostic,
  StructuralPairSupportEvidence,
  StructuralParallelLane,
  StructuralRelationshipType,
  StructuralSurfaceCandidate,
  StructuralSurfaceEvidence,
  StructuralSurfaceRelationship,
  StructuralSurfaceRole,
  StructuralSurfaceSelection,
  StructuralSurfaceSelectionEvidence,
  StructuralTriadCompetitionDiagnostic,
  StructuralTriadCompetitionGroup,
  StructuralTriadWallCorrespondence,
  StructuralTriadWallSelectionDiagnostic,
} from '../types'
import {
  associateFinalizedSupportPoints,
  collectSupportNearPoint,
  collectNearLineSupport,
  computePlanePlaneIntersectionLine,
  computeThreePlaneIntersectionPoint,
  normalizeSupportPlane,
  type SupportPlaneGeometry,
} from './structuralSupportGeometry'

export interface StructuralSurfaceInterpretationConfig {
  readonly minimumWallConfidence: number
  readonly minimumHorizontalConfidence: number
  readonly minimumHorizontalOrientationScore: number
  readonly minimumHorizontalHeightEvidenceDifference: number
  readonly floorAnchorToleranceMeters: number
  readonly relationshipDistanceMeters: number
  readonly perpendicularAngleToleranceDegrees: number
  readonly parallelAngleToleranceDegrees: number
  readonly wallDirectionGroupingAngleDegrees: number
  readonly maximumOrientationGroupSpreadDegrees: number
  readonly sameRolePlaneOffsetToleranceMeters: number
  readonly sameRoleMaximumOffsetSpanMeters: number
  readonly sameRoleSupportGapMeters: number
  /** Shared finalized-support association parameters used before line tests. */
  readonly supportAssociationPlaneResidualMeters: number
  readonly supportAssociationNormalDot: number
  readonly supportAssociationBoundsPaddingMeters: number
  /** Distance from the exact theoretical line for lightweight M7.1 evidence. */
  readonly supportLineDistanceMeters: number
  readonly minimumWallOrientationScore: number
  readonly minimumWallRelationshipScore: number
  readonly minimumWallNoRelationshipAreaScore: number
  readonly minimumWallNoRelationshipSupportScore: number
  readonly minimumWallNoRelationshipExtentScore: number
  /** Strong independently observed wall path; does not require a room triad. */
  readonly minimumStrongStandaloneWallConfidence: number
  readonly minimumStrongStandaloneWallOrientationScore: number
  readonly minimumStrongStandaloneWallEnvelopeScore: number
  readonly minimumStrongStandaloneWallAreaScore: number
  readonly minimumStrongStandaloneWallSupportScore: number
  readonly minimumStrongStandaloneWallExtentScore: number
  readonly maximumStrongStandaloneWallRmsMeters: number
  readonly independentParallelOffsetMeters: number
  readonly independentParallelSupportGapMeters: number
  readonly independentParallelEnvelopeScore: number
  readonly minimumGraphEdgeScore: number
  readonly minimumStrongGraphEdgeScore: number
  readonly selectedWallRedundancyAngleDegrees: number
  readonly minimumMultiSurfaceCoherenceScore: number
  readonly multiSurfaceRedundancyAngleDegrees: number
  readonly minimumTriadCandidateAngleDegrees: number
  readonly triadPointSupportDistanceMeters: number
  readonly minimumTriadPointSupportCountPerSurface: number
  readonly minimumTriadPointSupportScore: number
  readonly minimumTriadPlaneDeterminant: number
  readonly triadCompetitionMaximumNormalSeparationDegrees: number
  readonly triadCompetitionMinimumProjectedSupportOverlap: number
  readonly triadCompetitionMinimumProjectedExtentOverlap: number
  readonly triadCompetitionProjectedCellSizeMeters: number
  readonly triadCompetitionMaximumTriplePointDistanceMeters: number
  readonly triadCompetitionMaximumSupportCentroidDistanceMeters: number
  readonly triadWholeCornerMaximumPointSeparationMeters: number
  readonly triadWholeCornerMinimumSupportOverlap: number
  readonly triadWholeCornerMinimumExtentOverlap: number
  readonly triadWholeCornerMaximumSupportDistanceMeters: number
  readonly triadWholeCornerMaximumSupportCentroidDistanceMeters: number
}

export const DEFAULT_STRUCTURAL_SURFACE_INTERPRETATION_CONFIG: StructuralSurfaceInterpretationConfig = {
  minimumWallConfidence: 0.56,
  minimumHorizontalConfidence: 0.56,
  minimumHorizontalOrientationScore: 0.85,
  minimumHorizontalHeightEvidenceDifference: 0.15,
  floorAnchorToleranceMeters: 0.35,
  relationshipDistanceMeters: 0.55,
  perpendicularAngleToleranceDegrees: 25,
  parallelAngleToleranceDegrees: 15,
  wallDirectionGroupingAngleDegrees: 14,
  maximumOrientationGroupSpreadDegrees: 24,
  sameRolePlaneOffsetToleranceMeters: 0.22,
  sameRoleMaximumOffsetSpanMeters: 0.36,
  sameRoleSupportGapMeters: 0.55,
  supportAssociationPlaneResidualMeters: 0.12,
  supportAssociationNormalDot: 0.45,
  supportAssociationBoundsPaddingMeters: 0.2,
  supportLineDistanceMeters: 0.15,
  minimumWallOrientationScore: 0.68,
  minimumWallRelationshipScore: 0.32,
  minimumWallNoRelationshipAreaScore: 0.7,
  minimumWallNoRelationshipSupportScore: 0.7,
  minimumWallNoRelationshipExtentScore: 0.55,
  minimumStrongStandaloneWallConfidence: 0.76,
  minimumStrongStandaloneWallOrientationScore: 0.82,
  minimumStrongStandaloneWallEnvelopeScore: 0.68,
  minimumStrongStandaloneWallAreaScore: 0.58,
  minimumStrongStandaloneWallSupportScore: 0.58,
  minimumStrongStandaloneWallExtentScore: 0.48,
  maximumStrongStandaloneWallRmsMeters: 0.038,
  independentParallelOffsetMeters: 0.75,
  independentParallelSupportGapMeters: 0.8,
  independentParallelEnvelopeScore: 0.72,
  minimumGraphEdgeScore: 0.42,
  minimumStrongGraphEdgeScore: 0.84,
  selectedWallRedundancyAngleDegrees: 18,
  minimumMultiSurfaceCoherenceScore: 0.62,
  multiSurfaceRedundancyAngleDegrees: 18,
  minimumTriadCandidateAngleDegrees: 45,
  triadPointSupportDistanceMeters: 0.2,
  minimumTriadPointSupportCountPerSurface: 2,
  minimumTriadPointSupportScore: 0.35,
  minimumTriadPlaneDeterminant: 0.2,
  triadCompetitionMaximumNormalSeparationDegrees: 30,
  triadCompetitionMinimumProjectedSupportOverlap: 0.2,
  triadCompetitionMinimumProjectedExtentOverlap: 0.35,
  triadCompetitionProjectedCellSizeMeters: 0.15,
  triadCompetitionMaximumTriplePointDistanceMeters: 0.45,
  triadCompetitionMaximumSupportCentroidDistanceMeters: 0.75,
  triadWholeCornerMaximumPointSeparationMeters: 0.35,
  triadWholeCornerMinimumSupportOverlap: 0.12,
  triadWholeCornerMinimumExtentOverlap: 0.25,
  triadWholeCornerMaximumSupportDistanceMeters: 0.5,
  triadWholeCornerMaximumSupportCentroidDistanceMeters: 0.9,
}

const WORLD_UP = { x: 0, y: 1, z: 0 }
const MINIMUM_RANGE_METERS = 0.001
const MAXIMUM_RMS_FOR_QUALITY_METERS = 0.05

interface PlaneMetrics {
  readonly support: number
  readonly area: number
}

interface PlaneContext {
  readonly plane: PlaneCandidate
  readonly metrics: PlaneMetrics
  readonly orientationScore: number
  readonly horizontalOrientationScore: number
  readonly areaScore: number
  readonly supportScore: number
  readonly verticalExtentScore: number
  readonly relationshipScore: number
  readonly floorHeightScore: number
  readonly ceilingHeightScore: number
  readonly wallConfidence: number
  readonly floorConfidence: number
  readonly ceilingConfidence: number
}

interface RoleEvaluation {
  readonly context: PlaneContext
  readonly role: StructuralSurfaceRole
  readonly confidence: number
  readonly heightScore: number
  readonly envelopeSelectionScore: number
  readonly selectionEvidence: StructuralSurfaceSelectionEvidence
  readonly graphSupportScore: number
  readonly multiSurfaceCoherenceScore: number
  readonly finalSelectionScore: number
}

interface StructuralOrientationGroup {
  readonly role: 'wall' | 'floor' | 'ceiling'
  readonly members: readonly RoleEvaluation[]
}

interface RelationshipSupportIndex {
  readonly pointsBySurfaceId: ReadonlyMap<string, readonly SpatialPoint[]>
}

interface ProjectedTriadSupportSummary {
  readonly cells: ReadonlySet<string>
  readonly minU: number
  readonly maxU: number
  readonly minV: number
  readonly maxV: number
  readonly centroid: SpatialPoint | null
}

interface TriadCompetitionAnalysis {
  readonly pairDiagnostics: readonly StructuralTriadCompetitionDiagnostic[]
  readonly groups: readonly StructuralTriadCompetitionGroup[]
  readonly finalSelectedTriadKeys: ReadonlySet<string>
  readonly suppressedTriadKeys: ReadonlySet<string>
  readonly sharedAnchorGroupCount: number
  readonly wholeCornerGroupCount: number
  readonly wholeCornerPairCount: number
}

function getTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function dot(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function distance(
  first: { x: number; y: number; z: number },
  second: { x: number; y: number; z: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

function getMedian(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function copyPoint(point: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: point.x, y: point.y, z: point.z }
}

function getNormalAngleDegrees(first: PlaneCandidate, second: PlaneCandidate): number {
  const agreement = Math.abs(dot(first.normal, second.normal))
  return (Math.acos(clamp(agreement, -1, 1)) * 180) / Math.PI
}

function getAlignedPlaneConstant(referenceNormal: PlaneCandidate['normal'], plane: PlaneCandidate): number {
  return dot(referenceNormal, plane.normal) < 0 ? -plane.planeConstant : plane.planeConstant
}

function getPlaneOffsetDifference(first: PlaneCandidate, second: PlaneCandidate): number {
  return Math.abs(first.planeConstant - getAlignedPlaneConstant(first.normal, second))
}

function getAxisGap(
  firstMinimum: number,
  firstMaximum: number,
  secondMinimum: number,
  secondMaximum: number,
): number {
  return Math.max(0, firstMinimum - secondMaximum, secondMinimum - firstMaximum)
}

/** A finite-support gap; unlike plane intersection, it describes the observed bounds. */
function getSupportBoundsGap(first: PlaneCandidate, second: PlaneCandidate): number {
  return Math.hypot(
    getAxisGap(first.bounds.min.x, first.bounds.max.x, second.bounds.min.x, second.bounds.max.x),
    getAxisGap(first.bounds.min.y, first.bounds.max.y, second.bounds.min.y, second.bounds.max.y),
    getAxisGap(first.bounds.min.z, first.bounds.max.z, second.bounds.min.z, second.bounds.max.z),
  )
}

function getRelationshipType(
  angleDegrees: number,
  config: StructuralSurfaceInterpretationConfig,
): StructuralRelationshipType {
  if (angleDegrees <= config.parallelAngleToleranceDegrees) {
    return 'parallel'
  }
  if (Math.abs(angleDegrees - 90) <= config.perpendicularAngleToleranceDegrees) {
    return 'perpendicular-like'
  }
  return 'other'
}

function getProximityScore(
  distanceMeters: number,
  config: StructuralSurfaceInterpretationConfig,
): number {
  return 1 - clamp(distanceMeters / config.relationshipDistanceMeters, 0, 1)
}

function getOrientationScores(plane: PlaneCandidate): {
  orientationScore: number
  horizontalOrientationScore: number
} {
  const horizontalAlignment = Math.abs(dot(plane.normal, WORLD_UP))
  return {
    orientationScore: clamp((1 - horizontalAlignment - 0.35) / 0.65, 0, 1),
    horizontalOrientationScore: clamp((horizontalAlignment - 0.35) / 0.65, 0, 1),
  }
}

function createRelationshipSupportIndex(
  scan: FinalizedSpatialScan | undefined,
  planes: readonly PlaneCandidate[],
  config: StructuralSurfaceInterpretationConfig,
): RelationshipSupportIndex | null {
  if (!scan) {
    return null
  }
  const supportPlanes: SupportPlaneGeometry[] = planes.map((plane) => ({
    id: plane.id,
    normal: plane.normal,
    planeConstant: plane.planeConstant,
    centroid: plane.centroid,
    localBounds: plane.localBounds,
    tangentU: plane.tangentU,
    tangentV: plane.tangentV,
  }))
  const association = associateFinalizedSupportPoints(scan, supportPlanes, {
    maximumPlaneResidualMeters: config.supportAssociationPlaneResidualMeters,
    minimumNormalDot: config.supportAssociationNormalDot,
    boundsPaddingMeters: config.supportAssociationBoundsPaddingMeters,
  })
  return { pointsBySurfaceId: association.pointsBySurfaceId }
}

function createRelationship(
  first: PlaneCandidate,
  second: PlaneCandidate,
  config: StructuralSurfaceInterpretationConfig,
  supportIndex: RelationshipSupportIndex | null,
): StructuralSurfaceRelationship {
  const normalAngleDegrees = getNormalAngleDegrees(first, second)
  const planeOffsetDifferenceMeters = getPlaneOffsetDifference(first, second)
  const supportBoundsGapMeters = getSupportBoundsGap(first, second)
  const relationshipType = getRelationshipType(normalAngleDegrees, config)
  const normalizedFirst = normalizeSupportPlane({
    id: first.id,
    normal: first.normal,
    planeConstant: first.planeConstant,
    centroid: first.centroid,
    localBounds: first.localBounds,
    tangentU: first.tangentU,
    tangentV: first.tangentV,
  })
  const normalizedSecond = normalizeSupportPlane({
    id: second.id,
    normal: second.normal,
    planeConstant: second.planeConstant,
    centroid: second.centroid,
    localBounds: second.localBounds,
    tangentU: second.tangentU,
    tangentV: second.tangentV,
  })
  const lineResult = computePlanePlaneIntersectionLine(
    normalizedFirst ?? { normal: first.normal, planeConstant: first.planeConstant },
    normalizedSecond ?? { normal: second.normal, planeConstant: second.planeConstant },
    0.001,
  )
  const supportA = lineResult.line && supportIndex
    ? collectNearLineSupport(
      supportIndex.pointsBySurfaceId.get(first.id) ?? [],
      lineResult.line,
      config.supportLineDistanceMeters,
      0,
    )
    : null
  const supportB = lineResult.line && supportIndex
    ? collectNearLineSupport(
      supportIndex.pointsBySurfaceId.get(second.id) ?? [],
      lineResult.line,
      config.supportLineDistanceMeters,
      0,
    )
    : null
  const nearTheoreticalLineSupportCountA = supportA?.nearLineValues.length ?? 0
  const nearTheoreticalLineSupportCountB = supportB?.nearLineValues.length ?? 0
  const nearTheoreticalLineSupportDistanceA = supportA && Number.isFinite(supportA.minimumDistance)
    ? supportA.minimumDistance
    : null
  const nearTheoreticalLineSupportDistanceB = supportB && Number.isFinite(supportB.minimumDistance)
    ? supportB.minimumDistance
    : null
  const supportsNearTheoreticalIntersection = Boolean(
    lineResult.line && nearTheoreticalLineSupportCountA > 0 && nearTheoreticalLineSupportCountB > 0,
  )
  const closestSurfaceSupportDistanceMeters = supportsNearTheoreticalIntersection
    ? Math.max(nearTheoreticalLineSupportDistanceA ?? Infinity, nearTheoreticalLineSupportDistanceB ?? Infinity)
    : null
  const intersectionSupportScore = supportsNearTheoreticalIntersection
    ? Math.min(
      clamp(1 - (nearTheoreticalLineSupportDistanceA ?? config.supportLineDistanceMeters) / config.supportLineDistanceMeters, 0, 1),
      clamp(1 - (nearTheoreticalLineSupportDistanceB ?? config.supportLineDistanceMeters) / config.supportLineDistanceMeters, 0, 1),
    )
    : 0
  // For parallel surfaces, the plane separation is a useful generic support
  // proximity signal. For intersecting planes, use only actual support near
  // the theoretical line so M7.1 and M7.2 cannot disagree about the claim.
  const genericClosestSupportDistanceMeters = relationshipType === 'parallel'
    ? Math.max(supportBoundsGapMeters, planeOffsetDifferenceMeters)
    : supportBoundsGapMeters
  const closestSupportDistanceMeters = closestSurfaceSupportDistanceMeters ?? genericClosestSupportDistanceMeters
  const proximityScore = lineResult.line
    ? intersectionSupportScore
    : getProximityScore(genericClosestSupportDistanceMeters, config)
  const firstOrientation = getOrientationScores(first)
  const secondOrientation = getOrientationScores(second)
  const firstVertical = firstOrientation.orientationScore >= 0.5
  const secondVertical = secondOrientation.orientationScore >= 0.5
  const firstHorizontal = firstOrientation.horizontalOrientationScore >= 0.5
  const secondHorizontal = secondOrientation.horizontalOrientationScore >= 0.5
  const isVerticalHorizontal = (firstVertical && secondHorizontal) || (firstHorizontal && secondVertical)
  const perpendicularityScore = clamp(1 - Math.abs(normalAngleDegrees - 90) / 90, 0, 1)
  const parallelismScore = clamp(1 - normalAngleDegrees / Math.max(1, config.parallelAngleToleranceDegrees), 0, 1)
  const verticalHorizontalEvidence = relationshipType === 'perpendicular-like'
    ? perpendicularityScore * intersectionSupportScore * (isVerticalHorizontal || (firstVertical && secondVertical) ? 1 : 0.5)
    : 0

  return {
    firstPlaneId: first.id,
    secondPlaneId: second.id,
    normalAngleDegrees,
    planeOffsetDifferenceMeters,
    centroidDistanceMeters: distance(first.centroid, second.centroid),
    centroidHeightDifferenceMeters: Math.abs(first.centroid.y - second.centroid.y),
    supportBoundsGapMeters,
    closestSupportDistanceMeters,
    supportProximityMeters: closestSupportDistanceMeters,
    proximityScore,
    perpendicularityScore,
    parallelismScore,
    relationshipType,
    // This is a mathematical relationship only. Support claims below require
    // actual finalized support on both sides of this exact line.
    planeIntersectionPossible: normalAngleDegrees > config.parallelAngleToleranceDegrees,
    supportNearIntersection: supportsNearTheoreticalIntersection,
    nearTheoreticalLineSupportCountA,
    nearTheoreticalLineSupportCountB,
    nearTheoreticalLineSupportDistanceA,
    nearTheoreticalLineSupportDistanceB,
    supportsNearTheoreticalIntersection,
    intersectionSupportScore,
    closestSurfaceSupportDistanceMeters,
    verticalHorizontalEvidence,
  }
}

function getRelationshipScore(
  plane: PlaneCandidate,
  relationships: readonly StructuralSurfaceRelationship[],
): number {
  const relevant = relationships.filter((relationship) =>
    relationship.firstPlaneId === plane.id || relationship.secondPlaneId === plane.id)
  if (relevant.length === 0) {
    return 0.35
  }

  return clamp(relevant.reduce((best, relationship) => {
    const relationshipScore = relationship.verticalHorizontalEvidence > 0
      ? relationship.verticalHorizontalEvidence
      : relationship.relationshipType === 'perpendicular-like'
        // A perpendicular pair without actual support at its theoretical
        // intersection is only weak geometric context, never envelope proof.
        ? relationship.perpendicularityScore * relationship.proximityScore *
          (relationship.supportsNearTheoreticalIntersection ? 0.5 : 0.15)
        : 0
    return Math.max(best, relationshipScore)
  }, 0), 0, 1)
}

function getSceneVerticalRange(planes: readonly PlaneCandidate[]): { minimum: number; maximum: number; range: number } {
  let minimum = Infinity
  let maximum = -Infinity
  for (const plane of planes) {
    minimum = Math.min(minimum, plane.bounds.min.y)
    maximum = Math.max(maximum, plane.bounds.max.y)
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    return { minimum: 0, maximum: 0, range: MINIMUM_RANGE_METERS }
  }
  return { minimum, maximum, range: Math.max(MINIMUM_RANGE_METERS, maximum - minimum) }
}

function getVerticalNeighborScores(
  plane: PlaneCandidate,
  planes: readonly PlaneCandidate[],
  relationships: readonly StructuralSurfaceRelationship[],
  sceneRange: number,
): { floor: number; ceiling: number } {
  let floorScore = 0
  let ceilingScore = 0
  for (const other of planes) {
    if (other.id === plane.id) {
      continue
    }
    const relationship = relationships.find((item) =>
      (item.firstPlaneId === plane.id && item.secondPlaneId === other.id) ||
      (item.firstPlaneId === other.id && item.secondPlaneId === plane.id))
    if (!relationship || relationship.relationshipType !== 'perpendicular-like') {
      continue
    }
    const otherOrientation = getOrientationScores(other)
    if (otherOrientation.orientationScore < 0.5) {
      continue
    }
    const nearBottom = 1 - clamp(
      Math.abs(plane.centroid.y - other.bounds.min.y) / sceneRange,
      0,
      1,
    )
    const nearTop = 1 - clamp(
      Math.abs(plane.centroid.y - other.bounds.max.y) / sceneRange,
      0,
      1,
    )
    floorScore = Math.max(floorScore, nearBottom * relationship.verticalHorizontalEvidence)
    ceilingScore = Math.max(ceilingScore, nearTop * relationship.verticalHorizontalEvidence)
  }
  return { floor: floorScore, ceiling: ceilingScore }
}

function getHeightScores(
  plane: PlaneCandidate,
  planes: readonly PlaneCandidate[],
  relationships: readonly StructuralSurfaceRelationship[],
  referenceSpaceType: 'local-floor' | 'local',
  scene: { minimum: number; maximum: number; range: number },
  config: StructuralSurfaceInterpretationConfig,
): { floor: number; ceiling: number; verticalExtent: number } {
  const normalizedHeight = clamp((plane.centroid.y - scene.minimum) / scene.range, 0, 1)
  const neighborScores = getVerticalNeighborScores(plane, planes, relationships, scene.range)
  const floorAnchorScore = referenceSpaceType === 'local-floor'
    ? 1 - clamp(Math.abs(plane.centroid.y) / config.floorAnchorToleranceMeters, 0, 1)
    : 0
  // Relative height is only useful near an observed vertical-range end. A
  // middle-height horizontal surface stays intentionally ambiguous.
  const floorRelativeScore = clamp((0.5 - normalizedHeight) * 2, 0, 1)
  const ceilingRelativeScore = clamp((normalizedHeight - 0.5) * 2, 0, 1)
  return {
    floor: Math.max(floorAnchorScore, floorRelativeScore, neighborScores.floor),
    ceiling: Math.max(ceilingRelativeScore, neighborScores.ceiling),
    verticalExtent: clamp(
      (plane.bounds.max.y - plane.bounds.min.y) / Math.max(MINIMUM_RANGE_METERS, scene.range * 0.65),
      0,
      1,
    ),
  }
}

function getFinalPlaneMetrics(analysisResult: RoomAnalysisResult, plane: PlaneCandidate): PlaneMetrics {
  const consensus = analysisResult.surfaceConsensus.find((item) => item.finalPlaneId === plane.id)
  return {
    support: consensus?.finalOwnedSupport ?? plane.supportPointCount,
    area: consensus?.finalOwnedAreaEstimate ?? plane.areaEstimate,
  }
}

function assertPlaneIdMapping(
  analysisResult: RoomAnalysisResult,
  planes: readonly PlaneCandidate[],
  relationships: readonly StructuralSurfaceRelationship[],
): void {
  const planeIds = new Set(planes.map((plane) => plane.id))
  if (planeIds.size !== planes.length) {
    throw new Error('Structural analysis received duplicate final plane IDs.')
  }
  if (relationships.some((relationship) =>
    !planeIds.has(relationship.firstPlaneId) || !planeIds.has(relationship.secondPlaneId))) {
    throw new Error('Structural analysis received a relationship for an unknown final plane ID.')
  }
  if (analysisResult.surfaceConsensus.some((consensus) => !planeIds.has(consensus.finalPlaneId))) {
    throw new Error('Structural analysis received consensus data for an unknown final plane ID.')
  }
}

function createPlaneContexts(
  analysisResult: RoomAnalysisResult,
  relationships: readonly StructuralSurfaceRelationship[],
  referenceSpaceType: 'local-floor' | 'local',
  config: StructuralSurfaceInterpretationConfig,
): PlaneContext[] {
  const planes = analysisResult.planes
  const scene = getSceneVerticalRange(planes)
  const metricsByPlaneId = new Map(planes.map((plane) => [plane.id, getFinalPlaneMetrics(analysisResult, plane)]))
  const maximumArea = Math.max(...planes.map((plane) => metricsByPlaneId.get(plane.id)?.area ?? 0), MINIMUM_RANGE_METERS)
  const maximumSupport = Math.max(...planes.map((plane) => metricsByPlaneId.get(plane.id)?.support ?? 0), 1)

  return planes.map((plane) => {
    const metrics = metricsByPlaneId.get(plane.id) ?? { support: 0, area: 0 }
    const orientation = getOrientationScores(plane)
    const height = getHeightScores(plane, planes, relationships, referenceSpaceType, scene, config)
    const areaScore = Math.sqrt(clamp(metrics.area / maximumArea, 0, 1))
    const supportScore = Math.sqrt(clamp(metrics.support / maximumSupport, 0, 1))
    const relationshipScore = getRelationshipScore(plane, relationships)
    const wallConfidence = clamp(
      orientation.orientationScore * 0.4 +
        areaScore * 0.22 +
        supportScore * 0.18 +
        height.verticalExtent * 0.1 +
        relationshipScore * 0.1,
      0,
      1,
    )
    const floorConfidence = clamp(
      orientation.horizontalOrientationScore * 0.35 +
        areaScore * 0.2 +
        supportScore * 0.15 +
        height.floor * 0.2 +
        relationshipScore * 0.1,
      0,
      1,
    )
    const ceilingConfidence = clamp(
      orientation.horizontalOrientationScore * 0.35 +
        areaScore * 0.2 +
        supportScore * 0.15 +
        height.ceiling * 0.2 +
        relationshipScore * 0.1,
      0,
      1,
    )
    return {
      plane,
      metrics,
      orientationScore: orientation.orientationScore,
      horizontalOrientationScore: orientation.horizontalOrientationScore,
      areaScore,
      supportScore,
      verticalExtentScore: height.verticalExtent,
      relationshipScore,
      floorHeightScore: height.floor,
      ceilingHeightScore: height.ceiling,
      wallConfidence,
      floorConfidence,
      ceilingConfidence,
    }
  })
}

function createEvidence(
  context: PlaneContext,
  heightScore: number,
): StructuralSurfaceEvidence {
  return {
    orientationScore: Math.max(context.orientationScore, context.horizontalOrientationScore),
    sizeScore: context.areaScore,
    supportScore: context.supportScore,
    heightScore,
    relationshipScore: context.relationshipScore,
  }
}

function createRoleEvaluation(
  context: PlaneContext,
  role: StructuralSurfaceRole,
  confidence: number,
  heightScore: number,
): RoleEvaluation {
  const orientationScore = role === 'wall'
    ? context.orientationScore
    : context.horizontalOrientationScore
  const extentScore = role === 'wall' ? context.verticalExtentScore : heightScore
  const roleConfidence = clamp(confidence, 0, 1)
  const fitQuality = 1 - clamp(context.plane.rmsError / MAXIMUM_RMS_FOR_QUALITY_METERS, 0, 1)
  const envelopeSelectionScore = role === 'wall'
    ? clamp(
      roleConfidence * 0.24 +
        orientationScore * 0.22 +
        context.areaScore * 0.16 +
        context.supportScore * 0.16 +
        extentScore * 0.1 +
        context.relationshipScore * 0.08 +
        fitQuality * 0.04,
      0,
      1,
    )
    : role === 'floor' || role === 'ceiling'
      ? clamp(
        roleConfidence * 0.3 +
          orientationScore * 0.22 +
          context.areaScore * 0.16 +
          context.supportScore * 0.14 +
          heightScore * 0.1 +
          context.relationshipScore * 0.04 +
          fitQuality * 0.04,
        0,
        1,
      )
      : 0
  return {
    context,
    role,
    confidence: roleConfidence,
    heightScore,
    envelopeSelectionScore,
    graphSupportScore: 0,
    multiSurfaceCoherenceScore: 0,
    finalSelectionScore: envelopeSelectionScore,
    selectionEvidence: {
      roleConfidence,
      orientationScore,
      sizeScore: context.areaScore,
      supportScore: context.supportScore,
      heightScore,
      relationshipScore: context.relationshipScore,
      competitionScore: envelopeSelectionScore,
      graphSupportScore: 0,
      multiSurfaceCoherenceScore: 0,
    },
  }
}

function evaluateContexts(
  contexts: readonly PlaneContext[],
  config: StructuralSurfaceInterpretationConfig,
): RoleEvaluation[] {
  return contexts.map((context) => {
    const isHorizontal = context.horizontalOrientationScore >= config.minimumHorizontalOrientationScore
    if (context.wallConfidence >= config.minimumWallConfidence && context.orientationScore >= 0.5) {
      return createRoleEvaluation(context, 'wall', context.wallConfidence, context.verticalExtentScore)
    }
    if (isHorizontal) {
      const bestHorizontalConfidence = Math.max(context.floorConfidence, context.ceilingConfidence)
      const heightEvidenceDifference = Math.abs(context.floorHeightScore - context.ceilingHeightScore)
      if (bestHorizontalConfidence >= config.minimumHorizontalConfidence &&
        heightEvidenceDifference >= config.minimumHorizontalHeightEvidenceDifference) {
        if (context.floorConfidence >= context.ceilingConfidence) {
          return createRoleEvaluation(context, 'floor', context.floorConfidence, context.floorHeightScore)
        }
        return createRoleEvaluation(context, 'ceiling', context.ceilingConfidence, context.ceilingHeightScore)
      }
    }

    const hasMeaningfulEvidence = context.areaScore >= 0.35 && context.supportScore >= 0.35
    return createRoleEvaluation(
      context,
      hasMeaningfulEvidence ? 'other' : 'unknown',
      hasMeaningfulEvidence
        ? Math.max(context.areaScore, context.supportScore) * 0.6
        : 1 - Math.max(context.wallConfidence, context.floorConfidence, context.ceilingConfidence) * 0.5,
      isHorizontal
        ? Math.max(context.floorHeightScore, context.ceilingHeightScore)
        : context.verticalExtentScore,
    )
  })
}

function getRoleSelectionScore(evaluation: RoleEvaluation): number {
  return evaluation.finalSelectionScore
}

function getPlaneRoleOffset(reference: PlaneCandidate, candidate: PlaneCandidate): number {
  return getAlignedPlaneConstant(reference.normal, candidate)
}

function getNormalSpread(members: readonly RoleEvaluation[]): number {
  let spread = 0
  for (let firstIndex = 0; firstIndex < members.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < members.length; secondIndex += 1) {
      spread = Math.max(spread, getNormalAngleDegrees(members[firstIndex].context.plane, members[secondIndex].context.plane))
    }
  }
  return spread
}

function buildOrientationGroups(
  evaluations: readonly RoleEvaluation[],
  role: 'wall' | 'floor' | 'ceiling',
  config: StructuralSurfaceInterpretationConfig,
): StructuralOrientationGroup[] {
  const members = evaluations
    .filter((evaluation) => evaluation.role === role)
    .sort((left, right) => getRoleSelectionScore(right) - getRoleSelectionScore(left))
  const groups: RoleEvaluation[][] = []

  for (const evaluation of members) {
    const matchingGroups = groups.filter((group) => {
      const hasCompatibleNormal = group.some((member) =>
        getNormalAngleDegrees(member.context.plane, evaluation.context.plane) <= config.wallDirectionGroupingAngleDegrees)
      return hasCompatibleNormal && getNormalSpread([...group, evaluation]) <= config.maximumOrientationGroupSpreadDegrees
    })
    if (matchingGroups.length === 0) {
      groups.push([evaluation])
      continue
    }
    const target = matchingGroups[0]
    target.push(evaluation)
    for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
      const group = groups[groupIndex]
      if (group === target || !matchingGroups.includes(group)) {
        continue
      }
      target.push(...group)
      groups.splice(groupIndex, 1)
    }
  }

  return groups.map((group) => ({
    role,
    members: Object.freeze(group),
  }))
}

function canJoinParallelLane(
  first: RoleEvaluation,
  second: RoleEvaluation,
  lane: readonly RoleEvaluation[],
  config: StructuralSurfaceInterpretationConfig,
): boolean {
  if (getNormalAngleDegrees(first.context.plane, second.context.plane) > config.wallDirectionGroupingAngleDegrees) {
    return false
  }
  if (getPlaneOffsetDifference(first.context.plane, second.context.plane) > config.sameRolePlaneOffsetToleranceMeters) {
    return false
  }
  if (getSupportBoundsGap(first.context.plane, second.context.plane) > config.sameRoleSupportGapMeters) {
    return false
  }
  const reference = lane[0]?.context.plane ?? first.context.plane
  const offsets = [...lane, first, second].map((member) => getPlaneRoleOffset(reference, member.context.plane))
  return Math.max(...offsets) - Math.min(...offsets) <= config.sameRoleMaximumOffsetSpanMeters
}

function buildParallelLanes(
  group: StructuralOrientationGroup,
  config: StructuralSurfaceInterpretationConfig,
): RoleEvaluation[][] {
  const lanes: RoleEvaluation[][] = []
  for (const evaluation of group.members) {
    const matchingLane = lanes.find((lane) => lane.some((member) => canJoinParallelLane(member, evaluation, lane, config)))
    if (matchingLane) {
      matchingLane.push(evaluation)
    } else {
      lanes.push([evaluation])
    }
  }
  return lanes
}

function isEnvelopeEligible(
  evaluation: RoleEvaluation,
  config: StructuralSurfaceInterpretationConfig,
): boolean {
  if (evaluation.role === 'wall') {
    const context = evaluation.context
    const strongWithoutRelationship = context.areaScore >= config.minimumWallNoRelationshipAreaScore &&
      context.supportScore >= config.minimumWallNoRelationshipSupportScore &&
      context.verticalExtentScore >= config.minimumWallNoRelationshipExtentScore
    return context.orientationScore >= config.minimumWallOrientationScore &&
      (context.relationshipScore >= config.minimumWallRelationshipScore || strongWithoutRelationship)
  }
  if (evaluation.role === 'floor' || evaluation.role === 'ceiling') {
    return evaluation.context.horizontalOrientationScore >= config.minimumHorizontalOrientationScore &&
      evaluation.confidence >= config.minimumHorizontalConfidence
  }
  return false
}

function isIndependentParallelWall(
  primary: RoleEvaluation,
  candidate: RoleEvaluation,
  config: StructuralSurfaceInterpretationConfig,
): boolean {
  const offset = getPlaneOffsetDifference(primary.context.plane, candidate.context.plane)
  const supportGap = getSupportBoundsGap(primary.context.plane, candidate.context.plane)
  const structuralEvidence = candidate.context.relationshipScore >= config.minimumWallRelationshipScore ||
    (candidate.context.areaScore >= config.minimumWallNoRelationshipAreaScore &&
      candidate.context.supportScore >= config.minimumWallNoRelationshipSupportScore &&
      candidate.context.verticalExtentScore >= config.minimumWallNoRelationshipExtentScore)
  return offset >= config.independentParallelOffsetMeters &&
    supportGap >= config.independentParallelSupportGapMeters &&
    candidate.envelopeSelectionScore >= config.independentParallelEnvelopeScore &&
    structuralEvidence
}

/**
 * A deliberately high bar for a partial physical wall that is independently
 * observed but has no valid corner/triad graph evidence. This is selection
 * policy only: the M7.0 plane itself, its support, and downstream geometry are
 * unchanged.
 */
function isStrongStandaloneWall(
  evaluation: RoleEvaluation,
  config: StructuralSurfaceInterpretationConfig,
): boolean {
  const context = evaluation.context
  return evaluation.role === 'wall' &&
    evaluation.confidence >= config.minimumStrongStandaloneWallConfidence &&
    context.orientationScore >= config.minimumStrongStandaloneWallOrientationScore &&
    evaluation.envelopeSelectionScore >= config.minimumStrongStandaloneWallEnvelopeScore &&
    context.areaScore >= config.minimumStrongStandaloneWallAreaScore &&
    context.supportScore >= config.minimumStrongStandaloneWallSupportScore &&
    context.verticalExtentScore >= config.minimumStrongStandaloneWallExtentScore &&
    context.plane.rmsError <= config.maximumStrongStandaloneWallRmsMeters
}

function getStrongStandaloneWallReason(evaluation: RoleEvaluation): string {
  const context = evaluation.context
  return `strong standalone wall: role ${evaluation.confidence.toFixed(2)}, orientation ${context.orientationScore.toFixed(2)}, envelope ${evaluation.envelopeSelectionScore.toFixed(2)}, area ${context.areaScore.toFixed(2)}, support ${context.supportScore.toFixed(2)}, extent ${context.verticalExtentScore.toFixed(2)}, rms ${context.plane.rmsError.toFixed(3)} m`
}

function getSelectionReason(
  evaluation: RoleEvaluation,
  selection: StructuralSurfaceSelection,
  hasEligibleCompetition: boolean,
  config: StructuralSurfaceInterpretationConfig,
): string {
  if (selection === 'selected') {
    return evaluation.role === 'wall'
      ? 'selected primary with strongest room-envelope evidence in orientation group'
      : 'selected strongest candidate for this structural role'
  }
  if (selection === 'alternate') {
    if (evaluation.role === 'wall' && !isEnvelopeEligible(evaluation, config)) {
      return evaluation.context.orientationScore < config.minimumWallOrientationScore
        ? 'insufficient orientation evidence'
        : 'insufficient room-envelope evidence'
    }
    return hasEligibleCompetition ? 'lost same-direction competition' : 'insufficient envelope evidence'
  }
  return evaluation.role === 'unknown' ? 'insufficient structural evidence' : 'not a room-envelope role candidate'
}

function getBestGraphEdge(
  planeId: string,
  edges: readonly StructuralGraphEdge[],
): StructuralGraphEdge | null {
  return edges
    .filter((edge) => edge.firstPlaneId === planeId || edge.secondPlaneId === planeId)
    .reduce<StructuralGraphEdge | null>((best, edge) =>
      !best || edge.edgeScore > best.edgeScore ? edge : best, null)
}

function getGraphSelectionReason(
  evaluation: RoleEvaluation,
  selection: StructuralSurfaceSelection,
  graphEdges: readonly StructuralGraphEdge[],
  hasGraphEvidence: boolean,
  lostCompetition: boolean,
  config: StructuralSurfaceInterpretationConfig,
): string {
  const planeId = evaluation.context.plane.id
  const bestEdge = getBestGraphEdge(planeId, graphEdges)
  if (selection === 'selected') {
    if (bestEdge?.edgeType === 'corner') {
      return 'strong wall-wall corner evidence'
    }
    if (bestEdge?.edgeType === 'wall-horizontal') {
      const otherPlaneId = bestEdge.firstPlaneId === planeId ? bestEdge.secondPlaneId : bestEdge.firstPlaneId
      return `strong wall-horizontal envelope evidence (${otherPlaneId})`
    }
    if (bestEdge?.edgeType === 'parallel-boundary') {
      return 'distinct parallel boundary supported by room graph'
    }
    return evaluation.role === 'wall'
      ? 'strongest credible standalone wall'
      : evaluation.role === 'floor'
        ? 'strongest credible standalone floor'
        : 'strongest credible standalone ceiling'
  }
  if (evaluation.role === 'wall' && !isEnvelopeEligible(evaluation, config)) {
    return evaluation.context.orientationScore < config.minimumWallOrientationScore
      ? 'insufficient orientation evidence'
      : 'insufficient envelope evidence'
  }
  if (lostCompetition) {
    return 'lost same-direction competition'
  }
  if (hasGraphEvidence && !bestEdge) {
    return 'disconnected wall-like candidate'
  }
  return hasGraphEvidence ? 'insufficient envelope graph evidence' : 'insufficient envelope evidence'
}

function createSurfaceCandidate(
  evaluation: RoleEvaluation,
  selection: StructuralSurfaceSelection,
  selectionReason: string,
): StructuralSurfaceCandidate {
  const context = evaluation.context
  return {
    planeId: context.plane.id,
    role: evaluation.role,
    selection,
    roleConfidence: evaluation.confidence,
    confidence: clamp(evaluation.confidence, 0, 1),
    envelopeSelectionScore: evaluation.envelopeSelectionScore,
    graphSupportScore: evaluation.graphSupportScore,
    multiSurfaceCoherenceScore: evaluation.multiSurfaceCoherenceScore,
    finalSelectionScore: evaluation.finalSelectionScore,
    evidence: createEvidence(context, evaluation.heightScore),
    selectionEvidence: evaluation.selectionEvidence,
    selectionReason,
    centroid: copyPoint(context.plane.centroid),
    centroidHeight: context.plane.centroid.y,
    occupiedArea: context.metrics.area,
    finalOwnedSupport: context.metrics.support,
    ownedSupport: context.metrics.support,
    normal: copyPoint(context.plane.normal),
    planeConstant: context.plane.planeConstant,
    bounds: {
      min: copyPoint(context.plane.bounds.min),
      max: copyPoint(context.plane.bounds.max),
    },
    localBounds: { ...context.plane.localBounds },
    tangentU: copyPoint(context.plane.tangentU),
    tangentV: copyPoint(context.plane.tangentV),
  }
}

function createDirectionGroup(
  id: string,
  group: StructuralOrientationGroup,
  selectedPlaneIds: readonly string[],
): StructuralDirectionGroup {
  const reference = group.members[0]?.context.plane
  const weightedNormal = group.members.reduce((sum, member) => {
    const normal = member.context.plane.normal
    const sign = reference && dot(reference.normal, normal) < 0 ? -1 : 1
    const weight = Math.max(1, member.context.metrics.support)
    return {
      x: sum.x + normal.x * sign * weight,
      y: sum.y + normal.y * sign * weight,
      z: sum.z + normal.z * sign * weight,
    }
  }, { x: 0, y: 0, z: 0 })
  const length = Math.hypot(weightedNormal.x, weightedNormal.y, weightedNormal.z) || 1
  const offsets = reference
    ? group.members.map((member) => getPlaneRoleOffset(reference, member.context.plane))
    : [0]
  return {
    id,
    role: group.role,
    planeIds: Object.freeze(group.members.map((member) => member.context.plane.id)),
    selectedPlaneId: selectedPlaneIds[0] ?? null,
    selectedPlaneIds: Object.freeze([...selectedPlaneIds]),
    representativeNormal: {
      x: weightedNormal.x / length,
      y: weightedNormal.y / length,
      z: weightedNormal.z / length,
    },
    normalSpreadDegrees: getNormalSpread(group.members),
    planeOffsetSpanMeters: Math.max(...offsets) - Math.min(...offsets),
  }
}

function createParallelLanes(
  orientationGroups: readonly StructuralOrientationGroup[],
  config: StructuralSurfaceInterpretationConfig,
  prefix: string,
): StructuralParallelLane[] {
  return orientationGroups.flatMap((group, groupIndex) =>
    buildParallelLanes(group, config).map((lane, laneIndex) => {
      const reference = lane[0]?.context.plane
      const offsets = reference
        ? lane.map((member) => getPlaneRoleOffset(reference, member.context.plane))
        : [0]
      const representative = lane.reduce((best, current) =>
        getRoleSelectionScore(current) > getRoleSelectionScore(best) ? current : best)
      return {
        id: `${prefix}-lane-${groupIndex + 1}-${laneIndex + 1}`,
        role: group.role,
        orientationGroupId: `${prefix}-orientation-${groupIndex + 1}`,
        planeIds: Object.freeze(lane.map((member) => member.context.plane.id)),
        representativePlaneId: representative.context.plane.id,
        planeOffsetSpanMeters: Math.max(...offsets) - Math.min(...offsets),
      }
    }))
}

function getVerticalOverlapScore(first: PlaneCandidate, second: PlaneCandidate): number {
  const overlap = Math.max(0, Math.min(first.bounds.max.y, second.bounds.max.y) - Math.max(first.bounds.min.y, second.bounds.min.y))
  const firstSpan = Math.max(MINIMUM_RANGE_METERS, first.bounds.max.y - first.bounds.min.y)
  const secondSpan = Math.max(MINIMUM_RANGE_METERS, second.bounds.max.y - second.bounds.min.y)
  if (firstSpan <= MINIMUM_RANGE_METERS || secondSpan <= MINIMUM_RANGE_METERS) {
    const firstHeight = first.centroid.y
    const secondHeight = second.centroid.y
    const firstContainsSecond = secondHeight >= first.bounds.min.y && secondHeight <= first.bounds.max.y
    const secondContainsFirst = firstHeight >= second.bounds.min.y && firstHeight <= second.bounds.max.y
    return firstContainsSecond || secondContainsFirst ? 1 : 0
  }
  return clamp(overlap / Math.min(firstSpan, secondSpan), 0, 1)
}

function getRelationshipBetween(
  firstPlaneId: string,
  secondPlaneId: string,
  relationships: readonly StructuralSurfaceRelationship[],
): StructuralSurfaceRelationship | null {
  return relationships.find((relationship) =>
    (relationship.firstPlaneId === firstPlaneId && relationship.secondPlaneId === secondPlaneId) ||
    (relationship.firstPlaneId === secondPlaneId && relationship.secondPlaneId === firstPlaneId)) ?? null
}

function getGraphRoleCandidate(
  evaluation: RoleEvaluation,
  config: StructuralSurfaceInterpretationConfig,
): boolean {
  if (evaluation.role === 'wall') {
    return evaluation.confidence >= config.minimumWallConfidence && evaluation.context.orientationScore >= 0.5
  }
  return (evaluation.role === 'floor' || evaluation.role === 'ceiling') &&
    evaluation.confidence >= config.minimumHorizontalConfidence &&
    evaluation.context.horizontalOrientationScore >= 0.5
}

function createStructuralGraphEdge(
  first: RoleEvaluation,
  second: RoleEvaluation,
  relationship: StructuralSurfaceRelationship,
  config: StructuralSurfaceInterpretationConfig,
): StructuralGraphEdge | null {
  const firstIsWall = first.role === 'wall'
  const secondIsWall = second.role === 'wall'
  const firstIsHorizontal = first.role === 'floor' || first.role === 'ceiling'
  const secondIsHorizontal = second.role === 'floor' || second.role === 'ceiling'
  let edgeType: StructuralGraphEdge['edgeType'] | null = null
  let edgeScore = 0

  if (firstIsWall && secondIsWall && relationship.relationshipType === 'perpendicular-like' && relationship.supportNearIntersection) {
    edgeType = 'corner'
    edgeScore = relationship.perpendicularityScore * relationship.proximityScore *
      getVerticalOverlapScore(first.context.plane, second.context.plane)
  } else if ((firstIsWall && secondIsHorizontal) || (firstIsHorizontal && secondIsWall)) {
    if (relationship.relationshipType === 'perpendicular-like' && relationship.supportNearIntersection) {
      edgeType = 'wall-horizontal'
      edgeScore = relationship.perpendicularityScore * relationship.proximityScore *
        Math.max(0.5, relationship.verticalHorizontalEvidence)
    }
  } else if (firstIsWall && secondIsWall && relationship.relationshipType === 'parallel' &&
    relationship.planeOffsetDifferenceMeters >= config.independentParallelOffsetMeters &&
    relationship.supportBoundsGapMeters >= config.independentParallelSupportGapMeters) {
    edgeType = 'parallel-boundary'
    // Separation is evidence that these may be independent boundaries, not a
    // reason to apply the near-contact proximity score used for corners. Keep
    // the edge conservative by requiring both candidates to already have
    // credible envelope evidence and substantial vertical support.
    edgeScore = relationship.parallelismScore *
      Math.min(first.envelopeSelectionScore, second.envelopeSelectionScore) *
      Math.max(0.5, getVerticalOverlapScore(first.context.plane, second.context.plane))
  }

  if (!edgeType || edgeScore < config.minimumGraphEdgeScore) {
    return null
  }
  return {
    firstPlaneId: first.context.plane.id,
    secondPlaneId: second.context.plane.id,
    edgeType,
    edgeStrength: edgeScore >= config.minimumStrongGraphEdgeScore ? 'strong' : 'supporting',
    normalAngleDegrees: relationship.normalAngleDegrees,
    perpendicularityScore: relationship.perpendicularityScore,
    closestSupportDistanceMeters: relationship.closestSupportDistanceMeters,
    supportNearIntersection: relationship.supportNearIntersection,
    intersectionSupportScore: relationship.intersectionSupportScore,
    verticalOverlapScore: getVerticalOverlapScore(first.context.plane, second.context.plane),
    proximityScore: relationship.proximityScore,
    edgeScore: clamp(edgeScore, 0, 1),
  }
}

function createStructuralGraph(
  evaluations: readonly RoleEvaluation[],
  relationships: readonly StructuralSurfaceRelationship[],
  orientationGroupIdByPlaneId: ReadonlyMap<string, string>,
  config: StructuralSurfaceInterpretationConfig,
): {
  readonly nodes: readonly StructuralGraphNode[]
  readonly edges: readonly StructuralGraphEdge[]
  readonly components: readonly ReadonlySet<string>[]
  readonly componentRecords: readonly StructuralGraphComponent[]
  readonly graphSupportByPlaneId: ReadonlyMap<string, number>
} {
  const graphEvaluations = evaluations.filter((evaluation) => getGraphRoleCandidate(evaluation, config))
  const nodes: StructuralGraphNode[] = graphEvaluations.map((evaluation) => ({
    planeId: evaluation.context.plane.id,
    role: evaluation.role as 'wall' | 'floor' | 'ceiling',
    orientationGroupId: orientationGroupIdByPlaneId.get(evaluation.context.plane.id) ?? null,
    roleConfidence: evaluation.confidence,
    envelopeSelectionScore: evaluation.envelopeSelectionScore,
    ownedSupport: evaluation.context.metrics.support,
    occupiedArea: evaluation.context.metrics.area,
    normal: copyPoint(evaluation.context.plane.normal),
    planeConstant: evaluation.context.plane.planeConstant,
  }))
  const edges: StructuralGraphEdge[] = []
  for (let firstIndex = 0; firstIndex < graphEvaluations.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < graphEvaluations.length; secondIndex += 1) {
      const relationship = getRelationshipBetween(
        graphEvaluations[firstIndex].context.plane.id,
        graphEvaluations[secondIndex].context.plane.id,
        relationships,
      )
      if (!relationship) {
        continue
      }
      const edge = createStructuralGraphEdge(graphEvaluations[firstIndex], graphEvaluations[secondIndex], relationship, config)
      if (edge) {
        edges.push(edge)
      }
    }
  }
  const graphSupportByPlaneId = new Map<string, number>()
  for (const edge of edges) {
    graphSupportByPlaneId.set(edge.firstPlaneId, Math.max(graphSupportByPlaneId.get(edge.firstPlaneId) ?? 0, edge.edgeScore))
    graphSupportByPlaneId.set(edge.secondPlaneId, Math.max(graphSupportByPlaneId.get(edge.secondPlaneId) ?? 0, edge.edgeScore))
  }
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) {
    adjacency.set(node.planeId, [])
  }
  for (const edge of edges) {
    adjacency.get(edge.firstPlaneId)?.push(edge.secondPlaneId)
    adjacency.get(edge.secondPlaneId)?.push(edge.firstPlaneId)
  }
  const visited = new Set<string>()
  const components: ReadonlySet<string>[] = []
  const componentRecords: StructuralGraphComponent[] = []
  for (const node of nodes) {
    if (visited.has(node.planeId) || (adjacency.get(node.planeId)?.length ?? 0) === 0) {
      continue
    }
    const component = new Set<string>()
    const queue = [node.planeId]
    visited.add(node.planeId)
    while (queue.length > 0) {
      const planeId = queue.shift()
      if (!planeId) {
        continue
      }
      component.add(planeId)
      for (const neighbor of adjacency.get(planeId) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    components.push(component)
    componentRecords.push({
      id: `structural-component-${componentRecords.length + 1}`,
      planeIds: Object.freeze([...component]),
      edgeCount: edges.filter((edge) => component.has(edge.firstPlaneId) && component.has(edge.secondPlaneId)).length,
    })
  }
  return {
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    graphSupportByPlaneId,
    components: Object.freeze(components),
    componentRecords: Object.freeze(componentRecords),
  }
}

function applyGraphEvidence(
  evaluations: readonly RoleEvaluation[],
  graphSupportByPlaneId: ReadonlyMap<string, number>,
): RoleEvaluation[] {
  return evaluations.map((evaluation) => {
    const graphSupportScore = graphSupportByPlaneId.get(evaluation.context.plane.id) ?? 0
    const finalSelectionScore = clamp(
      evaluation.envelopeSelectionScore * 0.62 + graphSupportScore * 0.38,
      0,
      1,
    )
    return {
      ...evaluation,
      graphSupportScore,
      multiSurfaceCoherenceScore: evaluation.multiSurfaceCoherenceScore,
      finalSelectionScore,
      selectionEvidence: {
        ...evaluation.selectionEvidence,
        competitionScore: finalSelectionScore,
        graphSupportScore,
        multiSurfaceCoherenceScore: evaluation.multiSurfaceCoherenceScore,
      },
    }
  })
}

function getBestWallEdgeToSelected(
  planeId: string,
  selectedPlaneIds: ReadonlySet<string>,
  edges: readonly StructuralGraphEdge[],
): StructuralGraphEdge | null {
  return edges
    .filter((edge) =>
      (edge.edgeType === 'corner' || edge.edgeType === 'parallel-boundary') &&
      (edge.firstPlaneId === planeId || edge.secondPlaneId === planeId) &&
      selectedPlaneIds.has(edge.firstPlaneId === planeId ? edge.secondPlaneId : edge.firstPlaneId))
    .reduce<StructuralGraphEdge | null>((best, edge) =>
      !best || edge.edgeScore > best.edgeScore ? edge : best, null)
}

function getBestGraphEdgeBetween(
  firstPlaneId: string,
  secondPlaneId: string,
  edgeType: StructuralGraphEdge['edgeType'],
  edges: readonly StructuralGraphEdge[],
): StructuralGraphEdge | null {
  return edges
    .filter((edge) => edge.edgeType === edgeType &&
      ((edge.firstPlaneId === firstPlaneId && edge.secondPlaneId === secondPlaneId) ||
        (edge.firstPlaneId === secondPlaneId && edge.secondPlaneId === firstPlaneId)))
    .reduce<StructuralGraphEdge | null>((best, edge) =>
      !best || edge.edgeScore > best.edgeScore ? edge : best, null)
}

function getOrientationNoveltyScore(
  candidate: RoleEvaluation,
  selectedWall: RoleEvaluation,
  config: StructuralSurfaceInterpretationConfig,
): number {
  const angle = getNormalAngleDegrees(candidate.context.plane, selectedWall.context.plane)
  return clamp(
    (angle - config.multiSurfaceRedundancyAngleDegrees) /
      Math.max(1, 90 - config.multiSurfaceRedundancyAngleDegrees),
    0,
    1,
  )
}

function getMultiSurfaceNodeQuality(evaluation: RoleEvaluation): number {
  return getStructuralNodeQuality(evaluation)
}

function getPairSupportEvidence(
  relationship: StructuralSurfaceRelationship | null,
): StructuralPairSupportEvidence {
  return relationship
    ? {
      intersectionSupportScore: relationship.intersectionSupportScore,
      nearLineSupportCountA: relationship.nearTheoreticalLineSupportCountA,
      nearLineSupportCountB: relationship.nearTheoreticalLineSupportCountB,
      closestSupportDistanceMeters: relationship.closestSurfaceSupportDistanceMeters,
      supportsNearTheoreticalIntersection: relationship.supportsNearTheoreticalIntersection,
    }
    : {
      intersectionSupportScore: 0,
      nearLineSupportCountA: 0,
      nearLineSupportCountB: 0,
      closestSupportDistanceMeters: null,
      supportsNearTheoreticalIntersection: false,
    }
}

function getNormalizedPlane(
  plane: PlaneCandidate,
): ReturnType<typeof normalizeSupportPlane> {
  return normalizeSupportPlane({
    id: plane.id,
    normal: plane.normal,
    planeConstant: plane.planeConstant,
    centroid: plane.centroid,
    localBounds: plane.localBounds,
    tangentU: plane.tangentU,
    tangentV: plane.tangentV,
  })
}

function getBestMultiSurfaceCoherence(
  candidate: RoleEvaluation,
  selectedWalls: readonly RoleEvaluation[],
  horizontalSurfaces: readonly RoleEvaluation[],
  relationships: readonly StructuralSurfaceRelationship[],
  supportIndex: RelationshipSupportIndex | null,
  graphEdges: readonly StructuralGraphEdge[],
  config: StructuralSurfaceInterpretationConfig,
): StructuralMultiSurfaceCoherenceDiagnostic | null {
  if (candidate.role !== 'wall' || !isEnvelopeEligible(candidate, config)) {
    return null
  }
  const redundantWithSelected = selectedWalls.some((selectedWall) =>
    getNormalAngleDegrees(candidate.context.plane, selectedWall.context.plane) <= config.multiSurfaceRedundancyAngleDegrees &&
    !isIndependentParallelWall(selectedWall, candidate, config))
  if (redundantWithSelected) {
    return null
  }
  const candidateNodeQuality = getMultiSurfaceNodeQuality(candidate)
  const options: StructuralMultiSurfaceCoherenceDiagnostic[] = []
  for (const selectedWall of selectedWalls) {
    if (selectedWall.context.plane.id === candidate.context.plane.id) {
      continue
    }
    const wallWallAngleDegrees = getNormalAngleDegrees(candidate.context.plane, selectedWall.context.plane)
    if (wallWallAngleDegrees < config.minimumTriadCandidateAngleDegrees) {
      continue
    }
    const orientationNoveltyScore = getOrientationNoveltyScore(candidate, selectedWall, config)
    for (const horizontalSurface of horizontalSurfaces) {
    const wallWallRelationship = getRelationshipBetween(
      candidate.context.plane.id,
      selectedWall.context.plane.id,
      relationships,
    )
    const candidateToHorizontalRelationship = getRelationshipBetween(
      candidate.context.plane.id,
      horizontalSurface.context.plane.id,
      relationships,
    )
    const existingToHorizontalRelationship = getRelationshipBetween(
      selectedWall.context.plane.id,
      horizontalSurface.context.plane.id,
      relationships,
    )
    const candidateHorizontalSupport = getPairSupportEvidence(candidateToHorizontalRelationship)
    const existingHorizontalSupport = existingToHorizontalRelationship
      ? getPairSupportEvidence(existingToHorizontalRelationship)
      : null
    // Discovery intentionally starts from two independent, supported
    // wall-horizontal relationships. A wall-wall graph edge is optional here;
    // its quality is evaluated later rather than used as a gate.
    if (!candidateToHorizontalRelationship ||
      candidateToHorizontalRelationship.relationshipType !== 'perpendicular-like' ||
      !candidateToHorizontalRelationship.supportsNearTheoreticalIntersection ||
      !existingToHorizontalRelationship ||
      existingToHorizontalRelationship.relationshipType !== 'perpendicular-like' ||
      !existingToHorizontalRelationship.supportsNearTheoreticalIntersection) {
      continue
    }

    const wallWallSupport = getPairSupportEvidence(wallWallRelationship)
    const candidatePlane = getNormalizedPlane(candidate.context.plane)
    const existingPlane = getNormalizedPlane(selectedWall.context.plane)
    const horizontalPlane = getNormalizedPlane(horizontalSurface.context.plane)
    const triplePointResult = candidatePlane && existingPlane && horizontalPlane
      ? computeThreePlaneIntersectionPoint(
        candidatePlane,
        existingPlane,
        horizontalPlane,
        config.minimumTriadPlaneDeterminant,
      )
      : {
        point: null,
        determinant: 0,
        reason: 'one or more triad plane normals are invalid',
      }
    const candidatePointSupport = triplePointResult.point
      ? collectSupportNearPoint(
      supportIndex?.pointsBySurfaceId.get(candidate.context.plane.id) ?? [],
      triplePointResult.point,
      config.triadPointSupportDistanceMeters,
      )
      : { supportCount: 0, minimumDistance: Infinity }
    const existingPointSupport = triplePointResult.point
      ? collectSupportNearPoint(
      supportIndex?.pointsBySurfaceId.get(selectedWall.context.plane.id) ?? [],
      triplePointResult.point,
      config.triadPointSupportDistanceMeters,
      )
      : { supportCount: 0, minimumDistance: Infinity }
    const horizontalPointSupport = triplePointResult.point
      ? collectSupportNearPoint(
      supportIndex?.pointsBySurfaceId.get(horizontalSurface.context.plane.id) ?? [],
      triplePointResult.point,
      config.triadPointSupportDistanceMeters,
      )
      : { supportCount: 0, minimumDistance: Infinity }
    const triplePointSupportCounts = {
      candidate: candidatePointSupport.supportCount,
      existing: existingPointSupport.supportCount,
      horizontal: horizontalPointSupport.supportCount,
    }
    const triplePointSupportScore = Math.cbrt(
      clamp(candidatePointSupport.supportCount / 4, 0, 1) *
      clamp(existingPointSupport.supportCount / 4, 0, 1) *
      clamp(horizontalPointSupport.supportCount / 4, 0, 1),
    )
    const geometryGate = triplePointResult.point ? 'pass' : 'fail'
    const wallWallSupportGate = wallWallSupport.supportsNearTheoreticalIntersection ? 'pass' : 'fail'
    const wallHorizontalSupportGateA = candidateHorizontalSupport.supportsNearTheoreticalIntersection ? 'pass' : 'fail'
    const wallHorizontalSupportGateB = existingHorizontalSupport?.supportsNearTheoreticalIntersection ? 'pass' : 'fail'
    const triplePointSupportGate = geometryGate === 'pass' &&
      triplePointSupportScore >= config.minimumTriadPointSupportScore &&
      triplePointSupportCounts.candidate >= config.minimumTriadPointSupportCountPerSurface &&
      triplePointSupportCounts.existing >= config.minimumTriadPointSupportCountPerSurface &&
      triplePointSupportCounts.horizontal >= config.minimumTriadPointSupportCountPerSurface
      ? 'pass'
      : 'fail'
    const wallWallEdge = getBestGraphEdgeBetween(
      candidate.context.plane.id,
      selectedWall.context.plane.id,
      'corner',
      graphEdges,
    )
    const candidateHorizontalEdge = getBestGraphEdgeBetween(
      candidate.context.plane.id,
      horizontalSurface.context.plane.id,
      'wall-horizontal',
      graphEdges,
    )
    const existingHorizontalEdge = getBestGraphEdgeBetween(
      selectedWall.context.plane.id,
      horizontalSurface.context.plane.id,
      'wall-horizontal',
      graphEdges,
    )
      const existingNodeQuality = getMultiSurfaceNodeQuality(selectedWall)
      const horizontalNodeQuality = getMultiSurfaceNodeQuality(horizontalSurface)
      // A triple point cannot substitute for missing evidence along the
      // proposed wall-wall boundary. Keep the score honest; acceptance is
      // gated separately below.
      const wallWallQuality = wallWallSupportGate === 'pass' ? wallWallSupport.intersectionSupportScore : 0
      const candidateHorizontalQuality = candidateHorizontalSupport.intersectionSupportScore
      const existingHorizontalQuality = existingHorizontalSupport?.intersectionSupportScore ?? 0
      const pairQuality = existingHorizontalSupport
        ? wallWallQuality * 0.4 + candidateHorizontalQuality * 0.3 + existingHorizontalQuality * 0.3
        : wallWallQuality * 0.5 + candidateHorizontalQuality * 0.5
      const nodeQuality = Math.cbrt(candidateNodeQuality * existingNodeQuality * horizontalNodeQuality)
      const multiSurfaceCoherenceScore = clamp(
        pairQuality * 0.46 + nodeQuality * 0.24 + orientationNoveltyScore * 0.12 + triplePointSupportScore * 0.18,
        0,
        1,
      )
      const coherenceGate = multiSurfaceCoherenceScore >= config.minimumMultiSurfaceCoherenceScore ? 'pass' : 'fail'
      const decision = geometryGate === 'pass' &&
        wallWallSupportGate === 'pass' &&
        wallHorizontalSupportGateA === 'pass' &&
        wallHorizontalSupportGateB === 'pass' &&
        triplePointSupportGate === 'pass' &&
        coherenceGate === 'pass'
        ? 'selected'
        : 'rejected'
      const reason = geometryGate === 'fail'
        ? 'triad rejected: three-plane point is unstable'
        : wallWallSupportGate === 'fail'
          ? 'triad rejected: insufficient wall-wall support'
          : wallHorizontalSupportGateA === 'fail'
            ? 'triad rejected: insufficient candidate wall-horizontal support'
            : wallHorizontalSupportGateB === 'fail'
              ? 'triad rejected: insufficient existing wall-horizontal support'
              : triplePointSupportGate === 'fail'
                ? 'triad rejected: insufficient balanced triple-point support'
                : coherenceGate === 'fail'
                  ? 'triad rejected: insufficient multi-surface coherence score'
                  : existingHorizontalEdge
                    ? 'coherent wall-wall-horizontal triad'
                    : 'coherent wall-wall-horizontal triad; anchor horizontal relationship unavailable'
      options.push({
        candidatePlaneId: candidate.context.plane.id,
        existingWallPlaneId: selectedWall.context.plane.id,
        horizontalPlaneId: horizontalSurface.context.plane.id,
        wallWallEdgeScore: wallWallEdge?.edgeScore ?? 0,
        wallWallAngleDegrees,
        wallWallSupport,
        candidateHorizontalSupport,
        existingHorizontalSupport,
        candidateHorizontalEdgeScore: candidateHorizontalEdge?.edgeScore ?? 0,
        existingHorizontalEdgeScore: existingHorizontalEdge?.edgeScore ?? 0,
        candidateNodeQuality,
        existingNodeQuality,
        horizontalNodeQuality,
        orientationNoveltyScore,
        threePlanePoint: triplePointResult.point,
        threePlaneDeterminant: triplePointResult.determinant,
        triplePointSupportCounts,
        triplePointSupportScore,
        multiSurfaceCoherenceScore,
        wallWallSupportGate,
        wallHorizontalSupportGateA,
        wallHorizontalSupportGateB,
        triplePointSupportGate,
        geometryGate,
        coherenceGate,
        decision,
        locallyAccepted: decision === 'selected',
        finalDecision: decision === 'selected' ? 'selected' : 'rejected',
        competitionGroupId: null,
        competitionReason: null,
        selected: false,
        reason,
      })
    }
  }
  return options.sort((left, right) => right.multiSurfaceCoherenceScore - left.multiSurfaceCoherenceScore ||
    left.existingWallPlaneId.localeCompare(right.existingWallPlaneId) ||
    left.horizontalPlaneId.localeCompare(right.horizontalPlaneId))[0] ?? null
}

function getTriadKey(diagnostic: StructuralMultiSurfaceCoherenceDiagnostic): string {
  return `${diagnostic.candidatePlaneId}/${diagnostic.existingWallPlaneId}/${diagnostic.horizontalPlaneId}`
}

function getSupportPointsForSurface(
  planeId: string,
  supportIndex: RelationshipSupportIndex | null,
): readonly SpatialPoint[] {
  return supportIndex?.pointsBySurfaceId.get(planeId) ?? []
}

function projectTriadSupport(
  points: readonly SpatialPoint[],
  origin: SpatialPoint,
  tangentU: SpatialPoint,
  tangentV: SpatialPoint,
  cellSizeMeters: number,
): ProjectedTriadSupportSummary {
  const cells = new Set<string>()
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  let centroid = { x: 0, y: 0, z: 0 }
  let pointCount = 0
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      continue
    }
    const relative = {
      x: point.x - origin.x,
      y: point.y - origin.y,
      z: point.z - origin.z,
    }
    const u = dot(relative, tangentU)
    const v = dot(relative, tangentV)
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      continue
    }
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
    cells.add(`${Math.floor(u / cellSizeMeters)}:${Math.floor(v / cellSizeMeters)}`)
    centroid = {
      x: centroid.x + point.x,
      y: centroid.y + point.y,
      z: centroid.z + point.z,
    }
    pointCount += 1
  }
  return {
    cells,
    minU: pointCount > 0 ? minU : 0,
    maxU: pointCount > 0 ? maxU : 0,
    minV: pointCount > 0 ? minV : 0,
    maxV: pointCount > 0 ? maxV : 0,
    centroid: pointCount > 0
      ? {
        x: centroid.x / pointCount,
        y: centroid.y / pointCount,
        z: centroid.z / pointCount,
      }
      : null,
  }
}

function getSetIntersectionCount(first: ReadonlySet<string>, second: ReadonlySet<string>): number {
  let count = 0
  for (const value of first) {
    if (second.has(value)) {
      count += 1
    }
  }
  return count
}

function getProjectedSupportOverlap(first: ProjectedTriadSupportSummary, second: ProjectedTriadSupportSummary): number {
  const intersectionCount = getSetIntersectionCount(first.cells, second.cells)
  const unionCount = first.cells.size + second.cells.size - intersectionCount
  return unionCount > 0 ? intersectionCount / unionCount : 0
}

function getProjectedExtentOverlap(first: ProjectedTriadSupportSummary, second: ProjectedTriadSupportSummary): number {
  if (first.cells.size === 0 || second.cells.size === 0) {
    return 0
  }
  const overlapWidth = Math.max(0, Math.min(first.maxU, second.maxU) - Math.max(first.minU, second.minU))
  const overlapHeight = Math.max(0, Math.min(first.maxV, second.maxV) - Math.max(first.minV, second.minV))
  const firstArea = Math.max(0, first.maxU - first.minU) * Math.max(0, first.maxV - first.minV)
  const secondArea = Math.max(0, second.maxU - second.minU) * Math.max(0, second.maxV - second.minV)
  const smallerArea = Math.min(firstArea, secondArea)
  return smallerArea > 0 ? clamp((overlapWidth * overlapHeight) / smallerArea, 0, 1) : 0
}

function getBidirectionalPlaneSupportDistance(
  first: RoleEvaluation,
  second: RoleEvaluation,
  supportIndex: RelationshipSupportIndex | null,
): number | null {
  const firstPlane = getNormalizedPlane(first.context.plane)
  const secondPlane = getNormalizedPlane(second.context.plane)
  if (!firstPlane || !secondPlane || !supportIndex) {
    return null
  }
  const firstToSecond = getSupportPointsForSurface(first.context.plane.id, supportIndex)
    .map((point) => Math.abs(dot(secondPlane.normal, point) - secondPlane.planeConstant))
    .filter((residual) => Number.isFinite(residual))
  const secondToFirst = getSupportPointsForSurface(second.context.plane.id, supportIndex)
    .map((point) => Math.abs(dot(firstPlane.normal, point) - firstPlane.planeConstant))
    .filter((residual) => Number.isFinite(residual))
  const firstMedian = getMedian(firstToSecond)
  const secondMedian = getMedian(secondToFirst)
  return firstMedian !== null && secondMedian !== null
    ? Math.max(firstMedian, secondMedian)
    : null
}

function getTriadRepresentativeScore(
  diagnostic: StructuralMultiSurfaceCoherenceDiagnostic,
  evaluationByPlaneId: ReadonlyMap<string, RoleEvaluation>,
): number {
  const candidate = evaluationByPlaneId.get(diagnostic.candidatePlaneId)
  const existing = evaluationByPlaneId.get(diagnostic.existingWallPlaneId)
  if (!candidate || !existing) {
    return diagnostic.multiSurfaceCoherenceScore
  }
  const candidateFitQuality = 1 - clamp(candidate.context.plane.rmsError / MAXIMUM_RMS_FOR_QUALITY_METERS, 0, 1)
  const existingFitQuality = 1 - clamp(existing.context.plane.rmsError / MAXIMUM_RMS_FOR_QUALITY_METERS, 0, 1)
  const horizontalSupport = diagnostic.existingHorizontalSupport
    ? (diagnostic.candidateHorizontalSupport.intersectionSupportScore + diagnostic.existingHorizontalSupport.intersectionSupportScore) / 2
    : diagnostic.candidateHorizontalSupport.intersectionSupportScore
  const determinantQuality = clamp(Math.abs(diagnostic.threePlaneDeterminant), 0, 1)
  return clamp(
    diagnostic.multiSurfaceCoherenceScore * 0.22 +
      diagnostic.candidateNodeQuality * 0.08 +
      getMultiSurfaceNodeQuality(existing) * 0.08 +
      candidate.confidence * 0.05 +
      existing.confidence * 0.05 +
      candidate.envelopeSelectionScore * 0.06 +
      existing.envelopeSelectionScore * 0.06 +
      candidate.context.areaScore * 0.04 +
      existing.context.areaScore * 0.04 +
      candidate.context.supportScore * 0.04 +
      existing.context.supportScore * 0.04 +
      diagnostic.wallWallSupport.intersectionSupportScore * 0.07 +
      horizontalSupport * 0.05 +
      (candidateFitQuality + existingFitQuality) / 2 * 0.05 +
      diagnostic.triplePointSupportScore * 0.04 +
      determinantQuality * 0.03,
    0,
    1,
  )
}

function getWallCorrespondence(
  firstWallId: string,
  secondWallId: string,
  evaluationByPlaneId: ReadonlyMap<string, RoleEvaluation>,
  supportIndex: RelationshipSupportIndex | null,
  config: StructuralSurfaceInterpretationConfig,
): StructuralTriadWallCorrespondence | null {
  const firstWall = evaluationByPlaneId.get(firstWallId)
  const secondWall = evaluationByPlaneId.get(secondWallId)
  if (!firstWall || !secondWall) {
    return null
  }
  const firstSupport = projectTriadSupport(
    getSupportPointsForSurface(firstWallId, supportIndex),
    firstWall.context.plane.centroid,
    firstWall.context.plane.tangentU,
    firstWall.context.plane.tangentV,
    config.triadCompetitionProjectedCellSizeMeters,
  )
  const secondSupport = projectTriadSupport(
    getSupportPointsForSurface(secondWallId, supportIndex),
    firstWall.context.plane.centroid,
    firstWall.context.plane.tangentU,
    firstWall.context.plane.tangentV,
    config.triadCompetitionProjectedCellSizeMeters,
  )
  const normalSeparationDegrees = getNormalAngleDegrees(firstWall.context.plane, secondWall.context.plane)
  const planeOffsetDifferenceMeters = getPlaneOffsetDifference(firstWall.context.plane, secondWall.context.plane)
  const bidirectionalSupportDistanceMeters = getBidirectionalPlaneSupportDistance(firstWall, secondWall, supportIndex)
  const supportCentroidDistanceMeters = firstSupport.centroid && secondSupport.centroid
    ? distance(firstSupport.centroid, secondSupport.centroid)
    : null
  const projectedSupportOverlap = getProjectedSupportOverlap(firstSupport, secondSupport)
  const projectedExtentOverlap = getProjectedExtentOverlap(firstSupport, secondSupport)
  const normalQuality = clamp(1 - normalSeparationDegrees / Math.max(config.triadCompetitionMaximumNormalSeparationDegrees, Number.EPSILON), 0, 1)
  const supportDistanceQuality = bidirectionalSupportDistanceMeters === null
    ? 0
    : clamp(1 - bidirectionalSupportDistanceMeters / Math.max(config.triadWholeCornerMaximumSupportDistanceMeters, Number.EPSILON), 0, 1)
  const centroidQuality = supportCentroidDistanceMeters === null
    ? 0
    : clamp(1 - supportCentroidDistanceMeters / Math.max(config.triadWholeCornerMaximumSupportCentroidDistanceMeters, Number.EPSILON), 0, 1)
  const offsetQuality = clamp(1 - planeOffsetDifferenceMeters / 0.75, 0, 1)
  const supportQuality = Math.max(projectedSupportOverlap, projectedExtentOverlap)
  return {
    wallAId: firstWallId,
    wallBId: secondWallId,
    normalSeparationDegrees,
    planeOffsetDifferenceMeters,
    bidirectionalSupportDistanceMeters,
    supportCentroidDistanceMeters,
    projectedSupportOverlap,
    projectedExtentOverlap,
    compatibilityScore: clamp(
      normalQuality * 0.25 +
        supportDistanceQuality * 0.2 +
        supportQuality * 0.3 +
        centroidQuality * 0.15 +
        offsetQuality * 0.1,
      0,
      1,
    ),
  }
}

function chooseWallCorrespondence(
  firstWallIds: readonly string[],
  secondWallIds: readonly string[],
  evaluationByPlaneId: ReadonlyMap<string, RoleEvaluation>,
  supportIndex: RelationshipSupportIndex | null,
  config: StructuralSurfaceInterpretationConfig,
): readonly StructuralTriadWallCorrespondence[] {
  const mappings = [
    [
      getWallCorrespondence(firstWallIds[0], secondWallIds[0], evaluationByPlaneId, supportIndex, config),
      getWallCorrespondence(firstWallIds[1], secondWallIds[1], evaluationByPlaneId, supportIndex, config),
    ],
    [
      getWallCorrespondence(firstWallIds[0], secondWallIds[1], evaluationByPlaneId, supportIndex, config),
      getWallCorrespondence(firstWallIds[1], secondWallIds[0], evaluationByPlaneId, supportIndex, config),
    ],
  ].filter((mapping): mapping is StructuralTriadWallCorrespondence[] => mapping.every((correspondence) => correspondence !== null))
  return mappings.sort((first, second) => {
    const firstScore = first.reduce((total, correspondence) => total + correspondence.compatibilityScore, 0)
    const secondScore = second.reduce((total, correspondence) => total + correspondence.compatibilityScore, 0)
    return secondScore - firstScore || first.map((correspondence) => `${correspondence.wallAId}/${correspondence.wallBId}`).join('|')
      .localeCompare(second.map((correspondence) => `${correspondence.wallAId}/${correspondence.wallBId}`).join('|'))
  })[0] ?? []
}

function isWholeCornerCompetition(
  first: StructuralMultiSurfaceCoherenceDiagnostic,
  second: StructuralMultiSurfaceCoherenceDiagnostic,
  correspondence: readonly StructuralTriadWallCorrespondence[],
  config: StructuralSurfaceInterpretationConfig,
): boolean {
  if (correspondence.length !== 2 || !first.threePlanePoint || !second.threePlanePoint) {
    return false
  }
  const cornerDistance = distance(first.threePlanePoint, second.threePlanePoint)
  if (cornerDistance > config.triadWholeCornerMaximumPointSeparationMeters) {
    return false
  }
  return correspondence.every((pair) => {
    const supportOverlap = pair.projectedSupportOverlap >= config.triadWholeCornerMinimumSupportOverlap ||
      pair.projectedExtentOverlap >= config.triadWholeCornerMinimumExtentOverlap
    const supportDistance = pair.bidirectionalSupportDistanceMeters !== null &&
      pair.bidirectionalSupportDistanceMeters <= config.triadWholeCornerMaximumSupportDistanceMeters
    const centroidDistance = pair.supportCentroidDistanceMeters !== null &&
      pair.supportCentroidDistanceMeters <= config.triadWholeCornerMaximumSupportCentroidDistanceMeters
    return pair.normalSeparationDegrees <= config.triadCompetitionMaximumNormalSeparationDegrees &&
      supportOverlap && supportDistance && centroidDistance
  })
}

function analyzeTriadCompetition(
  triads: readonly StructuralMultiSurfaceCoherenceDiagnostic[],
  evaluationByPlaneId: ReadonlyMap<string, RoleEvaluation>,
  supportIndex: RelationshipSupportIndex | null,
  config: StructuralSurfaceInterpretationConfig,
): TriadCompetitionAnalysis {
  const sortedTriads = [...new Map(triads.map((triad) => [getTriadKey(triad), triad])).values()]
    .sort((left, right) => getTriadKey(left).localeCompare(getTriadKey(right)))
  const representativeScores = new Map(sortedTriads.map((triad) => [
    getTriadKey(triad),
    getTriadRepresentativeScore(triad, evaluationByPlaneId),
  ]))
  const parent = sortedTriads.map((_, index) => index)
  const groupKeyByRoot: Array<string | null> = sortedTriads.map(() => null)
  const findRoot = (index: number): number => {
    let root = index
    while (parent[root] !== root) {
      root = parent[root]
    }
    while (parent[index] !== index) {
      const next = parent[index]
      parent[index] = root
      index = next
    }
    return root
  }
  const union = (first: number, second: number, groupKey: string): void => {
    const firstRoot = findRoot(first)
    const secondRoot = findRoot(second)
    if (firstRoot !== secondRoot) {
      if (groupKeyByRoot[firstRoot] !== null && groupKeyByRoot[firstRoot] !== groupKey) {
        return
      }
      if (groupKeyByRoot[secondRoot] !== null && groupKeyByRoot[secondRoot] !== groupKey) {
        return
      }
      parent[secondRoot] = firstRoot
      groupKeyByRoot[firstRoot] = groupKey
    }
  }
  const pairDrafts: Array<{
    readonly firstIndex: number
    readonly secondIndex: number
    readonly diagnostic: StructuralTriadCompetitionDiagnostic
    readonly competing: boolean
  }> = []
  for (let firstIndex = 0; firstIndex < sortedTriads.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < sortedTriads.length; secondIndex += 1) {
      const firstTriad = sortedTriads[firstIndex]
      const secondTriad = sortedTriads[secondIndex]
      if (firstTriad.horizontalPlaneId !== secondTriad.horizontalPlaneId) {
        continue
      }
      const firstWallIds = [firstTriad.candidatePlaneId, firstTriad.existingWallPlaneId]
      const secondWallIds = [secondTriad.candidatePlaneId, secondTriad.existingWallPlaneId]
      const sharedWallIds = firstWallIds.filter((planeId) => secondWallIds.includes(planeId))
      if (sharedWallIds.length !== 1) {
        continue
      }
      const sharedAnchorWallPlaneId = sharedWallIds[0]
      const introducedWallPlaneAId = firstWallIds.find((planeId) => planeId !== sharedAnchorWallPlaneId)
      const introducedWallPlaneBId = secondWallIds.find((planeId) => planeId !== sharedAnchorWallPlaneId)
      if (!introducedWallPlaneAId || !introducedWallPlaneBId || introducedWallPlaneAId === introducedWallPlaneBId) {
        continue
      }
      const firstCandidate = evaluationByPlaneId.get(introducedWallPlaneAId)
      const secondCandidate = evaluationByPlaneId.get(introducedWallPlaneBId)
      if (!firstCandidate || !secondCandidate) {
        continue
      }
      const referencePlane = firstCandidate.context.plane
      const firstSupport = projectTriadSupport(
        getSupportPointsForSurface(introducedWallPlaneAId, supportIndex),
        referencePlane.centroid,
        referencePlane.tangentU,
        referencePlane.tangentV,
        config.triadCompetitionProjectedCellSizeMeters,
      )
      const secondSupport = projectTriadSupport(
        getSupportPointsForSurface(introducedWallPlaneBId, supportIndex),
        referencePlane.centroid,
        referencePlane.tangentU,
        referencePlane.tangentV,
        config.triadCompetitionProjectedCellSizeMeters,
      )
      const projectedSupportOverlap = getProjectedSupportOverlap(firstSupport, secondSupport)
      const projectedExtentOverlap = getProjectedExtentOverlap(firstSupport, secondSupport)
      const triplePointSeparationMeters = firstTriad.threePlanePoint && secondTriad.threePlanePoint
        ? distance(firstTriad.threePlanePoint, secondTriad.threePlanePoint)
        : null
      const supportCentroidDistanceMeters = firstSupport.centroid && secondSupport.centroid
        ? distance(firstSupport.centroid, secondSupport.centroid)
        : null
      const normalSeparationDegrees = getNormalAngleDegrees(firstCandidate.context.plane, secondCandidate.context.plane)
      const planeOffsetDifferenceMeters = getPlaneOffsetDifference(firstCandidate.context.plane, secondCandidate.context.plane)
      const bidirectionalSupportDistanceMeters = getBidirectionalPlaneSupportDistance(firstCandidate, secondCandidate, supportIndex)
      const supportOverlapEvidence = projectedSupportOverlap >= config.triadCompetitionMinimumProjectedSupportOverlap ||
        projectedExtentOverlap >= config.triadCompetitionMinimumProjectedExtentOverlap
      const commonCornerEvidence = triplePointSeparationMeters !== null &&
        triplePointSeparationMeters <= config.triadCompetitionMaximumTriplePointDistanceMeters &&
        supportCentroidDistanceMeters !== null &&
        supportCentroidDistanceMeters <= config.triadCompetitionMaximumSupportCentroidDistanceMeters
      const competing = normalSeparationDegrees <= config.triadCompetitionMaximumNormalSeparationDegrees &&
        (supportOverlapEvidence || commonCornerEvidence)
      const firstKey = getTriadKey(firstTriad)
      const secondKey = getTriadKey(secondTriad)
      const groupKey = `${sharedAnchorWallPlaneId}::${firstTriad.horizontalPlaneId}`
      const firstScore = representativeScores.get(firstKey) ?? 0
      const secondScore = representativeScores.get(secondKey) ?? 0
      pairDrafts.push({
        firstIndex,
        secondIndex,
        competing,
        diagnostic: {
          triadAKey: firstKey,
          triadBKey: secondKey,
          competitionGroupId: null,
          competitionType: 'shared-anchor',
          sharedAnchorWallPlaneId,
          sharedHorizontalPlaneId: firstTriad.horizontalPlaneId,
          introducedWallPlaneAId,
          introducedWallPlaneBId,
          normalSeparationDegrees,
          planeOffsetDifferenceMeters,
          bidirectionalSupportDistanceMeters,
          supportCentroidDistanceMeters,
          projectedSupportOverlap,
          projectedExtentOverlap,
          triplePointSeparationMeters,
          representativeScoreA: firstScore,
          representativeScoreB: secondScore,
          wallCorrespondence: [],
          duplicateCornerConfidence: null,
          wallSelectionAfterSuppression: [],
          decision: competing ? 'competing' : 'distinct',
          winnerTriadKey: null,
          reason: competing ? 'competing duplicate structural wall hypothesis' : 'distinct spatial corner; preserved',
        },
      })
      if (competing) {
        union(firstIndex, secondIndex, groupKey)
      }
    }
  }

  const wholeCornerPairDrafts: Array<{
    readonly firstIndex: number
    readonly secondIndex: number
    readonly diagnostic: StructuralTriadCompetitionDiagnostic
    readonly competing: boolean
  }> = []
  for (let firstIndex = 0; firstIndex < sortedTriads.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < sortedTriads.length; secondIndex += 1) {
      const firstTriad = sortedTriads[firstIndex]
      const secondTriad = sortedTriads[secondIndex]
      if (firstTriad.horizontalPlaneId !== secondTriad.horizontalPlaneId) {
        continue
      }
      const firstWallIds = [firstTriad.candidatePlaneId, firstTriad.existingWallPlaneId]
      const secondWallIds = [secondTriad.candidatePlaneId, secondTriad.existingWallPlaneId]
      if (firstWallIds.some((planeId) => secondWallIds.includes(planeId))) {
        continue
      }
      const correspondence = chooseWallCorrespondence(
        firstWallIds,
        secondWallIds,
        evaluationByPlaneId,
        supportIndex,
        config,
      )
      if (correspondence.length !== 2) {
        continue
      }
      const triplePointSeparationMeters = firstTriad.threePlanePoint && secondTriad.threePlanePoint
        ? distance(firstTriad.threePlanePoint, secondTriad.threePlanePoint)
        : null
      const correspondenceScore = correspondence.reduce((total, pair) => total + pair.compatibilityScore, 0) / correspondence.length
      const cornerProximityScore = triplePointSeparationMeters === null
        ? 0
        : clamp(1 - triplePointSeparationMeters / Math.max(config.triadWholeCornerMaximumPointSeparationMeters, Number.EPSILON), 0, 1)
      const duplicateCornerConfidence = clamp(correspondenceScore * 0.65 + cornerProximityScore * 0.35, 0, 1)
      const competing = isWholeCornerCompetition(firstTriad, secondTriad, correspondence, config)
      const firstKey = getTriadKey(firstTriad)
      const secondKey = getTriadKey(secondTriad)
      const firstScore = representativeScores.get(firstKey) ?? 0
      const secondScore = representativeScores.get(secondKey) ?? 0
      const averageNormalSeparation = correspondence.reduce((total, pair) => total + pair.normalSeparationDegrees, 0) / correspondence.length
      const offsets = correspondence.map((pair) => pair.planeOffsetDifferenceMeters)
      const supportDistances = correspondence
        .map((pair) => pair.bidirectionalSupportDistanceMeters)
        .filter((value): value is number => value !== null)
      const supportCentroidDistances = correspondence
        .map((pair) => pair.supportCentroidDistanceMeters)
        .filter((value): value is number => value !== null)
      wholeCornerPairDrafts.push({
        firstIndex,
        secondIndex,
        competing,
        diagnostic: {
          triadAKey: firstKey,
          triadBKey: secondKey,
          competitionGroupId: null,
          competitionType: 'whole-corner',
          sharedAnchorWallPlaneId: null,
          sharedHorizontalPlaneId: firstTriad.horizontalPlaneId,
          introducedWallPlaneAId: firstWallIds.join(','),
          introducedWallPlaneBId: secondWallIds.join(','),
          normalSeparationDegrees: averageNormalSeparation,
          planeOffsetDifferenceMeters: offsets.reduce((total, value) => total + value, 0) / offsets.length,
          bidirectionalSupportDistanceMeters: supportDistances.length > 0 ? Math.max(...supportDistances) : null,
          supportCentroidDistanceMeters: supportCentroidDistances.length > 0 ? Math.max(...supportCentroidDistances) : null,
          projectedSupportOverlap: Math.min(...correspondence.map((pair) => pair.projectedSupportOverlap)),
          projectedExtentOverlap: Math.min(...correspondence.map((pair) => pair.projectedExtentOverlap)),
          triplePointSeparationMeters,
          representativeScoreA: firstScore,
          representativeScoreB: secondScore,
          wallCorrespondence: correspondence,
          duplicateCornerConfidence,
          wallSelectionAfterSuppression: [],
          decision: competing ? 'competing' : 'distinct',
          winnerTriadKey: null,
          reason: competing ? 'competing duplicate whole-corner structural hypothesis' : 'distinct spatial corner; preserved',
        },
      })
    }
  }

  const groupedIndices = new Map<number, number[]>()
  sortedTriads.forEach((_, index) => {
    const root = findRoot(index)
    const indices = groupedIndices.get(root) ?? []
    indices.push(index)
    groupedIndices.set(root, indices)
  })
  const competitionGroups: StructuralTriadCompetitionGroup[] = []
  const groupIdByTriadKey = new Map<string, string>()
  const winnerByGroupId = new Map<string, string>()
  const groupedEntries = [...groupedIndices.values()]
    .filter((indices) => indices.length > 1)
    .sort((left, right) => getTriadKey(sortedTriads[left[0]]).localeCompare(getTriadKey(sortedTriads[right[0]])))
  groupedEntries.forEach((indices, groupIndex) => {
    const members = indices
      .map((index) => sortedTriads[index])
      .sort((left, right) => getTriadKey(left).localeCompare(getTriadKey(right)))
    const first = members[0]
    const memberIndices = new Set(indices)
    const firstPair = pairDrafts.find((pair) => pair.competing && memberIndices.has(pair.firstIndex) && memberIndices.has(pair.secondIndex))
    const sharedAnchorWallPlaneId = firstPair?.diagnostic.sharedAnchorWallPlaneId ?? first.existingWallPlaneId
    const groupId = `triad-competition-${sharedAnchorWallPlaneId}-${first.horizontalPlaneId}-${groupIndex + 1}`
    const selectedTriad = [...members]
      .sort((left, right) => (representativeScores.get(getTriadKey(right)) ?? 0) - (representativeScores.get(getTriadKey(left)) ?? 0) ||
        getTriadKey(left).localeCompare(getTriadKey(right)))[0]
    const selectedTriadKey = getTriadKey(selectedTriad)
    winnerByGroupId.set(groupId, selectedTriadKey)
    const triadKeys = members.map(getTriadKey).sort((left, right) => left.localeCompare(right))
    for (const triadKey of triadKeys) {
      groupIdByTriadKey.set(triadKey, groupId)
    }
    competitionGroups.push({
      id: groupId,
      competitionType: 'shared-anchor',
      sharedAnchorWallPlaneId,
      sharedHorizontalPlaneId: first.horizontalPlaneId,
      triadKeys,
      introducedWallPlaneIds: [...new Set(members.map((member) => member.candidatePlaneId))].sort((left, right) => left.localeCompare(right)),
      selectedTriadKey,
      reason: 'strongest representative of competing wall hypotheses selected',
    })
  })

  const wholeParent = sortedTriads.map((_, index) => index)
  const findWholeRoot = (index: number): number => {
    let root = index
    while (wholeParent[root] !== root) {
      root = wholeParent[root]
    }
    while (wholeParent[index] !== index) {
      const next = wholeParent[index]
      wholeParent[index] = root
      index = next
    }
    return root
  }
  for (const pair of wholeCornerPairDrafts) {
    if (!pair.competing) {
      continue
    }
    const firstRoot = findWholeRoot(pair.firstIndex)
    const secondRoot = findWholeRoot(pair.secondIndex)
    if (firstRoot !== secondRoot) {
      wholeParent[secondRoot] = firstRoot
    }
  }
  const wholeGroupedIndices = new Map<number, number[]>()
  sortedTriads.forEach((_, index) => {
    const root = findWholeRoot(index)
    const indices = wholeGroupedIndices.get(root) ?? []
    indices.push(index)
    wholeGroupedIndices.set(root, indices)
  })
  const wholeGroupIdByTriadKey = new Map<string, string>()
  const wholeGroupedEntries = [...wholeGroupedIndices.values()]
    .filter((indices) => indices.length > 1)
    .filter((indices) => wholeCornerPairDrafts.some((pair) => pair.competing && indices.includes(pair.firstIndex) && indices.includes(pair.secondIndex)))
    .sort((left, right) => getTriadKey(sortedTriads[left[0]]).localeCompare(getTriadKey(sortedTriads[right[0]])))
  wholeGroupedEntries.forEach((indices, groupIndex) => {
    const members = indices
      .map((index) => sortedTriads[index])
      .sort((left, right) => getTriadKey(left).localeCompare(getTriadKey(right)))
    const horizontalPlaneId = members[0].horizontalPlaneId
    const groupId = `triad-competition-whole-${horizontalPlaneId}-${groupIndex + 1}`
    const selectedTriad = [...members]
      .sort((left, right) => (representativeScores.get(getTriadKey(right)) ?? 0) - (representativeScores.get(getTriadKey(left)) ?? 0) ||
        getTriadKey(left).localeCompare(getTriadKey(right)))[0]
    const selectedTriadKey = getTriadKey(selectedTriad)
    winnerByGroupId.set(groupId, selectedTriadKey)
    const triadKeys = members.map(getTriadKey).sort((left, right) => left.localeCompare(right))
    for (const triadKey of triadKeys) {
      wholeGroupIdByTriadKey.set(triadKey, groupId)
    }
    const introducedWallPlaneIds = [...new Set(members.flatMap((member) => [member.candidatePlaneId, member.existingWallPlaneId]))]
      .sort((left, right) => left.localeCompare(right))
    competitionGroups.push({
      id: groupId,
      competitionType: 'whole-corner',
      sharedAnchorWallPlaneId: null,
      sharedHorizontalPlaneId: horizontalPlaneId,
      triadKeys,
      introducedWallPlaneIds,
      selectedTriadKey,
      reason: 'strongest representative of competing whole-corner hypotheses selected',
    })
  })

  const pairDiagnostics = [...pairDrafts, ...wholeCornerPairDrafts].map(({ diagnostic, competing }) => {
    const groupId = groupIdByTriadKey.get(diagnostic.triadAKey) ?? wholeGroupIdByTriadKey.get(diagnostic.triadAKey) ?? null
    const winnerTriadKey = groupId ? winnerByGroupId.get(groupId) ?? null : null
    return {
      ...diagnostic,
      competitionGroupId: groupId,
      competitionType: diagnostic.competitionType,
      winnerTriadKey: competing ? winnerTriadKey : null,
      reason: competing
        ? winnerTriadKey === diagnostic.triadAKey
          ? 'strongest representative of competing wall hypothesis'
          : 'competing duplicate structural wall; alternate representative is stronger'
        : 'distinct spatial corner; preserved',
    }
  })
  const suppressedTriadKeys = new Set<string>()
  const finalSelectedTriadKeys = new Set<string>()
  const groupedTriadKeys = new Set<string>()
  const winningTriadKeys = new Set<string>()
  for (const group of competitionGroups) {
    group.triadKeys.forEach((key) => groupedTriadKeys.add(key))
    winningTriadKeys.add(group.selectedTriadKey)
  }
  for (const triad of sortedTriads) {
    const key = getTriadKey(triad)
    if (!groupedTriadKeys.has(key) || winningTriadKeys.has(key)) {
      finalSelectedTriadKeys.add(key)
    } else {
      suppressedTriadKeys.add(key)
    }
  }
  return {
    pairDiagnostics,
    groups: competitionGroups,
    finalSelectedTriadKeys,
    suppressedTriadKeys,
    sharedAnchorGroupCount: competitionGroups.filter((group) => group.competitionType === 'shared-anchor').length,
    wholeCornerGroupCount: competitionGroups.filter((group) => group.competitionType === 'whole-corner').length,
    wholeCornerPairCount: wholeCornerPairDrafts.filter((pair) => pair.competing).length,
  }
}

function getClosestSelectedWall(
  evaluation: RoleEvaluation,
  selectedEvaluations: readonly RoleEvaluation[],
): RoleEvaluation | null {
  return selectedEvaluations.reduce<RoleEvaluation | null>((closest, selected) => {
    if (!closest) {
      return selected
    }
    return getNormalAngleDegrees(evaluation.context.plane, selected.context.plane) <
      getNormalAngleDegrees(evaluation.context.plane, closest.context.plane)
      ? selected
      : closest
  }, null)
}

function hasIndependentParallelBoundaryEvidence(
  evaluation: RoleEvaluation,
  selectedEvaluations: readonly RoleEvaluation[],
  config: StructuralSurfaceInterpretationConfig,
): boolean {
  return selectedEvaluations.some((selected) => isIndependentParallelWall(selected, evaluation, config))
}

function getWallGrowthReason(
  evaluation: RoleEvaluation,
  selectedEvaluations: readonly RoleEvaluation[],
  selectedPlaneIds: ReadonlySet<string>,
  graphEdges: readonly StructuralGraphEdge[],
  config: StructuralSurfaceInterpretationConfig,
): string {
  if (!isEnvelopeEligible(evaluation, config)) {
    return evaluation.context.orientationScore < config.minimumWallOrientationScore
      ? 'insufficient orientation evidence'
      : 'insufficient envelope evidence'
  }
  const closestSelected = getClosestSelectedWall(evaluation, selectedEvaluations)
  const orientationDifference = closestSelected
    ? getNormalAngleDegrees(evaluation.context.plane, closestSelected.context.plane)
    : Infinity
  const independentParallel = hasIndependentParallelBoundaryEvidence(evaluation, selectedEvaluations, config)
  if (orientationDifference <= config.selectedWallRedundancyAngleDegrees && !independentParallel) {
    return `orientation redundant with selected ${closestSelected?.context.plane.id ?? 'wall'}`
  }
  const bestEdge = getBestWallEdgeToSelected(evaluation.context.plane.id, selectedPlaneIds, graphEdges)
  if (bestEdge?.edgeStrength === 'supporting') {
    return 'only weak transitive graph support'
  }
  if (!bestEdge) {
    return selectedEvaluations.length > 0
      ? 'disconnected wall-like candidate'
      : 'insufficient envelope graph evidence'
  }
  return bestEdge.edgeType === 'parallel-boundary'
    ? 'distinct parallel room boundary'
    : 'strong corner edge; candidate considered for graph growth'
}

function getStructuralNodeQuality(evaluation: RoleEvaluation): number {
  const fitQuality = 1 - clamp(evaluation.context.plane.rmsError / MAXIMUM_RMS_FOR_QUALITY_METERS, 0, 1)
  const orientationQuality = evaluation.role === 'wall'
    ? evaluation.context.orientationScore
    : evaluation.context.horizontalOrientationScore
  return clamp(
    evaluation.finalSelectionScore * 0.25 +
      evaluation.envelopeSelectionScore * 0.15 +
      evaluation.confidence * 0.2 +
      orientationQuality * 0.15 +
      evaluation.context.areaScore * 0.1 +
      evaluation.context.supportScore * 0.1 +
      fitQuality * 0.05,
    0,
    1,
  )
}

function getWallCorePairCandidates(
  evaluations: readonly RoleEvaluation[],
  edges: readonly StructuralGraphEdge[],
  config: StructuralSurfaceInterpretationConfig,
): StructuralCorePairCandidate[] {
  const evaluationsById = new Map(evaluations.map((evaluation) => [evaluation.context.plane.id, evaluation]))
  return edges
    .filter((edge) =>
      edge.edgeStrength === 'strong' &&
      (edge.edgeType === 'corner' || edge.edgeType === 'parallel-boundary'))
    .map((edge) => {
      const first = evaluationsById.get(edge.firstPlaneId)
      const second = evaluationsById.get(edge.secondPlaneId)
      if (!first || !second || first.role !== 'wall' || second.role !== 'wall' ||
        !isEnvelopeEligible(first, config) || !isEnvelopeEligible(second, config)) {
        return null
      }
      const firstNodeQuality = getStructuralNodeQuality(first)
      const secondNodeQuality = getStructuralNodeQuality(second)
      return {
        firstPlaneId: edge.firstPlaneId,
        secondPlaneId: edge.secondPlaneId,
        edgeStrength: edge.edgeStrength,
        edgeScore: edge.edgeScore,
        firstNodeQuality,
        secondNodeQuality,
        jointCoreScore: clamp(edge.edgeScore * Math.sqrt(firstNodeQuality * secondNodeQuality), 0, 1),
        selected: false,
      }
    })
    .filter((candidate): candidate is StructuralCorePairCandidate => Boolean(candidate))
    .sort((left, right) => right.jointCoreScore - left.jointCoreScore ||
      right.edgeScore - left.edgeScore ||
      left.firstPlaneId.localeCompare(right.firstPlaneId) ||
      left.secondPlaneId.localeCompare(right.secondPlaneId))
}

function getWallHorizontalCoreCandidate(
  evaluations: readonly RoleEvaluation[],
  edges: readonly StructuralGraphEdge[],
  config: StructuralSurfaceInterpretationConfig,
): StructuralCorePairCandidate | null {
  const evaluationsById = new Map(evaluations.map((evaluation) => [evaluation.context.plane.id, evaluation]))
  return edges
    .filter((edge) => edge.edgeType === 'wall-horizontal' && edge.edgeStrength === 'strong')
    .map((edge) => {
      const first = evaluationsById.get(edge.firstPlaneId)
      const second = evaluationsById.get(edge.secondPlaneId)
      if (!first || !second ||
        !((first.role === 'wall' && (second.role === 'floor' || second.role === 'ceiling')) ||
          (second.role === 'wall' && (first.role === 'floor' || first.role === 'ceiling'))) ||
        !isEnvelopeEligible(first, config) || !isEnvelopeEligible(second, config)) {
        return null
      }
      const firstNodeQuality = getStructuralNodeQuality(first)
      const secondNodeQuality = getStructuralNodeQuality(second)
      return {
        firstPlaneId: edge.firstPlaneId,
        secondPlaneId: edge.secondPlaneId,
        edgeStrength: edge.edgeStrength,
        edgeScore: edge.edgeScore,
        firstNodeQuality,
        secondNodeQuality,
        jointCoreScore: clamp(edge.edgeScore * Math.sqrt(firstNodeQuality * secondNodeQuality), 0, 1),
        selected: false,
      }
    })
    .filter((candidate): candidate is StructuralCorePairCandidate => Boolean(candidate))
    .sort((left, right) => right.jointCoreScore - left.jointCoreScore ||
      right.edgeScore - left.edgeScore ||
      left.firstPlaneId.localeCompare(right.firstPlaneId) ||
      left.secondPlaneId.localeCompare(right.secondPlaneId))[0] ?? null
}

function freezeSurfaceArray(surfaces: StructuralSurfaceCandidate[]): readonly StructuralSurfaceCandidate[] {
  return Object.freeze(surfaces)
}

export class StructuralSurfaceInterpretationService {
  private readonly config: StructuralSurfaceInterpretationConfig

  constructor(config: StructuralSurfaceInterpretationConfig = DEFAULT_STRUCTURAL_SURFACE_INTERPRETATION_CONFIG) {
    this.config = config
  }

  public interpret(
    analysisResult: RoomAnalysisResult,
    referenceSpaceType: 'local-floor' | 'local',
    finalizedScan?: FinalizedSpatialScan,
  ): RoomStructureInterpretationResult {
    const totalStartedAt = getTimestamp()
    const relationshipStartedAt = getTimestamp()
    const relationshipSupportIndex = createRelationshipSupportIndex(
      finalizedScan,
      analysisResult.planes,
      this.config,
    )
    const relationships: StructuralSurfaceRelationship[] = []
    for (let firstIndex = 0; firstIndex < analysisResult.planes.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < analysisResult.planes.length; secondIndex += 1) {
        relationships.push(createRelationship(
          analysisResult.planes[firstIndex],
          analysisResult.planes[secondIndex],
          this.config,
          relationshipSupportIndex,
        ))
      }
    }
    const relationshipFinishedAt = getTimestamp()
    assertPlaneIdMapping(analysisResult, analysisResult.planes, relationships)
    const interpretationStartedAt = getTimestamp()
    const contexts = createPlaneContexts(
      analysisResult,
      relationships,
      referenceSpaceType,
      this.config,
    )
    const initialEvaluations = evaluateContexts(contexts, this.config)
    const wallOrientationGroups = buildOrientationGroups(initialEvaluations, 'wall', this.config)
    const floorOrientationGroups = buildOrientationGroups(initialEvaluations, 'floor', this.config)
    const ceilingOrientationGroups = buildOrientationGroups(initialEvaluations, 'ceiling', this.config)
    const orientationGroupSpecifications = [
      ...wallOrientationGroups.map((group, index) => ({ id: `wall-orientation-${index + 1}`, role: group.role, group })),
      ...floorOrientationGroups.map((group, index) => ({ id: `floor-orientation-${index + 1}`, role: group.role, group })),
      ...ceilingOrientationGroups.map((group, index) => ({ id: `ceiling-orientation-${index + 1}`, role: group.role, group })),
    ]
    const orientationGroupIdByPlaneId = new Map<string, string>()
    for (const specification of orientationGroupSpecifications) {
      for (const member of specification.group.members) {
        orientationGroupIdByPlaneId.set(member.context.plane.id, specification.id)
      }
    }
    const graph = createStructuralGraph(
      initialEvaluations,
      relationships,
      orientationGroupIdByPlaneId,
      this.config,
    )
    const evaluations = applyGraphEvidence(initialEvaluations, graph.graphSupportByPlaneId)
    let evaluationByPlaneId = new Map(evaluations.map((evaluation) => [evaluation.context.plane.id, evaluation]))
    const structuralCorePairCandidates = getWallCorePairCandidates(evaluations, graph.edges, this.config)
    const getUpdatedGroupMembers = (group: StructuralOrientationGroup): RoleEvaluation[] =>
      group.members
        .map((member) => evaluationByPlaneId.get(member.context.plane.id))
        .filter((member): member is RoleEvaluation => Boolean(member))

    const selectedWallIds = new Set<string>()
    const alternateWallIds = new Set<string>()
    const wallSelectionReasons = new Map<string, string>()
    const selectedWallIdsByGroup = new Map<string, string[]>()
    const hasGraphEvidence = graph.edges.length > 0

    const addSelectedWall = (evaluation: RoleEvaluation, reason: string): void => {
      const planeId = evaluation.context.plane.id
      selectedWallIds.add(planeId)
      const groupId = orientationGroupIdByPlaneId.get(planeId)
      if (groupId) {
        const groupSelection = selectedWallIdsByGroup.get(groupId) ?? []
        if (!groupSelection.includes(planeId)) {
          groupSelection.push(planeId)
        }
        selectedWallIdsByGroup.set(groupId, groupSelection)
      }
      wallSelectionReasons.set(planeId, reason)
    }

    const eligibleWalls = evaluations
      .filter((evaluation) => evaluation.role === 'wall' && isEnvelopeEligible(evaluation, this.config))
    const floorEligible = floorOrientationGroups.flatMap((group) => getUpdatedGroupMembers(group))
      .filter((evaluation) => isEnvelopeEligible(evaluation, this.config))
      .sort((left, right) => getRoleSelectionScore(right) - getRoleSelectionScore(left))
    const ceilingEligible = ceilingOrientationGroups.flatMap((group) => getUpdatedGroupMembers(group))
      .filter((evaluation) => isEnvelopeEligible(evaluation, this.config))
      .sort((left, right) => getRoleSelectionScore(right) - getRoleSelectionScore(left))
    const selectedFloorEvaluation = floorEligible[0]
    const selectedCeilingEvaluation = ceilingEligible[0]
    const selectedFloorId = selectedFloorEvaluation?.context.plane.id ?? null
    const selectedCeilingId = selectedCeilingEvaluation?.context.plane.id ?? null
    const seedPair = structuralCorePairCandidates[0]
    const seedEdge = seedPair
      ? graph.edges.find((edge) => edge.firstPlaneId === seedPair.firstPlaneId && edge.secondPlaneId === seedPair.secondPlaneId)
      : undefined
    const seedEvaluations = seedEdge
      ? [evaluationByPlaneId.get(seedEdge.firstPlaneId), evaluationByPlaneId.get(seedEdge.secondPlaneId)]
        .filter((evaluation): evaluation is RoleEvaluation => Boolean(evaluation && evaluation.role === 'wall' && isEnvelopeEligible(evaluation, this.config)))
      : []

    if (seedEdge && seedEvaluations.length === 2) {
      for (const evaluation of seedEvaluations) {
        addSelectedWall(
          evaluation,
          seedEdge.edgeType === 'parallel-boundary'
            ? 'highest joint structural core score; distinct parallel boundary supported by strong graph core'
            : 'highest joint structural core score; strong corner edge introduces a coherent wall direction',
        )
      }
    } else {
      const wallHorizontalSeedCandidate = getWallHorizontalCoreCandidate(evaluations, graph.edges, this.config)
      const wallHorizontalSeed = wallHorizontalSeedCandidate
        ? graph.edges.find((edge) => edge.firstPlaneId === wallHorizontalSeedCandidate.firstPlaneId &&
          edge.secondPlaneId === wallHorizontalSeedCandidate.secondPlaneId)
        : undefined
      const wallHorizontalEvaluation = wallHorizontalSeed
        ? [wallHorizontalSeed.firstPlaneId, wallHorizontalSeed.secondPlaneId]
          .map((planeId) => evaluationByPlaneId.get(planeId))
          .find((evaluation): evaluation is RoleEvaluation => Boolean(evaluation && evaluation.role === 'wall' && isEnvelopeEligible(evaluation, this.config)))
        : undefined
      if (wallHorizontalEvaluation && wallHorizontalSeed) {
        const otherPlaneId = wallHorizontalSeed.firstPlaneId === wallHorizontalEvaluation.context.plane.id
          ? wallHorizontalSeed.secondPlaneId
          : wallHorizontalSeed.firstPlaneId
        addSelectedWall(wallHorizontalEvaluation, `strong wall-horizontal envelope evidence (${otherPlaneId})`)
      }
    }

    while (selectedWallIds.size > 0) {
      const selectedEvaluations = [...selectedWallIds]
        .map((planeId) => evaluationByPlaneId.get(planeId))
        .filter((evaluation): evaluation is RoleEvaluation => Boolean(evaluation && evaluation.role === 'wall'))
      const growthOptions = eligibleWalls
        .filter((evaluation) => !selectedWallIds.has(evaluation.context.plane.id) && !alternateWallIds.has(evaluation.context.plane.id))
        .map((evaluation) => ({
          evaluation,
          edge: getBestWallEdgeToSelected(evaluation.context.plane.id, selectedWallIds, graph.edges),
        }))
        .filter((option): option is { evaluation: RoleEvaluation; edge: StructuralGraphEdge } =>
          Boolean(option.edge && option.edge.edgeStrength === 'strong'))
        .sort((left, right) => right.edge.edgeScore - left.edge.edgeScore ||
          getRoleSelectionScore(right.evaluation) - getRoleSelectionScore(left.evaluation) ||
          left.evaluation.context.plane.id.localeCompare(right.evaluation.context.plane.id))
      const next = growthOptions[0]
      if (!next) {
        break
      }
      const candidate = next.evaluation
      const closestSelected = getClosestSelectedWall(candidate, selectedEvaluations)
      const orientationRedundant = Boolean(closestSelected &&
        getNormalAngleDegrees(candidate.context.plane, closestSelected.context.plane) <= this.config.selectedWallRedundancyAngleDegrees)
      const independentParallel = hasIndependentParallelBoundaryEvidence(candidate, selectedEvaluations, this.config)
      if (orientationRedundant && !independentParallel) {
        alternateWallIds.add(candidate.context.plane.id)
        wallSelectionReasons.set(
          candidate.context.plane.id,
          `orientation redundant with selected ${closestSelected?.context.plane.id ?? 'wall'}`,
        )
        continue
      }
      addSelectedWall(
        candidate,
        next.edge.edgeType === 'parallel-boundary'
          ? 'distinct parallel boundary supported by room graph'
          : 'strong corner edge; introduces a new wall direction',
      )
    }

    if (selectedWallIds.size === 0) {
      const standaloneWall = eligibleWalls
        .sort((left, right) => getRoleSelectionScore(right) - getRoleSelectionScore(left) ||
          left.context.plane.id.localeCompare(right.context.plane.id))[0]
      if (standaloneWall) {
        addSelectedWall(standaloneWall, 'strongest credible standalone wall')
      }
    }

    const selectedHorizontalEvaluations = [selectedFloorEvaluation, selectedCeilingEvaluation]
      .filter((evaluation): evaluation is RoleEvaluation => Boolean(evaluation))
    const multiSurfaceCoherenceByPlaneId = new Map<string, number>()
    const multiSurfaceDiagnosticByKey = new Map<string, StructuralMultiSurfaceCoherenceDiagnostic>()
    const locallyAcceptedTriads: StructuralMultiSurfaceCoherenceDiagnostic[] = []
    const triadAddedWallIds = new Set<string>()
    let addedTriadWall = true
    while (addedTriadWall && selectedHorizontalEvaluations.length > 0) {
      addedTriadWall = false
      const selectedEvaluations = [...selectedWallIds]
        .map((planeId) => evaluationByPlaneId.get(planeId))
        .filter((evaluation): evaluation is RoleEvaluation => Boolean(evaluation && evaluation.role === 'wall'))
      const triadOptions = eligibleWalls
        .filter((evaluation) => !selectedWallIds.has(evaluation.context.plane.id))
        .map((evaluation) => getBestMultiSurfaceCoherence(
          evaluation,
          selectedEvaluations,
          selectedHorizontalEvaluations,
          relationships,
          relationshipSupportIndex,
          graph.edges,
          this.config,
        ))
        .filter((diagnostic): diagnostic is StructuralMultiSurfaceCoherenceDiagnostic => Boolean(diagnostic))
        .sort((left, right) => right.multiSurfaceCoherenceScore - left.multiSurfaceCoherenceScore ||
          left.candidatePlaneId.localeCompare(right.candidatePlaneId))

      for (const diagnostic of triadOptions) {
        const key = `${diagnostic.candidatePlaneId}/${diagnostic.existingWallPlaneId}/${diagnostic.horizontalPlaneId}`
        if (!multiSurfaceDiagnosticByKey.has(key)) {
          multiSurfaceDiagnosticByKey.set(key, diagnostic)
        }
        const mandatoryGatesPassed = diagnostic.geometryGate === 'pass' &&
          diagnostic.wallWallSupportGate === 'pass' &&
          diagnostic.wallHorizontalSupportGateA === 'pass' &&
          diagnostic.wallHorizontalSupportGateB === 'pass' &&
          diagnostic.triplePointSupportGate === 'pass'
        if (!mandatoryGatesPassed || diagnostic.coherenceGate === 'fail') {
          multiSurfaceDiagnosticByKey.set(key, {
            ...diagnostic,
            decision: 'rejected',
            selected: false,
          })
          continue
        }
        const candidate = evaluationByPlaneId.get(diagnostic.candidatePlaneId)
        if (!candidate || candidate.role !== 'wall') {
          continue
        }
        multiSurfaceCoherenceByPlaneId.set(
          candidate.context.plane.id,
          Math.max(multiSurfaceCoherenceByPlaneId.get(candidate.context.plane.id) ?? 0, diagnostic.multiSurfaceCoherenceScore),
        )
        const acceptedDiagnostic = {
          ...diagnostic,
          locallyAccepted: true,
          finalDecision: 'selected' as const,
          competitionGroupId: null,
          competitionReason: null,
          decision: 'selected' as const,
          selected: true,
        }
        multiSurfaceDiagnosticByKey.set(key, acceptedDiagnostic)
        locallyAcceptedTriads.push(acceptedDiagnostic)
        triadAddedWallIds.add(candidate.context.plane.id)
        addSelectedWall(candidate, 'coherent wall-wall-horizontal triad')
        addedTriadWall = true
        break
      }
    }

    const triadCompetition = analyzeTriadCompetition(
      locallyAcceptedTriads,
      evaluationByPlaneId,
      relationshipSupportIndex,
      this.config,
    )
    const selectedTriadWallIds = new Set<string>()
    const triadKeysByWallId = new Map<string, Set<string>>()
    for (const triad of locallyAcceptedTriads) {
      const triadKey = getTriadKey(triad)
      for (const planeId of [triad.candidatePlaneId, triad.existingWallPlaneId]) {
        const triadKeys = triadKeysByWallId.get(planeId) ?? new Set<string>()
        triadKeys.add(triadKey)
        triadKeysByWallId.set(planeId, triadKeys)
      }
      if (triadCompetition.finalSelectedTriadKeys.has(triadKey)) {
        selectedTriadWallIds.add(triad.candidatePlaneId)
        selectedTriadWallIds.add(triad.existingWallPlaneId)
      }
    }
    const wholeCornerCompetitionWallIds = new Set(
      triadCompetition.groups
        .filter((group) => group.competitionType === 'whole-corner')
        .flatMap((group) => group.introducedWallPlaneIds),
    )
    const hasIndependentStructuralEvidence = (planeId: string): boolean => {
      const selectedOutsideWholeCorner = [...selectedWallIds].some((selectedPlaneId) => {
        if (selectedPlaneId === planeId || wholeCornerCompetitionWallIds.has(selectedPlaneId)) {
          return false
        }
        return structuralCorePairCandidates.some((candidate) => {
          const connectsCandidate = candidate.firstPlaneId === planeId
            ? candidate.secondPlaneId === selectedPlaneId
            : candidate.secondPlaneId === planeId && candidate.firstPlaneId === selectedPlaneId
          return connectsCandidate && candidate.edgeScore >= this.config.minimumStrongGraphEdgeScore
        })
      })
      if (selectedOutsideWholeCorner) {
        return true
      }
      const evaluation = evaluationByPlaneId.get(planeId)
      const selectedOutsideWholeCornerEvaluations = [...selectedWallIds]
        .filter((selectedPlaneId) => selectedPlaneId !== planeId && !wholeCornerCompetitionWallIds.has(selectedPlaneId))
        .map((selectedPlaneId) => evaluationByPlaneId.get(selectedPlaneId))
        .filter((selected): selected is RoleEvaluation => Boolean(selected && selected.role === 'wall'))
      return Boolean(evaluation && hasIndependentParallelBoundaryEvidence(
        evaluation,
        selectedOutsideWholeCornerEvaluations,
        this.config,
      ))
    }
    for (const triad of locallyAcceptedTriads) {
      const triadKey = getTriadKey(triad)
      const groups = triadCompetition.groups.filter((candidate) => candidate.triadKeys.includes(triadKey))
      const group = groups.find((candidate) => candidate.competitionType === 'whole-corner') ?? groups[0]
      const suppressed = triadCompetition.suppressedTriadKeys.has(triadKey)
      multiSurfaceDiagnosticByKey.set(triadKey, {
        ...triad,
        competitionGroupId: group?.id ?? null,
        competitionReason: suppressed
          ? 'competing duplicate structural wall; alternate representative is stronger'
          : group
            ? 'strongest representative of competing wall hypothesis'
            : null,
        finalDecision: suppressed ? 'suppressed' : 'selected',
        selected: !suppressed,
      })
      if (!suppressed) {
        continue
      }
      const hasWholeCornerCompetition = groups.some((candidate) => candidate.competitionType === 'whole-corner')
      const wallIdsToConsider = hasWholeCornerCompetition
        ? [triad.candidatePlaneId, triad.existingWallPlaneId]
        : [triad.candidatePlaneId]
      for (const planeId of wallIdsToConsider) {
        const wallTriadKeys = triadKeysByWallId.get(planeId) ?? new Set<string>()
        const hasIndependentSelectedTriad = [...wallTriadKeys].some((key) => triadCompetition.finalSelectedTriadKeys.has(key))
        const participatesOnlyInSuppressedWholeCorner = hasWholeCornerCompetition &&
          wallTriadKeys.size > 0 &&
          [...wallTriadKeys].every((key) => triadCompetition.suppressedTriadKeys.has(key))
        const hasIndependentEvidence = hasIndependentStructuralEvidence(planeId)
        const shouldSuppress = hasWholeCornerCompetition
          ? participatesOnlyInSuppressedWholeCorner
          : triadAddedWallIds.has(planeId)
        if (!shouldSuppress || hasIndependentSelectedTriad || hasIndependentEvidence || selectedTriadWallIds.has(planeId)) {
          continue
        }
        selectedWallIds.delete(planeId)
        alternateWallIds.add(planeId)
        wallSelectionReasons.set(
          planeId,
          hasWholeCornerCompetition
            ? 'competing duplicate whole-corner structural wall; alternate representative is stronger'
            : 'competing duplicate structural wall; alternate representative is stronger',
        )
        const groupId = orientationGroupIdByPlaneId.get(planeId)
        if (groupId) {
          selectedWallIdsByGroup.set(
            groupId,
            (selectedWallIdsByGroup.get(groupId) ?? []).filter((selectedPlaneId) => selectedPlaneId !== planeId),
          )
        }
      }
    }

    const triadCompetitionDiagnostics = triadCompetition.pairDiagnostics.map((diagnostic) => {
      if (diagnostic.competitionType !== 'whole-corner' || diagnostic.decision !== 'competing' || !diagnostic.winnerTriadKey) {
        return diagnostic
      }
      const losingTriadKey = diagnostic.winnerTriadKey === diagnostic.triadAKey
        ? diagnostic.triadBKey
        : diagnostic.triadAKey
      const losingTriad = locallyAcceptedTriads.find((triad) => getTriadKey(triad) === losingTriadKey)
      if (!losingTriad) {
        return diagnostic
      }
      const wallSelectionAfterSuppression: StructuralTriadWallSelectionDiagnostic[] = [
        losingTriad.candidatePlaneId,
        losingTriad.existingWallPlaneId,
      ].filter((planeId, index, planeIds) => planeIds.indexOf(planeId) === index)
        .map((planeId) => ({
          planeId,
          remainsSelected: selectedWallIds.has(planeId),
          independentlyRequired: hasIndependentStructuralEvidence(planeId),
        }))
      return {
        ...diagnostic,
        wallSelectionAfterSuppression,
      }
    })

    // M8.5.3: graph evidence can introduce the first wall, but it must not
    // suppress a separate, strongly observed partial wall merely because the
    // second orientation lacks a triad. Keep same-direction duplicate
    // protection intact; only independently strong, non-redundant walls pass.
    const strongStandaloneWallIds = new Set<string>()
    // This deliberately starts from all wall-role evaluations rather than
    // `eligibleWalls`: that older graph-envelope gate requires the much
    // stronger no-relationship support threshold and would make this new
    // independently-evidenced path unreachable for legitimate partial walls.
    const standaloneCandidates = evaluations
      .filter((evaluation) => evaluation.role === 'wall')
      .filter((evaluation) => !selectedWallIds.has(evaluation.context.plane.id) && !alternateWallIds.has(evaluation.context.plane.id))
      .filter((evaluation) => isStrongStandaloneWall(evaluation, this.config))
      .sort((left, right) => getRoleSelectionScore(right) - getRoleSelectionScore(left) ||
        left.context.plane.id.localeCompare(right.context.plane.id))
    for (const candidate of standaloneCandidates) {
      const selectedEvaluations = [...selectedWallIds]
        .map((planeId) => evaluationByPlaneId.get(planeId))
        .filter((evaluation): evaluation is RoleEvaluation => Boolean(evaluation && evaluation.role === 'wall'))
      const closestSelected = getClosestSelectedWall(candidate, selectedEvaluations)
      const sameOrientation = Boolean(closestSelected &&
        getNormalAngleDegrees(candidate.context.plane, closestSelected.context.plane) <= this.config.selectedWallRedundancyAngleDegrees)
      const independentParallel = hasIndependentParallelBoundaryEvidence(candidate, selectedEvaluations, this.config)
      if (sameOrientation && !independentParallel) {
        alternateWallIds.add(candidate.context.plane.id)
        wallSelectionReasons.set(candidate.context.plane.id, `strong standalone evidence rejected: orientation duplicate of ${closestSelected?.context.plane.id ?? 'selected wall'}`)
        continue
      }
      addSelectedWall(candidate, getStrongStandaloneWallReason(candidate))
      strongStandaloneWallIds.add(candidate.context.plane.id)
    }

    const finalEvaluations = evaluations.map((evaluation) => {
      const multiSurfaceCoherenceScore = multiSurfaceCoherenceByPlaneId.get(evaluation.context.plane.id) ?? 0
      const finalSelectionScore = multiSurfaceCoherenceScore > 0
        ? clamp(evaluation.finalSelectionScore * 0.8 + multiSurfaceCoherenceScore * 0.2, 0, 1)
        : evaluation.finalSelectionScore
      return {
        ...evaluation,
        multiSurfaceCoherenceScore,
        finalSelectionScore,
        selectionEvidence: {
          ...evaluation.selectionEvidence,
          competitionScore: finalSelectionScore,
          multiSurfaceCoherenceScore,
        },
      }
    })
    evaluationByPlaneId = new Map(finalEvaluations.map((evaluation) => [evaluation.context.plane.id, evaluation]))

    const selectedWallComponents = new Set<number>()
    for (const [componentIndex, component] of graph.components.entries()) {
      if ([...selectedWallIds].some((planeId) => component.has(planeId))) {
        selectedWallComponents.add(componentIndex)
      }
    }

    for (const evaluation of evaluations.filter((candidate) => candidate.role === 'wall')) {
      const planeId = evaluation.context.plane.id
      if (selectedWallIds.has(planeId) || alternateWallIds.has(planeId)) {
        continue
      }
      alternateWallIds.add(planeId)
      const selectedEvaluations = [...selectedWallIds]
        .map((selectedPlaneId) => evaluationByPlaneId.get(selectedPlaneId))
        .filter((selected): selected is RoleEvaluation => Boolean(selected && selected.role === 'wall'))
      wallSelectionReasons.set(planeId, getWallGrowthReason(
        evaluation,
        selectedEvaluations,
        selectedWallIds,
        graph.edges,
        this.config,
      ))
    }

    const alternateFloorIds = new Set(floorOrientationGroups.flatMap((group) =>
      getUpdatedGroupMembers(group).filter((member) => member.context.plane.id !== selectedFloorId).map((member) => member.context.plane.id)))
    const alternateCeilingIds = new Set(ceilingOrientationGroups.flatMap((group) =>
      getUpdatedGroupMembers(group).filter((member) => member.context.plane.id !== selectedCeilingId).map((member) => member.context.plane.id)))

    const getSelection = (evaluation: RoleEvaluation): StructuralSurfaceSelection => {
      if (evaluation.role === 'wall') {
        return selectedWallIds.has(evaluation.context.plane.id)
          ? 'selected'
          : alternateWallIds.has(evaluation.context.plane.id) ? 'alternate' : 'unselected'
      }
      if (evaluation.role === 'floor') {
        return evaluation.context.plane.id === selectedFloorId
          ? 'selected'
          : alternateFloorIds.has(evaluation.context.plane.id) ? 'alternate' : 'unselected'
      }
      if (evaluation.role === 'ceiling') {
        return evaluation.context.plane.id === selectedCeilingId
          ? 'selected'
          : alternateCeilingIds.has(evaluation.context.plane.id) ? 'alternate' : 'unselected'
      }
      return 'unselected'
    }

    const surfaces = finalEvaluations.map((evaluation) => {
      const selection = getSelection(evaluation)
      const reason = evaluation.role === 'wall'
        ? wallSelectionReasons.get(evaluation.context.plane.id) ?? getSelectionReason(evaluation, selection, false, this.config)
        : getGraphSelectionReason(
          evaluation,
          selection,
          graph.edges,
          hasGraphEvidence,
          selection === 'alternate',
          this.config,
        )
      return createSurfaceCandidate(evaluation, selection, reason)
    })
    const selectedWalls = surfaces.filter((surface) => surface.role === 'wall' && surface.selection === 'selected')
    const selectedFloor = surfaces.find((surface) => surface.planeId === selectedFloorId) ?? null
    const selectedCeiling = surfaces.find((surface) => surface.planeId === selectedCeilingId) ?? null
    const alternateWallCandidates = surfaces.filter((surface) => surface.role === 'wall' && surface.selection === 'alternate')
    const alternateFloorCandidates = surfaces.filter((surface) => surface.role === 'floor' && surface.selection === 'alternate')
    const alternateCeilingCandidates = surfaces.filter((surface) => surface.role === 'ceiling' && surface.selection === 'alternate')
    const otherSurfaces = surfaces.filter((surface) => surface.role === 'other')
    const unknownSurfaces = surfaces.filter((surface) => surface.role === 'unknown')
    const directionGroups = [
      ...orientationGroupSpecifications.map((specification) => createDirectionGroup(
        specification.id,
        specification.group,
        specification.role === 'wall'
          ? selectedWallIdsByGroup.get(specification.id) ?? []
          : specification.role === 'floor'
            ? specification.group.members.some((member) => member.context.plane.id === selectedFloorId) ? [selectedFloorId as string] : []
            : specification.group.members.some((member) => member.context.plane.id === selectedCeilingId) ? [selectedCeilingId as string] : [],
      )),
    ]
    const parallelLanes = [
      ...createParallelLanes(wallOrientationGroups, this.config, 'wall'),
      ...createParallelLanes(floorOrientationGroups, this.config, 'floor'),
      ...createParallelLanes(ceilingOrientationGroups, this.config, 'ceiling'),
    ]
    const interpretationFinishedAt = getTimestamp()
    const roleCandidateCount = surfaces.filter((surface) => surface.role === 'wall' || surface.role === 'floor' || surface.role === 'ceiling').length
    const corePairDiagnostics = structuralCorePairCandidates.map((candidate) => ({
      ...candidate,
      selected: selectedWallIds.has(candidate.firstPlaneId) && selectedWallIds.has(candidate.secondPlaneId),
    }))
    const multiSurfaceCoherenceDiagnostics = [...multiSurfaceDiagnosticByKey.values()]
      .sort((left, right) => right.multiSurfaceCoherenceScore - left.multiSurfaceCoherenceScore ||
        left.candidatePlaneId.localeCompare(right.candidatePlaneId) ||
        left.existingWallPlaneId.localeCompare(right.existingWallPlaneId))

    return Object.freeze({
      sourceScanId: analysisResult.sourceScanId,
      referenceSpaceType,
      roleCandidates: freezeSurfaceArray(surfaces),
      surfaces: freezeSurfaceArray(surfaces),
      selectedWalls: freezeSurfaceArray(selectedWalls),
      selectedFloor,
      selectedCeiling,
      alternateWallCandidates: freezeSurfaceArray(alternateWallCandidates),
      alternateFloorCandidates: freezeSurfaceArray(alternateFloorCandidates),
      alternateCeilingCandidates: freezeSurfaceArray(alternateCeilingCandidates),
      directionGroups: Object.freeze(directionGroups),
      wallOrientationGroups: Object.freeze(directionGroups.filter((group) => group.role === 'wall')),
      parallelLanes: Object.freeze(parallelLanes),
      structuralGraphNodes: graph.nodes,
      structuralGraphEdges: graph.edges,
      structuralGraphComponents: graph.componentRecords,
      selectedWallCorePlaneIds: Object.freeze([...selectedWallIds]),
      structuralCorePairCandidates: Object.freeze(corePairDiagnostics),
      multiSurfaceCoherenceDiagnostics: Object.freeze(multiSurfaceCoherenceDiagnostics),
      triadCompetitionDiagnostics: Object.freeze(triadCompetitionDiagnostics),
      triadCompetitionGroups: Object.freeze(triadCompetition.groups),
      likelyWalls: freezeSurfaceArray(selectedWalls),
      floorCandidate: selectedFloor,
      ceilingCandidate: selectedCeiling,
      otherSurfaces: freezeSurfaceArray(otherSurfaces),
      unknownSurfaces: freezeSurfaceArray(unknownSurfaces),
      relationships: Object.freeze(relationships),
      stats: {
        inputSurfaceCount: analysisResult.planes.length,
        roleCandidateCount,
        likelyWallCount: selectedWalls.length,
        selectedWallCount: selectedWalls.length,
        alternateWallCount: alternateWallCandidates.length,
        promotedStrongStandaloneWallCount: strongStandaloneWallIds.size,
        selectedFloorCount: selectedFloor ? 1 : 0,
        alternateFloorCount: alternateFloorCandidates.length,
        selectedCeilingCount: selectedCeiling ? 1 : 0,
        alternateCeilingCount: alternateCeilingCandidates.length,
        wallDirectionGroupCount: wallOrientationGroups.length,
        floorCandidate: selectedFloor?.planeId ?? null,
        ceilingCandidate: selectedCeiling?.planeId ?? null,
        otherCount: otherSurfaces.length,
        unknownCount: unknownSurfaces.length,
        selectedWallComponentCount: selectedWallComponents.size,
        structuralGraphNodeCount: graph.nodes.length,
        structuralGraphEdgeCount: graph.edges.length,
        structuralGraphComponentCount: graph.componentRecords.length,
        selectedWallCoreCount: selectedWallIds.size,
        eligibleStrongWallEdgeCount: structuralCorePairCandidates.length,
        multiSurfaceCoherenceCandidateCount: multiSurfaceCoherenceDiagnostics.length,
        selectedMultiSurfaceCoherenceCount: multiSurfaceCoherenceDiagnostics.filter((candidate) => candidate.selected).length,
        locallyAcceptedTriadCount: locallyAcceptedTriads.length,
        finalSelectedTriadCount: triadCompetition.finalSelectedTriadKeys.size,
        triadCompetitionGroupCount: triadCompetition.groups.length,
        sharedAnchorCompetitionGroupCount: triadCompetition.sharedAnchorGroupCount,
        wholeCornerCompetitionGroupCount: triadCompetition.wholeCornerGroupCount,
        triadCompetitionPairCount: triadCompetitionDiagnostics.filter((candidate) => candidate.decision === 'competing').length,
        wholeCornerCompetitionPairCount: triadCompetition.wholeCornerPairCount,
        suppressedTriadCount: triadCompetition.suppressedTriadKeys.size,
      },
      timings: {
        relationshipAnalysisMs: Math.max(0, relationshipFinishedAt - relationshipStartedAt),
        interpretationMs: Math.max(0, interpretationFinishedAt - interpretationStartedAt),
        totalMs: Math.max(0, interpretationFinishedAt - totalStartedAt),
      },
    })
  }
}

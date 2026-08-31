import type {
  PlaneCandidate,
  RoomAnalysisResult,
  RoomStructureInterpretationResult,
  StructuralDirectionGroup,
  StructuralGraphEdge,
  StructuralGraphComponent,
  StructuralGraphNode,
  StructuralParallelLane,
  StructuralRelationshipType,
  StructuralSurfaceCandidate,
  StructuralSurfaceEvidence,
  StructuralSurfaceRelationship,
  StructuralSurfaceRole,
  StructuralSurfaceSelection,
  StructuralSurfaceSelectionEvidence,
} from '../types'

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
  readonly supportIntersectionDistanceMeters: number
  readonly minimumWallOrientationScore: number
  readonly minimumWallRelationshipScore: number
  readonly minimumWallNoRelationshipAreaScore: number
  readonly minimumWallNoRelationshipSupportScore: number
  readonly minimumWallNoRelationshipExtentScore: number
  readonly independentParallelOffsetMeters: number
  readonly independentParallelSupportGapMeters: number
  readonly independentParallelEnvelopeScore: number
  readonly minimumGraphEdgeScore: number
  readonly minimumStrongGraphEdgeScore: number
  readonly selectedWallRedundancyAngleDegrees: number
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
  supportIntersectionDistanceMeters: 0.12,
  minimumWallOrientationScore: 0.68,
  minimumWallRelationshipScore: 0.32,
  minimumWallNoRelationshipAreaScore: 0.7,
  minimumWallNoRelationshipSupportScore: 0.7,
  minimumWallNoRelationshipExtentScore: 0.55,
  independentParallelOffsetMeters: 0.75,
  independentParallelSupportGapMeters: 0.8,
  independentParallelEnvelopeScore: 0.72,
  minimumGraphEdgeScore: 0.42,
  minimumStrongGraphEdgeScore: 0.84,
  selectedWallRedundancyAngleDegrees: 18,
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
  readonly finalSelectionScore: number
}

interface StructuralOrientationGroup {
  readonly role: 'wall' | 'floor' | 'ceiling'
  readonly members: readonly RoleEvaluation[]
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

function createRelationship(
  first: PlaneCandidate,
  second: PlaneCandidate,
  config: StructuralSurfaceInterpretationConfig,
): StructuralSurfaceRelationship {
  const normalAngleDegrees = getNormalAngleDegrees(first, second)
  const planeOffsetDifferenceMeters = getPlaneOffsetDifference(first, second)
  const supportBoundsGapMeters = getSupportBoundsGap(first, second)
  const relationshipType = getRelationshipType(normalAngleDegrees, config)
  // For parallel surfaces, the plane separation is the useful closest-support
  // approximation when their finite bounds overlap. It must not collapse to
  // zero just because their mathematical planes do not intersect.
  const closestSupportDistanceMeters = relationshipType === 'parallel'
    ? Math.max(supportBoundsGapMeters, planeOffsetDifferenceMeters)
    : supportBoundsGapMeters
  const proximityScore = getProximityScore(closestSupportDistanceMeters, config)
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
    ? perpendicularityScore * proximityScore * (isVerticalHorizontal || (firstVertical && secondVertical) ? 1 : 0.5)
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
    // This is a mathematical relationship only. Whether finite measured
    // support is near it is reported separately by supportNearIntersection.
    planeIntersectionPossible: normalAngleDegrees > config.parallelAngleToleranceDegrees,
    supportNearIntersection: relationshipType === 'perpendicular-like' &&
      supportBoundsGapMeters <= config.supportIntersectionDistanceMeters,
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
        ? relationship.perpendicularityScore * relationship.proximityScore * 0.5
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
      finalSelectionScore,
      selectionEvidence: {
        ...evaluation.selectionEvidence,
        competitionScore: finalSelectionScore,
        graphSupportScore,
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

function getWallCoreSeedEdge(
  edges: readonly StructuralGraphEdge[],
): StructuralGraphEdge | null {
  return edges
    .filter((edge) =>
      edge.edgeStrength === 'strong' &&
      (edge.edgeType === 'corner' || edge.edgeType === 'parallel-boundary'))
    .sort((left, right) => right.edgeScore - left.edgeScore ||
      left.firstPlaneId.localeCompare(right.firstPlaneId) ||
      left.secondPlaneId.localeCompare(right.secondPlaneId))[0] ?? null
}

function getStrongWallHorizontalEdge(
  edges: readonly StructuralGraphEdge[],
): StructuralGraphEdge | null {
  return edges
    .filter((edge) => edge.edgeType === 'wall-horizontal' && edge.edgeStrength === 'strong')
    .sort((left, right) => right.edgeScore - left.edgeScore ||
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
  ): RoomStructureInterpretationResult {
    const totalStartedAt = getTimestamp()
    const relationshipStartedAt = getTimestamp()
    const relationships: StructuralSurfaceRelationship[] = []
    for (let firstIndex = 0; firstIndex < analysisResult.planes.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < analysisResult.planes.length; secondIndex += 1) {
        relationships.push(createRelationship(
          analysisResult.planes[firstIndex],
          analysisResult.planes[secondIndex],
          this.config,
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
    const evaluationByPlaneId = new Map(evaluations.map((evaluation) => [evaluation.context.plane.id, evaluation]))
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
    const seedEdge = getWallCoreSeedEdge(graph.edges)
    const seedEvaluations = seedEdge
      ? [evaluationByPlaneId.get(seedEdge.firstPlaneId), evaluationByPlaneId.get(seedEdge.secondPlaneId)]
        .filter((evaluation): evaluation is RoleEvaluation => Boolean(evaluation && evaluation.role === 'wall' && isEnvelopeEligible(evaluation, this.config)))
      : []

    if (seedEdge && seedEvaluations.length === 2) {
      for (const evaluation of seedEvaluations) {
        addSelectedWall(
          evaluation,
          seedEdge.edgeType === 'parallel-boundary'
            ? 'distinct parallel boundary supported by strong graph core'
            : 'strong corner edge; introduces a coherent wall direction',
        )
      }
    } else {
      const wallHorizontalSeed = getStrongWallHorizontalEdge(graph.edges)
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

    const surfaces = evaluations.map((evaluation) => {
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
      },
      timings: {
        relationshipAnalysisMs: Math.max(0, relationshipFinishedAt - relationshipStartedAt),
        interpretationMs: Math.max(0, interpretationFinishedAt - interpretationStartedAt),
        totalMs: Math.max(0, interpretationFinishedAt - totalStartedAt),
      },
    })
  }
}

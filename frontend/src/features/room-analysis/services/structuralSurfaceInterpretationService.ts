import type {
  PlaneCandidate,
  RoomAnalysisResult,
  RoomStructureInterpretationResult,
  StructuralDirectionGroup,
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
    selectionEvidence: {
      roleConfidence,
      orientationScore,
      sizeScore: context.areaScore,
      supportScore: context.supportScore,
      heightScore,
      relationshipScore: context.relationshipScore,
      competitionScore: envelopeSelectionScore,
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
  return evaluation.envelopeSelectionScore
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
    const evaluations = evaluateContexts(contexts, this.config)
    const wallOrientationGroups = buildOrientationGroups(evaluations, 'wall', this.config)
    const floorOrientationGroups = buildOrientationGroups(evaluations, 'floor', this.config)
    const ceilingOrientationGroups = buildOrientationGroups(evaluations, 'ceiling', this.config)
    const selectedWallIds = new Set<string>()
    const alternateWallIds = new Set<string>()
    const wallSelectionReasons = new Map<string, string>()
    const selectedWallIdsByGroup = new Map<StructuralOrientationGroup, string[]>()

    for (const group of wallOrientationGroups) {
      const eligibleMembers = group.members
        .filter((evaluation) => isEnvelopeEligible(evaluation, this.config))
        .sort((left, right) => getRoleSelectionScore(right) - getRoleSelectionScore(left))
      const primary = eligibleMembers[0]
      const groupSelectedIds: string[] = []
      if (primary) {
        selectedWallIds.add(primary.context.plane.id)
        groupSelectedIds.push(primary.context.plane.id)
        wallSelectionReasons.set(primary.context.plane.id, getSelectionReason(primary, 'selected', true, this.config))
        for (const candidate of group.members) {
          if (candidate === primary) {
            continue
          }
          const independent = isEnvelopeEligible(candidate, this.config) &&
            isIndependentParallelWall(primary, candidate, this.config)
          if (independent) {
            selectedWallIds.add(candidate.context.plane.id)
            groupSelectedIds.push(candidate.context.plane.id)
            wallSelectionReasons.set(candidate.context.plane.id, 'selected as independently supported parallel room-envelope surface')
          } else {
            alternateWallIds.add(candidate.context.plane.id)
            wallSelectionReasons.set(candidate.context.plane.id, getSelectionReason(
              candidate,
              'alternate',
              Boolean(primary),
              this.config,
            ))
          }
        }
      } else {
        for (const candidate of group.members) {
          alternateWallIds.add(candidate.context.plane.id)
          wallSelectionReasons.set(candidate.context.plane.id, getSelectionReason(candidate, 'alternate', false, this.config))
        }
      }
      selectedWallIdsByGroup.set(group, groupSelectedIds)
    }

    const floorEligible = floorOrientationGroups.flatMap((group) => group.members)
      .filter((evaluation) => isEnvelopeEligible(evaluation, this.config))
      .sort((left, right) => getRoleSelectionScore(right) - getRoleSelectionScore(left))
    const ceilingEligible = ceilingOrientationGroups.flatMap((group) => group.members)
      .filter((evaluation) => isEnvelopeEligible(evaluation, this.config))
      .sort((left, right) => getRoleSelectionScore(right) - getRoleSelectionScore(left))
    const selectedFloorEvaluation = floorEligible[0]
    const selectedCeilingEvaluation = ceilingEligible[0]
    const selectedFloorId = selectedFloorEvaluation?.context.plane.id ?? null
    const selectedCeilingId = selectedCeilingEvaluation?.context.plane.id ?? null
    const alternateFloorIds = new Set(floorOrientationGroups.flatMap((group) =>
      group.members.filter((member) => member.context.plane.id !== selectedFloorId).map((member) => member.context.plane.id)))
    const alternateCeilingIds = new Set(ceilingOrientationGroups.flatMap((group) =>
      group.members.filter((member) => member.context.plane.id !== selectedCeilingId).map((member) => member.context.plane.id)))

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
        : getSelectionReason(evaluation, selection, evaluation.role === 'floor' || evaluation.role === 'ceiling', this.config)
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
      ...wallOrientationGroups.map((group, index) => createDirectionGroup(
        `wall-orientation-${index + 1}`,
        group,
        selectedWallIdsByGroup.get(group) ?? [],
      )),
      ...floorOrientationGroups.map((group, index) => createDirectionGroup(
        `floor-orientation-${index + 1}`,
        group,
        group.members.some((member) => member.context.plane.id === selectedFloorId) ? [selectedFloorId as string] : [],
      )),
      ...ceilingOrientationGroups.map((group, index) => createDirectionGroup(
        `ceiling-orientation-${index + 1}`,
        group,
        group.members.some((member) => member.context.plane.id === selectedCeilingId) ? [selectedCeilingId as string] : [],
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
      },
      timings: {
        relationshipAnalysisMs: Math.max(0, relationshipFinishedAt - relationshipStartedAt),
        interpretationMs: Math.max(0, interpretationFinishedAt - interpretationStartedAt),
        totalMs: Math.max(0, interpretationFinishedAt - totalStartedAt),
      },
    })
  }
}

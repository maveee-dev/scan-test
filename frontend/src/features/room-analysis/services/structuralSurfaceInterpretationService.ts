import type {
  PlaneCandidate,
  RoomAnalysisResult,
  RoomStructureInterpretationResult,
  StructuralDirectionGroup,
  StructuralRelationshipType,
  StructuralSurfaceCandidate,
  StructuralSurfaceEvidence,
  StructuralSurfaceRelationship,
  StructuralSurfaceRole,
  StructuralSurfaceSelection,
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
  readonly sameRolePlaneOffsetToleranceMeters: number
  readonly sameRoleMaximumOffsetSpanMeters: number
  readonly sameRoleSupportGapMeters: number
  readonly supportIntersectionDistanceMeters: number
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
  sameRolePlaneOffsetToleranceMeters: 0.22,
  sameRoleMaximumOffsetSpanMeters: 0.36,
  sameRoleSupportGapMeters: 0.55,
  supportIntersectionDistanceMeters: 0.12,
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
}

interface RoleCompetitionGroup {
  readonly role: 'wall' | 'floor' | 'ceiling'
  readonly members: readonly RoleEvaluation[]
  readonly selected: RoleEvaluation
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

function createSurfaceCandidate(
  evaluation: RoleEvaluation,
  selection: StructuralSurfaceSelection,
): StructuralSurfaceCandidate {
  const context = evaluation.context
  return {
    planeId: context.plane.id,
    role: evaluation.role,
    selection,
    confidence: clamp(evaluation.confidence, 0, 1),
    evidence: createEvidence(context, evaluation.heightScore),
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

function evaluateContexts(
  contexts: readonly PlaneContext[],
  config: StructuralSurfaceInterpretationConfig,
): RoleEvaluation[] {
  return contexts.map((context) => {
    const isHorizontal = context.horizontalOrientationScore >= config.minimumHorizontalOrientationScore
    if (context.wallConfidence >= config.minimumWallConfidence && context.orientationScore >= 0.5) {
      return { context, role: 'wall', confidence: context.wallConfidence, heightScore: context.verticalExtentScore }
    }
    if (isHorizontal) {
      const bestHorizontalConfidence = Math.max(context.floorConfidence, context.ceilingConfidence)
      const heightEvidenceDifference = Math.abs(context.floorHeightScore - context.ceilingHeightScore)
      if (bestHorizontalConfidence >= config.minimumHorizontalConfidence &&
        heightEvidenceDifference >= config.minimumHorizontalHeightEvidenceDifference) {
        if (context.floorConfidence >= context.ceilingConfidence) {
          return { context, role: 'floor', confidence: context.floorConfidence, heightScore: context.floorHeightScore }
        }
        return { context, role: 'ceiling', confidence: context.ceilingConfidence, heightScore: context.ceilingHeightScore }
      }
    }

    const hasMeaningfulEvidence = context.areaScore >= 0.35 && context.supportScore >= 0.35
    return {
      context,
      role: hasMeaningfulEvidence ? 'other' : 'unknown',
      confidence: hasMeaningfulEvidence
        ? Math.max(context.areaScore, context.supportScore) * 0.6
        : 1 - Math.max(context.wallConfidence, context.floorConfidence, context.ceilingConfidence) * 0.5,
      heightScore: isHorizontal
        ? Math.max(context.floorHeightScore, context.ceilingHeightScore)
        : context.verticalExtentScore,
    }
  })
}

function getRoleSelectionScore(evaluation: RoleEvaluation): number {
  const context = evaluation.context
  const fitQuality = 1 - clamp(context.plane.rmsError / MAXIMUM_RMS_FOR_QUALITY_METERS, 0, 1)
  const extentScore = evaluation.role === 'wall'
    ? context.verticalExtentScore
    : evaluation.heightScore
  // Support is already normalized in the context. Keep the final owned
  // support metric prominent without allowing a large plane to erase fit or
  // structural evidence.
  return clamp(
    evaluation.confidence * 0.32 +
      context.supportScore * 0.28 +
      context.areaScore * 0.2 +
      extentScore * 0.1 +
      fitQuality * 0.1,
    0,
    1,
  )
}

function getPlaneRoleOffset(reference: PlaneCandidate, candidate: PlaneCandidate): number {
  return getAlignedPlaneConstant(reference.normal, candidate)
}

function canJoinRoleGroup(
  first: RoleEvaluation,
  second: RoleEvaluation,
  group: readonly RoleEvaluation[],
  config: StructuralSurfaceInterpretationConfig,
): boolean {
  const normalAngle = getNormalAngleDegrees(first.context.plane, second.context.plane)
  if (normalAngle > config.wallDirectionGroupingAngleDegrees) {
    return false
  }
  if (getPlaneOffsetDifference(first.context.plane, second.context.plane) > config.sameRolePlaneOffsetToleranceMeters) {
    return false
  }
  if (getSupportBoundsGap(first.context.plane, second.context.plane) > config.sameRoleSupportGapMeters) {
    return false
  }
  const reference = group[0]?.context.plane ?? first.context.plane
  const offsets = [...group, first, second].map((member) => getPlaneRoleOffset(reference, member.context.plane))
  return Math.max(...offsets) - Math.min(...offsets) <= config.sameRoleMaximumOffsetSpanMeters
}

function buildRoleCompetitionGroups(
  evaluations: readonly RoleEvaluation[],
  role: 'wall' | 'floor' | 'ceiling',
  config: StructuralSurfaceInterpretationConfig,
): RoleCompetitionGroup[] {
  const members = evaluations
    .filter((evaluation) => evaluation.role === role)
    .sort((left, right) => getRoleSelectionScore(right) - getRoleSelectionScore(left))
  const groups: RoleEvaluation[][] = []

  for (const evaluation of members) {
    const matchingGroupIndexes = groups
      .map((group, index) => group.some((member) => canJoinRoleGroup(member, evaluation, group, config)) ? index : -1)
      .filter((index) => index >= 0)
    if (matchingGroupIndexes.length === 0) {
      groups.push([evaluation])
      continue
    }

    const firstIndex = matchingGroupIndexes[0]
    groups[firstIndex].push(evaluation)
    // A candidate can bridge two nearby fragments. Merge the groups only if
    // the complete offset span remains bounded.
    for (let index = matchingGroupIndexes.length - 1; index >= 1; index -= 1) {
      const groupIndex = matchingGroupIndexes[index]
      const merged = [...groups[firstIndex], ...groups[groupIndex]]
      const reference = merged[0].context.plane
      const offsets = merged.map((member) => getPlaneRoleOffset(reference, member.context.plane))
      if (Math.max(...offsets) - Math.min(...offsets) <= config.sameRoleMaximumOffsetSpanMeters) {
        groups[firstIndex] = merged
        groups.splice(groupIndex, 1)
      }
    }
  }

  return groups.map((group) => ({
    role,
    members: Object.freeze(group),
    selected: group.reduce((best, current) =>
      getRoleSelectionScore(current) > getRoleSelectionScore(best) ? current : best),
  }))
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

function createDirectionGroup(
  id: string,
  group: RoleCompetitionGroup,
  selectedPlaneId: string | null,
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
    selectedPlaneId,
    representativeNormal: {
      x: weightedNormal.x / length,
      y: weightedNormal.y / length,
      z: weightedNormal.z / length,
    },
    normalSpreadDegrees: getNormalSpread(group.members),
    planeOffsetSpanMeters: Math.max(...offsets) - Math.min(...offsets),
  }
}

function chooseGlobalHorizontalWinner(groups: readonly RoleCompetitionGroup[]): RoleEvaluation | null {
  return groups.reduce<RoleEvaluation | null>((best, group) => {
    if (!best || getRoleSelectionScore(group.selected) > getRoleSelectionScore(best)) {
      return group.selected
    }
    return best
  }, null)
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
    const interpretationStartedAt = getTimestamp()
    const contexts = createPlaneContexts(
      analysisResult,
      relationships,
      referenceSpaceType,
      this.config,
    )
    const evaluations = evaluateContexts(contexts, this.config)
    const wallGroups = buildRoleCompetitionGroups(evaluations, 'wall', this.config)
    const floorGroups = buildRoleCompetitionGroups(evaluations, 'floor', this.config)
    const ceilingGroups = buildRoleCompetitionGroups(evaluations, 'ceiling', this.config)
    const selectedFloorEvaluation = chooseGlobalHorizontalWinner(floorGroups)
    const selectedCeilingEvaluation = chooseGlobalHorizontalWinner(ceilingGroups)
    const selectedWallIds = new Set(wallGroups.map((group) => group.selected.context.plane.id))
    const alternateWallIds = new Set(wallGroups.flatMap((group) =>
      group.members.filter((member) => member !== group.selected).map((member) => member.context.plane.id)))
    const selectedFloorId = selectedFloorEvaluation?.context.plane.id ?? null
    const selectedCeilingId = selectedCeilingEvaluation?.context.plane.id ?? null
    const alternateFloorIds = new Set(floorGroups.flatMap((group) =>
      group.members.filter((member) => member.context.plane.id !== selectedFloorId).map((member) => member.context.plane.id)))
    const alternateCeilingIds = new Set(ceilingGroups.flatMap((group) =>
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

    const surfaces = evaluations.map((evaluation) => createSurfaceCandidate(evaluation, getSelection(evaluation)))
    const selectedWalls = surfaces.filter((surface) => surface.role === 'wall' && surface.selection === 'selected')
    const selectedFloor = surfaces.find((surface) => surface.planeId === selectedFloorId) ?? null
    const selectedCeiling = surfaces.find((surface) => surface.planeId === selectedCeilingId) ?? null
    const alternateWallCandidates = surfaces.filter((surface) => surface.role === 'wall' && surface.selection === 'alternate')
    const alternateFloorCandidates = surfaces.filter((surface) => surface.role === 'floor' && surface.selection === 'alternate')
    const alternateCeilingCandidates = surfaces.filter((surface) => surface.role === 'ceiling' && surface.selection === 'alternate')
    const otherSurfaces = surfaces.filter((surface) => surface.role === 'other')
    const unknownSurfaces = surfaces.filter((surface) => surface.role === 'unknown')
    const directionGroups = [
      ...wallGroups.map((group, index) => createDirectionGroup(`wall-direction-${index + 1}`, group, group.selected.context.plane.id)),
      ...floorGroups.map((group, index) => createDirectionGroup(`floor-group-${index + 1}`, group, group.selected.context.plane.id === selectedFloorId ? selectedFloorId : null)),
      ...ceilingGroups.map((group, index) => createDirectionGroup(`ceiling-group-${index + 1}`, group, group.selected.context.plane.id === selectedCeilingId ? selectedCeilingId : null)),
    ]
    const interpretationFinishedAt = getTimestamp()
    const roleCandidateCount = surfaces.filter((surface) => surface.role === 'wall' || surface.role === 'floor' || surface.role === 'ceiling').length

    return Object.freeze({
      sourceScanId: analysisResult.sourceScanId,
      referenceSpaceType,
      surfaces: freezeSurfaceArray(surfaces),
      selectedWalls: freezeSurfaceArray(selectedWalls),
      selectedFloor,
      selectedCeiling,
      alternateWallCandidates: freezeSurfaceArray(alternateWallCandidates),
      alternateFloorCandidates: freezeSurfaceArray(alternateFloorCandidates),
      alternateCeilingCandidates: freezeSurfaceArray(alternateCeilingCandidates),
      directionGroups: Object.freeze(directionGroups),
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
        wallDirectionGroupCount: wallGroups.length,
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

import type {
  PlaneCandidate,
  RoomAnalysisResult,
  RoomStructureInterpretationResult,
  StructuralRelationshipType,
  StructuralSurfaceCandidate,
  StructuralSurfaceEvidence,
  StructuralSurfaceRelationship,
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
}

const WORLD_UP = { x: 0, y: 1, z: 0 }
const MINIMUM_RANGE_METERS = 0.001

interface PlaneContext {
  readonly plane: PlaneCandidate
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

function getPlaneOffsetDifference(first: PlaneCandidate, second: PlaneCandidate): number {
  let secondNormal = second.normal
  let secondConstant = second.planeConstant
  if (dot(first.normal, secondNormal) < 0) {
    secondNormal = {
      x: -secondNormal.x,
      y: -secondNormal.y,
      z: -secondNormal.z,
    }
    secondConstant = -secondConstant
  }
  return Math.abs(first.planeConstant - secondConstant)
}

function getAxisGap(
  firstMinimum: number,
  firstMaximum: number,
  secondMinimum: number,
  secondMaximum: number,
): number {
  return Math.max(0, firstMinimum - secondMaximum, secondMinimum - firstMaximum)
}

function getSupportProximity(first: PlaneCandidate, second: PlaneCandidate): number {
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
  const supportProximityMeters = getSupportProximity(first, second)
  const proximityScore = getProximityScore(supportProximityMeters, config)
  const relationshipType = getRelationshipType(normalAngleDegrees, config)
  const firstVertical = getOrientationScores(first).orientationScore >= 0.5
  const secondVertical = getOrientationScores(second).orientationScore >= 0.5
  const firstHorizontal = getOrientationScores(first).horizontalOrientationScore >= 0.5
  const secondHorizontal = getOrientationScores(second).horizontalOrientationScore >= 0.5
  const isVerticalHorizontal = (firstVertical && secondHorizontal) || (firstHorizontal && secondVertical)
  const perpendicularityScore = 1 - clamp(
    Math.abs(normalAngleDegrees - 90) / config.perpendicularAngleToleranceDegrees,
    0,
    1,
  )
  const verticalHorizontalEvidence = relationshipType === 'perpendicular-like'
    ? perpendicularityScore * proximityScore * (isVerticalHorizontal || (firstVertical && secondVertical) ? 1 : 0.5)
    : 0

  return {
    firstPlaneId: first.id,
    secondPlaneId: second.id,
    normalAngleDegrees,
    planeOffsetDifferenceMeters: getPlaneOffsetDifference(first, second),
    centroidDistanceMeters: distance(first.centroid, second.centroid),
    centroidHeightDifferenceMeters: Math.abs(first.centroid.y - second.centroid.y),
    supportProximityMeters,
    proximityScore,
    relationshipType,
    planeIntersectionPossible: relationshipType === 'perpendicular-like' &&
      supportProximityMeters <= config.relationshipDistanceMeters,
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
        ? relationship.proximityScore * 0.5
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
    floorScore = Math.max(floorScore, nearBottom * relationship.proximityScore)
    ceilingScore = Math.max(ceilingScore, nearTop * relationship.proximityScore)
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
  // Relative height only becomes useful when a candidate is clearly near one
  // end of the observed vertical range. A middle-height horizontal surface is
  // intentionally ambiguous instead of being invented as a floor or ceiling.
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

function createPlaneContexts(
  planes: readonly PlaneCandidate[],
  relationships: readonly StructuralSurfaceRelationship[],
  referenceSpaceType: 'local-floor' | 'local',
  config: StructuralSurfaceInterpretationConfig,
): PlaneContext[] {
  const scene = getSceneVerticalRange(planes)
  const maximumArea = Math.max(...planes.map((plane) => plane.areaEstimate), MINIMUM_RANGE_METERS)
  const maximumSupport = Math.max(...planes.map((plane) => plane.supportPointCount), 1)

  return planes.map((plane) => {
    const orientation = getOrientationScores(plane)
    const height = getHeightScores(plane, planes, relationships, referenceSpaceType, scene, config)
    const areaScore = Math.sqrt(clamp(plane.areaEstimate / maximumArea, 0, 1))
    const supportScore = Math.sqrt(clamp(plane.supportPointCount / maximumSupport, 0, 1))
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
  context: PlaneContext,
  role: StructuralSurfaceCandidate['role'],
  confidence: number,
  heightScore: number,
): StructuralSurfaceCandidate {
  return {
    planeId: context.plane.id,
    role,
    confidence: clamp(confidence, 0, 1),
    evidence: createEvidence(context, heightScore),
    centroid: copyPoint(context.plane.centroid),
    centroidHeight: context.plane.centroid.y,
    occupiedArea: context.plane.areaEstimate,
    ownedSupport: context.plane.supportPointCount,
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

function interpretContexts(
  contexts: readonly PlaneContext[],
  config: StructuralSurfaceInterpretationConfig,
): StructuralSurfaceCandidate[] {
  return contexts.map((context) => {
    const isHorizontal = context.horizontalOrientationScore >= config.minimumHorizontalOrientationScore
    if (context.wallConfidence >= config.minimumWallConfidence && context.orientationScore >= 0.5) {
      return createSurfaceCandidate(context, 'wall', context.wallConfidence, context.verticalExtentScore)
    }
    if (isHorizontal) {
      const bestHorizontalConfidence = Math.max(context.floorConfidence, context.ceilingConfidence)
      const heightEvidenceDifference = Math.abs(context.floorHeightScore - context.ceilingHeightScore)
      if (bestHorizontalConfidence >= config.minimumHorizontalConfidence &&
        heightEvidenceDifference >= config.minimumHorizontalHeightEvidenceDifference) {
        if (context.floorConfidence >= context.ceilingConfidence) {
          return createSurfaceCandidate(context, 'floor', context.floorConfidence, context.floorHeightScore)
        }
        return createSurfaceCandidate(context, 'ceiling', context.ceilingConfidence, context.ceilingHeightScore)
      }
    }

    const hasMeaningfulEvidence = context.areaScore >= 0.35 && context.supportScore >= 0.35
    return createSurfaceCandidate(
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

function chooseCandidate(
  candidates: readonly StructuralSurfaceCandidate[],
  role: 'floor' | 'ceiling',
): StructuralSurfaceCandidate | null {
  return candidates
    .filter((candidate) => candidate.role === role)
    .sort((left, right) => right.confidence - left.confidence || right.occupiedArea - left.occupiedArea)[0] ?? null
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
      analysisResult.planes,
      relationships,
      referenceSpaceType,
      this.config,
    )
    const surfaces = interpretContexts(contexts, this.config)
    const likelyWalls = surfaces.filter((surface) => surface.role === 'wall')
    const floorCandidate = chooseCandidate(surfaces, 'floor')
    const ceilingCandidate = chooseCandidate(surfaces, 'ceiling')
    const otherSurfaces = surfaces.filter((surface) => surface.role === 'other')
    const unknownSurfaces = surfaces.filter((surface) => surface.role === 'unknown')
    const interpretationFinishedAt = getTimestamp()

    return Object.freeze({
      sourceScanId: analysisResult.sourceScanId,
      referenceSpaceType,
      surfaces: Object.freeze(surfaces),
      likelyWalls: Object.freeze(likelyWalls),
      floorCandidate,
      ceilingCandidate,
      otherSurfaces: Object.freeze(otherSurfaces),
      unknownSurfaces: Object.freeze(unknownSurfaces),
      relationships: Object.freeze(relationships),
      stats: {
        inputSurfaceCount: analysisResult.planes.length,
        likelyWallCount: likelyWalls.length,
        floorCandidate: floorCandidate?.planeId ?? null,
        ceilingCandidate: ceilingCandidate?.planeId ?? null,
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

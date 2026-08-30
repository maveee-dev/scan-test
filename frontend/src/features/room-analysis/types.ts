import type { SpatialPoint } from '../scanner/types'

export type PlaneOrientationCategory = 'horizontal-like' | 'vertical-like' | 'other'

export interface PlaneLocalBounds {
  readonly minU: number
  readonly maxU: number
  readonly minV: number
  readonly maxV: number
}

export interface PlaneCandidate {
  readonly id: string
  readonly normal: SpatialPoint
  readonly centroid: SpatialPoint
  readonly planeConstant: number
  readonly supportPointCount: number
  /** Occupied projected support area, not the area of the displayed bounds rectangle. */
  readonly areaEstimate: number
  readonly projectedBoundsAreaEstimate: number
  readonly rmsError: number
  readonly bounds: {
    readonly min: SpatialPoint
    readonly max: SpatialPoint
  }
  readonly localBounds: PlaneLocalBounds
  readonly tangentU: SpatialPoint
  readonly tangentV: SpatialPoint
  readonly orientationAngleDegrees: number
  readonly orientationCategory: PlaneOrientationCategory
  readonly confidence: number
}

export interface RoomAnalysisTimings {
  readonly inputPreparationMs: number
  readonly downsamplingMs: number
  readonly initialExtractionMs: number
  readonly consolidationMs: number
  readonly ransacMs: number
  readonly refinementMs: number
  readonly globalReassemblyMs: number
  readonly dominantExpansionMs: number
  readonly ownershipMs: number
  readonly totalMs: number
}

export interface PlaneRelationshipDiagnostic {
  readonly firstPlaneId: string
  readonly secondPlaneId: string
  readonly angularDifferenceDegrees: number
  readonly planeOffsetDifferenceMeters: number
}

export interface RoomAnalysisResult {
  readonly sourceScanId: string
  readonly planes: readonly PlaneCandidate[]
  readonly stats: {
    readonly inputPoints: number
    readonly coverageGeometryPoints: number
    readonly finalizedFusedSurfelCount: number
    readonly filteredPoints: number
    readonly analysisFilteredSurfelCount: number
    readonly downsampledPoints: number
    readonly analysisDownsampledSurfelCount: number
    readonly provisionalPlaneCount: number
    readonly planeCount: number
    readonly assignedPoints: number
    readonly unassignedPoints: number
    readonly assignedPercentage: number
    readonly rejectedPoints: number
    readonly candidatePairsTested: number
    readonly highOverlapCandidatePairs: number
    readonly candidatesMerged: number
    readonly duplicateCandidatesSuppressed: number
    readonly averageSupportOverlap: number
    readonly planeParameterClusterCount: number
    readonly globalPlanesAttempted: number
    readonly globalPlanesAccepted: number
    readonly globalPointsAbsorbed: number
    readonly globalFragmentsAbsorbed: number
    readonly globalExpansionPasses: number
    readonly globalPlaneRefits: number
    readonly globalResidualRejects: number
    readonly globalNormalRejects: number
    readonly globalSupportRejects: number
    readonly ransacHypothesesTested: number
    readonly degenerateHypothesesRejected: number
    readonly bestHypothesisInitialInliers: number
    readonly bestHypothesisWeightedSupport: number
    readonly bestHypothesisInitialRms: number
    readonly refinedSupportPointCount: number
    readonly refinedRmsError: number
    readonly refinedOccupiedArea: number
    readonly acceptedDominantPlaneCount: number
    readonly largestPlaneSupportPointCount: number
    readonly largestPlaneOccupiedArea: number
    readonly largestPlaneRmsError: number
    readonly secondLargestPlaneSupportPointCount: number
    readonly secondLargestPlaneOccupiedArea: number
    readonly secondLargestPlaneRmsError: number
    readonly largestPlaneSupportPercentage: number
    readonly secondLargestPlaneSupportPercentage: number
    readonly topThreePlaneSupportPercentage: number
    readonly dominantSeedsAttempted: number
    readonly dominantPlanesAccepted: number
    readonly pointsAbsorbedDuringExpansion: number
    readonly fragmentsAbsorbedDuringExpansion: number
    readonly expansionPasses: number
    readonly planeRefits: number
    readonly expansionResidualRejects: number
    readonly expansionNormalRejects: number
    readonly expansionConnectivityRejects: number
  }
  readonly planeRelationships: readonly PlaneRelationshipDiagnostic[]
  readonly ransacIterationsPerPlane: readonly number[]
  readonly timings: RoomAnalysisTimings
}

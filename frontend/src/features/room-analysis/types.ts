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
  readonly surfaceFamilyConsolidationMs: number
  readonly surfaceConsensusMs: number
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

export interface SurfaceFamilyDiagnostic {
  readonly familyId: string
  readonly finalPlaneId: string
  readonly memberPlaneIds: readonly string[]
  readonly representativePlaneId: string
  readonly normalSpreadDegrees: number
  readonly minimumPlaneOffset: number
  readonly maximumPlaneOffset: number
  readonly clusterThicknessMeters: number
  readonly projectedSupportOverlapPercentage: number
  readonly directRepresentativeSupport: number
  readonly absorbedDuplicateLayerSupport: number
  readonly combinedPhysicalSupport: number
  readonly combinedSupportPercentage: number
  readonly finalOwnedAreaEstimate: number
}

export interface SurfaceConsensusPairDiagnostic {
  readonly firstFamilyId: string
  readonly secondFamilyId: string
  readonly angularDifferenceDegrees: number
  readonly planeOffsetDifferenceMeters: number
  readonly intersectionCells: number
  readonly unionCells: number
  readonly projectedIoU: number
  readonly firstCoverageBySecondPercentage: number
  readonly secondCoverageByFirstPercentage: number
  readonly firstOccupiedArea: number
  readonly secondOccupiedArea: number
  readonly separationMeters: number
  readonly merged: boolean
  readonly rejectReason: string | null
}

export type StructuralSurfaceRole = 'wall' | 'floor' | 'ceiling' | 'other' | 'unknown'

export type StructuralRelationshipType = 'parallel' | 'perpendicular-like' | 'other'

export type StructuralSurfaceSelection = 'selected' | 'alternate' | 'unselected'

export interface StructuralSurfaceEvidence {
  readonly orientationScore: number
  readonly sizeScore: number
  readonly supportScore: number
  readonly heightScore: number
  readonly relationshipScore: number
  readonly boundaryScore?: number
}

export interface StructuralSurfaceSelectionEvidence {
  readonly roleConfidence: number
  readonly orientationScore: number
  readonly sizeScore: number
  readonly supportScore: number
  readonly heightScore: number
  readonly relationshipScore: number
  readonly competitionScore: number
  readonly graphSupportScore: number
  readonly multiSurfaceCoherenceScore: number
}

export interface StructuralSurfaceCandidate {
  readonly planeId: string
  readonly role: StructuralSurfaceRole
  /** Role evidence is kept separate from whether this surface won room-envelope selection. */
  readonly selection: StructuralSurfaceSelection
  /** Confidence that the geometry fits the assigned role, independent of selection. */
  readonly roleConfidence: number
  readonly confidence: number
  /** Confidence that this candidate belongs in the room envelope. */
  readonly envelopeSelectionScore: number
  /** Support supplied by selected structural relationships. */
  readonly graphSupportScore: number
  /** Bounded wall/horizontal multi-surface coherence evidence. */
  readonly multiSurfaceCoherenceScore: number
  /** Final deterministic score used by structural subset selection. */
  readonly finalSelectionScore: number
  readonly evidence: StructuralSurfaceEvidence
  readonly selectionEvidence: StructuralSurfaceSelectionEvidence
  readonly selectionReason: string
  readonly centroid: SpatialPoint
  readonly centroidHeight: number
  readonly occupiedArea: number
  /** Exclusive support copied from the final physical-surface consensus. */
  readonly finalOwnedSupport: number
  /** @deprecated Use finalOwnedSupport; retained as a compatibility alias. */
  readonly ownedSupport: number
  readonly normal: SpatialPoint
  readonly planeConstant: number
  readonly bounds: {
    readonly min: SpatialPoint
    readonly max: SpatialPoint
  }
  readonly localBounds: PlaneLocalBounds
  readonly tangentU: SpatialPoint
  readonly tangentV: SpatialPoint
}

export interface StructuralSurfaceRelationship {
  readonly firstPlaneId: string
  readonly secondPlaneId: string
  readonly normalAngleDegrees: number
  readonly planeOffsetDifferenceMeters: number
  readonly centroidDistanceMeters: number
  readonly centroidHeightDifferenceMeters: number
  /** Gap between the finite world-space support bounds. */
  readonly supportBoundsGapMeters: number
  /** Bounded closest-support approximation; for parallel planes it includes plane separation. */
  readonly closestSupportDistanceMeters: number
  /** @deprecated Use closestSupportDistanceMeters. */
  readonly supportProximityMeters: number
  readonly proximityScore: number
  readonly perpendicularityScore: number
  readonly parallelismScore: number
  readonly relationshipType: StructuralRelationshipType
  readonly planeIntersectionPossible: boolean
  /** Compatibility alias for supportsNearTheoreticalIntersection. */
  readonly supportNearIntersection: boolean
  /** Actual finalized support counts within the theoretical line-distance gate. */
  readonly nearTheoreticalLineSupportCountA: number
  readonly nearTheoreticalLineSupportCountB: number
  readonly nearTheoreticalLineSupportDistanceA: number | null
  readonly nearTheoreticalLineSupportDistanceB: number | null
  /** True only when both owned support sets reach the theoretical line. */
  readonly supportsNearTheoreticalIntersection: boolean
  readonly intersectionSupportScore: number
  /** Actual support distance to the theoretical intersection line, when available. */
  readonly closestSurfaceSupportDistanceMeters: number | null
  readonly verticalHorizontalEvidence: number
}

export interface StructuralDirectionGroup {
  readonly id: string
  readonly role: 'wall' | 'floor' | 'ceiling'
  readonly planeIds: readonly string[]
  readonly selectedPlaneId: string | null
  readonly selectedPlaneIds: readonly string[]
  readonly representativeNormal: SpatialPoint
  readonly normalSpreadDegrees: number
  readonly planeOffsetSpanMeters: number
}

export interface StructuralParallelLane {
  readonly id: string
  readonly role: 'wall' | 'floor' | 'ceiling'
  readonly orientationGroupId: string
  readonly planeIds: readonly string[]
  readonly representativePlaneId: string
  readonly planeOffsetSpanMeters: number
}

export interface StructuralGraphNode {
  readonly planeId: string
  readonly role: 'wall' | 'floor' | 'ceiling'
  readonly orientationGroupId: string | null
  readonly roleConfidence: number
  readonly envelopeSelectionScore: number
  readonly ownedSupport: number
  readonly occupiedArea: number
  readonly normal: SpatialPoint
  readonly planeConstant: number
}

export interface StructuralGraphEdge {
  readonly firstPlaneId: string
  readonly secondPlaneId: string
  readonly edgeType: 'corner' | 'wall-horizontal' | 'parallel-boundary'
  readonly edgeStrength: 'strong' | 'supporting'
  readonly normalAngleDegrees: number
  readonly perpendicularityScore: number
  readonly closestSupportDistanceMeters: number
  readonly supportNearIntersection: boolean
  readonly intersectionSupportScore: number
  readonly verticalOverlapScore: number
  readonly proximityScore: number
  readonly edgeScore: number
}

export interface StructuralGraphComponent {
  readonly id: string
  readonly planeIds: readonly string[]
  readonly edgeCount: number
}

export interface StructuralCorePairCandidate {
  readonly firstPlaneId: string
  readonly secondPlaneId: string
  readonly edgeStrength: 'strong' | 'supporting'
  readonly edgeScore: number
  readonly firstNodeQuality: number
  readonly secondNodeQuality: number
  readonly jointCoreScore: number
  readonly selected: boolean
}

export interface StructuralPairSupportEvidence {
  readonly intersectionSupportScore: number
  readonly nearLineSupportCountA: number
  readonly nearLineSupportCountB: number
  readonly closestSupportDistanceMeters: number | null
  readonly supportsNearTheoreticalIntersection: boolean
}

export type StructuralTriadGateStatus = 'pass' | 'fail'

export interface StructuralMultiSurfaceCoherenceDiagnostic {
  readonly candidatePlaneId: string
  readonly existingWallPlaneId: string
  readonly horizontalPlaneId: string
  readonly wallWallEdgeScore: number
  readonly wallWallAngleDegrees: number
  readonly wallWallSupport: StructuralPairSupportEvidence
  readonly candidateHorizontalSupport: StructuralPairSupportEvidence
  readonly existingHorizontalSupport: StructuralPairSupportEvidence | null
  readonly candidateHorizontalEdgeScore: number
  readonly existingHorizontalEdgeScore: number
  readonly candidateNodeQuality: number
  readonly existingNodeQuality: number
  readonly horizontalNodeQuality: number
  readonly orientationNoveltyScore: number
  readonly threePlanePoint: SpatialPoint | null
  readonly threePlaneDeterminant: number
  readonly triplePointSupportCounts: {
    readonly candidate: number
    readonly existing: number
    readonly horizontal: number
  }
  readonly triplePointSupportScore: number
  readonly multiSurfaceCoherenceScore: number
  /** Mandatory evidence gates are evaluated before coherence can select a triad. */
  readonly wallWallSupportGate: StructuralTriadGateStatus
  readonly wallHorizontalSupportGateA: StructuralTriadGateStatus
  readonly wallHorizontalSupportGateB: StructuralTriadGateStatus
  readonly triplePointSupportGate: StructuralTriadGateStatus
  readonly geometryGate: StructuralTriadGateStatus
  readonly coherenceGate: StructuralTriadGateStatus
  readonly decision: 'selected' | 'rejected'
  readonly selected: boolean
  readonly reason: string
}

export interface RoomStructureInterpretationResult {
  readonly sourceScanId: string
  readonly referenceSpaceType: 'local-floor' | 'local'
  /** All final geometric surfaces with role evidence and selection status. */
  readonly roleCandidates: readonly StructuralSurfaceCandidate[]
  readonly surfaces: readonly StructuralSurfaceCandidate[]
  /** Selected room-envelope surfaces, kept distinct from role evidence. */
  readonly selectedWalls: readonly StructuralSurfaceCandidate[]
  readonly selectedFloor: StructuralSurfaceCandidate | null
  readonly selectedCeiling: StructuralSurfaceCandidate | null
  readonly alternateWallCandidates: readonly StructuralSurfaceCandidate[]
  readonly alternateFloorCandidates: readonly StructuralSurfaceCandidate[]
  readonly alternateCeilingCandidates: readonly StructuralSurfaceCandidate[]
  readonly directionGroups: readonly StructuralDirectionGroup[]
  readonly wallOrientationGroups: readonly StructuralDirectionGroup[]
  readonly parallelLanes: readonly StructuralParallelLane[]
  readonly structuralGraphNodes: readonly StructuralGraphNode[]
  readonly structuralGraphEdges: readonly StructuralGraphEdge[]
  readonly structuralGraphComponents: readonly StructuralGraphComponent[]
  readonly selectedWallCorePlaneIds: readonly string[]
  readonly structuralCorePairCandidates: readonly StructuralCorePairCandidate[]
  readonly multiSurfaceCoherenceDiagnostics: readonly StructuralMultiSurfaceCoherenceDiagnostic[]
  /** Compatibility aliases; these now contain only selected room surfaces. */
  readonly likelyWalls: readonly StructuralSurfaceCandidate[]
  readonly floorCandidate: StructuralSurfaceCandidate | null
  readonly ceilingCandidate: StructuralSurfaceCandidate | null
  readonly otherSurfaces: readonly StructuralSurfaceCandidate[]
  readonly unknownSurfaces: readonly StructuralSurfaceCandidate[]
  readonly relationships: readonly StructuralSurfaceRelationship[]
  readonly stats: {
    readonly inputSurfaceCount: number
    readonly roleCandidateCount: number
    readonly likelyWallCount: number
    readonly selectedWallCount: number
    readonly alternateWallCount: number
    readonly selectedFloorCount: number
    readonly alternateFloorCount: number
    readonly selectedCeilingCount: number
    readonly alternateCeilingCount: number
    readonly wallDirectionGroupCount: number
    readonly selectedWallComponentCount: number
    readonly structuralGraphNodeCount: number
    readonly structuralGraphEdgeCount: number
    readonly structuralGraphComponentCount: number
    readonly selectedWallCoreCount: number
    readonly eligibleStrongWallEdgeCount: number
    readonly multiSurfaceCoherenceCandidateCount: number
    readonly selectedMultiSurfaceCoherenceCount: number
    readonly floorCandidate: string | null
    readonly ceilingCandidate: string | null
    readonly otherCount: number
    readonly unknownCount: number
  }
  readonly timings: {
    readonly relationshipAnalysisMs: number
    readonly interpretationMs: number
    readonly totalMs: number
  }
}

export type StructuralIntersectionType = 'wall-wall' | 'wall-ceiling' | 'wall-floor'

export type StructuralIntersectionStatus = 'supported' | 'partial' | 'rejected'

export type StructuralIntersectionRelationship = 'candidate' | 'supported' | 'rejected'

export interface StructuralIntersectionLine {
  readonly origin: SpatialPoint
  readonly direction: SpatialPoint
}

export interface StructuralIntersectionSegment {
  readonly start: SpatialPoint
  readonly end: SpatialPoint
}

export interface StructuralIntersectionRange {
  readonly minimum: number
  readonly maximum: number
}

export interface StructuralIntersectionCandidate {
  readonly id: string
  readonly surfaceAId: string
  readonly surfaceBId: string
  readonly type: StructuralIntersectionType
  readonly relationship: StructuralIntersectionRelationship
  readonly status: StructuralIntersectionStatus
  readonly line: StructuralIntersectionLine | null
  readonly segment: StructuralIntersectionSegment | null
  /** Numerical consistency checks for the exact theoretical line. */
  readonly lineOriginResidualA: number | null
  readonly lineOriginResidualB: number | null
  readonly lineDirectionPlaneDotA: number | null
  readonly lineDirectionPlaneDotB: number | null
  readonly maximumLineSampleResidualA: number | null
  readonly maximumLineSampleResidualB: number | null
  /** Scalar interval used to reconstruct the finite segment on the line. */
  readonly tStart: number | null
  readonly tEnd: number | null
  readonly segmentStartResidualA: number | null
  readonly segmentStartResidualB: number | null
  readonly segmentEndResidualA: number | null
  readonly segmentEndResidualB: number | null
  readonly segmentStartLineDistanceMeters: number | null
  readonly segmentEndLineDistanceMeters: number | null
  readonly lengthMeters: number
  readonly surfaceAngleDegrees: number
  readonly verticalityScore: number
  readonly supportNearIntersection: boolean
  readonly closestSupportDistanceMeters: number | null
  readonly supportCountA: number
  readonly supportCountB: number
  readonly intervalSupportCountA: number
  readonly intervalSupportCountB: number
  readonly supportIntervalA: StructuralIntersectionRange | null
  readonly supportIntervalB: StructuralIntersectionRange | null
  readonly segmentContinuity: number
  readonly supportCoverage: number
  readonly confidence: number
  readonly rejectionReason: string | null
}

export interface StructuralIntersectionResult {
  readonly sourceScanId: string
  readonly intersections: readonly StructuralIntersectionCandidate[]
  readonly stats: {
    readonly candidateCount: number
    readonly supportedCount: number
    readonly partialCount: number
    readonly rejectedCount: number
    readonly wallWallCount: number
    readonly wallCeilingCount: number
    readonly wallFloorCount: number
    readonly supportPointsEvaluated: number
    readonly selectedSurfaceCount: number
  }
  readonly timings: {
    readonly pairPreparationMs: number
    readonly lineCalculationMs: number
    readonly supportValidationMs: number
    readonly totalMs: number
  }
}

export type StructuralBoundaryStatus = 'supported' | 'partial' | 'inferred' | 'rejected'

export interface StructuralPlaneResidual {
  readonly surfaceId: string
  readonly residualMeters: number
}

export interface StructuralBoundaryExtension {
  readonly edgeId: string
  readonly distanceMeters: number
}

export interface StructuralBoundaryEdge {
  readonly id: string
  readonly type: StructuralIntersectionType
  readonly surfaceAId: string
  readonly surfaceBId: string
  readonly sourceIntersectionId: string
  readonly start: SpatialPoint
  readonly end: SpatialPoint
  readonly lengthMeters: number
  readonly confidence: number
  readonly status: StructuralBoundaryStatus
  readonly startNodeId: string | null
  readonly endNodeId: string | null
  readonly extensionDistances: readonly StructuralBoundaryExtension[]
}

export interface StructuralBoundaryNode {
  readonly id: string
  readonly position: SpatialPoint
  readonly surfaceIds: readonly string[]
  readonly sourceEdgeIds: readonly string[]
  readonly sourceIntersectionIds: readonly string[]
  readonly status: StructuralBoundaryStatus
  readonly confidence: number
  readonly segmentGapMeters: number
  readonly extensionDistances: readonly StructuralBoundaryExtension[]
  readonly planeResiduals: readonly StructuralPlaneResidual[]
  readonly cornerId: string | null
}

export interface StructuralCorner {
  readonly id: string
  readonly nodeId: string
  readonly position: SpatialPoint
  readonly surfaceIds: readonly string[]
  readonly sourceEdgeIds: readonly string[]
  readonly sourceIntersectionIds: readonly string[]
  readonly status: StructuralBoundaryStatus
  readonly confidence: number
  readonly segmentGapMeters: number
  readonly extensionDistances: readonly StructuralBoundaryExtension[]
  readonly planeResiduals: readonly StructuralPlaneResidual[]
}

export interface ObservedWallBoundary {
  readonly wallId: string
  readonly wallWallEdgeIds: readonly string[]
  readonly upperBoundaryEdgeIds: readonly string[]
  readonly lowerBoundaryEdgeIds: readonly string[]
}

export interface StructuralBoundaryComponent {
  readonly id: string
  readonly surfaceIds: readonly string[]
  readonly edgeIds: readonly string[]
  readonly nodeIds: readonly string[]
}

export interface RoomBoundaryResult {
  readonly sourceScanId: string
  readonly selectedSurfaceIds: readonly string[]
  readonly edges: readonly StructuralBoundaryEdge[]
  readonly nodes: readonly StructuralBoundaryNode[]
  readonly corners: readonly StructuralCorner[]
  readonly wallBoundaries: readonly ObservedWallBoundary[]
  readonly components: readonly StructuralBoundaryComponent[]
  readonly stats: {
    readonly selectedSurfaceCount: number
    readonly boundaryEdgeCount: number
    readonly wallWallEdgeCount: number
    readonly wallCeilingEdgeCount: number
    readonly wallFloorEdgeCount: number
    readonly cornerNodeCount: number
    readonly supportedCornerCount: number
    readonly partialCornerCount: number
    readonly connectedComponentCount: number
    readonly rejectedIntersectionCount: number
  }
  readonly timings: {
    readonly preparationMs: number
    readonly graphConstructionMs: number
    readonly cornerSolvingMs: number
    readonly totalMs: number
  }
}

export interface SurfaceConsensusDiagnostic {
  readonly consensusId: string
  readonly finalPlaneId: string
  readonly memberFamilyIds: readonly string[]
  readonly memberPlaneIds: readonly string[]
  readonly totalDepthSpanMeters: number
  readonly representativePlaneId: string
  readonly directRepresentativeSupport: number
  readonly absorbedLayerSupport: number
  readonly finalOwnedSupport: number
  readonly finalOwnedAreaEstimate: number
  readonly representativeRmsError: number
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
    readonly rawRansacPlaneCount: number
    readonly surfaceFamilyClusterCount: number
    readonly surfaceFamilyPairsTested: number
    readonly surfaceFamilyMerges: number
    readonly finalConsolidatedPlaneCount: number
    readonly preConsensusSurfaceFamilyCount: number
    readonly finalConsensusSurfaceCount: number
    readonly consensusPairTests: number
    readonly consensusMerges: number
    readonly planeCount: number
    readonly assignedPoints: number
    readonly unassignedPoints: number
    readonly assignedPercentage: number
    readonly supportAccountingConsistent: boolean
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
  readonly surfaceFamilies: readonly SurfaceFamilyDiagnostic[]
  readonly surfaceConsensus: readonly SurfaceConsensusDiagnostic[]
  readonly surfaceConsensusPairs: readonly SurfaceConsensusPairDiagnostic[]
  readonly ransacIterationsPerPlane: readonly number[]
  readonly timings: RoomAnalysisTimings
}

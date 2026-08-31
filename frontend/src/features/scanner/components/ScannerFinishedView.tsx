import { useEffect, useRef, useState } from 'react'
import { BUILD_INFO } from '../../../config/buildInfo'
import type { FinalizedSpatialScan } from '../types'
import { PlaneExtractionService } from '../../room-analysis/services/planeExtractionService'
import { RoomBoundaryReconstructionService } from '../../room-analysis/services/roomBoundaryReconstructionService'
import {
  getStructuralSupportConsistencyWarnings,
  StructuralIntersectionService,
} from '../../room-analysis/services/structuralIntersectionService'
import { StructuralSurfaceInterpretationService } from '../../room-analysis/services/structuralSurfaceInterpretationService'
import { RoomSurfaceConstructionService } from '../../room-analysis/services/roomSurfaceConstructionService'
import type {
  RoomAnalysisResult,
  RoomBoundaryResult,
  RoomSurfaceConstructionResult,
  RoomStructureInterpretationResult,
  StructuralIntersectionCandidate,
  StructuralIntersectionResult,
  StructuralSurfaceRole,
} from '../../room-analysis/types'
import FinalizedSpatialScanPreview from './FinalizedSpatialScanPreview'

interface ScannerFinishedViewProps {
  scan: FinalizedSpatialScan
  onStartNewScan: () => void
  onDiscardScan: () => void
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function formatCapturedShare(scan: FinalizedSpatialScan): string {
  if (scan.statistics.uniqueCells === 0) {
    return 'N/A'
  }

  return `${Math.round((scan.statistics.capturedCells / scan.statistics.uniqueCells) * 100)}%`
}

function AnalysisResultSummary({ analysisResult }: { analysisResult: RoomAnalysisResult }) {
  return (
    <section className="scanner-analysis-result" aria-labelledby="scanner-analysis-title">
      <div className="scanner-analysis-result-header">
        <div>
          <span className="scanner-analysis-label" id="scanner-analysis-title">
            Plane candidates
          </span>
          <span className="scanner-analysis-copy">
            Geometric candidates only; no wall, floor, or ceiling classification is applied.
          </span>
        </div>
          <strong>{analysisResult.stats.finalConsensusSurfaceCount}</strong>
      </div>
      <div className="scanner-analysis-timings">
        <span>Analysis method: Global dominant planes (position-first, deterministic RANSAC)</span>
      </div>
      <div className="scanner-analysis-stats">
        <div>
          <span>Fused analysis input</span>
          <strong>{analysisResult.stats.inputPoints}</strong>
        </div>
        <div>
          <span>Finalized fused surfels</span>
          <strong>{analysisResult.stats.finalizedFusedSurfelCount}</strong>
        </div>
        <div>
          <span>Analysis downsampled surfels</span>
          <strong>{analysisResult.stats.analysisDownsampledSurfelCount}</strong>
        </div>
        <div>
          <span>Raw RANSAC planes</span>
          <strong>{analysisResult.stats.rawRansacPlaneCount}</strong>
        </div>
        <div>
          <span>Initial surface families</span>
          <strong>{analysisResult.stats.surfaceFamilyClusterCount}</strong>
        </div>
        <div>
          <span>Final consensus surfaces</span>
          <strong>{analysisResult.stats.finalConsensusSurfaceCount}</strong>
        </div>
        <div>
          <span>Assigned points</span>
          <strong>{analysisResult.stats.assignedPoints} ({analysisResult.stats.assignedPercentage.toFixed(1)}%)</strong>
        </div>
        <div>
          <span>Unassigned points</span>
          <strong>{analysisResult.stats.unassignedPoints}</strong>
        </div>
      </div>
      <div className="scanner-analysis-timings">
        <span>
          Timing: preparation {analysisResult.timings.inputPreparationMs.toFixed(1)} ms | downsampling {analysisResult.timings.downsamplingMs.toFixed(1)} ms | RANSAC {analysisResult.timings.ransacMs.toFixed(1)} ms | layer consolidation {analysisResult.timings.surfaceFamilyConsolidationMs.toFixed(1)} ms | final consensus {analysisResult.timings.surfaceConsensusMs.toFixed(1)} ms | ownership {analysisResult.timings.ownershipMs.toFixed(1)} ms | total {analysisResult.timings.totalMs.toFixed(1)} ms
        </span>
      </div>
      <div className="scanner-analysis-timings">
        <span>
          Largest support {analysisResult.stats.largestPlaneSupportPercentage.toFixed(1)}% | second {analysisResult.stats.secondLargestPlaneSupportPercentage.toFixed(1)}% | top 3 {analysisResult.stats.topThreePlaneSupportPercentage.toFixed(1)}% of assigned points
        </span>
      </div>
      <div className="scanner-analysis-timings">
        <span>
          Layer-family pairs {analysisResult.stats.surfaceFamilyPairsTested} | layer merges {analysisResult.stats.surfaceFamilyMerges} | consensus pairs {analysisResult.stats.consensusPairTests} | consensus merges {analysisResult.stats.consensusMerges}
        </span>
      </div>
      <div className="scanner-analysis-timings">
        <span>
          Final support accounting: {analysisResult.stats.supportAccountingConsistent ? 'consistent' : 'inconsistent'} | assigned {analysisResult.stats.assignedPoints} | unassigned {analysisResult.stats.unassignedPoints}
        </span>
      </div>
      {analysisResult.planeRelationships.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>
            Top plane relations: {analysisResult.planeRelationships.map((relationship) => `${relationship.firstPlaneId}/${relationship.secondPlaneId} ${relationship.angularDifferenceDegrees.toFixed(1)} deg / delta d ${relationship.planeOffsetDifferenceMeters.toFixed(3)} m`).join(' | ')}
          </span>
        </div>
      ) : null}
      {analysisResult.surfaceFamilies.map((family) => (
        <div className="scanner-analysis-timings" key={family.familyId}>
          <span>
            {family.familyId} -&gt; {family.memberPlaneIds.join(', ')} | normal spread {family.normalSpreadDegrees.toFixed(1)} deg | d {family.minimumPlaneOffset.toFixed(3)} to {family.maximumPlaneOffset.toFixed(3)} m | thickness {family.clusterThicknessMeters.toFixed(3)} m | projected overlap {family.projectedSupportOverlapPercentage.toFixed(1)}% | direct {family.directRepresentativeSupport} | duplicate layer {family.absorbedDuplicateLayerSupport} | combined {family.combinedPhysicalSupport} ({family.combinedSupportPercentage.toFixed(1)}%) | family occupied area {family.finalOwnedAreaEstimate.toFixed(2)} m2
          </span>
        </div>
      ))}
      {analysisResult.surfaceConsensusPairs.slice(0, 8).map((pair) => (
        <div className="scanner-analysis-timings" key={`${pair.firstFamilyId}-${pair.secondFamilyId}`}>
          <span>
            Consensus {pair.firstFamilyId}/{pair.secondFamilyId} | angle {pair.angularDifferenceDegrees.toFixed(1)} deg | delta d {pair.planeOffsetDifferenceMeters.toFixed(3)} m | IoU {pair.projectedIoU.toFixed(2)} | A by B {pair.firstCoverageBySecondPercentage.toFixed(1)}% | B by A {pair.secondCoverageByFirstPercentage.toFixed(1)}% | areas {pair.firstOccupiedArea.toFixed(2)} / {pair.secondOccupiedArea.toFixed(2)} m2 | separation {pair.separationMeters.toFixed(3)} m | {pair.merged ? 'merged' : `kept separate (${pair.rejectReason ?? 'ambiguous'})`}
          </span>
        </div>
      ))}
      {analysisResult.surfaceConsensus.map((consensus) => (
        <div className="scanner-analysis-timings" key={consensus.consensusId}>
          <span>
            {consensus.consensusId} | families {consensus.memberFamilyIds.join(', ')} | representative {consensus.representativePlaneId} | depth span {consensus.totalDepthSpanMeters.toFixed(3)} m | direct {consensus.directRepresentativeSupport} | absorbed layers {consensus.absorbedLayerSupport} | final owned {consensus.finalOwnedSupport} | final area {consensus.finalOwnedAreaEstimate.toFixed(2)} m2 | RMS {consensus.representativeRmsError.toFixed(3)} m
          </span>
        </div>
      ))}
      {analysisResult.planes.length > 0 ? (
        <div className="scanner-plane-list">
          {analysisResult.planes.map((plane) => {
            const consensus = analysisResult.surfaceConsensus.find((item) => item.finalPlaneId === plane.id)
            return (
              <div className="scanner-plane-row" key={plane.id}>
                <span>
                  <strong>{plane.id}</strong>
                  <small>
                    {plane.orientationCategory} | {plane.orientationAngleDegrees.toFixed(0)} deg from world-up | normal ({plane.normal.x.toFixed(2)}, {plane.normal.y.toFixed(2)}, {plane.normal.z.toFixed(2)}) | d {(-plane.planeConstant).toFixed(3)}
                  </small>
                </span>
                <span>
                  Final owned support {consensus?.finalOwnedSupport ?? plane.supportPointCount} | final family area {consensus?.finalOwnedAreaEstimate.toFixed(2) ?? plane.areaEstimate.toFixed(2)} m2 | RMS {plane.rmsError.toFixed(3)} m
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="scanner-analysis-empty">
          Not enough stable spatial data to detect major surfaces.
        </p>
      )}
    </section>
  )
}

function getStructuralRoleLabel(role: StructuralSurfaceRole): string {
  if (role === 'wall') {
    return 'Likely Wall'
  }
  if (role === 'floor') {
    return 'Likely Floor'
  }
  if (role === 'ceiling') {
    return 'Likely Ceiling'
  }
  return role === 'other' ? 'Other' : 'Unknown'
}

function StructuralSurfaceSummary({
  interpretation,
}: {
  interpretation: RoomStructureInterpretationResult
}) {
  const planeById = new Map(interpretation.surfaces.map((surface) => [surface.planeId, surface]))
  const relevantRelationships = [...interpretation.relationships]
    .filter((relationship) => relationship.relationshipType !== 'other')
    .sort((left, right) => right.verticalHorizontalEvidence - left.verticalHorizontalEvidence ||
      right.perpendicularityScore - left.perpendicularityScore)
    .slice(0, 6)
  const selectedSurfaces = interpretation.surfaces.filter((surface) => surface.selection === 'selected')
  const alternateSurfaces = interpretation.surfaces.filter((surface) => surface.selection === 'alternate')
  const unselectedSurfaces = interpretation.surfaces.filter((surface) => surface.selection === 'unselected')
  const strongGraphEdges = interpretation.structuralGraphEdges.filter((edge) => edge.edgeStrength === 'strong')
  const supportingGraphEdges = interpretation.structuralGraphEdges.filter((edge) => edge.edgeStrength === 'supporting')
  const topCoreCandidates = interpretation.structuralCorePairCandidates.slice(0, 6)
  const topTriadCandidates = interpretation.multiSurfaceCoherenceDiagnostics.slice(0, 6)

  return (
    <section className="scanner-analysis-result" aria-labelledby="structural-surfaces-title">
      <div className="scanner-analysis-result-header">
        <div>
          <span className="scanner-analysis-label" id="structural-surfaces-title">
            Structural surfaces
          </span>
          <span className="scanner-analysis-copy">
            Geometry-based interpretation only; this does not construct a room mesh.
          </span>
        </div>
        <strong>{interpretation.stats.inputSurfaceCount}</strong>
      </div>
      <div className="scanner-analysis-stats">
        <div>
          <span>Input final geometric surfaces</span>
          <strong>{interpretation.stats.inputSurfaceCount}</strong>
        </div>
        <div>
          <span>Selected room walls</span>
          <strong>{interpretation.stats.selectedWallCount}</strong>
        </div>
        <div>
          <span>Selected floor</span>
          <strong>{interpretation.stats.floorCandidate ?? 'Not confidently observed'}</strong>
        </div>
        <div>
          <span>Selected ceiling</span>
          <strong>{interpretation.stats.ceilingCandidate ?? 'Not confidently observed'}</strong>
        </div>
        <div>
          <span>Alternate structural candidates</span>
          <strong>{interpretation.stats.alternateWallCount + interpretation.stats.alternateFloorCount + interpretation.stats.alternateCeilingCount}</strong>
        </div>
        <div>
          <span>Other</span>
          <strong>{interpretation.stats.otherCount}</strong>
        </div>
        <div>
          <span>Unknown</span>
          <strong>{interpretation.stats.unknownCount}</strong>
        </div>
        <div>
          <span>Structural graph nodes / edges</span>
          <strong>{interpretation.stats.structuralGraphNodeCount} / {interpretation.stats.structuralGraphEdgeCount}</strong>
        </div>
        <div>
          <span>Selected wall components</span>
          <strong>{interpretation.stats.selectedWallComponentCount}</strong>
        </div>
        <div>
          <span>Raw graph components</span>
          <strong>{interpretation.stats.structuralGraphComponentCount}</strong>
        </div>
        <div>
          <span>Strong / supporting edges</span>
          <strong>{strongGraphEdges.length} / {supportingGraphEdges.length}</strong>
        </div>
        <div>
          <span>Eligible strong wall edges</span>
          <strong>{interpretation.stats.eligibleStrongWallEdgeCount}</strong>
        </div>
        <div>
          <span>Local triads / final selected</span>
          <strong>{interpretation.stats.locallyAcceptedTriadCount} / {interpretation.stats.finalSelectedTriadCount}</strong>
        </div>
        <div>
          <span>Triad competition groups / suppressed</span>
          <strong>{interpretation.stats.triadCompetitionGroupCount} / {interpretation.stats.suppressedTriadCount}</strong>
        </div>
        <div>
          <span>Shared-anchor / whole-corner groups</span>
          <strong>{interpretation.stats.sharedAnchorCompetitionGroupCount} / {interpretation.stats.wholeCornerCompetitionGroupCount}</strong>
        </div>
        <div>
          <span>Whole-corner competing pairs</span>
          <strong>{interpretation.stats.wholeCornerCompetitionPairCount}</strong>
        </div>
      </div>
      <div className="scanner-analysis-timings">
        <span>
          Reference space: {interpretation.referenceSpaceType} | wall direction groups {interpretation.stats.wallDirectionGroupCount} | graph nodes {interpretation.stats.structuralGraphNodeCount} | graph edges {interpretation.stats.structuralGraphEdgeCount} | relationships {interpretation.relationships.length} | timing relationships {interpretation.timings.relationshipAnalysisMs.toFixed(1)} ms | interpretation {interpretation.timings.interpretationMs.toFixed(1)} ms | total {interpretation.timings.totalMs.toFixed(1)} ms
        </span>
      </div>
      {interpretation.directionGroups.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>
            Wall orientation groups: {interpretation.wallOrientationGroups.map((group) => `${group.id} [${group.planeIds.join(', ')}] -> ${group.selectedPlaneIds.length > 0 ? group.selectedPlaneIds.join(', ') : 'none'} | normal spread ${group.normalSpreadDegrees.toFixed(1)} deg`).join(' | ') || 'none'}
          </span>
        </div>
      ) : null}
      <div className="scanner-analysis-timings">
        <span>
          Selected structural core: {interpretation.selectedWallCorePlaneIds.join(', ') || 'none'} | raw graph components: {interpretation.structuralGraphComponents.map((component) => `${component.id} [${component.planeIds.join(', ')}]`).join(' | ') || 'none'}
        </span>
      </div>
      {topCoreCandidates.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>
            Top joint wall cores: {topCoreCandidates.map((candidate) => {
              const first = planeById.get(candidate.firstPlaneId)
              const second = planeById.get(candidate.secondPlaneId)
              return `${candidate.firstPlaneId}/${candidate.secondPlaneId} edge ${candidate.edgeScore.toFixed(2)}, nodes ${candidate.firstNodeQuality.toFixed(2)}/${candidate.secondNodeQuality.toFixed(2)}, area ${first?.occupiedArea.toFixed(2) ?? 'n/a'}/${second?.occupiedArea.toFixed(2) ?? 'n/a'} m2, support ${first?.finalOwnedSupport ?? 'n/a'}/${second?.finalOwnedSupport ?? 'n/a'}, joint ${candidate.jointCoreScore.toFixed(2)}${candidate.selected ? ' [selected]' : ''}`
            }).join(' | ')}
          </span>
        </div>
      ) : null}
      {topTriadCandidates.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>
            Multi-surface candidates: {topTriadCandidates.map((candidate) => `${candidate.candidatePlaneId} with ${candidate.existingWallPlaneId} + ${candidate.horizontalPlaneId} | wall angle ${candidate.wallWallAngleDegrees.toFixed(1)} deg | line support A/B ${candidate.wallWallSupport.nearLineSupportCountA}/${candidate.wallWallSupport.nearLineSupportCountB} (${candidate.wallWallSupport.intersectionSupportScore.toFixed(2)}) | horizontal support A/B ${candidate.candidateHorizontalSupport.intersectionSupportScore.toFixed(2)}/${candidate.existingHorizontalSupport?.intersectionSupportScore.toFixed(2) ?? 'n/a'} | triple support ${candidate.triplePointSupportCounts.candidate}/${candidate.triplePointSupportCounts.existing}/${candidate.triplePointSupportCounts.horizontal} (${candidate.triplePointSupportScore.toFixed(2)}) | triple point ${candidate.threePlanePoint ? formatPoint(candidate.threePlanePoint) : 'none'} | node ${candidate.candidateNodeQuality.toFixed(2)} | coherence ${candidate.multiSurfaceCoherenceScore.toFixed(2)} | gates geom/${candidate.geometryGate} wall-wall/${candidate.wallWallSupportGate} horiz/${candidate.wallHorizontalSupportGateA}/${candidate.wallHorizontalSupportGateB} triple/${candidate.triplePointSupportGate} coherence/${candidate.coherenceGate} | local/${candidate.locallyAccepted ? 'accepted' : 'rejected'} final/${candidate.finalDecision}${candidate.competitionGroupId ? ` group ${candidate.competitionGroupId}` : ''}${candidate.selected ? '' : `: ${candidate.competitionReason ?? candidate.reason}`}`).join(' | ')}
          </span>
        </div>
      ) : null}
      {interpretation.triadCompetitionDiagnostics.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>
            Triad competition: {interpretation.triadCompetitionDiagnostics.slice(0, 6).map((competition) => {
              const correspondence = competition.wallCorrespondence.length > 0
                ? ` | correspondence ${competition.wallCorrespondence.map((pair) => `${pair.wallAId}/${pair.wallBId} normal ${pair.normalSeparationDegrees.toFixed(1)} deg support ${pair.bidirectionalSupportDistanceMeters === null ? 'n/a' : `${pair.bidirectionalSupportDistanceMeters.toFixed(2)} m`} overlap ${(pair.projectedSupportOverlap * 100).toFixed(0)}%`).join(', ')}`
                : ''
              const wallSelection = competition.wallSelectionAfterSuppression.length > 0
                ? ` | losing walls ${competition.wallSelectionAfterSuppression.map((wall) => `${wall.planeId} ${wall.remainsSelected ? 'retained' : 'suppressed'}${wall.independentlyRequired ? ' (independent)' : ''}`).join(', ')}`
                : ''
              const anchor = competition.sharedAnchorWallPlaneId ?? 'none'
              return `${competition.competitionType} ${competition.triadAKey} vs ${competition.triadBKey} | anchor ${anchor} + ${competition.sharedHorizontalPlaneId} | normal ${competition.normalSeparationDegrees.toFixed(1)} deg | support overlap ${(competition.projectedSupportOverlap * 100).toFixed(0)}% | extent ${(competition.projectedExtentOverlap * 100).toFixed(0)}% | bidirectional support ${competition.bidirectionalSupportDistanceMeters === null ? 'n/a' : `${competition.bidirectionalSupportDistanceMeters.toFixed(2)} m`} | triple gap ${competition.triplePointSeparationMeters === null ? 'n/a' : `${competition.triplePointSeparationMeters.toFixed(2)} m`} | duplicate corner ${competition.duplicateCornerConfidence === null ? 'n/a' : competition.duplicateCornerConfidence.toFixed(2)} | representative ${competition.representativeScoreA.toFixed(2)}/${competition.representativeScoreB.toFixed(2)} | ${competition.decision}${competition.winnerTriadKey ? ` winner ${competition.winnerTriadKey}` : ''}${correspondence}${wallSelection}: ${competition.reason}`
            }).join(' | ')}
          </span>
        </div>
      ) : null}
      {selectedSurfaces.length > 0 ? (
        <>
          <div className="scanner-analysis-timings"><span>Selected room surfaces</span></div>
          <div className="scanner-plane-list">
            {selectedSurfaces.map((surface) => (
              <StructuralSurfaceRow key={surface.planeId} surface={surface} />
            ))}
          </div>
        </>
      ) : null}
      {alternateSurfaces.length > 0 ? (
        <>
          <div className="scanner-analysis-timings"><span>Alternate structural candidates</span></div>
          <div className="scanner-plane-list">
            {alternateSurfaces.map((surface) => (
              <StructuralSurfaceRow key={surface.planeId} surface={surface} />
            ))}
          </div>
        </>
      ) : null}
      {unselectedSurfaces.length > 0 ? (
        <>
          <div className="scanner-analysis-timings"><span>Other and uncertain geometry</span></div>
          <div className="scanner-plane-list">
            {unselectedSurfaces.map((surface) => (
              <StructuralSurfaceRow key={surface.planeId} surface={surface} />
            ))}
          </div>
        </>
      ) : null}
      {relevantRelationships.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>
            Key relationships: {relevantRelationships.map((relationship) => {
              const first = planeById.get(relationship.firstPlaneId)
              const second = planeById.get(relationship.secondPlaneId)
              const supportDistance = relationship.closestSurfaceSupportDistanceMeters === null
                ? 'n/a'
                : `${relationship.closestSurfaceSupportDistanceMeters.toFixed(2)} m`
              return `${relationship.firstPlaneId} (${first ? getStructuralRoleLabel(first.role) : 'surface'}) / ${relationship.secondPlaneId} (${second ? getStructuralRoleLabel(second.role) : 'surface'}) ${relationship.relationshipType}, angle ${relationship.normalAngleDegrees.toFixed(1)} deg, bounds gap ${relationship.supportBoundsGapMeters.toFixed(2)} m, line support ${supportDistance}, near-line ${relationship.nearTheoreticalLineSupportCountA}/${relationship.nearTheoreticalLineSupportCountB}, ${relationship.supportsNearTheoreticalIntersection ? 'supports near theoretical intersection' : 'no two-sided theoretical-line support'}`
            }).join(' | ')}
          </span>
        </div>
      ) : null}
      {interpretation.structuralGraphEdges.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>
            Structural graph edges: {[...interpretation.structuralGraphEdges]
              .sort((left, right) => right.edgeScore - left.edgeScore)
              .slice(0, 6)
              .map((edge) => `${edge.firstPlaneId}/${edge.secondPlaneId} ${edge.edgeType} (${edge.edgeStrength}), score ${edge.edgeScore.toFixed(2)}, angle ${edge.normalAngleDegrees.toFixed(1)} deg, intersection support ${edge.intersectionSupportScore.toFixed(2)}, closest support ${edge.closestSupportDistanceMeters.toFixed(2)} m`)
              .join(' | ')}
          </span>
        </div>
      ) : null}
    </section>
  )
}

function StructuralSurfaceRow({
  surface,
}: {
  surface: RoomStructureInterpretationResult['surfaces'][number]
}) {
  const selectionLabel = surface.selection === 'selected'
    ? 'Selected'
    : surface.selection === 'alternate' ? 'Alternate' : 'Not selected'
  return (
    <div className={`scanner-plane-row ${surface.selection === 'selected' ? 'scanner-plane-row-selected' : 'scanner-plane-row-secondary'}`}>
      <span>
        <strong>{surface.planeId}</strong>
        <small>{selectionLabel} | {getStructuralRoleLabel(surface.role)} | role confidence {surface.confidence.toFixed(2)} | height {surface.centroidHeight.toFixed(2)} m | normal ({surface.normal.x.toFixed(2)}, {surface.normal.y.toFixed(2)}, {surface.normal.z.toFixed(2)}) | d {(-surface.planeConstant).toFixed(3)}</small>
      </span>
      <span>
        area {surface.occupiedArea.toFixed(2)} m2 | final owned support {surface.finalOwnedSupport} | envelope score {surface.envelopeSelectionScore.toFixed(2)} | graph support {surface.graphSupportScore.toFixed(2)} | multi-surface coherence {surface.multiSurfaceCoherenceScore.toFixed(2)} | final selection {surface.finalSelectionScore.toFixed(2)} | orientation {surface.evidence.orientationScore.toFixed(2)} | size {surface.evidence.sizeScore.toFixed(2)} | support {surface.evidence.supportScore.toFixed(2)} | height {surface.evidence.heightScore.toFixed(2)} | relationships {surface.evidence.relationshipScore.toFixed(2)} | {surface.selectionReason}
      </span>
    </div>
  )
}

function formatPoint(point: { x: number; y: number; z: number }): string {
  return `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`
}

function formatRange(range: { minimum: number; maximum: number } | null): string {
  return range ? `[${range.minimum.toFixed(2)}, ${range.maximum.toFixed(2)}]` : 'none'
}

function StructuralIntersectionSummary({
  result,
  consistencyWarnings = [],
}: {
  result: StructuralIntersectionResult
  consistencyWarnings?: readonly string[]
}) {
  const supported = result.intersections.filter((intersection) => intersection.status === 'supported')
  const partial = result.intersections.filter((intersection) => intersection.status === 'partial')
  const rejected = result.intersections.filter((intersection) => intersection.status === 'rejected')

  return (
    <section className="scanner-analysis-result" aria-labelledby="structural-intersections-title">
      <div className="scanner-analysis-result-header">
        <div>
          <span className="scanner-analysis-label" id="structural-intersections-title">
            Structural intersections
          </span>
          <span className="scanner-analysis-copy">
            Finite, support-validated lines between selected structural surfaces; no room mesh is inferred.
          </span>
        </div>
        <strong>{result.stats.candidateCount}</strong>
      </div>
      <div className="scanner-analysis-stats">
        <div>
          <span>Supported</span>
          <strong>{supported.length}</strong>
        </div>
        <div>
          <span>Partial</span>
          <strong>{partial.length}</strong>
        </div>
        <div>
          <span>Rejected</span>
          <strong>{rejected.length}</strong>
        </div>
        <div>
          <span>Wall-wall</span>
          <strong>{result.stats.wallWallCount}</strong>
        </div>
        <div>
          <span>Wall-ceiling</span>
          <strong>{result.stats.wallCeilingCount}</strong>
        </div>
        <div>
          <span>Wall-floor</span>
          <strong>{result.stats.wallFloorCount}</strong>
        </div>
        <div>
          <span>Selected surfaces</span>
          <strong>{result.stats.selectedSurfaceCount}</strong>
        </div>
        <div>
          <span>Fused support points evaluated</span>
          <strong>{result.stats.supportPointsEvaluated}</strong>
        </div>
      </div>
      <div className="scanner-analysis-timings">
        <span>
          Timing: pair preparation {result.timings.pairPreparationMs.toFixed(1)} ms | line calculation {result.timings.lineCalculationMs.toFixed(1)} ms | support validation {result.timings.supportValidationMs.toFixed(1)} ms | total {result.timings.totalMs.toFixed(1)} ms
        </span>
      </div>
      {import.meta.env.DEV && consistencyWarnings.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>Development support-consistency warnings: {consistencyWarnings.join(' | ')}</span>
        </div>
      ) : null}
      {result.intersections.length > 0 ? (
        <div className="scanner-plane-list">
          {result.intersections.map((intersection) => (
            <StructuralIntersectionRow key={intersection.id} intersection={intersection} />
          ))}
        </div>
      ) : (
        <div className="scanner-analysis-timings">
          <span>No selected-surface intersection candidates were generated.</span>
        </div>
      )}
    </section>
  )
}

function StructuralIntersectionRow({
  intersection,
}: {
  intersection: StructuralIntersectionCandidate
}) {
  const segmentText = intersection.segment
    ? `${formatPoint(intersection.segment.start)} → ${formatPoint(intersection.segment.end)}`
    : 'none'
  const directionText = intersection.line
    ? formatPoint(intersection.line.direction)
    : 'none'
  const supportDistanceText = intersection.closestSupportDistanceMeters === null
    ? 'n/a'
    : `${intersection.closestSupportDistanceMeters.toFixed(2)} m`
  return (
    <div className={`scanner-plane-row ${intersection.status === 'supported' ? 'scanner-plane-row-selected' : 'scanner-plane-row-secondary'}`}>
      <span>
        <strong>{intersection.id}</strong>
        <small>
          {intersection.status} | {intersection.type} | {intersection.surfaceAId} / {intersection.surfaceBId} | angle {intersection.surfaceAngleDegrees.toFixed(1)} deg | direction {directionText} | verticality {(intersection.verticalityScore * 100).toFixed(0)}%
        </small>
      </span>
      <span>
        segment {segmentText} | length {intersection.lengthMeters.toFixed(2)} m | support {intersection.supportCountA}/{intersection.supportCountB} ({intersection.intervalSupportCountA}/{intersection.intervalSupportCountB} in interval) | intervals {formatRange(intersection.supportIntervalA)} / {formatRange(intersection.supportIntervalB)} | closest support {supportDistanceText} | near line {intersection.supportNearIntersection ? 'yes' : 'no'} | continuity {(intersection.segmentContinuity * 100).toFixed(0)}% | confidence {intersection.confidence.toFixed(2)} | line residual origin {formatResidual(intersection.lineOriginResidualA)}/{formatResidual(intersection.lineOriginResidualB)} | endpoint residual start {formatResidual(intersection.segmentStartResidualA)}/{formatResidual(intersection.segmentStartResidualB)} end {formatResidual(intersection.segmentEndResidualA)}/{formatResidual(intersection.segmentEndResidualB)} | endpoint line distance {formatResidual(intersection.segmentStartLineDistanceMeters)}/{formatResidual(intersection.segmentEndLineDistanceMeters)} | t {formatRange(intersection.tStart !== null && intersection.tEnd !== null ? { minimum: intersection.tStart, maximum: intersection.tEnd } : null)}{intersection.rejectionReason ? ` | ${intersection.rejectionReason}` : ''}
      </span>
    </div>
  )
}

function formatResidual(value: number | null): string {
  return value === null ? 'n/a' : value.toExponential(1)
}

function RoomBoundarySummary({
  result,
}: {
  result: RoomBoundaryResult
}) {
  const supportedCorners = result.corners.filter((corner) => corner.status === 'supported')
  const partialCorners = result.corners.filter((corner) => corner.status === 'partial')

  return (
    <section className="scanner-analysis-result" aria-labelledby="room-boundary-title">
      <div className="scanner-analysis-result-header">
        <div>
          <span className="scanner-analysis-label" id="room-boundary-title">
            Room boundary
          </span>
          <span className="scanner-analysis-copy">
            Observed structural connections only; no closed room or mesh is inferred.
          </span>
        </div>
        <strong>{result.components.length}</strong>
      </div>
      <div className="scanner-analysis-stats">
        <div>
          <span>Selected structural surfaces</span>
          <strong>{result.stats.selectedSurfaceCount}</strong>
        </div>
        <div>
          <span>Boundary edges</span>
          <strong>{result.stats.boundaryEdgeCount}</strong>
        </div>
        <div>
          <span>Wall-wall</span>
          <strong>{result.stats.wallWallEdgeCount}</strong>
        </div>
        <div>
          <span>Wall-ceiling</span>
          <strong>{result.stats.wallCeilingEdgeCount}</strong>
        </div>
        <div>
          <span>Wall-floor</span>
          <strong>{result.stats.wallFloorEdgeCount}</strong>
        </div>
        <div>
          <span>Corner nodes</span>
          <strong>{result.stats.cornerNodeCount}</strong>
        </div>
        <div>
          <span>Corner candidates</span>
          <strong>{result.stats.cornerCandidateCount}</strong>
        </div>
        <div>
          <span>Raw / validated candidates</span>
          <strong>{result.stats.rawCornerCandidateCount} / {result.stats.validatedCornerCandidateCount}</strong>
        </div>
        <div>
          <span>Deduplicated duplicates</span>
          <strong>{result.stats.deduplicatedDuplicateCount}</strong>
        </div>
        <div>
          <span>Supported / partial corners</span>
          <strong>{supportedCorners.length} / {partialCorners.length}</strong>
        </div>
        <div>
          <span>Rejected corner candidates</span>
          <strong>{result.stats.rejectedCornerCandidateCount}</strong>
        </div>
        <div>
          <span>Connected components</span>
          <strong>{result.stats.connectedComponentCount}</strong>
        </div>
        <div>
          <span>Rejected intersections</span>
          <strong>{result.stats.rejectedIntersectionCount}</strong>
        </div>
      </div>
      <div className="scanner-analysis-timings">
        <span>
          Timing: preparation {result.timings.preparationMs.toFixed(1)} ms | graph construction {result.timings.graphConstructionMs.toFixed(1)} ms | corner solving {result.timings.cornerSolvingMs.toFixed(1)} ms | total {result.timings.totalMs.toFixed(1)} ms
        </span>
      </div>
      {result.wallBoundaries.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>
            Wall boundary profiles: {result.wallBoundaries.map((boundary) => `${boundary.wallId} (wall-wall ${boundary.wallWallEdgeIds.length}, upper ${boundary.upperBoundaryEdgeIds.length}, lower ${boundary.lowerBoundaryEdgeIds.length})`).join(' | ')}
          </span>
        </div>
      ) : null}
      {result.edges.length > 0 ? (
        <>
          <div className="scanner-analysis-timings"><span>Observed boundary edges</span></div>
          <div className="scanner-plane-list">
            {result.edges.map((edge) => (
              <div className={`scanner-plane-row ${edge.status === 'supported' ? 'scanner-plane-row-selected' : 'scanner-plane-row-secondary'}`} key={edge.id}>
                <span>
                  <strong>{edge.id}</strong>
                  <small>{edge.status} | {edge.type} | {edge.surfaceAId} / {edge.surfaceBId} | source {edge.sourceIntersectionId}</small>
                </span>
                <span>
                  {formatPoint(edge.start)} → {formatPoint(edge.end)} | length {edge.lengthMeters.toFixed(2)} m | confidence {edge.confidence.toFixed(2)} | nodes {edge.startNodeId ?? 'none'} / {edge.endNodeId ?? 'none'}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {result.corners.length > 0 ? (
        <>
          <div className="scanner-analysis-timings"><span>Structural corner nodes</span></div>
          <div className="scanner-plane-list">
            {result.corners.map((corner) => (
              <div className={`scanner-plane-row ${corner.status === 'supported' ? 'scanner-plane-row-selected' : 'scanner-plane-row-secondary'}`} key={corner.id}>
                <span>
                  <strong>{corner.id}</strong>
                  <small>{corner.status} | surfaces {corner.surfaceIds.join(', ')} | edges {corner.sourceEdgeIds.join(', ')}</small>
                </span>
                <span>
                  position {formatPoint(corner.position)} | confidence {corner.confidence.toFixed(2)} | discovery {corner.discoverySources.join(' + ') || 'unknown'} | merged candidates {corner.mergedCandidateIds.join(', ') || 'none'} | solver {corner.threePlaneSolverStatus} | support {corner.supportNearCorner.map((support) => `${support.surfaceId} ${support.supportCount}`).join(', ') || 'n/a'} | segment gap {corner.segmentGapMeters.toFixed(2)} m | max/mean extension {corner.maximumExtensionMeters.toFixed(2)} / {corner.meanExtensionMeters.toFixed(2)} m | extensions {corner.extensionDistances.map((extension) => `${extension.edgeId} ${extension.distanceMeters.toFixed(2)} m`).join(', ') || 'none'} | edge parameters {corner.edgeEvaluations.map((evaluation) => `${evaluation.edgeId} t ${evaluation.tCorner === null ? 'n/a' : evaluation.tCorner.toFixed(3)} in [${evaluation.tStart === null ? 'n/a' : evaluation.tStart.toFixed(3)},${evaluation.tEnd === null ? 'n/a' : evaluation.tEnd.toFixed(3)}]`).join(', ') || 'n/a'} | plane residuals {corner.planeResiduals.map((residual) => `${residual.surfaceId} ${residual.residualMeters.toExponential(1)}`).join(', ') || 'none'} | {corner.reason}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {result.cornerDeduplicationDiagnostics.length > 0 ? (
        <>
          <div className="scanner-analysis-timings"><span>Canonical corner deduplication</span></div>
          <div className="scanner-plane-list">
            {result.cornerDeduplicationDiagnostics.map((diagnostic) => (
              <div className="scanner-plane-row scanner-plane-row-secondary" key={diagnostic.duplicateCandidateId}>
                <span>
                  <strong>{diagnostic.duplicateCandidateId}</strong>
                  <small>suppressed duplicate of {diagnostic.canonicalCandidateId}</small>
                </span>
                <span>
                  distance {diagnostic.distanceMeters.toFixed(3)} m | surface set match {diagnostic.surfaceSetMatch ? 'yes' : 'no'} | source-edge topology match {diagnostic.sourceEdgeTopologyMatch ? 'yes' : 'no'} | {diagnostic.reason}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {result.cornerCandidates.some((candidate) => candidate.status === 'rejected') ? (
        <>
          <div className="scanner-analysis-timings"><span>Corner candidate diagnostics</span></div>
          <div className="scanner-plane-list">
            {result.cornerCandidates.filter((candidate) => candidate.status === 'rejected').slice(0, 8).map((candidate) => (
              <div className="scanner-plane-row scanner-plane-row-secondary" key={candidate.id}>
                <span>
                  <strong>{candidate.id}</strong>
                  <small>{candidate.status} | {candidate.source} | endpoint cluster candidate {candidate.endpointClusterCandidate ? 'yes' : 'no'} | surfaces {candidate.surfaceIds.join(', ')}</small>
                </span>
                <span>
                  point {candidate.position ? formatPoint(candidate.position) : 'none'} | solver {candidate.threePlaneSolverStatus} | edges {candidate.sourceEdgeIds.join(', ') || 'none'} | support {candidate.supportNearCorner.map((support) => `${support.surfaceId} ${support.supportCount}`).join(', ') || 'n/a'} | max extension {candidate.maximumExtensionMeters.toFixed(2)} m | gate {candidate.failedGate ?? 'none'} | {candidate.reason}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}

function RoomSurfaceSummary({
  result,
}: {
  result: RoomSurfaceConstructionResult
}) {
  return (
    <section className="scanner-analysis-result" aria-labelledby="room-surfaces-title">
      <div className="scanner-analysis-result-header">
        <div>
          <span className="scanner-analysis-label" id="room-surfaces-title">
            Room surfaces
          </span>
          <span className="scanner-analysis-copy">
            Bounded measured patches from selected structural planes; no missing room geometry is closed or guessed.
          </span>
        </div>
        <strong>{result.surfaces.length}</strong>
      </div>
      <div className="scanner-analysis-stats">
        <div>
          <span>Selected surfaces</span>
          <strong>{result.diagnostics.inputSelectedSurfaceCount}</strong>
        </div>
        <div>
          <span>Constructed patches</span>
          <strong>{result.diagnostics.constructedPatchCount}</strong>
        </div>
        <div>
          <span>Walls / ceiling / floor</span>
          <strong>{result.diagnostics.wallPatchCount} / {result.diagnostics.ceilingPatchCount} / {result.diagnostics.floorPatchCount}</strong>
        </div>
        <div>
          <span>Skipped patches</span>
          <strong>{result.diagnostics.skippedSurfaceIds.length}</strong>
        </div>
      </div>
      <div className="scanner-analysis-timings">
        <span>
          Timing: basis {result.timings.basisConstructionMs.toFixed(1)} ms | support projection {result.timings.supportProjectionMs.toFixed(1)} ms | polygon {result.timings.polygonConstructionMs.toFixed(1)} ms | triangulation {result.timings.triangulationMs.toFixed(1)} ms | total {result.timings.totalMs.toFixed(1)} ms
        </span>
      </div>
      {result.surfaces.length > 0 ? (
        <div className="scanner-plane-list">
          {result.surfaces.map((surface) => (
            <div className="scanner-plane-row scanner-plane-row-selected" key={surface.id}>
              <span>
                <strong>{surface.sourceSurfaceId}</strong>
                <small>{surface.role} | {surface.completionStatus} | confidence {surface.confidence.toFixed(2)}</small>
              </span>
              <span>
                {surface.vertices3D.length} vertices / {surface.triangleIndices.length / 3} triangles | area {surface.areaMetersSquared.toFixed(2)} m2 | support {surface.supportPointCount} | structural edges {surface.structuralEdgeCount} | support edges {surface.supportDerivedEdgeCount} | corners {surface.canonicalCornerCount} | plane residual {surface.maximumPlaneResidualMeters.toExponential(1)} | basis round-trip {surface.maximumBasisRoundTripResidualMeters.toExponential(1)} | triangulation {surface.triangulationValid ? 'valid' : 'invalid'}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="scanner-analysis-empty">No selected structural surfaces produced a bounded patch.</p>
      )}
      {result.diagnostics.warnings.length > 0 ? (
        <div className="scanner-analysis-timings">
          <span>{result.diagnostics.warnings.join(' | ')}</span>
        </div>
      ) : null}
    </section>
  )
}

function ScannerFinishedView({
  onDiscardScan,
  onStartNewScan,
  scan,
}: ScannerFinishedViewProps) {
  const [analysisService] = useState(() => new PlaneExtractionService())
  const [boundaryService] = useState(() => new RoomBoundaryReconstructionService())
  const [interpretationService] = useState(() => new StructuralSurfaceInterpretationService())
  const [intersectionService] = useState(() => new StructuralIntersectionService())
  const [surfaceConstructionService] = useState(() => new RoomSurfaceConstructionService())
  const [analysisResult, setAnalysisResult] = useState<RoomAnalysisResult | null>(null)
  const [interpretationResult, setInterpretationResult] = useState<RoomStructureInterpretationResult | null>(null)
  const [intersectionResult, setIntersectionResult] = useState<StructuralIntersectionResult | null>(null)
  const [supportConsistencyWarnings, setSupportConsistencyWarnings] = useState<readonly string[]>([])
  const [boundaryResult, setBoundaryResult] = useState<RoomBoundaryResult | null>(null)
  const [roomSurfaceResult, setRoomSurfaceResult] = useState<RoomSurfaceConstructionResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const analysisTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      mountedRef.current = false
      if (analysisTimerRef.current !== null) {
        window.clearTimeout(analysisTimerRef.current)
      }
    }
  }, [])

  const analyzeSurfaces = (): void => {
    if (isAnalyzing) {
      return
    }

    setIsAnalyzing(true)
    setAnalysisError(null)
    setAnalysisResult(null)
    setInterpretationResult(null)
    setIntersectionResult(null)
    setSupportConsistencyWarnings([])
    setBoundaryResult(null)
    setRoomSurfaceResult(null)
    analysisTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) {
        return
      }

      try {
        const nextAnalysisResult = analysisService.analyze(scan)
        const nextInterpretationResult = interpretationService.interpret(nextAnalysisResult, scan.referenceSpaceType, scan)
        const nextIntersectionResult = intersectionService.analyze(nextInterpretationResult, scan)
        const nextBoundaryResult = boundaryService.reconstruct(nextInterpretationResult, nextIntersectionResult)
        const nextRoomSurfaceResult = surfaceConstructionService.construct(nextInterpretationResult, nextBoundaryResult, scan)
        const nextSupportConsistencyWarnings = import.meta.env.DEV
          ? getStructuralSupportConsistencyWarnings(nextInterpretationResult, nextIntersectionResult)
          : []
        setAnalysisResult(nextAnalysisResult)
        setInterpretationResult(nextInterpretationResult)
        setIntersectionResult(nextIntersectionResult)
        setSupportConsistencyWarnings(nextSupportConsistencyWarnings)
        setBoundaryResult(nextBoundaryResult)
        setRoomSurfaceResult(nextRoomSurfaceResult)
      } catch (error: unknown) {
        setAnalysisError(
          error instanceof Error
            ? error.message
            : 'Surface analysis could not be completed.',
        )
      } finally {
        analysisTimerRef.current = null
        setIsAnalyzing(false)
      }
    }, 0)
  }

  return (
    <section className="scanner-complete" aria-labelledby="scanner-complete-title">
      <span className="scanner-eyebrow">Milestone 07 / Structural room interpretation</span>
      <h1 className="scanner-title" id="scanner-complete-title">
        Scan <em>complete.</em>
      </h1>
      <p className="scanner-description">
        Your captured spatial observations are ready for a later room-processing stage.
      </p>
      <div className="scanner-build-info" aria-label="Scanner build information">
        <span>Scanner Build: {BUILD_INFO.scannerMilestone}</span>
        <span>Commit: {BUILD_INFO.commit}</span>
      </div>

      <div className="scanner-analysis-controls">
        <div>
          <span className="scanner-analysis-label">Post-scan geometry analysis</span>
          <span className="scanner-analysis-copy">
            Extract geometric planes and interpret likely room-surface roles from finalized spatial data.
          </span>
        </div>
        <button
          type="button"
          className="scan-button scan-button-secondary"
          disabled={isAnalyzing}
          onClick={analyzeSurfaces}
        >
          {isAnalyzing ? 'Analyzing...' : analysisResult ? 'Analyze Again' : 'Analyze Surfaces'}
        </button>
      </div>
      {analysisError ? <p className="session-error" role="alert">{analysisError}</p> : null}

      {scan.coverage.length > 0 || scan.fusedSurface.length > 0 ? (
        <FinalizedSpatialScanPreview
          analysisResult={analysisResult}
          scan={scan}
          roomBoundary={boundaryResult}
          roomSurfaceConstruction={roomSurfaceResult}
          structuralIntersections={intersectionResult}
          structuralInterpretation={interpretationResult}
        />
      ) : (
        <div className="scanner-complete-empty">
          <strong>No spatial surfaces were captured.</strong>
          <span>
            Start another scan and move slowly across physical surfaces before finishing.
          </span>
        </div>
      )}

      {analysisResult ? (
        <>
          <AnalysisResultSummary analysisResult={analysisResult} />
          {interpretationResult ? <StructuralSurfaceSummary interpretation={interpretationResult} /> : null}
          {intersectionResult ? <StructuralIntersectionSummary result={intersectionResult} consistencyWarnings={supportConsistencyWarnings} /> : null}
          {boundaryResult ? <RoomBoundarySummary result={boundaryResult} /> : null}
          {roomSurfaceResult ? <RoomSurfaceSummary result={roomSurfaceResult} /> : null}
          {analysisResult.stats.provisionalPlaneCount > 0 ? (
        <section className="scanner-analysis-result" aria-labelledby="legacy-scanner-analysis-title">
          <div className="scanner-analysis-result-header">
            <div>
              <span className="scanner-analysis-label" id="legacy-scanner-analysis-title">
                Legacy analysis diagnostics
              </span>
              <span className="scanner-analysis-copy">
                Geometric candidates only; no wall, floor, or ceiling classification is applied.
              </span>
            </div>
            <strong>{analysisResult.stats.planeCount}</strong>
          </div>
          <div className="scanner-analysis-timings">
            <span>Analysis method: Global dominant planes (position-first, deterministic RANSAC)</span>
          </div>
          <div className="scanner-analysis-stats">
            <div>
              <span>Fused analysis input</span>
              <strong>{analysisResult.stats.inputPoints}</strong>
            </div>
            <div>
              <span>Coverage geometry points</span>
              <strong>{analysisResult.stats.coverageGeometryPoints}</strong>
            </div>
            <div>
              <span>Finalized fused surfels</span>
              <strong>{analysisResult.stats.finalizedFusedSurfelCount}</strong>
            </div>
            <div>
              <span>Analysis filtered surfels</span>
              <strong>{analysisResult.stats.analysisFilteredSurfelCount}</strong>
            </div>
            <div>
              <span>Analysis downsampled surfels</span>
              <strong>{analysisResult.stats.analysisDownsampledSurfelCount}</strong>
            </div>
            <div>
              <span>Filtered / downsampled</span>
              <strong>{analysisResult.stats.filteredPoints} / {analysisResult.stats.downsampledPoints}</strong>
            </div>
            <div>
              <span>Raw RANSAC planes</span>
              <strong>{analysisResult.stats.rawRansacPlaneCount}</strong>
            </div>
            <div>
              <span>Final surface planes</span>
              <strong>{analysisResult.stats.finalConsolidatedPlaneCount}</strong>
            </div>
            <div>
              <span>Surface families</span>
              <strong>{analysisResult.stats.surfaceFamilyClusterCount}</strong>
            </div>
            <div>
              <span>Assigned points</span>
              <strong>{analysisResult.stats.assignedPoints} ({analysisResult.stats.assignedPercentage.toFixed(1)}%)</strong>
            </div>
            <div>
              <span>Unassigned points</span>
              <strong>{analysisResult.stats.unassignedPoints}</strong>
            </div>
            <div>
              <span>Analysis time</span>
              <strong>{analysisResult.timings.totalMs.toFixed(1)} ms</strong>
            </div>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Preparation {analysisResult.timings.inputPreparationMs.toFixed(1)} ms · downsampling {analysisResult.timings.downsamplingMs.toFixed(1)} ms · initial extraction {analysisResult.timings.initialExtractionMs.toFixed(1)} ms · consolidation {analysisResult.timings.consolidationMs.toFixed(1)} ms · ownership {analysisResult.timings.ownershipMs.toFixed(1)} ms
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Candidate pairs {analysisResult.stats.candidatePairsTested} · high-overlap pairs {analysisResult.stats.highOverlapCandidatePairs} · merged {analysisResult.stats.candidatesMerged} · duplicate suppressions {analysisResult.stats.duplicateCandidatesSuppressed} · average support overlap {(analysisResult.stats.averageSupportOverlap * 100).toFixed(1)}%
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Largest plane {analysisResult.stats.largestPlaneSupportPointCount} pts · occupied {analysisResult.stats.largestPlaneOccupiedArea.toFixed(2)} m² · RMS {analysisResult.stats.largestPlaneRmsError.toFixed(3)} m
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Dominant expansion {analysisResult.timings.dominantExpansionMs.toFixed(1)} ms · seeds {analysisResult.stats.dominantSeedsAttempted} · accepted {analysisResult.stats.dominantPlanesAccepted} · absorbed points {analysisResult.stats.pointsAbsorbedDuringExpansion} · absorbed fragments {analysisResult.stats.fragmentsAbsorbedDuringExpansion} · passes {analysisResult.stats.expansionPasses} · refits {analysisResult.stats.planeRefits}
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Expansion rejects: residual {analysisResult.stats.expansionResidualRejects} · normal {analysisResult.stats.expansionNormalRejects} · connectivity {analysisResult.stats.expansionConnectivityRejects}
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Largest support {analysisResult.stats.largestPlaneSupportPercentage.toFixed(1)}% of assigned points · second plane {analysisResult.stats.secondLargestPlaneSupportPointCount} pts / {analysisResult.stats.secondLargestPlaneOccupiedArea.toFixed(2)} m² / RMS {analysisResult.stats.secondLargestPlaneRmsError.toFixed(3)} m
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Global reassembly {analysisResult.timings.globalReassemblyMs.toFixed(1)} ms | parameter clusters {analysisResult.stats.planeParameterClusterCount} | seeds {analysisResult.stats.globalPlanesAttempted} | accepted {analysisResult.stats.globalPlanesAccepted} | absorbed points {analysisResult.stats.globalPointsAbsorbed} | absorbed fragments {analysisResult.stats.globalFragmentsAbsorbed} | passes {analysisResult.stats.globalExpansionPasses} | refits {analysisResult.stats.globalPlaneRefits}
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Global support rejects: residual {analysisResult.stats.globalResidualRejects} | normal {analysisResult.stats.globalNormalRejects} | projected support {analysisResult.stats.globalSupportRejects}
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Largest support {analysisResult.stats.largestPlaneSupportPercentage.toFixed(1)}% | second support {analysisResult.stats.secondLargestPlaneSupportPercentage.toFixed(1)}% | top 3 support {analysisResult.stats.topThreePlaneSupportPercentage.toFixed(1)}% of assigned points
            </span>
          </div>
          {analysisResult.planeRelationships.length > 0 ? (
            <div className="scanner-analysis-timings">
              <span>
                Top plane relations: {analysisResult.planeRelationships.map((relationship) => `${relationship.firstPlaneId}/${relationship.secondPlaneId} ${relationship.angularDifferenceDegrees.toFixed(1)} deg / delta d ${relationship.planeOffsetDifferenceMeters.toFixed(3)} m`).join(' | ')}
              </span>
            </div>
          ) : null}
          {analysisResult.planes.slice(0, 5).map((plane) => (
            <div className="scanner-analysis-timings" key={`plane-diagnostic-${plane.id}`}>
              <span>
                {plane.id} normal ({plane.normal.x.toFixed(2)}, {plane.normal.y.toFixed(2)}, {plane.normal.z.toFixed(2)}) · d {(-plane.planeConstant).toFixed(3)}
              </span>
            </div>
          ))}
          <div className="scanner-analysis-timings">
            <span>
              RANSAC hypotheses {analysisResult.stats.ransacHypothesesTested} · degenerate rejected {analysisResult.stats.degenerateHypothesesRejected} · accepted dominant planes {analysisResult.stats.acceptedDominantPlaneCount}
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              Best hypothesis {analysisResult.stats.bestHypothesisInitialInliers} inliers · weighted support {analysisResult.stats.bestHypothesisWeightedSupport.toFixed(1)} · RMS {analysisResult.stats.bestHypothesisInitialRms.toFixed(3)} m · refined {analysisResult.stats.refinedSupportPointCount} points / {analysisResult.stats.refinedOccupiedArea.toFixed(2)} m² / RMS {analysisResult.stats.refinedRmsError.toFixed(3)} m
            </span>
          </div>
          <div className="scanner-analysis-timings">
            <span>
              RANSAC {analysisResult.timings.ransacMs.toFixed(1)} ms · refinement {analysisResult.timings.refinementMs.toFixed(1)} ms · iterations per plane {analysisResult.ransacIterationsPerPlane.join(', ') || 'N/A'}
            </span>
          </div>
          {analysisResult.planes.length > 0 ? (
            <div className="scanner-plane-list">
              {analysisResult.planes.map((plane) => (
                <div className="scanner-plane-row" key={plane.id}>
                  <span>
                    <strong>{plane.id}</strong>
                    <small>
                      {plane.orientationCategory} · {plane.orientationAngleDegrees.toFixed(0)}° from world-up normal
                    </small>
                  </span>
                  <span>
                    {plane.supportPointCount} pts · {plane.areaEstimate.toFixed(2)} m² · RMS {plane.rmsError.toFixed(3)} m
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="scanner-analysis-empty">
              Not enough stable spatial data to detect major surfaces.
            </p>
          )}
        </section>
          ) : null}
        </>
      ) : null}

      <div className="scanner-complete-card">
        <div className="scanner-complete-summary">
          <span>Scan duration</span>
          <strong>{formatDuration(scan.durationMs)}</strong>
        </div>

        <div className="scanner-complete-stats">
          <div>
            <span>Unique spatial cells</span>
            <strong>{scan.statistics.uniqueCells}</strong>
          </div>
          <div>
            <span>Captured cells</span>
            <strong>{scan.statistics.capturedCells}</strong>
          </div>
          <div>
            <span>Partial cells</span>
            <strong>{scan.statistics.partialCells}</strong>
          </div>
          <div>
            <span>Observed cells</span>
            <strong>{scan.statistics.observedCells}</strong>
          </div>
          <div>
            <span>Captured / stored cells</span>
            <strong>{formatCapturedShare(scan)}</strong>
          </div>
        </div>
      </div>

      <div className="scanner-complete-actions">
        <button type="button" className="scan-button" onClick={onStartNewScan}>
          Start New Scan
        </button>
        <button
          type="button"
          className="scan-button scan-button-secondary"
          onClick={onDiscardScan}
        >
          Discard Scan
        </button>
      </div>
    </section>
  )
}

export default ScannerFinishedView

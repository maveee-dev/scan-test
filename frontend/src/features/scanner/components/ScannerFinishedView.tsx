import { useEffect, useRef, useState } from 'react'
import type { FinalizedSpatialScan } from '../types'
import { PlaneExtractionService } from '../../room-analysis/services/planeExtractionService'
import type { RoomAnalysisResult } from '../../room-analysis/types'
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

function ScannerFinishedView({
  onDiscardScan,
  onStartNewScan,
  scan,
}: ScannerFinishedViewProps) {
  const [analysisService] = useState(() => new PlaneExtractionService())
  const [analysisResult, setAnalysisResult] = useState<RoomAnalysisResult | null>(null)
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
    analysisTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) {
        return
      }

      try {
        setAnalysisResult(analysisService.analyze(scan))
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
      <span className="scanner-eyebrow">Milestone 06 / Finalized spatial scan</span>
      <h1 className="scanner-title" id="scanner-complete-title">
        Scan <em>complete.</em>
      </h1>
      <p className="scanner-description">
        Your captured spatial observations are ready for a later room-processing stage.
      </p>

      <div className="scanner-analysis-controls">
        <div>
          <span className="scanner-analysis-label">Post-scan geometry analysis</span>
          <span className="scanner-analysis-copy">
            Extract bounded geometric plane candidates from finalized spatial data.
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

      {scan.coverage.length > 0 ? (
        <FinalizedSpatialScanPreview analysisResult={analysisResult} scan={scan} />
      ) : (
        <div className="scanner-complete-empty">
          <strong>No spatial surfaces were captured.</strong>
          <span>
            Start another scan and move slowly across physical surfaces before finishing.
          </span>
        </div>
      )}

      {analysisResult ? (
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
            <strong>{analysisResult.stats.planeCount}</strong>
          </div>
          <div className="scanner-analysis-stats">
            <div>
              <span>Input points</span>
              <strong>{analysisResult.stats.inputPoints}</strong>
            </div>
            <div>
              <span>Filtered / downsampled</span>
              <strong>{analysisResult.stats.filteredPoints} / {analysisResult.stats.downsampledPoints}</strong>
            </div>
            <div>
              <span>Provisional planes</span>
              <strong>{analysisResult.stats.provisionalPlaneCount}</strong>
            </div>
            <div>
              <span>Consolidated planes</span>
              <strong>{analysisResult.stats.planeCount}</strong>
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

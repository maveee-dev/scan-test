import type { LoadedScanReplayReview } from '../services/scanReplayLoadService'
import RealityQualityPreview from './RealityQualityPreview'

interface ScannerLoadedReplayViewProps {
  review: LoadedScanReplayReview
  onLoadAnotherScan: () => void
}

export default function ScannerLoadedReplayView({
  onLoadAnotherScan,
  review,
}: ScannerLoadedReplayViewProps) {
  const { reconstruction } = review

  return (
    <section className="scanner-complete scanner-loaded-replay" aria-labelledby="loaded-scan-title">
      <span className="scanner-eyebrow">Local replay / Saved scan capture</span>
      <h1 className="scanner-title" id="loaded-scan-title">
        Scan <em>loaded.</em>
      </h1>
      <p className="scanner-description">
        This room was rebuilt in your browser from the selected file. The capture stays on this device.
      </p>

      <div className="scanner-build-info" aria-label="Loaded scan details">
        <span>File: {review.fileName}</span>
        <span>Captured build: {review.capturedBuild}</span>
      </div>

      {reconstruction.surfels.length > 0 ? (
        <RealityQualityPreview source={reconstruction} replayMode />
      ) : (
        <div className="scanner-complete-empty">
          <strong>No measured room geometry could be reconstructed from this capture.</strong>
          <span>The saved file was valid, but its depth measurements did not produce a viewable model.</span>
        </div>
      )}

      <div className="scanner-complete-card scanner-loaded-replay-stats">
        <div className="scanner-complete-summary">
          <span>Saved frames</span>
          <strong>{review.frameCount}</strong>
        </div>
        <div className="scanner-complete-stats">
          <div>
            <span>Retained measurements</span>
            <strong>{review.sampleCount.toLocaleString()}</strong>
          </div>
          <div>
            <span>Reconstructed surfels</span>
            <strong>{reconstruction.surfels.length.toLocaleString()}</strong>
          </div>
        </div>
      </div>

      <div className="scanner-complete-actions">
        <button type="button" className="scan-button" onClick={onLoadAnotherScan}>
          Load Another Scan
        </button>
      </div>
    </section>
  )
}

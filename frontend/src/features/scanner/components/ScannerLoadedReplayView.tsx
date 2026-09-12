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
        This room was loaded in your browser from the selected file. The scan stays on this device.
      </p>

      <div className="scanner-build-info" aria-label="Loaded scan details">
        <span>File: {review.fileName}</span>
        <span>Captured build: {review.capturedBuild}</span>
      </div>

      {reconstruction.surfels.length > 0 ? (
        <RealityQualityPreview source={reconstruction} replayMode replayDescription={review.previewDescription} />
      ) : (
        <div className="scanner-complete-empty">
          <strong>This saved scan does not contain viewable room geometry.</strong>
          <span>The file was valid, but it did not include a room model to display.</span>
        </div>
      )}

      <div className="scanner-complete-card scanner-loaded-replay-stats">
        {review.frameCount !== null ? <div className="scanner-complete-summary">
          <span>Saved frames</span>
          <strong>{review.frameCount.toLocaleString()}</strong>
        </div> : null}
        <div className="scanner-complete-stats">
          {review.sampleCount !== null ? <div>
            <span>{review.sampleLabel}</span>
            <strong>{review.sampleCount.toLocaleString()}</strong>
          </div> : null}
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

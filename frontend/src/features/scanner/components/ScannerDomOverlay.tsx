import type { ScannerSessionState } from '../types'

interface ScannerDomOverlayProps {
  onStopScan: () => void
  sessionState: ScannerSessionState
}

function formatCoordinate(value: number | undefined): string {
  return value === undefined ? 'N/A' : value.toFixed(2)
}

function ScannerDomOverlay({ onStopScan, sessionState }: ScannerDomOverlayProps) {
  const isStarting = sessionState.status === 'starting'
  const isStopping = sessionState.status === 'stopping'

  return (
    <section className="xr-dom-overlay-panel" aria-label="Spatial Scanner controls">
      <div className="xr-dom-overlay-header">
        <span className="xr-dom-overlay-title">Spatial Scanner</span>
        <span className="xr-dom-overlay-state">DOM overlay active</span>
      </div>

      <div className="xr-dom-overlay-session">
        <span className="xr-dom-overlay-dot" aria-hidden="true" />
        <span>{isStarting ? 'XR session starting' : 'Scanning session active'}</span>
      </div>

      <div className="xr-dom-overlay-tracking">
        <span
          className={`xr-dom-overlay-tracking-dot ${sessionState.debug.trackingActive ? 'is-tracking' : 'is-lost'}`}
          aria-hidden="true"
        />
        <span>
          {sessionState.debug.trackingActive
            ? 'Tracking active'
            : 'Viewer pose temporarily unavailable'}
        </span>
      </div>

      <div className="xr-dom-overlay-meta">
        <div>
          <span>Reference space</span>
          <strong>{sessionState.debug.referenceSpaceType ?? 'pending'}</strong>
        </div>
        <div>
          <span>Frames sampled</span>
          <strong>{sessionState.debug.sampledFrameCount}</strong>
        </div>
      </div>

      <div className="xr-dom-overlay-position" aria-label="Approximate viewer position">
        <div>
          <span>X</span>
          <strong>{formatCoordinate(sessionState.debug.position?.x)}</strong>
        </div>
        <div>
          <span>Y</span>
          <strong>{formatCoordinate(sessionState.debug.position?.y)}</strong>
        </div>
        <div>
          <span>Z</span>
          <strong>{formatCoordinate(sessionState.debug.position?.z)}</strong>
        </div>
      </div>

      <button
        type="button"
        className="xr-dom-overlay-stop"
        disabled={isStopping}
        onClick={onStopScan}
      >
        {isStopping ? 'Stopping...' : 'Stop Scan'}
      </button>
    </section>
  )
}

export default ScannerDomOverlay

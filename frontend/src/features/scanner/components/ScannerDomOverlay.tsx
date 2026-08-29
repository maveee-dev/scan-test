import type {
  ReferenceSpaceStatus,
  ScannerSessionState,
  XRPresentationStatus,
} from '../types'

interface ScannerDomOverlayProps {
  onStopScan: () => void
  sessionState: ScannerSessionState
}

function formatCoordinate(value: number | undefined): string {
  return value === undefined ? 'N/A' : value.toFixed(2)
}

function formatPresentationStatus(status: XRPresentationStatus): string {
  if (status === 'ready') {
    return 'Ready'
  }

  if (status === 'failed') {
    return 'Failed'
  }

  return 'Pending'
}

function formatReferenceSpaceStatus(status: ReferenceSpaceStatus): string {
  if (status === 'local-floor' || status === 'local') {
    return status
  }

  if (status === 'requesting') {
    return 'Requesting'
  }

  if (status === 'failed') {
    return 'Failed'
  }

  return 'Idle'
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

      <div className="xr-dom-overlay-diagnostics">
        <div>
          <span>XR session</span>
          <strong>{sessionState.debug.sessionActive ? 'Active' : 'Ended'}</strong>
        </div>
        <div>
          <span>WebGL context</span>
          <strong>{formatPresentationStatus(sessionState.debug.glContextStatus)}</strong>
        </div>
        <div>
          <span>XR base layer</span>
          <strong>{formatPresentationStatus(sessionState.debug.baseLayerStatus)}</strong>
        </div>
        <div>
          <span>Reference space</span>
          <strong>{formatReferenceSpaceStatus(sessionState.debug.referenceSpaceStatus)}</strong>
        </div>
      </div>

      <div className="xr-dom-overlay-tracking">
        <span
          className={`xr-dom-overlay-tracking-dot ${sessionState.debug.trackingStatus === 'active' ? 'is-tracking' : 'is-lost'}`}
          aria-hidden="true"
        />
        <span>
          {sessionState.debug.trackingStatus === 'active'
            ? 'Tracking active'
            : 'Tracking waiting for viewer pose'}
        </span>
      </div>

      <div className="xr-dom-overlay-counts">
        <div>
          <span>XR frames received</span>
          <strong>{sessionState.debug.xrFrameCount}</strong>
        </div>
        <div>
          <span>Valid poses received</span>
          <strong>{sessionState.debug.poseSampleCount}</strong>
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

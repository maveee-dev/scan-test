import type { RefObject } from 'react'
import type {
  DepthSensingStatus,
  ScannerCapabilities,
  ScannerCheckStatus,
  ScannerSessionState,
  SpatialGeometrySource,
} from '../types'
import '../../../App.css'
import ScannerDomOverlay from './ScannerDomOverlay'
import ScannerFinishedView from './ScannerFinishedView'

interface ScannerPageProps {
  status: ScannerCheckStatus
  capabilities: ScannerCapabilities | null
  canStartScan: boolean
  overlayRootRef: RefObject<HTMLDivElement | null>
  pointPreviewCanvasRef: RefObject<HTMLCanvasElement | null>
  sessionState: ScannerSessionState
  onStartScan: () => void
  onCancelScan: () => void
  onFinishScan: () => void
  onStartNewScan: () => void
  onDiscardScan: () => void
}

interface CapabilityRowProps {
  description: string
  icon: 'webxr' | 'ar'
  isSupported: boolean
  label: string
  status: ScannerCheckStatus
}

function CapabilityIcon({ icon }: Pick<CapabilityRowProps, 'icon'>) {
  if (icon === 'ar') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="1.4" />
        <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12.1V21" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="m8 10.5 4 2.2 4-2.2M12 12.7V20" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function CapabilityRow({ description, icon, isSupported, label, status }: CapabilityRowProps) {
  const isChecking = status === 'checking'
  const stateLabel = isChecking ? 'Checking' : isSupported ? 'Available' : 'Unavailable'
  const stateClassName = isChecking
    ? 'is-checking'
    : isSupported
      ? 'is-supported'
      : 'is-unsupported'

  return (
    <div className="capability-row">
      <span className="capability-icon">
        <CapabilityIcon icon={icon} />
      </span>
      <span>
        <span className="capability-name">{label}</span>
        <span className="capability-description">{description}</span>
      </span>
      <span className={`capability-state ${stateClassName}`} role="status">
        {stateLabel}
      </span>
    </div>
  )
}

function formatCoordinate(value: number | undefined): string {
  return value === undefined ? 'N/A' : value.toFixed(2)
}

function formatDepthStatus(status: DepthSensingStatus): string {
  switch (status) {
    case 'requesting':
      return 'Requesting'
    case 'active':
      return 'Active'
    case 'gpu-selected':
      return 'GPU selected'
    case 'unavailable':
      return 'Unavailable'
    case 'error':
      return 'Error'
    default:
      return 'Idle'
  }
}

function formatSpatialSource(source: SpatialGeometrySource): string {
  switch (source) {
    case 'depth':
      return 'Depth geometry'
    case 'view':
      return 'XR view fallback'
    default:
      return 'Unavailable'
  }
}

function ScannerPage({
  capabilities,
  canStartScan,
  onCancelScan,
  onDiscardScan,
  onFinishScan,
  onStartScan,
  onStartNewScan,
  overlayRootRef,
  pointPreviewCanvasRef,
  sessionState,
  status,
}: ScannerPageProps) {
  const isChecking = status === 'checking'
  const allSupported = capabilities?.webxr === true && capabilities.immersiveAr === true
  const isStarting = sessionState.status === 'starting'
  const isScanning = sessionState.status === 'scanning'
  const isFinishing = sessionState.status === 'finishing'
  const isCancelling = sessionState.status === 'cancelling'
  const isActive = isStarting || isScanning || isFinishing || isCancelling
  const isEnding = isFinishing || isCancelling
  const isFinished = sessionState.status === 'finished' && sessionState.finalizedScan !== null
  const isDomOverlayActive =
    sessionState.domOverlayStatus === 'active' &&
    isActive
  const isDomOverlayUnavailable = sessionState.domOverlayStatus === 'unavailable'
  const statusLabel = isStarting
    ? 'Starting session'
    : isFinishing
      ? 'Finishing scan'
      : isCancelling
        ? 'Cancelling scan'
      : isActive
        ? 'Session active'
        : sessionState.status === 'error'
            ? 'Session error'
            : sessionState.status === 'finished'
              ? 'Scan complete'
              : 'Ready to scan'
  const statusDescription = isStarting
    ? 'Requesting camera and spatial tracking access.'
    : isFinishing
      ? 'Creating an independent snapshot before cleanup.'
      : isCancelling
        ? 'Discarding the active scan and ending XR.'
      : isActive
        ? 'Marking observed physical surfaces in world-anchored coverage.'
        : 'Start a session to verify device pose tracking.'
  const sessionTag = isStarting
    ? 'Creating session'
    : isActive
      ? 'Session active'
      : isFinished
        ? 'Finished scan'
      : 'No session started'
  const visualLabel = isStarting
    ? 'START'
    : isActive
      ? 'LIVE'
      : sessionState.status === 'error'
        ? 'RETRY'
        : 'READY'

  return (
    <div className="scanner-shell">
      <div className="scanner-noise" aria-hidden="true" />
      <div
        ref={overlayRootRef}
        className={`xr-dom-overlay ${isDomOverlayActive ? 'is-visible' : ''}`}
      >
        <ScannerDomOverlay
          onCancelScan={onCancelScan}
          onFinishScan={onFinishScan}
          pointPreviewCanvasRef={pointPreviewCanvasRef}
          sessionState={sessionState}
        />
      </div>
      <div className="scanner-content">
        <header className="scanner-header">
          <span className="brand-lockup">
            <span className="brand-mark" aria-hidden="true" />
            Spatial Scanner
          </span>
          <span className="header-status">System online</span>
        </header>

        <main
          className="scanner-main"
          aria-labelledby={isFinished ? undefined : 'scanner-title'}
          aria-label={isFinished ? 'Finalized spatial scan' : undefined}
        >
          {isFinished && sessionState.finalizedScan ? (
            <ScannerFinishedView
              onDiscardScan={onDiscardScan}
              onStartNewScan={onStartNewScan}
              scan={sessionState.finalizedScan}
            />
          ) : (
            <>
          <section className="scanner-intro">
            <span className="scanner-eyebrow">Milestone 05.1 / World-anchored coverage</span>
            <h1 className="scanner-title" id="scanner-title">
              Scan the <em>space</em> around you.
            </h1>
            <p className="scanner-description">
              Start an immersive AR session to mark observed physical surfaces in stable world-space coverage.
            </p>
          </section>

          <div className="scanner-visual" aria-hidden="true">
            <div className="scanner-grid" />
            <span className="scanner-sweep" />
            <span className="scanner-orbit orbit-one" />
            <span className="scanner-orbit orbit-two" />
            <span className="scanner-visual-center">{visualLabel}</span>
          </div>

          <section className="capability-card" aria-labelledby="capability-title">
            <div className="capability-card-header">
              <div>
                <h2 className="capability-card-title" id="capability-title">
                  Device readiness
                </h2>
                <p className="capability-card-copy">
                  Confirm support, then inspect live pose, depth, and world-anchored coverage.
                </p>
              </div>
              <span className="capability-tag">{sessionTag}</span>
            </div>

            <div className="capability-list" aria-live="polite">
              <CapabilityRow
                description="Browser spatial runtime"
                icon="webxr"
                isSupported={capabilities?.webxr ?? false}
                label="WebXR Device API"
                status={status}
              />
              <CapabilityRow
                description="World-facing augmented reality"
                icon="ar"
                isSupported={capabilities?.immersiveAr ?? false}
                label="Immersive AR"
                status={status}
              />
            </div>

            <div className="capability-card-footer">
              <span className="footer-symbol">{allSupported ? 'OK' : '->'}</span>
              <span>
                {isChecking
                  ? 'Reading browser capabilities...'
                  : allSupported
                    ? 'XR capabilities verified. Ready to begin.'
                    : 'Immersive AR is not available in this browser.'}
              </span>
            </div>

            <div className={`dom-overlay-summary ${isDomOverlayUnavailable ? 'is-unavailable' : ''}`}>
              <span>DOM overlay</span>
              <strong>
                {sessionState.domOverlayStatus === 'active'
                  ? 'Active'
                  : isDomOverlayUnavailable
                    ? 'Unavailable'
                    : 'Checked when session starts'}
              </strong>
            </div>

            <div
              className={`dom-overlay-summary depth-summary ${sessionState.debug.depth.status === 'unavailable' ? 'is-unavailable' : ''}`}
            >
              <span>Depth sensing</span>
              <strong>{formatDepthStatus(sessionState.debug.depth.status)}</strong>
            </div>

            {canStartScan && !isActive ? (
              <p className="dom-overlay-instructions">
                {isDomOverlayUnavailable
                  ? 'DOM overlay was unavailable. Use the Android system Back gesture to exit immersive AR.'
                  : 'Controls will appear inside XR when DOM overlay is granted. If unavailable, use the Android system Back gesture to exit.'}
              </p>
            ) : null}

            {isActive && sessionState.debug.depth.status === 'unavailable' ? (
              <p className="dom-overlay-instructions">Depth sensing unavailable. Pose tracking continues.</p>
            ) : null}

            <div className="scanner-session-controls">
              <div className={`session-status session-status-${sessionState.status}`}>
                <span className="session-status-dot" aria-hidden="true" />
                <span>
                  <strong>{statusLabel}</strong>
                  <small>{statusDescription}</small>
                </span>
              </div>

              {isActive ? (
                <div className="scanner-session-actions">
                  <button
                    type="button"
                    className="scan-button scan-button-secondary"
                    disabled={isEnding}
                    onClick={onCancelScan}
                  >
                    {isCancelling ? 'Cancelling...' : 'Cancel'}
                  </button>
                  {!isStarting ? (
                    <button
                      type="button"
                      className="scan-button"
                      disabled={isEnding}
                      onClick={onFinishScan}
                    >
                      {isFinishing ? 'Finishing...' : 'Finish Scan'}
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  className="scan-button"
                  aria-busy={isStarting}
                  disabled={!canStartScan || isStarting}
                  onClick={onStartScan}
                >
                  {isStarting ? 'Starting...' : 'Start Scan'}
                </button>
              )}
            </div>

            {sessionState.status === 'error' && sessionState.error ? (
              <p className="session-error" role="alert">
                {sessionState.error}
              </p>
            ) : null}

            {isActive ? (
              <section className="pose-debug" aria-labelledby="pose-debug-title">
                <div className="pose-debug-header">
                  <span id="pose-debug-title">Live pose telemetry</span>
                  <span className="reference-space-label">
                    {sessionState.debug.referenceSpaceStatus}
                  </span>
                </div>
                <div className="pose-tracking-state">
                  <span
                    className={`tracking-indicator ${sessionState.debug.trackingStatus === 'active' ? 'is-tracking' : 'is-lost'}`}
                    aria-hidden="true"
                  />
                  {sessionState.debug.trackingStatus === 'active'
                    ? 'Tracking active'
                    : 'Tracking waiting for viewer pose'}
                </div>
                <div className="pose-diagnostics">
                  <div>
                    <span>XR session</span>
                    <strong>{sessionState.debug.sessionActive ? 'Active' : 'Ended'}</strong>
                  </div>
                  <div>
                    <span>WebGL context</span>
                    <strong>{sessionState.debug.glContextStatus}</strong>
                  </div>
                  <div>
                    <span>XR base layer</span>
                    <strong>{sessionState.debug.baseLayerStatus}</strong>
                  </div>
                  <div>
                    <span>Reference space</span>
                    <strong>{sessionState.debug.referenceSpaceStatus}</strong>
                  </div>
                </div>
                <div className="pose-metrics">
                  <div>
                    <span>XR frames</span>
                    <strong>{sessionState.debug.xrFrameCount}</strong>
                  </div>
                  <div>
                    <span>Valid poses</span>
                    <strong>{sessionState.debug.poseSampleCount}</strong>
                  </div>
                  <div>
                    <span>Position X</span>
                    <strong>{formatCoordinate(sessionState.debug.position?.x)}</strong>
                  </div>
                  <div>
                    <span>Position Y</span>
                    <strong>{formatCoordinate(sessionState.debug.position?.y)}</strong>
                  </div>
                  <div>
                    <span>Position Z</span>
                    <strong>{formatCoordinate(sessionState.debug.position?.z)}</strong>
                  </div>
                </div>
                <div className="depth-page-diagnostics">
                  <div>
                    <span>Depth sensing</span>
                    <strong>{formatDepthStatus(sessionState.debug.depth.status)}</strong>
                  </div>
                  <div>
                    <span>Depth resolution</span>
                    <strong>
                      {sessionState.debug.depth.width !== null && sessionState.debug.depth.height !== null
                        ? `${sessionState.debug.depth.width} × ${sessionState.debug.depth.height}`
                        : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span>Valid depth frames</span>
                    <strong>{sessionState.debug.depth.validFrameCount}</strong>
                  </div>
                </div>
                <div className="spatial-page-diagnostics">
                  <div>
                    <span>Current world points</span>
                    <strong>{sessionState.debug.spatial.currentValidPoints}</strong>
                  </div>
                  <div>
                    <span>Rejected samples</span>
                    <strong>{sessionState.debug.spatial.rejectedDepthSamples}</strong>
                  </div>
                  <div>
                    <span>Projection</span>
                    <strong>{formatSpatialSource(sessionState.debug.spatial.projectionSource)}</strong>
                  </div>
                  <div>
                    <span>Transform</span>
                    <strong>{formatSpatialSource(sessionState.debug.spatial.transformSource)}</strong>
                  </div>
                </div>
              </section>
            ) : null}
          </section>
            </>
          )}
        </main>

        <footer className="scanner-footer">
          <span>Spatial Scanner / V1.0</span>
          <span>
            {isActive
              ? 'Pose + world coverage'
              : isFinished
                ? 'Finalized scan review'
                : 'Capability check + session test'}
          </span>
        </footer>
      </div>
    </div>
  )
}

export default ScannerPage

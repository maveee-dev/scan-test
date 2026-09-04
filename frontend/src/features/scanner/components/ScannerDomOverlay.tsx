import { useEffect, useRef, useState, type RefObject } from 'react'
import type {
  CoverageRenderStatus,
  CoverageGuidance,
  DenseMaskStabilizationOptions,
  DepthAcquisitionStatus,
  DepthSensingStatus,
  ReferenceSpaceStatus,
  ScannerSessionState,
  SpatialGeometrySource,
  SpatialPoint,
  SpatialPreviewStatus,
  SpatialBounds,
  XRDepthException,
  XRPresentationStatus,
} from '../types'

interface ScannerDomOverlayProps {
  onCancelScan: () => void
  onDenseMaskStabilizationOptionsChange: (options: DenseMaskStabilizationOptions) => void
  onDebugGeometryToggle: (visible: boolean) => void
  onPersistentSurfelDebugToggle: (visible: boolean) => void
  onRawCameraDebugToggle: (visible: boolean) => void
  onFinishScan: () => void
  pointPreviewCanvasRef: RefObject<HTMLCanvasElement | null>
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

function formatDepthValue(value: string | boolean | number | null): string {
  return value === null ? 'N/A' : String(value)
}

function formatDepthAcquisitionStatus(status: DepthAcquisitionStatus): string {
  switch (status) {
    case 'available':
      return 'Available'
    case 'null':
      return 'Returned null'
    case 'threw':
      return 'Threw exception'
    case 'unsupported':
      return 'Unsupported'
    default:
      return 'Not attempted'
  }
}

function formatDepthException(label: string, error: XRDepthException): string {
  return `${label}: ${error.name} — ${error.message}`
}

function formatSpatialPreviewStatus(status: SpatialPreviewStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'failed':
      return 'Failed'
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

function formatSpatialRange(
  bounds: SpatialBounds | null,
  axis: keyof SpatialPoint,
): string {
  if (!bounds) {
    return 'N/A'
  }

  return `${bounds.min[axis].toFixed(2)} / ${bounds.max[axis].toFixed(2)}`
}

function formatDepthResolution(width: number | null, height: number | null): string {
  return width !== null && height !== null ? `${width} × ${height}` : 'N/A'
}

function formatDepthDistance(distanceMeters: number | null): string {
  return distanceMeters !== null && Number.isFinite(distanceMeters) && distanceMeters > 0
    ? `${distanceMeters.toFixed(2)} m`
    : 'N/A'
}

function formatCoveragePercentage(coverage: number | null): string {
  return coverage === null || !Number.isFinite(coverage) ? 'N/A' : `${Math.round(coverage)}%`
}

function formatCoverageRatio(ratio: number | null): string {
  return ratio === null || !Number.isFinite(ratio)
    ? 'N/A'
    : `${Math.round(ratio * 100)}%`
}

function formatVisualConfidence(confidence: number): string {
  return Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : 'N/A'
}

function formatPerformanceMilliseconds(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'N/A'
}

function formatPerformancePercentage(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'N/A'
}

function formatRawCameraState(value: string): string {
  return value.replaceAll('-', ' ')
}

function formatMeterRange(value: number | null): string {
  return value !== null && Number.isFinite(value) ? `${value.toFixed(2)} m` : 'N/A'
}

function formatDenseSamplePoint(
  depthMeters: number | null,
  point: SpatialPoint | null,
): string {
  if (
    depthMeters === null ||
    !Number.isFinite(depthMeters) ||
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.z)
  ) {
    return 'N/A'
  }

  return `${depthMeters.toFixed(2)} m / X ${point.x.toFixed(2)} / Y ${point.y.toFixed(2)} / Z ${point.z.toFixed(2)}`
}

function formatCoverageGuidance(guidance: CoverageGuidance): string {
  switch (guidance) {
    case 'continue-scanning-from-another-angle':
      return 'Continue scanning from another angle'
    case 'area-captured-move-to-a-new-surface':
      return 'Area captured - move to a new surface'
    default:
      return 'Move slowly across unscanned areas'
  }
}

function formatCoverageRenderStatus(status: CoverageRenderStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'failed':
      return 'Failed'
    default:
      return 'Idle'
  }
}

function ScannerDomOverlay({
  onCancelScan,
  onDenseMaskStabilizationOptionsChange,
  onDebugGeometryToggle,
  onPersistentSurfelDebugToggle,
  onRawCameraDebugToggle,
  onFinishScan,
  pointPreviewCanvasRef,
  sessionState,
}: ScannerDomOverlayProps) {
  const [isDebugOpen, setIsDebugOpen] = useState(false)
  const [isDenseGeometryVisible, setIsDenseGeometryVisible] = useState(false)
  const [isPersistentSurfelDebugVisible, setIsPersistentSurfelDebugVisible] = useState(false)
  const rawCameraPreviewCanvasRef = useRef<HTMLCanvasElement>(null)
  const [stabilizationOptions, setStabilizationOptions] = useState<DenseMaskStabilizationOptions>(
    () => ({ ...sessionState.debug.coverage.dense.stabilizationOptions }),
  )
  const isStarting = sessionState.status === 'starting'
  const isFinishing = sessionState.status === 'finishing'
  const isCancelling = sessionState.status === 'cancelling'
  const isEnding = isFinishing || isCancelling
  const trackingIsActive = sessionState.debug.trackingStatus === 'active'
  const depthStatus = formatDepthStatus(sessionState.debug.depth.status)
  const coverage = sessionState.debug.coverage
  const rawCamera = sessionState.debug.rawCamera

  useEffect(() => {
    const canvas = rawCameraPreviewCanvasRef.current
    if (!canvas || !rawCamera.preview) {
      return
    }

    canvas.width = rawCamera.preview.width
    canvas.height = rawCamera.preview.height
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.imageSmoothingEnabled = false
    const imageData = context.createImageData(rawCamera.preview.width, rawCamera.preview.height)
    imageData.data.set(rawCamera.preview.pixels)
    context.putImageData(imageData, 0, 0)
  }, [rawCamera.preview])

  function handleCancelScan(): void {
    setIsDebugOpen(false)
    setIsDenseGeometryVisible(false)
    setIsPersistentSurfelDebugVisible(false)
    onRawCameraDebugToggle(false)
    onDebugGeometryToggle(false)
    onPersistentSurfelDebugToggle(false)
    onCancelScan()
  }

  function handleFinishScan(): void {
    setIsDebugOpen(false)
    setIsDenseGeometryVisible(false)
    setIsPersistentSurfelDebugVisible(false)
    onRawCameraDebugToggle(false)
    onDebugGeometryToggle(false)
    onPersistentSurfelDebugToggle(false)
    onFinishScan()
  }

  function handleDebugToggle(): void {
    const nextOpen = !isDebugOpen
    setIsDebugOpen(nextOpen)
    onRawCameraDebugToggle(nextOpen)
    if (!nextOpen) {
      setIsDenseGeometryVisible(false)
      setIsPersistentSurfelDebugVisible(false)
      onRawCameraDebugToggle(false)
      onDebugGeometryToggle(false)
      onPersistentSurfelDebugToggle(false)
    }
  }

  function handleDebugClose(): void {
    setIsDebugOpen(false)
    setIsDenseGeometryVisible(false)
    setIsPersistentSurfelDebugVisible(false)
    onRawCameraDebugToggle(false)
    onDebugGeometryToggle(false)
    onPersistentSurfelDebugToggle(false)
  }

  function handleStabilizationToggle(
    option: keyof DenseMaskStabilizationOptions,
  ): void {
    const nextOptions = {
      ...stabilizationOptions,
      [option]: !stabilizationOptions[option],
    }
    setStabilizationOptions(nextOptions)
    onDenseMaskStabilizationOptionsChange(nextOptions)
  }

  return (
    <>
      <section className="xr-scanner-hud" aria-label="Spatial Scanner controls">
        <div className="xr-scanner-hud-header">
          <div className="xr-scanner-hud-session">
            <span className="xr-dom-overlay-dot" aria-hidden="true" />
            <span>
              {isStarting
                ? 'Session starting'
                : isFinishing
                  ? 'Finalizing scan'
                  : isCancelling
                    ? 'Cancelling scan'
                    : 'Scanning active'}
            </span>
          </div>
          <button
            type="button"
            className="xr-scanner-hud-debug"
            aria-expanded={isDebugOpen}
            aria-controls="scanner-debug-panel"
            onClick={handleDebugToggle}
          >
            {isDebugOpen ? 'Close Debug' : 'Debug'}
          </button>
        </div>

        <div className="xr-scanner-hud-status" aria-live="polite">
          <div className="xr-scanner-hud-status-item">
            <span
              className={`xr-dom-overlay-tracking-dot ${trackingIsActive ? 'is-tracking' : 'is-lost'}`}
              aria-hidden="true"
            />
            <span>Tracking {trackingIsActive ? 'active' : 'waiting'}</span>
          </div>
          <div className="xr-scanner-hud-status-item">
            <span>Points</span>
            <strong>{sessionState.debug.spatial.currentValidPoints}</strong>
          </div>
          <div className="xr-scanner-hud-status-item">
            <span>Depth</span>
            <strong>{depthStatus}</strong>
          </div>
          <div className="xr-scanner-hud-status-item">
            <span>View coverage</span>
            <strong>{formatCoveragePercentage(coverage.currentViewCoverage)}</strong>
          </div>
          <div className="xr-scanner-hud-status-item">
            <span>Captured / unique</span>
            <strong>{coverage.capturedCells} / {coverage.totalUniqueCells}</strong>
          </div>
        </div>

        <p className="xr-scanner-hud-guidance">{formatCoverageGuidance(coverage.guidance)}</p>

        <div className="xr-scanner-hud-actions">
          <button
            type="button"
            className="xr-scanner-hud-cancel"
            disabled={isEnding}
            onClick={handleCancelScan}
          >
            {isCancelling ? 'Cancelling...' : 'Cancel'}
          </button>
          {!isStarting ? (
            <button
              type="button"
              className="xr-scanner-hud-finish"
              disabled={isEnding}
              onClick={handleFinishScan}
            >
              {isFinishing ? 'Finishing...' : 'Finish Scan'}
            </button>
          ) : null}
        </div>
      </section>

      <section
        id="scanner-debug-panel"
        className="xr-dom-overlay-panel xr-scanner-debug"
        hidden={!isDebugOpen}
        aria-label="Spatial Scanner diagnostics"
      >
        <div className="xr-scanner-debug-header">
          <div>
            <span className="xr-dom-overlay-title">Scanner diagnostics</span>
            <span className="xr-dom-overlay-state">Development view</span>
          </div>
          <button
            type="button"
            className="xr-scanner-debug-geometry"
            aria-pressed={isDenseGeometryVisible}
            onClick={() => {
              const nextVisible = !isDenseGeometryVisible
              setIsDenseGeometryVisible(nextVisible)
              onDebugGeometryToggle(nextVisible)
            }}
          >
            {isDenseGeometryVisible ? 'Hide Raw Depth' : 'Show Raw Depth'}
          </button>
          <button
            type="button"
            className="xr-scanner-debug-geometry"
            aria-pressed={isPersistentSurfelDebugVisible}
            onClick={() => {
              const nextVisible = !isPersistentSurfelDebugVisible
              setIsPersistentSurfelDebugVisible(nextVisible)
              onPersistentSurfelDebugToggle(nextVisible)
            }}
          >
            {isPersistentSurfelDebugVisible ? 'Hide Persistent Surfels' : 'Show Persistent Surfels'}
          </button>
          <button
            type="button"
            className="xr-scanner-debug-close"
            onClick={handleDebugClose}
          >
            Close Debug
          </button>
        </div>

        <div className="xr-scanner-debug-content">
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
              <span>DOM overlay</span>
              <strong>{sessionState.domOverlayStatus === 'active' ? 'Active' : 'Unavailable'}</strong>
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
              className={`xr-dom-overlay-tracking-dot ${trackingIsActive ? 'is-tracking' : 'is-lost'}`}
              aria-hidden="true"
            />
            <span>
              {trackingIsActive ? 'Tracking active' : 'Tracking waiting for viewer pose'}
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

          <div className="xr-dom-overlay-depth" aria-label="Live performance diagnostics">
            <div className="xr-dom-overlay-depth-header">
              <span>Live performance</span>
              <strong>{sessionState.debug.performance.fps.toFixed(1)} FPS</strong>
            </div>
            <div className="xr-dom-overlay-diagnostics">
              <div>
                <span>Avg / p95 frame</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.averageFrameTimeMs)} / {formatPerformanceMilliseconds(sessionState.debug.performance.p95FrameTimeMs)}</strong>
              </div>
              <div>
                <span>Avg XR interval</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.averageFrameIntervalMs)}</strong>
              </div>
              <div>
                <span>Slow &gt; 16.7 / 22 ms</span>
                <strong>{formatPerformancePercentage(sessionState.debug.performance.frameOver16Point7MsPercentage)} ({sessionState.debug.performance.frameOver16Point7MsCount}) / {formatPerformancePercentage(sessionState.debug.performance.frameOver22MsPercentage)} ({sessionState.debug.performance.frameOver22MsCount})</strong>
              </div>
              <div>
                <span>Slow &gt; 33 ms / dropped</span>
                <strong>{formatPerformancePercentage(sessionState.debug.performance.frameOver33MsPercentage)} ({sessionState.debug.performance.frameOver33MsCount}) / {sessionState.debug.performance.droppedFrameCount}</strong>
              </div>
              <div>
                <span>XR session elapsed</span>
                <strong>{(sessionState.debug.performance.xrSessionElapsedMs / 1000).toFixed(1)} s</strong>
              </div>
              <div>
                <span>Rolling frames</span>
                <strong>{sessionState.debug.performance.frameCount}</strong>
              </div>
            </div>
            <div className="xr-dom-overlay-diagnostics">
              <div>
                <span>Depth acquisition</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.depthAcquisitionMs)}</strong>
              </div>
              <div>
                <span>Point generation</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.candidateGenerationMs)}</strong>
              </div>
              <div>
                <span>Normal filtering</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.normalFilteringMs)}</strong>
              </div>
              <div>
                <span>Surfel fusion</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.fusionUpdateMs)}</strong>
              </div>
              <div>
                <span>Coverage update</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.coverageUpdateMs)}</strong>
              </div>
              <div>
                <span>Candidate visualization</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.candidateVisualizationMs)}</strong>
              </div>
              <div>
                <span>Persistent render prep</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.persistentRenderPreparationMs)}</strong>
              </div>
              <div>
                <span>WebGL draw work</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.webGlDrawMs)}</strong>
              </div>
              <div>
                <span>HUD diagnostics</span>
                <strong>{formatPerformanceMilliseconds(sessionState.debug.performance.reactDiagnosticsMs)}</strong>
              </div>
            </div>
            <div className="xr-dom-overlay-counts">
              <div>
                <span>Active surfels</span>
                <strong>{sessionState.debug.performance.activeSurfelCount}</strong>
              </div>
              <div>
                <span>Rendered surfels</span>
                <strong>{sessionState.debug.performance.renderedSurfelCount}</strong>
              </div>
              <div>
                <span>Candidate patches</span>
                <strong>{sessionState.debug.performance.candidatePatchCount}</strong>
              </div>
              <div>
                <span>Coverage cells</span>
                <strong>{sessionState.debug.performance.coverageCellCount}</strong>
              </div>
            </div>
            <div className="xr-dom-overlay-depth-samples">
              {sessionState.debug.performance.performanceWindows.map((window) => (
                <div key={window.label}>
                  <span>{window.label}</span>
                  <strong>{window.frameCount} frames / {window.fps.toFixed(1)} FPS / slow {window.slowFramePercentage.toFixed(1)}%</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="xr-dom-overlay-depth xr-raw-camera-debug" aria-label="Raw camera copy debug">
            <div className="xr-dom-overlay-depth-header">
              <span>RAW CAMERA COPY DEBUG</span>
              <strong>{formatRawCameraState(rawCamera.status)}</strong>
            </div>
            <canvas
              ref={rawCameraPreviewCanvasRef}
              className="xr-dom-overlay-raw-camera-preview"
              aria-label="Application-owned raw camera copy preview"
            />
            {!rawCamera.preview ? (
              <p className="xr-dom-overlay-raw-camera-empty">
                Waiting for an application-owned camera copy. This preview is diagnostic only.
              </p>
            ) : null}
            <div className="xr-dom-overlay-diagnostics">
              <div>
                <span>Requested / enabled</span>
                <strong>{rawCamera.requested ? 'Yes' : 'No'} / {rawCamera.enabledFeature === null ? 'Unknown' : rawCamera.enabledFeature ? 'Yes' : 'No'}</strong>
              </div>
              <div>
                <span>Binding / view camera</span>
                <strong>{rawCamera.bindingAvailable ? 'Available' : 'Unavailable'} / {rawCamera.viewCameraAvailable ? 'Available' : 'Unavailable'}</strong>
              </div>
              <div>
                <span>Camera size</span>
                <strong>{formatDepthResolution(rawCamera.sourceWidth, rawCamera.sourceHeight)}</strong>
              </div>
              <div>
                <span>Copy size / status</span>
                <strong>{rawCamera.copyWidth} × {rawCamera.copyHeight} / {formatRawCameraState(rawCamera.copyStatus)}</strong>
              </div>
              <div>
                <span>Texture / orientation</span>
                <strong>{rawCamera.textureAvailable ? 'Available' : 'Unavailable'} / {formatRawCameraState(rawCamera.orientation)}</strong>
              </div>
              <div>
                <span>Copies success / failed</span>
                <strong>{rawCamera.successfulCopyCount} / {rawCamera.failedCopyCount}</strong>
              </div>
              <div>
                <span>Skipped copies</span>
                <strong>{rawCamera.skippedCopyCount}</strong>
              </div>
              <div>
                <span>Copy / shader / readback</span>
                <strong>{formatPerformanceMilliseconds(rawCamera.totalProbeMs)} / {formatPerformanceMilliseconds(rawCamera.shaderCopyMs)} / {formatPerformanceMilliseconds(rawCamera.readPixelsMs)}</strong>
              </div>
              <div>
                <span>Readback p95</span>
                <strong>{formatPerformanceMilliseconds(rawCamera.readbackP95Ms)}</strong>
              </div>
              <div>
                <span>Frame signature</span>
                <strong>{rawCamera.frameSignature === null ? 'N/A' : rawCamera.frameSignature} / {rawCamera.changedSincePreviousCopy === null ? 'N/A' : rawCamera.changedSincePreviousCopy ? 'Changed' : 'Same'}</strong>
              </div>
              <div>
                <span>Last copy</span>
                <strong>{rawCamera.lastCopyTimestamp === null ? 'N/A' : `${rawCamera.lastCopyTimestamp.toFixed(0)} ms`}</strong>
              </div>
            </div>
            {rawCamera.reason ? (
              <p className="xr-dom-overlay-depth-error">Reason: {formatRawCameraState(rawCamera.reason)}</p>
            ) : null}
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

          <div className="xr-dom-overlay-depth" aria-label="Depth sensing diagnostics">
            <div className="xr-dom-overlay-depth-header">
              <span>Depth sensing</span>
              <strong>{depthStatus}</strong>
            </div>
            <div className="xr-dom-overlay-depth-meta">
              <div>
                <span>Depth usage</span>
                <strong>{formatDepthValue(sessionState.debug.depth.session.usage)}</strong>
              </div>
              <div>
                <span>Depth format</span>
                <strong>{sessionState.debug.depth.session.dataFormat}</strong>
              </div>
              <div>
                <span>Depth active</span>
                <strong>{formatDepthValue(sessionState.debug.depth.session.active)}</strong>
              </div>
              <div>
                <span>Resolution</span>
                <strong>
                  {formatDepthResolution(sessionState.debug.depth.width, sessionState.debug.depth.height)}
                </strong>
              </div>
              <div>
                <span>Valid depth frames</span>
                <strong>{sessionState.debug.depth.validFrameCount}</strong>
              </div>
              <div>
                <span>Raw scale</span>
                <strong>{formatDepthValue(sessionState.debug.depth.rawValueToMeters)}</strong>
              </div>
            </div>
            <div className="xr-dom-overlay-depth-acquisition">
              <span>getDepthInformation(view)</span>
              <strong>{formatDepthAcquisitionStatus(sessionState.debug.depth.acquisition.status)}</strong>
            </div>
            <div className="xr-dom-overlay-depth-samples">
              {sessionState.debug.depth.samples.map((sample) => (
                <div key={sample.label}>
                  <span>{sample.label}</span>
                  <strong>{formatDepthDistance(sample.distanceMeters)}</strong>
                </div>
              ))}
            </div>
            <div className="xr-dom-overlay-depth-errors">
              {sessionState.debug.depth.acquisition.error ? (
                <p>
                  {formatDepthException('getDepthInformation', sessionState.debug.depth.acquisition.error)}
                </p>
              ) : null}
              {sessionState.debug.depth.session.usageError ? (
                <p>{formatDepthException('depthUsage', sessionState.debug.depth.session.usageError)}</p>
              ) : null}
              {sessionState.debug.depth.session.dataFormatError ? (
                <p>
                  {formatDepthException('depthDataFormat', sessionState.debug.depth.session.dataFormatError)}
                </p>
              ) : null}
              {sessionState.debug.depth.session.activeError ? (
                <p>{formatDepthException('depthActive', sessionState.debug.depth.session.activeError)}</p>
              ) : null}
              {sessionState.debug.depth.metadataError ? (
                <p>{formatDepthException('depth metadata', sessionState.debug.depth.metadataError)}</p>
              ) : null}
              {sessionState.debug.depth.rawValueToMetersError ? (
                <p>
                  {formatDepthException(
                    'rawValueToMeters',
                    sessionState.debug.depth.rawValueToMetersError,
                  )}
                </p>
              ) : null}
              {sessionState.debug.depth.sampleError ? (
                <p>
                  {formatDepthException(
                    `${sessionState.debug.depth.sampleError.label} sample`,
                    sessionState.debug.depth.sampleError.error,
                  )}
                </p>
              ) : null}
              {sessionState.debug.depth.samplingError ? (
                <p>
                  {formatDepthException('depth sampling', sessionState.debug.depth.samplingError)}
                </p>
              ) : null}
              {sessionState.debug.depth.gridSampleError ? (
                <p>
                  {formatDepthException('depth grid sample', sessionState.debug.depth.gridSampleError)}
                </p>
              ) : null}
              {sessionState.debug.depth.geometryError ? (
                <p>
                  {formatDepthException('depth geometry', sessionState.debug.depth.geometryError)}
                </p>
              ) : null}
            </div>
            {sessionState.debug.depth.error ? (
              <p className="xr-dom-overlay-depth-error">{sessionState.debug.depth.error}</p>
            ) : null}
          </div>

          <div className="xr-dom-overlay-spatial" aria-label="Current world-space point diagnostics">
            <div className="xr-dom-overlay-spatial-header">
              <span>World points / current frame</span>
              <strong>{formatSpatialPreviewStatus(sessionState.debug.spatial.previewStatus)}</strong>
            </div>
            <canvas
              ref={pointPreviewCanvasRef}
              className="xr-dom-overlay-point-preview"
              aria-label="Current world-space depth point preview"
            />
            <div className="xr-dom-overlay-spatial-meta">
              <div>
                <span>Current valid points</span>
                <strong>{sessionState.debug.spatial.currentValidPoints}</strong>
              </div>
              <div>
                <span>Rejected depth samples</span>
                <strong>{sessionState.debug.spatial.rejectedDepthSamples}</strong>
              </div>
              <div>
                <span>Projection source</span>
                <strong>{formatSpatialSource(sessionState.debug.spatial.projectionSource)}</strong>
              </div>
              <div>
                <span>Transform source</span>
                <strong>{formatSpatialSource(sessionState.debug.spatial.transformSource)}</strong>
              </div>
            </div>
            <div className="xr-dom-overlay-spatial-ranges">
              <div>
                <span>X min / max</span>
                <strong>{formatSpatialRange(sessionState.debug.spatial.bounds, 'x')}</strong>
              </div>
              <div>
                <span>Y min / max</span>
                <strong>{formatSpatialRange(sessionState.debug.spatial.bounds, 'y')}</strong>
              </div>
              <div>
                <span>Z min / max</span>
                <strong>{formatSpatialRange(sessionState.debug.spatial.bounds, 'z')}</strong>
              </div>
            </div>
            <div className="xr-dom-overlay-spatial-center">
              <span>Center reconstructed point</span>
              <strong>
                {sessionState.debug.spatial.centerPoint
                  ? `X ${sessionState.debug.spatial.centerPoint.x.toFixed(2)} / Y ${sessionState.debug.spatial.centerPoint.y.toFixed(2)} / Z ${sessionState.debug.spatial.centerPoint.z.toFixed(2)}`
                  : 'N/A'}
              </strong>
            </div>
            {sessionState.debug.spatial.error ? (
              <p className="xr-dom-overlay-spatial-error">{sessionState.debug.spatial.error}</p>
            ) : null}
          </div>

          <div className="xr-dom-overlay-coverage" aria-label="Spatial coverage diagnostics">
            <div className="xr-dom-overlay-coverage-header">
              <span>Spatial coverage / current view</span>
              <strong>{formatCoveragePercentage(coverage.currentViewCoverage)}</strong>
            </div>
            <div className="xr-dom-overlay-coverage-meta">
              <div className="xr-dom-overlay-dense-toggles">
                <span>Dense stabilization test toggles</span>
                {([
                  ['cacheEnabled', 'Temporal visual cache'],
                  ['smoothingEnabled', 'Temporal smoothing'],
                  ['holeFillEnabled', 'Visual hole filling'],
                  ['hysteresisEnabled', 'Reveal hysteresis'],
                ] as const).map(([option, label]) => (
                  <label key={option}>
                    <input
                      type="checkbox"
                      checked={stabilizationOptions[option]}
                      onChange={() => handleStabilizationToggle(option)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div>
                <span>Coverage cell size</span>
                <strong>{coverage.cellSizeMeters.toFixed(2)} m</strong>
              </div>
              <div>
                <span>Mapping samples</span>
                <strong>{coverage.mappingColumns} x {coverage.mappingRows}</strong>
              </div>
              <div>
                <span>Mapping rate</span>
                <strong>{coverage.mappingUpdateRateHz.toFixed(1)} Hz</strong>
              </div>
              <div>
                <span>Mapping phase</span>
                <strong>{coverage.mappingPhase} / 4</strong>
              </div>
              <div>
                <span>Mapping updates</span>
                <strong>{coverage.mappingUpdateCount}</strong>
              </div>
              <div>
                <span>Incoming measured samples</span>
                <strong>{coverage.incomingMeasuredSampleCount}</strong>
              </div>
              <div>
                <span>Matched existing surfels</span>
                <strong>{coverage.matchedExistingSurfaceSampleCount}</strong>
              </div>
              <div>
                <span>New surfels created</span>
                <strong>{coverage.newSurfaceCreationCount}</strong>
              </div>
              <div>
                <span>Existing-surface match rate</span>
                <strong>{formatCoverageRatio(coverage.existingSurfaceMatchRate)}</strong>
              </div>
              <div>
                <span>New-surface creation rate</span>
                <strong>{formatCoverageRatio(coverage.newSurfaceCreationRate)}</strong>
              </div>
              <div>
                <span>Fusion ratio</span>
                <strong>{formatCoverageRatio(coverage.fusionRatio)}</strong>
              </div>
              <div>
                <span>Avg compatible candidates / sample</span>
                <strong>{coverage.averageCompatibleCandidatesPerSample.toFixed(2)}</strong>
              </div>
              <div>
                <span>Distinct acceptance rate</span>
                <strong>{formatCoverageRatio(coverage.distinctObservationAcceptanceRate)}</strong>
              </div>
              <div>
                <span>Distance candidate rejects</span>
                <strong>{coverage.samplesRejectedByDistance}</strong>
              </div>
              <div>
                <span>Point-to-plane candidate rejects</span>
                <strong>{coverage.samplesRejectedByPointToPlane}</strong>
              </div>
              <div>
                <span>Normal candidate rejects</span>
                <strong>{coverage.samplesRejectedByNormalCompatibility}</strong>
              </div>
              <div>
                <span>Normal compatibility pass rate</span>
                <strong>{formatCoverageRatio(coverage.normalCompatibilityPassRate)}</strong>
              </div>
              <div>
                <span>Average normal angle</span>
                <strong>
                  {coverage.averageNormalAngleDegrees === null
                    ? 'N/A'
                    : `${coverage.averageNormalAngleDegrees.toFixed(1)}°`}
                </strong>
              </div>
              <div>
                <span>Unmatched persistent surfaces</span>
                <strong>{coverage.samplesWithNoCompatiblePersistentSurface}</strong>
              </div>
              <div>
                <span>Matched observed surfels</span>
                <strong>{coverage.matchedObservedSurfelCount}</strong>
              </div>
              <div>
                <span>Matched partial surfels</span>
                <strong>{coverage.matchedPartialSurfelCount}</strong>
              </div>
              <div>
                <span>Matched captured surfels</span>
                <strong>{coverage.matchedCapturedSurfelCount}</strong>
              </div>
              <div>
                <span>Total unique cells</span>
                <strong>{coverage.totalUniqueCells}</strong>
              </div>
              <div>
                <span>Observed cells</span>
                <strong>{coverage.observedCells}</strong>
              </div>
              <div>
                <span>Partial cells</span>
                <strong>{coverage.partialCells}</strong>
              </div>
              <div>
                <span>Captured cells</span>
                <strong>{coverage.capturedCells}</strong>
              </div>
              <div>
                <span>Map capacity</span>
                <strong>{coverage.totalUniqueCells} / {coverage.maxCells}</strong>
              </div>
              <div>
                <span>Current valid samples</span>
                <strong>{coverage.currentValidSamples}</strong>
              </div>
              <div>
                <span>Current captured samples</span>
                <strong>{coverage.currentCapturedSamples}</strong>
              </div>
              <div>
                <span>Accepted observations</span>
                <strong>{coverage.acceptedObservationCount}</strong>
              </div>
              <div>
                <span>Distinct observations accepted</span>
                <strong>{coverage.distinctObservationAcceptedCount}</strong>
              </div>
              <div>
                <span>Translation-qualified accepts</span>
                <strong>{coverage.distinctTranslationQualifiedCount}</strong>
              </div>
              <div>
                <span>Rotation-qualified accepts</span>
                <strong>{coverage.distinctRotationQualifiedCount}</strong>
              </div>
              <div>
                <span>Duplicate viewpoint rejects</span>
                <strong>{coverage.duplicateViewpointRejectedCount}</strong>
              </div>
              <div>
                <span>New cells created</span>
                <strong>{coverage.newCellsCreatedCount}</strong>
              </div>
              <div>
                <span>Observed to partial</span>
                <strong>{coverage.observedToPartialTransitionCount}</strong>
              </div>
              <div>
                <span>Partial to captured</span>
                <strong>{coverage.partialToCapturedTransitionCount}</strong>
              </div>
              <div>
                <span>Observed to partial / sec</span>
                <strong>{coverage.observedToPartialTransitionsPerSecond.toFixed(2)}</strong>
              </div>
              <div>
                <span>Partial to captured / sec</span>
                <strong>{coverage.partialToCapturedTransitionsPerSecond.toFixed(2)}</strong>
              </div>
              <div>
                <span>Surfel age 1 observation</span>
                <strong>{coverage.surfelsWithOneObservation}</strong>
              </div>
              <div>
                <span>Surfel age 2 observations</span>
                <strong>{coverage.surfelsWithTwoObservations}</strong>
              </div>
              <div>
                <span>Surfel age 3+ observations</span>
                <strong>{coverage.surfelsWithThreeOrMoreObservations}</strong>
              </div>
              <div>
                <span>Live surfels</span>
                <strong>{coverage.liveSurface.surfelCount} / {coverage.liveSurface.surfelCapacity}</strong>
              </div>
              <div>
                <span>Live surfel fusion</span>
                <strong>{formatCoverageRatio(coverage.liveSurface.fusionRate)}</strong>
              </div>
              <div>
                <span>Live surface created / fused</span>
                <strong>{coverage.liveSurface.newSurfelCount} / {coverage.liveSurface.fusedSurfelCount}</strong>
              </div>
              <div>
                <span>Live surface buckets</span>
                <strong>{coverage.liveSurface.spatialBucketCount}</strong>
              </div>
              <div>
                <span>Live surface candidates</span>
                <strong>{coverage.liveSurface.averageCandidatesPerPoint.toFixed(2)} avg / {coverage.liveSurface.candidateCheckCount} total</strong>
              </div>
              <div>
                <span>Live fusion rejects</span>
                <strong>{coverage.liveSurface.fusionRejectCount}</strong>
              </div>
              <div>
                <span>Live reject distance / plane / normal</span>
                <strong>
                  {coverage.liveSurface.distanceRejectedCount} / {coverage.liveSurface.pointToPlaneRejectedCount} / {coverage.liveSurface.normalRejectedCount}
                </strong>
              </div>
              <div>
                <span>Live geometry new / confirmed / stable</span>
                <strong>
                  {coverage.liveSurface.weakSurfelCount} / {coverage.liveSurface.confirmedSurfelCount} / {coverage.liveSurface.stableSurfelCount}
                </strong>
              </div>
              <div>
                <span>Live surfels rendered</span>
                <strong>{coverage.liveSurface.renderedSurfelCount}</strong>
              </div>
              <div>
                <span>Current measured / matched</span>
                <strong>
                  {coverage.liveSurface.incomingMeasuredPointCount} / {coverage.liveSurface.matchedCurrentPointCount}
                </strong>
              </div>
              <div>
                <span>Unmatched candidate samples</span>
                <strong>{coverage.liveSurface.unmatchedCandidateSampleCount}</strong>
              </div>
              <div>
                <span>Candidate visual surfels</span>
                <strong>{coverage.liveSurface.candidateVisualSurfelCount}</strong>
              </div>
              <div>
                <span>Candidate suppressed captured / incomplete</span>
                <strong>
                  {coverage.liveSurface.candidateSuppressedByCapturedMatchCount} / {coverage.liveSurface.candidateSuppressedByIncompleteMatchCount}
                </strong>
              </div>
              <div>
                <span>Persistent captured / partial / observed / new</span>
                <strong>
                  {coverage.liveSurface.capturedPersistentSurfelCount} / {coverage.liveSurface.partialPersistentSurfelCount} / {coverage.liveSurface.observedPersistentSurfelCount} / {coverage.liveSurface.unknownPersistentSurfelCount}
                </strong>
              </div>
              <div>
                <span>Live reconstruction</span>
                <strong>{coverage.liveSurface.processingDurationMs.toFixed(1)} ms / {coverage.liveSurface.updateRateHz.toFixed(1)} Hz</strong>
              </div>
              <div>
                <span>Live footprint / fusion distance</span>
                <strong>
                  {coverage.liveSurface.footprintRadiusMeters.toFixed(3)} m / {coverage.liveSurface.maxFusionDistanceMeters.toFixed(3)} m
                </strong>
              </div>
              <div>
                <span>Live surface capacity</span>
                <strong>{coverage.liveSurface.capacityReached ? 'Reached' : 'Available'}</strong>
              </div>
              <div>
                <span>Coverage support</span>
                <strong>{coverage.coverageRegionSupportMeters.toFixed(2)} m</strong>
              </div>
              <div>
                <span>Coverage regions</span>
                <strong>{coverage.coverageRegionCount}</strong>
              </div>
              <div>
                <span>Region observed / partial / captured</span>
                <strong>
                  {coverage.coverageRegionObservedCount} / {coverage.coverageRegionPartialCount} / {coverage.coverageRegionCapturedCount}
                </strong>
              </div>
              <div>
                <span>Rejected duplicate / same-view</span>
                <strong>{coverage.rejectedDuplicateObservationCount}</strong>
              </div>
              <div>
                <span>Reject: insufficient movement</span>
                <strong>{coverage.observationsRejectedInsufficientCameraMovement}</strong>
              </div>
              <div>
                <span>Reject: insufficient view change</span>
                <strong>{coverage.observationsRejectedInsufficientViewChange}</strong>
              </div>
              <div>
                <span>Reject: fusion</span>
                <strong>{coverage.observationsRejectedFusion}</strong>
              </div>
              <div>
                <span>Reject: normal similarity</span>
                <strong>{coverage.observationsRejectedNormalSimilarity}</strong>
              </div>
              <div>
                <span>Reject: point-to-plane</span>
                <strong>{coverage.observationsRejectedPointToPlane}</strong>
              </div>
              <div>
                <span>Capacity reached</span>
                <strong>{coverage.capacityReached ? 'Yes' : 'No'}</strong>
              </div>
              <div>
                <span>Capacity-rejected samples</span>
                <strong>{coverage.capacityRejectedSampleCount}</strong>
              </div>
              <div>
                <span>Coverage renderer</span>
                <strong>{formatCoverageRenderStatus(coverage.render.status)}</strong>
              </div>
              <div>
                <span>Invalid normals rejected</span>
                <strong>{coverage.rejectedInvalidNormalCount}</strong>
              </div>
              <div>
                <span>Depth discontinuities rejected</span>
                <strong>{coverage.rejectedDepthDiscontinuityCount}</strong>
              </div>
              <div>
                <span>Visual patch size</span>
                <strong>{coverage.render.visualPatchSizeMeters.toFixed(3)} m</strong>
              </div>
              <div>
                <span>Candidate opacity</span>
                <strong>{coverage.render.candidateOpacity.toFixed(2)}</strong>
              </div>
              <div>
                <span>Observed opacity</span>
                <strong>{coverage.render.observedOpacity.toFixed(2)}</strong>
              </div>
              <div>
                <span>Partial opacity</span>
                <strong>{coverage.render.partialOpacity.toFixed(2)}</strong>
              </div>
              <div>
                <span>Captured opacity</span>
                <strong>{coverage.render.capturedOpacity.toFixed(2)}</strong>
              </div>
              <div>
                <span>Dense mask target</span>
                <strong>{coverage.dense.columns} x {coverage.dense.rows}</strong>
              </div>
              <div>
                <span>Dense samples</span>
                <strong>{coverage.dense.validSampleCount} / {coverage.dense.attemptedSampleCount}</strong>
              </div>
              <div>
                <span>Exact lookup hits</span>
                <strong>{coverage.dense.exactCoverageLookupHitCount}</strong>
              </div>
              <div>
                <span>Neighbor lookup hits</span>
                <strong>{coverage.dense.neighborCoverageLookupHitCount}</strong>
              </div>
              <div>
                <span>Lookup misses</span>
                <strong>{coverage.dense.coverageLookupMissCount}</strong>
              </div>
              <div>
                <span>Lookup hit rate</span>
                <strong>{formatCoveragePercentage(coverage.dense.coverageLookupHitPercentage)}</strong>
              </div>
              <div>
                <span>Direct persistent matches</span>
                <strong>{coverage.dense.directPersistentMatchCount}</strong>
              </div>
              <div>
                <span>Neighborhood confidence samples</span>
                <strong>{coverage.dense.neighborhoodConfidenceSampleCount}</strong>
              </div>
              <div>
                <span>Visual confidence unknown</span>
                <strong>{coverage.dense.visualConfidenceUnknownCount}</strong>
              </div>
              <div>
                <span>Avg compatible neighbors</span>
                <strong>{coverage.dense.averageCompatibleNeighborCount.toFixed(2)}</strong>
              </div>
              <div>
                <span>Average visual confidence</span>
                <strong>{formatVisualConfidence(coverage.dense.averageVisualConfidence)}</strong>
              </div>
              <div>
                <span>Captured direct matches</span>
                <strong>{coverage.dense.capturedDirectMatchCount}</strong>
              </div>
              <div>
                <span>Neighborhood high confidence</span>
                <strong>{coverage.dense.neighborhoodHighConfidenceSampleCount}</strong>
              </div>
              <div>
                <span>Visual normal rejects</span>
                <strong>{coverage.dense.visualConfidenceNormalRejectCount}</strong>
              </div>
              <div>
                <span>Visual point-plane rejects</span>
                <strong>{coverage.dense.visualConfidencePointToPlaneRejectCount}</strong>
              </div>
              <div>
                <span>Visual support radius</span>
                <strong>{coverage.dense.visualConfidenceSupportRadiusMeters.toFixed(2)} m</strong>
              </div>
              <div>
                <span>Visual candidate limit</span>
                <strong>{coverage.dense.visualConfidenceCandidateLimit}</strong>
              </div>
              <div>
                <span>Depth min / max</span>
                <strong>{formatMeterRange(coverage.dense.depthMinMeters)} / {formatMeterRange(coverage.dense.depthMaxMeters)}</strong>
              </div>
              <div>
                <span>Mapping time</span>
                <strong>{coverage.mappingProcessingDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>World X min / max</span>
                <strong>{formatSpatialRange(coverage.dense.worldBounds, 'x')}</strong>
              </div>
              <div>
                <span>World Y min / max</span>
                <strong>{formatSpatialRange(coverage.dense.worldBounds, 'y')}</strong>
              </div>
              <div>
                <span>World Z min / max</span>
                <strong>{formatSpatialRange(coverage.dense.worldBounds, 'z')}</strong>
              </div>
              <div>
                <span>Dense triangles</span>
                <strong>{coverage.dense.generatedTriangleCount}</strong>
              </div>
              <div>
                <span>Dense invalid rejects</span>
                <strong>{coverage.dense.rejectedInvalidSampleCount}</strong>
              </div>
              <div>
                <span>Dense discontinuities</span>
                <strong>{coverage.dense.rejectedDepthDiscontinuityCount}</strong>
              </div>
              <div>
                <span>Unknown mask samples</span>
                <strong>{coverage.dense.unknownMaskSampleCount}</strong>
              </div>
              <div>
                <span>Observed mask samples</span>
                <strong>{coverage.dense.observedMaskSampleCount}</strong>
              </div>
              <div>
                <span>Partial mask samples</span>
                <strong>{coverage.dense.partialMaskSampleCount}</strong>
              </div>
              <div>
                <span>Captured / transparent samples</span>
                <strong>{coverage.dense.capturedMaskSampleCount}</strong>
              </div>
              <div>
                <span>Dense mask updates</span>
                <strong>{coverage.dense.updateCount}</strong>
              </div>
              <div>
                <span>Dense mask rate</span>
                <strong>{coverage.dense.updateRateHz.toFixed(1)} Hz</strong>
              </div>
              <div>
                <span>Dense mask processing</span>
                <strong>{coverage.dense.processingDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>Depth reconstruction</span>
                <strong>{coverage.dense.depthReconstructionDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>Coverage lookup</span>
                <strong>{coverage.dense.coverageLookupDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>Visual confidence</span>
                <strong>{coverage.dense.visualConfidenceDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>Visual cache</span>
                <strong>{coverage.dense.visualCacheDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>Hole filling</span>
                <strong>{coverage.dense.holeFillDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>Smoothing</span>
                <strong>{coverage.dense.smoothingDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>Triangle generation</span>
                <strong>{coverage.dense.triangleGenerationDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>GPU buffer upload</span>
                <strong>{coverage.render.gpuBufferUploadDurationMs.toFixed(1)} ms</strong>
              </div>
              <div>
                <span>Visual cache entries</span>
                <strong>{coverage.dense.visualCacheEntryCount} / {coverage.dense.visualCacheMaxEntries}</strong>
              </div>
              <div>
                <span>Visual cache hits</span>
                <strong>{coverage.dense.visualCacheHitCount}</strong>
              </div>
              <div>
                <span>Visual cache refreshes</span>
                <strong>{coverage.dense.visualCacheRefreshCount}</strong>
              </div>
              <div>
                <span>Visual cache expirations</span>
                <strong>{coverage.dense.visualCacheExpirationCount}</strong>
              </div>
              <div>
                <span>Visual hole fills</span>
                <strong>{coverage.dense.visualHoleFillSampleCount}</strong>
              </div>
              <div>
                <span>Hole-fill rejects</span>
                <strong>{coverage.dense.visualHoleFillRejectCount}</strong>
              </div>
              <div>
                <span>Smoothed visual samples</span>
                <strong>{coverage.dense.smoothedVisualFragmentCount}</strong>
              </div>
              <div>
                <span>Dense vertices uploaded</span>
                <strong>{coverage.render.denseVertexCount}</strong>
              </div>
              <div>
                <span>Dense render updates</span>
                <strong>{coverage.render.denseRenderUpdateCount}</strong>
              </div>
              <div>
                <span>Persistent surface vertices</span>
                <strong>{coverage.render.persistentVertexCount}</strong>
              </div>
              <div>
                <span>Persistent surface updates</span>
                <strong>{coverage.render.persistentRenderUpdateCount}</strong>
              </div>
            </div>
            <div className="xr-dom-overlay-dense-samples" aria-label="Dense world-point samples">
              {coverage.dense.representativeSamples.map((sample) => (
                <div key={sample.label}>
                  <span>{sample.label}</span>
                  <strong>{formatDenseSamplePoint(sample.depthMeters, sample.point)}</strong>
                </div>
              ))}
            </div>
            {coverage.statisticsInvariantError ? (
              <p className="xr-dom-overlay-coverage-error">
                {coverage.statisticsInvariantError}
              </p>
            ) : null}
            <p className="xr-dom-overlay-coverage-guidance">
              Guidance: {formatCoverageGuidance(coverage.guidance)}
            </p>
          </div>
        </div>

        <div className="xr-scanner-debug-footer">
          <button
            type="button"
            className="xr-dom-overlay-cancel"
            disabled={isEnding}
            onClick={handleCancelScan}
          >
            {isCancelling ? 'Cancelling...' : 'Cancel'}
          </button>
          {!isStarting ? (
            <button
              type="button"
              className="xr-dom-overlay-finish"
              disabled={isEnding}
              onClick={handleFinishScan}
            >
              {isFinishing ? 'Finishing...' : 'Finish Scan'}
            </button>
          ) : null}
        </div>
      </section>
    </>
  )
}

export default ScannerDomOverlay

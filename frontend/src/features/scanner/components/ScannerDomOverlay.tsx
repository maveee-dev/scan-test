import type { RefObject } from 'react'
import type {
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
  onStopScan: () => void
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

function ScannerDomOverlay({ onStopScan, pointPreviewCanvasRef, sessionState }: ScannerDomOverlayProps) {
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

      <div className="xr-dom-overlay-depth" aria-label="Depth sensing diagnostics">
        <div className="xr-dom-overlay-depth-header">
          <span>Depth sensing</span>
          <strong>{formatDepthStatus(sessionState.debug.depth.status)}</strong>
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

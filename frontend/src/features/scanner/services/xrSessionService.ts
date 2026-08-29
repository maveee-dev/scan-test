import type {
  DomOverlayStatus,
  ReferenceSpaceStatus,
  ScannerReferenceSpaceType,
  SpatialPointDebug,
  XRPresentationStatus,
  ViewerPoseDebug,
  ViewerPosition,
} from '../types'
import {
  XRPresentationError,
  XRPresentationService,
  type XRPresentationDiagnostics,
} from './xrPresentationService'
import { XRDepthService } from './xrDepthService'
import { SpatialPointService } from './spatialPointService'
import { SpatialPointPreviewService } from './spatialPointPreviewService'
import { SpatialCoverageService } from './spatialCoverageService'

const DEBUG_SAMPLE_INTERVAL_MS = 250

export type XRSessionEndReason = 'stopped' | 'external'

export type XRSessionErrorCode =
  | 'webxr-unavailable'
  | 'permission-denied'
  | 'session-request-failed'
  | 'reference-space-failed'
  | 'presentation-failed'
  | 'session-ended'
  | 'frame-processing-failed'
  | 'session-stop-failed'

export class XRSessionError extends Error {
  readonly code: XRSessionErrorCode

  constructor(message: string, code: XRSessionErrorCode) {
    super(message)
    this.name = 'XRSessionError'
    this.code = code
  }
}

export interface XRSessionCallbacks {
  onDomOverlayState: (status: DomOverlayStatus) => void
  onDiagnostics: (diagnostics: ViewerPoseDebug) => void
  onError: (error: XRSessionError) => void
  onSessionEnded: (reason: XRSessionEndReason) => void
}

export interface XRSessionStartOptions {
  callbacks: XRSessionCallbacks
  overlayRoot: HTMLElement
  pointPreviewCanvas?: HTMLCanvasElement
}

interface ReferenceSpaceResult {
  referenceSpace: XRReferenceSpace
  type: ScannerReferenceSpaceType
}

function createPosition(position: DOMPointReadOnly): ViewerPosition {
  return {
    x: position.x,
    y: position.y,
    z: position.z,
  }
}

function createError(
  error: unknown,
  fallbackMessage: string,
  fallbackCode: XRSessionErrorCode,
): XRSessionError {
  if (error instanceof XRSessionError) {
    return error
  }

  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  ) {
    return new XRSessionError(
      'XR or camera permission was denied. Allow access and try again.',
      'permission-denied',
    )
  }

  return new XRSessionError(fallbackMessage, fallbackCode)
}

/**
 * Owns one immersive AR session and its high-frequency frame loop.
 * React only receives throttled pose snapshots through the callbacks.
 */
export class XRSessionService {
  private activeSession: XRSession | null = null

  private readonly presentationService = new XRPresentationService()

  private readonly depthService = new XRDepthService()

  private readonly spatialPointService = new SpatialPointService()

  private readonly spatialPointPreviewService = new SpatialPointPreviewService()

  private readonly spatialCoverageService = new SpatialCoverageService()

  private referenceSpace: XRReferenceSpace | null = null

  private referenceSpaceType: ScannerReferenceSpaceType | null = null

  private frameRequestId: number | null = null

  private sessionEndListener: (() => void) | null = null

  private callbacks: XRSessionCallbacks | null = null

  private startPromise: Promise<void> | null = null

  private stopRequested = false

  private isEnding = false

  private lastPublishedAt = Number.NEGATIVE_INFINITY

  private trackingActive = false

  private position: ViewerPosition | null = null

  private glContextStatus: XRPresentationStatus = 'unknown'

  private baseLayerStatus: XRPresentationStatus = 'unknown'

  private referenceSpaceStatus: ReferenceSpaceStatus = 'idle'

  private xrFrameCount = 0

  private poseSampleCount = 0

  public start(options: XRSessionStartOptions): Promise<void> {
    if (this.startPromise) {
      return this.startPromise
    }

    if (this.activeSession) {
      return Promise.reject(
        new XRSessionError('An immersive AR session is already active.', 'session-request-failed'),
      )
    }

    this.stopRequested = false
    const startPromise = this.startInternal(options)
    this.startPromise = startPromise

    void startPromise.then(
      () => this.clearStartPromise(startPromise),
      () => this.clearStartPromise(startPromise),
    )

    return startPromise
  }

  public async stop(): Promise<void> {
    this.stopRequested = true

    const startPromise = this.startPromise
    if (startPromise) {
      await startPromise.catch(() => undefined)
    }

    const session = this.activeSession
    if (!session) {
      this.stopRequested = false
      return
    }

    try {
      await this.endActiveSession(session)
    } finally {
      this.stopRequested = false
    }
  }

  public async dispose(): Promise<void> {
    this.callbacks = null
    await this.stop()
    this.presentationService.dispose()
    this.depthService.dispose()
    this.spatialPointService.reset()
    this.spatialPointPreviewService.dispose()
    this.spatialCoverageService.dispose()
  }

  private async startInternal(options: XRSessionStartOptions): Promise<void> {
    const xrSystem = typeof navigator === 'undefined' ? undefined : navigator.xr

    if (!xrSystem) {
      throw new XRSessionError('WebXR is unavailable in this browser.', 'webxr-unavailable')
    }

    let session: XRSession
    try {
      // This call is reached directly from the Start Scan click handler.
      session = await xrSystem.requestSession('immersive-ar', {
        optionalFeatures: ['local-floor', 'dom-overlay', 'depth-sensing'],
        domOverlay: { root: options.overlayRoot },
        depthSensing: {
          usagePreference: ['cpu-optimized'],
          dataFormatPreference: ['float32', 'luminance-alpha', 'unsigned-short'],
          depthTypeRequest: ['raw', 'smooth'],
          matchDepthView: true,
        },
      })
    } catch (error) {
      throw createError(
        error,
        'Unable to start immersive AR. Check device support and permissions, then try again.',
        'session-request-failed',
      )
    }

    if (this.stopRequested) {
      await this.endSessionSafely(session)
      return
    }

    this.activeSession = session
    this.callbacks = options.callbacks
    this.resetSessionDiagnostics()
    this.depthService.initialize(session)
    this.spatialPointPreviewService.initialize(options.pointPreviewCanvas)
    this.sessionEndListener = () => this.handleSessionEnded(session)
    session.addEventListener('end', this.sessionEndListener)
    this.callbacks.onDomOverlayState(session.domOverlayState ? 'active' : 'unavailable')
    this.emitDiagnostics()

    try {
      const presentationDiagnostics = await this.presentationService.initialize(session)
      this.applyPresentationDiagnostics(presentationDiagnostics)
      this.emitDiagnostics()

      const referenceSpaceResult = await this.requestReferenceSpace(session)

      if (!this.isActiveSession(session)) {
        throw new XRSessionError(
          'The XR session ended before device tracking could start.',
          'session-ended',
        )
      }

      if (this.stopRequested) {
        await this.endActiveSession(session)
        return
      }

      this.referenceSpace = referenceSpaceResult.referenceSpace
      this.referenceSpaceType = referenceSpaceResult.type
      this.startFrameProcessing(session)
    } catch (error) {
      const presentationDiagnostics = this.presentationService.getDiagnostics()
      this.applyPresentationDiagnostics(presentationDiagnostics)
      if (error instanceof XRPresentationError && this.referenceSpaceStatus === 'idle') {
        this.referenceSpaceStatus = 'failed'
      }
      this.emitDiagnostics()

      if (this.isActiveSession(session)) {
        await this.endActiveSession(session).catch(() => undefined)
      }

      if (error instanceof XRSessionError) {
        throw error
      }

      if (error instanceof XRPresentationError) {
        throw new XRSessionError(error.message, 'presentation-failed')
      }

      throw createError(
        error,
        'The XR session could not prepare a tracking reference space.',
        'reference-space-failed',
      )
    }
  }

  private async requestReferenceSpace(session: XRSession): Promise<ReferenceSpaceResult> {
    this.referenceSpaceStatus = 'requesting'
    this.emitDiagnostics()

    try {
      const referenceSpace = await session.requestReferenceSpace('local-floor')
      this.referenceSpaceStatus = 'local-floor'
      this.emitDiagnostics()
      return { referenceSpace, type: 'local-floor' }
    } catch {
      try {
        const referenceSpace = await session.requestReferenceSpace('local')
        this.referenceSpaceStatus = 'local'
        this.emitDiagnostics()
        return { referenceSpace, type: 'local' }
      } catch {
        this.referenceSpaceStatus = 'failed'
        this.emitDiagnostics()
        throw new XRSessionError(
          'This device could not provide a local tracking reference space.',
          'reference-space-failed',
        )
      }
    }
  }

  private startFrameProcessing(session: XRSession): void {
    const referenceSpace = this.referenceSpace
    if (!referenceSpace) {
      throw new XRSessionError(
        'The XR reference space was not ready for frame processing.',
        'reference-space-failed',
      )
    }

    const processFrame: XRFrameRequestCallback = (time, frame) => {
      this.frameRequestId = null
      this.xrFrameCount += 1

      if (!this.isActiveSession(session) || this.isEnding) {
        return
      }

      try {
        this.presentationService.clearTransparentFrame()
      } catch (error) {
        this.handleFrameProcessingError(
          session,
          new XRSessionError(
            error instanceof XRPresentationError
              ? error.message
              : 'The XR framebuffer could not be prepared.',
            'frame-processing-failed',
          ),
        )
        return
      }

      let pose: XRViewerPose | undefined
      try {
        pose = frame.getViewerPose(referenceSpace)
      } catch {
        pose = undefined
      }

      this.trackingActive = pose !== undefined
      if (pose) {
        this.poseSampleCount += 1
      }
      this.position = pose ? createPosition(pose.transform.position) : null

      const depthObservation = pose?.views[0]
        ? this.depthService.inspectFrame(frame, pose.views[0])
        : null
      const spatialObservations = this.spatialPointService.processFrame(depthObservation)
      this.spatialCoverageService.processFrame(spatialObservations, this.position, time)

      if (time - this.lastPublishedAt >= DEBUG_SAMPLE_INTERVAL_MS) {
        this.lastPublishedAt = time
        this.spatialPointPreviewService.render(spatialObservations)
        this.publishDiagnostics(time)
      }

      if (this.isActiveSession(session) && !this.isEnding) {
        try {
          this.frameRequestId = session.requestAnimationFrame(processFrame)
        } catch (error) {
          this.handleFrameProcessingError(
            session,
            createError(
              error,
              'XR frame processing stopped unexpectedly.',
              'frame-processing-failed',
            ),
          )
        }
      }
    }

    try {
      this.frameRequestId = session.requestAnimationFrame(processFrame)
    } catch (error) {
      throw createError(
        error,
        'XR frame processing could not start.',
        'frame-processing-failed',
      )
    }
  }

  private publishDiagnostics(time: DOMHighResTimeStamp): void {
    this.callbacks?.onDiagnostics({
      sessionActive: this.activeSession !== null,
      glContextStatus: this.glContextStatus,
      baseLayerStatus: this.baseLayerStatus,
      referenceSpaceStatus: this.referenceSpaceStatus,
      xrFrameCount: this.xrFrameCount,
      poseSampleCount: this.poseSampleCount,
      trackingStatus: this.trackingActive ? 'active' : 'waiting',
      trackingActive: this.trackingActive,
      position: this.position,
      referenceSpaceType: this.referenceSpaceType,
      lastSampledAt: time,
      depth: this.depthService.getDiagnostics(),
      spatial: this.getSpatialPointDiagnostics(),
      coverage: this.spatialCoverageService.getDiagnostics(),
    })
  }

  private handleFrameProcessingError(session: XRSession, error: XRSessionError): void {
    this.stopFrameProcessing(session)
    this.callbacks?.onError(error)
    void this.endActiveSession(session).catch(() => undefined)
  }

  private handleSessionEnded(session: XRSession): void {
    if (!this.isActiveSession(session)) {
      return
    }

    this.stopFrameProcessing(session)
    this.removeSessionEndListener(session)
    this.activeSession = null
    this.referenceSpace = null
    this.referenceSpaceType = null
    this.presentationService.dispose()
    this.depthService.dispose()
    this.spatialPointService.reset()
    this.spatialPointPreviewService.dispose()
    this.spatialCoverageService.reset()
    this.frameRequestId = null
    this.isEnding = false

    const callback = this.callbacks?.onSessionEnded
    this.callbacks = null
    callback?.(this.stopRequested ? 'stopped' : 'external')
  }

  private async endActiveSession(session: XRSession): Promise<void> {
    if (!this.isActiveSession(session)) {
      return
    }

    this.isEnding = true
    this.stopFrameProcessing(session)

    try {
      await session.end()
    } catch (error) {
      this.handleSessionEnded(session)
      throw createError(
        error,
        'The immersive AR session could not be stopped cleanly.',
        'session-stop-failed',
      )
    } finally {
      if (this.isActiveSession(session)) {
        this.handleSessionEnded(session)
      }
    }
  }

  private async endSessionSafely(session: XRSession): Promise<void> {
    try {
      await session.end()
    } catch {
      // The session may already have ended while the start request was pending.
    }
  }

  private stopFrameProcessing(session: XRSession): void {
    if (this.frameRequestId !== null) {
      try {
        session.cancelAnimationFrame(this.frameRequestId)
      } catch {
        // The browser can reject cancellation after an external session end.
      }
    }

    this.frameRequestId = null
  }

  private removeSessionEndListener(session: XRSession): void {
    if (this.sessionEndListener) {
      session.removeEventListener('end', this.sessionEndListener)
      this.sessionEndListener = null
    }
  }

  private resetSessionDiagnostics(): void {
    this.glContextStatus = 'unknown'
    this.baseLayerStatus = 'unknown'
    this.referenceSpaceStatus = 'idle'
    this.xrFrameCount = 0
    this.poseSampleCount = 0
    this.lastPublishedAt = Number.NEGATIVE_INFINITY
    this.trackingActive = false
    this.position = null
    this.depthService.dispose()
    this.spatialPointService.reset()
    this.spatialPointPreviewService.dispose()
    this.spatialCoverageService.reset()
  }

  private applyPresentationDiagnostics(diagnostics: XRPresentationDiagnostics): void {
    this.glContextStatus = diagnostics.glContextStatus
    this.baseLayerStatus = diagnostics.baseLayerStatus
  }

  private emitDiagnostics(): void {
    this.callbacks?.onDiagnostics({
      sessionActive: this.activeSession !== null,
      glContextStatus: this.glContextStatus,
      baseLayerStatus: this.baseLayerStatus,
      referenceSpaceStatus: this.referenceSpaceStatus,
      xrFrameCount: this.xrFrameCount,
      poseSampleCount: this.poseSampleCount,
      trackingStatus: this.trackingActive ? 'active' : 'waiting',
      trackingActive: this.trackingActive,
      position: this.position,
      referenceSpaceType: this.referenceSpaceType,
      lastSampledAt: Number.isFinite(this.lastPublishedAt) ? this.lastPublishedAt : null,
      depth: this.depthService.getDiagnostics(),
      spatial: this.getSpatialPointDiagnostics(),
      coverage: this.spatialCoverageService.getDiagnostics(),
    })
  }

  private getSpatialPointDiagnostics(): SpatialPointDebug {
    return this.spatialPointService.getDiagnostics(this.spatialPointPreviewService.status)
  }

  private isActiveSession(session: XRSession): boolean {
    return this.activeSession === session
  }

  private clearStartPromise(startPromise: Promise<void>): void {
    if (this.startPromise === startPromise) {
      this.startPromise = null
    }
  }
}

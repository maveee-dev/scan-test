import type {
  DomOverlayStatus,
  ScannerReferenceSpaceType,
  ViewerPoseDebug,
  ViewerPosition,
} from '../types'

const DEBUG_SAMPLE_INTERVAL_MS = 250

export type XRSessionEndReason = 'stopped' | 'external'

export type XRSessionErrorCode =
  | 'webxr-unavailable'
  | 'permission-denied'
  | 'session-request-failed'
  | 'reference-space-failed'
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
  onDebugUpdate: (debug: ViewerPoseDebug) => void
  onError: (error: XRSessionError) => void
  onSessionEnded: (reason: XRSessionEndReason) => void
}

export interface XRSessionStartOptions {
  callbacks: XRSessionCallbacks
  overlayRoot: HTMLElement
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

  private referenceSpace: XRReferenceSpace | null = null

  private referenceSpaceType: ScannerReferenceSpaceType | null = null

  private frameRequestId: number | null = null

  private sessionEndListener: (() => void) | null = null

  private callbacks: XRSessionCallbacks | null = null

  private startPromise: Promise<void> | null = null

  private stopRequested = false

  private isEnding = false

  private sampledFrameCount = 0

  private lastPublishedAt = Number.NEGATIVE_INFINITY

  private trackingActive = false

  private position: ViewerPosition | null = null

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
        optionalFeatures: ['local-floor', 'dom-overlay'],
        domOverlay: { root: options.overlayRoot },
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
    this.sessionEndListener = () => this.handleSessionEnded(session)
    session.addEventListener('end', this.sessionEndListener)
    this.callbacks.onDomOverlayState(session.domOverlayState ? 'active' : 'unavailable')

    try {
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
      this.resetDebugState()
      this.startFrameProcessing(session)
    } catch (error) {
      if (this.isActiveSession(session)) {
        await this.endActiveSession(session).catch(() => undefined)
      }

      if (error instanceof XRSessionError) {
        throw error
      }

      throw createError(
        error,
        'The XR session could not prepare a tracking reference space.',
        'reference-space-failed',
      )
    }
  }

  private async requestReferenceSpace(session: XRSession): Promise<ReferenceSpaceResult> {
    try {
      const referenceSpace = await session.requestReferenceSpace('local-floor')
      return { referenceSpace, type: 'local-floor' }
    } catch {
      try {
        const referenceSpace = await session.requestReferenceSpace('local')
        return { referenceSpace, type: 'local' }
      } catch {
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

      if (!this.isActiveSession(session) || this.isEnding) {
        return
      }

      this.sampledFrameCount += 1

      let pose: XRViewerPose | undefined
      try {
        pose = frame.getViewerPose(referenceSpace)
      } catch {
        pose = undefined
      }

      this.trackingActive = pose !== undefined
      this.position = pose ? createPosition(pose.transform.position) : null

      if (time - this.lastPublishedAt >= DEBUG_SAMPLE_INTERVAL_MS) {
        this.lastPublishedAt = time
        this.publishDebug(time)
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

  private publishDebug(time: DOMHighResTimeStamp): void {
    this.callbacks?.onDebugUpdate({
      trackingActive: this.trackingActive,
      sampledFrameCount: this.sampledFrameCount,
      position: this.position,
      referenceSpaceType: this.referenceSpaceType,
      lastSampledAt: time,
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

  private resetDebugState(): void {
    this.sampledFrameCount = 0
    this.lastPublishedAt = Number.NEGATIVE_INFINITY
    this.trackingActive = false
    this.position = null
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

import type {
  DomOverlayStatus,
  FinalizedScannerCapture,
  RawCameraCopyFrame,
  ReferenceSpaceStatus,
  ScannerReferenceSpaceType,
  SpatialPointDebug,
  SpatialPointObservation,
  DenseMaskStabilizationOptions,
  XRPresentationStatus,
  ViewerPoseDebug,
  ViewerDirection,
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
import { SpatialCoverageRenderService } from './spatialCoverageRenderService'
import { DenseSurfaceMaskService } from './denseSurfaceMaskService'
import { PersistentLiveSurfaceService } from './persistentLiveSurfaceService'
import {
  DENSE_MASK_COLUMNS,
  DENSE_MASK_ROWS,
} from './spatialCoverageVisualConfig'
import { FinalizedSpatialScanService } from './finalizedSpatialScanService'
import {
  LivePerformanceTracker,
} from './livePerformanceService'
import { XRRawCameraService } from './xrRawCameraService'
import {
  RgbDepthRegistrationService,
} from './rgbDepthRegistrationService'
import { RealitySurfelColorFusionService } from './realitySurfelColorFusionService'
import { DenseRealityReconstructionService } from './denseRealityReconstructionService'

const DEBUG_SAMPLE_INTERVAL_MS = 250
// Keep XR pose/render callbacks at the browser's cadence while rebuilding the
// dense depth mask at a bounded ~5.6 Hz on mobile hardware.
const DENSE_MASK_UPDATE_INTERVAL_MS = 180

function getPerformanceTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export type XRSessionEndReason = 'stopped' | 'finished' | 'external'

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

function updatePosition(target: ViewerPosition, position: DOMPointReadOnly): void {
  target.x = position.x
  target.y = position.y
  target.z = position.z
}

function updateViewerDirection(target: ViewerDirection, orientation: DOMPointReadOnly): void {
  // Rotate the camera's local forward vector (0, 0, -1) by the XR pose
  // quaternion. This is only used for distinct-observation gating.
  const { x, y, z, w } = orientation
  target.x = -2 * (w * y + x * z)
  target.y = 2 * (w * x - y * z)
  target.z = -1 + 2 * (x * x + y * y)
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

  private readonly spatialCoverageRenderService = new SpatialCoverageRenderService()

  private readonly denseSurfaceMaskService = new DenseSurfaceMaskService()

  private readonly persistentLiveSurfaceService = new PersistentLiveSurfaceService()

  private readonly finalizedSpatialScanService = new FinalizedSpatialScanService()

  private readonly performanceTracker = new LivePerformanceTracker()

  private readonly rawCameraService = new XRRawCameraService()

  private readonly rgbDepthRegistrationService = new RgbDepthRegistrationService(
    this.rawCameraService,
  )

  private readonly realitySurfelColorFusionService = new RealitySurfelColorFusionService()

  private readonly denseRealityReconstructionService = new DenseRealityReconstructionService()

  private referenceSpace: XRReferenceSpace | null = null

  private referenceSpaceType: ScannerReferenceSpaceType | null = null

  private frameRequestId: number | null = null

  private sessionEndListener: (() => void) | null = null

  private callbacks: XRSessionCallbacks | null = null

  private startPromise: Promise<void> | null = null

  private stopRequested = false

  private requestedEndReason: XRSessionEndReason | null = null

  private isEnding = false

  private scanStartedAt: number | null = null

  private lastPublishedAt = Number.NEGATIVE_INFINITY

  private lastDenseMaskUpdatedAt = Number.NEGATIVE_INFINITY

  private rawCameraCopyPhase = 0

  private mappingPhase = 0

  private trackingActive = false

  private position: ViewerPosition | null = null

  private viewerDirection: ViewerDirection | null = null

  private latestSpatialObservations: readonly SpatialPointObservation[] = []

  private rawCurrentDepthVisible = false

  private persistentSurfelDebugVisible = false

  private rawCameraDebugVisible = false

  private rgbDepthDebugVisible = false

  private realityCaptureEnabled = false

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

  public setDebugGeometryVisible(visible: boolean): void {
    this.rawCurrentDepthVisible = visible
    this.spatialCoverageRenderService.setDebugGeometryVisible(visible)
  }

  public setPersistentSurfelDebugVisible(visible: boolean): void {
    this.persistentSurfelDebugVisible = visible
    this.spatialCoverageRenderService.setPersistentSurfelDebugVisible(visible)
    this.spatialCoverageRenderService.updatePersistentSurfaceMesh(
      this.persistentLiveSurfaceService.rebuildForDebugVisibility(visible),
    )
  }

  public setRawCameraDebugVisible(visible: boolean): void {
    this.rawCameraDebugVisible = visible
  }

  public setRgbDepthDebugVisible(visible: boolean): void {
    this.rgbDepthDebugVisible = visible
    this.spatialCoverageRenderService.setRgbDepthDebugVisible(visible)
    if (!visible) {
      this.spatialCoverageRenderService.clearRgbDepthMesh()
    }
  }

  public setDenseMaskStabilizationOptions(options: DenseMaskStabilizationOptions): void {
    this.denseSurfaceMaskService.setStabilizationOptions(options)
  }

  public async stop(): Promise<void> {
    if (this.isEnding) {
      return
    }

    this.stopRequested = true
    this.requestedEndReason = 'stopped'

    const startPromise = this.startPromise
    if (startPromise) {
      await startPromise.catch(() => undefined)
    }

    const session = this.activeSession
    if (!session) {
      this.stopRequested = false
      this.requestedEndReason = null
      return
    }

    this.rawCameraService.dispose()
    this.rgbDepthRegistrationService.reset()
    this.realitySurfelColorFusionService.reset()
    this.denseRealityReconstructionService.reset()
    this.realityCaptureEnabled = false
    this.rawCameraCopyPhase = 0

    try {
      await this.endActiveSession(session)
    } finally {
      this.stopRequested = false
    }
  }

  public async finish(): Promise<FinalizedScannerCapture> {
    if (this.startPromise) {
      throw new XRSessionError(
        'The scan session is still starting and cannot be finalized yet.',
        'session-ended',
      )
    }

    const session = this.activeSession
    if (!session || this.isEnding || this.scanStartedAt === null) {
      throw new XRSessionError(
        'There is no active scan session to finish.',
        'session-ended',
      )
    }

    if (!this.referenceSpaceType) {
      throw new XRSessionError(
        'The scan reference space is not ready to finalize.',
        'reference-space-failed',
      )
    }

    this.requestedEndReason = 'finished'
    this.isEnding = true
    this.stopFrameProcessing(session)
    this.rawCameraCopyPhase = 0

    try {
      const finishedAt = Date.now()
      const fusedSurfaceSurfels = this.persistentLiveSurfaceService.getFinalizationSurfels(
        this.spatialCoverageService,
      )
      const realityGeometrySurfels = this.persistentLiveSurfaceService.getRealityFinalizationSurfels()
      const persistentSurfaceDiagnostics = this.persistentLiveSurfaceService.getDiagnostics()
      const finalizedScan = this.finalizedSpatialScanService.createSnapshot({
        startedAtMs: this.scanStartedAt,
        finishedAtMs: finishedAt,
        referenceSpaceType: this.referenceSpaceType,
        coverageCells: this.spatialCoverageService.getFinalizationCells(),
        fusedSurfaceSurfels,
      })
      const realityReconstruction = this.realitySurfelColorFusionService.createSnapshot(
        finalizedScan.id,
        finalizedScan.referenceSpaceType,
        realityGeometrySurfels,
        this.rawCameraService.isAvailable(),
        persistentSurfaceDiagnostics.surfelCapacity,
        persistentSurfaceDiagnostics.capacityReached,
      )
      const denseRealityReconstruction = this.denseRealityReconstructionService.createSnapshot(
        finalizedScan.id,
        finalizedScan.referenceSpaceType,
        this.rawCameraService.isAvailable(),
      )

      await this.endActiveSession(session)
      return {
        spatialScan: finalizedScan,
        realityReconstruction,
        denseRealityReconstruction,
      }
    } catch (error) {
      if (this.isActiveSession(session)) {
        await this.endActiveSession(session).catch(() => undefined)
      }
      throw error
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
    this.spatialCoverageRenderService.dispose()
    this.denseSurfaceMaskService.dispose()
    this.persistentLiveSurfaceService.dispose()
    this.rawCameraService.dispose()
    this.realitySurfelColorFusionService.dispose()
    this.denseRealityReconstructionService.dispose()
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
        optionalFeatures: ['local-floor', 'dom-overlay', 'depth-sensing', 'camera-access'],
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
    this.realitySurfelColorFusionService.setCaptureState('starting', false)
    this.scanStartedAt = Date.now()
    this.depthService.initialize(session)
    this.spatialPointPreviewService.initialize(options.pointPreviewCanvas)
    this.sessionEndListener = () => this.handleSessionEnded(session)
    session.addEventListener('end', this.sessionEndListener)
    this.callbacks.onDomOverlayState(session.domOverlayState ? 'active' : 'unavailable')
    this.emitDiagnostics()

    try {
      const presentationDiagnostics = await this.presentationService.initialize(session)
      this.applyPresentationDiagnostics(presentationDiagnostics)
      this.rawCameraService.initialize(session, this.presentationService.getRenderTarget())
      this.realityCaptureEnabled = this.rawCameraService.isAvailable()
      this.realitySurfelColorFusionService.setCaptureState(
        this.realityCaptureEnabled ? 'active' : 'unavailable',
        this.realityCaptureEnabled,
      )
      this.spatialCoverageRenderService.initialize(this.presentationService.getRenderTarget())
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
      const frameStartedAt = getPerformanceTimestamp()
      this.frameRequestId = null
      this.xrFrameCount += 1

      if (!this.isActiveSession(session) || this.isEnding) {
        return
      }

      this.performanceTracker.beginFrame(time, frameStartedAt)

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
      if (pose) {
        this.position ??= { x: 0, y: 0, z: 0 }
        this.viewerDirection ??= { x: 0, y: 0, z: 0 }
        updatePosition(this.position, pose.transform.position)
        updateViewerDirection(this.viewerDirection, pose.transform.orientation)
      } else {
        this.position = null
        this.viewerDirection = null
      }

      const primaryView = pose?.views[0]
      if (!primaryView) {
        this.latestSpatialObservations = []
      }
      if (
        primaryView &&
        time - this.lastDenseMaskUpdatedAt >= DENSE_MASK_UPDATE_INTERVAL_MS
      ) {
        const depthAcquisitionStartedAt = getPerformanceTimestamp()
        const depthObservation = this.depthService.inspectFrame(frame, primaryView)
        this.performanceTracker.recordStage(
          'depthAcquisition',
          getPerformanceTimestamp() - depthAcquisitionStartedAt,
        )

        const candidateGenerationStartedAt = getPerformanceTimestamp()
        this.latestSpatialObservations = this.spatialPointService.processFrame(depthObservation)
        this.performanceTracker.recordStage(
          'candidateGeneration',
          getPerformanceTimestamp() - candidateGenerationStartedAt,
        )

        const denseDepthStartedAt = getPerformanceTimestamp()
        const denseDepthObservation = this.depthService.inspectDenseFrame(
          frame,
          primaryView,
          DENSE_MASK_COLUMNS,
          DENSE_MASK_ROWS,
        )
        this.performanceTracker.recordStage(
          'depthAcquisition',
          getPerformanceTimestamp() - denseDepthStartedAt,
        )
        if (denseDepthObservation) {
          const densePointStartedAt = getPerformanceTimestamp()
          const densePointFrame = this.spatialPointService.processDenseFrame(
            denseDepthObservation,
          )
          const densePointDurationMs = Math.max(
            0,
            getPerformanceTimestamp() - densePointStartedAt,
          )
          this.performanceTracker.recordStage('candidateGeneration', densePointDurationMs)
          const depthReconstructionDurationMs = Math.max(
            0,
            getPerformanceTimestamp() - denseDepthStartedAt,
          )

          this.rawCameraCopyPhase = (this.rawCameraCopyPhase + 1) % 2
          let currentRawCameraFrame: RawCameraCopyFrame | null = null
          let currentRgbDepthResult: ReturnType<RgbDepthRegistrationService['process']> | null = null
          const realityCaptureAvailable = this.realityCaptureEnabled && this.rawCameraService.isAvailable()
          const cameraProbeEnabled = realityCaptureAvailable ||
            this.rgbDepthDebugVisible ||
            this.rawCameraDebugVisible
          if (cameraProbeEnabled && this.rawCameraCopyPhase === 0) {
            if (this.realityCaptureEnabled) {
              this.realitySurfelColorFusionService.recordEligibleRgbdTick()
            }
            if (densePointFrame.validPointCount > 0) {
              const copied = this.rawCameraService.copyFrame(
                frame,
                primaryView,
                time,
                this.rawCameraDebugVisible,
              )
              if (copied) {
                currentRawCameraFrame = this.rawCameraService.getLatestCopyFrame()
              }
            } else {
              this.rawCameraService.recordSkipped()
            }
          }

          if (this.realityCaptureEnabled && !this.rawCameraService.isAvailable()) {
            this.realityCaptureEnabled = false
            this.realitySurfelColorFusionService.setCameraAvailability(false)
          }

          if (this.realityCaptureEnabled || this.rgbDepthDebugVisible) {
            if (currentRawCameraFrame) {
              currentRgbDepthResult = this.rgbDepthRegistrationService.process(
                densePointFrame,
                primaryView,
                currentRawCameraFrame,
                time,
                true,
              )
              if (this.rgbDepthDebugVisible) {
                this.spatialCoverageRenderService.updateRgbDepthMesh(currentRgbDepthResult.mesh)
              }
            } else if (this.rawCameraService.isAvailable()) {
              this.rgbDepthRegistrationService.recordStaleFrame(
                densePointFrame.validPointCount,
                time,
              )
            } else {
              currentRgbDepthResult = this.rgbDepthRegistrationService.process(
                densePointFrame,
                primaryView,
                null,
                time,
                false,
              )
              if (this.rgbDepthDebugVisible) {
                this.spatialCoverageRenderService.updateRgbDepthMesh(currentRgbDepthResult.mesh)
              }
            }
          }

          const coverageStartedAt = getPerformanceTimestamp()
          this.spatialCoverageService.processDenseFrame(
            densePointFrame,
            this.position,
            this.viewerDirection,
            time,
            this.mappingPhase,
          )
          this.performanceTracker.recordStage(
            'coverageUpdate',
            getPerformanceTimestamp() - coverageStartedAt,
          )
          this.mappingPhase = (this.mappingPhase + 1) % 4

          const persistentSurfaceResult = this.persistentLiveSurfaceService.processFrame(
            densePointFrame,
            this.position,
            time,
            this.spatialCoverageService,
            this.persistentSurfelDebugVisible,
          )
          this.performanceTracker.recordStage(
            'normalFiltering',
            persistentSurfaceResult.performance.normalFilteringDurationMs,
          )
          this.performanceTracker.recordStage(
            'fusionUpdate',
            persistentSurfaceResult.performance.fusionDurationMs,
          )

          if (currentRgbDepthResult) {
            this.realitySurfelColorFusionService.process(
              currentRgbDepthResult,
              densePointFrame,
              persistentSurfaceResult.matchedSurfelIds,
              persistentSurfaceResult.matchedSurfelGenerations,
              persistentSurfaceResult.removedSurfelIds,
              this.persistentLiveSurfaceService,
              this.position,
              time,
              persistentSurfaceResult.activeSurfelCount,
            )
            this.denseRealityReconstructionService.process(
              currentRgbDepthResult,
              densePointFrame,
              this.persistentLiveSurfaceService,
              this.position,
              time,
            )
          }

          const persistentRenderStartedAt = getPerformanceTimestamp()
          this.spatialCoverageRenderService.updatePersistentSurfaceMesh(
            persistentSurfaceResult.persistentSurfaceMesh,
          )
          this.performanceTracker.recordStage(
            'persistentRenderPreparation',
            persistentSurfaceResult.performance.renderPreparationDurationMs +
              getPerformanceTimestamp() - persistentRenderStartedAt,
          )

          const candidateVisualizationStartedAt = getPerformanceTimestamp()
          this.spatialCoverageRenderService.updateCandidateSurfaceMesh(
            persistentSurfaceResult.candidateSurfaceMesh,
          )
          if (this.rawCurrentDepthVisible) {
            const denseMesh = this.denseSurfaceMaskService.build(
              densePointFrame,
              this.spatialCoverageService,
              time,
              depthReconstructionDurationMs,
            )
            this.spatialCoverageRenderService.updateDenseMesh(denseMesh)
          } else {
            this.spatialCoverageRenderService.clearDenseMesh()
          }
          this.performanceTracker.recordStage(
            'candidateVisualization',
            getPerformanceTimestamp() - candidateVisualizationStartedAt,
          )
          this.lastDenseMaskUpdatedAt = time
        } else {
          const candidateVisualizationStartedAt = getPerformanceTimestamp()
          if (this.rawCurrentDepthVisible) {
            const cachedDenseMesh = this.denseSurfaceMaskService.buildCached(time)
            this.spatialCoverageRenderService.updateDenseMesh(cachedDenseMesh)
          } else {
            this.spatialCoverageRenderService.clearDenseMesh()
          }
          this.spatialCoverageRenderService.clearCandidateSurfaceMesh()
          this.performanceTracker.recordStage(
            'candidateVisualization',
            getPerformanceTimestamp() - candidateVisualizationStartedAt,
          )
          this.latestSpatialObservations = []
          if (this.rgbDepthDebugVisible) {
            this.spatialCoverageRenderService.clearRgbDepthMesh()
          }
          this.lastDenseMaskUpdatedAt = time
        }
      }

      const renderStartedAt = getPerformanceTimestamp()
      this.spatialCoverageRenderService.render(pose?.views ?? [])
      this.performanceTracker.recordStage('webGlDraw', getPerformanceTimestamp() - renderStartedAt)

      if (time - this.lastPublishedAt >= DEBUG_SAMPLE_INTERVAL_MS) {
        this.lastPublishedAt = time
        const previewStartedAt = getPerformanceTimestamp()
        this.spatialPointPreviewService.render(this.latestSpatialObservations)
        this.performanceTracker.recordStage(
          'reactDiagnostics',
          getPerformanceTimestamp() - previewStartedAt,
        )
        this.publishDiagnostics(time)
      }

      this.performanceTracker.endFrame(time, getPerformanceTimestamp())

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
    const publicationStartedAt = getPerformanceTimestamp()
    this.callbacks?.onDiagnostics(this.createDiagnosticsSnapshot(time))
    this.performanceTracker.recordStage(
      'reactDiagnostics',
      getPerformanceTimestamp() - publicationStartedAt,
    )
  }

  private createDiagnosticsSnapshot(time: number): ViewerPoseDebug {
    const renderDiagnostics = this.spatialCoverageRenderService.getDiagnostics()
    const denseDiagnostics = this.denseSurfaceMaskService.getDiagnostics()
    const liveSurfaceDiagnostics = this.persistentLiveSurfaceService.getDiagnostics()
    const coverageDiagnostics = this.spatialCoverageService.getDiagnostics(
      renderDiagnostics,
      denseDiagnostics,
      liveSurfaceDiagnostics,
    )
    return {
      sessionActive: this.activeSession !== null,
      glContextStatus: this.glContextStatus,
      baseLayerStatus: this.baseLayerStatus,
      referenceSpaceStatus: this.referenceSpaceStatus,
      xrFrameCount: this.xrFrameCount,
      poseSampleCount: this.poseSampleCount,
      trackingStatus: this.trackingActive ? 'active' : 'waiting',
      trackingActive: this.trackingActive,
      position: this.position ? { ...this.position } : null,
      referenceSpaceType: this.referenceSpaceType,
      lastSampledAt: time,
      depth: this.depthService.getDiagnostics(),
      spatial: this.getSpatialPointDiagnostics(),
      coverage: coverageDiagnostics,
      performance: this.performanceTracker.getDiagnostics(time, {
        activeSurfelCount: liveSurfaceDiagnostics.surfelCount,
        renderedSurfelCount: liveSurfaceDiagnostics.renderedSurfelCount,
        candidatePatchCount: liveSurfaceDiagnostics.candidateVisualSurfelCount,
        coverageCellCount: coverageDiagnostics.totalUniqueCells,
      }),
      rawCamera: this.rawCameraService.getDiagnostics(this.rawCameraDebugVisible),
      rgbDepth: this.rgbDepthRegistrationService.getDiagnostics(),
      realityColor: this.realitySurfelColorFusionService.getDiagnostics(),
      denseReality: this.denseRealityReconstructionService.getDiagnostics(),
    }
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
    this.spatialCoverageRenderService.dispose()
    this.denseSurfaceMaskService.dispose()
    this.persistentLiveSurfaceService.dispose()
    this.presentationService.dispose()
    this.depthService.dispose()
    this.spatialPointService.reset()
    this.spatialPointPreviewService.dispose()
    this.spatialCoverageService.reset()
    this.denseSurfaceMaskService.reset()
    this.persistentLiveSurfaceService.reset()
    this.frameRequestId = null
    this.scanStartedAt = null
    this.trackingActive = false
    this.position = null
    this.viewerDirection = null
    this.latestSpatialObservations = []
    this.rawCurrentDepthVisible = false
    this.persistentSurfelDebugVisible = false
    this.rawCameraDebugVisible = false
    this.rgbDepthDebugVisible = false
    this.realityCaptureEnabled = false
    this.rawCameraCopyPhase = 0
    this.rawCameraService.dispose()
    this.rgbDepthRegistrationService.reset()
    this.realitySurfelColorFusionService.reset()
    this.denseRealityReconstructionService.reset()
    this.isEnding = false
    this.performanceTracker.reset(getPerformanceTimestamp())

    const callback = this.callbacks?.onSessionEnded
    const endReason = this.requestedEndReason ?? 'external'
    this.requestedEndReason = null
    this.callbacks = null
    callback?.(endReason)
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
    this.lastDenseMaskUpdatedAt = Number.NEGATIVE_INFINITY
    this.mappingPhase = 0
    this.trackingActive = false
    this.position = null
    this.viewerDirection = null
    this.latestSpatialObservations = []
    this.rawCurrentDepthVisible = false
    this.persistentSurfelDebugVisible = false
    this.rawCameraDebugVisible = false
    this.rgbDepthDebugVisible = false
    this.realityCaptureEnabled = false
    this.rawCameraCopyPhase = 0
    this.scanStartedAt = null
    this.requestedEndReason = null
    this.depthService.dispose()
    this.spatialPointService.reset()
    this.spatialPointPreviewService.dispose()
    this.spatialCoverageService.reset()
    this.spatialCoverageRenderService.dispose()
    this.denseSurfaceMaskService.dispose()
    this.persistentLiveSurfaceService.dispose()
    this.rawCameraService.dispose()
    this.rgbDepthRegistrationService.reset()
    this.realitySurfelColorFusionService.reset()
    this.denseRealityReconstructionService.reset()
    this.performanceTracker.reset(getPerformanceTimestamp())
  }

  private applyPresentationDiagnostics(diagnostics: XRPresentationDiagnostics): void {
    this.glContextStatus = diagnostics.glContextStatus
    this.baseLayerStatus = diagnostics.baseLayerStatus
  }

  private emitDiagnostics(): void {
    this.callbacks?.onDiagnostics(this.createDiagnosticsSnapshot(
      Number.isFinite(this.lastPublishedAt) ? this.lastPublishedAt : getPerformanceTimestamp(),
    ))
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

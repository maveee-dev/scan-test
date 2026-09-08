import type {
  DomOverlayStatus,
  FinalizedScannerCapture,
  RawCameraCopyFrame,
  ReferenceSpaceStatus,
  ScannerReferenceSpaceType,
  ScannerFinishStage,
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
import { RealityQualityPolicy, type ScanTrajectoryPoint } from './realityQualityPolicy'
import { LiveRealityMap } from './liveRealityMap'
import { RealityMeasurementStabilityService } from './realityMeasurementStabilityService'
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
import { RealityRgbKeyframeService } from './realityRgbKeyframeService'
import { RealityMeasurementQueueService } from './realityMeasurementQueueService'
import { RetainedRealityMeasurementService } from './retainedRealityMeasurementService'
import { reconstructCanonicalReality } from './postScanCanonicalFusionService'
import type { RealityFrameAcceptance, RealityMeasurementPacket } from './realityMeasurementStabilityService'
import type { RgbDepthRegistrationResult } from './rgbDepthRegistrationService'

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
  onFinishStage: (stage: ScannerFinishStage) => void
}

export interface FinishPipelineDiagnostics {
  readonly clickToProcessingUiFirstPaintMs: number
  readonly clickToRetainedFinalizationBeginMs: number
  readonly clickToWorkerMessagePostedMs: number
  readonly stopAndCaptureDrainMs: number
  readonly retainedMeasurementFinalizationMs: number
  readonly canonicalWorkerRoundTripMs: number
  readonly canonicalWorkerMs: number
  readonly resultAssemblyMs: number
  readonly xrSessionEndMs: number
  readonly totalFinishMs: number
  readonly snapshotStageTimingsMs: Readonly<{
    liveSurface: number
    spatialScan: number
    baseReality: number
    denseReality: number
    rgbKeyframes: number
    appearanceKeyframes: number
    retainedMeasurements: number
  }>
}

export interface FinishInvocationTiming {
  readonly clickToProcessingUiFirstPaintMs: number
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

interface QueuedRealityMeasurement {
  readonly packet: RealityMeasurementPacket
  readonly acceptance: RealityFrameAcceptance
  readonly registration: RgbDepthRegistrationResult | null
  readonly cameraDirection: ViewerDirection
  readonly depthReconstructionDurationMs: number
  readonly sampling: { columns: number; rows: number; phase: number }
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

  private readonly realityRgbKeyframeService = new RealityRgbKeyframeService()
  private readonly appearanceKeyframeService = new RealityRgbKeyframeService(true)
  private readonly qualityPolicy = new RealityQualityPolicy()
  private readonly measurementStabilityService = new RealityMeasurementStabilityService()
  private readonly retainedMeasurementService = new RetainedRealityMeasurementService()
  private readonly measurementQueue = new RealityMeasurementQueueService<QueuedRealityMeasurement>(
    (measurement) => this.processQueuedMeasurement(measurement),
  )
  public readonly liveMap = new LiveRealityMap()

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

    // Cancel the newest pending packet before any stateful fusion service is
    // reset. A scheduled task must never repopulate a stopped scan.
    this.measurementQueue.reset()
    this.rawCameraService.dispose()
    this.rgbDepthRegistrationService.reset()
    this.realitySurfelColorFusionService.reset()
    this.denseRealityReconstructionService.reset()
    this.realityRgbKeyframeService.reset()
    this.appearanceKeyframeService.reset()
    this.retainedMeasurementService.reset()
    this.qualityPolicy.reset()
    this.realityCaptureEnabled = false
    this.rawCameraCopyPhase = 0

    try {
      await this.endActiveSession(session)
    } finally {
      this.stopRequested = false
    }
  }

  public async finish(invocationTiming: FinishInvocationTiming = { clickToProcessingUiFirstPaintMs: 0 }): Promise<FinalizedScannerCapture> {
    const finishStartedAt = getPerformanceTimestamp()
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
    const scanStartedAt = this.scanStartedAt
    const referenceSpaceType = this.referenceSpaceType

    this.requestedEndReason = 'finished'
    this.isEnding = true
    this.stopFrameProcessing(session)
    this.rawCameraCopyPhase = 0
    this.callbacks?.onFinishStage('preparing-scan')

    try {
      const drainStartedAt = getPerformanceTimestamp()
      await this.measurementQueue.flush()
      const stopAndCaptureDrainMs = getPerformanceTimestamp() - drainStartedAt
      const finalizationStartedAt = getPerformanceTimestamp()
      const clickToRetainedFinalizationBeginMs = invocationTiming.clickToProcessingUiFirstPaintMs + finalizationStartedAt - finishStartedAt
      const finishedAt = Date.now()
      const snapshotStageTimingsMs = { liveSurface: 0, spatialScan: 0, baseReality: 0, denseReality: 0,
        rgbKeyframes: 0, appearanceKeyframes: 0, retainedMeasurements: 0 }
      const timedSnapshot = <T>(name: keyof typeof snapshotStageTimingsMs, producer: () => T): T => {
        const stageStartedAt = getPerformanceTimestamp()
        const value = producer()
        snapshotStageTimingsMs[name] += getPerformanceTimestamp() - stageStartedAt
        return value
      }
      const fusedSurfaceSurfels = timedSnapshot('liveSurface', () => this.persistentLiveSurfaceService.getFinalizationSurfels(
        this.spatialCoverageService,
      ))
      const realityGeometrySurfels = timedSnapshot('liveSurface', () => this.persistentLiveSurfaceService.getRealityFinalizationSurfels())
      const persistentSurfaceDiagnostics = timedSnapshot('liveSurface', () => this.persistentLiveSurfaceService.getDiagnostics())
      const finalizedScan = timedSnapshot('spatialScan', () => this.finalizedSpatialScanService.createSnapshot({
        startedAtMs: scanStartedAt,
        finishedAtMs: finishedAt,
        referenceSpaceType,
        coverageCells: this.spatialCoverageService.getFinalizationCells(),
        fusedSurfaceSurfels,
      }))
      const realityReconstruction = timedSnapshot('baseReality', () => this.realitySurfelColorFusionService.createSnapshot(
        finalizedScan.id,
        finalizedScan.referenceSpaceType,
        realityGeometrySurfels,
        this.rawCameraService.isAvailable(),
        persistentSurfaceDiagnostics.surfelCapacity,
        persistentSurfaceDiagnostics.capacityReached,
      ))
      const rawDenseReality = timedSnapshot('denseReality', () => this.denseRealityReconstructionService.createSnapshot(
        finalizedScan.id,
        finalizedScan.referenceSpaceType,
        this.rawCameraService.isAvailable(),
      ))
      const realityRgbKeyframes = timedSnapshot('rgbKeyframes', () => this.realityRgbKeyframeService.createSnapshot(
        finalizedScan.id,
        this.rawCameraService.isAvailable(),
      ))
      const depth = this.depthService.getDiagnostics()
      const liveRgb = this.rawCameraService.getDiagnostics(false)
      const appearanceKeyframes = timedSnapshot('appearanceKeyframes', () => this.appearanceKeyframeService.createSnapshot(finalizedScan.id, this.rawCameraService.isAvailable()))
      const retainedMeasurements = timedSnapshot('retainedMeasurements', () => this.retainedMeasurementService.createSnapshot())
      const retainedMeasurementFinalizationMs = getPerformanceTimestamp() - finalizationStartedAt
      const canonicalStartedAt = getPerformanceTimestamp()
      const clickToWorkerMessagePostedMs = invocationTiming.clickToProcessingUiFirstPaintMs + canonicalStartedAt - finishStartedAt
      const canonicalReality = rawDenseReality && retainedMeasurements.frames.length > 0
        ? await reconstructCanonicalReality(retainedMeasurements, (stage) => this.callbacks?.onFinishStage(stage))
        : null
      const canonicalWorkerRoundTripMs = getPerformanceTimestamp() - canonicalStartedAt
      this.callbacks?.onFinishStage('building-final-model')
      const assemblyStartedAt = getPerformanceTimestamp()
      const canonicalSurfels = canonicalReality?.surfels ?? rawDenseReality?.surfels ?? []
      const canonicalColored = canonicalSurfels.filter((surfel) => surfel.colorRgb !== null)
      const denseRealityBase = rawDenseReality ? { ...rawDenseReality,
        // Geometry availability is independent of optional camera color.
        status: canonicalSurfels.length > 0 ? 'available' as const : 'empty' as const,
        surfels: canonicalSurfels,
        canonicalSurfels,
        liveLightweightSurfels: rawDenseReality.fusedRawSurfels ?? rawDenseReality.surfels,
        bounds: canonicalReality?.bounds ?? rawDenseReality.bounds,
        colorStatistics: canonicalReality?.colorStatistics ?? rawDenseReality.colorStatistics,
        captureSummary: Object.freeze({ ...rawDenseReality.captureSummary,
          totalSurfels: canonicalSurfels.length,
          coloredSurfels: canonicalColored.length,
          colorCoveragePercentage: canonicalSurfels.length > 0 ? canonicalColored.length / canonicalSurfels.length * 100 : 0,
          averageColorObservations: canonicalColored.length > 0 ? canonicalColored.reduce((total, surfel) => total + surfel.colorObservationCount, 0) / canonicalColored.length : 0,
          averageColorConfidence: canonicalColored.length > 0 ? canonicalColored.reduce((total, surfel) => total + surfel.colorConfidence, 0) / canonicalColored.length : 0,
        }),
        appearanceKeyframes,
        qualityTelemetry: this.qualityPolicy.snapshot(),
        depthSource: { width: depth.width, height: depth.height, scale: depth.rawValueToMeters },
        liveRgbDimensions: { width: liveRgb.copyWidth, height: liveRgb.copyHeight },
        rawMeasurements: Object.freeze(this.measurementStabilityService.createRawSnapshot()),
        measurementDiagnostics: Object.freeze(this.measurementStabilityService.getDiagnostics()),
        measurementQueueDiagnostics: Object.freeze(this.measurementQueue.getDiagnostics()),
        retainedMeasurementDiagnostics: retainedMeasurements.diagnostics,
        canonicalFusionDiagnostics: canonicalReality?.diagnostics,
        provisionalExpiryMap: canonicalReality?.diagnostics.provisionalExpiryMap,
        consolidatedMeasurementMap: canonicalReality?.consolidatedMeasurementMap,
      } : null
      const resultAssemblyMs = getPerformanceTimestamp() - assemblyStartedAt

      const endStartedAt = getPerformanceTimestamp()
      await this.endActiveSession(session)
      const xrSessionEndMs = getPerformanceTimestamp() - endStartedAt
      const finishPipelineDiagnostics: FinishPipelineDiagnostics = Object.freeze({
        clickToProcessingUiFirstPaintMs: invocationTiming.clickToProcessingUiFirstPaintMs,
        clickToRetainedFinalizationBeginMs,
        clickToWorkerMessagePostedMs,
        stopAndCaptureDrainMs,
        retainedMeasurementFinalizationMs,
        canonicalWorkerRoundTripMs,
        canonicalWorkerMs: canonicalReality?.diagnostics.workerTimeMs ?? 0,
        resultAssemblyMs,
        xrSessionEndMs,
        totalFinishMs: getPerformanceTimestamp() - finishStartedAt,
        snapshotStageTimingsMs: Object.freeze(snapshotStageTimingsMs),
      })
      const denseRealityReconstruction = denseRealityBase
        ? Object.freeze({ ...denseRealityBase, finishPipelineDiagnostics })
        : null
      return {
        spatialScan: finalizedScan,
        realityReconstruction,
        denseRealityReconstruction,
        realityRgbKeyframes,
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
    this.realityRgbKeyframeService.dispose()
    this.appearanceKeyframeService.dispose()
    this.liveMap.reset()
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
      this.qualityPolicy.recordFrame(time)

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
      const physicalPose: ScanTrajectoryPoint | null = pose ? {
        position: { x: pose.transform.position.x, y: pose.transform.position.y, z: pose.transform.position.z },
        orientation: { x: pose.transform.orientation.x, y: pose.transform.orientation.y, z: pose.transform.orientation.z, w: pose.transform.orientation.w }, timestamp: time,
      } : null
      if (physicalPose) this.qualityPolicy.observePose(physicalPose)
      if (!primaryView) {
        this.latestSpatialObservations = []
        if(time-this.lastDenseMaskUpdatedAt>=DENSE_MASK_UPDATE_INTERVAL_MS) {
          this.measurementStabilityService.recordTrackingMissing()
          this.lastDenseMaskUpdatedAt = time
        }
      }
      const denseMeasurementDue = Boolean(
        primaryView && physicalPose &&
        time - this.lastDenseMaskUpdatedAt >= DENSE_MASK_UPDATE_INTERVAL_MS,
      )
      if (primaryView && physicalPose) {
        if (denseMeasurementDue) this.measurementStabilityService.recordCandidateTick()
        else this.measurementStabilityService.recordCadenceSkipped()
      }
      const motionAllowsMeasurement = Boolean(
        denseMeasurementDue && physicalPose && this.qualityPolicy.shouldProcess(physicalPose),
      )
      if (denseMeasurementDue && !motionAllowsMeasurement) {
        // A skipped tick is atomic: depth, pose, RGB, phase and sequence are all
        // omitted. No part of an older packet may be reused on the next tick.
        this.measurementStabilityService.recordSkippedTogether()
        this.lastDenseMaskUpdatedAt = time
      }
      if (
        primaryView && physicalPose && motionAllowsMeasurement
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
        // getDepthInMeters uses normalized VIEW coordinates, so distribute the
        // fixed attempt budget according to view projection aspect, not raw
        // camera/depth-buffer orientation or a second projection convention.
        const sampling = this.qualityPolicy.claimSampling(Math.abs(primaryView.projectionMatrix[5] / primaryView.projectionMatrix[0]))
        const denseDepthObservation = this.depthService.inspectDenseFrame(
          frame,
          primaryView,
          sampling.columns,
          sampling.rows,
          sampling.phase,
        )
        this.performanceTracker.recordStage(
          'depthAcquisition',
          getPerformanceTimestamp() - denseDepthStartedAt,
        )
        this.measurementQueue.recordStage('depth-capture', getPerformanceTimestamp() - denseDepthStartedAt)
        if (denseDepthObservation) {
          const densePointStartedAt = getPerformanceTimestamp()
          const reconstructedPointFrame = this.spatialPointService.processDenseFrame(
            denseDepthObservation,
          )
          const densePointDurationMs = Math.max(
            0,
            getPerformanceTimestamp() - densePointStartedAt,
          )
          this.performanceTracker.recordStage('candidateGeneration', densePointDurationMs)
          this.measurementQueue.recordStage('world-reconstruction', densePointDurationMs)
          const depthReconstructionDurationMs = Math.max(
            0,
            getPerformanceTimestamp() - denseDepthStartedAt,
          )

          const validationStartedAt=getPerformanceTimestamp()
          const depthDebug=this.depthService.getDiagnostics()
          const packet=this.measurementStabilityService.createPacket({sequence:this.xrFrameCount,timestamp:time,
            referenceSpaceType:this.referenceSpaceType??'local',samplingPhase:sampling.phase,qualityTier:this.qualityPolicy.snapshot().tier,
            pose:physicalPose,view:primaryView,depth:denseDepthObservation,spatial:reconstructedPointFrame,
            depthWidth:depthDebug.width,depthHeight:depthDebug.height,depthScale:depthDebug.rawValueToMeters})
          const consistency=this.denseRealityReconstructionService.assessFrameConsistency(packet.denseFrame,packet.normals,packet.normalValid)
          const acceptance=this.measurementStabilityService.evaluate(packet,consistency)
          this.measurementQueue.recordStage('packet-validation',getPerformanceTimestamp()-validationStartedAt)
          const densePointFrame=packet.denseFrame
          if (acceptance.accepted) {
            this.rawCameraCopyPhase = (this.rawCameraCopyPhase + 1) % 2
            const appearanceDecision = this.qualityPolicy.appearanceCaptureDecision(this.measurementQueue.getDiagnostics().queueDepth)
            // High-resolution appearance is optional and yields first under
            // pressure. The M8.6 mask keyframe cadence remains unchanged.
            if (this.realityCaptureEnabled && this.rawCameraCopyPhase === 1 && appearanceDecision.allowed) {
              const appearanceStartedAt=getPerformanceTimestamp()
              this.appearanceKeyframeService.considerCapture(frame, primaryView, time, packet.pose.position, this.viewerDirection,
                densePointFrame.validPointCount * 3600 / (sampling.columns * sampling.rows), this.rawCameraService, this.qualityPolicy.appearanceMotion())
              this.measurementQueue.recordStage('appearance-copy',getPerformanceTimestamp()-appearanceStartedAt)
            } else if(this.realityCaptureEnabled&&this.rawCameraCopyPhase===1) this.appearanceKeyframeService.recordCandidateOutcome('pressure-skipped')
            let currentRawCameraFrame: RawCameraCopyFrame | null = null
            let currentRgbDepthResult: RgbDepthRegistrationResult | null = null
            const realityCaptureAvailable = this.realityCaptureEnabled && this.rawCameraService.isAvailable()
            const cameraProbeEnabled = realityCaptureAvailable || this.rgbDepthDebugVisible || this.rawCameraDebugVisible
            if (cameraProbeEnabled && this.rawCameraCopyPhase === 0) {
              if (this.realityCaptureEnabled) this.realitySurfelColorFusionService.recordEligibleRgbdTick()
              if (densePointFrame.validPointCount > 0) {
                const copied = this.rawCameraService.copyFrame(frame, primaryView, time, this.rawCameraDebugVisible)
                if (copied) {
                  currentRawCameraFrame = this.rawCameraService.getLatestCopyFrame()
                  this.realityRgbKeyframeService.considerCapture(frame, primaryView, time, packet.pose.position,
                    this.viewerDirection, densePointFrame.validPointCount, this.rawCameraService)
                }
              } else this.rawCameraService.recordSkipped()
            }
            if (this.realityCaptureEnabled && !this.rawCameraService.isAvailable()) {
              this.realityCaptureEnabled = false
              this.realitySurfelColorFusionService.setCameraAvailability(false)
            }
            if (this.realityCaptureEnabled || this.rgbDepthDebugVisible) {
              if (currentRawCameraFrame) {
                const registrationStartedAt=getPerformanceTimestamp()
                currentRgbDepthResult = this.rgbDepthRegistrationService.process(densePointFrame, primaryView, currentRawCameraFrame, time, true)
                this.measurementQueue.recordStage('rgb-registration',getPerformanceTimestamp()-registrationStartedAt)
                if (this.rgbDepthDebugVisible) this.spatialCoverageRenderService.updateRgbDepthMesh(currentRgbDepthResult.mesh)
              } else if (this.rawCameraService.isAvailable()) {
                this.rgbDepthRegistrationService.recordStaleFrame(densePointFrame.validPointCount, time)
              } else {
                currentRgbDepthResult = this.rgbDepthRegistrationService.process(densePointFrame, primaryView, null, time, false)
                if (this.rgbDepthDebugVisible) this.spatialCoverageRenderService.updateRgbDepthMesh(currentRgbDepthResult.mesh)
              }
            }
            const queuedRegistration=currentRgbDepthResult?{...currentRgbDepthResult,
              sourceSampleIndices:new Int32Array(currentRgbDepthResult.sourceSampleIndices),
              srgbColors:new Uint8Array(currentRgbDepthResult.srgbColors)}:null
            // Final geometry must not depend on optional raw-camera access.
            // RGB evidence remains optional and is retained only when an
            // accepted packet owns a matching registration result.
            this.retainedMeasurementService.consider(packet, acceptance.trackingQuality, queuedRegistration)
            const result=this.measurementQueue.enqueue({packet,acceptance,registration:queuedRegistration,
              cameraDirection:{...(this.viewerDirection??{x:0,y:0,z:-1})},depthReconstructionDurationMs,sampling})
            if(result==='replaced'||result==='dropped')this.measurementStabilityService.recordBackpressureSkipped()
          } else {
            this.latestSpatialObservations=[]
            this.spatialCoverageRenderService.clearCandidateSurfaceMesh()
            this.spatialCoverageRenderService.clearDenseMesh()
            if(this.rgbDepthDebugVisible)this.spatialCoverageRenderService.clearRgbDepthMesh()
            this.lastDenseMaskUpdatedAt=time
          }
          this.lastDenseMaskUpdatedAt=time
          this.qualityPolicy.recordTick(getPerformanceTimestamp()-depthAcquisitionStartedAt,sampling.columns*sampling.rows,densePointFrame.validPointCount,sampling,true)
        } else {
          this.measurementStabilityService.recordDepthMissing()
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
          this.qualityPolicy.recordTick(getPerformanceTimestamp()-depthAcquisitionStartedAt,sampling.columns*sampling.rows,0,sampling,true)
        }
      }

      const renderStartedAt = getPerformanceTimestamp()
      this.spatialCoverageRenderService.render(pose?.views ?? [])
      this.performanceTracker.recordStage('webGlDraw', getPerformanceTimestamp() - renderStartedAt)
      // DOM-overlay canvas has its own renderer/context/camera. Keep it driven
      // by XR rAF: window rAF can be suspended during immersive presentation.
      const qualitySnapshot=this.qualityPolicy.snapshot()
      const scannerUnderPressure=this.measurementQueue.getDiagnostics().queueDepth>0||(qualitySnapshot.xrFrameIntervalMs??0)>38
      if (physicalPose) {
        try { this.liveMap.publish({ pose: physicalPose, copy: (positions, colors) => this.denseRealityReconstructionService.copyLiveMap(positions, colors),underPressure:scannerUnderPressure }) }
        catch { /* Inspection failure must never terminate measured capture. */ }
      }

      if (time - this.lastPublishedAt >= (scannerUnderPressure?DEBUG_SAMPLE_INTERVAL_MS*3:DEBUG_SAMPLE_INTERVAL_MS)) {
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

  private processQueuedMeasurement(measurement: QueuedRealityMeasurement): void {
    const { packet, acceptance, registration, cameraDirection, depthReconstructionDurationMs } = measurement
    const densePointFrame = packet.denseFrame
    const cameraPosition = packet.pose.position
    const time = packet.timestamp

    const coverageStartedAt = getPerformanceTimestamp()
    this.spatialCoverageService.processDenseFrame(
      densePointFrame,
      cameraPosition,
      cameraDirection,
      time,
      this.mappingPhase,
    )
    this.measurementQueue.recordStage('coverage', getPerformanceTimestamp() - coverageStartedAt)
    this.mappingPhase = (this.mappingPhase + 1) % 4

    const persistentStartedAt = getPerformanceTimestamp()
    const persistentSurfaceResult = this.persistentLiveSurfaceService.processFrame(
      densePointFrame,
      cameraPosition,
      time,
      this.spatialCoverageService,
      this.persistentSurfelDebugVisible,
    )
    this.measurementQueue.recordStage('persistent-surface', getPerformanceTimestamp() - persistentStartedAt)

    if (registration) {
      this.realitySurfelColorFusionService.process(
        registration,
        densePointFrame,
        persistentSurfaceResult.matchedSurfelIds,
        persistentSurfaceResult.matchedSurfelGenerations,
        persistentSurfaceResult.removedSurfelIds,
        this.persistentLiveSurfaceService,
        cameraPosition,
        time,
        persistentSurfaceResult.activeSurfelCount,
      )
    }
    if (this.realityCaptureEnabled) {
      const denseStartedAt = getPerformanceTimestamp()
      const xrInterval = this.qualityPolicy.snapshot().xrFrameIntervalMs ?? 0
      const liveSampleBudget = xrInterval > 45 ? 520 : xrInterval > 34 ? 680 : 900
      this.denseRealityReconstructionService.process(
        registration,
        densePointFrame,
        this.persistentLiveSurfaceService,
        cameraPosition,
        time,
        { frameSequence: packet.sequence, trackingQuality: acceptance.trackingQuality, maxInputSamples: liveSampleBudget },
      )
      this.measurementQueue.recordStage('dense-fusion', getPerformanceTimestamp() - denseStartedAt)
      const fusion = this.denseRealityReconstructionService.getDiagnostics()
      this.measurementStabilityService.recordFusion(fusion.createdThisTick ?? 0, fusion.fusedThisTick ?? 0)
    }

    const renderStartedAt = getPerformanceTimestamp()
    this.spatialCoverageRenderService.updatePersistentSurfaceMesh(
      persistentSurfaceResult.persistentSurfaceMesh,
    )
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
    this.measurementQueue.recordStage('render-preparation', getPerformanceTimestamp() - renderStartedAt)
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
      quality: this.qualityPolicy.snapshot(),
      measurement: this.measurementStabilityService.getDiagnostics(),
      measurementQueue: this.measurementQueue.getDiagnostics(),
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
    this.realityRgbKeyframeService.reset()
    this.appearanceKeyframeService.reset()
    this.qualityPolicy.reset()
    this.measurementStabilityService.reset()
    this.retainedMeasurementService.reset()
    this.measurementQueue.reset()
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
    this.realityRgbKeyframeService.reset()
    this.appearanceKeyframeService.reset()
    this.qualityPolicy.reset()
    this.measurementStabilityService.reset()
    this.measurementQueue.reset()
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

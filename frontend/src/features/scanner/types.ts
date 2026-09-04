export type ScannerCheckStatus = 'checking' | 'complete' | 'error'

export type ScanSessionStatus =
  | 'ready'
  | 'starting'
  | 'scanning'
  | 'finishing'
  | 'cancelling'
  | 'finished'
  | 'error'

export type ScannerReferenceSpaceType = 'local-floor' | 'local'

export type DomOverlayStatus = 'unknown' | 'active' | 'unavailable'

export type XRPresentationStatus = 'unknown' | 'ready' | 'failed'

export type ReferenceSpaceStatus =
  | 'idle'
  | 'requesting'
  | 'local-floor'
  | 'local'
  | 'failed'

export type XRTrackingStatus = 'waiting' | 'active'

export type DepthSensingStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'gpu-selected'
  | 'unavailable'
  | 'error'

export type DepthDataType =
  | 'float32'
  | 'luminance-alpha'
  | 'unsigned-short'
  | 'unknown'

export type DepthUsage = 'cpu-optimized' | 'gpu-optimized'

export type DepthSampleLabel = 'center' | 'upper' | 'lower' | 'left' | 'right'

export type SpatialPreviewStatus = 'idle' | 'ready' | 'failed'

export type SpatialGeometrySource = 'depth' | 'view' | 'unavailable'

export interface ScannerCapabilities {
  webxr: boolean
  immersiveAr: boolean
}

export interface WebXRCheckState {
  status: ScannerCheckStatus
  capabilities: ScannerCapabilities | null
}

export interface ViewerPosition {
  x: number
  y: number
  z: number
}

export interface ViewerDirection {
  x: number
  y: number
  z: number
}

export interface DepthSample {
  label: DepthSampleLabel
  distanceMeters: number | null
}

export interface XRDepthException {
  name: string
  message: string
}

export interface XRDepthSessionDiagnostics {
  usage: DepthUsage | null
  dataFormat: DepthDataType
  active: boolean | null
  usageError: XRDepthException | null
  dataFormatError: XRDepthException | null
  activeError: XRDepthException | null
}

export type DepthAcquisitionStatus =
  | 'not-attempted'
  | 'available'
  | 'null'
  | 'threw'
  | 'unsupported'

export interface XRDepthAcquisitionDiagnostics {
  status: DepthAcquisitionStatus
  error: XRDepthException | null
}

export interface XRDepthSampleError {
  label: DepthSampleLabel
  error: XRDepthException
}

export interface DepthFrameObservation {
  sampleCount: number
  requestedSampleCount: number
  rejectedSampleCount: number
  normalizedX: Float32Array
  normalizedY: Float32Array
  distancesMeters: Float32Array
  depthProjectionMatrix: Float32Array | null
  depthTransformMatrix: Float32Array | null
  viewProjectionMatrix: Float32Array | null
  viewTransformMatrix: Float32Array | null
}

/** A fixed-layout, current-frame world-point grid used by live reconstruction and debug visualization. */
export interface DenseDepthFrameObservation {
  columns: number
  rows: number
  attemptedSampleCount: number
  validSampleCount: number
  rejectedSampleCount: number
  valid: Uint8Array
  normalizedX: Float32Array
  normalizedY: Float32Array
  distancesMeters: Float32Array
  depthProjectionMatrix: Float32Array | null
  depthTransformMatrix: Float32Array | null
  viewProjectionMatrix: Float32Array | null
  viewTransformMatrix: Float32Array | null
}

export interface XRDepthDebug {
  status: DepthSensingStatus
  dataType: DepthDataType
  width: number | null
  height: number | null
  validFrameCount: number
  samples: DepthSample[]
  rawValueToMeters: number | null
  session: XRDepthSessionDiagnostics
  acquisition: XRDepthAcquisitionDiagnostics
  metadataError: XRDepthException | null
  rawValueToMetersError: XRDepthException | null
  sampleError: XRDepthSampleError | null
  samplingError: XRDepthException | null
  gridSampleError: XRDepthException | null
  geometryError: XRDepthException | null
  error: string | null
}

export interface SpatialPoint {
  x: number
  y: number
  z: number
}

export interface SpatialPointObservation {
  normalizedX: number
  normalizedY: number
  depthMeters: number
  point: SpatialPoint
}

/** Dense points retain grid slots so neighboring samples can form triangles. */
export interface DenseSpatialPointFrame {
  columns: number
  rows: number
  valid: Uint8Array
  normalizedX: Float32Array
  normalizedY: Float32Array
  distancesMeters: Float32Array
  points: Float32Array
  attemptedSampleCount: number
  validPointCount: number
  rejectedPointCount: number
}

export type CoverageLookupKind = 'exact' | 'neighbor' | 'miss'

export interface CoverageLookupResult {
  state: CoverageCellState | null
  kind: CoverageLookupKind
}

export interface CoverageVisualConfidenceResult {
  confidence: number
  directState: CoverageCellState | null
  directMatch: boolean
  kind: CoverageLookupKind
  compatibleNeighborCount: number
  normalRejectedCount: number
  pointToPlaneRejectedCount: number
}

export type DenseSpatialSampleLabel =
  | 'top-center'
  | 'center'
  | 'bottom-center'
  | 'left-center'
  | 'right-center'

export interface DenseSpatialDiagnosticSample {
  label: DenseSpatialSampleLabel
  depthMeters: number | null
  point: SpatialPoint | null
}

export interface SpatialBounds {
  min: SpatialPoint
  max: SpatialPoint
}

export interface SpatialPointDebug {
  previewStatus: SpatialPreviewStatus
  projectionSource: SpatialGeometrySource
  transformSource: SpatialGeometrySource
  currentValidPoints: number
  rejectedDepthSamples: number
  bounds: SpatialBounds | null
  centerPoint: SpatialPoint | null
  error: string | null
}

export type CoverageCellState = 'observed' | 'partial' | 'captured'

export type CoverageGuidance =
  | 'move-slowly-across-unscanned-areas'
  | 'continue-scanning-from-another-angle'
  | 'area-captured-move-to-a-new-surface'

export interface CoverageCell {
  key: string
  coverageRegionKey: string
  center: SpatialPoint
  representativePosition: SpatialPoint
  representativeNormal: SpatialPoint | null
  observationCount: number
  state: CoverageCellState
  firstObservedAt: number
  lastObservedAt: number
  lastAcceptedCameraPosition: ViewerPosition
  lastAcceptedCameraDirection: ViewerDirection | null
}

export type CoverageRenderStatus = 'idle' | 'ready' | 'failed'

export interface SpatialCoverageRenderDebug {
  status: CoverageRenderStatus
  visualPatchSizeMeters: number
  candidateOpacity: number
  observedOpacity: number
  partialOpacity: number
  capturedOpacity: number
  persistentVertexCount: number
  persistentRenderUpdateCount: number
  persistentSurfelCount: number
  candidateVertexCount: number
  candidateRenderUpdateCount: number
  candidateSurfaceVisible: boolean
  denseVertexCount: number
  denseRenderUpdateCount: number
  rawCurrentDepthVisible: boolean
  persistentSurfelDebugVisible: boolean
  rgbDepthDebugVisible: boolean
  rgbDepthVertexCount: number
  rgbDepthRenderUpdateCount: number
  gpuBufferUploadDurationMs: number
}

export interface DenseMaskStabilizationOptions {
  cacheEnabled: boolean
  smoothingEnabled: boolean
  holeFillEnabled: boolean
  hysteresisEnabled: boolean
}

export interface SpatialCoverageDenseDebug {
  columns: number
  rows: number
  attemptedSampleCount: number
  validSampleCount: number
  generatedTriangleCount: number
  rejectedInvalidSampleCount: number
  rejectedDepthDiscontinuityCount: number
  unknownMaskSampleCount: number
  observedMaskSampleCount: number
  partialMaskSampleCount: number
  capturedMaskSampleCount: number
  exactCoverageLookupHitCount: number
  neighborCoverageLookupHitCount: number
  coverageLookupMissCount: number
  coverageLookupHitPercentage: number | null
  depthMinMeters: number | null
  depthMaxMeters: number | null
  worldBounds: SpatialBounds | null
  representativeSamples: DenseSpatialDiagnosticSample[]
  updateCount: number
  updateRateHz: number
  processingDurationMs: number
  totalProcessingDurationMs: number
  depthReconstructionDurationMs: number
  coverageLookupDurationMs: number
  visualCacheDurationMs: number
  holeFillDurationMs: number
  smoothingDurationMs: number
  triangleGenerationDurationMs: number
  stabilizationOptions: DenseMaskStabilizationOptions
  visualCacheEntryCount: number
  visualCacheMaxEntries: number
  visualCacheHitCount: number
  visualCacheRefreshCount: number
  visualCacheExpirationCount: number
  visualHoleFillSampleCount: number
  visualHoleFillRejectCount: number
  smoothedVisualFragmentCount: number
  directPersistentMatchCount: number
  neighborhoodConfidenceSampleCount: number
  visualConfidenceUnknownCount: number
  averageCompatibleNeighborCount: number
  averageVisualConfidence: number
  capturedDirectMatchCount: number
  neighborhoodHighConfidenceSampleCount: number
  visualConfidenceNormalRejectCount: number
  visualConfidencePointToPlaneRejectCount: number
  visualConfidenceDurationMs: number
  visualConfidenceSupportRadiusMeters: number
  visualConfidenceCandidateLimit: number
}

export type LiveSurfaceGeometryState = 'new' | 'confirmed' | 'stable'

export interface PersistentLiveSurfaceDebug {
  incomingMeasuredPointCount: number
  surfelCount: number
  surfelCapacity: number
  spatialBucketCount: number
  newSurfelCount: number
  fusedSurfelCount: number
  fusionRate: number | null
  fusionRejectCount: number
  distanceRejectedCount: number
  pointToPlaneRejectedCount: number
  normalRejectedCount: number
  averageCandidatesPerPoint: number
  weakSurfelCount: number
  confirmedSurfelCount: number
  stableSurfelCount: number
  removedSurfelCount: number
  candidateCheckCount: number
  renderedSurfelCount: number
  matchedCurrentPointCount: number
  unmatchedCandidateSampleCount: number
  candidateVisualSurfelCount: number
  candidateSuppressedByCapturedMatchCount: number
  candidateSuppressedByIncompleteMatchCount: number
  capturedPersistentSurfelCount: number
  partialPersistentSurfelCount: number
  observedPersistentSurfelCount: number
  unknownPersistentSurfelCount: number
  updateCount: number
  updateRateHz: number
  processingDurationMs: number
  footprintRadiusMeters: number
  maxFusionDistanceMeters: number
  maxPointToPlaneMeters: number
  minNormalDot: number
  capacityReached: boolean
}

export interface SpatialCoverageDebug {
  cellSizeMeters: number
  mappingColumns: number
  mappingRows: number
  mappingUpdateRateHz: number
  mappingPhase: number
  mappingUpdateCount: number
  mappingProcessingDurationMs: number
  incomingMeasuredSampleCount: number
  matchedExistingSurfaceSampleCount: number
  newSurfaceCreationCount: number
  fusionRatio: number | null
  averageCompatibleCandidatesPerSample: number
  samplesRejectedByDistance: number
  samplesRejectedByPointToPlane: number
  samplesRejectedByNormalCompatibility: number
  existingSurfaceMatchRate: number | null
  newSurfaceCreationRate: number | null
  distinctObservationAcceptanceRate: number | null
  normalCompatibilityPassRate: number | null
  averageNormalAngleDegrees: number | null
  surfelsWithOneObservation: number
  surfelsWithTwoObservations: number
  surfelsWithThreeOrMoreObservations: number
  coverageRegionSupportMeters: number
  coverageRegionCount: number
  coverageRegionObservedCount: number
  coverageRegionPartialCount: number
  coverageRegionCapturedCount: number
  distinctObservationAcceptedCount: number
  distinctTranslationQualifiedCount: number
  distinctRotationQualifiedCount: number
  duplicateViewpointRejectedCount: number
  samplesWithNoCompatiblePersistentSurface: number
  matchedObservedSurfelCount: number
  matchedPartialSurfelCount: number
  matchedCapturedSurfelCount: number
  observationsRejectedInsufficientCameraMovement: number
  observationsRejectedInsufficientViewChange: number
  observationsRejectedFusion: number
  observationsRejectedNormalSimilarity: number
  observationsRejectedPointToPlane: number
  observedToPartialTransitionsPerSecond: number
  partialToCapturedTransitionsPerSecond: number
  totalUniqueCells: number
  observedCells: number
  partialCells: number
  capturedCells: number
  currentValidSamples: number
  currentCapturedSamples: number
  currentViewCoverage: number | null
  acceptedObservationCount: number
  newCellsCreatedCount: number
  observedToPartialTransitionCount: number
  partialToCapturedTransitionCount: number
  rejectedDuplicateObservationCount: number
  capacityRejectedSampleCount: number
  maxCells: number
  capacityReached: boolean
  rejectedInvalidNormalCount: number
  rejectedDepthDiscontinuityCount: number
  statisticsInvariantError: string | null
  guidance: CoverageGuidance
  render: SpatialCoverageRenderDebug
  dense: SpatialCoverageDenseDebug
  liveSurface: PersistentLiveSurfaceDebug
}

export interface LivePerformanceWindowDebug {
  label: '0-10 s' | '10-20 s' | '20-40 s' | '40+ s'
  frameCount: number
  averageFrameTimeMs: number
  fps: number
  slowFramePercentage: number
}

export interface LivePerformanceDebug {
  frameCount: number
  fps: number
  averageFrameIntervalMs: number
  averageFrameTimeMs: number
  p95FrameTimeMs: number
  /** Approximate missed-60Hz-slot count: processing time over 33 ms. */
  droppedFrameCount: number
  frameOver16Point7MsCount: number
  frameOver22MsCount: number
  frameOver33MsCount: number
  frameOver16Point7MsPercentage: number
  frameOver22MsPercentage: number
  frameOver33MsPercentage: number
  depthAcquisitionMs: number
  candidateGenerationMs: number
  normalFilteringMs: number
  fusionUpdateMs: number
  coverageUpdateMs: number
  candidateVisualizationMs: number
  persistentRenderPreparationMs: number
  webGlDrawMs: number
  reactDiagnosticsMs: number
  activeSurfelCount: number
  renderedSurfelCount: number
  candidatePatchCount: number
  coverageCellCount: number
  xrSessionElapsedMs: number
  performanceWindows: readonly LivePerformanceWindowDebug[]
}

export type RawCameraCapabilityState =
  | 'not-requested'
  | 'requested'
  | 'not-granted'
  | 'available'
  | 'active'
  | 'error'

export type RawCameraCapabilityReason =
  | 'api-missing'
  | 'feature-not-enabled'
  | 'binding-unavailable'
  | 'view-camera-null'
  | 'camera-texture-null'
  | 'copy-failed'
  | 'unknown'

export type RawCameraCopyStatus = 'idle' | 'available' | 'failed' | 'skipped'

export type RawCameraOrientation =
  | 'upright'
  | 'vertical-flipped'
  | 'horizontal-mirrored'
  | 'rotated-180'
  | 'unknown'

export interface RawCameraPreview {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8ClampedArray
}

/** Normalized source crop in the WebGL camera-texture coordinate space. */
export interface RawCameraSourceUvRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface RawCameraCopyMapping {
  readonly sourceCameraWidth: number
  readonly sourceCameraHeight: number
  readonly copyWidth: number
  readonly copyHeight: number
  readonly sourceUvRect: RawCameraSourceUvRect
  readonly orientation: RawCameraOrientation
}

/** The latest application-owned copy, valid only during the active session. */
export interface RawCameraCopyFrame {
  readonly sequence: number
  readonly timestamp: number
  readonly mapping: RawCameraCopyMapping
  /** RGBA readback rows are in WebGL bottom-left origin order. */
  readonly pixels: Uint8Array
}

export interface RawCameraDebug {
  status: RawCameraCapabilityState
  reason: RawCameraCapabilityReason | null
  requested: boolean
  enabledFeature: boolean | null
  bindingAvailable: boolean
  viewCameraAvailable: boolean
  sourceWidth: number | null
  sourceHeight: number | null
  textureAvailable: boolean
  copyStatus: RawCameraCopyStatus
  copyWidth: number | null
  copyHeight: number | null
  successfulCopyCount: number
  failedCopyCount: number
  skippedCopyCount: number
  lastCopyTimestamp: number | null
  acquisitionMs: number
  shaderCopyMs: number
  readPixelsMs: number
  totalProbeMs: number
  readbackP95Ms: number
  frameSignature: number | null
  changedSincePreviousCopy: boolean | null
  orientation: RawCameraOrientation
  mapping: RawCameraCopyMapping | null
  preview: RawCameraPreview | null
}

export interface RgbDepthValidationSample {
  readonly world: SpatialPoint
  readonly cameraU: number
  readonly cameraV: number
  readonly copyX: number
  readonly copyY: number
  readonly red: number
  readonly green: number
  readonly blue: number
}

export type RgbDepthPairingStatus = 'same-frame' | 'stale' | 'rejected' | 'unavailable'

export interface RgbDepthRegistrationDebug {
  status: 'idle' | 'active' | 'unavailable'
  pairingStatus: RgbDepthPairingStatus
  samplesAttempted: number
  samplesProjected: number
  samplesOutsideCamera: number
  invalidProjections: number
  samplesSuccessfullyColored: number
  staleCameraRejects: number
  cameraBufferMisses: number
  successPercentage: number
  registrationMs: number
  projectionMs: number
  rgbLookupMs: number
  cameraCopySequence: number | null
  cameraCopyTimestamp: number | null
  depthProcessingTimestamp: number | null
  validationSamples: readonly RgbDepthValidationSample[]
}

export interface RealityRgbColor {
  readonly r: number
  readonly g: number
  readonly b: number
}

export type RealityReconstructionStatus = 'available' | 'unavailable' | 'empty'

export type RealityCaptureStatus = 'starting' | 'active' | 'unavailable' | 'error'

export interface RealityColorFusionDebug {
  status: 'idle' | 'active' | 'unavailable' | 'empty'
  captureStatus: RealityCaptureStatus
  captureEnabled: boolean
  eligibleRgbdTickCount: number
  colorSamplesAttempted: number
  colorSamplesFused: number
  colorSamplesFusedTotal: number
  unmatchedSurfelSamples: number
  colorRejects: number
  coloredSurfelCount: number
  totalSurfelCount: number
  colorCoveragePercentage: number
  averageColorObservations: number
  averageColorConfidence: number
  colorFusionMs: number
  cameraCapturesUsed: number
  lastCameraSequence: number | null
  lastRealityCaptureTimestamp: number | null
  lastColorTimestamp: number | null
}

export interface DenseCoverageMesh {
  revision: number
  vertexData: Float32Array
  vertexCount: number
}

export interface FinalizedCoverageCell {
  readonly position: SpatialPoint
  readonly normal: SpatialPoint | null
  readonly coverageState: CoverageCellState
  readonly observationCount: number
}

/** Plain, measured geometry copied from the active fused live-surface service. */
export interface FinalizedSurfaceSurfel {
  readonly position: SpatialPoint
  readonly normal: SpatialPoint
  readonly observationWeight: number
  readonly geometryObservationCount: number
  readonly geometryConfidence: number
  readonly coverageState: CoverageCellState
}

/** Reality-only geometry copy with the live surfel identity preserved. */
export interface FinalizedRealityGeometrySurfel {
  readonly id: number
  readonly position: SpatialPoint
  readonly normal: SpatialPoint
  readonly radius: number
  readonly geometryConfidence: number
}

export interface FinalizedSpatialScanStatistics {
  readonly uniqueCells: number
  readonly observedCells: number
  readonly partialCells: number
  readonly capturedCells: number
}

export interface FinalizedSpatialScan {
  readonly id: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly referenceSpaceType: ScannerReferenceSpaceType
  readonly coverage: readonly FinalizedCoverageCell[]
  readonly fusedSurface: readonly FinalizedSurfaceSurfel[]
  readonly statistics: FinalizedSpatialScanStatistics
}

export interface FinalizedRealitySurfel {
  readonly id: number
  readonly position: SpatialPoint
  readonly normal: SpatialPoint
  readonly radius: number
  readonly colorRgb: RealityRgbColor | null
  readonly colorSpace: 'srgb'
  readonly geometryConfidence: number
  readonly colorConfidence: number
  readonly colorObservationCount: number
}

export interface RealityCaptureSummary {
  readonly totalSurfels: number
  readonly coloredSurfels: number
  readonly colorCoveragePercentage: number
  readonly averageColorObservations: number
  readonly cameraCapturesUsed: number
  readonly averageColorConfidence: number
  readonly averageNearestNeighborSpacingMeters: number | null
  readonly medianNearestNeighborSpacingMeters: number | null
  readonly p90NearestNeighborSpacingMeters: number | null
  readonly approximateUncoveredGapMeters: number | null
  readonly estimatedSmallGapRegionCount: number
  readonly estimatedLargeUnsupportedGapCount: number
  readonly surfelCapacity: number
  readonly capacityUtilizationPercentage: number
  readonly capacityReached: boolean
}

export interface FinalizedRealityReconstruction {
  readonly scanId: string
  readonly referenceSpaceType: ScannerReferenceSpaceType
  readonly status: RealityReconstructionStatus
  readonly surfels: readonly FinalizedRealitySurfel[]
  readonly bounds: SpatialBounds | null
  readonly captureSummary: RealityCaptureSummary
}

export interface DenseRealityFusionDebug {
  readonly status: 'idle' | 'active' | 'empty'
  readonly inputSampleCount: number
  readonly inputColorSampleCount: number
  readonly createdSampleCount: number
  readonly fusedSampleCount: number
  readonly rejectedSampleCount: number
  readonly activeSampleCount: number
  readonly stableSampleCount: number
  readonly capacity: number
  readonly capacityUtilizationPercentage: number
  readonly capacityReached: boolean
  readonly fusionMs: number
  readonly lastCaptureTimestamp: number | null
  readonly lastCameraSequence: number | null
  readonly cameraCapturesUsed: number
}

export interface FinalizedDenseRealityReconstruction {
  readonly scanId: string
  readonly referenceSpaceType: ScannerReferenceSpaceType
  readonly status: RealityReconstructionStatus
  readonly surfels: readonly FinalizedRealitySurfel[]
  readonly bounds: SpatialBounds | null
  readonly captureSummary: RealityCaptureSummary
  readonly fusionDiagnostics: DenseRealityFusionDebug
}

export interface FinalizedScannerCapture {
  readonly spatialScan: FinalizedSpatialScan
  readonly realityReconstruction: FinalizedRealityReconstruction
  readonly denseRealityReconstruction: FinalizedDenseRealityReconstruction | null
}

export interface ViewerPoseDebug {
  sessionActive: boolean
  glContextStatus: XRPresentationStatus
  baseLayerStatus: XRPresentationStatus
  referenceSpaceStatus: ReferenceSpaceStatus
  xrFrameCount: number
  poseSampleCount: number
  trackingStatus: XRTrackingStatus
  trackingActive: boolean
  position: ViewerPosition | null
  referenceSpaceType: ScannerReferenceSpaceType | null
  lastSampledAt: number | null
  depth: XRDepthDebug
  spatial: SpatialPointDebug
  coverage: SpatialCoverageDebug
  performance: LivePerformanceDebug
  rawCamera: RawCameraDebug
  rgbDepth: RgbDepthRegistrationDebug
  realityColor: RealityColorFusionDebug
  denseReality: DenseRealityFusionDebug
}

export interface ScannerSessionState {
  status: ScanSessionStatus
  debug: ViewerPoseDebug
  domOverlayStatus: DomOverlayStatus
  error: string | null
  finalizedScan: FinalizedSpatialScan | null
  realityReconstruction: FinalizedRealityReconstruction | null
  denseRealityReconstruction: FinalizedDenseRealityReconstruction | null
}

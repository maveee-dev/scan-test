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
}

export interface ScannerSessionState {
  status: ScanSessionStatus
  debug: ViewerPoseDebug
  domOverlayStatus: DomOverlayStatus
  error: string | null
  finalizedScan: FinalizedSpatialScan | null
}

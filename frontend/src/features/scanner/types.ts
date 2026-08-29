export type ScannerCheckStatus = 'checking' | 'complete' | 'error'

export type ScanSessionStatus = 'ready' | 'starting' | 'scanning' | 'stopping' | 'error'

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
  error: string | null
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
}

export interface ScannerSessionState {
  status: ScanSessionStatus
  debug: ViewerPoseDebug
  domOverlayStatus: DomOverlayStatus
  error: string | null
}

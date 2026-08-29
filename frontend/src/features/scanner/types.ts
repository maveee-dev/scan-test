export type ScannerCheckStatus = 'checking' | 'complete' | 'error'

export type ScanSessionStatus = 'ready' | 'starting' | 'scanning' | 'stopping' | 'error'

export type ScannerReferenceSpaceType = 'local-floor' | 'local'

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

export interface ViewerPoseDebug {
  trackingActive: boolean
  sampledFrameCount: number
  position: ViewerPosition | null
  referenceSpaceType: ScannerReferenceSpaceType | null
  lastSampledAt: number | null
}

export interface ScannerSessionState {
  status: ScanSessionStatus
  debug: ViewerPoseDebug
  error: string | null
}

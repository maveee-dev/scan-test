import type { ScannerCapabilities } from '../types'

const unsupportedCapabilities: ScannerCapabilities = {
  webxr: false,
  immersiveAr: false,
}

/**
 * Reads the browser's WebXR capabilities without creating an XR session.
 * Session creation belongs to a later scanner milestone.
 */
export async function detectWebXRSupport(): Promise<ScannerCapabilities> {
  const xrSystem = typeof navigator === 'undefined' ? undefined : navigator.xr

  if (!xrSystem) {
    return unsupportedCapabilities
  }

  try {
    const immersiveAr = await xrSystem.isSessionSupported('immersive-ar')

    return {
      webxr: true,
      immersiveAr,
    }
  } catch {
    return {
      webxr: true,
      immersiveAr: false,
    }
  }
}

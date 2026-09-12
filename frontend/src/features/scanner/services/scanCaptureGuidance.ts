import type { ScannerSessionState } from '../types'

export interface ScanCaptureGuidance {
  readonly reinforcedPercentage: number | null
  readonly needsAnotherPass: number
  readonly canBuild: boolean
  readonly message: string
  readonly warnings: readonly string[]
}

/** Quality of observed surfaces only. No room boundary or unseen-area estimate. */
export function getScanCaptureGuidance(debug: ScannerSessionState['debug']): ScanCaptureGuidance {
  const { coverage, measurement, depth, trackingStatus, realityColor } = debug
  const total = coverage.totalUniqueCells
  const captured = Math.max(0, Math.min(total, coverage.capturedCells))
  const reinforcedPercentage = total > 0 ? Math.floor(captured / total * 100) : null
  const needsAnotherPass = Math.max(0, total - captured)
  const healthy = measurement?.scanSpatialValidity === 'healthy'
  const canBuild = healthy && (measurement?.accepted ?? 0) > 0 && total > 0
  const warnings: string[] = []
  if (!healthy) warnings.push('Tracking must recover before the model can be built.')
  if (total === 0) warnings.push('No measured surface coverage has been recorded.')
  if (needsAnotherPass > 0) warnings.push(`${needsAnotherPass.toLocaleString()} observed regions still need another angle.`)
  if ((measurement?.accepted ?? 0) < 24) warnings.push('Only a small set of usable depth frames has been recorded.')
  if (realityColor.captureStatus !== 'active') warnings.push('Camera color is unavailable. The model may have missing appearance.')
  if (coverage.capacityReached || debug.denseReality.capacityUtilizationPercentage > 95) {
    warnings.push('The measured map is nearly full. Additional areas may be missing.')
  }
  let message: string
  if (measurement?.scanSpatialValidity === 'invalid') message = 'Tracking shifted. Restart the scan to keep the room aligned.'
  else if (trackingStatus !== 'active' || !healthy) message = 'Hold still and return to the last scanned area so tracking can recover.'
  else if (depth.status !== 'active' || coverage.currentValidSamples === 0) message = 'No usable depth here. Aim at a nearby surface and move slowly.'
  else if (measurement?.guidance === 'move-slower') message = 'Slow down and pause briefly for sharper captures.'
  else if (measurement?.guidance === 'scan-again') message = 'Revisit this area slowly; recent measurements were not usable.'
  else if (coverage.currentViewCoverage !== null && coverage.currentViewCoverage >= 80) message = 'This view is reinforced. Move to an unmarked area or around an object.'
  else if (total > 0) message = 'Move sideways slowly. Revisit orange and blue areas from another angle.'
  else message = 'Sweep slowly across the wall, then the floor and ceiling.'
  return { reinforcedPercentage, needsAnotherPass, canBuild, message, warnings }
}

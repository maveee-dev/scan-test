import type { DenseSpatialPointFrame, SpatialPoint } from '../types'
import type { RealityMeasurementPacket } from './realityMeasurementStabilityService'
import type { RgbDepthRegistrationResult } from './rgbDepthRegistrationService'

export const RETAINED_REALITY_CONFIG = Object.freeze({
  maxFrames: 96,
  minimumTimeSpacingMs: 140,
  minimumTranslationMeters: 0.025,
  minimumRotationDegrees: 2,
  maxConsolidatedSamplesPerFrame: 1600,
  consolidationCellMeters: 0.018,
})

export interface RetainedRealityMeasurementFrame {
  readonly sequence: number
  readonly timestamp: number
  readonly samplingPhase: number
  readonly trackingQuality: number
  readonly cameraPosition: Readonly<SpatialPoint>
  readonly cameraOrientation: Readonly<{ x: number; y: number; z: number; w: number }>
  readonly denseFrame: DenseSpatialPointFrame
  readonly normals: Float32Array
  readonly normalValid: Uint8Array
  readonly colorSourceIndices: Int32Array
  readonly srgbColors: Uint8Array
}

export interface RetainedRealityMeasurementDiagnostics {
  readonly framesConsidered: number
  readonly framesRetained: number
  readonly duplicateFramesRejected: number
  readonly temporalCompactions: number
  readonly samplesRetained: number
  readonly memoryBytes: number
  readonly viewpointBinCount: number
  readonly earliestTimestamp: number | null
  readonly latestTimestamp: number | null
}

export interface RetainedRealityMeasurementSnapshot {
  readonly frames: readonly RetainedRealityMeasurementFrame[]
  readonly diagnostics: RetainedRealityMeasurementDiagnostics
}

function quaternionDifferenceDegrees(
  left: RetainedRealityMeasurementFrame['cameraOrientation'],
  right: RetainedRealityMeasurementFrame['cameraOrientation'],
): number {
  const dot = Math.abs(left.x * right.x + left.y * right.y + left.z * right.z + left.w * right.w)
  return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI
}

function frameMemoryBytes(frame: RetainedRealityMeasurementFrame): number {
  const dense = frame.denseFrame
  return dense.valid.byteLength + dense.normalizedX.byteLength + dense.normalizedY.byteLength +
    dense.distancesMeters.byteLength + dense.points.byteLength + frame.normals.byteLength +
    frame.normalValid.byteLength + frame.colorSourceIndices.byteLength + frame.srgbColors.byteLength
}

/**
 * Retains application-owned accepted measurement packets for deterministic
 * post-scan replay. Retention is O(1) on an accepted XR tick: packet arrays are
 * already immutable copies, and consolidation is deliberately deferred to the
 * reconstruction worker.
 */
export class RetainedRealityMeasurementService {
  private frames: RetainedRealityMeasurementFrame[] = []
  private framesConsidered = 0
  private duplicateFramesRejected = 0
  private temporalCompactions = 0

  public consider(
    packet: RealityMeasurementPacket,
    trackingQuality: number,
    registration: RgbDepthRegistrationResult | null,
  ): boolean {
    this.framesConsidered += 1
    const candidate: RetainedRealityMeasurementFrame = Object.freeze({
      sequence: packet.sequence,
      timestamp: packet.timestamp,
      samplingPhase: packet.samplingPhase,
      trackingQuality,
      cameraPosition: packet.pose.position,
      cameraOrientation: packet.pose.orientation,
      denseFrame: packet.denseFrame,
      normals: packet.normals,
      normalValid: packet.normalValid,
      colorSourceIndices: registration?.sourceSampleIndices ?? new Int32Array(0),
      srgbColors: registration?.srgbColors ?? new Uint8Array(0),
    })
    const previous = this.frames.at(-1)
    if (previous) {
      const elapsed = candidate.timestamp - previous.timestamp
      const translation = Math.hypot(
        candidate.cameraPosition.x - previous.cameraPosition.x,
        candidate.cameraPosition.y - previous.cameraPosition.y,
        candidate.cameraPosition.z - previous.cameraPosition.z,
      )
      const rotation = quaternionDifferenceDegrees(candidate.cameraOrientation, previous.cameraOrientation)
      if (elapsed < RETAINED_REALITY_CONFIG.minimumTimeSpacingMs &&
        translation < RETAINED_REALITY_CONFIG.minimumTranslationMeters &&
        rotation < RETAINED_REALITY_CONFIG.minimumRotationDegrees &&
        candidate.samplingPhase === previous.samplingPhase) {
        this.duplicateFramesRejected += 1
        return false
      }
    }

    if (this.frames.length >= RETAINED_REALITY_CONFIG.maxFrames) {
      // Preserve the complete walk rather than retaining only its beginning.
      // Deterministic temporal decimation keeps endpoints and every second
      // interior frame before accepting newer viewpoints.
      this.frames = this.frames.filter((_frame, index) => index === 0 || index === this.frames.length - 1 || index % 2 === 0)
      this.temporalCompactions += 1
    }
    this.frames.push(candidate)
    return true
  }

  public createSnapshot(): RetainedRealityMeasurementSnapshot {
    const bins = new Set<string>()
    let samplesRetained = 0
    let memoryBytes = 0
    for (const frame of this.frames) {
      samplesRetained += frame.denseFrame.validPointCount
      memoryBytes += frameMemoryBytes(frame)
      bins.add(`${Math.floor(frame.cameraPosition.x / .25)}:${Math.floor(frame.cameraPosition.y / .25)}:${Math.floor(frame.cameraPosition.z / .25)}`)
    }
    return Object.freeze({
      frames: Object.freeze([...this.frames]),
      diagnostics: Object.freeze({
        framesConsidered: this.framesConsidered,
        framesRetained: this.frames.length,
        duplicateFramesRejected: this.duplicateFramesRejected,
        temporalCompactions: this.temporalCompactions,
        samplesRetained,
        memoryBytes,
        viewpointBinCount: bins.size,
        earliestTimestamp: this.frames[0]?.timestamp ?? null,
        latestTimestamp: this.frames.at(-1)?.timestamp ?? null,
      }),
    })
  }

  public reset(): void {
    this.frames = []
    this.framesConsidered = 0
    this.duplicateFramesRejected = 0
    this.temporalCompactions = 0
  }
}

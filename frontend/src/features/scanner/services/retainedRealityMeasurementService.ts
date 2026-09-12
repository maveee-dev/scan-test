import type { DenseSpatialPointFrame, SpatialPoint } from '../types'
import type { RealityMeasurementPacket } from './realityMeasurementStabilityService'
import type { RgbDepthRegistrationResult } from './rgbDepthRegistrationService'

export const RETAINED_REALITY_CONFIG = Object.freeze({
  maxFrames: 96,
  minimumTimeSpacingMs: 140,
  minimumTranslationMeters: 0.025,
  minimumRotationDegrees: 2,
  // Preserve a complete base 80 x 45 depth frame during post-scan replay.
  // This does not increase live XR work or the 96-frame retention limit.
  maxConsolidatedSamplesPerFrame: 3600,
  consolidationCellMeters: 0.018,
})

// This is deliberately only a bounded retention-selection proxy. It does not
// participate in depth sampling, canonical cells, or reconstruction matching.
const COVERAGE_PROXY_CELL_METERS = .25
const MAX_COVERAGE_PROXY_CELLS_PER_FRAME = 96
const MAX_COVERAGE_PROXY_PROBES_PER_FRAME = 384

export interface RetainedRealityMeasurementFrame {
  readonly sequence: number
  /** Stable accepted pose epoch; frames from a different epoch are never replayed together. */
  readonly trackingEpoch: number
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
  /** Bounded spatial signature used only to preserve useful retained views. */
  readonly coverageProxyKeys: readonly string[]
  readonly viewpointProxyKey: string
}

export interface RetainedRealityFrameCoverageSummary {
  readonly sequence: number
  readonly timestamp: number
  readonly proxyCellCount: number
  readonly uniqueProxyCellContribution: number
  readonly colorEvidenceCount: number
}

export interface RetainedRealityMeasurementDiagnostics {
  readonly framesConsidered: number
  readonly framesRetained: number
  readonly duplicateFramesRejected: number
  readonly redundancyRejects: number
  readonly temporalCompactions: number
  readonly compactionReplacements: number
  readonly coverageLostDueToRemoval: number
  readonly samplesRetained: number
  readonly retainedColorEvidenceCount: number
  readonly retainedColorFrameCount: number
  readonly memoryBytes: number
  readonly viewpointBinCount: number
  readonly earliestTimestamp: number | null
  readonly latestTimestamp: number | null
  readonly retainedFrameCoverage: readonly RetainedRealityFrameCoverageSummary[]
  readonly trackingEpochCount: number
  readonly trackingEpochIds: readonly number[]
  readonly incompatibleTrackingStateRejects: number
  readonly incompatibleTrackingStateSpan: boolean
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

function createCoverageProxyKeys(frame: DenseSpatialPointFrame): readonly string[] {
  const keys = new Set<string>()
  const stride = Math.max(1, Math.floor(frame.valid.length / MAX_COVERAGE_PROXY_PROBES_PER_FRAME))
  for (let sourceIndex = 0; sourceIndex < frame.valid.length && keys.size < MAX_COVERAGE_PROXY_CELLS_PER_FRAME; sourceIndex += stride) {
    if (!frame.valid[sourceIndex]) continue
    const offset = sourceIndex * 3
    const x = frame.points[offset], y = frame.points[offset + 1], z = frame.points[offset + 2]
    if (![x, y, z].every(Number.isFinite)) continue
    keys.add(`${Math.floor(x / COVERAGE_PROXY_CELL_METERS)}:${Math.floor(y / COVERAGE_PROXY_CELL_METERS)}:${Math.floor(z / COVERAGE_PROXY_CELL_METERS)}`)
  }
  return Object.freeze([...keys].sort())
}

function viewpointProxyKey(frame: Pick<RetainedRealityMeasurementFrame, 'cameraPosition' | 'cameraOrientation'>): string {
  const position = frame.cameraPosition, orientation = frame.cameraOrientation
  return `${Math.floor(position.x / .25)}:${Math.floor(position.y / .25)}:${Math.floor(position.z / .25)}:${Math.round(orientation.x * 8)}:${Math.round(orientation.y * 8)}:${Math.round(orientation.z * 8)}:${Math.round(orientation.w * 8)}`
}

function coverageContribution(frame: RetainedRealityMeasurementFrame, frames: readonly RetainedRealityMeasurementFrame[]): number {
  const shared = new Set<string>()
  for (const other of frames) if (other !== frame) for (const key of other.coverageProxyKeys) shared.add(key)
  let contribution = 0
  for (const key of frame.coverageProxyKeys) if (!shared.has(key)) contribution += 1
  return contribution
}

/**
 * Computes every retained frame's unique proxy-cell contribution in one pass.
 * A proxy key contributes to exactly one frame iff it occurs once in the
 * retained set, which is equivalent to coverageContribution(frame, frames)
 * while avoiding a complete scan of the other frames for every frame.
 */
function coverageContributions(frames: readonly RetainedRealityMeasurementFrame[]): readonly number[] {
  const occurrences = new Map<string, number>()
  for (const frame of frames) {
    for (const key of frame.coverageProxyKeys) {
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
    }
  }

  return frames.map((frame) => {
    let contribution = 0
    for (const key of frame.coverageProxyKeys) {
      if (occurrences.get(key) === 1) contribution += 1
    }
    return contribution
  })
}

/**
 * Retains application-owned accepted measurement packets for deterministic
 * post-scan replay. Packet arrays are already immutable copies, and the
 * selection proxy has fixed probe/frame bounds; consolidation is deliberately
 * deferred to the reconstruction worker.
 */
export class RetainedRealityMeasurementService {
  private frames: RetainedRealityMeasurementFrame[] = []
  private framesConsidered = 0
  private duplicateFramesRejected = 0
  private redundancyRejects = 0
  private temporalCompactions = 0
  private compactionReplacements = 0
  private coverageLostDueToRemoval = 0
  private acceptedTrackingEpoch: number | null = null
  private incompatibleTrackingStateRejects = 0

  public consider(
    packet: RealityMeasurementPacket,
    trackingQuality: number,
    registration: RgbDepthRegistrationResult | null,
    trackingEpoch = 0,
  ): boolean {
    this.framesConsidered += 1
    if (this.acceptedTrackingEpoch !== null && trackingEpoch !== this.acceptedTrackingEpoch) {
      this.incompatibleTrackingStateRejects += 1
      return false
    }
    this.acceptedTrackingEpoch ??= trackingEpoch
    const candidate: RetainedRealityMeasurementFrame = Object.freeze({
      sequence: packet.sequence,
      trackingEpoch,
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
      coverageProxyKeys: createCoverageProxyKeys(packet.denseFrame),
      viewpointProxyKey: '',
    })
    const withViewpoint = Object.freeze({ ...candidate, viewpointProxyKey: viewpointProxyKey(candidate) })
    const candidateCoverageGain = coverageContribution(withViewpoint, this.frames)
    const redundant = this.frames.some((previous) => {
      const elapsed = Math.abs(withViewpoint.timestamp - previous.timestamp)
      const translation = Math.hypot(
        withViewpoint.cameraPosition.x - previous.cameraPosition.x,
        withViewpoint.cameraPosition.y - previous.cameraPosition.y,
        withViewpoint.cameraPosition.z - previous.cameraPosition.z,
      )
      const rotation = quaternionDifferenceDegrees(withViewpoint.cameraOrientation, previous.cameraOrientation)
      return elapsed < RETAINED_REALITY_CONFIG.minimumTimeSpacingMs &&
        translation < RETAINED_REALITY_CONFIG.minimumTranslationMeters &&
        rotation < RETAINED_REALITY_CONFIG.minimumRotationDegrees &&
        withViewpoint.samplingPhase === previous.samplingPhase &&
        candidateCoverageGain === 0
    })
    if (redundant) {
      this.duplicateFramesRejected += 1
      this.redundancyRejects += 1
      return false
    }

    if (this.frames.length >= RETAINED_REALITY_CONFIG.maxFrames) {
      // Keep the opening and newest endpoint. Among bounded interior history,
      // replace the least useful view using coverage first, then viewpoint and
      // temporal diversity. This is at most 96 x 96 proxy keys per accepted
      // tick and never touches reconstruction resolution or capacity.
      let replacementIndex = 1
      let replacementScore = Infinity
      for (let index = 1; index < this.frames.length - 1; index += 1) {
        const frame = this.frames[index]
        const contribution = coverageContribution(frame, this.frames)
        const sameViewpoints = this.frames.filter((other) => other !== frame && other.viewpointProxyKey === frame.viewpointProxyKey).length
        const previousTime = this.frames[index - 1]?.timestamp ?? frame.timestamp
        const nextTime = this.frames[index + 1]?.timestamp ?? frame.timestamp
        const temporalSpan = Math.min(frame.timestamp - previousTime, nextTime - frame.timestamp)
        // Lower is less valuable. Earlier entries break otherwise equal ties.
        const score = contribution * 100 + (sameViewpoints === 0 ? 20 : 0) + Math.min(20, Math.max(0, temporalSpan) / 100)
        if (score < replacementScore) { replacementScore = score; replacementIndex = index }
      }
      const removed = this.frames[replacementIndex]
      const candidateHasNovelViewpoint = !this.frames.some((frame) => frame.viewpointProxyKey === withViewpoint.viewpointProxyKey)
      const previousTimestamp = this.frames.at(-1)?.timestamp ?? withViewpoint.timestamp
      const candidateTemporalDiversity = Math.min(20, Math.max(0, withViewpoint.timestamp - previousTimestamp) / 100)
      const candidateScore = candidateCoverageGain * 100 + (candidateHasNovelViewpoint ? 20 : 0) + candidateTemporalDiversity
      if (candidateScore < replacementScore) {
        this.duplicateFramesRejected += 1
        this.redundancyRejects += 1
        return false
      }
      this.coverageLostDueToRemoval += coverageContribution(removed, [...this.frames, withViewpoint])
      this.frames.splice(replacementIndex, 1)
      this.temporalCompactions += 1
      this.compactionReplacements += 1
    }
    this.frames.push(withViewpoint)
    return true
  }

  public createSnapshot(): RetainedRealityMeasurementSnapshot {
    const bins = new Set<string>()
    let samplesRetained = 0
    let memoryBytes = 0
    let retainedColorEvidenceCount = 0
    let retainedColorFrameCount = 0
    const uniqueProxyCellContributions = coverageContributions(this.frames)
    for (const frame of this.frames) {
      samplesRetained += frame.denseFrame.validPointCount
      memoryBytes += frameMemoryBytes(frame)
      retainedColorEvidenceCount += frame.colorSourceIndices.length
      if (frame.colorSourceIndices.length > 0) retainedColorFrameCount += 1
      bins.add(frame.viewpointProxyKey)
    }
    const retainedFrameCoverage = Object.freeze(this.frames.map((frame, index) => Object.freeze({
      sequence: frame.sequence,
      timestamp: frame.timestamp,
      proxyCellCount: frame.coverageProxyKeys.length,
      uniqueProxyCellContribution: uniqueProxyCellContributions[index] ?? 0,
      colorEvidenceCount: frame.colorSourceIndices.length,
    })))
    const trackingEpochIds = [...new Set(this.frames.map((frame) => frame.trackingEpoch))].sort((left, right) => left - right)
    return Object.freeze({
      frames: Object.freeze([...this.frames]),
      diagnostics: Object.freeze({
        framesConsidered: this.framesConsidered,
        framesRetained: this.frames.length,
        duplicateFramesRejected: this.duplicateFramesRejected,
        redundancyRejects: this.redundancyRejects,
        temporalCompactions: this.temporalCompactions,
        compactionReplacements: this.compactionReplacements,
        coverageLostDueToRemoval: this.coverageLostDueToRemoval,
        samplesRetained,
        retainedColorEvidenceCount,
        retainedColorFrameCount,
        memoryBytes,
        viewpointBinCount: bins.size,
        earliestTimestamp: this.frames[0]?.timestamp ?? null,
        latestTimestamp: this.frames.at(-1)?.timestamp ?? null,
        retainedFrameCoverage,
        trackingEpochCount: trackingEpochIds.length,
        trackingEpochIds: Object.freeze(trackingEpochIds),
        incompatibleTrackingStateRejects: this.incompatibleTrackingStateRejects,
        incompatibleTrackingStateSpan: trackingEpochIds.length > 1,
      }),
    })
  }

  public reset(): void {
    this.frames = []
    this.framesConsidered = 0
    this.duplicateFramesRejected = 0
    this.redundancyRejects = 0
    this.temporalCompactions = 0
    this.compactionReplacements = 0
    this.coverageLostDueToRemoval = 0
    this.acceptedTrackingEpoch = null
    this.incompatibleTrackingStateRejects = 0
  }
}

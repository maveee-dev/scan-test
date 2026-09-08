import type {
  FinalizedRealityRgbKeyframes,
  RealityRgbKeyframe,
  RealityRgbKeyframeDiagnostics,
  ViewerDirection,
  ViewerPosition,
} from '../types'
import { XRRawCameraService } from './xrRawCameraService'

const MAX_KEYFRAMES = 12
const MIN_CAPTURE_INTERVAL_MS = 850
const MIN_TRANSLATION_METERS = 0.18
const MIN_ROTATION_DEGREES = 14
const APPEARANCE_CAPACITY = 8
const APPEARANCE_MIN_CAPTURE_INTERVAL_MS = 1500
const APPEARANCE_MAX_TRANSLATION_SPEED = 1.2
const APPEARANCE_MAX_ROTATION_SPEED = 55

export type RealityRgbKeyframeCandidateOutcome =
  | 'captured'
  | 'pressure-skipped'
  | 'motion-skipped'
  | 'duplicate-view-skipped'
  | 'camera-unavailable'
  | 'other'

export interface RealityRgbKeyframeCaptureResult {
  readonly outcome: RealityRgbKeyframeCandidateOutcome
  readonly captured: boolean
  readonly retainedCount: number
}

function now(): number { return typeof performance === 'undefined' ? Date.now() : performance.now() }

function directionDot(first: ViewerDirection, second: ViewerDirection): number {
  const firstLength = Math.hypot(first.x, first.y, first.z), secondLength = Math.hypot(second.x, second.y, second.z)
  return firstLength > 0 && secondLength > 0 ? Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y + first.z * second.z) / (firstLength * secondLength))) : 1
}

function copyTopLeftRgb(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = ((height - 1 - y) * width + x) * 4, target = (y * width + x) * 3
    rgb[target] = rgba[source]
    rgb[target + 1] = rgba[source + 1]
    rgb[target + 2] = rgba[source + 2]
  }
  return rgb
}

function createDiagnostics(): RealityRgbKeyframeDiagnostics {
  return {
    status: 'empty', retainedCount: 0, capacity: MAX_KEYFRAMES, width: null, height: null,
    bytesPerKeyframe: 0, totalBytes: 0, captureCount: 0, rejectedDuplicateCount: 0,
    skippedForPressureCount: 0, candidateCount: 0,
    candidateOutcomes: { captured: 0, pressureSkipped: 0, motionSkipped: 0, duplicateViewSkipped: 0, cameraUnavailable: 0, other: 0 },
    captureMs: 0, allocationMs: 0, shaderCopyMs: 0, readbackMs: 0,
  }
}

function outcomeKey(outcome: RealityRgbKeyframeCandidateOutcome): keyof RealityRgbKeyframeDiagnostics['candidateOutcomes'] {
  switch (outcome) {
    case 'pressure-skipped': return 'pressureSkipped'
    case 'motion-skipped': return 'motionSkipped'
    case 'duplicate-view-skipped': return 'duplicateViewSkipped'
    case 'camera-unavailable': return 'cameraUnavailable'
    default: return outcome
  }
}

/** Owns a small, local-only set of camera RGB/pose snapshots for post-scan visual masks. */
export class RealityRgbKeyframeService {
  private readonly appearance: boolean
  public constructor(appearance = false) { this.appearance = appearance; this.diagnostics = { ...createDiagnostics(), capacity: appearance ? APPEARANCE_CAPACITY : MAX_KEYFRAMES } }
  private keyframes: RealityRgbKeyframe[] = []
  private diagnostics = createDiagnostics()
  private lastPosition: ViewerPosition | null = null
  private lastDirection: ViewerDirection | null = null
  private lastTimestamp = Number.NEGATIVE_INFINITY

  private result(outcome: RealityRgbKeyframeCandidateOutcome): RealityRgbKeyframeCaptureResult {
    const key = outcomeKey(outcome)
    const candidateOutcomes = { ...this.diagnostics.candidateOutcomes, [key]: this.diagnostics.candidateOutcomes[key] + 1 }
    this.diagnostics = {
      ...this.diagnostics,
      candidateCount: this.diagnostics.candidateCount + 1,
      candidateOutcomes,
      captureCount: outcome === 'captured' ? this.diagnostics.captureCount + 1 : this.diagnostics.captureCount,
      rejectedDuplicateCount: outcome === 'duplicate-view-skipped' ? this.diagnostics.rejectedDuplicateCount + 1 : this.diagnostics.rejectedDuplicateCount,
      skippedForPressureCount: outcome === 'pressure-skipped' ? this.diagnostics.skippedForPressureCount + 1 : this.diagnostics.skippedForPressureCount,
    }
    return { outcome, captured: outcome === 'captured', retainedCount: this.keyframes.length }
  }

  private cameraAvailable(rawCamera: XRRawCameraService): boolean {
    // Keep lightweight test doubles and older callers compatible. A real raw
    // camera service always exposes isAvailable(), so an absent method is not
    // treated as an unavailable camera.
    return typeof rawCamera.isAvailable !== 'function' || rawCamera.isAvailable()
  }

  /**
   * Evaluates and records a single appearance candidate. The result is useful
   * to XR scheduling code that wants to expose the exact reason a candidate
   * was not copied without duplicating the pose/novelty rules here.
   */
  public considerCapture(
    frame: XRFrame,
    view: XRView,
    timestamp: number,
    position: ViewerPosition | null,
    direction: ViewerDirection | null,
    validDepthCount: number,
    rawCamera: XRRawCameraService,
    motion?: { translationMetersPerSecond: number; rotationDegreesPerSecond: number },
  ): RealityRgbKeyframeCaptureResult {
    const capacity = this.appearance ? APPEARANCE_CAPACITY : MAX_KEYFRAMES
    if (this.appearance && !this.cameraAvailable(rawCamera)) return this.result('camera-unavailable')
    // Pose velocity is only a blur proxy; no image processing in XR frames.
    if (this.appearance && motion && (motion.translationMetersPerSecond > APPEARANCE_MAX_TRANSLATION_SPEED || motion.rotationDegreesPerSecond > APPEARANCE_MAX_ROTATION_SPEED)) {
      return this.result('motion-skipped')
    }
    if (!position || !direction || validDepthCount <= 0 || (!this.appearance && this.keyframes.length >= capacity)) return this.result('other')
    const translation = this.lastPosition ? Math.hypot(position.x - this.lastPosition.x, position.y - this.lastPosition.y, position.z - this.lastPosition.z) : Infinity
    const rotation = this.lastDirection ? Math.acos(directionDot(direction, this.lastDirection)) * 180 / Math.PI : Infinity
    const duplicate = this.appearance && this.keyframes.some((keyframe) => {
      const m = keyframe.cameraTransform
      return Math.hypot(position.x - m[12], position.y - m[13], position.z - m[14]) < MIN_TRANSLATION_METERS && directionDot(direction, { x: -m[8], y: -m[9], z: -m[10] }) > 0.97
    })
    const interval = this.appearance ? APPEARANCE_MIN_CAPTURE_INTERVAL_MS : MIN_CAPTURE_INTERVAL_MS
    if (duplicate || (translation < MIN_TRANSLATION_METERS && rotation < MIN_ROTATION_DEGREES)) return this.result('duplicate-view-skipped')
    if (timestamp - this.lastTimestamp < interval) return this.result('other')
    let replaceIndex = -1
    if (this.keyframes.length >= capacity) {
      const novelty = (a: RealityRgbKeyframe, b: RealityRgbKeyframe) => Math.hypot(a.cameraTransform[12] - b.cameraTransform[12], a.cameraTransform[13] - b.cameraTransform[13], a.cameraTransform[14] - b.cameraTransform[14]) + (1 - directionDot({ x: -a.cameraTransform[8], y: -a.cameraTransform[9], z: -a.cameraTransform[10] }, { x: -b.cameraTransform[8], y: -b.cameraTransform[9], z: -b.cameraTransform[10] }))
      let redundancy = Infinity
      this.keyframes.forEach((a, i) => this.keyframes.forEach((b, j) => {
        if (i >= j) return
        const score = novelty(a, b)
        if (score < redundancy) { redundancy = score; replaceIndex = a.qualityScore < b.qualityScore ? i : j }
      }))
      const newNovelty = Math.min(...this.keyframes.map((a) => Math.hypot(position.x - a.cameraTransform[12], position.y - a.cameraTransform[13], position.z - a.cameraTransform[14]) + (1 - directionDot(direction, { x: -a.cameraTransform[8], y: -a.cameraTransform[9], z: -a.cameraTransform[10] }))))
      if (newNovelty <= redundancy || validDepthCount / 3600 < .4) return this.result('duplicate-view-skipped')
    }
    const started = now()
    const copy = rawCamera.copyKeyframe(frame, view, timestamp, this.appearance ? 640 : 320)
    if (!copy) return this.result(this.cameraAvailable(rawCamera) ? 'other' : 'camera-unavailable')
    const qualityScore = Math.min(1, validDepthCount / 3600) * 0.55 + Math.min(1, translation / 0.45) * 0.25 + Math.min(1, rotation / 35) * 0.20
    const keyframe: RealityRgbKeyframe = {
      id: copy.sequence,
      timestamp,
      width: copy.mapping.copyWidth,
      height: copy.mapping.copyHeight,
      rgb: copyTopLeftRgb(copy.pixels, copy.mapping.copyWidth, copy.mapping.copyHeight),
      cameraTransform: new Float32Array(view.transform.matrix),
      inverseCameraTransform: new Float32Array(view.transform.inverse.matrix),
      projectionMatrix: new Float32Array(view.projectionMatrix),
      mapping: { ...copy.mapping, sourceUvRect: { ...copy.mapping.sourceUvRect } },
      qualityScore,
      translationDeltaMeters: Number.isFinite(translation) ? translation : 0,
      rotationDeltaDegrees: Number.isFinite(rotation) ? rotation : 0,
      validDepthFraction: Math.min(1, validDepthCount / 3600),
    }
    if (replaceIndex >= 0) this.keyframes[replaceIndex] = keyframe
    else this.keyframes.push(keyframe)
    this.lastPosition = { ...position }
    this.lastDirection = { ...direction }
    this.lastTimestamp = timestamp
    const bytes = keyframe.rgb.byteLength + keyframe.cameraTransform.byteLength + keyframe.inverseCameraTransform.byteLength + keyframe.projectionMatrix.byteLength
    const outcome = this.result('captured')
    this.diagnostics = {
      ...this.diagnostics,
      status: 'active', retainedCount: this.keyframes.length, capacity,
      width: keyframe.width, height: keyframe.height, bytesPerKeyframe: bytes,
      totalBytes: this.keyframes.reduce((sum, item) => sum + item.rgb.byteLength + item.cameraTransform.byteLength + item.inverseCameraTransform.byteLength + item.projectionMatrix.byteLength, 0),
      captureMs: Math.max(0, now() - started),
      allocationMs: copy.allocationMs ?? 0,
      shaderCopyMs: copy.shaderCopyMs ?? 0,
      readbackMs: copy.readbackMs ?? 0,
    }
    return { ...outcome, retainedCount: this.keyframes.length }
  }

  public recordPressureSkip(): RealityRgbKeyframeCaptureResult | null {
    if (!this.appearance) return null
    return this.result('pressure-skipped')
  }

  /** Records an outcome when the scheduler decides before calling considerCapture. */
  public recordCandidateOutcome(outcome: Exclude<RealityRgbKeyframeCandidateOutcome, 'captured'>): RealityRgbKeyframeCaptureResult {
    return this.result(outcome)
  }

  public getDiagnostics(): RealityRgbKeyframeDiagnostics { return { ...this.diagnostics, candidateOutcomes: { ...this.diagnostics.candidateOutcomes } } }

  public createSnapshot(scanId: string, cameraAvailable: boolean): FinalizedRealityRgbKeyframes {
    const status = !cameraAvailable ? 'unavailable' : this.keyframes.length > 0 ? 'available' : 'empty'
    return {
      scanId,
      status,
      keyframes: this.keyframes.map((keyframe) => ({ ...keyframe, rgb: new Uint8Array(keyframe.rgb), cameraTransform: new Float32Array(keyframe.cameraTransform), inverseCameraTransform: new Float32Array(keyframe.inverseCameraTransform), projectionMatrix: new Float32Array(keyframe.projectionMatrix), mapping: { ...keyframe.mapping, sourceUvRect: { ...keyframe.mapping.sourceUvRect } } })),
      diagnostics: { ...this.diagnostics, status: status === 'available' ? 'active' : status },
    }
  }

  public reset(): void {
    this.keyframes = []
    this.diagnostics = { ...createDiagnostics(), capacity: this.appearance ? APPEARANCE_CAPACITY : MAX_KEYFRAMES }
    this.lastPosition = null
    this.lastDirection = null
    this.lastTimestamp = Number.NEGATIVE_INFINITY
  }

  public dispose(): void { this.reset() }
}

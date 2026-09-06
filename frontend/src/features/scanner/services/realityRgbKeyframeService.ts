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
  return { status: 'empty', retainedCount: 0, capacity: MAX_KEYFRAMES, width: null, height: null, bytesPerKeyframe: 0, totalBytes: 0, captureCount: 0, rejectedDuplicateCount: 0, captureMs: 0 }
}

/** Owns a small, local-only set of camera RGB/pose snapshots for post-scan visual masks. */
export class RealityRgbKeyframeService {
  private readonly appearance: boolean
  public constructor(appearance = false) { this.appearance = appearance; this.diagnostics = { ...createDiagnostics(), capacity: appearance ? 8 : MAX_KEYFRAMES } }
  private keyframes: RealityRgbKeyframe[] = []
  private diagnostics = createDiagnostics()
  private lastPosition: ViewerPosition | null = null
  private lastDirection: ViewerDirection | null = null
  private lastTimestamp = Number.NEGATIVE_INFINITY

  public considerCapture(
    frame: XRFrame,
    view: XRView,
    timestamp: number,
    position: ViewerPosition | null,
    direction: ViewerDirection | null,
    validDepthCount: number,
    rawCamera: XRRawCameraService,
    motion?: { translationMetersPerSecond: number; rotationDegreesPerSecond: number },
  ): void {
    const capacity = this.appearance ? 8 : MAX_KEYFRAMES
    // Pose velocity is only a blur proxy; no image processing in XR frames.
    if (this.appearance && motion && (motion.translationMetersPerSecond > 1.2 || motion.rotationDegreesPerSecond > 55)) return
    if (!position || !direction || validDepthCount <= 0 || (!this.appearance && this.keyframes.length >= capacity)) return
    const translation = this.lastPosition ? Math.hypot(position.x - this.lastPosition.x, position.y - this.lastPosition.y, position.z - this.lastPosition.z) : Infinity
    const rotation = this.lastDirection ? Math.acos(directionDot(direction, this.lastDirection)) * 180 / Math.PI : Infinity
    const duplicate = this.appearance && this.keyframes.some((keyframe) => {
      const m = keyframe.cameraTransform
      return Math.hypot(position.x - m[12], position.y - m[13], position.z - m[14]) < 0.18 && directionDot(direction, { x: -m[8], y: -m[9], z: -m[10] }) > 0.97
    })
    if (duplicate || timestamp - this.lastTimestamp < (this.appearance ? 1500 : MIN_CAPTURE_INTERVAL_MS) || (translation < MIN_TRANSLATION_METERS && rotation < MIN_ROTATION_DEGREES)) {
      this.diagnostics = { ...this.diagnostics, rejectedDuplicateCount: this.diagnostics.rejectedDuplicateCount + 1 }
      return
    }
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
      if (newNovelty <= redundancy || validDepthCount / 3600 < .4) return
    }
    const started = now()
    const copy = rawCamera.copyKeyframe(frame, view, timestamp, this.appearance ? 640 : 320)
    if (!copy) return
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
    this.diagnostics = {
      status: 'active', retainedCount: this.keyframes.length, capacity,
      width: keyframe.width, height: keyframe.height, bytesPerKeyframe: bytes,
      totalBytes: this.keyframes.reduce((sum, item) => sum + item.rgb.byteLength + item.cameraTransform.byteLength + item.inverseCameraTransform.byteLength + item.projectionMatrix.byteLength, 0),
      captureCount: this.diagnostics.captureCount + 1,
      rejectedDuplicateCount: this.diagnostics.rejectedDuplicateCount,
      captureMs: Math.max(0, now() - started),
    }
  }

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
    this.diagnostics = { ...createDiagnostics(), capacity: this.appearance ? 8 : MAX_KEYFRAMES }
    this.lastPosition = null
    this.lastDirection = null
    this.lastTimestamp = Number.NEGATIVE_INFINITY
  }

  public dispose(): void { this.reset() }
}

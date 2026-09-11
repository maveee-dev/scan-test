import type { FinalizedRealityRgbKeyframes, RealityRgbKeyframe } from '../types'
import type { RealityMeasurementPacket } from './realityMeasurementStabilityService'

export const M812_SYNCHRONIZED_RGBD_CAPACITY = 8

export type M812SynchronizationBasis = 'same-xr-frame-view-aligned'
export type M812SensorExposureSynchronization = 'not-guaranteed-by-webxr'
export type M812DepthCurrentness = 'current-xr-frame-requested-user-agent-should-provide'

export interface M812SynchronizedDepthOwnership {
  readonly columns: number
  readonly rows: number
  readonly sampleIndexing: 'row-major-grid-index'
  readonly valid: Uint8Array
  readonly normalizedX: Float32Array
  readonly normalizedY: Float32Array
  readonly distancesMeters: Float32Array
  /** Exact world/reference-space points reconstructed for this accepted packet. */
  readonly worldPoints: Float32Array
  readonly depthBufferWidth: number | null
  readonly depthBufferHeight: number | null
  readonly rawValueToMeters: number | null
  readonly depthProjectionMatrix: Float32Array | null
  readonly depthTransformMatrix: Float32Array | null
}

export interface M812SynchronizedRgbdKeyframe {
  /** Application identity; WebXR does not expose a native sensor-frame id. */
  readonly captureIdentity: string
  readonly frameSequence: number
  readonly xrFrameTimestamp: number
  readonly synchronizationBasis: M812SynchronizationBasis
  readonly sameXrFrameInvocation: true
  readonly depthCurrentness: M812DepthCurrentness
  readonly sensorExposureSynchronization: M812SensorExposureSynchronization
  readonly rgbKeyframe: RealityRgbKeyframe
  readonly depth: M812SynchronizedDepthOwnership
}

export interface M812SynchronizedRgbdMemoryDiagnostics {
  readonly rgbBytes: number
  readonly depthBytes: number
  readonly validityBytes: number
  readonly worldPointBytes: number
  readonly poseProjectionBytes: number
  /** Depth ownership is the row-major array index, so no parallel index buffer is retained. */
  readonly ownershipIndexBytes: 0
  readonly rawPackedLowerBoundBytes: number
  readonly transferBytes: number
  /** Extra typed-array bytes allocated while finalizing the contract snapshot. */
  readonly temporarySnapshotBytes: number
  readonly knownAdditionalOverhead: 'js-object-arraybuffer-browser-and-gpu-overhead-not-included'
}

export interface M812SynchronizedRgbdDiagnostics {
  readonly captureAttempts: number
  readonly capturesRetained: number
  readonly replacements: number
  readonly contractMismatchRejects: number
  readonly unpairedRgbKeyframes: number
  readonly lastRetentionMs: number
  readonly maximumRetentionMs: number
  readonly memory: M812SynchronizedRgbdMemoryDiagnostics
}

export interface M812SynchronizedRgbdSnapshot {
  readonly scanId: string
  readonly status: 'available' | 'unavailable' | 'empty'
  readonly capacity: number
  readonly keyframes: readonly M812SynchronizedRgbdKeyframe[]
  readonly diagnostics: M812SynchronizedRgbdDiagnostics
}

export interface M812SameXrFrameCaptureInput {
  /** The actual XRFrame used by both depth acquisition and the camera copy call. */
  readonly frame: XRFrame
  /** The exact XRView used for depth alignment, pose/projection, and raw camera ownership. */
  readonly view: XRView
  readonly packet: RealityMeasurementPacket
  readonly keyframe: RealityRgbKeyframe
  readonly replacedKeyframeId: number | null
}

export interface M812SameXrFrameCaptureResult {
  readonly accepted: boolean
  readonly reason: 'retained' | 'timestamp-mismatch' | 'view-metadata-mismatch' | 'invalid-depth-layout'
}

interface RetainedDepthRecord {
  readonly captureIdentity: string
  readonly frameSequence: number
  readonly xrFrameTimestamp: number
  readonly depth: M812SynchronizedDepthOwnership
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function copyMatrix(matrix: ArrayLike<number> | null): Float32Array | null {
  return matrix && matrix.length === 16 ? new Float32Array(matrix) : null
}

function matricesEqual(first: ArrayLike<number>, second: ArrayLike<number>): boolean {
  if (first.length !== 16 || second.length !== 16) return false
  // The packet/keyframe own Float32 copies while WebXR may expose a wider
  // DOMPoint matrix view. Permit only float-copy rounding, not pose drift.
  for (let index = 0; index < 16; index += 1) if (Math.abs(first[index] - second[index]) > 1e-6) return false
  return true
}

function copyKeyframe(keyframe: RealityRgbKeyframe): RealityRgbKeyframe {
  return {
    ...keyframe,
    rgb: new Uint8Array(keyframe.rgb),
    cameraTransform: new Float32Array(keyframe.cameraTransform),
    inverseCameraTransform: new Float32Array(keyframe.inverseCameraTransform),
    projectionMatrix: new Float32Array(keyframe.projectionMatrix),
    mapping: { ...keyframe.mapping, sourceUvRect: { ...keyframe.mapping.sourceUvRect } },
  }
}

function copyDepth(depth: M812SynchronizedDepthOwnership): M812SynchronizedDepthOwnership {
  return {
    ...depth,
    valid: new Uint8Array(depth.valid),
    normalizedX: new Float32Array(depth.normalizedX),
    normalizedY: new Float32Array(depth.normalizedY),
    distancesMeters: new Float32Array(depth.distancesMeters),
    worldPoints: new Float32Array(depth.worldPoints),
    depthProjectionMatrix: copyMatrix(depth.depthProjectionMatrix),
    depthTransformMatrix: copyMatrix(depth.depthTransformMatrix),
  }
}

function depthTypedBytes(depth: M812SynchronizedDepthOwnership): number {
  return depth.normalizedX.byteLength + depth.normalizedY.byteLength + depth.distancesMeters.byteLength
}

function poseProjectionBytes(keyframe: M812SynchronizedRgbdKeyframe): number {
  return keyframe.rgbKeyframe.cameraTransform.byteLength + keyframe.rgbKeyframe.inverseCameraTransform.byteLength +
    keyframe.rgbKeyframe.projectionMatrix.byteLength + (keyframe.depth.depthProjectionMatrix?.byteLength ?? 0) +
    (keyframe.depth.depthTransformMatrix?.byteLength ?? 0)
}

function memoryDiagnostics(keyframes: readonly M812SynchronizedRgbdKeyframe[]): M812SynchronizedRgbdMemoryDiagnostics {
  const rgbBytes = keyframes.reduce((sum, capture) => sum + capture.rgbKeyframe.rgb.byteLength, 0)
  const depthBytes = keyframes.reduce((sum, capture) => sum + depthTypedBytes(capture.depth), 0)
  const validityBytes = keyframes.reduce((sum, capture) => sum + capture.depth.valid.byteLength, 0)
  const worldPointBytes = keyframes.reduce((sum, capture) => sum + capture.depth.worldPoints.byteLength, 0)
  const metadataBytes = keyframes.reduce((sum, capture) => sum + poseProjectionBytes(capture), 0)
  const rawPackedLowerBoundBytes = rgbBytes + depthBytes + validityBytes + worldPointBytes + metadataBytes
  return {
    rgbBytes,
    depthBytes,
    validityBytes,
    worldPointBytes,
    poseProjectionBytes: metadataBytes,
    ownershipIndexBytes: 0,
    rawPackedLowerBoundBytes,
    transferBytes: rawPackedLowerBoundBytes,
    temporarySnapshotBytes: depthBytes + validityBytes + worldPointBytes + keyframes.reduce((sum, capture) => sum +
      (capture.depth.depthProjectionMatrix?.byteLength ?? 0) + (capture.depth.depthTransformMatrix?.byteLength ?? 0), 0),
    knownAdditionalOverhead: 'js-object-arraybuffer-browser-and-gpu-overhead-not-included',
  }
}

/**
 * Retains only depth ownership for an already-selected appearance keyframe.
 * It performs no additional camera readback and is called only when the existing
 * bounded appearance policy accepted a keyframe in the same XR callback.
 */
export class M812SynchronizedRgbdCaptureService {
  private records = new Map<number, RetainedDepthRecord>()
  private captureAttempts = 0
  private replacements = 0
  private contractMismatchRejects = 0
  private lastRetentionMs = 0
  private maximumRetentionMs = 0

  public retainSameXrFrameCapture(input: M812SameXrFrameCaptureInput): M812SameXrFrameCaptureResult {
    const startedAt = now()
    this.captureAttempts += 1
    const { frame, view, packet, keyframe } = input
    // `frame` is intentionally part of the boundary: the only production call
    // passes the XRFrame that produced packet depth into the camera-copy call.
    if (!frame || keyframe.timestamp !== packet.timestamp) return this.reject('timestamp-mismatch')
    if (!matricesEqual(packet.viewTransform, view.transform.matrix) ||
      !matricesEqual(packet.inverseViewTransform, view.transform.inverse.matrix) ||
      !matricesEqual(packet.projectionMatrix, view.projectionMatrix) ||
      !matricesEqual(keyframe.cameraTransform, packet.viewTransform) ||
      !matricesEqual(keyframe.inverseCameraTransform, packet.inverseViewTransform) ||
      !matricesEqual(keyframe.projectionMatrix, packet.projectionMatrix)) return this.reject('view-metadata-mismatch')
    const depth = packet.denseFrame
    const sampleCount = depth.columns * depth.rows
    if (sampleCount <= 0 || depth.valid.length !== sampleCount || depth.normalizedX.length !== sampleCount ||
      depth.normalizedY.length !== sampleCount || depth.distancesMeters.length !== sampleCount ||
      depth.points.length !== sampleCount * 3) return this.reject('invalid-depth-layout')

    if (input.replacedKeyframeId !== null && input.replacedKeyframeId !== keyframe.id) {
      if (this.records.delete(input.replacedKeyframeId)) this.replacements += 1
    }
    const ownedDepth: M812SynchronizedDepthOwnership = {
      columns: depth.columns,
      rows: depth.rows,
      sampleIndexing: 'row-major-grid-index',
      valid: new Uint8Array(depth.valid),
      normalizedX: new Float32Array(depth.normalizedX),
      normalizedY: new Float32Array(depth.normalizedY),
      distancesMeters: new Float32Array(depth.distancesMeters),
      worldPoints: new Float32Array(depth.points),
      depthBufferWidth: packet.depthWidth,
      depthBufferHeight: packet.depthHeight,
      rawValueToMeters: packet.depthScale,
      depthProjectionMatrix: copyMatrix(packet.depthProjectionMatrix),
      depthTransformMatrix: copyMatrix(packet.depthTransformMatrix),
    }
    this.records.set(keyframe.id, {
      captureIdentity: `xr-frame-${packet.sequence}:rgb-keyframe-${keyframe.id}`,
      frameSequence: packet.sequence,
      xrFrameTimestamp: packet.timestamp,
      depth: ownedDepth,
    })
    // The appearance service is bounded to eight. This guard prevents an
    // accidental future caller from turning this proof store into scan history.
    while (this.records.size > M812_SYNCHRONIZED_RGBD_CAPACITY) {
      const oldest = this.records.keys().next().value as number | undefined
      if (oldest === undefined) break
      this.records.delete(oldest)
    }
    this.lastRetentionMs = Math.max(0, now() - startedAt)
    this.maximumRetentionMs = Math.max(this.maximumRetentionMs, this.lastRetentionMs)
    return { accepted: true, reason: 'retained' }
  }

  public createSnapshot(scanId: string, appearance: FinalizedRealityRgbKeyframes): M812SynchronizedRgbdSnapshot {
    const paired: M812SynchronizedRgbdKeyframe[] = []
    for (const rgbKeyframe of appearance.keyframes) {
      const record = this.records.get(rgbKeyframe.id)
      if (!record) continue
      paired.push({
        captureIdentity: record.captureIdentity,
        frameSequence: record.frameSequence,
        xrFrameTimestamp: record.xrFrameTimestamp,
        synchronizationBasis: 'same-xr-frame-view-aligned',
        sameXrFrameInvocation: true,
        depthCurrentness: 'current-xr-frame-requested-user-agent-should-provide',
        sensorExposureSynchronization: 'not-guaranteed-by-webxr',
        rgbKeyframe,
        depth: copyDepth(record.depth),
      })
    }
    const status = appearance.status === 'unavailable' ? 'unavailable' : paired.length > 0 ? 'available' : 'empty'
    return {
      scanId,
      status,
      capacity: M812_SYNCHRONIZED_RGBD_CAPACITY,
      keyframes: paired,
      diagnostics: {
        captureAttempts: this.captureAttempts,
        capturesRetained: paired.length,
        replacements: this.replacements,
        contractMismatchRejects: this.contractMismatchRejects,
        unpairedRgbKeyframes: appearance.keyframes.length - paired.length,
        lastRetentionMs: this.lastRetentionMs,
        maximumRetentionMs: this.maximumRetentionMs,
        memory: memoryDiagnostics(paired),
      },
    }
  }

  public reset(): void {
    this.records.clear()
    this.captureAttempts = 0
    this.replacements = 0
    this.contractMismatchRejects = 0
    this.lastRetentionMs = 0
    this.maximumRetentionMs = 0
  }

  public dispose(): void { this.reset() }

  private reject(reason: Exclude<M812SameXrFrameCaptureResult['reason'], 'retained'>): M812SameXrFrameCaptureResult {
    this.contractMismatchRejects += 1
    return { accepted: false, reason }
  }
}

/** Creates an independently transferable, bounded proof input. */
export function cloneM812SynchronizedRgbdSnapshot(
  snapshot: M812SynchronizedRgbdSnapshot,
  maximumKeyframes = 2,
): M812SynchronizedRgbdSnapshot {
  const keyframes = snapshot.keyframes.slice(0, Math.max(0, maximumKeyframes)).map((capture) => ({
    ...capture,
    rgbKeyframe: copyKeyframe(capture.rgbKeyframe),
    depth: copyDepth(capture.depth),
  }))
  return { ...snapshot, keyframes, diagnostics: { ...snapshot.diagnostics, memory: memoryDiagnostics(keyframes) } }
}

export function getM812SynchronizedRgbdTransferBuffers(snapshot: M812SynchronizedRgbdSnapshot): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const capture of snapshot.keyframes) {
    const arrays: readonly (ArrayBufferView | null)[] = [
      capture.rgbKeyframe.rgb,
      capture.rgbKeyframe.cameraTransform,
      capture.rgbKeyframe.inverseCameraTransform,
      capture.rgbKeyframe.projectionMatrix,
      capture.depth.valid,
      capture.depth.normalizedX,
      capture.depth.normalizedY,
      capture.depth.distancesMeters,
      capture.depth.worldPoints,
      capture.depth.depthProjectionMatrix,
      capture.depth.depthTransformMatrix,
    ]
    for (const array of arrays) if (array?.buffer instanceof ArrayBuffer) buffers.add(array.buffer)
  }
  return [...buffers]
}

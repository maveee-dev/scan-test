import type { FinalizedDenseRealityReconstruction, FinalizedRealityRgbKeyframes, ScannerReferenceSpaceType } from '../types'
import type { RetainedRealityMeasurementSnapshot } from './retainedRealityMeasurementService'

export const MAX_SCAN_REPLAY_BYTES = 128 * 1024 * 1024
const MAGIC = 'SSCAN001'
const MAX_METADATA_BYTES = 2 * 1024 * 1024
type PackedArray = Float32Array | Uint8Array | Int32Array
export interface ScanReplayCapture {
  readonly format: 'spatial-scan-replay'
  readonly version: 1
  readonly scanId: string
  readonly referenceSpaceType: ScannerReferenceSpaceType
  readonly build: string
  readonly measurements: RetainedRealityMeasurementSnapshot
  readonly appearance: FinalizedRealityRgbKeyframes | null
  readonly diagnostics: {
    readonly depthSource: FinalizedDenseRealityReconstruction['depthSource']
    readonly measurement: FinalizedDenseRealityReconstruction['measurementDiagnostics']
    readonly canonical: FinalizedDenseRealityReconstruction['canonicalFusionDiagnostics']
  }
}

/** Local binary download; typed arrays are copied by Blob, never JSON-expanded. */
export function encodeScanReplay(capture: ScanReplayCapture): Blob {
  const arrays: PackedArray[] = []
  let bytes = 0
  const json = JSON.stringify(capture, (_key, value: unknown) => {
    if (value instanceof Float32Array || value instanceof Uint8Array || value instanceof Int32Array) {
      bytes += value.byteLength
      if (bytes > MAX_SCAN_REPLAY_BYTES) throw new Error('Capture exceeds the local export size limit.')
      const index = arrays.push(value) - 1
      return { __scanBuffer: index, kind: value.constructor.name, length: value.length }
    }
    return value
  })
  const metadata = new TextEncoder().encode(json)
  if (metadata.byteLength > MAX_METADATA_BYTES || bytes + metadata.byteLength + 12 > MAX_SCAN_REPLAY_BYTES) throw new Error('Capture exceeds the local export size limit.')
  const header = new Uint8Array(12)
  header.set(new TextEncoder().encode(MAGIC)); new DataView(header.buffer).setUint32(8, metadata.byteLength, true)
  return new Blob([header, metadata, ...arrays.map(value => new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength))], { type: 'application/octet-stream' })
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const vector = (value: unknown): boolean => record(value) && finite(value.x) && finite(value.y) && finite(value.z)
const matrix = (value: unknown): boolean => value instanceof Float32Array && value.length === 16 && value.every(Number.isFinite)

/** Strict bounded reader, shared by local replay tooling and regression tests. */
export function decodeScanReplay(buffer: ArrayBuffer): ScanReplayCapture {
  const fail = (): never => { throw new Error('Invalid or unsupported scan capture file.') }
  if (buffer.byteLength < 12 || buffer.byteLength > MAX_SCAN_REPLAY_BYTES || new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) !== MAGIC) fail()
  const metadataLength = new DataView(buffer).getUint32(8, true)
  if (metadataLength > MAX_METADATA_BYTES || metadataLength + 12 > buffer.byteLength) fail()
  let offset = metadataLength + 12, nextArray = 0
  const root: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, metadataLength)), (_key, value: unknown) => {
    if (!record(value) || !('__scanBuffer' in value)) return value
    if (value.__scanBuffer !== nextArray++ || !Number.isSafeInteger(value.length) || (value.length as number) < 0) fail()
    const Constructor = value.kind === 'Float32Array' ? Float32Array : value.kind === 'Uint8Array' ? Uint8Array : value.kind === 'Int32Array' ? Int32Array : null
    if (!Constructor) return fail()
    const bytes = (value.length as number) * Constructor.BYTES_PER_ELEMENT
    if (!Number.isSafeInteger(bytes) || offset + bytes > buffer.byteLength) fail()
    const array = new Constructor(buffer.slice(offset, offset + bytes)); offset += bytes
    return array
  })
  if (offset !== buffer.byteLength || !record(root) || root.format !== 'spatial-scan-replay' || root.version !== 1 || typeof root.scanId !== 'string' || root.scanId.length > 200 || typeof root.build !== 'string' || root.build.length > 200 || !['local', 'local-floor'].includes(String(root.referenceSpaceType))) return fail()
  if (!record(root.diagnostics) || !record(root.measurements) || !record(root.measurements.diagnostics) || !Array.isArray(root.measurements.frames) || root.measurements.frames.length > 96) return fail()
  const sequences = new Set<number>(), epochs = new Set<number>()
  for (const frame of root.measurements.frames) {
    if (!record(frame) || !Number.isSafeInteger(frame.sequence) || !finite(frame.timestamp) || !finite(frame.trackingQuality) || !Number.isInteger(frame.samplingPhase) || !vector(frame.cameraPosition) || !vector(frame.cameraOrientation) || !finite((frame.cameraOrientation as Record<string, unknown>).w)) return fail()
    const sequence = frame.sequence as number
    if (sequences.has(sequence)) fail()
    sequences.add(sequence)
    if (!Number.isInteger(frame.trackingEpoch ?? 0)) fail()
    epochs.add((frame.trackingEpoch ?? 0) as number)
    if (epochs.size > 1 || (frame.projectionMatrix !== undefined && !matrix(frame.projectionMatrix)) || (frame.inverseViewTransform !== undefined && !matrix(frame.inverseViewTransform))) fail()
    const grid = frame.denseFrame
    if (!record(grid) || !Number.isInteger(grid.columns) || !Number.isInteger(grid.rows)) return fail()
    const count = (grid.columns as number) * (grid.rows as number)
    if ((grid.columns as number) < 1 || (grid.rows as number) < 1 || count < 1 || count > 16384) fail()
    for (const name of ['normalizedX', 'normalizedY', 'distancesMeters', 'points']) {
      const value = grid[name]
      if (!(value instanceof Float32Array) || value.length !== count * (name === 'points' ? 3 : 1)) fail()
    }
    if (!(grid.valid instanceof Uint8Array) || grid.valid.length !== count || !(frame.normals instanceof Float32Array) || frame.normals.length !== count * 3 || !(frame.normalValid instanceof Uint8Array) || frame.normalValid.length !== count || !(frame.colorSourceIndices instanceof Int32Array) || frame.colorSourceIndices.length > count || !(frame.srgbColors instanceof Uint8Array) || frame.srgbColors.length !== frame.colorSourceIndices.length * 3) fail()
    const valid = grid.valid as Uint8Array, points = grid.points as Float32Array
    let validCount = 0
    for (let i = 0; i < count; i++) {
      if (valid[i] > 1 || (frame.normalValid as Uint8Array)[i] > 1) fail()
      if (!finite((grid.normalizedX as Float32Array)[i]) || !finite((grid.normalizedY as Float32Array)[i])) fail()
      if ((frame.normalValid as Uint8Array)[i] && !(frame.normals as Float32Array).subarray(i * 3, i * 3 + 3).every(Number.isFinite)) fail()
      if (!valid[i]) continue
      validCount++
      if (![points[i * 3], points[i * 3 + 1], points[i * 3 + 2], (grid.distancesMeters as Float32Array)[i]].every(Number.isFinite) || (grid.distancesMeters as Float32Array)[i] <= 0) fail()
    }
    if (grid.validPointCount !== validCount || grid.attemptedSampleCount !== count) fail()
    if (!(frame.colorSourceIndices as Int32Array).every(index => index >= 0 && index < count)) fail()
  }
  if (root.appearance !== null) {
    if (!record(root.appearance) || !Array.isArray(root.appearance.keyframes) || root.appearance.keyframes.length > 16) return fail()
    const keyframeIds = new Set<number>()
    for (const frame of root.appearance.keyframes) {
      if (!record(frame) || !Number.isSafeInteger(frame.id) || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || (frame.width as number) <= 0 || (frame.height as number) <= 0 || (frame.width as number) * (frame.height as number) > 432 * 960 || !(frame.rgb instanceof Uint8Array) || frame.rgb.length !== (frame.width as number) * (frame.height as number) * 3 || !matrix(frame.cameraTransform) || !matrix(frame.inverseCameraTransform) || !matrix(frame.projectionMatrix) || !finite(frame.qualityScore)) return fail()
      if (!record(frame.mapping) || !record(frame.mapping.sourceUvRect)) return fail()
      if (keyframeIds.has(frame.id as number)) fail()
      keyframeIds.add(frame.id as number)
      for (const name of ['sourceCameraWidth', 'sourceCameraHeight', 'copyWidth', 'copyHeight']) if (!Number.isSafeInteger(frame.mapping[name]) || (frame.mapping[name] as number) <= 0) fail()
      for (const name of ['x', 'y', 'width', 'height']) if (!finite(frame.mapping.sourceUvRect[name])) fail()
      const rect = frame.mapping.sourceUvRect as { x: number; y: number; width: number; height: number }
      if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) fail()
    }
  }
  return root as unknown as ScanReplayCapture
}

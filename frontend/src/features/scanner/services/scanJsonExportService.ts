import type {
  FinalizedDenseRealityReconstruction,
  FinalizedRealitySurfel,
  RealityCaptureSummary,
  RealityColorStatistics,
  SpatialBounds,
  SpatialPoint,
  ScannerReferenceSpaceType,
} from '../types'
import { createInitialDenseRealityFusionDebug, DENSE_REALITY_CONFIG } from './denseRealityReconstructionService'
import type { LoadedScanReplayReview } from './scanReplayLoadService'

export const MAX_SCAN_JSON_EXPORT_BYTES = 512 * 1024 * 1024
const MAX_SCAN_JSON_SURFELS_BYTES = 128 * 1024 * 1024

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readVector(value: unknown): SpatialPoint | null {
  if (!isRecord(value) || !finite(value.x) || !finite(value.y) || !finite(value.z)) return null
  return { x: value.x, y: value.y, z: value.z }
}

function readRgb(value: unknown): { r: number; g: number; b: number } | null {
  if (!isRecord(value) || !finite(value.r) || !finite(value.g) || !finite(value.b)) return null
  return {
    r: Math.max(0, Math.min(1, value.r)),
    g: Math.max(0, Math.min(1, value.g)),
    b: Math.max(0, Math.min(1, value.b)),
  }
}

function readOptionalNumber(source: JsonRecord, name: string): number | undefined {
  const value = source[name]
  return finite(value) ? value : undefined
}

function readSurfel(value: unknown, fallbackId: number): FinalizedRealitySurfel | null {
  if (!isRecord(value)) return null
  const position = readVector(value.position)
  const normal = readVector(value.normal)
  if (!position || !normal || !finite(value.radius) || value.radius <= 0) return null

  const color = value.colorRgb === null ? null : readRgb(value.colorRgb)
  if (value.colorRgb !== null && !color) return null
  const readCount = (name: string, fallback: number): number => {
    const count = readOptionalNumber(value, name)
    return count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count : fallback
  }
  const stabilityClass = value.stabilityClass === 'high' || value.stabilityClass === 'low' || value.stabilityClass === 'provisional'
    ? value.stabilityClass
    : undefined
  const optional = (name: string): number | undefined => readOptionalNumber(value, name)

  return {
    id: Number.isSafeInteger(value.id) && (value.id as number) >= 0 ? value.id as number : fallbackId,
    position,
    normal,
    radius: value.radius,
    colorRgb: color,
    colorSpace: 'srgb',
    geometryConfidence: Math.max(0, Math.min(1, readOptionalNumber(value, 'geometryConfidence') ?? 0)),
    colorConfidence: Math.max(0, Math.min(1, readOptionalNumber(value, 'colorConfidence') ?? 0)),
    colorObservationCount: readCount('colorObservationCount', 0),
    ...(readOptionalNumber(value, 'geometryObservationCount') !== undefined
      ? { geometryObservationCount: readCount('geometryObservationCount', 0) }
      : {}),
    ...(readOptionalNumber(value, 'viewObservationCount') !== undefined
      ? { viewObservationCount: readCount('viewObservationCount', 0) }
      : {}),
    ...(optional('firstObservedAt') !== undefined ? { firstObservedAt: optional('firstObservedAt') } : {}),
    ...(optional('lastObservedAt') !== undefined ? { lastObservedAt: optional('lastObservedAt') } : {}),
    ...(optional('positionVarianceMetersSquared') !== undefined ? { positionVarianceMetersSquared: optional('positionVarianceMetersSquared') } : {}),
    ...(optional('depthVarianceMetersSquared') !== undefined ? { depthVarianceMetersSquared: optional('depthVarianceMetersSquared') } : {}),
    ...(optional('normalVariance') !== undefined ? { normalVariance: optional('normalVariance') } : {}),
    ...(optional('trackingQuality') !== undefined ? { trackingQuality: optional('trackingQuality') } : {}),
    ...(typeof value.duplicateSurfaceCandidate === 'boolean' ? { duplicateSurfaceCandidate: value.duplicateSurfaceCandidate } : {}),
    ...(stabilityClass ? { stabilityClass } : {}),
  }
}

function createBounds(surfels: readonly FinalizedRealitySurfel[]): SpatialBounds | null {
  if (surfels.length === 0) return null
  const minimum = { x: Infinity, y: Infinity, z: Infinity }
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const surfel of surfels) {
    minimum.x = Math.min(minimum.x, surfel.position.x)
    minimum.y = Math.min(minimum.y, surfel.position.y)
    minimum.z = Math.min(minimum.z, surfel.position.z)
    maximum.x = Math.max(maximum.x, surfel.position.x)
    maximum.y = Math.max(maximum.y, surfel.position.y)
    maximum.z = Math.max(maximum.z, surfel.position.z)
  }
  return { min: minimum, max: maximum }
}

function createColorStatistics(surfels: readonly FinalizedRealitySurfel[]): RealityColorStatistics {
  const colors = surfels.flatMap((surfel) => surfel.colorRgb ? [surfel.colorRgb] : [])
  const min = { r: 1, g: 1, b: 1 }
  const max = { r: 0, g: 0, b: 0 }
  const mean = { r: 0, g: 0, b: 0 }
  const approximateColors = new Set<string>()
  let nonWhiteSampleCount = 0
  for (const color of colors) {
    min.r = Math.min(min.r, color.r); min.g = Math.min(min.g, color.g); min.b = Math.min(min.b, color.b)
    max.r = Math.max(max.r, color.r); max.g = Math.max(max.g, color.g); max.b = Math.max(max.b, color.b)
    mean.r += color.r; mean.g += color.g; mean.b += color.b
    if (Math.min(color.r, color.g, color.b) < .96) nonWhiteSampleCount++
    approximateColors.add(`${Math.round(color.r * 15)},${Math.round(color.g * 15)},${Math.round(color.b * 15)}`)
  }
  if (colors.length > 0) {
    mean.r /= colors.length; mean.g /= colors.length; mean.b /= colors.length
  } else {
    min.r = 0; min.g = 0; min.b = 0
  }
  return {
    colorSpace: 'srgb',
    sampleCount: colors.length,
    min,
    max,
    mean,
    nonWhiteSampleCount,
    uniqueApproximateColorCount: approximateColors.size,
  }
}

function createCaptureSummary(surfels: readonly FinalizedRealitySurfel[]): RealityCaptureSummary {
  const colors = surfels.filter((surfel) => surfel.colorRgb !== null)
  const capacity = DENSE_REALITY_CONFIG.maxSamples
  return {
    totalSurfels: surfels.length,
    coloredSurfels: colors.length,
    colorCoveragePercentage: surfels.length > 0 ? 100 * colors.length / surfels.length : 0,
    averageColorObservations: colors.length > 0 ? colors.reduce((sum, surfel) => sum + surfel.colorObservationCount, 0) / colors.length : 0,
    cameraCapturesUsed: 0,
    averageColorConfidence: colors.length > 0 ? colors.reduce((sum, surfel) => sum + surfel.colorConfidence, 0) / colors.length : 0,
    averageNearestNeighborSpacingMeters: null,
    medianNearestNeighborSpacingMeters: null,
    p90NearestNeighborSpacingMeters: null,
    approximateUncoveredGapMeters: null,
    estimatedSmallGapRegionCount: 0,
    estimatedLargeUnsupportedGapCount: 0,
    surfelCapacity: capacity,
    capacityUtilizationPercentage: 100 * surfels.length / capacity,
    capacityReached: surfels.length >= capacity,
  }
}

function createReview(source: JsonRecord, fileName: string): LoadedScanReplayReview {
  const validReferenceSpace = source.referenceSpaceType === 'local' || source.referenceSpaceType === 'local-floor'
  if (typeof source.scanId !== 'string' || source.scanId.length === 0 || source.scanId.length > 200 || !validReferenceSpace || !Array.isArray(source.surfels)) {
    throw new Error('This JSON export is missing its saved room reconstruction.')
  }
  if (source.surfels.length > DENSE_REALITY_CONFIG.maxSamples) {
    throw new Error(`This JSON export contains more than ${DENSE_REALITY_CONFIG.maxSamples.toLocaleString()} room samples.`)
  }

  const surfels = source.surfels.map((value, index) => readSurfel(value, index))
  if (surfels.some((surfel) => surfel === null)) {
    throw new Error('This JSON export contains invalid room geometry.')
  }
  const safeSurfels = surfels as FinalizedRealitySurfel[]
  const reconstruction: FinalizedDenseRealityReconstruction = {
    scanId: source.scanId,
    referenceSpaceType: source.referenceSpaceType as ScannerReferenceSpaceType,
    status: safeSurfels.length > 0 ? 'available' : 'empty',
    surfels: safeSurfels,
    canonicalSurfels: safeSurfels,
    bounds: createBounds(safeSurfels),
    captureSummary: createCaptureSummary(safeSurfels),
    fusionDiagnostics: createInitialDenseRealityFusionDebug(),
    colorStatistics: createColorStatistics(safeSurfels),
    colorSamples: [],
  }

  return {
    fileName,
    capturedBuild: 'JSON scan export',
    frameCount: null,
    sampleCount: null,
    sampleLabel: 'Saved surfels',
    previewDescription: 'Loaded from the saved room model. The JSON export does not include live scan coverage history.',
    reconstruction,
  }
}

/** Read only the saved reconstruction needed for review; raw and experimental capture payloads are ignored. */
export function parseScanJsonExport(text: string, fileName: string): LoadedScanReplayReview {
  let root: unknown
  try {
    root = JSON.parse(text) as unknown
  } catch {
    throw new Error('This JSON file is not a valid scan export.')
  }
  if (!isRecord(root) || root.version !== 1 || !isRecord(root.reconstruction)) {
    throw new Error('Unsupported JSON scan file. Choose a version 1 scan export.')
  }
  return createReview(root.reconstruction, fileName)
}

/**
 * Extracts only the top-level reconstruction metadata and surfel array from a large export.
 * The surrounding JSON is streamed and skipped, so experimental RGB-D arrays never become
 * a second in-memory JavaScript object on laptop browsers.
 */
export async function parseScanJsonExportStream(
  stream: ReadableStream<Uint8Array>,
  fileName: string,
): Promise<LoadedScanReplayReview> {
  const reader = new ScanJsonStreamReader(stream)
  let version: unknown
  let source: JsonRecord | null = null
  try {
    await reader.expect('{')
    let first = true
    while (!(await reader.consumeIf('}'))) {
      if (!first) await reader.expect(',')
      first = false
      const key = await reader.readString()
      await reader.expect(':')
      if (key === 'version') version = await reader.readScalar()
      else if (key === 'reconstruction') {
        source = await reader.readReconstruction(version === 1)
        if (version === 1 && source && hasScanModelFields(source)) {
          await reader.cancel()
          return createReview(source, fileName)
        }
      } else await reader.skipValue()
    }
    await reader.expectEnd()
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('This JSON')) throw cause
    throw new Error('This JSON file is not a valid scan export.')
  }
  if (version !== 1 || !source) throw new Error('Unsupported JSON scan file. Choose a version 1 scan export.')
  return createReview(source, fileName)
}

function hasScanModelFields(source: JsonRecord): boolean {
  return typeof source.scanId === 'string'
    && (source.referenceSpaceType === 'local' || source.referenceSpaceType === 'local-floor')
    && Array.isArray(source.surfels)
}

class ScanJsonStreamReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private readonly decoder = new TextDecoder()
  private buffer = ''
  private offset = 0
  private ended = false

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader()
  }

  private async fill(): Promise<boolean> {
    while (this.offset >= this.buffer.length && !this.ended) {
      const chunk = await this.reader.read()
      this.buffer = chunk.done ? this.decoder.decode() : this.decoder.decode(chunk.value, { stream: true })
      this.offset = 0
      this.ended = chunk.done
    }
    return this.offset < this.buffer.length
  }

  private async peekNonWhitespace(): Promise<string> {
    while (await this.fill()) {
      const code = this.buffer.charCodeAt(this.offset)
      if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return this.buffer[this.offset]
      this.offset++
    }
    return ''
  }

  private async nextNonWhitespace(): Promise<string> {
    const value = await this.peekNonWhitespace()
    if (value) this.offset++
    return value
  }

  async expect(value: string): Promise<void> {
    if (await this.nextNonWhitespace() !== value) throw new Error('Invalid JSON structure.')
  }

  async consumeIf(value: string): Promise<boolean> {
    if (await this.peekNonWhitespace() !== value) return false
    this.offset++
    return true
  }

  async readString(): Promise<string> {
    await this.expect('"')
    const pieces: string[] = []
    let escaped = false
    while (await this.fill()) {
      const quote = this.buffer.indexOf('"', this.offset)
      const slash = this.buffer.indexOf('\\', this.offset)
      let stop = -1
      if (quote < 0) stop = slash
      else if (slash < 0) stop = quote
      else stop = Math.min(quote, slash)
      if (stop < 0) {
        pieces.push(this.buffer.slice(this.offset))
        this.offset = this.buffer.length
        continue
      }
      pieces.push(this.buffer.slice(this.offset, stop + 1))
      const token = this.buffer[stop]
      this.offset = stop + 1
      if (escaped) {
        escaped = false
      } else if (token === '\\') {
        escaped = true
      } else {
        try {
          return JSON.parse(`"${pieces.join('')}`) as string
        } catch {
          throw new Error('Invalid JSON string.')
        }
      }
    }
    throw new Error('Unterminated JSON string.')
  }

  async readScalar(): Promise<unknown> {
    const first = await this.peekNonWhitespace()
    if (first === '"') return this.readString()
    if (first === '{' || first === '[' || !first) {
      await this.skipValue()
      return undefined
    }
    const raw = await this.readPrimitive()
    try {
      return JSON.parse(raw) as unknown
    } catch {
      throw new Error('Invalid JSON scalar.')
    }
  }

  async readReconstruction(stopAfterModel: boolean): Promise<JsonRecord | null> {
    if (await this.peekNonWhitespace() !== '{') {
      await this.skipValue()
      return null
    }
    await this.expect('{')
    const result: JsonRecord = {}
    let first = true
    while (!(await this.consumeIf('}'))) {
      if (!first) await this.expect(',')
      first = false
      const key = await this.readString()
      await this.expect(':')
      if (key === 'scanId' || key === 'referenceSpaceType') {
        result[key] = await this.readScalar()
      } else if (key === 'surfels') {
        const raw = await this.readArray()
        if (raw !== null) {
          try {
            result.surfels = JSON.parse(raw) as unknown
          } catch {
            throw new Error('This JSON file is not a valid scan export.')
          }
        }
      } else {
        await this.skipValue()
      }
      if (stopAfterModel && hasScanModelFields(result)) return result
    }
    return result
  }

  private async readPrimitive(): Promise<string> {
    const pieces: string[] = []
    const first = await this.nextNonWhitespace()
    if (!first) return ''
    pieces.push(first)
    while (await this.fill()) {
      const start = this.offset
      while (this.offset < this.buffer.length) {
        const code = this.buffer.charCodeAt(this.offset)
        if (code === 32 || code === 9 || code === 10 || code === 13 || code === 44 || code === 125 || code === 93) break
        this.offset++
      }
      if (this.offset > start) pieces.push(this.buffer.slice(start, this.offset))
      if (this.offset < this.buffer.length) break
    }
    return pieces.join('')
  }

  async skipValue(): Promise<void> {
    const first = await this.peekNonWhitespace()
    if (first === '"') {
      await this.skipString()
      return
    }
    if (first === '{' || first === '[') {
      await this.skipComposite(false)
      return
    }
    const primitive = await this.readPrimitive()
    if (!primitive) throw new Error('Invalid JSON value.')
  }

  private async skipString(): Promise<void> {
    await this.expect('"')
    let escaped = false
    while (await this.fill()) {
      const quote = this.buffer.indexOf('"', this.offset)
      const slash = this.buffer.indexOf('\\', this.offset)
      let stop = -1
      if (quote < 0) stop = slash
      else if (slash < 0) stop = quote
      else stop = Math.min(quote, slash)
      if (stop < 0) {
        this.offset = this.buffer.length
        continue
      }
      const token = this.buffer[stop]
      this.offset = stop + 1
      if (escaped) escaped = false
      else if (token === '\\') escaped = true
      else return
    }
    throw new Error('Unterminated JSON string.')
  }

  private async readArray(): Promise<string | null> {
    if (await this.peekNonWhitespace() !== '[') {
      await this.skipValue()
      return null
    }
    return this.skipComposite(true)
  }

  private async skipComposite(capture: boolean): Promise<string | null> {
    const first = await this.nextNonWhitespace()
    if (first !== '{' && first !== '[') throw new Error('Invalid JSON value.')
    const closing: string[] = [first === '{' ? '}' : ']']
    const pieces: string[] = capture ? [first] : []
    let capturedLength = capture ? first.length : 0
    const addPiece = (piece: string): void => {
      if (!capture) return
      capturedLength += piece.length
      if (capturedLength > MAX_SCAN_JSON_SURFELS_BYTES) {
        throw new Error(`This JSON export's saved room model exceeds ${Math.round(MAX_SCAN_JSON_SURFELS_BYTES / 1024 / 1024)} MiB.`)
      }
      pieces.push(piece)
    }
    let inString = false
    let escaped = false
    while (await this.fill()) {
      if (inString) {
        const quote = this.buffer.indexOf('"', this.offset)
        const slash = this.buffer.indexOf('\\', this.offset)
        let stop = -1
        if (quote < 0) stop = slash
        else if (slash < 0) stop = quote
        else stop = Math.min(quote, slash)
        if (stop < 0) {
          addPiece(this.buffer.slice(this.offset))
          this.offset = this.buffer.length
          continue
        }
        addPiece(this.buffer.slice(this.offset, stop + 1))
        const token = this.buffer[stop]
        this.offset = stop + 1
        if (escaped) escaped = false
        else if (token === '\\') escaped = true
        else inString = false
        continue
      }

      const start = this.offset
      const brace = this.buffer.indexOf('{', this.offset)
      const bracket = this.buffer.indexOf('[', this.offset)
      const quote = this.buffer.indexOf('"', this.offset)
      const closeBrace = this.buffer.indexOf('}', this.offset)
      const closeBracket = this.buffer.indexOf(']', this.offset)
      const indices = [brace, bracket, quote, closeBrace, closeBracket].filter((index) => index >= 0)
      if (indices.length === 0) {
        addPiece(this.buffer.slice(start))
        this.offset = this.buffer.length
        continue
      }
      const stop = Math.min(...indices)
      addPiece(this.buffer.slice(start, stop + 1))
      const token = this.buffer[stop]
      this.offset = stop + 1
      if (token === '"') inString = true
      else if (token === '{') closing.push('}')
      else if (token === '[') closing.push(']')
      else {
        if (closing.pop() !== token) throw new Error('Unbalanced JSON value.')
        if (closing.length === 0) return capture ? pieces.join('') : null
      }
    }
    throw new Error('Unterminated JSON value.')
  }

  async expectEnd(): Promise<void> {
    if (await this.peekNonWhitespace() !== '') throw new Error('Trailing JSON data.')
  }

  async cancel(): Promise<void> {
    await this.reader.cancel()
  }
}

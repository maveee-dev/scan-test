import type {
  M812SynchronizedRgbdKeyframe,
  M812SynchronizedRgbdSnapshot,
} from './m812SynchronizedRgbdCaptureService'
import { projectWorldPointIntoCameraUv } from './rgbDepthRegistrationService'
import { mapCameraUvToCopyPixelInto } from './xrRawCameraService'

export interface M813Point3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface M813VirtualView {
  readonly position: M813Point3
  readonly target: M813Point3
}

export interface M813ViewDependentVisualRealityOptions {
  readonly maxActiveKeyframes?: number
  readonly minActiveKeyframes?: number
}

export const M813_VIEW_DEPENDENT_CONFIG = Object.freeze({
  maximumInputKeyframes: 8,
  maximumActiveKeyframes: 4,
  minimumActiveKeyframes: 2,
  maximumDepthDiscontinuityMeters: 0.022,
  maximumTriangleEdgeMeters: 0.1,
  minimumTriangleAreaSineSquared: 0.01,
  maximumOutputTrianglesPerKeyframe: 2_000_000,
  maximumOutputVerticesPerKeyframe: 800_000,
})

export type M813QuadRejectionReason =
  | 'invalid-depth'
  | 'depth-discontinuity'
  | 'edge-too-long'
  | 'degenerate'

export interface M813ViewSelectionDiagnostics {
  readonly keyframeId: number
  readonly frameSequence: number
  readonly score: number
  readonly qualityScore: number
  readonly validDepthFraction: number
  readonly cameraDistanceMeters: number
  readonly targetDistanceMeters: number
  readonly captureIncidence: number
  readonly selected: boolean
}

export interface M813KeyframeGeometryDiagnostics {
  readonly keyframeId: number
  readonly frameSequence: number
  readonly candidateQuadCount: number
  readonly retainedTriangleCount: number
  readonly retainedVertexCount: number
  readonly rejectedInvalidDepthQuads: number
  readonly rejectedDepthDiscontinuityQuads: number
  readonly rejectedEdgeTooLongQuads: number
  readonly rejectedDegenerateQuads: number
  readonly packedBytes: number
}

export interface M813ViewDependentKeyframeGeometry {
  readonly keyframeId: number
  readonly frameSequence: number
  readonly width: number
  readonly height: number
  /** Direct reference to the selected source keyframe's RGB ownership. */
  readonly rgb: Uint8Array
  readonly capturePosition: M813Point3
  readonly captureForward: M813Point3
  readonly qualityScore: number
  readonly validDepthFraction: number
  readonly positions: Float32Array
  /** Normalized top-left UVs copied directly from the synchronized source grid. */
  readonly sourceGridUvs: Float32Array
  /** Alias for consumers that use the shorter UV terminology. */
  readonly uvs: Float32Array
  /** Row-major synchronized depth source indices, three per output vertex. */
  readonly sourceSampleIndices: Int32Array
  readonly indices: Uint32Array
  readonly diagnostics: M813KeyframeGeometryDiagnostics
}

export interface M813ViewDependentVisualRealityDiagnostics {
  readonly inputKeyframeCount: number
  readonly boundedInputKeyframeCount: number
  readonly ignoredInputKeyframeCount: number
  readonly rankedKeyframeCount: number
  readonly activeKeyframeCount: number
  readonly selectedKeyframeIds: readonly number[]
  readonly candidateQuadCount: number
  readonly retainedTriangleCount: number
  readonly retainedVertexCount: number
  readonly rejectedInvalidDepthQuads: number
  readonly rejectedDepthDiscontinuityQuads: number
  readonly rejectedEdgeTooLongQuads: number
  readonly rejectedDegenerateQuads: number
  readonly sourceOwnershipViolations: number
  readonly inventedVertexCount: number
  readonly packedArrayBytes: number
  readonly buildTimeMs: number
  readonly sourceOwnedRgb: boolean
  readonly noCrossKeyframeGeometryMerge: true
  readonly noGapFill: true
  readonly screenSpaceCoverageAvailable: true
  readonly viewRanking: readonly M813ViewSelectionDiagnostics[]
  readonly keyframeDiagnostics: readonly M813KeyframeGeometryDiagnostics[]
}

export interface M813ViewDependentVisualRealityResult {
  readonly keyframes: readonly M813ViewDependentKeyframeGeometry[]
  readonly diagnostics: M813ViewDependentVisualRealityDiagnostics
}

interface Point3 {
  x: number
  y: number
  z: number
}

interface RankedKeyframe {
  readonly capture: M812SynchronizedRgbdKeyframe
  readonly score: number
  readonly qualityScore: number
  readonly validDepthFraction: number
  readonly cameraDistanceMeters: number
  readonly targetDistanceMeters: number
  readonly captureIncidence: number
}

const now = (): number => typeof performance === 'undefined' ? Date.now() : performance.now()

const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z

const subtract = (a: Point3, b: Point3): Point3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})

const lengthSquared = (point: Point3): number => dot(point, point)

const length = (point: Point3): number => Math.sqrt(lengthSquared(point))

const normalize = (point: Point3): Point3 | null => {
  const magnitude = length(point)
  return Number.isFinite(magnitude) && magnitude > 1e-7
    ? { x: point.x / magnitude, y: point.y / magnitude, z: point.z / magnitude }
    : null
}

const cross = (a: Point3, b: Point3): Point3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

const isFinitePoint = (point: Point3): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)

const readPoint = (capture: M812SynchronizedRgbdKeyframe, index: number): Point3 | null => {
  const depth = capture.depth
  const offset = index * 3
  if (index < 0 || index >= depth.valid.length || depth.valid[index] !== 1 || offset + 2 >= depth.worldPoints.length) return null
  const point = {
    x: depth.worldPoints[offset],
    y: depth.worldPoints[offset + 1],
    z: depth.worldPoints[offset + 2],
  }
  return isFinitePoint(point) ? point : null
}

const readUv = (capture: M812SynchronizedRgbdKeyframe, index: number): readonly [number, number] | null => {
  const point = readPoint(capture, index)
  if (!point) return null
  const projected = { u: 0, v: 0 }
  const pixel = { x: 0, y: 0 }
  if (!projectWorldPointIntoCameraUv(
    capture.rgbKeyframe.inverseCameraTransform,
    capture.rgbKeyframe.projectionMatrix,
    point.x,
    point.y,
    point.z,
    projected,
  ) || !mapCameraUvToCopyPixelInto(capture.rgbKeyframe.mapping, projected.u, projected.v, pixel)) return null
  return [
    (pixel.x + 0.5) / capture.rgbKeyframe.width,
    1 - (pixel.y + 0.5) / capture.rgbKeyframe.height,
  ]
}

const readDepth = (capture: M812SynchronizedRgbdKeyframe, index: number): number | null => {
  const depth = capture.depth
  if (index < 0 || index >= depth.valid.length || depth.valid[index] !== 1) return null
  const value = depth.distancesMeters[index]
  return Number.isFinite(value) && value > 0 ? value : null
}

const cameraPosition = (capture: M812SynchronizedRgbdKeyframe): Point3 => ({
  x: capture.rgbKeyframe.cameraTransform[12] ?? 0,
  y: capture.rgbKeyframe.cameraTransform[13] ?? 0,
  z: capture.rgbKeyframe.cameraTransform[14] ?? 0,
})

const captureForward = (capture: M812SynchronizedRgbdKeyframe): Point3 => normalize({
  x: -(capture.rgbKeyframe.cameraTransform[8] ?? 0),
  y: -(capture.rgbKeyframe.cameraTransform[9] ?? 0),
  z: -(capture.rgbKeyframe.cameraTransform[10] ?? -1),
}) ?? { x: 0, y: 0, z: -1 }

const validDepthFraction = (capture: M812SynchronizedRgbdKeyframe): number => {
  const depth = capture.depth
  if (depth.valid.length === 0) return 0
  let valid = 0
  for (let index = 0; index < depth.valid.length; index += 1) if (readPoint(capture, index) && readDepth(capture, index) !== null) valid += 1
  return valid / depth.valid.length
}

function rankKeyframe(capture: M812SynchronizedRgbdKeyframe, view: M813VirtualView): RankedKeyframe {
  const position = cameraPosition(capture)
  const toTarget = subtract(view.target, position)
  const targetDirection = normalize(toTarget)
  const forward = captureForward(capture)
  const virtualDistance = Math.max(1e-4, length(subtract(view.target, view.position)))
  const cameraDistanceMeters = length(subtract(position, view.position))
  const targetDistanceMeters = length(toTarget)
  const captureIncidence = targetDirection ? Math.max(0, dot(forward, targetDirection)) : 0
  const positionScore = 1 / (1 + cameraDistanceMeters)
  const targetDistanceScore = 1 / (1 + Math.abs(targetDistanceMeters - virtualDistance))
  const qualityScore = Math.max(0, Math.min(1, Number.isFinite(capture.rgbKeyframe.qualityScore) ? capture.rgbKeyframe.qualityScore : 0))
  const depthFraction = validDepthFraction(capture)
  const score = qualityScore * 0.45 + depthFraction * 0.2 + captureIncidence * 0.2 + positionScore * 0.1 + targetDistanceScore * 0.05
  return { capture, score, qualityScore, validDepthFraction: depthFraction, cameraDistanceMeters, targetDistanceMeters, captureIncidence }
}

function sortCaptures(snapshot: M812SynchronizedRgbdSnapshot): readonly M812SynchronizedRgbdKeyframe[] {
  return [...snapshot.keyframes]
    .sort((left, right) => left.frameSequence - right.frameSequence || left.rgbKeyframe.id - right.rgbKeyframe.id)
    .slice(0, M813_VIEW_DEPENDENT_CONFIG.maximumInputKeyframes)
}

function evaluateTriangle(a: Point3, b: Point3, c: Point3): boolean {
  const ab = subtract(b, a)
  const ac = subtract(c, a)
  const areaSquared = lengthSquared(cross(ab, ac))
  const scaleSquared = lengthSquared(ab) * lengthSquared(ac)
  return scaleSquared > 1e-12 && areaSquared > scaleSquared * M813_VIEW_DEPENDENT_CONFIG.minimumTriangleAreaSineSquared
}

function maxQuadEdge(points: readonly [Point3, Point3, Point3, Point3]): number {
  let maximum = 0
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      maximum = Math.max(maximum, length(subtract(points[first], points[second])))
    }
  }
  return maximum
}

interface MutableKeyframeGeometry {
  readonly capture: M812SynchronizedRgbdKeyframe
  readonly positions: number[]
  readonly uvs: number[]
  readonly sourceSampleIndices: number[]
  readonly indices: number[]
  readonly sourceToVertex: Int32Array
  candidateQuadCount: number
  retainedTriangleCount: number
  rejectedInvalidDepthQuads: number
  rejectedDepthDiscontinuityQuads: number
  rejectedEdgeTooLongQuads: number
  rejectedDegenerateQuads: number
}

function buildKeyframeGeometry(capture: M812SynchronizedRgbdKeyframe): M813ViewDependentKeyframeGeometry {
  const depth = capture.depth
  const sampleCount = Math.max(0, depth.columns * depth.rows)
  const state: MutableKeyframeGeometry = {
    capture,
    positions: [],
    uvs: [],
    sourceSampleIndices: [],
    indices: [],
    sourceToVertex: new Int32Array(sampleCount),
    candidateQuadCount: 0,
    retainedTriangleCount: 0,
    rejectedInvalidDepthQuads: 0,
    rejectedDepthDiscontinuityQuads: 0,
    rejectedEdgeTooLongQuads: 0,
    rejectedDegenerateQuads: 0,
  }
  state.sourceToVertex.fill(-1)

  const ensureVertex = (sourceIndex: number): number => {
    const existing = state.sourceToVertex[sourceIndex]
    if (existing >= 0) return existing
    const point = readPoint(capture, sourceIndex)!
    const uv = readUv(capture, sourceIndex)!
    const vertex = state.positions.length / 3
    state.sourceToVertex[sourceIndex] = vertex
    state.positions.push(point.x, point.y, point.z)
    state.uvs.push(uv[0], uv[1])
    state.sourceSampleIndices.push(sourceIndex)
    return vertex
  }

  const { columns, rows } = depth
  if (columns >= 2 && rows >= 2) {
    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        state.candidateQuadCount += 1
        const first = row * columns + column
        const second = first + 1
        const third = first + columns
        const fourth = third + 1
        const indices = [first, second, third, fourth] as const
        const points = indices.map((index) => readPoint(capture, index))
        const depths = indices.map((index) => readDepth(capture, index))
        const uvs = indices.map((index) => readUv(capture, index))
        if (points.some((point) => point === null) || depths.some((value) => value === null) || uvs.some((uv) => uv === null)) {
          state.rejectedInvalidDepthQuads += 1
          continue
        }
        const completePoints = points as [Point3, Point3, Point3, Point3]
        const completeDepths = depths as [number, number, number, number]
        if (Math.max(...completeDepths) - Math.min(...completeDepths) > M813_VIEW_DEPENDENT_CONFIG.maximumDepthDiscontinuityMeters) {
          state.rejectedDepthDiscontinuityQuads += 1
          continue
        }
        if (maxQuadEdge(completePoints) > M813_VIEW_DEPENDENT_CONFIG.maximumTriangleEdgeMeters) {
          state.rejectedEdgeTooLongQuads += 1
          continue
        }
        if (!evaluateTriangle(completePoints[0], completePoints[1], completePoints[3]) || !evaluateTriangle(completePoints[0], completePoints[3], completePoints[2])) {
          state.rejectedDegenerateQuads += 1
          continue
        }
        if (state.indices.length / 3 + 2 > M813_VIEW_DEPENDENT_CONFIG.maximumOutputTrianglesPerKeyframe) {
          state.rejectedDegenerateQuads += 1
          continue
        }
        const firstTriangle = [ensureVertex(first), ensureVertex(second), ensureVertex(fourth)]
        const secondTriangle = [ensureVertex(first), ensureVertex(fourth), ensureVertex(third)]
        state.indices.push(...firstTriangle, ...secondTriangle)
        state.retainedTriangleCount += 2
      }
    }
  }

  const positions = new Float32Array(state.positions)
  const sourceGridUvs = new Float32Array(state.uvs)
  const sourceSampleIndices = new Int32Array(state.sourceSampleIndices)
  const indices = new Uint32Array(state.indices)
  const packedBytes = positions.byteLength + sourceGridUvs.byteLength + sourceSampleIndices.byteLength + indices.byteLength
  const diagnostics: M813KeyframeGeometryDiagnostics = Object.freeze({
    keyframeId: capture.rgbKeyframe.id,
    frameSequence: capture.frameSequence,
    candidateQuadCount: state.candidateQuadCount,
    retainedTriangleCount: state.retainedTriangleCount,
    retainedVertexCount: sourceSampleIndices.length,
    rejectedInvalidDepthQuads: state.rejectedInvalidDepthQuads,
    rejectedDepthDiscontinuityQuads: state.rejectedDepthDiscontinuityQuads,
    rejectedEdgeTooLongQuads: state.rejectedEdgeTooLongQuads,
    rejectedDegenerateQuads: state.rejectedDegenerateQuads,
    packedBytes,
  })
  return Object.freeze({
    keyframeId: capture.rgbKeyframe.id,
    frameSequence: capture.frameSequence,
    width: capture.rgbKeyframe.width,
    height: capture.rgbKeyframe.height,
    rgb: capture.rgbKeyframe.rgb,
    capturePosition: cameraPosition(capture),
    captureForward: captureForward(capture),
    qualityScore: capture.rgbKeyframe.qualityScore,
    validDepthFraction: validDepthFraction(capture),
    positions,
    sourceGridUvs,
    uvs: sourceGridUvs,
    sourceSampleIndices,
    indices,
    diagnostics,
  })
}

function emptyResult(startedAt: number, snapshot: M812SynchronizedRgbdSnapshot): M813ViewDependentVisualRealityResult {
  const inputCount = snapshot.keyframes.length
  const boundedCount = Math.min(inputCount, M813_VIEW_DEPENDENT_CONFIG.maximumInputKeyframes)
  return Object.freeze({
    keyframes: Object.freeze([]),
    diagnostics: Object.freeze({
      inputKeyframeCount: inputCount,
      boundedInputKeyframeCount: boundedCount,
      ignoredInputKeyframeCount: Math.max(0, inputCount - boundedCount),
      rankedKeyframeCount: 0,
      activeKeyframeCount: 0,
      selectedKeyframeIds: Object.freeze([]),
      candidateQuadCount: 0,
      retainedTriangleCount: 0,
      retainedVertexCount: 0,
      rejectedInvalidDepthQuads: 0,
      rejectedDepthDiscontinuityQuads: 0,
      rejectedEdgeTooLongQuads: 0,
      rejectedDegenerateQuads: 0,
      sourceOwnershipViolations: 0,
      inventedVertexCount: 0,
      packedArrayBytes: 0,
      buildTimeMs: Math.max(0, now() - startedAt),
      sourceOwnedRgb: true,
      noCrossKeyframeGeometryMerge: true,
      noGapFill: true,
      screenSpaceCoverageAvailable: true,
      viewRanking: Object.freeze([]),
      keyframeDiagnostics: Object.freeze([]),
    }),
  })
}

export function buildM813ViewDependentVisualReality(
  snapshot: M812SynchronizedRgbdSnapshot,
  view: M813VirtualView,
  options: M813ViewDependentVisualRealityOptions = {},
): M813ViewDependentVisualRealityResult {
  const startedAt = now()
  if (!snapshot || snapshot.status !== 'available' || snapshot.keyframes.length === 0) return emptyResult(startedAt, snapshot)

  const captures = sortCaptures(snapshot)
  const maxActive = Math.max(1, Math.min(
    M813_VIEW_DEPENDENT_CONFIG.maximumActiveKeyframes,
    Math.floor(options.maxActiveKeyframes ?? M813_VIEW_DEPENDENT_CONFIG.maximumActiveKeyframes),
  ))
  const minActive = Math.max(1, Math.min(maxActive, Math.floor(options.minActiveKeyframes ?? M813_VIEW_DEPENDENT_CONFIG.minimumActiveKeyframes)))
  const ranked = captures.map((capture) => rankKeyframe(capture, view)).sort((left, right) =>
    right.score - left.score || right.qualityScore - left.qualityScore || left.capture.frameSequence - right.capture.frameSequence || left.capture.rgbKeyframe.id - right.capture.rgbKeyframe.id,
  )
  const activeCount = Math.min(ranked.length, Math.max(minActive, Math.min(maxActive, ranked.length)))
  const active = ranked.slice(0, activeCount)
  // Build every bounded source-owned keyframe once. The renderer then changes
  // only which 2–4 existing layers are visible as the virtual camera moves.
  const geometries = captures.map((capture) => buildKeyframeGeometry(capture))

  let candidateQuadCount = 0
  let retainedTriangleCount = 0
  let retainedVertexCount = 0
  let rejectedInvalidDepthQuads = 0
  let rejectedDepthDiscontinuityQuads = 0
  let rejectedEdgeTooLongQuads = 0
  let rejectedDegenerateQuads = 0
  let sourceOwnershipViolations = 0
  let packedArrayBytes = 0
  const keyframeDiagnostics: M813KeyframeGeometryDiagnostics[] = []
  for (const geometry of geometries) {
    candidateQuadCount += geometry.diagnostics.candidateQuadCount
    retainedTriangleCount += geometry.diagnostics.retainedTriangleCount
    retainedVertexCount += geometry.diagnostics.retainedVertexCount
    rejectedInvalidDepthQuads += geometry.diagnostics.rejectedInvalidDepthQuads
    rejectedDepthDiscontinuityQuads += geometry.diagnostics.rejectedDepthDiscontinuityQuads
    rejectedEdgeTooLongQuads += geometry.diagnostics.rejectedEdgeTooLongQuads
    rejectedDegenerateQuads += geometry.diagnostics.rejectedDegenerateQuads
    packedArrayBytes += geometry.diagnostics.packedBytes
    keyframeDiagnostics.push(geometry.diagnostics)
    const capture = captures.find((entry) => entry.rgbKeyframe.id === geometry.keyframeId)!
    for (let vertex = 0; vertex < geometry.sourceSampleIndices.length; vertex += 1) {
      const sourceIndex = geometry.sourceSampleIndices[vertex]
      const pointOffset = vertex * 3
      const sourceOffset = sourceIndex * 3
      const sourcePoint = capture.depth.worldPoints
      const uvIndex = vertex * 2
      if (geometry.positions[pointOffset] !== sourcePoint[sourceOffset] ||
        geometry.positions[pointOffset + 1] !== sourcePoint[sourceOffset + 1] ||
        geometry.positions[pointOffset + 2] !== sourcePoint[sourceOffset + 2] ||
        !Number.isFinite(geometry.sourceGridUvs[uvIndex]) ||
        !Number.isFinite(geometry.sourceGridUvs[uvIndex + 1])) sourceOwnershipViolations += 1
    }
  }
  const viewRanking = ranked.map((entry) => Object.freeze({
    keyframeId: entry.capture.rgbKeyframe.id,
    frameSequence: entry.capture.frameSequence,
    score: entry.score,
    qualityScore: entry.qualityScore,
    validDepthFraction: entry.validDepthFraction,
    cameraDistanceMeters: entry.cameraDistanceMeters,
    targetDistanceMeters: entry.targetDistanceMeters,
    captureIncidence: entry.captureIncidence,
    selected: active.includes(entry),
  }))
  const diagnostics: M813ViewDependentVisualRealityDiagnostics = Object.freeze({
    inputKeyframeCount: snapshot.keyframes.length,
    boundedInputKeyframeCount: captures.length,
    ignoredInputKeyframeCount: Math.max(0, snapshot.keyframes.length - captures.length),
    rankedKeyframeCount: ranked.length,
    activeKeyframeCount: active.length,
    selectedKeyframeIds: Object.freeze(active.map((entry) => entry.capture.rgbKeyframe.id)),
    candidateQuadCount,
    retainedTriangleCount,
    retainedVertexCount,
    rejectedInvalidDepthQuads,
    rejectedDepthDiscontinuityQuads,
    rejectedEdgeTooLongQuads,
    rejectedDegenerateQuads,
    sourceOwnershipViolations,
    inventedVertexCount: sourceOwnershipViolations,
    packedArrayBytes,
    buildTimeMs: Math.max(0, now() - startedAt),
    sourceOwnedRgb: geometries.every((geometry) => geometry.rgb.byteLength === geometry.width * geometry.height * 3),
    noCrossKeyframeGeometryMerge: true,
    noGapFill: true,
    screenSpaceCoverageAvailable: true,
    viewRanking: Object.freeze(viewRanking),
    keyframeDiagnostics: Object.freeze(keyframeDiagnostics),
  })
  return Object.freeze({ keyframes: Object.freeze(geometries), diagnostics })
}

export class M813ViewDependentVisualRealityService {
  public build(
    snapshot: M812SynchronizedRgbdSnapshot,
    view: M813VirtualView,
    options: M813ViewDependentVisualRealityOptions = {},
  ): M813ViewDependentVisualRealityResult {
    return buildM813ViewDependentVisualReality(snapshot, view, options)
  }
}

/** Ranks already-built source-owned layers without rebuilding or merging geometry. */
export function selectM813ViewDependentKeyframes(
  result: M813ViewDependentVisualRealityResult,
  view: M813VirtualView,
  maximumActive = M813_VIEW_DEPENDENT_CONFIG.maximumActiveKeyframes,
): readonly number[] {
  const virtualDistance = Math.max(1e-4, length(subtract(view.target, view.position)))
  return result.keyframes.map((geometry) => {
    const toTarget = subtract(view.target, geometry.capturePosition)
    const targetDirection = normalize(toTarget)
    const cameraDistance = length(subtract(geometry.capturePosition, view.position))
    const targetDistance = length(toTarget)
    const incidence = targetDirection ? Math.max(0, dot(geometry.captureForward, targetDirection)) : 0
    const score = Math.max(0, Math.min(1, geometry.qualityScore)) * 0.45 + geometry.validDepthFraction * 0.2 + incidence * 0.2 +
      0.1 / (1 + cameraDistance) + 0.05 / (1 + Math.abs(targetDistance - virtualDistance))
    return { id: geometry.keyframeId, score, sequence: geometry.frameSequence }
  }).sort((left, right) => right.score - left.score || left.sequence - right.sequence || left.id - right.id)
    .slice(0, Math.max(1, Math.min(M813_VIEW_DEPENDENT_CONFIG.maximumActiveKeyframes, Math.floor(maximumActive))))
    .map((entry) => entry.id)
}

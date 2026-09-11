import { mapCameraUvToCopyPixelInto } from './xrRawCameraService'
import { projectWorldPointIntoCameraUv } from './rgbDepthRegistrationService'
import type {
  M812SynchronizedRgbdKeyframe,
  M812SynchronizedRgbdSnapshot,
} from './m812SynchronizedRgbdCaptureService'

const DEFAULT_MAXIMUM_TRIANGLE_EDGE_METERS = 0.1
const DEFAULT_MAXIMUM_DEPTH_DISCONTINUITY_METERS = 0.022
const DEFAULT_DISPLACEMENT_METERS = 0.04
const DEFAULT_LONG_EDGE = 240

export interface M812RgbdProofOptions {
  readonly outputWidth?: number
  readonly outputHeight?: number
  readonly displacementMeters?: number
  readonly maximumTriangleEdgeMeters?: number
  readonly maximumDepthDiscontinuityMeters?: number
}

export interface M812ProofImage {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8ClampedArray
}

export interface M812ProofRasterDiagnostics {
  readonly visiblePixels: number
  readonly holePixels: number
  readonly overdrawAttempts: number
  readonly conflictingDepthSamples: number
  readonly pixelsByKeyframe: Readonly<Record<number, number>>
  readonly inventedPixels: number
}

export interface M812ProofRaster extends M812ProofImage {
  readonly depthMeters: Float32Array
  readonly sourceKeyframeIds: Int32Array
  readonly sourceRgbPixelIndices: Int32Array
  readonly sourceTriangleIds: Int32Array
  readonly diagnostics: M812ProofRasterDiagnostics
}

export interface M812RgbdProofDiagnostics {
  readonly synchronizationBasis: 'same-xr-frame-view-aligned'
  readonly sensorExposureSynchronization: 'not-guaranteed-by-webxr'
  readonly inputKeyframeCount: number
  readonly usedKeyframeCount: number
  readonly inputDepthSamples: number
  readonly validDepthSamples: number
  readonly rejectedDepthSamples: number
  readonly candidateTriangles: number
  readonly retainedMeasuredTriangles: number
  readonly trianglesRejectedInvalid: number
  readonly trianglesRejectedDepthDiscontinuity: number
  readonly trianglesRejectedEdgeLength: number
  readonly trianglesRejectedDegenerate: number
  readonly trianglesRejectedRgbMapping: number
  readonly sourceOwnedVisiblePixels: number
  readonly reprojectedVisiblePixels: number
  readonly oneKeyframeDisocclusionHoles: number
  readonly twoKeyframeDisocclusionHoles: number
  readonly overdrawAttempts: number
  readonly conflictingDepthSamples: number
  readonly pixelsSuppliedByKeyframe1: number
  readonly pixelsSuppliedByKeyframe2: number
  readonly inventedPixels: 0
  readonly geometryGenerationMs: number
  readonly sourceReprojectionMs: number
  readonly oneKeyframeReprojectionMs: number
  readonly twoKeyframeReprojectionMs: number
  readonly totalProofMs: number
}

export interface M812RgbdBrowserProof {
  readonly sourceCamera: M812ProofImage
  readonly depthDerivedGeometry: M812ProofImage
  readonly sourceMeasuredRgb: M812ProofRaster
  readonly displacedOneKeyframe: M812ProofRaster
  readonly displacedTwoKeyframe: M812ProofRaster
  /** Triangle id -> owning capture and three row-major source depth samples. */
  readonly triangleSourceKeyframeIds: Int32Array
  readonly triangleDepthSampleIndices: Int32Array
  readonly diagnostics: M812RgbdProofDiagnostics
}

interface MeasuredTriangle {
  readonly id: number
  readonly capture: M812SynchronizedRgbdKeyframe
  readonly sourceSampleIndices: readonly [number, number, number]
  readonly world: readonly [number, number, number, number, number, number, number, number, number]
  readonly sourcePixels: readonly [number, number, number, number, number, number]
}

interface GeometryDiagnostics {
  candidateTriangles: number
  rejectedInvalid: number
  rejectedDepthDiscontinuity: number
  rejectedEdgeLength: number
  rejectedDegenerate: number
  rejectedRgbMapping: number
  inputDepthSamples: number
  validDepthSamples: number
}

interface ProjectedVertex {
  x: number
  y: number
  inverseW: number
  depth: number
  sourceX: number
  sourceY: number
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax)
}

function squaredDistance(points: Float32Array, first: number, second: number): number {
  const a = first * 3, b = second * 3
  const x = points[a] - points[b], y = points[a + 1] - points[b + 1], z = points[a + 2] - points[b + 2]
  return x * x + y * y + z * z
}

function triangleAreaSquared(points: Float32Array, a: number, b: number, c: number): number {
  const ao = a * 3, bo = b * 3, co = c * 3
  const abx = points[bo] - points[ao], aby = points[bo + 1] - points[ao + 1], abz = points[bo + 2] - points[ao + 2]
  const acx = points[co] - points[ao], acy = points[co + 1] - points[ao + 1], acz = points[co + 2] - points[ao + 2]
  const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx
  return cx * cx + cy * cy + cz * cz
}

function createGeometryDiagnostics(): GeometryDiagnostics {
  return { candidateTriangles: 0, rejectedInvalid: 0, rejectedDepthDiscontinuity: 0, rejectedEdgeLength: 0,
    rejectedDegenerate: 0, rejectedRgbMapping: 0, inputDepthSamples: 0, validDepthSamples: 0 }
}

function buildMeasuredTriangles(
  capture: M812SynchronizedRgbdKeyframe,
  startId: number,
  maximumEdgeMeters: number,
  maximumDepthDiscontinuityMeters: number,
  diagnostics: GeometryDiagnostics,
): MeasuredTriangle[] {
  const triangles: MeasuredTriangle[] = []
  const { depth, rgbKeyframe } = capture
  const maximumEdgeSquared = maximumEdgeMeters * maximumEdgeMeters
  diagnostics.inputDepthSamples += depth.valid.length
  for (const value of depth.valid) if (value) diagnostics.validDepthSamples += 1
  const mapped = { x: 0, y: 0 }
  const append = (a: number, b: number, c: number): void => {
    diagnostics.candidateTriangles += 1
    if (!depth.valid[a] || !depth.valid[b] || !depth.valid[c]) { diagnostics.rejectedInvalid += 1; return }
    const da = depth.distancesMeters[a], db = depth.distancesMeters[b], dc = depth.distancesMeters[c]
    if (!Number.isFinite(da) || !Number.isFinite(db) || !Number.isFinite(dc) || da <= 0 || db <= 0 || dc <= 0) {
      diagnostics.rejectedInvalid += 1
      return
    }
    if (Math.max(da, db, dc) - Math.min(da, db, dc) > maximumDepthDiscontinuityMeters) {
      diagnostics.rejectedDepthDiscontinuity += 1
      return
    }
    if (squaredDistance(depth.worldPoints, a, b) > maximumEdgeSquared ||
      squaredDistance(depth.worldPoints, b, c) > maximumEdgeSquared ||
      squaredDistance(depth.worldPoints, c, a) > maximumEdgeSquared) {
      diagnostics.rejectedEdgeLength += 1
      return
    }
    if (triangleAreaSquared(depth.worldPoints, a, b, c) < 1e-12) { diagnostics.rejectedDegenerate += 1; return }
    const sourcePixels: number[] = []
    const projected = { u: 0, v: 0 }
    for (const index of [a, b, c]) {
      const pointOffset = index * 3
      if (!projectWorldPointIntoCameraUv(
        rgbKeyframe.inverseCameraTransform,
        rgbKeyframe.projectionMatrix,
        depth.worldPoints[pointOffset],
        depth.worldPoints[pointOffset + 1],
        depth.worldPoints[pointOffset + 2],
        projected,
      ) || !mapCameraUvToCopyPixelInto(rgbKeyframe.mapping, projected.u, projected.v, mapped)) {
        diagnostics.rejectedRgbMapping += 1
        return
      }
      sourcePixels.push(mapped.x, mapped.y)
    }
    const world = depth.worldPoints
    const ao = a * 3, bo = b * 3, co = c * 3
    triangles.push({
      id: startId + triangles.length,
      capture,
      sourceSampleIndices: [a, b, c],
      world: [world[ao], world[ao + 1], world[ao + 2], world[bo], world[bo + 1], world[bo + 2], world[co], world[co + 1], world[co + 2]],
      sourcePixels: sourcePixels as unknown as MeasuredTriangle['sourcePixels'],
    })
  }
  for (let row = 0; row + 1 < depth.rows; row += 1) for (let column = 0; column + 1 < depth.columns; column += 1) {
    const topLeft = row * depth.columns + column
    const topRight = topLeft + 1
    const bottomLeft = topLeft + depth.columns
    const bottomRight = bottomLeft + 1
    append(topLeft, topRight, bottomLeft)
    append(topRight, bottomRight, bottomLeft)
  }
  return triangles
}

function proofDimensions(keyframe: M812SynchronizedRgbdKeyframe, options: M812RgbdProofOptions): [number, number] {
  if (options.outputWidth && options.outputHeight) return [Math.max(1, Math.floor(options.outputWidth)), Math.max(1, Math.floor(options.outputHeight))]
  const { width, height } = keyframe.rgbKeyframe
  if (width >= height) return [DEFAULT_LONG_EDGE, Math.max(1, Math.round(DEFAULT_LONG_EDGE * height / Math.max(1, width)))]
  return [Math.max(1, Math.round(DEFAULT_LONG_EDGE * width / Math.max(1, height))), DEFAULT_LONG_EDGE]
}

function invertRigidTransform(matrix: Float32Array): Float32Array {
  const result = new Float32Array(16)
  result[0] = matrix[0]; result[1] = matrix[4]; result[2] = matrix[8]
  result[4] = matrix[1]; result[5] = matrix[5]; result[6] = matrix[9]
  result[8] = matrix[2]; result[9] = matrix[6]; result[10] = matrix[10]
  result[15] = 1
  const tx = matrix[12], ty = matrix[13], tz = matrix[14]
  result[12] = -(result[0] * tx + result[4] * ty + result[8] * tz)
  result[13] = -(result[1] * tx + result[5] * ty + result[9] * tz)
  result[14] = -(result[2] * tx + result[6] * ty + result[10] * tz)
  return result
}

function displacedView(capture: M812SynchronizedRgbdKeyframe, displacementMeters: number): Float32Array {
  const camera = new Float32Array(capture.rgbKeyframe.cameraTransform)
  camera[12] += camera[0] * displacementMeters
  camera[13] += camera[1] * displacementMeters
  camera[14] += camera[2] * displacementMeters
  return invertRigidTransform(camera)
}

function projectVertex(
  world: readonly number[],
  offset: number,
  sourcePixels: readonly number[],
  sourceOffset: number,
  view: Float32Array,
  projection: Float32Array,
  width: number,
  height: number,
): ProjectedVertex | null {
  const x = world[offset], y = world[offset + 1], z = world[offset + 2]
  const cx = view[0] * x + view[4] * y + view[8] * z + view[12]
  const cy = view[1] * x + view[5] * y + view[9] * z + view[13]
  const cz = view[2] * x + view[6] * y + view[10] * z + view[14]
  const cw = view[3] * x + view[7] * y + view[11] * z + view[15]
  const clipX = projection[0] * cx + projection[4] * cy + projection[8] * cz + projection[12] * cw
  const clipY = projection[1] * cx + projection[5] * cy + projection[9] * cz + projection[13] * cw
  const clipW = projection[3] * cx + projection[7] * cy + projection[11] * cz + projection[15] * cw
  const depth = -cz
  if (!Number.isFinite(clipX) || !Number.isFinite(clipY) || !Number.isFinite(clipW) || clipW <= 1e-7 || !Number.isFinite(depth) || depth <= 0) return null
  const ndcX = clipX / clipW, ndcY = clipY / clipW
  return {
    x: (ndcX * 0.5 + 0.5) * width - 0.5,
    y: (1 - (ndcY * 0.5 + 0.5)) * height - 0.5,
    inverseW: 1 / clipW,
    depth,
    sourceX: sourcePixels[sourceOffset],
    sourceY: sourcePixels[sourceOffset + 1],
  }
}

function rasterizeMeasuredTriangles(
  triangles: readonly MeasuredTriangle[],
  view: Float32Array,
  projection: Float32Array,
  width: number,
  height: number,
): M812ProofRaster {
  const pixelCount = width * height
  const rgba = new Uint8ClampedArray(pixelCount * 4)
  const depthMeters = new Float32Array(pixelCount); depthMeters.fill(Number.POSITIVE_INFINITY)
  const sourceKeyframeIds = new Int32Array(pixelCount); sourceKeyframeIds.fill(-1)
  const sourceRgbPixelIndices = new Int32Array(pixelCount); sourceRgbPixelIndices.fill(-1)
  const sourceTriangleIds = new Int32Array(pixelCount); sourceTriangleIds.fill(-1)
  const winnerQuality = new Float32Array(pixelCount); winnerQuality.fill(Number.NEGATIVE_INFINITY)
  let overdrawAttempts = 0, conflictingDepthSamples = 0
  for (const triangle of triangles) {
    const p0 = projectVertex(triangle.world, 0, triangle.sourcePixels, 0, view, projection, width, height)
    const p1 = projectVertex(triangle.world, 3, triangle.sourcePixels, 2, view, projection, width, height)
    const p2 = projectVertex(triangle.world, 6, triangle.sourcePixels, 4, view, projection, width, height)
    if (!p0 || !p1 || !p2) continue
    const signedArea = edge(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)
    if (Math.abs(signedArea) < 1e-8) continue
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)))
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)))
    const keyframe = triangle.capture.rgbKeyframe
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const sampleX = x + 0.5, sampleY = y + 0.5
      const b0 = edge(p1.x, p1.y, p2.x, p2.y, sampleX, sampleY) / signedArea
      const b1 = edge(p2.x, p2.y, p0.x, p0.y, sampleX, sampleY) / signedArea
      const b2 = 1 - b0 - b1
      if (b0 < -1e-5 || b1 < -1e-5 || b2 < -1e-5) continue
      const denominator = b0 * p0.inverseW + b1 * p1.inverseW + b2 * p2.inverseW
      if (denominator <= 0 || !Number.isFinite(denominator)) continue
      const candidateDepth = (b0 * p0.depth * p0.inverseW + b1 * p1.depth * p1.inverseW + b2 * p2.depth * p2.inverseW) / denominator
      const pixel = y * width + x
      if (Number.isFinite(depthMeters[pixel])) {
        overdrawAttempts += 1
        if (Math.abs(candidateDepth - depthMeters[pixel]) > DEFAULT_MAXIMUM_DEPTH_DISCONTINUITY_METERS) conflictingDepthSamples += 1
      }
      const depthDelta = candidateDepth - depthMeters[pixel]
      const wins = depthDelta < -1e-5 || (Math.abs(depthDelta) <= 1e-5 &&
        (keyframe.qualityScore > winnerQuality[pixel] ||
          (keyframe.qualityScore === winnerQuality[pixel] && keyframe.id < sourceKeyframeIds[pixel])))
      if (!wins) continue
      const sourceX = Math.min(keyframe.width - 1, Math.max(0, Math.round((b0 * p0.sourceX * p0.inverseW + b1 * p1.sourceX * p1.inverseW + b2 * p2.sourceX * p2.inverseW) / denominator)))
      const sourceY = Math.min(keyframe.height - 1, Math.max(0, Math.round((b0 * p0.sourceY * p0.inverseW + b1 * p1.sourceY * p1.inverseW + b2 * p2.sourceY * p2.inverseW) / denominator)))
      const sourcePixel = sourceY * keyframe.width + sourceX
      const sourceOffset = sourcePixel * 3, targetOffset = pixel * 4
      rgba[targetOffset] = keyframe.rgb[sourceOffset]
      rgba[targetOffset + 1] = keyframe.rgb[sourceOffset + 1]
      rgba[targetOffset + 2] = keyframe.rgb[sourceOffset + 2]
      rgba[targetOffset + 3] = 255
      depthMeters[pixel] = candidateDepth
      sourceKeyframeIds[pixel] = keyframe.id
      sourceRgbPixelIndices[pixel] = sourcePixel
      sourceTriangleIds[pixel] = triangle.id
      winnerQuality[pixel] = keyframe.qualityScore
    }
  }
  let visiblePixels = 0, inventedPixels = 0
  const pixelsByKeyframe: Record<number, number> = {}
  for (let pixel = 0; pixel < pixelCount; pixel += 1) if (rgba[pixel * 4 + 3] > 0) {
    visiblePixels += 1
    const keyframeId = sourceKeyframeIds[pixel]
    const sourcePixel = sourceRgbPixelIndices[pixel]
    const triangleId = sourceTriangleIds[pixel]
    if (keyframeId < 0 || sourcePixel < 0 || triangleId < 0) inventedPixels += 1
    pixelsByKeyframe[keyframeId] = (pixelsByKeyframe[keyframeId] ?? 0) + 1
  }
  return {
    width,
    height,
    rgba,
    depthMeters,
    sourceKeyframeIds,
    sourceRgbPixelIndices,
    sourceTriangleIds,
    diagnostics: {
      visiblePixels,
      holePixels: pixelCount - visiblePixels,
      overdrawAttempts,
      conflictingDepthSamples,
      pixelsByKeyframe,
      inventedPixels,
    },
  }
}

function downsampleSource(capture: M812SynchronizedRgbdKeyframe, width: number, height: number): M812ProofImage {
  const source = capture.rgbKeyframe
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(source.width - 1, Math.floor((x + 0.5) / width * source.width))
    const sourceY = Math.min(source.height - 1, Math.floor((y + 0.5) / height * source.height))
    const sourceOffset = (sourceY * source.width + sourceX) * 3, targetOffset = (y * width + x) * 4
    rgba[targetOffset] = source.rgb[sourceOffset]
    rgba[targetOffset + 1] = source.rgb[sourceOffset + 1]
    rgba[targetOffset + 2] = source.rgb[sourceOffset + 2]
    rgba[targetOffset + 3] = 255
  }
  return { width, height, rgba }
}

function depthVisualization(raster: M812ProofRaster): M812ProofImage {
  let minimum = Number.POSITIVE_INFINITY, maximum = Number.NEGATIVE_INFINITY
  for (const depth of raster.depthMeters) if (Number.isFinite(depth)) { minimum = Math.min(minimum, depth); maximum = Math.max(maximum, depth) }
  const span = Math.max(1e-6, maximum - minimum)
  const rgba = new Uint8ClampedArray(raster.rgba.length)
  for (let pixel = 0; pixel < raster.depthMeters.length; pixel += 1) {
    const depth = raster.depthMeters[pixel]
    if (!Number.isFinite(depth)) continue
    const t = (depth - minimum) / span, offset = pixel * 4
    rgba[offset] = Math.round(35 + 200 * t)
    rgba[offset + 1] = Math.round(220 - 120 * t)
    rgba[offset + 2] = Math.round(245 - 180 * t)
    rgba[offset + 3] = 255
  }
  return { width: raster.width, height: raster.height, rgba }
}

export function createM812SynchronizedRgbdBrowserProof(
  snapshot: M812SynchronizedRgbdSnapshot,
  options: M812RgbdProofOptions = {},
): M812RgbdBrowserProof {
  const totalStartedAt = now()
  if (snapshot.keyframes.length === 0) throw new Error('M8.12 proof requires at least one synchronized RGB-D keyframe.')
  const captures = snapshot.keyframes.slice(0, 2)
  const [width, height] = proofDimensions(captures[0], options)
  const maximumEdge = options.maximumTriangleEdgeMeters ?? DEFAULT_MAXIMUM_TRIANGLE_EDGE_METERS
  const maximumDepthDiscontinuity = options.maximumDepthDiscontinuityMeters ?? DEFAULT_MAXIMUM_DEPTH_DISCONTINUITY_METERS
  const geometryDiagnostics = createGeometryDiagnostics()
  const geometryStartedAt = now()
  const perCaptureTriangles: MeasuredTriangle[][] = []
  let triangleId = 0
  for (const capture of captures) {
    const built = buildMeasuredTriangles(capture, triangleId, maximumEdge, maximumDepthDiscontinuity, geometryDiagnostics)
    triangleId += built.length
    perCaptureTriangles.push(built)
  }
  const triangles = perCaptureTriangles.flat()
  const geometryGenerationMs = Math.max(0, now() - geometryStartedAt)
  const sourceStartedAt = now()
  const sourceMeasuredRgb = rasterizeMeasuredTriangles(perCaptureTriangles[0], captures[0].rgbKeyframe.inverseCameraTransform,
    captures[0].rgbKeyframe.projectionMatrix, width, height)
  const sourceReprojectionMs = Math.max(0, now() - sourceStartedAt)
  const novelView = displacedView(captures[0], options.displacementMeters ?? DEFAULT_DISPLACEMENT_METERS)
  const oneStartedAt = now()
  const displacedOneKeyframe = rasterizeMeasuredTriangles(perCaptureTriangles[0], novelView, captures[0].rgbKeyframe.projectionMatrix, width, height)
  const oneKeyframeReprojectionMs = Math.max(0, now() - oneStartedAt)
  const twoStartedAt = now()
  const displacedTwoKeyframe = rasterizeMeasuredTriangles(triangles, novelView, captures[0].rgbKeyframe.projectionMatrix, width, height)
  const twoKeyframeReprojectionMs = Math.max(0, now() - twoStartedAt)
  const triangleSourceKeyframeIds = new Int32Array(triangles.length)
  const triangleDepthSampleIndices = new Int32Array(triangles.length * 3)
  for (const triangle of triangles) {
    triangleSourceKeyframeIds[triangle.id] = triangle.capture.rgbKeyframe.id
    triangleDepthSampleIndices.set(triangle.sourceSampleIndices, triangle.id * 3)
  }
  const firstId = captures[0].rgbKeyframe.id, secondId = captures[1]?.rgbKeyframe.id
  const invented = sourceMeasuredRgb.diagnostics.inventedPixels + displacedOneKeyframe.diagnostics.inventedPixels + displacedTwoKeyframe.diagnostics.inventedPixels
  if (invented !== 0) throw new Error('M8.12 ownership invariant failed: a rendered pixel lacked measured source ownership.')
  return {
    sourceCamera: downsampleSource(captures[0], width, height),
    depthDerivedGeometry: depthVisualization(sourceMeasuredRgb),
    sourceMeasuredRgb,
    displacedOneKeyframe,
    displacedTwoKeyframe,
    triangleSourceKeyframeIds,
    triangleDepthSampleIndices,
    diagnostics: {
      synchronizationBasis: 'same-xr-frame-view-aligned',
      sensorExposureSynchronization: 'not-guaranteed-by-webxr',
      inputKeyframeCount: snapshot.keyframes.length,
      usedKeyframeCount: captures.length,
      inputDepthSamples: geometryDiagnostics.inputDepthSamples,
      validDepthSamples: geometryDiagnostics.validDepthSamples,
      rejectedDepthSamples: geometryDiagnostics.inputDepthSamples - geometryDiagnostics.validDepthSamples,
      candidateTriangles: geometryDiagnostics.candidateTriangles,
      retainedMeasuredTriangles: triangles.length,
      trianglesRejectedInvalid: geometryDiagnostics.rejectedInvalid,
      trianglesRejectedDepthDiscontinuity: geometryDiagnostics.rejectedDepthDiscontinuity,
      trianglesRejectedEdgeLength: geometryDiagnostics.rejectedEdgeLength,
      trianglesRejectedDegenerate: geometryDiagnostics.rejectedDegenerate,
      trianglesRejectedRgbMapping: geometryDiagnostics.rejectedRgbMapping,
      sourceOwnedVisiblePixels: sourceMeasuredRgb.diagnostics.visiblePixels,
      reprojectedVisiblePixels: displacedTwoKeyframe.diagnostics.visiblePixels,
      oneKeyframeDisocclusionHoles: displacedOneKeyframe.diagnostics.holePixels,
      twoKeyframeDisocclusionHoles: displacedTwoKeyframe.diagnostics.holePixels,
      overdrawAttempts: displacedTwoKeyframe.diagnostics.overdrawAttempts,
      conflictingDepthSamples: displacedTwoKeyframe.diagnostics.conflictingDepthSamples,
      pixelsSuppliedByKeyframe1: displacedTwoKeyframe.diagnostics.pixelsByKeyframe[firstId] ?? 0,
      pixelsSuppliedByKeyframe2: secondId === undefined ? 0 : displacedTwoKeyframe.diagnostics.pixelsByKeyframe[secondId] ?? 0,
      inventedPixels: 0,
      geometryGenerationMs,
      sourceReprojectionMs,
      oneKeyframeReprojectionMs,
      twoKeyframeReprojectionMs,
      totalProofMs: Math.max(0, now() - totalStartedAt),
    },
  }
}

export function getM812ProofTransferBuffers(proof: M812RgbdBrowserProof): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  const add = (array: ArrayBufferView): void => { if (array.buffer instanceof ArrayBuffer) buffers.add(array.buffer) }
  for (const image of [proof.sourceCamera, proof.depthDerivedGeometry, proof.sourceMeasuredRgb,
    proof.displacedOneKeyframe, proof.displacedTwoKeyframe]) add(image.rgba)
  for (const raster of [proof.sourceMeasuredRgb, proof.displacedOneKeyframe, proof.displacedTwoKeyframe]) {
    add(raster.depthMeters)
    add(raster.sourceKeyframeIds)
    add(raster.sourceRgbPixelIndices)
    add(raster.sourceTriangleIds)
  }
  add(proof.triangleSourceKeyframeIds)
  add(proof.triangleDepthSampleIndices)
  return [...buffers]
}

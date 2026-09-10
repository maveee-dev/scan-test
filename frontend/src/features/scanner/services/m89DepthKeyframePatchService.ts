import type {
  RetainedRealityMeasurementFrame,
  RetainedRealityMeasurementSnapshot,
} from './retainedRealityMeasurementService'

/**
 * Offline M8.9 prototype only.
 *
 * This service intentionally has no worker, renderer, UI, or XR integration.
 * The retained measurement contract contains source-grid samples and normals,
 * but it does not retain the camera projection/depth-keyframe matrices needed
 * for a screen-space atlas.  The prototype therefore emits conservative local
 * source-grid triangles whose vertices are always exact retained samples.
 */
export const M89_DEPTH_KEYFRAME_PATCH_CONFIG = Object.freeze({
  maximumTriangleEdgeMeters: 0.1,
  maximumDepthDiscontinuityMeters: 0.022,
  maximumPlaneResidualMeters: 0.028,
  minimumNormalDot: 0.9,
  minimumTriangleAreaSineSquared: 0.01,
  maximumOutputTriangles: 2_000_000,
  maximumOutputVertices: 800_000,
})

export type M89PatchRejectionReason =
  | 'accepted'
  | 'missingVertex'
  | 'normalDiscontinuity'
  | 'edgeTooLong'
  | 'depthDiscontinuity'
  | 'planeResidual'
  | 'degenerate'

export interface M89DepthKeyframePatch {
  readonly frameSequence: number
  readonly frameOrdinal: number
  readonly sourceSampleCount: number
  readonly usableSourceSampleCount: number
  readonly candidateQuadCount: number
  readonly observedQuadCount: number
  readonly acceptedQuadCount: number
  readonly triangleStart: number
  readonly triangleCount: number
  readonly vertexStart: number
  readonly vertexCount: number
}

export interface M89DepthKeyframePatchDiagnostics {
  readonly inputFrameCount: number
  readonly inputValidSourceSampleCount: number
  readonly usableSourceSampleCount: number
  readonly candidateQuadCount: number
  readonly observedQuadCount: number
  readonly acceptedQuadCount: number
  readonly emittedTriangleCount: number
  readonly emittedVertexCount: number
  readonly rejectedMissingVertexQuads: number
  readonly rejectedNormalDiscontinuityQuads: number
  readonly rejectedEdgeTooLongQuads: number
  readonly rejectedDepthDiscontinuityQuads: number
  readonly rejectedPlaneResidualQuads: number
  readonly rejectedDegenerateQuads: number
  readonly capacityRejectedQuads: number
  readonly maxObservedDepthSpanMeters: number
  readonly maxAcceptedDepthSpanMeters: number
  readonly maxAcceptedTriangleEdgeMeters: number
  readonly minimumAcceptedNormalDot: number
  readonly outputDepthMinMeters: number | null
  readonly outputDepthMaxMeters: number | null
  readonly sourceOwnershipViolations: number
  readonly inventedVertexCount: number
  readonly allOutputVerticesSourceOwned: boolean
  readonly packedArrayBytes: number
  readonly outputTriangleLimit: number
  readonly outputVertexLimit: number
  readonly screenSpaceCoverageAvailable: false
}

export interface M89DepthKeyframePatchResult {
  readonly vertices: {
    readonly positions: Float32Array
    readonly normals: Float32Array
    readonly sourceFrameSequences: Int32Array
    readonly sourceSampleIndices: Int32Array
  }
  readonly triangles: Uint32Array
  readonly patches: readonly M89DepthKeyframePatch[]
  readonly diagnostics: M89DepthKeyframePatchDiagnostics
}

interface Point3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

interface MutableNormal extends Point3 {}

interface EvaluatedQuad {
  readonly reason: M89PatchRejectionReason
  readonly points: readonly [Point3, Point3, Point3, Point3] | null
  readonly normals: readonly [MutableNormal, MutableNormal, MutableNormal, MutableNormal] | null
  readonly averageNormal: Point3 | null
  readonly maxDepthSpanMeters: number
  readonly maxPlaneResidualMeters: number
  readonly maxEdgeMeters: number
  readonly minimumNormalDot: number
}

const EMPTY_EVALUATED_QUAD: EvaluatedQuad = {
  reason: 'missingVertex',
  points: null,
  normals: null,
  averageNormal: null,
  maxDepthSpanMeters: 0,
  maxPlaneResidualMeters: 0,
  maxEdgeMeters: 0,
  minimumNormalDot: 0,
}

const isFinitePoint = (point: Point3): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)

const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z

const subtract = (a: Point3, b: Point3): Point3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
})

const add = (a: Point3, b: Point3): Point3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
})

const scale = (point: Point3, value: number): Point3 => ({
  x: point.x * value,
  y: point.y * value,
  z: point.z * value,
})

const lengthSquared = (point: Point3): number => dot(point, point)

const normalize = (point: Point3): Point3 | null => {
  const magnitudeSquared = lengthSquared(point)
  if (!Number.isFinite(magnitudeSquared) || magnitudeSquared <= 1e-12) {
    return null
  }
  return scale(point, 1 / Math.sqrt(magnitudeSquared))
}

const distance = (a: Point3, b: Point3): number => Math.sqrt(lengthSquared(subtract(a, b)))

const cross = (a: Point3, b: Point3): Point3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

const readPoint = (frame: RetainedRealityMeasurementFrame, index: number): Point3 | null => {
  const dense = frame.denseFrame
  if (index < 0 || index >= dense.valid.length || dense.valid[index] !== 1) {
    return null
  }
  const offset = index * 3
  const point = {
    x: dense.points[offset],
    y: dense.points[offset + 1],
    z: dense.points[offset + 2],
  }
  return isFinitePoint(point) ? point : null
}

const readNormal = (frame: RetainedRealityMeasurementFrame, index: number): MutableNormal | null => {
  const normals = frame.normals
  if (!normals || index < 0 || index >= frame.normalValid.length || frame.normalValid[index] !== 1) {
    return null
  }
  const offset = index * 3
  const normal = {
    x: normals[offset],
    y: normals[offset + 1],
    z: normals[offset + 2],
  }
  if (!isFinitePoint(normal) || lengthSquared(normal) <= 1e-12) {
    return null
  }
  return normal
}

const evaluateQuad = (
  frame: RetainedRealityMeasurementFrame,
  indices: readonly [number, number, number, number],
): EvaluatedQuad => {
  const points = indices.map((index) => readPoint(frame, index)) as [Point3 | null, Point3 | null, Point3 | null, Point3 | null]
  const normals = indices.map((index) => readNormal(frame, index)) as [
    MutableNormal | null,
    MutableNormal | null,
    MutableNormal | null,
    MutableNormal | null,
  ]
  if (points.some((point) => point === null) || normals.some((normal) => normal === null)) {
    return EMPTY_EVALUATED_QUAD
  }

  const completePoints = points as [Point3, Point3, Point3, Point3]
  const completeNormals = normals as [MutableNormal, MutableNormal, MutableNormal, MutableNormal]
  const averageNormal = normalize(
    completeNormals.reduce<Point3>((sum, normal) => add(sum, normalize(normal) ?? normal), {
      x: 0,
      y: 0,
      z: 0,
    }),
  )
  if (!averageNormal) {
    return {
      reason: 'normalDiscontinuity',
      points: completePoints,
      normals: completeNormals,
      averageNormal: null,
      maxDepthSpanMeters: 0,
      maxPlaneResidualMeters: 0,
      maxEdgeMeters: 0,
      minimumNormalDot: 0,
    }
  }

  let minimumNormalDot = 1
  for (let first = 0; first < completeNormals.length; first += 1) {
    const firstNormal = normalize(completeNormals[first])
    if (!firstNormal) {
      return {
        reason: 'normalDiscontinuity',
        points: completePoints,
        normals: completeNormals,
        averageNormal,
        maxDepthSpanMeters: 0,
        maxPlaneResidualMeters: 0,
        maxEdgeMeters: 0,
        minimumNormalDot: 0,
      }
    }
    for (let second = first + 1; second < completeNormals.length; second += 1) {
      const secondNormal = normalize(completeNormals[second])
      if (!secondNormal) {
        return {
          reason: 'normalDiscontinuity',
          points: completePoints,
          normals: completeNormals,
          averageNormal,
          maxDepthSpanMeters: 0,
          maxPlaneResidualMeters: 0,
          maxEdgeMeters: 0,
          minimumNormalDot: 0,
        }
      }
      minimumNormalDot = Math.min(minimumNormalDot, Math.abs(dot(firstNormal, secondNormal)))
    }
  }
  if (minimumNormalDot < M89_DEPTH_KEYFRAME_PATCH_CONFIG.minimumNormalDot) {
    return {
      reason: 'normalDiscontinuity',
      points: completePoints,
      normals: completeNormals,
      averageNormal,
      maxDepthSpanMeters: 0,
      maxPlaneResidualMeters: 0,
      maxEdgeMeters: 0,
      minimumNormalDot,
    }
  }

  let maxEdgeMeters = 0
  for (let first = 0; first < completePoints.length; first += 1) {
    for (let second = first + 1; second < completePoints.length; second += 1) {
      maxEdgeMeters = Math.max(maxEdgeMeters, distance(completePoints[first], completePoints[second]))
    }
  }
  if (maxEdgeMeters > M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumTriangleEdgeMeters) {
    return {
      reason: 'edgeTooLong',
      points: completePoints,
      normals: completeNormals,
      averageNormal,
      maxDepthSpanMeters: 0,
      maxPlaneResidualMeters: 0,
      maxEdgeMeters,
      minimumNormalDot,
    }
  }

  let maxDepthSpanMeters = 0
  let maxPlaneResidualMeters = 0
  const referencePoint = completePoints[0]
  for (const point of completePoints) {
    const signedOffset = dot(subtract(point, referencePoint), averageNormal)
    maxDepthSpanMeters = Math.max(maxDepthSpanMeters, signedOffset)
    maxPlaneResidualMeters = Math.max(maxPlaneResidualMeters, Math.abs(signedOffset))
  }
  const minimumDepthOffset = completePoints.reduce(
    (minimum, point) => Math.min(minimum, dot(subtract(point, referencePoint), averageNormal)),
    0,
  )
  maxDepthSpanMeters -= minimumDepthOffset
  if (maxDepthSpanMeters > M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumDepthDiscontinuityMeters) {
    return {
      reason: 'depthDiscontinuity',
      points: completePoints,
      normals: completeNormals,
      averageNormal,
      maxDepthSpanMeters,
      maxPlaneResidualMeters,
      maxEdgeMeters,
      minimumNormalDot,
    }
  }
  if (maxPlaneResidualMeters > M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumPlaneResidualMeters) {
    return {
      reason: 'planeResidual',
      points: completePoints,
      normals: completeNormals,
      averageNormal,
      maxDepthSpanMeters,
      maxPlaneResidualMeters,
      maxEdgeMeters,
      minimumNormalDot,
    }
  }

  const firstTriangleEdgeA = subtract(completePoints[1], completePoints[0])
  const firstTriangleEdgeB = subtract(completePoints[3], completePoints[0])
  const secondTriangleEdgeA = subtract(completePoints[3], completePoints[0])
  const secondTriangleEdgeB = subtract(completePoints[2], completePoints[0])
  const firstArea = lengthSquared(cross(firstTriangleEdgeA, firstTriangleEdgeB))
  const secondArea = lengthSquared(cross(secondTriangleEdgeA, secondTriangleEdgeB))
  const firstScale = lengthSquared(firstTriangleEdgeA) * lengthSquared(firstTriangleEdgeB)
  const secondScale = lengthSquared(secondTriangleEdgeA) * lengthSquared(secondTriangleEdgeB)
  if (
    firstScale <= 1e-12 ||
    secondScale <= 1e-12 ||
    firstArea <= firstScale * M89_DEPTH_KEYFRAME_PATCH_CONFIG.minimumTriangleAreaSineSquared ||
    secondArea <= secondScale * M89_DEPTH_KEYFRAME_PATCH_CONFIG.minimumTriangleAreaSineSquared
  ) {
    return {
      reason: 'degenerate',
      points: completePoints,
      normals: completeNormals,
      averageNormal,
      maxDepthSpanMeters,
      maxPlaneResidualMeters,
      maxEdgeMeters,
      minimumNormalDot,
    }
  }

  return {
    reason: 'accepted',
    points: completePoints,
    normals: completeNormals,
    averageNormal,
    maxDepthSpanMeters,
    maxPlaneResidualMeters,
    maxEdgeMeters,
    minimumNormalDot,
  }
}

const isTriangleWindingForward = (a: Point3, b: Point3, c: Point3, normal: Point3): boolean =>
  dot(cross(subtract(b, a), subtract(c, a)), normal) >= 0

const frameSourceSampleCount = (frame: RetainedRealityMeasurementFrame): number => frame.denseFrame.valid.length

const frameUsableSourceSampleCount = (frame: RetainedRealityMeasurementFrame): number => {
  let count = 0
  for (let index = 0; index < frame.denseFrame.valid.length; index += 1) {
    if (readPoint(frame, index) && readNormal(frame, index)) {
      count += 1
    }
  }
  return count
}

const frameInputValidSourceSampleCount = (frame: RetainedRealityMeasurementFrame): number => {
  let count = 0
  for (let index = 0; index < frame.denseFrame.valid.length; index += 1) {
    if (frame.denseFrame.valid[index] === 1 && readPoint(frame, index)) {
      count += 1
    }
  }
  return count
}

/**
 * Build an offline, source-owned patch atlas from retained measurement frames.
 * No vertex is synthesized, interpolated, merged across frames, or projected.
 */
export const buildM89DepthKeyframePatches = (
  snapshot: RetainedRealityMeasurementSnapshot,
): M89DepthKeyframePatchResult => {
  const orderedFrames = snapshot.frames
    .map((frame, frameOrdinal) => ({ frame, frameOrdinal }))
    .sort((first, second) => {
      if (first.frame.sequence !== second.frame.sequence) {
        return first.frame.sequence - second.frame.sequence
      }
      return first.frameOrdinal - second.frameOrdinal
    })

  const positions: number[] = []
  const normals: number[] = []
  const sourceFrameSequences: number[] = []
  const sourceSampleIndices: number[] = []
  const triangleIndices: number[] = []
  const patches: M89DepthKeyframePatch[] = []
  const frameBySequence = new Map<number, RetainedRealityMeasurementFrame>()

  let inputValidSourceSampleCount = 0
  let usableSourceSampleCount = 0
  let candidateQuadCount = 0
  let observedQuadCount = 0
  let acceptedQuadCount = 0
  let rejectedMissingVertexQuads = 0
  let rejectedNormalDiscontinuityQuads = 0
  let rejectedEdgeTooLongQuads = 0
  let rejectedDepthDiscontinuityQuads = 0
  let rejectedPlaneResidualQuads = 0
  let rejectedDegenerateQuads = 0
  let capacityRejectedQuads = 0
  let maxObservedDepthSpanMeters = 0
  let maxAcceptedDepthSpanMeters = 0
  let maxAcceptedTriangleEdgeMeters = 0
  let minimumAcceptedNormalDot = 1

  for (const { frame, frameOrdinal } of orderedFrames) {
    frameBySequence.set(frame.sequence, frame)
    inputValidSourceSampleCount += frameInputValidSourceSampleCount(frame)
    const frameUsableCount = frameUsableSourceSampleCount(frame)
    usableSourceSampleCount += frameUsableCount
    const sourceSampleCount = frameSourceSampleCount(frame)
    const columns = frame.denseFrame.columns
    const rows = frame.denseFrame.rows
    const sourceToVertex = new Int32Array(sourceSampleCount)
    sourceToVertex.fill(-1)
    const triangleStart = triangleIndices.length / 3
    const vertexStart = positions.length / 3
    let frameCandidateQuadCount = 0
    let frameObservedQuadCount = 0
    let frameAcceptedQuadCount = 0

    const ensureVertex = (sourceIndex: number, point: Point3, normal: MutableNormal): number => {
      const existingVertex = sourceToVertex[sourceIndex]
      if (existingVertex >= 0) {
        return existingVertex
      }
      const vertexIndex = positions.length / 3
      sourceToVertex[sourceIndex] = vertexIndex
      positions.push(point.x, point.y, point.z)
      normals.push(normal.x, normal.y, normal.z)
      sourceFrameSequences.push(frame.sequence)
      sourceSampleIndices.push(sourceIndex)
      return vertexIndex
    }

    if (columns >= 2 && rows >= 2) {
      for (let row = 0; row < rows - 1; row += 1) {
        for (let column = 0; column < columns - 1; column += 1) {
          const first = row * columns + column
          const second = first + 1
          const third = first + columns
          const fourth = third + 1
          if (fourth >= sourceSampleCount) {
            continue
          }
          candidateQuadCount += 1
          frameCandidateQuadCount += 1
          const evaluated = evaluateQuad(frame, [first, second, third, fourth])
          if (evaluated.reason === 'missingVertex') {
            rejectedMissingVertexQuads += 1
            continue
          }
          observedQuadCount += 1
          frameObservedQuadCount += 1
          maxObservedDepthSpanMeters = Math.max(maxObservedDepthSpanMeters, evaluated.maxDepthSpanMeters)
          if (evaluated.reason === 'normalDiscontinuity') {
            rejectedNormalDiscontinuityQuads += 1
            continue
          }
          if (evaluated.reason === 'edgeTooLong') {
            rejectedEdgeTooLongQuads += 1
            continue
          }
          if (evaluated.reason === 'depthDiscontinuity') {
            rejectedDepthDiscontinuityQuads += 1
            continue
          }
          if (evaluated.reason === 'planeResidual') {
            rejectedPlaneResidualQuads += 1
            continue
          }
          if (evaluated.reason === 'degenerate') {
            rejectedDegenerateQuads += 1
            continue
          }
          if (!evaluated.points || !evaluated.normals || !evaluated.averageNormal) {
            rejectedDegenerateQuads += 1
            continue
          }
          if (triangleIndices.length / 3 + 2 > M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumOutputTriangles) {
            capacityRejectedQuads += 1
            continue
          }
          let newVertexCount = 0
          for (const sourceIndex of [first, second, third, fourth]) {
            if (sourceToVertex[sourceIndex] < 0) {
              newVertexCount += 1
            }
          }
          if (positions.length / 3 + newVertexCount > M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumOutputVertices) {
            capacityRejectedQuads += 1
            continue
          }

          const sourcePointByIndex = new Map<number, Point3>()
          const sourceNormalByIndex = new Map<number, MutableNormal>()
          const quadIndices = [first, second, third, fourth]
          for (let pointIndex = 0; pointIndex < quadIndices.length; pointIndex += 1) {
            sourcePointByIndex.set(quadIndices[pointIndex], evaluated.points[pointIndex])
            sourceNormalByIndex.set(quadIndices[pointIndex], evaluated.normals[pointIndex])
          }
          const getVertex = (sourceIndex: number): number => {
            const point = sourcePointByIndex.get(sourceIndex)
            const normal = sourceNormalByIndex.get(sourceIndex)
            if (!point || !normal) {
              return -1
            }
            return ensureVertex(sourceIndex, point, normal)
          }
          const firstTriangle = [getVertex(first), getVertex(second), getVertex(fourth)]
          const secondTriangle = [getVertex(first), getVertex(fourth), getVertex(third)]
          if (firstTriangle.some((vertex) => vertex < 0) || secondTriangle.some((vertex) => vertex < 0)) {
            rejectedDegenerateQuads += 1
            continue
          }
          if (!isTriangleWindingForward(evaluated.points[0], evaluated.points[1], evaluated.points[3], evaluated.averageNormal)) {
            const temporary = firstTriangle[1]
            firstTriangle[1] = firstTriangle[2]
            firstTriangle[2] = temporary
          }
          if (!isTriangleWindingForward(evaluated.points[0], evaluated.points[3], evaluated.points[2], evaluated.averageNormal)) {
            const temporary = secondTriangle[1]
            secondTriangle[1] = secondTriangle[2]
            secondTriangle[2] = temporary
          }
          triangleIndices.push(
            firstTriangle[0],
            firstTriangle[1],
            firstTriangle[2],
            secondTriangle[0],
            secondTriangle[1],
            secondTriangle[2],
          )
          acceptedQuadCount += 1
          frameAcceptedQuadCount += 1
          maxAcceptedDepthSpanMeters = Math.max(maxAcceptedDepthSpanMeters, evaluated.maxDepthSpanMeters)
          maxAcceptedTriangleEdgeMeters = Math.max(maxAcceptedTriangleEdgeMeters, evaluated.maxEdgeMeters)
          minimumAcceptedNormalDot = Math.min(minimumAcceptedNormalDot, evaluated.minimumNormalDot)
        }
      }
    }
    patches.push({
      frameSequence: frame.sequence,
      frameOrdinal,
      sourceSampleCount,
      usableSourceSampleCount: frameUsableCount,
      candidateQuadCount: frameCandidateQuadCount,
      observedQuadCount: frameObservedQuadCount,
      acceptedQuadCount: frameAcceptedQuadCount,
      triangleStart,
      triangleCount: triangleIndices.length / 3 - triangleStart,
      vertexStart,
      vertexCount: positions.length / 3 - vertexStart,
    })
  }

  const packedPositions = new Float32Array(positions)
  const packedNormals = new Float32Array(normals)
  const packedSourceFrameSequences = new Int32Array(sourceFrameSequences)
  const packedSourceSampleIndices = new Int32Array(sourceSampleIndices)
  const packedTriangles = new Uint32Array(triangleIndices)
  let sourceOwnershipViolations = 0
  let outputDepthMinMeters: number | null = null
  let outputDepthMaxMeters: number | null = null
  for (let vertexIndex = 0; vertexIndex < packedSourceSampleIndices.length; vertexIndex += 1) {
    const frame = frameBySequence.get(packedSourceFrameSequences[vertexIndex])
    const sourceIndex = packedSourceSampleIndices[vertexIndex]
    const offset = vertexIndex * 3
    const sourceOffset = sourceIndex * 3
    const sourcePoint = frame && frame.denseFrame.points
    if (
      !frame ||
      sourceIndex < 0 ||
      sourceIndex >= frame.denseFrame.valid.length ||
      !sourcePoint ||
      packedPositions[offset] !== sourcePoint[sourceOffset] ||
      packedPositions[offset + 1] !== sourcePoint[sourceOffset + 1] ||
      packedPositions[offset + 2] !== sourcePoint[sourceOffset + 2]
    ) {
      sourceOwnershipViolations += 1
    }
    const depth = packedPositions[offset + 2]
    outputDepthMinMeters = outputDepthMinMeters === null ? depth : Math.min(outputDepthMinMeters, depth)
    outputDepthMaxMeters = outputDepthMaxMeters === null ? depth : Math.max(outputDepthMaxMeters, depth)
  }

  const packedArrayBytes =
    packedPositions.byteLength +
    packedNormals.byteLength +
    packedSourceFrameSequences.byteLength +
    packedSourceSampleIndices.byteLength +
    packedTriangles.byteLength
  const diagnostics: M89DepthKeyframePatchDiagnostics = {
    inputFrameCount: orderedFrames.length,
    inputValidSourceSampleCount,
    usableSourceSampleCount,
    candidateQuadCount,
    observedQuadCount,
    acceptedQuadCount,
    emittedTriangleCount: packedTriangles.length / 3,
    emittedVertexCount: packedSourceSampleIndices.length,
    rejectedMissingVertexQuads,
    rejectedNormalDiscontinuityQuads,
    rejectedEdgeTooLongQuads,
    rejectedDepthDiscontinuityQuads,
    rejectedPlaneResidualQuads,
    rejectedDegenerateQuads,
    capacityRejectedQuads,
    maxObservedDepthSpanMeters,
    maxAcceptedDepthSpanMeters,
    maxAcceptedTriangleEdgeMeters,
    minimumAcceptedNormalDot:
      acceptedQuadCount > 0 ? minimumAcceptedNormalDot : 0,
    outputDepthMinMeters,
    outputDepthMaxMeters,
    sourceOwnershipViolations,
    inventedVertexCount: sourceOwnershipViolations,
    allOutputVerticesSourceOwned: sourceOwnershipViolations === 0,
    packedArrayBytes,
    outputTriangleLimit: M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumOutputTriangles,
    outputVertexLimit: M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumOutputVertices,
    screenSpaceCoverageAvailable: false,
  }

  return {
    vertices: {
      positions: packedPositions,
      normals: packedNormals,
      sourceFrameSequences: packedSourceFrameSequences,
      sourceSampleIndices: packedSourceSampleIndices,
    },
    triangles: packedTriangles,
    patches,
    diagnostics,
  }
}

export const m89DepthKeyframePatchService = Object.freeze({
  build: buildM89DepthKeyframePatches,
})

import type {
  DenseDepthFrameObservation,
  DenseSpatialPointFrame,
  DepthFrameObservation,
  SpatialBounds,
  SpatialGeometrySource,
  SpatialPoint,
  SpatialPointObservation,
  SpatialPointDebug,
  SpatialPreviewStatus,
} from '../types'

const MIN_DEPTH_METERS = 0.05
const MAX_DEPTH_METERS = 20
const MATRIX_ELEMENT_COUNT = 16
const MATRIX_EPSILON = 1e-8

interface Vector4 {
  x: number
  y: number
  z: number
  w: number
}

function createEmptySpatialPointDebug(): SpatialPointDebug {
  return {
    previewStatus: 'idle',
    projectionSource: 'unavailable',
    transformSource: 'unavailable',
    currentValidPoints: 0,
    rejectedDepthSamples: 0,
    bounds: null,
    centerPoint: null,
    error: null,
  }
}

export function createInitialSpatialPointDebug(): SpatialPointDebug {
  return createEmptySpatialPointDebug()
}

function isUsableMatrix(matrix: Float32Array | null): matrix is Float32Array {
  if (!matrix || matrix.length !== MATRIX_ELEMENT_COUNT) {
    return false
  }

  return matrix.every((value) => Number.isFinite(value))
}

function invertMatrix(matrix: Float32Array): Float32Array | null {
  const a00 = matrix[0]
  const a01 = matrix[1]
  const a02 = matrix[2]
  const a03 = matrix[3]
  const a10 = matrix[4]
  const a11 = matrix[5]
  const a12 = matrix[6]
  const a13 = matrix[7]
  const a20 = matrix[8]
  const a21 = matrix[9]
  const a22 = matrix[10]
  const a23 = matrix[11]
  const a30 = matrix[12]
  const a31 = matrix[13]
  const a32 = matrix[14]
  const a33 = matrix[15]

  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32

  const determinant =
    b00 * b11 -
    b01 * b10 +
    b02 * b09 +
    b03 * b08 -
    b04 * b07 +
    b05 * b06

  if (!Number.isFinite(determinant) || Math.abs(determinant) <= MATRIX_EPSILON) {
    return null
  }

  const inverseDeterminant = 1 / determinant
  const inverse = new Float32Array(MATRIX_ELEMENT_COUNT)

  inverse[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant
  inverse[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * inverseDeterminant
  inverse[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant
  inverse[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * inverseDeterminant
  inverse[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * inverseDeterminant
  inverse[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant
  inverse[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * inverseDeterminant
  inverse[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant
  inverse[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant
  inverse[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * inverseDeterminant
  inverse[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant
  inverse[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * inverseDeterminant
  inverse[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * inverseDeterminant
  inverse[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant
  inverse[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * inverseDeterminant
  inverse[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant

  return isUsableMatrix(inverse) ? inverse : null
}

function multiplyMatrixAndVector(matrix: Float32Array, vector: Vector4): Vector4 {
  return {
    x:
      matrix[0] * vector.x +
      matrix[4] * vector.y +
      matrix[8] * vector.z +
      matrix[12] * vector.w,
    y:
      matrix[1] * vector.x +
      matrix[5] * vector.y +
      matrix[9] * vector.z +
      matrix[13] * vector.w,
    z:
      matrix[2] * vector.x +
      matrix[6] * vector.y +
      matrix[10] * vector.z +
      matrix[14] * vector.w,
    w:
      matrix[3] * vector.x +
      matrix[7] * vector.y +
      matrix[11] * vector.z +
      matrix[15] * vector.w,
  }
}

function getViewRay(
  inverseProjectionMatrix: Float32Array,
  normalizedX: number,
  normalizedY: number,
): SpatialPoint | null {
  const ndcX = 2 * normalizedX - 1
  const ndcY = 1 - 2 * normalizedY
  const nearPoint = multiplyMatrixAndVector(inverseProjectionMatrix, {
    x: ndcX,
    y: ndcY,
    z: -1,
    w: 1,
  })

  if (!Number.isFinite(nearPoint.w) || Math.abs(nearPoint.w) <= MATRIX_EPSILON) {
    return null
  }

  const ray = {
    x: nearPoint.x / nearPoint.w,
    y: nearPoint.y / nearPoint.w,
    z: nearPoint.z / nearPoint.w,
  }

  return Number.isFinite(ray.x) && Number.isFinite(ray.y) && Number.isFinite(ray.z)
    ? ray
    : null
}

function transformViewPoint(matrix: Float32Array, point: SpatialPoint): SpatialPoint | null {
  const transformed = multiplyMatrixAndVector(matrix, {
    ...point,
    w: 1,
  })

  if (!Number.isFinite(transformed.w) || Math.abs(transformed.w) <= MATRIX_EPSILON) {
    return null
  }

  const result = {
    x: transformed.x / transformed.w,
    y: transformed.y / transformed.w,
    z: transformed.z / transformed.w,
  }

  return Number.isFinite(result.x) && Number.isFinite(result.y) && Number.isFinite(result.z)
    ? result
    : null
}

function unprojectDepthSample(
  inverseProjectionMatrix: Float32Array,
  transformMatrix: Float32Array,
  normalizedX: number,
  normalizedY: number,
  depthMeters: number,
): SpatialPoint | null {
  if (!isValidNormalizedCoordinate(normalizedX) || !isValidNormalizedCoordinate(normalizedY)) {
    return null
  }

  if (!isValidDepth(depthMeters)) {
    return null
  }

  const rayView = getViewRay(inverseProjectionMatrix, normalizedX, normalizedY)
  if (!rayView || !Number.isFinite(rayView.z) || rayView.z >= -MATRIX_EPSILON) {
    return null
  }

  const scale = depthMeters / -rayView.z
  if (!Number.isFinite(scale) || scale <= 0) {
    return null
  }

  return transformViewPoint(transformMatrix, {
    x: rayView.x * scale,
    y: rayView.y * scale,
    z: rayView.z * scale,
  })
}

function isValidNormalizedCoordinate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function isValidDepth(depthMeters: number): boolean {
  return (
    Number.isFinite(depthMeters) &&
    depthMeters >= MIN_DEPTH_METERS &&
    depthMeters <= MAX_DEPTH_METERS
  )
}

function updateBounds(bounds: SpatialBounds | null, point: SpatialPoint): SpatialBounds {
  if (!bounds) {
    return {
      min: { ...point },
      max: { ...point },
    }
  }

  return {
    min: {
      x: Math.min(bounds.min.x, point.x),
      y: Math.min(bounds.min.y, point.y),
      z: Math.min(bounds.min.z, point.z),
    },
    max: {
      x: Math.max(bounds.max.x, point.x),
      y: Math.max(bounds.max.y, point.y),
      z: Math.max(bounds.max.z, point.z),
    },
  }
}

function selectMatrix(
  preferred: Float32Array | null,
  fallback: Float32Array | null,
): { matrix: Float32Array | null; source: SpatialGeometrySource } {
  if (isUsableMatrix(preferred)) {
    return { matrix: preferred, source: 'depth' }
  }

  if (isUsableMatrix(fallback)) {
    return { matrix: fallback, source: 'view' }
  }

  return { matrix: null, source: 'unavailable' }
}

/**
 * Converts a bounded current depth frame into points in the session's XR
 * reference space. No points are retained between frames.
 */
export class SpatialPointService {
  private diagnostics = createEmptySpatialPointDebug()

  public processFrame(
    observation: DepthFrameObservation | null,
  ): readonly SpatialPointObservation[] {
    if (!observation) {
      this.diagnostics = createEmptySpatialPointDebug()
      return []
    }

    const projection = selectMatrix(
      observation.depthProjectionMatrix,
      observation.viewProjectionMatrix,
    )
    const transform = selectMatrix(observation.depthTransformMatrix, observation.viewTransformMatrix)

    this.diagnostics = {
      ...createEmptySpatialPointDebug(),
      projectionSource: projection.source,
      transformSource: transform.source,
      rejectedDepthSamples: observation.requestedSampleCount,
    }

    if (!projection.matrix) {
      this.diagnostics.error = 'No valid projection matrix was available for depth unprojection.'
      return []
    }

    if (!transform.matrix) {
      this.diagnostics.error = 'No valid XR transform was available for depth points.'
      return []
    }

    const inverseProjectionMatrix = invertMatrix(projection.matrix)
    if (!inverseProjectionMatrix) {
      this.diagnostics.error = 'The depth projection matrix could not be inverted.'
      return []
    }

    const points: SpatialPointObservation[] = []
    let bounds: SpatialBounds | null = null
    let centerPoint: SpatialPoint | null = null
    let closestCenterDistance = Number.POSITIVE_INFINITY

    for (let index = 0; index < observation.sampleCount; index += 1) {
      const normalizedX = observation.normalizedX[index]
      const normalizedY = observation.normalizedY[index]
      const depthMeters = observation.distancesMeters[index]

      if (!isValidNormalizedCoordinate(normalizedX) || !isValidNormalizedCoordinate(normalizedY)) {
        continue
      }

      if (!isValidDepth(depthMeters)) {
        continue
      }

      const pointReference = unprojectDepthSample(
        inverseProjectionMatrix,
        transform.matrix,
        normalizedX,
        normalizedY,
        depthMeters,
      )
      if (!pointReference) {
        continue
      }

      points.push({
        normalizedX,
        normalizedY,
        depthMeters,
        point: pointReference,
      })
      bounds = updateBounds(bounds, pointReference)

      const centerDistance =
        (normalizedX - 0.5) ** 2 + (normalizedY - 0.5) ** 2
      if (centerDistance < closestCenterDistance) {
        closestCenterDistance = centerDistance
        centerPoint = { ...pointReference }
      }
    }

    this.diagnostics.currentValidPoints = points.length
    this.diagnostics.rejectedDepthSamples = Math.max(
      0,
      observation.rejectedSampleCount + observation.sampleCount - points.length,
    )
    this.diagnostics.bounds = bounds
    this.diagnostics.centerPoint = centerPoint

    return points
  }

  /** Converts a fixed dense depth grid while retaining invalid neighbor slots. */
  public processDenseFrame(observation: DenseDepthFrameObservation): DenseSpatialPointFrame {
    const sampleCount = observation.columns * observation.rows
    const points = new Float32Array(sampleCount * 3)
    const valid = new Uint8Array(sampleCount)
    const projection = selectMatrix(
      observation.depthProjectionMatrix,
      observation.viewProjectionMatrix,
    )
    const transform = selectMatrix(observation.depthTransformMatrix, observation.viewTransformMatrix)
    const inverseProjectionMatrix = projection.matrix ? invertMatrix(projection.matrix) : null

    if (!inverseProjectionMatrix || !transform.matrix) {
      return {
        columns: observation.columns,
        rows: observation.rows,
        valid,
        normalizedX: observation.normalizedX,
        normalizedY: observation.normalizedY,
        distancesMeters: observation.distancesMeters,
        points,
        attemptedSampleCount: observation.attemptedSampleCount,
        validPointCount: 0,
        rejectedPointCount: observation.attemptedSampleCount,
      }
    }

    let validPointCount = 0
    for (let index = 0; index < sampleCount; index += 1) {
      if (observation.valid[index] !== 1) {
        continue
      }

      const point = unprojectDepthSample(
        inverseProjectionMatrix,
        transform.matrix,
        observation.normalizedX[index],
        observation.normalizedY[index],
        observation.distancesMeters[index],
      )
      if (!point) {
        continue
      }

      valid[index] = 1
      points[index * 3] = point.x
      points[index * 3 + 1] = point.y
      points[index * 3 + 2] = point.z
      validPointCount += 1
    }

    return {
      columns: observation.columns,
      rows: observation.rows,
      valid,
      normalizedX: observation.normalizedX,
      normalizedY: observation.normalizedY,
      distancesMeters: observation.distancesMeters,
      points,
      attemptedSampleCount: observation.attemptedSampleCount,
      validPointCount,
      rejectedPointCount: observation.attemptedSampleCount - validPointCount,
    }
  }

  public getDiagnostics(previewStatus: SpatialPreviewStatus): SpatialPointDebug {
    return {
      ...this.diagnostics,
      previewStatus,
      bounds: this.diagnostics.bounds
        ? {
            min: { ...this.diagnostics.bounds.min },
            max: { ...this.diagnostics.bounds.max },
          }
        : null,
      centerPoint: this.diagnostics.centerPoint ? { ...this.diagnostics.centerPoint } : null,
    }
  }

  public reset(): void {
    this.diagnostics = createEmptySpatialPointDebug()
  }
}

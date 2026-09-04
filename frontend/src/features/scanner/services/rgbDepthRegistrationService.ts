import type {
  DenseCoverageMesh,
  DenseSpatialPointFrame,
  RawCameraCopyFrame,
  RgbDepthRegistrationDebug,
  RgbDepthValidationSample,
  SpatialPoint,
} from '../types'
import {
  XRRawCameraService,
  type RawCameraPixelSample,
} from './xrRawCameraService'

const BYTES_PER_RGBD_VERTEX = 7
const MAX_VALIDATION_SAMPLES = 6
const MAX_PAIRING_AGE_MS = 125

interface CameraProjection {
  u: number
  v: number
}

function getTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function createInitialDiagnostics(): RgbDepthRegistrationDebug {
  return {
    status: 'idle',
    pairingStatus: 'unavailable',
    samplesAttempted: 0,
    samplesProjected: 0,
    samplesOutsideCamera: 0,
    invalidProjections: 0,
    samplesSuccessfullyColored: 0,
    staleCameraRejects: 0,
    cameraBufferMisses: 0,
    successPercentage: 0,
    registrationMs: 0,
    projectionMs: 0,
    rgbLookupMs: 0,
    cameraCopySequence: null,
    cameraCopyTimestamp: null,
    depthProcessingTimestamp: null,
    validationSamples: [],
  }
}

export function createInitialRgbDepthRegistrationDebug(): RgbDepthRegistrationDebug {
  return createInitialDiagnostics()
}

function projectWorldPointInto(
  view: XRView,
  x: number,
  y: number,
  z: number,
  target: CameraProjection,
): boolean {
  const viewMatrix = view.transform.inverse.matrix
  const cameraX = viewMatrix[0] * x + viewMatrix[4] * y + viewMatrix[8] * z + viewMatrix[12]
  const cameraY = viewMatrix[1] * x + viewMatrix[5] * y + viewMatrix[9] * z + viewMatrix[13]
  const cameraZ = viewMatrix[2] * x + viewMatrix[6] * y + viewMatrix[10] * z + viewMatrix[14]
  const cameraW = viewMatrix[3] * x + viewMatrix[7] * y + viewMatrix[11] * z + viewMatrix[15]
  if (
    !Number.isFinite(cameraX) ||
    !Number.isFinite(cameraY) ||
    !Number.isFinite(cameraZ) ||
    !Number.isFinite(cameraW) ||
    cameraZ >= 0
  ) {
    return false
  }

  const projectionMatrix = view.projectionMatrix
  const clipX = projectionMatrix[0] * cameraX + projectionMatrix[4] * cameraY + projectionMatrix[8] * cameraZ + projectionMatrix[12]
  const clipY = projectionMatrix[1] * cameraX + projectionMatrix[5] * cameraY + projectionMatrix[9] * cameraZ + projectionMatrix[13]
  const clipW = projectionMatrix[3] * cameraX + projectionMatrix[7] * cameraY + projectionMatrix[11] * cameraZ + projectionMatrix[15]
  if (!Number.isFinite(clipX) || !Number.isFinite(clipY) || !Number.isFinite(clipW) || clipW <= Number.EPSILON) {
    return false
  }

  const ndcX = clipX / clipW
  const ndcY = clipY / clipW
  const u = (ndcX + 1) / 2
  const v = (1 - ndcY) / 2
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    return false
  }

  target.u = u
  target.v = v
  return true
}

function createValidationSample(
  point: SpatialPoint,
  projection: CameraProjection,
  pixel: RawCameraPixelSample,
): RgbDepthValidationSample {
  return {
    world: { x: point.x, y: point.y, z: point.z },
    cameraU: projection.u,
    cameraV: projection.v,
    copyX: pixel.x,
    copyY: pixel.y,
    red: pixel.red,
    green: pixel.green,
    blue: pixel.blue,
  }
}

/**
 * Associates current dense world-space depth samples with the current
 * application-owned camera copy. It does not persist colors or alter scan
 * geometry.
 */
export class RgbDepthRegistrationService {
  private readonly rawCameraService: XRRawCameraService

  private vertexData = new Float32Array(80 * 45 * BYTES_PER_RGBD_VERTEX)

  private revision = 0

  private diagnostics: RgbDepthRegistrationDebug = createInitialDiagnostics()

  private readonly pointScratch: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly projectionScratch: CameraProjection = { u: 0, v: 0 }

  private readonly pixelScratch: RawCameraPixelSample = {
    x: 0,
    y: 0,
    red: 0,
    green: 0,
    blue: 0,
  }

  constructor(rawCameraService: XRRawCameraService) {
    this.rawCameraService = rawCameraService
  }

  public process(
    denseFrame: DenseSpatialPointFrame,
    view: XRView,
    cameraFrame: RawCameraCopyFrame | null,
    depthTimestamp: number,
    cameraAvailable: boolean,
  ): DenseCoverageMesh {
    const registrationStartedAt = getTimestamp()
    const attempted = denseFrame.validPointCount
    this.diagnostics = {
      ...createInitialDiagnostics(),
      samplesAttempted: attempted,
      depthProcessingTimestamp: depthTimestamp,
    }

    if (!cameraAvailable) {
      this.diagnostics.status = 'unavailable'
      this.diagnostics.pairingStatus = 'unavailable'
      this.diagnostics.cameraBufferMisses = attempted > 0 ? attempted : 0
      this.diagnostics.successPercentage = 0
      this.diagnostics.registrationMs = Math.max(0, getTimestamp() - registrationStartedAt)
      return this.createMesh(0)
    }

    if (
      !cameraFrame ||
      !Number.isFinite(cameraFrame.timestamp) ||
      Math.abs(cameraFrame.timestamp - depthTimestamp) > MAX_PAIRING_AGE_MS
    ) {
      this.diagnostics.status = 'active'
      this.diagnostics.pairingStatus = 'stale'
      this.diagnostics.staleCameraRejects = attempted > 0 ? attempted : 0
      this.diagnostics.registrationMs = Math.max(0, getTimestamp() - registrationStartedAt)
      return this.createMesh(0)
    }

    this.diagnostics.status = 'active'
    this.diagnostics.pairingStatus = 'same-frame'
    this.diagnostics.cameraCopySequence = cameraFrame.sequence
    this.diagnostics.cameraCopyTimestamp = cameraFrame.timestamp
    const projectionStartedAt = getTimestamp()
    let coloredCount = 0
    const validationSamples: RgbDepthValidationSample[] = []
    let rgbLookupDurationMs = 0

    for (let index = 0; index < denseFrame.valid.length; index += 1) {
      if (denseFrame.valid[index] !== 1) {
        continue
      }

      const pointOffset = index * 3
      this.pointScratch.x = denseFrame.points[pointOffset]
      this.pointScratch.y = denseFrame.points[pointOffset + 1]
      this.pointScratch.z = denseFrame.points[pointOffset + 2]
      const point = this.pointScratch
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z)
      ) {
        this.diagnostics.invalidProjections += 1
        continue
      }

      if (!projectWorldPointInto(view, point.x, point.y, point.z, this.projectionScratch)) {
        this.diagnostics.invalidProjections += 1
        continue
      }
      const projection = this.projectionScratch

      if (
        projection.u < 0 ||
        projection.u > 1 ||
        projection.v < 0 ||
        projection.v > 1
      ) {
        this.diagnostics.samplesOutsideCamera += 1
        continue
      }
      this.diagnostics.samplesProjected += 1

      const lookupStartedAt = getTimestamp()
      const hasPixel = this.rawCameraService.sampleCopiedRgbInto(
        cameraFrame,
        projection.u,
        projection.v,
        this.pixelScratch,
      )
      rgbLookupDurationMs += Math.max(0, getTimestamp() - lookupStartedAt)
      if (!hasPixel) {
        this.diagnostics.cameraBufferMisses += 1
        continue
      }
      const pixel = this.pixelScratch

      const vertexOffset = coloredCount * BYTES_PER_RGBD_VERTEX
      this.ensureCapacity(vertexOffset + BYTES_PER_RGBD_VERTEX)
      this.vertexData[vertexOffset] = point.x
      this.vertexData[vertexOffset + 1] = point.y
      this.vertexData[vertexOffset + 2] = point.z
      this.vertexData[vertexOffset + 3] = pixel.red / 255
      this.vertexData[vertexOffset + 4] = pixel.green / 255
      this.vertexData[vertexOffset + 5] = pixel.blue / 255
      this.vertexData[vertexOffset + 6] = 1
      coloredCount += 1

      if (validationSamples.length < MAX_VALIDATION_SAMPLES) {
        validationSamples.push(createValidationSample(point, projection, pixel))
      }
    }

    this.diagnostics.projectionMs = Math.max(
      0,
      getTimestamp() - projectionStartedAt - rgbLookupDurationMs,
    )
    this.diagnostics.rgbLookupMs = rgbLookupDurationMs
    this.diagnostics.samplesSuccessfullyColored = coloredCount
    this.diagnostics.successPercentage = attempted > 0 ? (coloredCount / attempted) * 100 : 0
    this.diagnostics.validationSamples = validationSamples
    this.diagnostics.registrationMs = Math.max(0, getTimestamp() - registrationStartedAt)
    return this.createMesh(coloredCount)
  }

  /** Records an eligible dense tick without replacing the last valid debug mesh. */
  public recordStaleFrame(sampleCount: number, depthTimestamp: number): void {
    this.diagnostics.status = 'active'
    this.diagnostics.pairingStatus = 'stale'
    this.diagnostics.samplesAttempted = sampleCount
    this.diagnostics.samplesProjected = 0
    this.diagnostics.samplesOutsideCamera = 0
    this.diagnostics.invalidProjections = 0
    this.diagnostics.samplesSuccessfullyColored = 0
    this.diagnostics.staleCameraRejects = sampleCount
    this.diagnostics.cameraBufferMisses = 0
    this.diagnostics.successPercentage = 0
    this.diagnostics.depthProcessingTimestamp = depthTimestamp
    this.diagnostics.registrationMs = 0
    this.diagnostics.projectionMs = 0
    this.diagnostics.rgbLookupMs = 0
    this.diagnostics.validationSamples = []
  }

  public getDiagnostics(): RgbDepthRegistrationDebug {
    return {
      ...this.diagnostics,
      validationSamples: this.diagnostics.validationSamples.map((sample) => ({
        ...sample,
        world: { ...sample.world },
      })),
    }
  }

  public reset(): void {
    this.revision = 0
    this.diagnostics = createInitialDiagnostics()
    this.vertexData.fill(0)
  }

  private ensureCapacity(requiredFloats: number): void {
    if (requiredFloats <= this.vertexData.length) {
      return
    }

    const nextCapacity = Math.max(requiredFloats, this.vertexData.length * 2)
    const nextData = new Float32Array(nextCapacity)
    nextData.set(this.vertexData)
    this.vertexData = nextData
  }

  private createMesh(vertexCount: number): DenseCoverageMesh {
    this.revision += 1
    return {
      revision: this.revision,
      vertexData: this.vertexData.subarray(0, vertexCount * BYTES_PER_RGBD_VERTEX),
      vertexCount,
    }
  }
}

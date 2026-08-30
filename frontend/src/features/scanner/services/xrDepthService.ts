import type {
  DenseDepthFrameObservation,
  DepthDataType,
  DepthFrameObservation,
  DepthSample,
  DepthSampleLabel,
  DepthUsage,
  XRDepthAcquisitionDiagnostics,
  XRDepthDebug,
  XRDepthException,
  XRDepthSessionDiagnostics,
} from '../types'

const DEPTH_PROBE_FRAME_LIMIT = 30
export const DEPTH_GRID_COLUMNS = 16
export const DEPTH_GRID_ROWS = 9
const DEPTH_GRID_SAMPLE_COUNT = DEPTH_GRID_COLUMNS * DEPTH_GRID_ROWS

interface DepthSamplePoint {
  label: DepthSampleLabel
  xRatio: number
  yRatio: number
}

interface PropertyReadResult<T> {
  value: T | undefined
  error: XRDepthException | null
}

type DepthSampler = (x: number, y: number) => number

const DEPTH_SAMPLE_POINTS: DepthSamplePoint[] = [
  { label: 'center', xRatio: 0.5, yRatio: 0.5 },
  { label: 'upper', xRatio: 0.5, yRatio: 0.25 },
  { label: 'lower', xRatio: 0.5, yRatio: 0.75 },
  { label: 'left', xRatio: 0.25, yRatio: 0.5 },
  { label: 'right', xRatio: 0.75, yRatio: 0.5 },
]

function createEmptySamples(): DepthSample[] {
  return DEPTH_SAMPLE_POINTS.map(({ label }) => ({
    label,
    distanceMeters: null,
  }))
}

function createEmptySessionDiagnostics(): XRDepthSessionDiagnostics {
  return {
    usage: null,
    dataFormat: 'unknown',
    active: null,
    usageError: null,
    dataFormatError: null,
    activeError: null,
  }
}

function createEmptyAcquisitionDiagnostics(): XRDepthAcquisitionDiagnostics {
  return {
    status: 'not-attempted',
    error: null,
  }
}

function createEmptyFrameObservation(): DepthFrameObservation {
  return {
    sampleCount: 0,
    requestedSampleCount: DEPTH_GRID_SAMPLE_COUNT,
    rejectedSampleCount: DEPTH_GRID_SAMPLE_COUNT,
    normalizedX: new Float32Array(DEPTH_GRID_SAMPLE_COUNT),
    normalizedY: new Float32Array(DEPTH_GRID_SAMPLE_COUNT),
    distancesMeters: new Float32Array(DEPTH_GRID_SAMPLE_COUNT),
    depthProjectionMatrix: null,
    depthTransformMatrix: null,
    viewProjectionMatrix: null,
    viewTransformMatrix: null,
  }
}

export function createInitialDepthDebug(): XRDepthDebug {
  return {
    status: 'idle',
    dataType: 'unknown',
    width: null,
    height: null,
    validFrameCount: 0,
    samples: createEmptySamples(),
    rawValueToMeters: null,
    session: createEmptySessionDiagnostics(),
    acquisition: createEmptyAcquisitionDiagnostics(),
    metadataError: null,
    rawValueToMetersError: null,
    sampleError: null,
    samplingError: null,
    gridSampleError: null,
    geometryError: null,
    error: null,
  }
}

function createException(error: unknown, fallbackName: string, fallbackMessage: string): XRDepthException {
  if (error instanceof Error) {
    return {
      name: error.name || fallbackName,
      message: error.message || fallbackMessage,
    }
  }

  if (typeof error === 'object' && error !== null) {
    const errorRecord = error as { name?: unknown; message?: unknown }
    return {
      name: typeof errorRecord.name === 'string' ? errorRecord.name : fallbackName,
      message: typeof errorRecord.message === 'string' ? errorRecord.message : fallbackMessage,
    }
  }

  return {
    name: fallbackName,
    message: fallbackMessage,
  }
}

function readProperty<T>(read: () => T): PropertyReadResult<T> {
  try {
    return { value: read(), error: null }
  } catch (error) {
    return {
      value: undefined,
      error: createException(error, 'DepthPropertyError', 'The XR depth property could not be read.'),
    }
  }
}

function getDepthDataType(dataFormat: XRDepthDataFormat | undefined): DepthDataType {
  switch (dataFormat) {
    case 'float32':
    case 'luminance-alpha':
    case 'unsigned-short':
      return dataFormat
    default:
      return 'unknown'
  }
}

function getDepthUsage(usage: XRDepthUsage | undefined): DepthUsage | null {
  switch (usage) {
    case 'cpu-optimized':
    case 'gpu-optimized':
      return usage
    default:
      return null
  }
}

function isValidNormalizedCoordinate(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function isValidDistance(distance: number): boolean {
  return Number.isFinite(distance) && distance > 0
}

function isValidResolution(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0
}

function isValidScale(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}

function copyMatrix(matrix: Float32Array | undefined): Float32Array | null {
  if (!matrix) {
    return null
  }

  try {
    return new Float32Array(matrix)
  } catch {
    return null
  }
}

function formatSampleCoordinateError(samplePoint: DepthSamplePoint): XRDepthException {
  return {
    name: 'InvalidCoordinateError',
    message: `The ${samplePoint.label} depth sample coordinate is outside the normalized 0–1 range.`,
  }
}

/**
 * Reads runtime-selected CPU depth metadata and a small set of normalized
 * samples. It does not traverse the depth buffer or build world-space data.
 */
export class XRDepthService {
  private session: XRSession | null = null

  private diagnostics = createInitialDepthDebug()

  private probeFrameCount = 0

  private lastDepthFrame: XRFrame | null = null

  private lastDepthView: XRView | null = null

  private lastDepthInformation: XRCPUDepthInformation | null = null

  private lastDepthSampler: DepthSampler | null = null

  public initialize(session: XRSession): void {
    this.session = session
    this.probeFrameCount = 0
    this.diagnostics = createInitialDepthDebug()
    this.readSessionDiagnostics(session)
  }

  public inspectFrame(frame: XRFrame, view: XRView): DepthFrameObservation | null {
    const session = this.session
    if (!session || this.diagnostics.status === 'idle' || this.diagnostics.status === 'unavailable') {
      return null
    }

    if (this.diagnostics.session.usage === 'gpu-optimized') {
      this.clearLastDepthFrame()
      this.diagnostics.status = 'gpu-selected'
      this.diagnostics.acquisition = {
        status: 'not-attempted',
        error: null,
      }
      return null
    }

    this.probeFrameCount += 1

    if (typeof frame.getDepthInformation !== 'function') {
      this.clearLastDepthFrame()
      this.diagnostics.status = 'unavailable'
      this.diagnostics.acquisition = {
        status: 'unsupported',
        error: null,
      }
      return null
    }

    let depthInformation: XRCPUDepthInformation | null | undefined
    try {
      depthInformation = frame.getDepthInformation(view)
    } catch (error) {
      this.clearLastDepthFrame()
      this.diagnostics.status = 'error'
      this.diagnostics.acquisition = {
        status: 'threw',
        error: createException(
          error,
          'DepthInformationError',
          'getDepthInformation(view) threw an exception.',
        ),
      }
      this.diagnostics.error = 'Depth information acquisition failed.'
      return null
    }

    if (!depthInformation) {
      this.clearLastDepthFrame()
      this.diagnostics.acquisition = {
        status: 'null',
        error: null,
      }
      this.markUnavailableIfNotGranted()
      return null
    }

    this.diagnostics.acquisition = {
      status: 'available',
      error: null,
    }

    const widthResult = readProperty(() => depthInformation.width)
    const heightResult = readProperty(() => depthInformation.height)
    const rawValueToMetersResult = readProperty(() => depthInformation.rawValueToMeters)

    this.diagnostics.rawValueToMetersError = rawValueToMetersResult.error
    this.diagnostics.rawValueToMeters = isValidScale(rawValueToMetersResult.value)
      ? rawValueToMetersResult.value
      : null

    if (widthResult.error || heightResult.error) {
      this.clearLastDepthFrame()
      this.diagnostics.metadataError = widthResult.error ?? heightResult.error
      this.diagnostics.status = 'error'
      this.diagnostics.error = 'XR depth metadata could not be read.'
      return null
    }

    if (!isValidResolution(widthResult.value) || !isValidResolution(heightResult.value)) {
      this.clearLastDepthFrame()
      this.diagnostics.metadataError = {
        name: 'InvalidDepthMetadata',
        message: 'XR returned an invalid depth width or height.',
      }
      this.diagnostics.status = 'error'
      this.diagnostics.error = 'XR depth metadata was invalid.'
      return null
    }

    this.diagnostics.width = widthResult.value
    this.diagnostics.height = heightResult.value
    this.diagnostics.validFrameCount += 1
    this.diagnostics.metadataError = null
    this.diagnostics.error = null
    this.diagnostics.status = 'active'

    const depthSamplerResult = readProperty(() => depthInformation.getDepthInMeters)
    if (depthSamplerResult.error || typeof depthSamplerResult.value !== 'function') {
      this.clearLastDepthFrame()
      this.diagnostics.samplingError = depthSamplerResult.error ?? {
        name: 'DepthSamplingUnsupported',
        message: 'XR depth information did not expose getDepthInMeters().',
      }
      this.diagnostics.error = 'XR depth samples could not be read.'
      return this.createFrameObservation(depthInformation, view)
    }

    this.diagnostics.samplingError = null
    const depthSampler = depthSamplerResult.value.bind(depthInformation)
    this.lastDepthFrame = frame
    this.lastDepthView = view
    this.lastDepthInformation = depthInformation
    this.lastDepthSampler = depthSampler
    this.readDepthSamples(depthSampler)
    return this.createFrameObservation(
      depthInformation,
      view,
      depthSampler,
    )
  }

  public getDiagnostics(): XRDepthDebug {
    return {
      ...this.diagnostics,
      session: { ...this.diagnostics.session },
      acquisition: { ...this.diagnostics.acquisition },
      samples: this.diagnostics.samples.map((sample) => ({ ...sample })),
      sampleError: this.diagnostics.sampleError
        ? {
            label: this.diagnostics.sampleError.label,
            error: { ...this.diagnostics.sampleError.error },
          }
        : null,
    }
  }

  /**
   * Samples a fixed, dense layout from the CPU depth information acquired for
   * the current XR frame. It intentionally does not create another frame loop.
   */
  public inspectDenseFrame(
    frame: XRFrame,
    view: XRView,
    columns: number,
    rows: number,
  ): DenseDepthFrameObservation | null {
    if (
      this.diagnostics.session.usage !== 'cpu-optimized' ||
      !this.lastDepthSampler ||
      !this.lastDepthInformation ||
      this.lastDepthFrame !== frame ||
      this.lastDepthView !== view ||
      !Number.isInteger(columns) ||
      !Number.isInteger(rows) ||
      columns < 2 ||
      rows < 2
    ) {
      return null
    }

    const attemptedSampleCount = columns * rows
    const valid = new Uint8Array(attemptedSampleCount)
    const normalizedX = new Float32Array(attemptedSampleCount)
    const normalizedY = new Float32Array(attemptedSampleCount)
    const distancesMeters = new Float32Array(attemptedSampleCount)
    let validSampleCount = 0
    let rejectedSampleCount = 0

    for (let row = 0; row < rows; row += 1) {
      const y = (row + 0.5) / rows
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column
        const x = (column + 0.5) / columns
        normalizedX[index] = x
        normalizedY[index] = y

        try {
          const distance = this.lastDepthSampler(x, y)
          if (isValidDistance(distance)) {
            valid[index] = 1
            distancesMeters[index] = distance
            validSampleCount += 1
          } else {
            rejectedSampleCount += 1
          }
        } catch {
          rejectedSampleCount += 1
        }
      }
    }

    const depthInformation = this.lastDepthInformation
    if (!depthInformation) {
      return null
    }

    const depthProjectionResult = readProperty(() => depthInformation.projectionMatrix)
    const depthTransformResult = readProperty(() => depthInformation.transform?.matrix)
    const viewProjectionResult = readProperty(() => view.projectionMatrix)
    const viewTransformResult = readProperty(() => view.transform.matrix)

    return {
      columns,
      rows,
      attemptedSampleCount,
      validSampleCount,
      rejectedSampleCount,
      valid,
      normalizedX,
      normalizedY,
      distancesMeters,
      depthProjectionMatrix: copyMatrix(depthProjectionResult.value),
      depthTransformMatrix: copyMatrix(depthTransformResult.value),
      viewProjectionMatrix: copyMatrix(viewProjectionResult.value),
      viewTransformMatrix: copyMatrix(viewTransformResult.value),
    }
  }

  public dispose(): void {
    this.session = null
    this.probeFrameCount = 0
    this.clearLastDepthFrame()
    this.diagnostics = createInitialDepthDebug()
  }

  private clearLastDepthFrame(): void {
    this.lastDepthFrame = null
    this.lastDepthView = null
    this.lastDepthInformation = null
    this.lastDepthSampler = null
  }

  private readSessionDiagnostics(session: XRSession): void {
    const usageResult = readProperty(() => session.depthUsage)
    const dataFormatResult = readProperty(() => session.depthDataFormat)
    const activeResult = readProperty(() => session.depthActive)
    const usage = getDepthUsage(usageResult.value)
    const dataFormat = getDepthDataType(dataFormatResult.value)
    const active = typeof activeResult.value === 'boolean' ? activeResult.value : null

    this.diagnostics.session = {
      usage,
      dataFormat,
      active,
      usageError: usageResult.error,
      dataFormatError: dataFormatResult.error,
      activeError: activeResult.error,
    }
    this.diagnostics.dataType = dataFormat

    if (active === false) {
      this.diagnostics.status = 'unavailable'
    } else if (usage === 'gpu-optimized') {
      this.diagnostics.status = 'gpu-selected'
    } else if (active === true || usage === 'cpu-optimized' || dataFormat !== 'unknown') {
      this.diagnostics.status = 'active'
    } else {
      this.diagnostics.status = 'requesting'
    }
  }

  private readDepthSamples(depthSampler: DepthSampler): void {
    this.diagnostics.samples = createEmptySamples()
    this.diagnostics.sampleError = null

    for (const [index, samplePoint] of DEPTH_SAMPLE_POINTS.entries()) {
      if (
        !isValidNormalizedCoordinate(samplePoint.xRatio) ||
        !isValidNormalizedCoordinate(samplePoint.yRatio)
      ) {
        this.diagnostics.sampleError = {
          label: samplePoint.label,
          error: formatSampleCoordinateError(samplePoint),
        }
        continue
      }

      try {
        const distance = depthSampler(samplePoint.xRatio, samplePoint.yRatio)
        this.diagnostics.samples[index].distanceMeters = isValidDistance(distance) ? distance : null
      } catch (error) {
        this.diagnostics.sampleError = {
          label: samplePoint.label,
          error: createException(
            error,
            'DepthSampleError',
            `The ${samplePoint.label} depth sample could not be read.`,
          ),
        }
      }
    }
  }

  private createFrameObservation(
    depthInformation: XRCPUDepthInformation,
    view: XRView,
    depthSampler?: DepthSampler,
  ): DepthFrameObservation {
    const observation = createEmptyFrameObservation()
    const depthProjectionResult = readProperty(() => depthInformation.projectionMatrix)
    const depthTransformResult = readProperty(() => depthInformation.transform?.matrix)
    const viewProjectionResult = readProperty(() => view.projectionMatrix)
    const viewTransformResult = readProperty(() => view.transform.matrix)

    observation.depthProjectionMatrix = copyMatrix(depthProjectionResult.value)
    observation.depthTransformMatrix = copyMatrix(depthTransformResult.value)
    observation.viewProjectionMatrix = copyMatrix(viewProjectionResult.value)
    observation.viewTransformMatrix = copyMatrix(viewTransformResult.value)

    this.diagnostics.geometryError =
      depthProjectionResult.error ??
      depthTransformResult.error ??
      viewProjectionResult.error ??
      viewTransformResult.error

    if (!depthSampler) {
      this.diagnostics.gridSampleError = null
      return observation
    }

    this.diagnostics.gridSampleError = null
    let sampleIndex = 0
    let rejectedSampleCount = 0

    for (let row = 0; row < DEPTH_GRID_ROWS; row += 1) {
      const y = row / (DEPTH_GRID_ROWS - 1)
      for (let column = 0; column < DEPTH_GRID_COLUMNS; column += 1) {
        const x = column / (DEPTH_GRID_COLUMNS - 1)

        try {
          const distance = depthSampler(x, y)
          if (isValidDistance(distance)) {
            observation.normalizedX[sampleIndex] = x
            observation.normalizedY[sampleIndex] = y
            observation.distancesMeters[sampleIndex] = distance
            observation.sampleCount += 1
            sampleIndex += 1
          } else {
            rejectedSampleCount += 1
          }
        } catch (error) {
          rejectedSampleCount += 1
          this.diagnostics.gridSampleError = createException(
            error,
            'DepthGridSampleError',
            'A spatial depth-grid sample could not be read.',
          )
        }
      }
    }

    observation.rejectedSampleCount = rejectedSampleCount
    return observation
  }

  private markUnavailableIfNotGranted(): void {
    if (
      this.diagnostics.session.active === false ||
      (this.diagnostics.status === 'requesting' &&
        this.probeFrameCount >= DEPTH_PROBE_FRAME_LIMIT)
    ) {
      this.diagnostics.status = 'unavailable'
    }
  }
}

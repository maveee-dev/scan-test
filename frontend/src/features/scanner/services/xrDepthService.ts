import type {
  DepthDataType,
  DepthSample,
  DepthSampleLabel,
  DepthUsage,
  XRDepthAcquisitionDiagnostics,
  XRDepthDebug,
  XRDepthException,
  XRDepthSessionDiagnostics,
} from '../types'

const DEPTH_PROBE_FRAME_LIMIT = 30

interface DepthSamplePoint {
  label: DepthSampleLabel
  xRatio: number
  yRatio: number
}

interface PropertyReadResult<T> {
  value: T | undefined
  error: XRDepthException | null
}

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

  public initialize(session: XRSession): void {
    this.session = session
    this.probeFrameCount = 0
    this.diagnostics = createInitialDepthDebug()
    this.readSessionDiagnostics(session)
  }

  public inspectFrame(frame: XRFrame, view: XRView): void {
    const session = this.session
    if (!session || this.diagnostics.status === 'idle' || this.diagnostics.status === 'unavailable') {
      return
    }

    if (this.diagnostics.session.usage === 'gpu-optimized') {
      this.diagnostics.status = 'gpu-selected'
      this.diagnostics.acquisition = {
        status: 'not-attempted',
        error: null,
      }
      return
    }

    this.probeFrameCount += 1

    if (typeof frame.getDepthInformation !== 'function') {
      this.diagnostics.status = 'unavailable'
      this.diagnostics.acquisition = {
        status: 'unsupported',
        error: null,
      }
      return
    }

    let depthInformation: XRCPUDepthInformation | null | undefined
    try {
      depthInformation = frame.getDepthInformation(view)
    } catch (error) {
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
      return
    }

    if (!depthInformation) {
      this.diagnostics.acquisition = {
        status: 'null',
        error: null,
      }
      this.markUnavailableIfNotGranted()
      return
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
      this.diagnostics.metadataError = widthResult.error ?? heightResult.error
      this.diagnostics.status = 'error'
      this.diagnostics.error = 'XR depth metadata could not be read.'
      return
    }

    if (!isValidResolution(widthResult.value) || !isValidResolution(heightResult.value)) {
      this.diagnostics.metadataError = {
        name: 'InvalidDepthMetadata',
        message: 'XR returned an invalid depth width or height.',
      }
      this.diagnostics.status = 'error'
      this.diagnostics.error = 'XR depth metadata was invalid.'
      return
    }

    this.diagnostics.width = widthResult.value
    this.diagnostics.height = heightResult.value
    this.diagnostics.validFrameCount += 1
    this.diagnostics.metadataError = null
    this.diagnostics.error = null
    this.diagnostics.status = 'active'

    this.readDepthSamples(depthInformation)
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

  public dispose(): void {
    this.session = null
    this.probeFrameCount = 0
    this.diagnostics = createInitialDepthDebug()
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

  private readDepthSamples(depthInformation: XRCPUDepthInformation): void {
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
        const distance = depthInformation.getDepthInMeters(
          samplePoint.xRatio,
          samplePoint.yRatio,
        )
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

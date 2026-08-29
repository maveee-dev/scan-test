import type {
  DepthDataType,
  DepthSample,
  DepthSampleLabel,
  XRDepthDebug,
} from '../types'

const DEPTH_PROBE_FRAME_LIMIT = 30

interface DepthSamplePoint {
  label: DepthSampleLabel
  xRatio: number
  yRatio: number
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

export function createInitialDepthDebug(): XRDepthDebug {
  return {
    status: 'idle',
    dataType: 'unknown',
    width: null,
    height: null,
    validFrameCount: 0,
    samples: createEmptySamples(),
    error: null,
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

function isValidDistance(distance: number): boolean {
  return Number.isFinite(distance) && distance > 0
}

/**
 * Reads a small set of CPU depth samples from the current XR view.
 * It deliberately does not build a point cloud or traverse the depth buffer.
 */
export class XRDepthService {
  private session: XRSession | null = null

  private diagnostics = createInitialDepthDebug()

  private probeFrameCount = 0

  public initialize(session: XRSession): void {
    this.session = session
    this.probeFrameCount = 0
    this.diagnostics = createInitialDepthDebug()
    this.diagnostics.dataType = getDepthDataType(session.depthDataFormat)

    if (session.depthActive === false) {
      this.diagnostics.status = 'unavailable'
      return
    }

    const depthWasGranted =
      session.depthActive === true ||
      session.depthUsage !== undefined ||
      session.depthDataFormat !== undefined

    this.diagnostics.status = depthWasGranted ? 'active' : 'requesting'
  }

  public inspectFrame(frame: XRFrame, view: XRView): void {
    const session = this.session
    if (
      !session ||
      this.diagnostics.status === 'idle' ||
      this.diagnostics.status === 'unavailable' ||
      this.diagnostics.status === 'error'
    ) {
      return
    }

    this.probeFrameCount += 1

    const getDepthInformation = frame.getDepthInformation
    if (typeof getDepthInformation !== 'function') {
      this.diagnostics.status = 'unavailable'
      return
    }

    let depthInformation: XRCPUDepthInformation | null | undefined
    try {
      depthInformation = getDepthInformation.call(frame, view)
    } catch {
      this.markUnavailableIfNotGranted(session)
      return
    }

    if (!depthInformation) {
      this.markUnavailableIfNotGranted(session)
      return
    }

    if (
      !Number.isInteger(depthInformation.width) ||
      depthInformation.width <= 0 ||
      !Number.isInteger(depthInformation.height) ||
      depthInformation.height <= 0
    ) {
      this.diagnostics.status = 'error'
      this.diagnostics.error = 'XR returned an invalid depth resolution.'
      return
    }

    if (typeof depthInformation.getDepthInMeters !== 'function') {
      this.diagnostics.status = 'unavailable'
      return
    }

    try {
      this.diagnostics.samples = DEPTH_SAMPLE_POINTS.map((samplePoint) => {
        const x = Math.min(
          depthInformation.width - 1,
          Math.max(0, Math.floor(samplePoint.xRatio * depthInformation.width)),
        )
        const y = Math.min(
          depthInformation.height - 1,
          Math.max(0, Math.floor(samplePoint.yRatio * depthInformation.height)),
        )
        const distance = depthInformation.getDepthInMeters(x, y)

        return {
          label: samplePoint.label,
          distanceMeters: isValidDistance(distance) ? distance : null,
        }
      })
    } catch {
      this.diagnostics.status = 'error'
      this.diagnostics.error = 'XR depth samples could not be read.'
      return
    }

    this.diagnostics.status = 'active'
    this.diagnostics.width = depthInformation.width
    this.diagnostics.height = depthInformation.height
    this.diagnostics.validFrameCount += 1
    this.diagnostics.error = null
  }

  public getDiagnostics(): XRDepthDebug {
    return {
      ...this.diagnostics,
      samples: this.diagnostics.samples.map((sample) => ({ ...sample })),
    }
  }

  public dispose(): void {
    this.session = null
    this.probeFrameCount = 0
    this.diagnostics = createInitialDepthDebug()
  }

  private markUnavailableIfNotGranted(session: XRSession): void {
    if (
      session.depthActive === false ||
      (this.diagnostics.status === 'requesting' &&
        this.probeFrameCount >= DEPTH_PROBE_FRAME_LIMIT)
    ) {
      this.diagnostics.status = 'unavailable'
    }
  }
}

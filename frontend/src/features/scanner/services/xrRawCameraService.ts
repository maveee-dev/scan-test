import type {
  RawCameraCapabilityReason,
  RawCameraCapabilityState,
  RawCameraCopyStatus,
  RawCameraDebug,
  RawCameraOrientation,
  RawCameraPreview,
} from '../types'
import type {
  XRPresentationRenderTarget,
  XRWebGLContext,
} from './xrPresentationService'

const COPY_WIDTH = 160
const COPY_HEIGHT = 90
const READBACK_SAMPLE_CAPACITY = 32
const TARGET_ASPECT = COPY_WIDTH / COPY_HEIGHT

const FULLSCREEN_TRIANGLE = new Float32Array([
  -1, -1,
  3, -1,
  -1, 3,
])

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
uniform vec4 uSourceCrop;
varying vec2 vCameraUv;

void main() {
  vec2 outputUv = aPosition * 0.5 + 0.5;
  vCameraUv = uSourceCrop.xy + outputUv * uSourceCrop.zw;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;
uniform sampler2D uCameraImage;
uniform int uOrientation;
varying vec2 vCameraUv;

vec2 orient(vec2 uv) {
  if (uOrientation == 1) {
    return vec2(uv.x, 1.0 - uv.y);
  }
  if (uOrientation == 2) {
    return vec2(1.0 - uv.x, uv.y);
  }
  if (uOrientation == 3) {
    return vec2(1.0 - uv.x, 1.0 - uv.y);
  }
  return uv;
}

void main() {
  gl_FragColor = texture2D(uCameraImage, orient(vCameraUv));
}
`

interface RawCameraDiagnosticsState {
  status: RawCameraCapabilityState
  reason: RawCameraCapabilityReason | null
  requested: boolean
  enabledFeature: boolean | null
  bindingAvailable: boolean
  viewCameraAvailable: boolean
  sourceWidth: number | null
  sourceHeight: number | null
  textureAvailable: boolean
  copyStatus: RawCameraCopyStatus
  copyWidth: number
  copyHeight: number
  successfulCopyCount: number
  failedCopyCount: number
  skippedCopyCount: number
  lastCopyTimestamp: number | null
  acquisitionMs: number
  shaderCopyMs: number
  readPixelsMs: number
  totalProbeMs: number
  readbackP95Ms: number
  frameSignature: number | null
  changedSincePreviousCopy: boolean | null
  orientation: RawCameraOrientation
  preview: RawCameraPreview | null
}

function getTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function createShader(
  gl: XRWebGLContext,
  shaderType: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(shaderType)
  if (!shader) {
    throw new Error('Raw camera shader creation failed.')
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'Raw camera shader compilation failed.'
    gl.deleteShader(shader)
    throw new Error(info)
  }

  return shader
}

function createProgram(gl: XRWebGLContext): WebGLProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
  let fragmentShader: WebGLShader | null = null
  let program: WebGLProgram | null = null

  try {
    fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
    program = gl.createProgram()
    if (!program) {
      throw new Error('Raw camera shader program creation failed.')
    }
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'Raw camera shader linking failed.')
    }
    return program
  } catch (error) {
    if (program) {
      gl.deleteProgram(program)
    }
    throw error
  } finally {
    gl.deleteShader(vertexShader)
    if (fragmentShader) {
      gl.deleteShader(fragmentShader)
    }
  }
}

function createInitialDiagnostics(): RawCameraDiagnosticsState {
  return {
    status: 'not-requested',
    reason: null,
    requested: false,
    enabledFeature: null,
    bindingAvailable: false,
    viewCameraAvailable: false,
    sourceWidth: null,
    sourceHeight: null,
    textureAvailable: false,
    copyStatus: 'idle',
    copyWidth: COPY_WIDTH,
    copyHeight: COPY_HEIGHT,
    successfulCopyCount: 0,
    failedCopyCount: 0,
    skippedCopyCount: 0,
    lastCopyTimestamp: null,
    acquisitionMs: 0,
    shaderCopyMs: 0,
    readPixelsMs: 0,
    totalProbeMs: 0,
    readbackP95Ms: 0,
    frameSignature: null,
    changedSincePreviousCopy: null,
    orientation: 'upright',
    preview: null,
  }
}

export function createInitialRawCameraDebug(): RawCameraDebug {
  return { ...createInitialDiagnostics() }
}

function getOrientationIndex(orientation: RawCameraOrientation): number {
  switch (orientation) {
    case 'vertical-flipped':
      return 1
    case 'horizontal-mirrored':
      return 2
    case 'rotated-180':
      return 3
    default:
      return 0
  }
}

function getSourceCrop(sourceWidth: number, sourceHeight: number): [number, number, number, number] {
  const sourceAspect = sourceWidth / sourceHeight
  if (sourceAspect > TARGET_ASPECT) {
    const cropWidth = TARGET_ASPECT / sourceAspect
    return [(1 - cropWidth) / 2, 0, cropWidth, 1]
  }

  const cropHeight = sourceAspect / TARGET_ASPECT
  return [0, (1 - cropHeight) / 2, 1, cropHeight]
}

function calculateSignature(readback: Uint8Array): number {
  let signature = 2166136261
  const stride = Math.max(4, Math.floor(readback.length / 256))
  for (let index = 0; index < readback.length; index += stride) {
    signature ^= readback[index]
    signature = Math.imul(signature, 16777619)
  }
  return signature >>> 0
}

function calculateP95(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

/**
 * Probes Raw Camera Access without retaining the browser-owned camera texture.
 * All camera texture access is performed by copyFrame inside the XR callback.
 */
export class XRRawCameraService {
  private session: XRSession | null = null

  private gl: XRWebGLContext | null = null

  private binding: XRWebGLBinding | null = null

  private outputTexture: WebGLTexture | null = null

  private outputFramebuffer: WebGLFramebuffer | null = null

  private fullscreenBuffer: WebGLBuffer | null = null

  private program: WebGLProgram | null = null

  private positionAttribute = -1

  private sourceCropUniform: WebGLUniformLocation | null = null

  private cameraImageUniform: WebGLUniformLocation | null = null

  private orientationUniform: WebGLUniformLocation | null = null

  private readback = new Uint8Array(COPY_WIDTH * COPY_HEIGHT * 4)

  private readonly readbackDurations: number[] = []

  private diagnostics: RawCameraDiagnosticsState = createInitialDiagnostics()

  public initialize(session: XRSession, target: XRPresentationRenderTarget | null): void {
    this.dispose()
    this.session = session
    this.diagnostics = createInitialDiagnostics()
    this.diagnostics.requested = true
    this.diagnostics.status = 'requested'

    const enabledFeatures = session.enabledFeatures
    if (enabledFeatures) {
      this.diagnostics.enabledFeature = enabledFeatures.includes('camera-access')
      if (!this.diagnostics.enabledFeature) {
        this.diagnostics.status = 'not-granted'
        this.diagnostics.reason = 'feature-not-enabled'
        return
      }
    }

    if (!target || typeof XRWebGLBinding === 'undefined') {
      this.diagnostics.status = 'error'
      this.diagnostics.reason = target ? 'api-missing' : 'binding-unavailable'
      return
    }

    try {
      this.gl = target.gl
      this.binding = new XRWebGLBinding(session, target.gl)
      this.diagnostics.bindingAvailable = true
      this.createCopyResources()
      this.diagnostics.status = 'available'
    } catch {
      this.diagnostics.status = 'error'
      this.diagnostics.reason = 'binding-unavailable'
      this.disposeResources()
      this.gl = null
      this.binding = null
    }
  }

  public setOrientation(orientation: RawCameraOrientation): void {
    this.diagnostics.orientation = orientation
  }

  public recordSkipped(): void {
    this.diagnostics.copyStatus = 'skipped'
    this.diagnostics.skippedCopyCount += 1
  }

  /** Must be called only from the active XR requestAnimationFrame callback. */
  public copyFrame(frame: XRFrame, view: XRView, includePreview: boolean): boolean {
    if (
      this.session === null ||
      this.gl === null ||
      this.binding === null ||
      this.program === null ||
      this.outputTexture === null ||
      this.outputFramebuffer === null ||
      this.fullscreenBuffer === null ||
      frame.session !== this.session
    ) {
      this.recordSkipped()
      return false
    }

    const totalStartedAt = getTimestamp()
    const camera = view.camera
    this.diagnostics.viewCameraAvailable = camera !== null && camera !== undefined
    this.diagnostics.textureAvailable = false
    if (!camera) {
      this.diagnostics.status = 'error'
      this.diagnostics.reason = 'view-camera-null'
      this.diagnostics.copyStatus = 'skipped'
      this.diagnostics.skippedCopyCount += 1
      this.diagnostics.totalProbeMs = Math.max(0, getTimestamp() - totalStartedAt)
      return false
    }

    const sourceWidth = camera.width
    const sourceHeight = camera.height
    if (
      !Number.isFinite(sourceWidth) ||
      !Number.isFinite(sourceHeight) ||
      sourceWidth <= 0 ||
      sourceHeight <= 0
    ) {
      this.diagnostics.reason = 'camera-texture-null'
      this.diagnostics.copyStatus = 'skipped'
      this.diagnostics.skippedCopyCount += 1
      this.diagnostics.totalProbeMs = Math.max(0, getTimestamp() - totalStartedAt)
      return false
    }

    this.diagnostics.sourceWidth = sourceWidth
    this.diagnostics.sourceHeight = sourceHeight

    let cameraTexture: WebGLTexture | null = null
    let acquisitionFailed = false
    const acquisitionStartedAt = getTimestamp()
    try {
      cameraTexture = this.binding.getCameraImage(camera)
    } catch {
      acquisitionFailed = true
      this.diagnostics.reason = 'camera-texture-null'
    }
    this.diagnostics.acquisitionMs = Math.max(0, getTimestamp() - acquisitionStartedAt)
    this.diagnostics.textureAvailable = cameraTexture !== null
    if (!cameraTexture) {
      this.diagnostics.status = 'error'
      this.diagnostics.copyStatus = acquisitionFailed ? 'failed' : 'skipped'
      if (acquisitionFailed) {
        this.diagnostics.failedCopyCount += 1
      } else {
        this.diagnostics.skippedCopyCount += 1
      }
      this.diagnostics.totalProbeMs = Math.max(0, getTimestamp() - totalStartedAt)
      return false
    }

    const copyStartedAt = getTimestamp()
    let previousState: ReturnType<XRRawCameraService['captureGlState']> | null = null
    try {
      previousState = this.captureGlState()
      const { gl } = this
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFramebuffer)
      gl.viewport(0, 0, COPY_WIDTH, COPY_HEIGHT)
      gl.disable(gl.BLEND)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)
      gl.disable(gl.SCISSOR_TEST)
      gl.colorMask(true, true, true, true)
      gl.depthMask(false)
      gl.useProgram(this.program)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, cameraTexture)
      gl.uniform1i(this.cameraImageUniform, 0)
      const crop = getSourceCrop(sourceWidth, sourceHeight)
      gl.uniform4f(this.sourceCropUniform, crop[0], crop[1], crop[2], crop[3])
      gl.uniform1i(this.orientationUniform, getOrientationIndex(this.diagnostics.orientation))
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer)
      gl.enableVertexAttribArray(this.positionAttribute)
      gl.vertexAttribPointer(this.positionAttribute, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.diagnostics.shaderCopyMs = Math.max(0, getTimestamp() - copyStartedAt)

      const readbackStartedAt = getTimestamp()
      gl.readPixels(0, 0, COPY_WIDTH, COPY_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, this.readback)
      this.diagnostics.readPixelsMs = Math.max(0, getTimestamp() - readbackStartedAt)
      this.readbackDurations.push(this.diagnostics.readPixelsMs)
      if (this.readbackDurations.length > READBACK_SAMPLE_CAPACITY) {
        this.readbackDurations.shift()
      }

      const signature = calculateSignature(this.readback)
      this.diagnostics.changedSincePreviousCopy =
        this.diagnostics.frameSignature !== null && this.diagnostics.frameSignature !== signature
      this.diagnostics.frameSignature = signature
      this.diagnostics.status = 'active'
      this.diagnostics.reason = null
      this.diagnostics.copyStatus = 'available'
      this.diagnostics.successfulCopyCount += 1
      this.diagnostics.lastCopyTimestamp = getTimestamp()
      this.diagnostics.readbackP95Ms = calculateP95(this.readbackDurations)
      this.diagnostics.preview = includePreview ? this.createPreview() : null
      return true
    } catch {
      this.diagnostics.status = 'error'
      this.diagnostics.reason = 'copy-failed'
      this.diagnostics.copyStatus = 'failed'
      this.diagnostics.failedCopyCount += 1
      this.diagnostics.preview = null
      return false
    } finally {
      this.diagnostics.totalProbeMs = Math.max(0, getTimestamp() - totalStartedAt)
      if (previousState) {
        try {
          this.restoreGlState(previousState)
        } catch {
          // A probe cleanup failure must not terminate the active XR session.
        }
      }
      // The opaque browser-owned texture is intentionally only held by this
      // local variable for the active frame and is never retained.
      cameraTexture = null
    }
  }

  public getDiagnostics(includePreview = false): RawCameraDebug {
    const preview = includePreview ? this.diagnostics.preview : null
    return {
      ...this.diagnostics,
      preview: preview
        ? {
            width: preview.width,
            height: preview.height,
            pixels: new Uint8ClampedArray(preview.pixels),
          }
        : null,
    }
  }

  public dispose(): void {
    this.disposeResources()
    this.session = null
    this.gl = null
    this.binding = null
    this.readback.fill(0)
    this.readbackDurations.length = 0
    this.diagnostics = createInitialDiagnostics()
  }

  private createCopyResources(): void {
    const gl = this.gl
    if (!gl) {
      throw new Error('The raw camera WebGL context is unavailable.')
    }

    this.program = createProgram(gl)
    this.positionAttribute = gl.getAttribLocation(this.program, 'aPosition')
    this.sourceCropUniform = gl.getUniformLocation(this.program, 'uSourceCrop')
    this.cameraImageUniform = gl.getUniformLocation(this.program, 'uCameraImage')
    this.orientationUniform = gl.getUniformLocation(this.program, 'uOrientation')
    if (
      this.positionAttribute < 0 ||
      !this.sourceCropUniform ||
      !this.cameraImageUniform ||
      !this.orientationUniform
    ) {
      throw new Error('The raw camera shader locations are unavailable.')
    }

    this.fullscreenBuffer = gl.createBuffer()
    this.outputTexture = gl.createTexture()
    this.outputFramebuffer = gl.createFramebuffer()
    if (!this.fullscreenBuffer || !this.outputTexture || !this.outputFramebuffer) {
      throw new Error('The raw camera copy resources could not be created.')
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW)
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      COPY_WIDTH,
      COPY_HEIGHT,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outputFramebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.outputTexture,
      0,
    )
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('The raw camera output framebuffer is incomplete.')
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  private createPreview(): RawCameraPreview {
    const pixels = new Uint8ClampedArray(this.readback.length)
    const rowBytes = COPY_WIDTH * 4
    for (let row = 0; row < COPY_HEIGHT; row += 1) {
      const sourceOffset = (COPY_HEIGHT - 1 - row) * rowBytes
      pixels.set(this.readback.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes)
    }
    return { width: COPY_WIDTH, height: COPY_HEIGHT, pixels }
  }

  private captureGlState(): {
    framebuffer: WebGLFramebuffer | null
    program: WebGLProgram | null
    activeTexture: number
    texture0: WebGLTexture | null
    arrayBuffer: WebGLBuffer | null
    viewport: Int32Array
    blend: boolean
    depthTest: boolean
    cullFace: boolean
    scissorTest: boolean
    colorMask: boolean[]
    depthMask: boolean
    positionAttributeEnabled: boolean
  } {
    const gl = this.gl
    if (!gl) {
      throw new Error('The raw camera WebGL context is unavailable.')
    }

    const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number
    gl.activeTexture(gl.TEXTURE0)
    const texture0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
    gl.activeTexture(activeTexture)
    return {
      framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
      activeTexture,
      texture0,
      arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
      viewport: new Int32Array(gl.getParameter(gl.VIEWPORT) as Int32Array),
      blend: gl.isEnabled(gl.BLEND),
      depthTest: gl.isEnabled(gl.DEPTH_TEST),
      cullFace: gl.isEnabled(gl.CULL_FACE),
      scissorTest: gl.isEnabled(gl.SCISSOR_TEST),
      colorMask: Array.from(gl.getParameter(gl.COLOR_WRITEMASK) as boolean[]),
      depthMask: Boolean(gl.getParameter(gl.DEPTH_WRITEMASK)),
      positionAttributeEnabled: Boolean(
        gl.getVertexAttrib(this.positionAttribute, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
      ),
    }
  }

  private restoreGlState(state: ReturnType<XRRawCameraService['captureGlState']>): void {
    const gl = this.gl
    if (!gl) {
      return
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer)
    gl.useProgram(state.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, state.texture0)
    gl.activeTexture(state.activeTexture)
    gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer)
    gl.viewport(state.viewport[0], state.viewport[1], state.viewport[2], state.viewport[3])
    if (state.blend) {
      gl.enable(gl.BLEND)
    } else {
      gl.disable(gl.BLEND)
    }
    if (state.depthTest) {
      gl.enable(gl.DEPTH_TEST)
    } else {
      gl.disable(gl.DEPTH_TEST)
    }
    if (state.cullFace) {
      gl.enable(gl.CULL_FACE)
    } else {
      gl.disable(gl.CULL_FACE)
    }
    if (state.scissorTest) {
      gl.enable(gl.SCISSOR_TEST)
    } else {
      gl.disable(gl.SCISSOR_TEST)
    }
    gl.colorMask(state.colorMask[0], state.colorMask[1], state.colorMask[2], state.colorMask[3])
    gl.depthMask(state.depthMask)
    if (state.positionAttributeEnabled) {
      gl.enableVertexAttribArray(this.positionAttribute)
    } else {
      gl.disableVertexAttribArray(this.positionAttribute)
    }
  }

  private disposeResources(): void {
    if (!this.gl) {
      this.program = null
      this.outputTexture = null
      this.outputFramebuffer = null
      this.fullscreenBuffer = null
      this.positionAttribute = -1
      this.sourceCropUniform = null
      this.cameraImageUniform = null
      this.orientationUniform = null
      return
    }

    if (this.program) {
      this.gl.deleteProgram(this.program)
    }
    if (this.outputTexture) {
      this.gl.deleteTexture(this.outputTexture)
    }
    if (this.outputFramebuffer) {
      this.gl.deleteFramebuffer(this.outputFramebuffer)
    }
    if (this.fullscreenBuffer) {
      this.gl.deleteBuffer(this.fullscreenBuffer)
    }
    this.program = null
    this.outputTexture = null
    this.outputFramebuffer = null
    this.fullscreenBuffer = null
    this.positionAttribute = -1
    this.sourceCropUniform = null
    this.cameraImageUniform = null
    this.orientationUniform = null
  }
}

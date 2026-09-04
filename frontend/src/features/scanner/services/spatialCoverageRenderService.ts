import type {
  DenseCoverageMesh,
  SpatialCoverageRenderDebug,
} from '../types'
import type {
  XRPresentationRenderTarget,
  XRWebGLContext,
} from './xrPresentationService'
import {
  COVERAGE_VISUAL_OPACITY,
  COVERAGE_VISUAL_PATCH_SIZE_METERS,
} from './spatialCoverageVisualConfig'

const FLOATS_PER_VERTEX = 7
const BYTES_PER_FLOAT = Float32Array.BYTES_PER_ELEMENT

const VERTEX_SHADER_SOURCE = `
attribute vec3 aPosition;
attribute vec4 aColor;
uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;
varying vec4 vColor;

void main() {
  gl_Position = uProjectionMatrix * uViewMatrix * vec4(aPosition, 1.0);
  gl_PointSize = 3.0;
  vColor = aColor;
}
`

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;
varying vec4 vColor;

void main() {
  gl_FragColor = vColor;
}
`

function createShader(
  gl: XRWebGLContext,
  shaderType: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(shaderType)
  if (!shader) {
    throw new Error('The coverage shader could not be created.')
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile failure.'
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
      throw new Error('The coverage shader program could not be created.')
    }

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? 'Unknown shader link failure.'
      throw new Error(info)
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

/**
 * Uploads the current dense world-space mask into the session's XRWebGLLayer.
 * It shares the XR session's context and never owns a second animation loop.
 */
export class SpatialCoverageRenderService {
  private target: XRPresentationRenderTarget | null = null

  private gl: XRWebGLContext | null = null

  private program: WebGLProgram | null = null

  private denseBuffer: WebGLBuffer | null = null

  private persistentSurfaceBuffer: WebGLBuffer | null = null

  private candidateSurfaceBuffer: WebGLBuffer | null = null

  private rgbDepthBuffer: WebGLBuffer | null = null

  private positionAttribute = -1

  private colorAttribute = -1

  private projectionUniform: WebGLUniformLocation | null = null

  private viewUniform: WebGLUniformLocation | null = null

  private denseVertexCount = 0

  private persistentSurfaceVertexCount = 0

  private candidateSurfaceVertexCount = 0

  private rgbDepthVertexCount = 0

  private denseBufferCapacityBytes = 0

  private persistentSurfaceBufferCapacityBytes = 0

  private candidateSurfaceBufferCapacityBytes = 0

  private rgbDepthBufferCapacityBytes = 0

  private denseAppliedRevision = -1

  private persistentSurfaceAppliedRevision = -1

  private candidateSurfaceAppliedRevision = -1

  private rgbDepthAppliedRevision = -1

  private debugGeometryVisible = false

  private persistentSurfelDebugVisible = false

  private candidateSurfaceVisible = true

  private rgbDepthDebugVisible = false

  private diagnostics: SpatialCoverageRenderDebug = this.createInitialDiagnostics()

  public initialize(target: XRPresentationRenderTarget | null): void {
    this.dispose()

    if (!target) {
      this.diagnostics.status = 'failed'
      return
    }

    try {
      this.target = target
      this.gl = target.gl
      this.program = createProgram(target.gl)
      this.denseBuffer = target.gl.createBuffer()
      if (!this.denseBuffer) {
        throw new Error('The dense coverage vertex buffer could not be created.')
      }
      this.persistentSurfaceBuffer = target.gl.createBuffer()
      if (!this.persistentSurfaceBuffer) {
        throw new Error('The persistent surface vertex buffer could not be created.')
      }
      this.candidateSurfaceBuffer = target.gl.createBuffer()
      if (!this.candidateSurfaceBuffer) {
        throw new Error('The candidate surface vertex buffer could not be created.')
      }

      this.positionAttribute = target.gl.getAttribLocation(this.program, 'aPosition')
      this.colorAttribute = target.gl.getAttribLocation(this.program, 'aColor')
      this.projectionUniform = target.gl.getUniformLocation(this.program, 'uProjectionMatrix')
      this.viewUniform = target.gl.getUniformLocation(this.program, 'uViewMatrix')

      if (
        this.positionAttribute < 0 ||
        this.colorAttribute < 0 ||
        !this.projectionUniform ||
        !this.viewUniform
      ) {
        throw new Error('The coverage shader locations could not be resolved.')
      }

      this.diagnostics.status = 'ready'
    } catch {
      this.diagnostics.status = 'failed'
      this.disposeResources()
      this.target = null
      this.gl = null
    }
  }

  public updateDenseMesh(mesh: DenseCoverageMesh): void {
    if (
      this.diagnostics.status !== 'ready' ||
      !this.gl ||
      !this.denseBuffer ||
      this.denseAppliedRevision === mesh.revision
    ) {
      return
    }

    try {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.denseBuffer)
      const uploadStartedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
      if (mesh.vertexData.byteLength > this.denseBufferCapacityBytes) {
        const nextCapacityBytes = Math.max(
          mesh.vertexData.byteLength,
          Math.ceil(Math.max(1, this.denseBufferCapacityBytes) * 1.5),
        )
        this.gl.bufferData(this.gl.ARRAY_BUFFER, nextCapacityBytes, this.gl.DYNAMIC_DRAW)
        this.denseBufferCapacityBytes = nextCapacityBytes
      }
      if (mesh.vertexData.byteLength > 0) {
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, mesh.vertexData)
      }
      this.denseVertexCount = mesh.vertexCount
      this.denseAppliedRevision = mesh.revision
      this.diagnostics.denseVertexCount = mesh.vertexCount
      this.diagnostics.denseRenderUpdateCount += 1
      this.diagnostics.gpuBufferUploadDurationMs = Math.max(
        0,
        (typeof performance === 'undefined' ? Date.now() : performance.now()) - uploadStartedAt,
      )
    } catch {
      this.diagnostics.status = 'failed'
    }
  }

  public updatePersistentSurfaceMesh(mesh: DenseCoverageMesh): void {
    if (
      this.diagnostics.status !== 'ready' ||
      !this.gl ||
      !this.persistentSurfaceBuffer ||
      this.persistentSurfaceAppliedRevision === mesh.revision
    ) {
      return
    }

    try {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.persistentSurfaceBuffer)
      const uploadStartedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
      if (mesh.vertexData.byteLength > this.persistentSurfaceBufferCapacityBytes) {
        const nextCapacityBytes = Math.max(
          mesh.vertexData.byteLength,
          Math.ceil(Math.max(1, this.persistentSurfaceBufferCapacityBytes) * 1.5),
        )
        this.gl.bufferData(this.gl.ARRAY_BUFFER, nextCapacityBytes, this.gl.DYNAMIC_DRAW)
        this.persistentSurfaceBufferCapacityBytes = nextCapacityBytes
      }
      if (mesh.vertexData.byteLength > 0) {
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, mesh.vertexData)
      }
      this.persistentSurfaceVertexCount = mesh.vertexCount
      this.persistentSurfaceAppliedRevision = mesh.revision
      this.diagnostics.persistentVertexCount = mesh.vertexCount
      this.diagnostics.persistentSurfelCount = Math.floor(mesh.vertexCount / 6)
      this.diagnostics.persistentRenderUpdateCount += 1
      this.diagnostics.gpuBufferUploadDurationMs = Math.max(
        0,
        (typeof performance === 'undefined' ? Date.now() : performance.now()) - uploadStartedAt,
      )
    } catch {
      this.diagnostics.status = 'failed'
    }
  }

  public clearDenseMesh(): void {
    this.denseVertexCount = 0
    this.denseAppliedRevision = -1
    this.diagnostics.denseVertexCount = 0
  }

  public updateCandidateSurfaceMesh(mesh: DenseCoverageMesh): void {
    if (
      this.diagnostics.status !== 'ready' ||
      !this.gl ||
      !this.candidateSurfaceBuffer ||
      this.candidateSurfaceAppliedRevision === mesh.revision
    ) {
      return
    }

    try {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.candidateSurfaceBuffer)
      const uploadStartedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
      if (mesh.vertexData.byteLength > this.candidateSurfaceBufferCapacityBytes) {
        const nextCapacityBytes = Math.max(
          mesh.vertexData.byteLength,
          Math.ceil(Math.max(1, this.candidateSurfaceBufferCapacityBytes) * 1.5),
        )
        this.gl.bufferData(this.gl.ARRAY_BUFFER, nextCapacityBytes, this.gl.DYNAMIC_DRAW)
        this.candidateSurfaceBufferCapacityBytes = nextCapacityBytes
      }
      if (mesh.vertexData.byteLength > 0) {
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, mesh.vertexData)
      }
      this.candidateSurfaceVertexCount = mesh.vertexCount
      this.candidateSurfaceAppliedRevision = mesh.revision
      this.diagnostics.candidateVertexCount = mesh.vertexCount
      this.diagnostics.candidateRenderUpdateCount += 1
      this.diagnostics.gpuBufferUploadDurationMs = Math.max(
        0,
        (typeof performance === 'undefined' ? Date.now() : performance.now()) - uploadStartedAt,
      )
    } catch {
      this.diagnostics.status = 'failed'
    }
  }

  public clearCandidateSurfaceMesh(): void {
    this.candidateSurfaceVertexCount = 0
    this.candidateSurfaceAppliedRevision = -1
    this.diagnostics.candidateVertexCount = 0
  }

  public updateRgbDepthMesh(mesh: DenseCoverageMesh): void {
    if (
      this.diagnostics.status !== 'ready' ||
      !this.gl ||
      this.rgbDepthAppliedRevision === mesh.revision
    ) {
      return
    }

    try {
      if (!this.rgbDepthBuffer) {
        this.rgbDepthBuffer = this.gl.createBuffer()
      }
      if (!this.rgbDepthBuffer) {
        return
      }

      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.rgbDepthBuffer)
      const uploadStartedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
      if (mesh.vertexData.byteLength > this.rgbDepthBufferCapacityBytes) {
        const nextCapacityBytes = Math.max(
          mesh.vertexData.byteLength,
          Math.ceil(Math.max(1, this.rgbDepthBufferCapacityBytes) * 1.5),
        )
        this.gl.bufferData(this.gl.ARRAY_BUFFER, nextCapacityBytes, this.gl.DYNAMIC_DRAW)
        this.rgbDepthBufferCapacityBytes = nextCapacityBytes
      }
      if (mesh.vertexData.byteLength > 0) {
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, mesh.vertexData)
      }
      this.rgbDepthVertexCount = mesh.vertexCount
      this.rgbDepthAppliedRevision = mesh.revision
      this.diagnostics.rgbDepthVertexCount = mesh.vertexCount
      this.diagnostics.rgbDepthRenderUpdateCount += 1
      this.diagnostics.gpuBufferUploadDurationMs = Math.max(
        0,
        (typeof performance === 'undefined' ? Date.now() : performance.now()) - uploadStartedAt,
      )
    } catch {
      this.diagnostics.status = 'failed'
    }
  }

  public clearRgbDepthMesh(): void {
    this.rgbDepthVertexCount = 0
    this.rgbDepthAppliedRevision = -1
    this.diagnostics.rgbDepthVertexCount = 0
  }

  public setDebugGeometryVisible(visible: boolean): void {
    this.debugGeometryVisible = visible
    this.diagnostics.rawCurrentDepthVisible = visible
  }

  public setPersistentSurfelDebugVisible(visible: boolean): void {
    this.persistentSurfelDebugVisible = visible
    this.diagnostics.persistentSurfelDebugVisible = visible
  }

  public setCandidateSurfaceVisible(visible: boolean): void {
    this.candidateSurfaceVisible = visible
    this.diagnostics.candidateSurfaceVisible = visible
  }

  public setRgbDepthDebugVisible(visible: boolean): void {
    this.rgbDepthDebugVisible = visible
    this.diagnostics.rgbDepthDebugVisible = visible
  }

  public render(views: readonly XRView[]): void {
    if (
      this.diagnostics.status !== 'ready' ||
      !this.target ||
      !this.gl ||
      !this.program ||
      !this.denseBuffer ||
      !this.persistentSurfaceBuffer ||
      !this.candidateSurfaceBuffer ||
      !this.projectionUniform ||
      !this.viewUniform ||
      (this.denseVertexCount === 0 &&
        this.persistentSurfaceVertexCount === 0 &&
        this.candidateSurfaceVertexCount === 0 &&
        this.rgbDepthVertexCount === 0)
    ) {
      return
    }

    const { gl, target } = this
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.baseLayer.framebuffer)
      gl.useProgram(this.program)
      gl.enableVertexAttribArray(this.positionAttribute)
      gl.enableVertexAttribArray(this.colorAttribute)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(false)

      for (const view of views) {
        const viewport = target.baseLayer.getViewport(view)
        if (!viewport) {
          continue
        }

        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height)
        gl.uniformMatrix4fv(this.projectionUniform, false, view.projectionMatrix)
        gl.uniformMatrix4fv(this.viewUniform, false, view.transform.inverse.matrix)

        if (this.candidateSurfaceVisible && this.candidateSurfaceVertexCount > 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.candidateSurfaceBuffer)
          this.configureVertexAttributes(gl)
          gl.disable(gl.CULL_FACE)
          gl.drawArrays(gl.TRIANGLES, 0, this.candidateSurfaceVertexCount)
        }

        if (this.persistentSurfaceVertexCount > 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.persistentSurfaceBuffer)
          this.configureVertexAttributes(gl)
          gl.enable(gl.CULL_FACE)
          gl.cullFace(gl.BACK)
          gl.drawArrays(gl.TRIANGLES, 0, this.persistentSurfaceVertexCount)
          if (this.persistentSurfelDebugVisible) {
            gl.drawArrays(gl.POINTS, 0, this.persistentSurfaceVertexCount)
          }
        }

        if (this.debugGeometryVisible && this.denseVertexCount > 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.denseBuffer)
          this.configureVertexAttributes(gl)
          gl.disable(gl.CULL_FACE)
          gl.drawArrays(gl.TRIANGLES, 0, this.denseVertexCount)
          gl.drawArrays(gl.POINTS, 0, this.denseVertexCount)
        }

        if (this.rgbDepthDebugVisible && this.rgbDepthVertexCount > 0 && this.rgbDepthBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rgbDepthBuffer)
          this.configureVertexAttributes(gl)
          gl.disable(gl.DEPTH_TEST)
          gl.disable(gl.CULL_FACE)
          gl.drawArrays(gl.POINTS, 0, this.rgbDepthVertexCount)
          gl.enable(gl.DEPTH_TEST)
        }
      }
    } catch {
      this.diagnostics.status = 'failed'
    } finally {
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      gl.disable(gl.CULL_FACE)
    }
  }

  public getDiagnostics(): SpatialCoverageRenderDebug {
    return { ...this.diagnostics }
  }

  public dispose(): void {
    this.disposeResources()
    this.target = null
    this.gl = null
    this.denseVertexCount = 0
    this.persistentSurfaceVertexCount = 0
    this.candidateSurfaceVertexCount = 0
    this.rgbDepthVertexCount = 0
    this.denseBufferCapacityBytes = 0
    this.persistentSurfaceBufferCapacityBytes = 0
    this.candidateSurfaceBufferCapacityBytes = 0
    this.rgbDepthBufferCapacityBytes = 0
    this.denseAppliedRevision = -1
    this.persistentSurfaceAppliedRevision = -1
    this.candidateSurfaceAppliedRevision = -1
    this.rgbDepthAppliedRevision = -1
    this.debugGeometryVisible = false
    this.persistentSurfelDebugVisible = false
    this.candidateSurfaceVisible = true
    this.rgbDepthDebugVisible = false
    this.diagnostics = this.createInitialDiagnostics()
  }

  private createInitialDiagnostics(): SpatialCoverageRenderDebug {
    return {
      status: 'idle',
      visualPatchSizeMeters: COVERAGE_VISUAL_PATCH_SIZE_METERS,
      candidateOpacity: COVERAGE_VISUAL_OPACITY.candidate,
      observedOpacity: COVERAGE_VISUAL_OPACITY.observed,
      partialOpacity: COVERAGE_VISUAL_OPACITY.partial,
      capturedOpacity: COVERAGE_VISUAL_OPACITY.captured,
      persistentVertexCount: 0,
      persistentRenderUpdateCount: 0,
      persistentSurfelCount: 0,
      candidateVertexCount: 0,
      candidateRenderUpdateCount: 0,
      candidateSurfaceVisible: true,
      denseVertexCount: 0,
      denseRenderUpdateCount: 0,
      rawCurrentDepthVisible: false,
      persistentSurfelDebugVisible: false,
      rgbDepthDebugVisible: false,
      rgbDepthVertexCount: 0,
      rgbDepthRenderUpdateCount: 0,
      gpuBufferUploadDurationMs: 0,
    }
  }

  private disposeResources(): void {
    if (this.gl) {
      if (this.denseBuffer) {
        this.gl.deleteBuffer(this.denseBuffer)
      }
      if (this.persistentSurfaceBuffer) {
        this.gl.deleteBuffer(this.persistentSurfaceBuffer)
      }
      if (this.candidateSurfaceBuffer) {
        this.gl.deleteBuffer(this.candidateSurfaceBuffer)
      }
      if (this.rgbDepthBuffer) {
        this.gl.deleteBuffer(this.rgbDepthBuffer)
      }
      if (this.program) {
        this.gl.deleteProgram(this.program)
      }
    }

    this.program = null
    this.denseBuffer = null
    this.persistentSurfaceBuffer = null
    this.candidateSurfaceBuffer = null
    this.rgbDepthBuffer = null
    this.positionAttribute = -1
    this.colorAttribute = -1
    this.projectionUniform = null
    this.viewUniform = null
  }

  private configureVertexAttributes(gl: XRWebGLContext): void {
    gl.vertexAttribPointer(
      this.positionAttribute,
      3,
      gl.FLOAT,
      false,
      FLOATS_PER_VERTEX * BYTES_PER_FLOAT,
      0,
    )
    gl.vertexAttribPointer(
      this.colorAttribute,
      4,
      gl.FLOAT,
      false,
      FLOATS_PER_VERTEX * BYTES_PER_FLOAT,
      3 * BYTES_PER_FLOAT,
    )
  }
}

import type {
  CoverageCellState,
  CoverageRenderTile,
  SpatialCoverageRenderDebug,
} from '../types'
import type {
  XRPresentationRenderTarget,
  XRWebGLContext,
} from './xrPresentationService'
import {
  COVERAGE_VISUAL_PATCH_SIZE_METERS,
  MAX_COVERAGE_CELLS,
  type SpatialCoverageRenderSnapshot,
} from './spatialCoverageService'

const SURFACE_OFFSET_METERS = 0.002
const MAX_RENDER_TILES = MAX_COVERAGE_CELLS
const VERTICES_PER_TILE = 6
const FLOATS_PER_VERTEX = 7
const BYTES_PER_FLOAT = Float32Array.BYTES_PER_ELEMENT
const VECTOR_EPSILON = 1e-6

const VERTEX_SHADER_SOURCE = `
attribute vec3 aPosition;
attribute vec4 aColor;
uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;
varying vec4 vColor;

void main() {
  gl_Position = uProjectionMatrix * uViewMatrix * vec4(aPosition, 1.0);
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

interface Vector3 {
  x: number
  y: number
  z: number
}

function getVectorLength(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalizeVector(vector: Vector3): Vector3 | null {
  const length = getVectorLength(vector)
  if (!Number.isFinite(length) || length <= VECTOR_EPSILON) {
    return null
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  }
}

function crossVector(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  }
}

function addVectors(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z,
  }
}

function scaleVector(vector: Vector3, scale: number): Vector3 {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  }
}

function subtractVectors(first: Vector3, second: Vector3): Vector3 {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z,
  }
}

function getColor(state: CoverageCellState): [number, number, number, number] {
  switch (state) {
    case 'captured':
      return [0.83, 0.94, 0.41, 0.3]
    case 'partial':
      return [0.83, 0.94, 0.41, 0.17]
    default:
      return [0.83, 0.94, 0.41, 0.09]
  }
}

function getTileCorners(tile: CoverageRenderTile): [Vector3, Vector3, Vector3, Vector3] | null {
  const normal = normalizeVector(tile.normal)
  if (!normal) {
    return null
  }

  const referenceAxis = Math.abs(normal.y) < 0.9
    ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 }
  const tangent = normalizeVector(crossVector(referenceAxis, normal))
  if (!tangent) {
    return null
  }

  const bitangent = normalizeVector(crossVector(normal, tangent))
  if (!bitangent) {
    return null
  }

  const surfaceCenter = addVectors(tile.position, scaleVector(normal, SURFACE_OFFSET_METERS))
  const halfSize = COVERAGE_VISUAL_PATCH_SIZE_METERS / 2
  const tangentOffset = scaleVector(tangent, halfSize)
  const bitangentOffset = scaleVector(bitangent, halfSize)

  return [
    subtractVectors(subtractVectors(surfaceCenter, tangentOffset), bitangentOffset),
    addVectors(subtractVectors(surfaceCenter, bitangentOffset), tangentOffset),
    addVectors(surfaceCenter, addVectors(tangentOffset, bitangentOffset)),
    addVectors(subtractVectors(surfaceCenter, tangentOffset), bitangentOffset),
  ]
}

function appendVertex(
  data: Float32Array,
  offset: number,
  position: Vector3,
  color: readonly [number, number, number, number],
): number {
  data[offset] = position.x
  data[offset + 1] = position.y
  data[offset + 2] = position.z
  data[offset + 3] = color[0]
  data[offset + 4] = color[1]
  data[offset + 5] = color[2]
  data[offset + 6] = color[3]
  return offset + FLOATS_PER_VERTEX
}

function appendTile(
  data: Float32Array,
  offset: number,
  tile: CoverageRenderTile,
): number | null {
  const corners = getTileCorners(tile)
  if (!corners) {
    return null
  }

  const color = getColor(tile.coverageState)
  let nextOffset = appendVertex(data, offset, corners[0], color)
  nextOffset = appendVertex(data, nextOffset, corners[1], color)
  nextOffset = appendVertex(data, nextOffset, corners[2], color)
  nextOffset = appendVertex(data, nextOffset, corners[0], color)
  nextOffset = appendVertex(data, nextOffset, corners[2], color)
  nextOffset = appendVertex(data, nextOffset, corners[3], color)
  return nextOffset
}

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
 * Draws the bounded world-space coverage tile batch into the session's
 * XRWebGLLayer. It shares the XR presentation context and has no frame loop.
 */
export class SpatialCoverageRenderService {
  private target: XRPresentationRenderTarget | null = null

  private gl: XRWebGLContext | null = null

  private program: WebGLProgram | null = null

  private buffer: WebGLBuffer | null = null

  private positionAttribute = -1

  private colorAttribute = -1

  private projectionUniform: WebGLUniformLocation | null = null

  private viewUniform: WebGLUniformLocation | null = null

  private vertexData = new Float32Array(0)

  private vertexCount = 0

  private appliedRevision = -1

  private diagnostics: SpatialCoverageRenderDebug = {
    status: 'idle',
    renderedTiles: 0,
    renderCapacity: MAX_RENDER_TILES,
    renderUpdateCount: 0,
    visualPatchSizeMeters: COVERAGE_VISUAL_PATCH_SIZE_METERS,
  }

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
      this.buffer = target.gl.createBuffer()
      if (!this.buffer) {
        throw new Error('The coverage vertex buffer could not be created.')
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

  public update(snapshot: SpatialCoverageRenderSnapshot): void {
    if (
      this.diagnostics.status !== 'ready' ||
      !this.gl ||
      !this.buffer ||
      this.appliedRevision === snapshot.revision
    ) {
      return
    }

    try {
      const tileCount = Math.min(snapshot.tiles.length, MAX_RENDER_TILES)
      this.ensureVertexCapacity(tileCount)
      let offset = 0
      let renderedTiles = 0

      for (let index = 0; index < tileCount; index += 1) {
        const nextOffset = appendTile(this.vertexData, offset, snapshot.tiles[index])
        if (nextOffset === null) {
          continue
        }

        offset = nextOffset
        renderedTiles += 1
      }

      const gl = this.gl
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
      gl.bufferData(
        gl.ARRAY_BUFFER,
        this.vertexData.subarray(0, offset),
        gl.DYNAMIC_DRAW,
      )
      this.vertexCount = renderedTiles * VERTICES_PER_TILE
      this.appliedRevision = snapshot.revision
      this.diagnostics.renderedTiles = renderedTiles
      this.diagnostics.renderUpdateCount += 1
    } catch {
      this.diagnostics.status = 'failed'
    }
  }

  public render(views: readonly XRView[]): void {
    if (
      this.diagnostics.status !== 'ready' ||
      !this.target ||
      !this.gl ||
      !this.program ||
      !this.buffer ||
      !this.projectionUniform ||
      !this.viewUniform ||
      this.vertexCount === 0
    ) {
      return
    }

    const { gl, target } = this
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.baseLayer.framebuffer)
      gl.useProgram(this.program)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
      gl.enableVertexAttribArray(this.positionAttribute)
      gl.enableVertexAttribArray(this.colorAttribute)
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
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(false)
      gl.disable(gl.CULL_FACE)

      for (const view of views) {
        const viewport = target.baseLayer.getViewport(view)
        if (!viewport) {
          continue
        }

        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height)
        gl.uniformMatrix4fv(this.projectionUniform, false, view.projectionMatrix)
        gl.uniformMatrix4fv(this.viewUniform, false, view.transform.inverse.matrix)
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)
      }
    } catch {
      this.diagnostics.status = 'failed'
    } finally {
      gl.depthMask(true)
      gl.disable(gl.BLEND)
    }
  }

  public getDiagnostics(): SpatialCoverageRenderDebug {
    return { ...this.diagnostics }
  }

  public dispose(): void {
    this.disposeResources()
    this.target = null
    this.gl = null
    this.vertexData = new Float32Array(0)
    this.vertexCount = 0
    this.appliedRevision = -1
    this.diagnostics = {
      status: 'idle',
      renderedTiles: 0,
      renderCapacity: MAX_RENDER_TILES,
      renderUpdateCount: 0,
      visualPatchSizeMeters: COVERAGE_VISUAL_PATCH_SIZE_METERS,
    }
  }

  private ensureVertexCapacity(tileCount: number): void {
    const requiredFloats = tileCount * VERTICES_PER_TILE * FLOATS_PER_VERTEX
    if (this.vertexData.length < requiredFloats) {
      this.vertexData = new Float32Array(requiredFloats)
    }
  }

  private disposeResources(): void {
    if (this.gl) {
      if (this.buffer) {
        this.gl.deleteBuffer(this.buffer)
      }
      if (this.program) {
        this.gl.deleteProgram(this.program)
      }
    }

    this.program = null
    this.buffer = null
    this.positionAttribute = -1
    this.colorAttribute = -1
    this.projectionUniform = null
    this.viewUniform = null
  }
}

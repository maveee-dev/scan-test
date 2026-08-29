import type { XRPresentationStatus } from '../types'

export interface XRPresentationDiagnostics {
  glContextStatus: XRPresentationStatus
  baseLayerStatus: XRPresentationStatus
}

export class XRPresentationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XRPresentationError'
  }
}

type XRWebGLContext = WebGL2RenderingContext | WebGLRenderingContext

/**
 * Prepares the transparent WebGL presentation layer required by immersive AR.
 * This service intentionally does not create a Three.js scene.
 */
export class XRPresentationService {
  private canvas: HTMLCanvasElement | null = null

  private gl: XRWebGLContext | null = null

  private baseLayer: XRWebGLLayer | null = null

  private glContextStatus: XRPresentationStatus = 'unknown'

  private baseLayerStatus: XRPresentationStatus = 'unknown'

  public async initialize(session: XRSession): Promise<XRPresentationDiagnostics> {
    this.dispose()

    try {
      this.createCanvas()
      const gl = this.getTransparentContext()
      this.gl = gl

      await gl.makeXRCompatible()
      this.glContextStatus = 'ready'

      this.baseLayer = new XRWebGLLayer(session, gl, {
        alpha: true,
        antialias: true,
        depth: true,
        stencil: false,
      })

      await session.updateRenderState({ baseLayer: this.baseLayer })
      this.baseLayerStatus = 'ready'

      gl.clearColor(0, 0, 0, 0)

      return this.getDiagnostics()
    } catch (error) {
      if (this.glContextStatus !== 'ready') {
        this.glContextStatus = 'failed'
      }
      if (this.baseLayerStatus !== 'ready') {
        this.baseLayerStatus = 'failed'
      }

      const message =
        error instanceof XRPresentationError
          ? error.message
          : 'The transparent XR presentation layer could not be initialized.'
      throw new XRPresentationError(message)
    }
  }

  public getDiagnostics(): XRPresentationDiagnostics {
    return {
      glContextStatus: this.glContextStatus,
      baseLayerStatus: this.baseLayerStatus,
    }
  }

  public clearTransparentFrame(): void {
    if (!this.gl || !this.baseLayer) {
      throw new XRPresentationError('The XR presentation layer is not ready for a frame.')
    }

    try {
      const { gl, baseLayer } = this
      gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer)
      gl.viewport(0, 0, baseLayer.framebufferWidth, baseLayer.framebufferHeight)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    } catch {
      throw new XRPresentationError('The XR framebuffer could not be cleared transparently.')
    }
  }

  public dispose(): void {
    this.baseLayer = null
    this.gl = null
    this.glContextStatus = 'unknown'
    this.baseLayerStatus = 'unknown'

    if (this.canvas) {
      this.canvas.remove()
      this.canvas = null
    }
  }

  private createCanvas(): void {
    if (typeof document === 'undefined' || !document.body) {
      throw new XRPresentationError('A document body is required for the XR presentation canvas.')
    }

    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.position = 'fixed'
    canvas.style.width = '1px'
    canvas.style.height = '1px'
    canvas.style.opacity = '0'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '-1'
    document.body.appendChild(canvas)
    this.canvas = canvas
  }

  private getTransparentContext(): XRWebGLContext {
    if (!this.canvas) {
      throw new XRPresentationError('The XR presentation canvas is not available.')
    }

    const contextAttributes: WebGLContextAttributes = {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      stencil: false,
      xrCompatible: true,
    }

    const webgl2 = this.canvas.getContext('webgl2', contextAttributes)
    const context = webgl2 ?? this.canvas.getContext('webgl', contextAttributes)

    if (!context) {
      throw new XRPresentationError('WebGL is unavailable for the XR presentation layer.')
    }

    return context
  }
}

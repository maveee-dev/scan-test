export {}

declare global {
  /** WebXR Raw Camera Access image dimensions. */
  interface XRCamera {
    readonly width: number
    readonly height: number
  }

  interface XRView {
    readonly camera?: XRCamera | null
  }

  interface XRWebGLBinding {
    /** Returns the browser-owned camera texture for the active XR frame. */
    getCameraImage(camera: XRCamera): WebGLTexture | null
  }
}

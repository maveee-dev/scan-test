import * as THREE from 'three'
import type { SpatialPoint, SpatialPreviewStatus } from '../types'

const DEFAULT_CANVAS_WIDTH = 280
const DEFAULT_CANVAS_HEIGHT = 150
const MAX_PIXEL_RATIO = 2

interface PreviewBounds {
  min: SpatialPoint
  max: SpatialPoint
}

function getBounds(points: readonly SpatialPoint[]): PreviewBounds | null {
  if (points.length === 0) {
    return null
  }

  const firstPoint = points[0]
  const bounds: PreviewBounds = {
    min: { ...firstPoint },
    max: { ...firstPoint },
  }

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    bounds.min.x = Math.min(bounds.min.x, point.x)
    bounds.min.y = Math.min(bounds.min.y, point.y)
    bounds.min.z = Math.min(bounds.min.z, point.z)
    bounds.max.x = Math.max(bounds.max.x, point.x)
    bounds.max.y = Math.max(bounds.max.y, point.y)
    bounds.max.z = Math.max(bounds.max.z, point.z)
  }

  return bounds
}

/**
 * Renders only the latest bounded point frame into the DOM-overlay preview.
 * It has no animation loop and does not retain point history.
 */
export class SpatialPointPreviewService {
  private canvas: HTMLCanvasElement | null = null

  private renderer: THREE.WebGLRenderer | null = null

  private scene: THREE.Scene | null = null

  private camera: THREE.PerspectiveCamera | null = null

  private geometry: THREE.BufferGeometry | null = null

  private material: THREE.PointsMaterial | null = null

  private pointCloud: THREE.Points | null = null

  private previewStatus: SpatialPreviewStatus = 'idle'

  public get status(): SpatialPreviewStatus {
    return this.previewStatus
  }

  public initialize(canvas: HTMLCanvasElement | undefined): void {
    this.dispose()

    if (!canvas) {
      this.previewStatus = 'failed'
      return
    }

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      })
      renderer.setClearColor(0x111412, 0.08)
      renderer.setPixelRatio(
        Math.min(
          typeof window === 'undefined' ? 1 : window.devicePixelRatio,
          MAX_PIXEL_RATIO,
        ),
      )

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 100)
      const geometry = new THREE.BufferGeometry()
      const material = new THREE.PointsMaterial({
        color: 0xd4ef69,
        size: 0.04,
        sizeAttenuation: true,
      })
      const pointCloud = new THREE.Points(geometry, material)
      scene.add(pointCloud)

      this.canvas = canvas
      this.renderer = renderer
      this.scene = scene
      this.camera = camera
      this.geometry = geometry
      this.material = material
      this.pointCloud = pointCloud
      this.previewStatus = 'ready'
    } catch {
      this.previewStatus = 'failed'
      this.disposeResources()
    }
  }

  public render(points: readonly SpatialPoint[]): void {
    if (
      this.previewStatus !== 'ready' ||
      !this.canvas ||
      !this.renderer ||
      !this.scene ||
      !this.camera ||
      !this.geometry ||
      !this.pointCloud
    ) {
      return
    }

    try {
      const positions = new Float32Array(points.length * 3)
      for (const [index, point] of points.entries()) {
        positions[index * 3] = point.x
        positions[index * 3 + 1] = point.y
        positions[index * 3 + 2] = point.z
      }

      this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      this.geometry.computeBoundingSphere()
      this.pointCloud.visible = points.length > 0

      if (points.length > 0) {
        this.updateCamera(points)
      }

      const width = this.canvas.clientWidth || this.canvas.width || DEFAULT_CANVAS_WIDTH
      const height = this.canvas.clientHeight || this.canvas.height || DEFAULT_CANVAS_HEIGHT
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(width, height, false)
      this.renderer.render(this.scene, this.camera)
    } catch {
      this.previewStatus = 'failed'
    }
  }

  public dispose(): void {
    this.disposeResources()
    this.previewStatus = 'idle'
  }

  private updateCamera(points: readonly SpatialPoint[]): void {
    if (!this.camera) {
      return
    }

    const bounds = getBounds(points)
    if (!bounds) {
      return
    }

    const center = new THREE.Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    )
    const radius = Math.max(
      0.25,
      Math.hypot(
        bounds.max.x - center.x,
        bounds.max.y - center.y,
        bounds.max.z - center.z,
      ),
    )
    const distance = Math.max(0.75, radius * 2.6)

    this.camera.position.set(center.x, center.y, center.z + distance)
    this.camera.near = Math.max(0.01, radius / 100)
    this.camera.far = Math.max(20, radius * 20)
    this.camera.lookAt(center)
  }

  private disposeResources(): void {
    this.pointCloud?.removeFromParent()
    this.geometry?.dispose()
    this.material?.dispose()
    this.renderer?.dispose()

    this.canvas = null
    this.renderer = null
    this.scene = null
    this.camera = null
    this.geometry = null
    this.material = null
    this.pointCloud = null
  }
}

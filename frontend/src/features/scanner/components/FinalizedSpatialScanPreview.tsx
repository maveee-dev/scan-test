import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CoverageCellState, FinalizedSpatialScan } from '../types'
import type { PlaneCandidate, RoomAnalysisResult } from '../../room-analysis/types'

interface FinalizedSpatialScanPreviewProps {
  scan: FinalizedSpatialScan
  analysisResult?: RoomAnalysisResult | null
}

const POINT_COLORS: Record<CoverageCellState, number> = {
  observed: 0x5c9cb8,
  partial: 0x72cce8,
  captured: 0xa2ecff,
}
const MAX_PIXEL_RATIO = 2
const PLANE_COLORS = {
  'horizontal-like': 0x9fe8ff,
  'vertical-like': 0x76d3e8,
  other: 0xd2b8ff,
} as const

type PreviewMode = 'captured' | 'planes'

function createPlaneGeometry(plane: PlaneCandidate): THREE.BufferGeometry {
  const { centroid, tangentU, tangentV, localBounds } = plane
  const corners = [
    [localBounds.minU, localBounds.minV],
    [localBounds.maxU, localBounds.minV],
    [localBounds.maxU, localBounds.maxV],
    [localBounds.minU, localBounds.maxV],
  ] as const
  const positions = new Float32Array(corners.length * 3)

  corners.forEach(([u, v], index) => {
    const offset = index * 3
    positions[offset] = centroid.x + tangentU.x * u + tangentV.x * v
    positions[offset + 1] = centroid.y + tangentU.y * u + tangentV.y * v
    positions[offset + 2] = centroid.z + tangentU.z * u + tangentV.z * v
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}

function addPlaneCandidates(
  scene: THREE.Scene,
  analysisResult: RoomAnalysisResult,
): { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } {
  const group = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []

  for (const plane of analysisResult.planes) {
    const geometry = createPlaneGeometry(plane)
    const material = new THREE.MeshBasicMaterial({
      color: PLANE_COLORS[plane.orientationCategory],
      depthWrite: false,
      opacity: 0.24,
      side: THREE.DoubleSide,
      transparent: true,
    })
    const mesh = new THREE.Mesh(geometry, material)
    const outlineGeometry = new THREE.EdgesGeometry(geometry)
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: PLANE_COLORS[plane.orientationCategory],
      opacity: 0.8,
      transparent: true,
    })
    const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial)
    group.add(mesh, outline)
    geometries.push(geometry, outlineGeometry)
    materials.push(material, outlineMaterial)
  }

  scene.add(group)
  return { geometries, materials }
}

function FinalizedSpatialScanPreview({ analysisResult, scan }: FinalizedSpatialScanPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resetViewRef = useRef<(() => void) | null>(null)
  const [mode, setMode] = useState<PreviewMode>('captured')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || scan.coverage.length === 0) {
      return undefined
    }

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    })
    renderer.setPixelRatio(
      Math.min(
        typeof window === 'undefined' ? 1 : window.devicePixelRatio,
        MAX_PIXEL_RATIO,
      ),
    )
    renderer.setClearColor(0x0b0f12, 0.82)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(52, 1, 0.01, 100)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.minDistance = 0.08
    controls.maxDistance = 100

    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(scan.coverage.length * 3)
    const colors = new Float32Array(scan.coverage.length * 3)
    const minimum = { x: Infinity, y: Infinity, z: Infinity }
    const maximum = { x: -Infinity, y: -Infinity, z: -Infinity }

    scan.coverage.forEach((cell, index) => {
      const positionOffset = index * 3
      positions[positionOffset] = cell.position.x
      positions[positionOffset + 1] = cell.position.y
      positions[positionOffset + 2] = cell.position.z

      const color = new THREE.Color(POINT_COLORS[cell.coverageState])
      colors[positionOffset] = color.r
      colors[positionOffset + 1] = color.g
      colors[positionOffset + 2] = color.b

      minimum.x = Math.min(minimum.x, cell.position.x)
      minimum.y = Math.min(minimum.y, cell.position.y)
      minimum.z = Math.min(minimum.z, cell.position.z)
      maximum.x = Math.max(maximum.x, cell.position.x)
      maximum.y = Math.max(maximum.y, cell.position.y)
      maximum.z = Math.max(maximum.z, cell.position.z)
    })

    let material: THREE.PointsMaterial | null = null
    let pointCloud: THREE.Points | null = null
    let planeResources: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } | null = null

    if (mode === 'captured') {
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      material = new THREE.PointsMaterial({
        size: 0.045,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.94,
      })
      pointCloud = new THREE.Points(geometry, material)
      scene.add(pointCloud)
    } else if (analysisResult) {
      planeResources = addPlaneCandidates(scene, analysisResult)
    }

    const center = new THREE.Vector3(
      (minimum.x + maximum.x) / 2,
      (minimum.y + maximum.y) / 2,
      (minimum.z + maximum.z) / 2,
    )
    const radius = Math.max(
      0.25,
      Math.hypot(
        maximum.x - center.x,
        maximum.y - center.y,
        maximum.z - center.z,
      ),
    )

    const resetView = (): void => {
      camera.position.set(center.x, center.y + radius * 0.55, center.z + radius * 2.4)
      camera.near = Math.max(0.01, radius / 100)
      camera.far = Math.max(20, radius * 20)
      camera.updateProjectionMatrix()
      controls.target.copy(center)
      controls.update()
    }
    resetViewRef.current = resetView
    resetView()

    const resize = (): void => {
      const width = canvas.clientWidth || 320
      const height = canvas.clientHeight || 260
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    resize()

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(resize)
    resizeObserver?.observe(canvas)

    let animationFrameId = 0
    const render = (): void => {
      controls.update()
      renderer.render(scene, camera)
      animationFrameId = window.requestAnimationFrame(render)
    }
    animationFrameId = window.requestAnimationFrame(render)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      resizeObserver?.disconnect()
      resetViewRef.current = null
      controls.dispose()
      geometry.dispose()
      material?.dispose()
      planeResources?.geometries.forEach((planeGeometry) => planeGeometry.dispose())
      planeResources?.materials.forEach((planeMaterial) => planeMaterial.dispose())
      renderer.dispose()
      if (pointCloud) {
        scene.remove(pointCloud)
      }
    }
  }, [analysisResult, mode, scan])

  return (
    <div className="scanner-scan-preview">
      <canvas
        ref={canvasRef}
        className="scanner-scan-preview-canvas"
        aria-label="Interactive spatial scan preview"
      />
      <div className="scanner-scan-preview-toolbar">
        <div className="scanner-scan-preview-modes" role="group" aria-label="Spatial scan preview mode">
          <button
            type="button"
            className="scanner-preview-mode"
            aria-pressed={mode === 'captured'}
            onClick={() => setMode('captured')}
          >
            Captured Spatial Data
          </button>
          {analysisResult ? (
            <button
              type="button"
              className="scanner-preview-mode"
              aria-pressed={mode === 'planes'}
              onClick={() => setMode('planes')}
            >
              Plane Candidates
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="scan-button scan-button-secondary scanner-preview-reset"
          onClick={() => resetViewRef.current?.()}
        >
          Reset View
        </button>
      </div>
      {mode === 'planes' && analysisResult?.planes.length === 0 ? (
        <p className="scanner-scan-preview-note">
          No major geometric plane candidates were detected in this scan.
        </p>
      ) : null}
    </div>
  )
}

export default FinalizedSpatialScanPreview

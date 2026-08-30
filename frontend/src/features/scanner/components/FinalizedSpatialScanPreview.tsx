import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CoverageCellState, FinalizedSpatialScan } from '../types'
import type {
  PlaneCandidate,
  RoomAnalysisResult,
  RoomStructureInterpretationResult,
} from '../../room-analysis/types'

interface FinalizedSpatialScanPreviewProps {
  scan: FinalizedSpatialScan
  analysisResult?: RoomAnalysisResult | null
  structuralInterpretation?: RoomStructureInterpretationResult | null
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
const STRUCTURAL_SURFACE_COLORS = {
  wall: 0x72d7e8,
  floor: 0x9de5b3,
  ceiling: 0xd2b8ff,
  other: 0xf0b36a,
  unknown: 0x9da9b3,
} as const

type PreviewMode = 'coverage' | 'fused' | 'planes' | 'structural'

const FINALIZED_SURFEL_PREVIEW_RADIUS_METERS = 0.025
const FINALIZED_SURFEL_PREVIEW_OFFSET_METERS = 0.0005

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

function addStructuralSurfaces(
  scene: THREE.Scene,
  analysisResult: RoomAnalysisResult,
  interpretation: RoomStructureInterpretationResult,
): { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } {
  const group = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []

  for (const surface of interpretation.surfaces) {
    const plane = analysisResult.planes.find((candidate) => candidate.id === surface.planeId)
    if (!plane) {
      continue
    }
    const geometry = createPlaneGeometry(plane)
    const color = STRUCTURAL_SURFACE_COLORS[surface.role]
    const material = new THREE.MeshBasicMaterial({
      color,
      depthWrite: false,
      opacity: 0.16 + surface.confidence * 0.2,
      side: THREE.DoubleSide,
      transparent: true,
    })
    const mesh = new THREE.Mesh(geometry, material)
    const outlineGeometry = new THREE.EdgesGeometry(geometry)
    const outlineMaterial = new THREE.LineBasicMaterial({
      color,
      opacity: 0.45 + surface.confidence * 0.35,
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

function createFusedSurfaceGeometry(
  surfels: readonly FinalizedSpatialScan['fusedSurface'][number][],
): THREE.BufferGeometry {
  const verticesPerSurfel = 6
  const positions = new Float32Array(surfels.length * verticesPerSurfel * 3)
  const colors = new Float32Array(surfels.length * verticesPerSurfel * 3)
  let vertexOffset = 0

  for (const surfel of surfels) {
    const normal = new THREE.Vector3(surfel.normal.x, surfel.normal.y, surfel.normal.z).normalize()
    const reference = Math.abs(normal.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0)
    const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize()
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()
    const center = new THREE.Vector3(surfel.position.x, surfel.position.y, surfel.position.z)
      .addScaledVector(normal, FINALIZED_SURFEL_PREVIEW_OFFSET_METERS)
    const radius = FINALIZED_SURFEL_PREVIEW_RADIUS_METERS
    const corners = [
      center.clone().addScaledVector(tangent, -radius).addScaledVector(bitangent, -radius),
      center.clone().addScaledVector(tangent, radius).addScaledVector(bitangent, -radius),
      center.clone().addScaledVector(tangent, -radius).addScaledVector(bitangent, radius),
      center.clone().addScaledVector(tangent, radius).addScaledVector(bitangent, radius),
    ]
    const triangleCorners = [corners[0], corners[1], corners[2], corners[1], corners[3], corners[2]]
    const color = new THREE.Color(POINT_COLORS[surfel.coverageState])
    for (const corner of triangleCorners) {
      positions[vertexOffset * 3] = corner.x
      positions[vertexOffset * 3 + 1] = corner.y
      positions[vertexOffset * 3 + 2] = corner.z
      colors[vertexOffset * 3] = color.r
      colors[vertexOffset * 3 + 1] = color.g
      colors[vertexOffset * 3 + 2] = color.b
      vertexOffset += 1
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function FinalizedSpatialScanPreview({
  analysisResult,
  scan,
  structuralInterpretation,
}: FinalizedSpatialScanPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resetViewRef = useRef<(() => void) | null>(null)
  const [mode, setMode] = useState<PreviewMode>('coverage')

  useEffect(() => {
    const canvas = canvasRef.current
    const hasSpatialData = scan.coverage.length > 0 || scan.fusedSurface.length > 0
    if (!canvas || !hasSpatialData) {
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

    const coverageGeometry = new THREE.BufferGeometry()
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

    })

    let pointsForBounds = mode === 'fused'
      ? scan.fusedSurface.map((surfel) => surfel.position)
      : mode === 'planes' || mode === 'structural'
        ? analysisResult?.planes.flatMap((plane) => [plane.bounds.min, plane.bounds.max]) ?? []
        : scan.coverage.map((cell) => cell.position)
    if (pointsForBounds.length === 0) {
      for (const surfel of scan.fusedSurface) {
        pointsForBounds.push(surfel.position)
      }
    }
    for (const point of pointsForBounds) {
      minimum.x = Math.min(minimum.x, point.x)
      minimum.y = Math.min(minimum.y, point.y)
      minimum.z = Math.min(minimum.z, point.z)
      maximum.x = Math.max(maximum.x, point.x)
      maximum.y = Math.max(maximum.y, point.y)
      maximum.z = Math.max(maximum.z, point.z)
    }

    let material: THREE.PointsMaterial | null = null
    let pointCloud: THREE.Points | null = null
    let fusedGeometry: THREE.BufferGeometry | null = null
    let fusedMaterial: THREE.MeshBasicMaterial | null = null
    let fusedSurface: THREE.Mesh | null = null
    let planeResources: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } | null = null
    let structuralResources: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } | null = null

    if (mode === 'coverage') {
      coverageGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      coverageGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      material = new THREE.PointsMaterial({
        size: 0.045,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.94,
      })
      pointCloud = new THREE.Points(coverageGeometry, material)
      scene.add(pointCloud)
    } else if (mode === 'fused') {
      fusedGeometry = createFusedSurfaceGeometry(scan.fusedSurface)
      fusedMaterial = new THREE.MeshBasicMaterial({
        depthWrite: false,
        opacity: 0.88,
        side: THREE.DoubleSide,
        transparent: true,
        vertexColors: true,
      })
      fusedSurface = new THREE.Mesh(fusedGeometry, fusedMaterial)
      scene.add(fusedSurface)
    } else if (mode === 'planes' && analysisResult) {
      planeResources = addPlaneCandidates(scene, analysisResult)
    } else if (mode === 'structural' && analysisResult && structuralInterpretation) {
      structuralResources = addStructuralSurfaces(scene, analysisResult, structuralInterpretation)
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
      coverageGeometry.dispose()
      material?.dispose()
      fusedGeometry?.dispose()
      fusedMaterial?.dispose()
      planeResources?.geometries.forEach((planeGeometry) => planeGeometry.dispose())
      planeResources?.materials.forEach((planeMaterial) => planeMaterial.dispose())
      structuralResources?.geometries.forEach((surfaceGeometry) => surfaceGeometry.dispose())
      structuralResources?.materials.forEach((surfaceMaterial) => surfaceMaterial.dispose())
      renderer.dispose()
      if (pointCloud) {
        scene.remove(pointCloud)
      }
      if (fusedSurface) {
        scene.remove(fusedSurface)
      }
    }
  }, [analysisResult, mode, scan, structuralInterpretation])

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
            aria-pressed={mode === 'coverage'}
            onClick={() => setMode('coverage')}
          >
            Coverage Scan Data
          </button>
          {scan.fusedSurface.length > 0 ? (
            <button
              type="button"
              className="scanner-preview-mode"
              aria-pressed={mode === 'fused'}
              onClick={() => setMode('fused')}
            >
              Fused Surface Data
            </button>
          ) : null}
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
          {structuralInterpretation ? (
            <button
              type="button"
              className="scanner-preview-mode"
              aria-pressed={mode === 'structural'}
              onClick={() => setMode('structural')}
            >
              Structural Surfaces
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

import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type {
  CoverageCellState,
  FinalizedDenseRealityReconstruction,
  FinalizedRealityReconstruction,
  FinalizedSpatialScan,
  RealityRgbColor,
} from '../types'
import type {
  PlaneCandidate,
  RoomBoundaryResult,
  RoomAnalysisResult,
  RoomSurfacePatch,
  RoomSurfaceConstructionResult,
  RoomStructureInterpretationResult,
  StructuralIntersectionResult,
} from '../../room-analysis/types'
import FirstPersonRoomViewer from './FirstPersonRoomViewer'
import SurfaceCustomizationPanel from './SurfaceCustomizationPanel'
import {
  getSurfacePaintColor,
  type SurfaceCustomizationMap,
} from '../services/surfaceCustomizationService'
import {
  restoreRealitySurface,
  type RealitySurfaceRenderMode,
  type RealitySurfaceRenderStats,
} from '../services/realitySurfaceRenderingService'
import { usePreparedRealitySurface } from '../hooks/usePreparedRealitySurface'

interface FinalizedSpatialScanPreviewProps {
  scan: FinalizedSpatialScan
  denseRealityReconstruction?: FinalizedDenseRealityReconstruction | null
  realityReconstruction?: FinalizedRealityReconstruction | null
  analysisResult?: RoomAnalysisResult | null
  roomBoundary?: RoomBoundaryResult | null
  roomSurfaceConstruction?: RoomSurfaceConstructionResult | null
  structuralInterpretation?: RoomStructureInterpretationResult | null
  structuralIntersections?: StructuralIntersectionResult | null
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
const STRUCTURAL_INTERSECTION_COLORS = {
  'wall-wall': 0xffd166,
  'wall-ceiling': 0xd2b8ff,
  'wall-floor': 0x9de5b3,
} as const
const ROOM_BOUNDARY_COLORS = {
  'wall-wall': 0xffcf5c,
  'wall-ceiling': 0xd9a7ff,
  'wall-floor': 0x8ee2a8,
} as const
type PreviewMode = 'coverage' | 'fused' | 'reality-preview' | 'planes' | 'structural' | 'intersections' | 'boundary' | 'room-surfaces' | 'first-person-room'
type RealityRenderSource = 'dense' | 'structural'

const FINALIZED_SURFEL_PREVIEW_RADIUS_METERS = 0.025
const FINALIZED_SURFEL_PREVIEW_OFFSET_METERS = 0.0005

function getPreviewTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function formatRgb(color: RealityRgbColor): string {
  return `${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)}`
}

type RoomSurfaceMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
type RoomSurfaceOutline = THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>

interface RealityRuntimeStats {
  readonly fps: number
  readonly frameTimeMs: number
  readonly drawCalls: number
  readonly geometryCount: number
  readonly textureCount: number
}

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
    const isSelected = surface.selection === 'selected'
    const isAlternate = surface.selection === 'alternate'
    const material = new THREE.MeshBasicMaterial({
      color,
      depthWrite: false,
      opacity: isSelected
        ? 0.24 + surface.confidence * 0.24
        : isAlternate
          ? 0.08 + surface.confidence * 0.1
          : 0.05 + surface.confidence * 0.06,
      side: THREE.DoubleSide,
      transparent: true,
    })
    const mesh = new THREE.Mesh(geometry, material)
    const outlineGeometry = new THREE.EdgesGeometry(geometry)
    const outlineMaterial = new THREE.LineBasicMaterial({
      color,
      opacity: isSelected
        ? 0.8 + surface.confidence * 0.15
        : isAlternate
          ? 0.28 + surface.confidence * 0.18
          : 0.18 + surface.confidence * 0.12,
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

function addStructuralIntersections(
  scene: THREE.Scene,
  analysisResult: RoomAnalysisResult,
  interpretation: RoomStructureInterpretationResult,
  intersections: StructuralIntersectionResult,
): { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } {
  const group = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []

  for (const surface of interpretation.surfaces) {
    if (surface.selection !== 'selected') {
      continue
    }
    const plane = analysisResult.planes.find((candidate) => candidate.id === surface.planeId)
    if (!plane) {
      continue
    }
    const geometry = createPlaneGeometry(plane)
    const material = new THREE.MeshBasicMaterial({
      color: STRUCTURAL_SURFACE_COLORS[surface.role],
      depthWrite: false,
      opacity: 0.08,
      side: THREE.DoubleSide,
      transparent: true,
    })
    const mesh = new THREE.Mesh(geometry, material)
    group.add(mesh)
    geometries.push(geometry)
    materials.push(material)
  }

  for (const intersection of intersections.intersections) {
    if (!intersection.segment || intersection.status === 'rejected') {
      continue
    }
    const start = new THREE.Vector3(
      intersection.segment.start.x,
      intersection.segment.start.y,
      intersection.segment.start.z,
    )
    const end = new THREE.Vector3(
      intersection.segment.end.x,
      intersection.segment.end.y,
      intersection.segment.end.z,
    )
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
    const material = new THREE.LineBasicMaterial({
      color: STRUCTURAL_INTERSECTION_COLORS[intersection.type],
      opacity: intersection.status === 'supported' ? 1 : 0.62,
      transparent: true,
    })
    const line = new THREE.Line(geometry, material)
    group.add(line)
    geometries.push(geometry)
    materials.push(material)
  }

  scene.add(group)
  return { geometries, materials }
}

function addRoomBoundary(
  scene: THREE.Scene,
  analysisResult: RoomAnalysisResult,
  interpretation: RoomStructureInterpretationResult,
  boundary: RoomBoundaryResult,
): { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } {
  const group = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []

  for (const surface of interpretation.surfaces) {
    if (surface.selection !== 'selected') {
      continue
    }
    const plane = analysisResult.planes.find((candidate) => candidate.id === surface.planeId)
    if (!plane) {
      continue
    }
    const geometry = createPlaneGeometry(plane)
    const material = new THREE.MeshBasicMaterial({
      color: STRUCTURAL_SURFACE_COLORS[surface.role],
      depthWrite: false,
      opacity: 0.06,
      side: THREE.DoubleSide,
      transparent: true,
    })
    group.add(new THREE.Mesh(geometry, material))
    geometries.push(geometry)
    materials.push(material)
  }

  for (const edge of boundary.edges) {
    if (edge.status === 'rejected') {
      continue
    }
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(edge.start.x, edge.start.y, edge.start.z),
      new THREE.Vector3(edge.end.x, edge.end.y, edge.end.z),
    ])
    const material = new THREE.LineBasicMaterial({
      color: ROOM_BOUNDARY_COLORS[edge.type],
      opacity: edge.status === 'supported' ? 1 : 0.58,
      transparent: true,
    })
    group.add(new THREE.Line(geometry, material))
    geometries.push(geometry)
    materials.push(material)
  }

  for (const corner of boundary.corners) {
    const geometry = new THREE.SphereGeometry(0.035, 8, 6)
    const material = new THREE.MeshBasicMaterial({
      color: corner.status === 'supported' ? 0xffffff : 0xffb56b,
      depthWrite: false,
      opacity: corner.status === 'supported' ? 1 : 0.72,
      transparent: true,
    })
    const marker = new THREE.Mesh(geometry, material)
    marker.position.set(corner.position.x, corner.position.y, corner.position.z)
    group.add(marker)
    geometries.push(geometry)
    materials.push(material)
  }

  scene.add(group)
  return { geometries, materials }
}

function addRoomSurfaces(
  scene: THREE.Scene,
  construction: RoomSurfaceConstructionResult,
): {
  geometries: THREE.BufferGeometry[]
  materials: THREE.Material[]
  surfaceMeshes: Map<string, RoomSurfaceMesh>
  surfaceOutlines: Map<string, RoomSurfaceOutline>
} {
  const group = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const surfaceMeshes = new Map<string, RoomSurfaceMesh>()
  const surfaceOutlines = new Map<string, RoomSurfaceOutline>()

  for (const patch of construction.surfaces) {
    const positions = new Float32Array(patch.vertices3D.length * 3)
    patch.vertices3D.forEach((vertex, index) => {
      const offset = index * 3
      positions[offset] = vertex.x
      positions[offset + 1] = vertex.y
      positions[offset + 2] = vertex.z
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex([...patch.triangleIndices])
    const material = new THREE.MeshBasicMaterial({
      color: getSurfacePaintColor(patch, {}),
      depthWrite: false,
      opacity: 0.58,
      side: THREE.DoubleSide,
      transparent: true,
    })
    const mesh = new THREE.Mesh(geometry, material)
    const outlineGeometry = new THREE.EdgesGeometry(geometry)
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: getSurfacePaintColor(patch, {}),
      opacity: 0.82,
      transparent: true,
    })
    const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial)
    group.add(mesh, outline)
    geometries.push(geometry, outlineGeometry)
    materials.push(material, outlineMaterial)
    surfaceMeshes.set(patch.id, mesh)
    surfaceOutlines.set(patch.id, outline)
  }

  scene.add(group)
  return { geometries, materials, surfaceMeshes, surfaceOutlines }
}

function applyRoomSurfaceAppearance(
  surfaces: readonly RoomSurfacePatch[],
  meshes: ReadonlyMap<string, RoomSurfaceMesh>,
  outlines: ReadonlyMap<string, RoomSurfaceOutline>,
  customizations: SurfaceCustomizationMap,
  selectedSurfaceId: string | null,
): void {
  const patchById = new Map<string, RoomSurfacePatch>(surfaces.map((surface) => [surface.id, surface]))
  for (const [surfaceId, mesh] of meshes) {
    const patch = patchById.get(surfaceId)
    if (!patch) {
      continue
    }
    const color = getSurfacePaintColor(patch, customizations)
    const isSelected = surfaceId === selectedSurfaceId
    mesh.material.color.set(color)
    mesh.material.opacity = isSelected ? 0.78 : 0.58
    const outline = outlines.get(surfaceId)
    if (outline) {
      outline.material.color.set(isSelected ? '#ffffff' : color)
      outline.material.opacity = isSelected ? 1 : 0.82
    }
  }
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
  denseRealityReconstruction,
  realityReconstruction,
  roomBoundary,
  roomSurfaceConstruction,
  scan,
  structuralIntersections,
  structuralInterpretation,
}: FinalizedSpatialScanPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resetViewRef = useRef<(() => void) | null>(null)
  const roomSurfaceMeshesRef = useRef<Map<string, RoomSurfaceMesh>>(new Map())
  const roomSurfaceOutlinesRef = useRef<Map<string, RoomSurfaceOutline>>(new Map())
  const [mode, setMode] = useState<PreviewMode>('coverage')
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null)
  const [customizationPanelOpen, setCustomizationPanelOpen] = useState(false)
  const [surfaceCustomizations, setSurfaceCustomizations] = useState<SurfaceCustomizationMap>({})
  const [realityRenderMode, setRealityRenderMode] = useState<RealitySurfaceRenderMode>('dense')
  const [realityRenderSource, setRealityRenderSource] = useState<RealityRenderSource>('dense')
  const [realityRenderStats, setRealityRenderStats] = useState<RealitySurfaceRenderStats | null>(null)
  const [realityRuntimeStats, setRealityRuntimeStats] = useState<RealityRuntimeStats | null>(null)

  const denseRealityColorIsRenderable = denseRealityReconstruction?.status === 'available' &&
    denseRealityReconstruction.colorStatistics.sampleCount > 0 &&
    denseRealityReconstruction.colorStatistics.min.r >= 0 &&
    denseRealityReconstruction.colorStatistics.min.g >= 0 &&
    denseRealityReconstruction.colorStatistics.min.b >= 0 &&
    denseRealityReconstruction.colorStatistics.max.r <= 1.01 &&
    denseRealityReconstruction.colorStatistics.max.g <= 1.01 &&
    denseRealityReconstruction.colorStatistics.max.b <= 1.01
  const preferredRealityReconstruction = realityRenderSource === 'dense' && denseRealityColorIsRenderable
    ? denseRealityReconstruction
    : realityReconstruction
  const realityPreparation = usePreparedRealitySurface(preferredRealityReconstruction, realityRenderMode, mode === 'reality-preview')
  const preparedReality = realityPreparation.prepared
  const denseRealityFallbackActive = realityRenderSource === 'dense' &&
    denseRealityReconstruction?.status === 'available' &&
    !denseRealityColorIsRenderable &&
    realityReconstruction !== null &&
    realityReconstruction !== undefined

  const selectSurface = useCallback((surfaceId: string | null): void => {
    setSelectedSurfaceId(surfaceId)
    setCustomizationPanelOpen(surfaceId !== null)
  }, [])

  const closeCustomizationPanel = useCallback((): void => {
    setCustomizationPanelOpen(false)
  }, [])

  const setSurfacePaintColor = useCallback((surfaceId: string, color: string): void => {
    setSurfaceCustomizations((current) => ({
      ...current,
      [surfaceId]: { ...current[surfaceId], paintColor: color },
    }))
  }, [])

  const resetSelectedSurface = useCallback((): void => {
    if (!selectedSurfaceId) {
      return
    }
    setSurfaceCustomizations((current) => {
      const next = { ...current }
      delete next[selectedSurfaceId]
      return next
    })
  }, [selectedSurfaceId])

  const resetAllSurfaceColors = useCallback((): void => {
    setSurfaceCustomizations({})
  }, [])

  const selectedSurface = roomSurfaceConstruction?.surfaces.find((surface) => surface.id === selectedSurfaceId) ?? null

  useEffect(() => {
    if (!customizationPanelOpen) {
      return undefined
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      closeCustomizationPanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeCustomizationPanel, customizationPanelOpen])

  useEffect(() => {
    const canvas = canvasRef.current
    const hasSpatialData = scan.coverage.length > 0 || scan.fusedSurface.length > 0
    roomSurfaceMeshesRef.current.clear()
    roomSurfaceOutlinesRef.current.clear()
    if (!canvas || !hasSpatialData || mode === 'first-person-room') {
      return undefined
    }

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
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
      : mode === 'reality-preview'
        ? preferredRealityReconstruction?.surfels.map((surfel) => surfel.position) ?? []
      : mode === 'planes' || mode === 'structural'
        ? analysisResult?.planes.flatMap((plane) => [plane.bounds.min, plane.bounds.max]) ?? []
        : mode === 'intersections'
          ? structuralIntersections?.intersections.flatMap((intersection) => intersection.segment
            ? [intersection.segment.start, intersection.segment.end]
            : []) ?? []
        : mode === 'boundary'
            ? roomBoundary?.edges.flatMap((edge) => [edge.start, edge.end]) ?? []
            : mode === 'room-surfaces'
              ? roomSurfaceConstruction?.surfaces.flatMap((surface) => surface.vertices3D) ?? []
        : scan.coverage.map((cell) => cell.position)
    if (pointsForBounds.length === 0) {
      if ((mode === 'intersections' || mode === 'boundary' || mode === 'room-surfaces') && structuralInterpretation && analysisResult) {
        for (const surface of structuralInterpretation.surfaces) {
          if (surface.selection !== 'selected') {
            continue
          }
          const plane = analysisResult.planes.find((candidate) => candidate.id === surface.planeId)
          if (plane) {
            pointsForBounds.push(plane.bounds.min, plane.bounds.max)
          }
        }
      }
      for (const surfel of scan.fusedSurface) {
        pointsForBounds.push(surfel.position)
      }
      if (pointsForBounds.length === 0) {
        pointsForBounds.push(...scan.coverage.map((cell) => cell.position))
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
    let intersectionResources: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } | null = null
    let boundaryResources: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } | null = null
    let realityResources: ReturnType<typeof restoreRealitySurface> | null = null
    let roomSurfaceResources: {
      geometries: THREE.BufferGeometry[]
      materials: THREE.Material[]
      surfaceMeshes: Map<string, RoomSurfaceMesh>
      surfaceOutlines: Map<string, RoomSurfaceOutline>
    } | null = null

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
    } else if (mode === 'intersections' && analysisResult && structuralInterpretation && structuralIntersections) {
      intersectionResources = addStructuralIntersections(scene, analysisResult, structuralInterpretation, structuralIntersections)
    } else if (mode === 'boundary' && analysisResult && structuralInterpretation && roomBoundary) {
      boundaryResources = addRoomBoundary(scene, analysisResult, structuralInterpretation, roomBoundary)
    } else if (mode === 'room-surfaces' && roomSurfaceConstruction) {
      roomSurfaceResources = addRoomSurfaces(scene, roomSurfaceConstruction)
      roomSurfaceMeshesRef.current = roomSurfaceResources.surfaceMeshes
      roomSurfaceOutlinesRef.current = roomSurfaceResources.surfaceOutlines
    } else if (mode === 'reality-preview' && preparedReality) {
      realityResources = restoreRealitySurface(preparedReality)
      scene.add(realityResources.group)
    }

    const selectableMeshes = roomSurfaceResources?.surfaceMeshes ?? new Map<string, RoomSurfaceMesh>()
    const selectionRaycaster = new THREE.Raycaster()
    const selectionPointer = new THREE.Vector2()
    let selectionPointerStart: { id: number; x: number; y: number } | null = null
    const onSelectionPointerDown = (event: PointerEvent): void => {
      if (mode !== 'room-surfaces' || event.button !== 0) {
        return
      }
      selectionPointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
    const onSelectionPointerUp = (event: PointerEvent): void => {
      const start = selectionPointerStart
      selectionPointerStart = null
      if (!start || start.id !== event.pointerId || mode !== 'room-surfaces' || selectableMeshes.size === 0) {
        return
      }
      const movedDistance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
      if (movedDistance > 7) {
        return
      }
      const bounds = canvas.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) {
        return
      }
      selectionPointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      selectionPointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      selectionRaycaster.setFromCamera(selectionPointer, camera)
      const hit = selectionRaycaster.intersectObjects([...selectableMeshes.values()], false)[0]
      const hitEntry = hit
        ? [...selectableMeshes.entries()].find(([, mesh]) => mesh === hit.object)
        : undefined
      selectSurface(hitEntry?.[0] ?? null)
    }
    canvas.addEventListener('pointerdown', onSelectionPointerDown)
    canvas.addEventListener('pointerup', onSelectionPointerUp)

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
    let renderLoopActive = true
    let publishedAt = getPreviewTimestamp()
    let publishedFrameCount = 0
    let previousFrameAt: number | null = null
    let renderStatsPublished = false
    const render = (frameTimestamp: number): void => {
      controls.update()
      renderer.render(scene, camera)
      if (realityResources && !renderStatsPublished) {
        setRealityRenderStats(realityResources.stats)
        renderStatsPublished = true
      }
      if (realityResources && frameTimestamp - publishedAt >= 500) {
        const elapsedMs = frameTimestamp - publishedAt
        if (renderLoopActive) {
          setRealityRuntimeStats({
            fps: (publishedFrameCount / Math.max(1, elapsedMs)) * 1000,
            frameTimeMs: previousFrameAt === null
              ? 0
              : elapsedMs / Math.max(1, publishedFrameCount),
            drawCalls: renderer.info.render.calls,
            geometryCount: renderer.info.memory.geometries,
            textureCount: renderer.info.memory.textures,
          })
        }
        publishedAt = frameTimestamp
        publishedFrameCount = 0
      }
      publishedFrameCount += 1
      previousFrameAt = frameTimestamp
      animationFrameId = window.requestAnimationFrame(render)
    }
    animationFrameId = window.requestAnimationFrame(render)

    return () => {
      renderLoopActive = false
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
      intersectionResources?.geometries.forEach((intersectionGeometry) => intersectionGeometry.dispose())
      intersectionResources?.materials.forEach((intersectionMaterial) => intersectionMaterial.dispose())
      boundaryResources?.geometries.forEach((boundaryGeometry) => boundaryGeometry.dispose())
      boundaryResources?.materials.forEach((boundaryMaterial) => boundaryMaterial.dispose())
      roomSurfaceResources?.geometries.forEach((surfaceGeometry) => surfaceGeometry.dispose())
      roomSurfaceResources?.materials.forEach((surfaceMaterial) => surfaceMaterial.dispose())
      realityResources?.geometries.forEach((geometry) => geometry.dispose())
      realityResources?.materials.forEach((surfaceMaterial) => surfaceMaterial.dispose())
      renderer.dispose()
      canvas.removeEventListener('pointerdown', onSelectionPointerDown)
      canvas.removeEventListener('pointerup', onSelectionPointerUp)
      roomSurfaceMeshesRef.current.clear()
      roomSurfaceOutlinesRef.current.clear()
      if (pointCloud) {
        scene.remove(pointCloud)
      }
      if (fusedSurface) {
        scene.remove(fusedSurface)
      }
      if (realityResources) {
        scene.remove(realityResources.group)
      }
    }
  }, [analysisResult, denseRealityReconstruction, mode, preferredRealityReconstruction, preparedReality, realityReconstruction, realityRenderMode, roomBoundary, roomSurfaceConstruction, scan, selectSurface, structuralInterpretation, structuralIntersections])

  useEffect(() => {
    applyRoomSurfaceAppearance(
      roomSurfaceConstruction?.surfaces ?? [],
      roomSurfaceMeshesRef.current,
      roomSurfaceOutlinesRef.current,
      surfaceCustomizations,
      selectedSurfaceId,
    )
  }, [roomSurfaceConstruction, selectedSurfaceId, surfaceCustomizations])

  return (
    <div className="scanner-scan-preview">
      {mode === 'first-person-room' ? (
        roomSurfaceConstruction ? (
          <FirstPersonRoomViewer
            construction={roomSurfaceConstruction}
            customizations={surfaceCustomizations}
            onPaintColorChange={setSurfacePaintColor}
            onResetAllColors={resetAllSurfaceColors}
            onResetSelectedSurface={resetSelectedSurface}
            onSelectSurface={selectSurface}
            selectedSurfaceId={selectedSurfaceId}
            customizationPanelOpen={customizationPanelOpen}
            onCloseCustomizationPanel={closeCustomizationPanel}
            referenceSpaceType={scan.referenceSpaceType}
            onExit={() => {
              closeCustomizationPanel()
              setMode('room-surfaces')
            }}
          />
        ) : (
          <div className="first-person-room-empty">
            <strong>No room surfaces available for first-person viewing.</strong>
            <span>Run post-scan analysis after capturing structural room surfaces.</span>
            <button type="button" className="scan-button scan-button-secondary" onClick={() => setMode('room-surfaces')}>
              Back to Finished Review
            </button>
          </div>
        )
      ) : (
        <canvas
          ref={canvasRef}
          className="scanner-scan-preview-canvas"
          aria-label="Interactive spatial scan preview"
        />
      )}
      <div className="scanner-scan-preview-toolbar">
        <div className="scanner-scan-preview-modes" role="group" aria-label="Spatial scan preview modes">
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
          {preferredRealityReconstruction ? (
            <button
              type="button"
              className="scanner-preview-mode scanner-preview-mode-reality"
              aria-pressed={mode === 'reality-preview'}
              onClick={() => setMode('reality-preview')}
            >
              Reality Preview
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
          {structuralIntersections ? (
            <button
              type="button"
              className="scanner-preview-mode"
              aria-pressed={mode === 'intersections'}
              onClick={() => setMode('intersections')}
            >
              Structural Intersections
            </button>
          ) : null}
          {roomBoundary ? (
            <button
              type="button"
              className="scanner-preview-mode"
              aria-pressed={mode === 'boundary'}
              onClick={() => setMode('boundary')}
            >
              Room Boundary
            </button>
          ) : null}
          {roomSurfaceConstruction ? (
            <button
              type="button"
              className="scanner-preview-mode"
              aria-pressed={mode === 'room-surfaces'}
              onClick={() => setMode('room-surfaces')}
            >
              Room Surfaces
            </button>
          ) : null}
          {scan.coverage.length > 0 || scan.fusedSurface.length > 0 ? (
            <button
              type="button"
              className="scanner-preview-mode scanner-preview-mode-first-person"
              aria-pressed={mode === 'first-person-room'}
              onClick={() => setMode('first-person-room')}
            >
              First-Person Room
            </button>
          ) : null}
        </div>
        {mode === 'room-surfaces' && roomSurfaceConstruction ? (
          <button
            type="button"
            className="scan-button scanner-first-person-entry"
            onClick={() => setMode('first-person-room')}
          >
            Enter First-Person Room
          </button>
        ) : null}
        {mode !== 'first-person-room' ? (
          <button
            type="button"
            className="scan-button scan-button-secondary scanner-preview-reset"
            onClick={() => resetViewRef.current?.()}
          >
            Reset View
          </button>
        ) : null}
      </div>
      {mode === 'room-surfaces' && customizationPanelOpen && selectedSurface ? (
        <SurfaceCustomizationPanel
          surface={selectedSurface}
          customizations={surfaceCustomizations}
          onPaintColorChange={(color) => setSurfacePaintColor(selectedSurface.id, color)}
          onResetSelected={resetSelectedSurface}
          onResetAll={resetAllSurfaceColors}
          onClose={closeCustomizationPanel}
        />
      ) : null}
      {mode === 'planes' && analysisResult?.planes.length === 0 ? (
        <p className="scanner-scan-preview-note">
          No major geometric plane candidates were detected in this scan.
        </p>
      ) : null}
      {mode === 'intersections' && structuralIntersections && structuralIntersections.stats.supportedCount === 0 ? (
        <p className="scanner-scan-preview-note">
          No supported finite structural intersection segments were detected. Partial candidates remain in the diagnostics below.
        </p>
      ) : null}
      {mode === 'boundary' && roomBoundary && roomBoundary.edges.length === 0 ? (
        <p className="scanner-scan-preview-note">
          No finite structural boundary edges were observed. Selected surfaces remain available as an open, incomplete boundary.
        </p>
      ) : null}
      {mode === 'room-surfaces' && roomSurfaceConstruction && roomSurfaceConstruction.surfaces.length === 0 ? (
        <p className="scanner-scan-preview-note">
          No bounded room-surface patches were constructed from the selected structural surfaces.
        </p>
      ) : null}
      {mode === 'reality-preview' && preferredRealityReconstruction ? (
        <div className="scanner-scan-preview-note scanner-reality-summary">
          <strong>Reality Reconstruction: {preferredRealityReconstruction.status}</strong>
          {denseRealityReconstruction?.status === 'available' && denseRealityReconstruction.surfels.length > 0 ? (
            <span>Dense Reality geometry is active; structural Reality surfels remain available as a reference.</span>
          ) : null}
          {denseRealityReconstruction?.status === 'available' ? (
            <span>
              Structural Reality {realityReconstruction?.captureSummary.totalSurfels ?? 0} surfels / median {realityReconstruction?.captureSummary.medianNearestNeighborSpacingMeters === null || realityReconstruction?.captureSummary.medianNearestNeighborSpacingMeters === undefined
                ? 'N/A'
                : `${realityReconstruction.captureSummary.medianNearestNeighborSpacingMeters.toFixed(3)} m`} / p90 {realityReconstruction?.captureSummary.p90NearestNeighborSpacingMeters === null || realityReconstruction?.captureSummary.p90NearestNeighborSpacingMeters === undefined
                  ? 'N/A'
                  : `${realityReconstruction.captureSummary.p90NearestNeighborSpacingMeters.toFixed(3)} m`} · Dense Reality {denseRealityReconstruction.surfels.length} stable / {denseRealityReconstruction.fusionDiagnostics.activeSampleCount} active / median {denseRealityReconstruction.captureSummary.medianNearestNeighborSpacingMeters === null
                    ? 'N/A'
                    : `${denseRealityReconstruction.captureSummary.medianNearestNeighborSpacingMeters.toFixed(3)} m`} / p90 {denseRealityReconstruction.captureSummary.p90NearestNeighborSpacingMeters === null
                      ? 'N/A'
                      : `${denseRealityReconstruction.captureSummary.p90NearestNeighborSpacingMeters.toFixed(3)} m`}
            </span>
          ) : null}
          {denseRealityReconstruction?.status === 'available' ? (
            <span>
              Dense created {denseRealityReconstruction.fusionDiagnostics.createdSampleCount} · fused {denseRealityReconstruction.fusionDiagnostics.fusedSampleCount} · rejected {denseRealityReconstruction.fusionDiagnostics.rejectedSampleCount} · capacity {denseRealityReconstruction.fusionDiagnostics.capacityUtilizationPercentage.toFixed(1)}%
            </span>
          ) : null}
          {denseRealityFallbackActive ? (
            <span role="status">Dense Reality rendering unavailable — using Structural Reality.</span>
          ) : null}
          <span>
            Colored surfels {preferredRealityReconstruction.captureSummary.coloredSurfels} / {preferredRealityReconstruction.captureSummary.totalSurfels}
            {' · '}
            {preferredRealityReconstruction.captureSummary.colorCoveragePercentage.toFixed(1)}% color coverage
            {' · '}
            {preferredRealityReconstruction.captureSummary.cameraCapturesUsed} camera captures
          </span>
          <span>
            Average spacing {preferredRealityReconstruction.captureSummary.averageNearestNeighborSpacingMeters === null
              ? 'N/A'
              : `${preferredRealityReconstruction.captureSummary.averageNearestNeighborSpacingMeters.toFixed(3)} m`}
            {' / '}
            median {preferredRealityReconstruction.captureSummary.medianNearestNeighborSpacingMeters === null
              ? 'N/A'
              : `${preferredRealityReconstruction.captureSummary.medianNearestNeighborSpacingMeters.toFixed(3)} m`}
            {' / '}
            p90 {preferredRealityReconstruction.captureSummary.p90NearestNeighborSpacingMeters === null
              ? 'N/A'
              : `${preferredRealityReconstruction.captureSummary.p90NearestNeighborSpacingMeters.toFixed(3)} m`}
            {' · '}
            estimated gaps {preferredRealityReconstruction.captureSummary.approximateUncoveredGapMeters === null
              ? 'N/A'
              : `${preferredRealityReconstruction.captureSummary.approximateUncoveredGapMeters.toFixed(3)} m`}
            {' / '}
            small-gap regions {preferredRealityReconstruction.captureSummary.estimatedSmallGapRegionCount}
            {' / '}
            large unsupported gaps {preferredRealityReconstruction.captureSummary.estimatedLargeUnsupportedGapCount}
            {' / '}
            capacity {preferredRealityReconstruction.captureSummary.capacityUtilizationPercentage.toFixed(1)}%
            {preferredRealityReconstruction.captureSummary.capacityReached ? ' (reached)' : ''}
          </span>
          {realityPreparation.pending ? <span role="status">Preparing Reality Preview… You can switch modes or leave review.</span> : null}
          {realityPreparation.error ? <span role="alert">{realityPreparation.error}</span> : null}
            <details className="scanner-reality-diagnostics">
              <summary>Reality development diagnostics / layer comparison</summary>
              <div className="scanner-reality-render-modes" role="group" aria-label="Reality render source">
                <span>Reality source</span>
                <button
                  type="button"
                  className="scanner-reality-render-mode"
                  aria-pressed={realityRenderSource === 'dense'}
                  disabled={!denseRealityColorIsRenderable}
                  onClick={() => {
                    setRealityRenderStats(null)
                    setRealityRenderSource('dense')
                  }}
                >
                  Dense Reality
                </button>
                <button
                  type="button"
                  className="scanner-reality-render-mode"
                  aria-pressed={realityRenderSource === 'structural'}
                  disabled={!realityReconstruction}
                  onClick={() => {
                    setRealityRenderStats(null)
                    setRealityRenderSource('structural')
                  }}
                >
                  Structural Reality
                </button>
              </div>
              <div className="scanner-reality-render-modes" role="group" aria-label="Reality render comparison modes">
                <span>Debug render</span>
                {(['points', 'splats', 'triangles', 'dense'] as const).map((renderMode) => (
                  <button
                    key={renderMode}
                    type="button"
                    className="scanner-reality-render-mode"
                    aria-pressed={realityRenderMode === renderMode}
                    onClick={() => {
                      setRealityRenderStats(null)
                      setRealityRenderMode(renderMode)
                    }}
                  >
                    {renderMode === 'points'
                      ? 'Raw Reality Points'
                      : renderMode === 'splats'
                        ? 'Reality Splats'
                        : renderMode === 'triangles' ? 'Dense Triangles only' : 'Dense Reality Surface (Final)'}
                  </button>
                ))}
              </div>
              {realityRenderStats?.mode === realityRenderMode ? (
                <span>
                  Rendered {realityRenderStats.renderedSurfelCount} surfels · {realityRenderStats.renderedSplatCount} splats · {realityRenderStats.renderedTriangleCount} triangles · preparation {realityRenderStats.renderPreparationMs.toFixed(1)} ms
                </span>
              ) : null}
              {realityRenderStats?.mode === realityRenderMode ? (
                <span>
                  Refinement index {realityRenderStats.neighborIndexBuildMs.toFixed(1)} ms / neighbors {realityRenderStats.neighborAnalysisMs.toFixed(1)} ms / splats {realityRenderStats.splatGeometryMs.toFixed(1)} ms / triangles {realityRenderStats.triangleGenerationMs.toFixed(1)} ms / memory {(realityRenderStats.memoryBytes / 1024).toFixed(1)} KB / median spacing {realityRenderStats.medianNearestNeighborSpacingMeters === null
                    ? 'N/A'
                    : `${realityRenderStats.medianNearestNeighborSpacingMeters.toFixed(3)} m`} / p90 {realityRenderStats.p90NearestNeighborSpacingMeters === null
                      ? 'N/A'
                      : `${realityRenderStats.p90NearestNeighborSpacingMeters.toFixed(3)} m`}
                </span>
              ) : null}
              {realityRenderStats?.mode === realityRenderMode ? (
                <span>
                  Triangle participants {realityRenderStats.triangleParticipantCount} / {realityRenderStats.coloredSurfelCount} ({realityRenderStats.triangleParticipationPercentage.toFixed(1)}%) / fallback {realityRenderStats.fallbackPercentage.toFixed(1)}%. Participation is a vertex count, not covered surface area.
                </span>
              ) : null}
              {realityRenderStats?.mode === realityRenderMode && realityRenderStats.distribution ? (
                <>
                  <span>
                    Data tangent U/V median links: {realityRenderStats.distribution.medianTangentUSpacing?.toFixed(3) ?? 'N/A'} / {realityRenderStats.distribution.medianTangentVSpacing?.toFixed(3) ?? 'N/A'} m;
                    anisotropy {realityRenderStats.distribution.anisotropyRatio?.toFixed(2) ?? 'N/A'};
                    dominant nearest-spacing bin {realityRenderStats.distribution.dominantSpacingMeters?.toFixed(3) ?? 'N/A'} m (5 mm bins).
                  </span>
                  <span>Compatible-link directions (12 tangent-angle bins, 0–180°): {realityRenderStats.distribution.directionBins.join(' / ')}</span>
                  <span>Nearest-spacing histogram (0–120 mm, 5 mm bins): {realityRenderStats.distribution.spacingBins.join(' / ')}</span>
                  <span>
                    No compatible U/V link: {realityRenderStats.distribution.missingTangentU} / {realityRenderStats.distribution.missingTangentV}; bounded queries exhausted: {realityRenderStats.distribution.truncatedQueries}.
                    These are local directional evidence, not exact holes or a quality score.
                  </span>
                  <span>Genuinely dark source RGB (all sRGB channels below 0.08): {realityRenderStats.distribution.darkRgbSamples}. No uncolored fallback material is rendered.</span>
                </>
              ) : null}
              <span>
                Isolation guide: rows in Raw Points indicate measured distribution; triangles-only isolates connectivity; spots added only by Final indicate fallback/composition. Empty areas in all geometry layers may be unsupported; dark RGB counts alone cannot locate screen artifacts.
              </span>
              <span>
                Capture audit: fixed 80 × 45 normalized sample grid (steps 1/80, 1/45); no temporal depth phase. At 160 × 90 this nominally spans two pixels per step, subject to runtime transforms. Coverage phases do not alter depth/RGB-D input. Source pixels and capture phase are not retained per finalized sample. Live capture is unchanged.
              </span>
              {realityRenderStats?.mode === realityRenderMode ? (
                <span>
                  Triangle vertices colored {realityRenderStats.coloredTriangleVertexCount} / uncolored {realityRenderStats.uncoloredTriangleVertexCount} / colored splats {realityRenderStats.renderedSplatCount} / fallback splats {realityRenderStats.fallbackSplatCount} / uncolored fallback {realityRenderStats.uncoloredFallbackSplatCount} / splats suppressed by triangles {realityRenderStats.splatsSuppressedByTriangles}
                </span>
              ) : null}
          {denseRealityReconstruction?.status === 'available' ? (
            <span>
              Dense RGB ({denseRealityReconstruction.colorStatistics.colorSpace}) min {formatRgb(denseRealityReconstruction.colorStatistics.min)} / max {formatRgb(denseRealityReconstruction.colorStatistics.max)} / mean {formatRgb(denseRealityReconstruction.colorStatistics.mean)} / non-white {denseRealityReconstruction.colorStatistics.nonWhiteSampleCount} / {denseRealityReconstruction.colorStatistics.sampleCount} / unique approx {denseRealityReconstruction.colorStatistics.uniqueApproximateColorCount}
            </span>
          ) : null}
          {denseRealityReconstruction?.status === 'available' ? (
            <div className="scanner-reality-color-samples" aria-label="Dense Reality color validation samples">
              {denseRealityReconstruction.colorSamples.map((sample, index) => (
                <span key={`${sample.position.x}-${sample.position.y}-${sample.position.z}-${index}`}>
                  Sample {index + 1}: P {sample.position.x.toFixed(2)}, {sample.position.y.toFixed(2)}, {sample.position.z.toFixed(2)} / RGB {formatRgb(sample.colorRgb)} / obs {sample.colorObservationCount} / weight {sample.colorWeight.toFixed(2)} / confidence {sample.colorConfidence.toFixed(2)}
                </span>
              ))}
            </div>
          ) : null}
              {realityRenderStats?.mode === realityRenderMode ? (
                <span>
                  Render RGB ({realityRenderStats.renderColorStatistics.colorSpace}) min {formatRgb(realityRenderStats.renderColorStatistics.min)} / max {formatRgb(realityRenderStats.renderColorStatistics.max)} / mean {formatRgb(realityRenderStats.renderColorStatistics.mean)} / non-white {realityRenderStats.renderColorStatistics.nonWhiteSampleCount} / {realityRenderStats.renderColorStatistics.sampleCount}
                </span>
              ) : null}
              {realityRuntimeStats ? (
                <span>
                  Runtime {realityRuntimeStats.fps.toFixed(0)} FPS · {realityRuntimeStats.frameTimeMs.toFixed(1)} ms · {realityRuntimeStats.drawCalls} draw calls · {realityRuntimeStats.geometryCount} geometries
                </span>
              ) : null}
            </details>
          {preferredRealityReconstruction.status !== 'available' ? (
            <span>Original camera colors were not retained for this scan; structural review remains available.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default FinalizedSpatialScanPreview

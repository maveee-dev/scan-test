import * as THREE from 'three'
import type { FinalizedRealityReconstruction, FinalizedRealitySurfel } from '../types'

export type RealitySurfaceRenderMode = 'points' | 'splats' | 'dense'

export interface RealitySurfaceRenderStats {
  readonly mode: RealitySurfaceRenderMode
  readonly sourceSurfelCount: number
  readonly coloredSurfelCount: number
  readonly renderedSurfelCount: number
  readonly renderedSplatCount: number
  readonly renderedTriangleCount: number
  readonly visualRadiusScale: number
  readonly renderPreparationMs: number
}

export interface RealitySurfaceRenderResources {
  readonly group: THREE.Group
  readonly geometries: readonly THREE.BufferGeometry[]
  readonly materials: readonly THREE.Material[]
  readonly stats: RealitySurfaceRenderStats
}

const RAW_POINT_SIZE_METERS = 0.045
const SURFEL_VISUAL_RADIUS_SCALE = 1.12
const DENSE_SPLAT_RADIUS_SCALE = 1.04
const MAX_VISUAL_RADIUS_METERS = 0.055
const MAX_LOCAL_EDGE_DISTANCE_METERS = 0.12
const MAX_LOCAL_PLANE_RESIDUAL_METERS = 0.028
const MIN_NORMAL_DOT = Math.cos((42 * Math.PI) / 180)
const MAX_NEIGHBORS_PER_SURFEL = 8
const MAX_TRIANGLES_PER_SURFEL = 4
const MIN_TRIANGLE_AREA_SQUARED = 1e-6
const POSITION_EPSILON = 1e-6

function getTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4)
}

function getColoredSurfels(
  reconstruction: FinalizedRealityReconstruction,
): FinalizedRealitySurfel[] {
  return reconstruction.surfels.filter((surfel) => surfel.colorRgb !== null)
}

function writeColor(
  colors: number[] | Float32Array,
  offset: number,
  surfel: FinalizedRealitySurfel,
): void {
  const color = surfel.colorRgb
  if (!color) {
    return
  }
  colors[offset] = srgbToLinear(color.r)
  colors[offset + 1] = srgbToLinear(color.g)
  colors[offset + 2] = srgbToLinear(color.b)
}

function createPointGeometry(surfels: readonly FinalizedRealitySurfel[]): THREE.BufferGeometry {
  const positions = new Float32Array(surfels.length * 3)
  const colors = new Float32Array(surfels.length * 3)
  surfels.forEach((surfel, index) => {
    const offset = index * 3
    positions[offset] = surfel.position.x
    positions[offset + 1] = surfel.position.y
    positions[offset + 2] = surfel.position.z
    writeColor(colors, offset, surfel)
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function getStableTangent(normal: THREE.Vector3, target: THREE.Vector3): void {
  const reference = Math.abs(normal.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0)
  target.crossVectors(reference, normal)
  if (target.lengthSq() <= POSITION_EPSILON) {
    target.set(1, 0, 0).cross(normal)
  }
  target.normalize()
}

function createSplatGeometry(
  surfels: readonly FinalizedRealitySurfel[],
  radiusScale: number,
): THREE.BufferGeometry {
  const verticesPerSurfel = 6
  const positions = new Float32Array(surfels.length * verticesPerSurfel * 3)
  const colors = new Float32Array(surfels.length * verticesPerSurfel * 3)
  const normal = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const bitangent = new THREE.Vector3()
  const corners = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]
  let vertexOffset = 0
  for (const surfel of surfels) {
    normal.set(surfel.normal.x, surfel.normal.y, surfel.normal.z).normalize()
    if (normal.lengthSq() <= POSITION_EPSILON) {
      continue
    }
    getStableTangent(normal, tangent)
    bitangent.crossVectors(normal, tangent).normalize()
    const radius = clamp(
      Math.max(POSITION_EPSILON, surfel.radius) * radiusScale,
      POSITION_EPSILON,
      MAX_VISUAL_RADIUS_METERS,
    )
    const center = new THREE.Vector3(surfel.position.x, surfel.position.y, surfel.position.z)
    corners[0].copy(center).addScaledVector(tangent, -radius).addScaledVector(bitangent, -radius)
    corners[1].copy(center).addScaledVector(tangent, radius).addScaledVector(bitangent, -radius)
    corners[2].copy(center).addScaledVector(tangent, -radius).addScaledVector(bitangent, radius)
    corners[3].copy(center).addScaledVector(tangent, radius).addScaledVector(bitangent, radius)
    const triangleCorners = [corners[0], corners[1], corners[2], corners[1], corners[3], corners[2]]
    for (const corner of triangleCorners) {
      positions[vertexOffset * 3] = corner.x
      positions[vertexOffset * 3 + 1] = corner.y
      positions[vertexOffset * 3 + 2] = corner.z
      writeColor(colors, vertexOffset * 3, surfel)
      vertexOffset += 1
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vertexOffset * 3), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, vertexOffset * 3), 3))
  return geometry
}

function getCellKey(x: number, y: number, z: number): string {
  return `${Math.floor(x / MAX_LOCAL_EDGE_DISTANCE_METERS)}:${Math.floor(y / MAX_LOCAL_EDGE_DISTANCE_METERS)}:${Math.floor(z / MAX_LOCAL_EDGE_DISTANCE_METERS)}`
}

function areLocallyCompatible(
  first: FinalizedRealitySurfel,
  second: FinalizedRealitySurfel,
): { compatible: boolean; distanceSquared: number } {
  const dx = first.position.x - second.position.x
  const dy = first.position.y - second.position.y
  const dz = first.position.z - second.position.z
  const distanceSquared = dx * dx + dy * dy + dz * dz
  if (distanceSquared <= POSITION_EPSILON || distanceSquared > MAX_LOCAL_EDGE_DISTANCE_METERS ** 2) {
    return { compatible: false, distanceSquared }
  }
  const firstNormal = new THREE.Vector3(first.normal.x, first.normal.y, first.normal.z).normalize()
  const secondNormal = new THREE.Vector3(second.normal.x, second.normal.y, second.normal.z).normalize()
  if (firstNormal.dot(secondNormal) < MIN_NORMAL_DOT) {
    return { compatible: false, distanceSquared }
  }
  const firstPlaneResidual = Math.abs(firstNormal.x * dx + firstNormal.y * dy + firstNormal.z * dz)
  const secondPlaneResidual = Math.abs(secondNormal.x * dx + secondNormal.y * dy + secondNormal.z * dz)
  return {
    compatible: firstPlaneResidual <= MAX_LOCAL_PLANE_RESIDUAL_METERS &&
      secondPlaneResidual <= MAX_LOCAL_PLANE_RESIDUAL_METERS,
    distanceSquared,
  }
}

function createDenseTriangleGeometry(
  surfels: readonly FinalizedRealitySurfel[],
): { geometry: THREE.BufferGeometry; triangleCount: number } {
  const sortedSurfels = [...surfels].sort((first, second) => first.id - second.id)
  const cells = new Map<string, number[]>()
  sortedSurfels.forEach((surfel, index) => {
    const key = getCellKey(surfel.position.x, surfel.position.y, surfel.position.z)
    const cell = cells.get(key)
    if (cell) {
      cell.push(index)
    } else {
      cells.set(key, [index])
    }
  })

  const positions: number[] = []
  const colors: number[] = []
  let triangleCount = 0
  for (let index = 0; index < sortedSurfels.length; index += 1) {
    const center = sortedSurfels[index]
    const cellX = Math.floor(center.position.x / MAX_LOCAL_EDGE_DISTANCE_METERS)
    const cellY = Math.floor(center.position.y / MAX_LOCAL_EDGE_DISTANCE_METERS)
    const cellZ = Math.floor(center.position.z / MAX_LOCAL_EDGE_DISTANCE_METERS)
    const neighbors: { index: number; distanceSquared: number }[] = []
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
          const cell = cells.get(`${cellX + offsetX}:${cellY + offsetY}:${cellZ + offsetZ}`)
          if (!cell) {
            continue
          }
          for (const neighborIndex of cell) {
            if (neighborIndex <= index) {
              continue
            }
            const relation = areLocallyCompatible(center, sortedSurfels[neighborIndex])
            if (relation.compatible) {
              neighbors.push({ index: neighborIndex, distanceSquared: relation.distanceSquared })
            }
          }
        }
      }
    }
    neighbors.sort((first, second) => first.distanceSquared - second.distanceSquared || first.index - second.index)
    const boundedNeighbors = neighbors.slice(0, MAX_NEIGHBORS_PER_SURFEL)
    let trianglesForCenter = 0
    for (let firstNeighbor = 0; firstNeighbor < boundedNeighbors.length; firstNeighbor += 1) {
      if (trianglesForCenter >= MAX_TRIANGLES_PER_SURFEL) {
        break
      }
      for (let secondNeighbor = firstNeighbor + 1; secondNeighbor < boundedNeighbors.length; secondNeighbor += 1) {
        if (trianglesForCenter >= MAX_TRIANGLES_PER_SURFEL) {
          break
        }
        const first = sortedSurfels[boundedNeighbors[firstNeighbor].index]
        const second = sortedSurfels[boundedNeighbors[secondNeighbor].index]
        if (!areLocallyCompatible(first, second).compatible) {
          continue
        }
        const edgeA = new THREE.Vector3(
          first.position.x - center.position.x,
          first.position.y - center.position.y,
          first.position.z - center.position.z,
        )
        const edgeB = new THREE.Vector3(
          second.position.x - center.position.x,
          second.position.y - center.position.y,
          second.position.z - center.position.z,
        )
        const cross = new THREE.Vector3().crossVectors(edgeA, edgeB)
        if (cross.lengthSq() <= MIN_TRIANGLE_AREA_SQUARED) {
          continue
        }
        const centerNormal = new THREE.Vector3(center.normal.x, center.normal.y, center.normal.z).normalize()
        const ordered = cross.dot(centerNormal) >= 0
          ? [center, first, second]
          : [center, second, first]
        for (const surfel of ordered) {
          positions.push(surfel.position.x, surfel.position.y, surfel.position.z)
          const color = surfel.colorRgb
          if (color) {
            colors.push(srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b))
          } else {
            colors.push(0, 0, 0)
          }
        }
        triangleCount += 1
        trianglesForCenter += 1
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
  return { geometry, triangleCount }
}

function createPointMaterial(): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    size: RAW_POINT_SIZE_METERS,
    sizeAttenuation: true,
    vertexColors: true,
    toneMapped: false,
  })
}

function createSurfaceMaterial(opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    depthTest: true,
    depthWrite: true,
    opacity,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: opacity < 1,
    vertexColors: true,
  })
}

/** Builds post-scan Reality geometry once; it never changes the measured data. */
export function createRealitySurfaceRenderResources(
  reconstruction: FinalizedRealityReconstruction,
  mode: RealitySurfaceRenderMode,
): RealitySurfaceRenderResources {
  const startedAt = getTimestamp()
  const group = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const coloredSurfels = getColoredSurfels(reconstruction)
  let renderedSplatCount = 0
  let renderedTriangleCount = 0

  if (mode === 'points') {
    const geometry = createPointGeometry(coloredSurfels)
    const material = createPointMaterial()
    group.add(new THREE.Points(geometry, material))
    geometries.push(geometry)
    materials.push(material)
  } else if (mode === 'splats') {
    const geometry = createSplatGeometry(coloredSurfels, SURFEL_VISUAL_RADIUS_SCALE)
    const material = createSurfaceMaterial()
    group.add(new THREE.Mesh(geometry, material))
    geometries.push(geometry)
    materials.push(material)
    renderedSplatCount = coloredSurfels.length
  } else {
    const triangleResult = createDenseTriangleGeometry(coloredSurfels)
    const triangleMaterial = createSurfaceMaterial(0.96)
    group.add(new THREE.Mesh(triangleResult.geometry, triangleMaterial))
    geometries.push(triangleResult.geometry)
    materials.push(triangleMaterial)
    renderedTriangleCount = triangleResult.triangleCount

    const splatGeometry = createSplatGeometry(coloredSurfels, DENSE_SPLAT_RADIUS_SCALE)
    const splatMaterial = createSurfaceMaterial(0.92)
    group.add(new THREE.Mesh(splatGeometry, splatMaterial))
    geometries.push(splatGeometry)
    materials.push(splatMaterial)
    renderedSplatCount = coloredSurfels.length
  }

  return {
    group,
    geometries,
    materials,
    stats: {
      mode,
      sourceSurfelCount: reconstruction.surfels.length,
      coloredSurfelCount: coloredSurfels.length,
      renderedSurfelCount: coloredSurfels.length,
      renderedSplatCount,
      renderedTriangleCount,
      visualRadiusScale: mode === 'dense' ? DENSE_SPLAT_RADIUS_SCALE : mode === 'splats' ? SURFEL_VISUAL_RADIUS_SCALE : 1,
      renderPreparationMs: Math.max(0, getTimestamp() - startedAt),
    },
  }
}

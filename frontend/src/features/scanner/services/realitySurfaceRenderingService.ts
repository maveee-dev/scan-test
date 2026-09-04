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
  readonly neighborIndexBuildMs: number
  readonly splatGeometryMs: number
  readonly triangleGenerationMs: number
  readonly medianNearestNeighborSpacingMeters: number | null
  readonly p90NearestNeighborSpacingMeters: number | null
  readonly estimatedSmallGapRegions: number
  readonly estimatedLargeUnsupportedGaps: number
  readonly memoryBytes: number
}

export interface RealitySurfaceRenderResources {
  readonly group: THREE.Group
  readonly geometries: readonly THREE.BufferGeometry[]
  readonly materials: readonly THREE.Material[]
  readonly stats: RealitySurfaceRenderStats
}

const RAW_POINT_SIZE_METERS = 0.045
const BASE_SPLAT_RADIUS_SCALE = 1.05
const DENSE_SPLAT_RADIUS_SCALE = 1.02
const SPLAT_MINOR_AXIS_SCALE = 0.9
const MIN_VISUAL_RADIUS_METERS = 0.004
const MAX_VISUAL_RADIUS_METERS = 0.055
const MAX_LOCAL_EDGE_DISTANCE_METERS = 0.12
const MAX_TRIANGLE_EDGE_DISTANCE_METERS = 0.1
const MAX_LOCAL_PLANE_RESIDUAL_METERS = 0.028
const MIN_NORMAL_DOT = Math.cos((42 * Math.PI) / 180)
const MAX_NEIGHBORS_PER_SURFEL = 8
const MAX_NEIGHBOR_CANDIDATES_PER_SURFEL = 96
const MAX_TRIANGLES_PER_SURFEL = 4
const MAX_TRIANGLE_EDGE_MULTIPLIER = 2.5
const MIN_TRIANGLE_EDGE_DISTANCE_METERS = 0.05
const MIN_TRIANGLE_AREA_SQUARED = 1e-6
const SMALL_GAP_LIMIT_METERS = 0.055
const LARGE_GAP_LIMIT_METERS = 0.16
const POSITION_EPSILON = 1e-6
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0)

const SPLAT_VERTEX_SHADER = `
attribute vec3 color;
attribute vec2 aSplatLocal;
varying vec3 vColor;
varying vec2 vSplatLocal;

void main() {
  vColor = color;
  vSplatLocal = aSplatLocal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SPLAT_FRAGMENT_SHADER = `
precision mediump float;
uniform float uOpacity;
varying vec3 vColor;
varying vec2 vSplatLocal;

void main() {
  float distanceFromCenter = length(vSplatLocal);
  float edgeAlpha = 1.0 - smoothstep(0.72, 1.0, distanceFromCenter);
  if (edgeAlpha <= 0.01) {
    discard;
  }
  gl_FragColor = vec4(vColor, edgeAlpha * uOpacity);
}
`

const SPLAT_TRIANGLE_INDICES = [0, 1, 2, 1, 3, 2]
const SPLAT_LOCAL_COORDINATES = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const

interface NeighborCandidate {
  readonly index: number
  readonly distanceSquared: number
}

interface RealityNeighborIndex {
  readonly surfels: readonly FinalizedRealitySurfel[]
  readonly neighbors: readonly NeighborCandidate[][]
  readonly nearestSpacingMeters: Float32Array
  readonly medianNearestNeighborSpacingMeters: number | null
  readonly p90NearestNeighborSpacingMeters: number | null
  readonly estimatedSmallGapRegions: number
  readonly estimatedLargeUnsupportedGaps: number
  readonly buildMs: number
}

interface SplatGeometryResult {
  readonly geometry: THREE.BufferGeometry
  readonly renderedSplatCount: number
  readonly averageVisualRadiusScale: number
}

interface TriangleGeometryResult {
  readonly geometry: THREE.BufferGeometry
  readonly triangleCount: number
}

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
  return reconstruction.surfels
    .filter((surfel) => surfel.colorRgb !== null)
    .sort((first, second) => first.id - second.id)
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
  if (Math.abs(normal.y) < 0.9) {
    target.crossVectors(WORLD_UP, normal)
  } else {
    target.crossVectors(WORLD_RIGHT, normal)
  }
  if (target.lengthSq() <= POSITION_EPSILON) {
    target.set(1, 0, 0).cross(normal)
  }
  target.normalize()
}

function getCellKey(x: number, y: number, z: number): string {
  return `${Math.floor(x / MAX_LOCAL_EDGE_DISTANCE_METERS)}:${Math.floor(y / MAX_LOCAL_EDGE_DISTANCE_METERS)}:${Math.floor(z / MAX_LOCAL_EDGE_DISTANCE_METERS)}`
}

function getDistanceSquared(first: FinalizedRealitySurfel, second: FinalizedRealitySurfel): number {
  const dx = first.position.x - second.position.x
  const dy = first.position.y - second.position.y
  const dz = first.position.z - second.position.z
  return dx * dx + dy * dy + dz * dz
}

function areLocallyCompatible(
  first: FinalizedRealitySurfel,
  second: FinalizedRealitySurfel,
): { compatible: boolean; distanceSquared: number } {
  const distanceSquared = getDistanceSquared(first, second)
  if (distanceSquared <= POSITION_EPSILON || distanceSquared > MAX_LOCAL_EDGE_DISTANCE_METERS ** 2) {
    return { compatible: false, distanceSquared }
  }

  const firstNormalLength = Math.hypot(first.normal.x, first.normal.y, first.normal.z)
  const secondNormalLength = Math.hypot(second.normal.x, second.normal.y, second.normal.z)
  if (firstNormalLength <= POSITION_EPSILON || secondNormalLength <= POSITION_EPSILON) {
    return { compatible: false, distanceSquared }
  }

  const normalDot = (
    first.normal.x * second.normal.x +
    first.normal.y * second.normal.y +
    first.normal.z * second.normal.z
  ) / (firstNormalLength * secondNormalLength)
  if (normalDot < MIN_NORMAL_DOT) {
    return { compatible: false, distanceSquared }
  }

  const dx = second.position.x - first.position.x
  const dy = second.position.y - first.position.y
  const dz = second.position.z - first.position.z
  const firstPlaneResidual = Math.abs(
    (first.normal.x * dx + first.normal.y * dy + first.normal.z * dz) / firstNormalLength,
  )
  const secondPlaneResidual = Math.abs(
    (second.normal.x * dx + second.normal.y * dy + second.normal.z * dz) / secondNormalLength,
  )
  return {
    compatible: firstPlaneResidual <= MAX_LOCAL_PLANE_RESIDUAL_METERS &&
      secondPlaneResidual <= MAX_LOCAL_PLANE_RESIDUAL_METERS,
    distanceSquared,
  }
}

function compareNeighbors(first: NeighborCandidate, second: NeighborCandidate): number {
  return first.distanceSquared - second.distanceSquared || first.index - second.index
}

function insertBoundedNeighbor(
  neighbors: NeighborCandidate[],
  candidate: NeighborCandidate,
): void {
  if (neighbors.length >= MAX_NEIGHBORS_PER_SURFEL) {
    const last = neighbors[neighbors.length - 1]
    if (last && compareNeighbors(candidate, last) >= 0) {
      return
    }
  }
  neighbors.push(candidate)
  neighbors.sort(compareNeighbors)
  if (neighbors.length > MAX_NEIGHBORS_PER_SURFEL) {
    neighbors.pop()
  }
}

function calculatePercentile(values: number[], percentile: number): number | null {
  if (values.length === 0) {
    return null
  }
  values.sort((left, right) => left - right)
  const position = (values.length - 1) * percentile
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = values[lowerIndex] ?? values[values.length - 1]
  const upper = values[upperIndex] ?? lower
  return lower + (upper - lower) * (position - lowerIndex)
}

function buildRealityNeighborIndex(
  surfels: readonly FinalizedRealitySurfel[],
): RealityNeighborIndex {
  const startedAt = getTimestamp()
  const sortedSurfels = [...surfels].sort((first, second) => first.id - second.id)
  const cells = new Map<string, number[]>()
  const neighbors = Array.from({ length: sortedSurfels.length }, () => []) as NeighborCandidate[][]
  for (let index = 0; index < sortedSurfels.length; index += 1) {
    const surfel = sortedSurfels[index]
    const key = getCellKey(surfel.position.x, surfel.position.y, surfel.position.z)
    const cell = cells.get(key)
    if (cell) {
      cell.push(index)
    } else {
      cells.set(key, [index])
    }
  }

  for (let index = 0; index < sortedSurfels.length; index += 1) {
    const center = sortedSurfels[index]
    const cellX = Math.floor(center.position.x / MAX_LOCAL_EDGE_DISTANCE_METERS)
    const cellY = Math.floor(center.position.y / MAX_LOCAL_EDGE_DISTANCE_METERS)
    const cellZ = Math.floor(center.position.z / MAX_LOCAL_EDGE_DISTANCE_METERS)
    let candidateChecks = 0
    neighborCells:
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
          const cell = cells.get(`${cellX + offsetX}:${cellY + offsetY}:${cellZ + offsetZ}`)
          if (!cell) {
            continue
          }
          for (const neighborIndex of cell) {
            if (candidateChecks >= MAX_NEIGHBOR_CANDIDATES_PER_SURFEL) {
              break neighborCells
            }
            candidateChecks += 1
            if (neighborIndex <= index) {
              continue
            }
            const relation = areLocallyCompatible(center, sortedSurfels[neighborIndex])
            if (!relation.compatible) {
              continue
            }
            insertBoundedNeighbor(neighbors[index], {
              index: neighborIndex,
              distanceSquared: relation.distanceSquared,
            })
            insertBoundedNeighbor(neighbors[neighborIndex], {
              index,
              distanceSquared: relation.distanceSquared,
            })
          }
        }
      }
    }
  }

  const nearestSpacingMeters = new Float32Array(sortedSurfels.length)
  nearestSpacingMeters.fill(Infinity)
  const nearestDistances: number[] = []
  let estimatedSmallGapRegions = 0
  let estimatedLargeUnsupportedGaps = 0
  for (let index = 0; index < sortedSurfels.length; index += 1) {
    const nearest = neighbors[index][0]
    if (!nearest) {
      estimatedLargeUnsupportedGaps += 1
      continue
    }
    const nearestDistance = Math.sqrt(nearest.distanceSquared)
    nearestSpacingMeters[index] = nearestDistance
    nearestDistances.push(nearestDistance)
    const gap = nearestDistance - sortedSurfels[index].radius * 2
    if (gap > 0 && gap <= SMALL_GAP_LIMIT_METERS) {
      estimatedSmallGapRegions += 1
    } else if (gap > LARGE_GAP_LIMIT_METERS) {
      estimatedLargeUnsupportedGaps += 1
    }
  }

  return {
    surfels: sortedSurfels,
    neighbors,
    nearestSpacingMeters,
    medianNearestNeighborSpacingMeters: calculatePercentile(nearestDistances, 0.5),
    p90NearestNeighborSpacingMeters: calculatePercentile(nearestDistances, 0.9),
    estimatedSmallGapRegions,
    estimatedLargeUnsupportedGaps,
    buildMs: Math.max(0, getTimestamp() - startedAt),
  }
}

function getAdaptiveVisualRadius(
  surfel: FinalizedRealitySurfel,
  index: RealityNeighborIndex,
  surfelIndex: number,
  baseScale: number,
): { radius: number; scale: number } {
  const measuredRadius = Math.max(POSITION_EPSILON, surfel.radius)
  const baseRadius = clamp(
    measuredRadius * baseScale,
    MIN_VISUAL_RADIUS_METERS,
    MAX_VISUAL_RADIUS_METERS,
  )
  const nearestSpacing = index.nearestSpacingMeters[surfelIndex]
  if (!Number.isFinite(nearestSpacing)) {
    return { radius: baseRadius, scale: baseRadius / measuredRadius }
  }

  const desiredScale = 1 + ((nearestSpacing / Math.max(POSITION_EPSILON, baseRadius * 2)) - 1) * 0.42
  const densityScale = clamp(desiredScale, 0.82, 1.18)
  const radius = clamp(
    baseRadius * densityScale,
    MIN_VISUAL_RADIUS_METERS,
    MAX_VISUAL_RADIUS_METERS,
  )
  return { radius, scale: radius / measuredRadius }
}

function createSplatGeometry(
  index: RealityNeighborIndex,
  radiusScale: number,
): SplatGeometryResult {
  const surfels = index.surfels
  const verticesPerSurfel = 6
  const positions = new Float32Array(surfels.length * verticesPerSurfel * 3)
  const colors = new Float32Array(surfels.length * verticesPerSurfel * 3)
  const localCoordinates = new Float32Array(surfels.length * verticesPerSurfel * 2)
  const normal = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const bitangent = new THREE.Vector3()
  const center = new THREE.Vector3()
  const corner = new THREE.Vector3()
  const corners = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]
  let vertexOffset = 0
  let radiusScaleTotal = 0
  let renderedSplatCount = 0

  for (let surfelIndex = 0; surfelIndex < surfels.length; surfelIndex += 1) {
    const surfel = surfels[surfelIndex]
    normal.set(surfel.normal.x, surfel.normal.y, surfel.normal.z)
    if (normal.lengthSq() <= POSITION_EPSILON) {
      continue
    }
    normal.normalize()
    getStableTangent(normal, tangent)
    bitangent.crossVectors(normal, tangent).normalize()
    const adaptiveRadius = getAdaptiveVisualRadius(surfel, index, surfelIndex, radiusScale)
    const radiusU = adaptiveRadius.radius
    const radiusV = adaptiveRadius.radius * SPLAT_MINOR_AXIS_SCALE
    radiusScaleTotal += adaptiveRadius.scale
    renderedSplatCount += 1
    center.set(surfel.position.x, surfel.position.y, surfel.position.z)
    corners[0].copy(center).addScaledVector(tangent, -radiusU).addScaledVector(bitangent, -radiusV)
    corners[1].copy(center).addScaledVector(tangent, radiusU).addScaledVector(bitangent, -radiusV)
    corners[2].copy(center).addScaledVector(tangent, -radiusU).addScaledVector(bitangent, radiusV)
    corners[3].copy(center).addScaledVector(tangent, radiusU).addScaledVector(bitangent, radiusV)
    for (const cornerIndex of SPLAT_TRIANGLE_INDICES) {
      corner.copy(corners[cornerIndex])
      const coordinate = SPLAT_LOCAL_COORDINATES[cornerIndex]
      const positionOffset = vertexOffset * 3
      const localOffset = vertexOffset * 2
      positions[positionOffset] = corner.x
      positions[positionOffset + 1] = corner.y
      positions[positionOffset + 2] = corner.z
      localCoordinates[localOffset] = coordinate[0]
      localCoordinates[localOffset + 1] = coordinate[1]
      writeColor(colors, positionOffset, surfel)
      vertexOffset += 1
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vertexOffset * 3), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, vertexOffset * 3), 3))
  geometry.setAttribute('aSplatLocal', new THREE.BufferAttribute(localCoordinates.subarray(0, vertexOffset * 2), 2))
  return {
    geometry,
    renderedSplatCount,
    averageVisualRadiusScale: renderedSplatCount > 0 ? radiusScaleTotal / renderedSplatCount : 1,
  }
}

function getTriangleEdgeLimit(
  center: FinalizedRealitySurfel,
  nearestSpacing: number,
): number {
  const measuredRadius = Math.max(POSITION_EPSILON, center.radius)
  const localLimit = Number.isFinite(nearestSpacing)
    ? nearestSpacing * MAX_TRIANGLE_EDGE_MULTIPLIER
    : MAX_TRIANGLE_EDGE_DISTANCE_METERS
  const minimumEdgeLimit = Math.min(
    MAX_TRIANGLE_EDGE_DISTANCE_METERS,
    Math.max(MIN_TRIANGLE_EDGE_DISTANCE_METERS, measuredRadius * 2.5),
  )
  return clamp(
    localLimit,
    minimumEdgeLimit,
    MAX_TRIANGLE_EDGE_DISTANCE_METERS,
  )
}

function createDenseTriangleGeometry(index: RealityNeighborIndex): TriangleGeometryResult {
  const surfels = index.surfels
  const positions: number[] = []
  const colors: number[] = []
  const centerNormal = new THREE.Vector3()
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const cross = new THREE.Vector3()
  let triangleCount = 0

  for (let centerIndex = 0; centerIndex < surfels.length; centerIndex += 1) {
    const center = surfels[centerIndex]
    centerNormal.set(center.normal.x, center.normal.y, center.normal.z)
    if (centerNormal.lengthSq() <= POSITION_EPSILON) {
      continue
    }
    centerNormal.normalize()
    const edgeLimit = getTriangleEdgeLimit(
      center,
      index.nearestSpacingMeters[centerIndex],
    )
    const boundedNeighbors = index.neighbors[centerIndex].filter(
      (neighbor) => neighbor.distanceSquared <= edgeLimit ** 2,
    )
    let trianglesForCenter = 0
    for (let firstNeighborIndex = 0; firstNeighborIndex < boundedNeighbors.length; firstNeighborIndex += 1) {
      if (trianglesForCenter >= MAX_TRIANGLES_PER_SURFEL) {
        break
      }
      for (let secondNeighborIndex = firstNeighborIndex + 1; secondNeighborIndex < boundedNeighbors.length; secondNeighborIndex += 1) {
        if (trianglesForCenter >= MAX_TRIANGLES_PER_SURFEL) {
          break
        }
        const firstNeighbor = boundedNeighbors[firstNeighborIndex]
        const secondNeighbor = boundedNeighbors[secondNeighborIndex]
        const first = surfels[firstNeighbor.index]
        const second = surfels[secondNeighbor.index]
        const pairRelation = areLocallyCompatible(first, second)
        if (!pairRelation.compatible || pairRelation.distanceSquared > edgeLimit ** 2) {
          continue
        }
        edgeA.set(
          first.position.x - center.position.x,
          first.position.y - center.position.y,
          first.position.z - center.position.z,
        )
        edgeB.set(
          second.position.x - center.position.x,
          second.position.y - center.position.y,
          second.position.z - center.position.z,
        )
        cross.crossVectors(edgeA, edgeB)
        if (cross.lengthSq() <= MIN_TRIANGLE_AREA_SQUARED) {
          continue
        }
        const ordered = cross.dot(centerNormal) >= 0
          ? [center, first, second]
          : [center, second, first]
        for (const surfel of ordered) {
          positions.push(surfel.position.x, surfel.position.y, surfel.position.z)
          writeColor(colors, colors.length, surfel)
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
    color: 0xffffff,
    depthTest: true,
    depthWrite: true,
    size: RAW_POINT_SIZE_METERS,
    sizeAttenuation: true,
    vertexColors: true,
  })
}

function createSplatMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SPLAT_VERTEX_SHADER,
    fragmentShader: SPLAT_FRAGMENT_SHADER,
    uniforms: {
      uOpacity: { value: opacity },
    },
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    transparent: true,
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

function getGeometryMemoryBytes(geometry: THREE.BufferGeometry): number {
  return Object.values(geometry.attributes).reduce(
    (total, attribute) => total + (attribute.array as ArrayBufferView).byteLength,
    0,
  )
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
  const shouldBuildNeighborIndex = mode === 'splats' || mode === 'dense'
  const neighborIndex = shouldBuildNeighborIndex
    ? buildRealityNeighborIndex(coloredSurfels)
    : null
  let renderedSplatCount = 0
  let renderedTriangleCount = 0
  let visualRadiusScale = 1
  let splatGeometryMs = 0
  let triangleGenerationMs = 0

  if (mode === 'points') {
    const geometry = createPointGeometry(coloredSurfels)
    const material = createPointMaterial()
    group.add(new THREE.Points(geometry, material))
    geometries.push(geometry)
    materials.push(material)
  } else if (neighborIndex) {
    if (mode === 'dense') {
      const triangleStartedAt = getTimestamp()
      const triangleResult = createDenseTriangleGeometry(neighborIndex)
      triangleGenerationMs = Math.max(0, getTimestamp() - triangleStartedAt)
      const triangleMaterial = createSurfaceMaterial(0.96)
      group.add(new THREE.Mesh(triangleResult.geometry, triangleMaterial))
      geometries.push(triangleResult.geometry)
      materials.push(triangleMaterial)
      renderedTriangleCount = triangleResult.triangleCount
    }

    const splatStartedAt = getTimestamp()
    const splatResult = createSplatGeometry(
      neighborIndex,
      mode === 'dense' ? DENSE_SPLAT_RADIUS_SCALE : BASE_SPLAT_RADIUS_SCALE,
    )
    splatGeometryMs = Math.max(0, getTimestamp() - splatStartedAt)
    const splatMaterial = createSplatMaterial(mode === 'dense' ? 0.92 : 1)
    group.add(new THREE.Mesh(splatResult.geometry, splatMaterial))
    geometries.push(splatResult.geometry)
    materials.push(splatMaterial)
    renderedSplatCount = splatResult.renderedSplatCount
    visualRadiusScale = splatResult.averageVisualRadiusScale
  }

  const memoryBytes = geometries.reduce(
    (total, geometry) => total + getGeometryMemoryBytes(geometry),
    0,
  )
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
      visualRadiusScale,
      renderPreparationMs: Math.max(0, getTimestamp() - startedAt),
      neighborIndexBuildMs: neighborIndex?.buildMs ?? 0,
      splatGeometryMs,
      triangleGenerationMs,
      medianNearestNeighborSpacingMeters: neighborIndex?.medianNearestNeighborSpacingMeters ?? null,
      p90NearestNeighborSpacingMeters: neighborIndex?.p90NearestNeighborSpacingMeters ?? null,
      estimatedSmallGapRegions: neighborIndex?.estimatedSmallGapRegions ?? 0,
      estimatedLargeUnsupportedGaps: neighborIndex?.estimatedLargeUnsupportedGaps ?? 0,
      memoryBytes,
    },
  }
}

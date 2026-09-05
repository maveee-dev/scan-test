import * as THREE from 'three'
import { findRealityNeighbors } from './realityNeighborSearchService'
import type {
  FinalizedRealityReconstruction,
  FinalizedRealitySurfel,
  RealityColorStatistics,
  RealityRgbColor,
} from '../types'
import type { RealityDesignCompositeMode, RealityDesignCompositorStats, RealityPaintablePatchMask } from './realityDesignCompositingService'
import type { RealityWallTriangleAssociation } from './realityWallTriangleAssociationService'

export type RealitySurfaceRenderMode = 'points' | 'splats' | 'triangles' | 'dense'

export interface RealitySurfaceRenderStats {
  readonly mode: RealitySurfaceRenderMode
  readonly sourceSurfelCount: number
  readonly coloredSurfelCount: number
  readonly renderedSurfelCount: number
  readonly renderedSplatCount: number
  readonly renderedTriangleCount: number
  readonly coloredTriangleVertexCount: number
  readonly uncoloredTriangleVertexCount: number
  readonly fallbackSplatCount: number
  readonly uncoloredFallbackSplatCount: number
  readonly splatsSuppressedByTriangles: number
  readonly visualRadiusScale: number
  readonly renderPreparationMs: number
  readonly neighborIndexBuildMs: number
  readonly neighborAnalysisMs: number
  readonly distribution: RealityDistributionDiagnostics | null
  readonly triangleParticipantCount: number
  readonly triangleParticipationPercentage: number
  readonly fallbackPercentage: number
  readonly splatGeometryMs: number
  readonly triangleGenerationMs: number
  readonly medianNearestNeighborSpacingMeters: number | null
  readonly p90NearestNeighborSpacingMeters: number | null
  readonly estimatedSmallGapRegions: number
  readonly estimatedLargeUnsupportedGaps: number
  readonly memoryBytes: number
  readonly renderColorStatistics: RealityColorStatistics
}

export interface RealitySurfaceRenderResources {
  readonly group: THREE.Group
  readonly geometries: readonly THREE.BufferGeometry[]
  readonly materials: readonly THREE.Material[]
  readonly stats: RealitySurfaceRenderStats
  readonly triangleTopology: RealityTriangleTopology | null
  readonly triangleGeometry: THREE.BufferGeometry | null
}

/** Exact source identities for unindexed Dense Reality triangle vertices. */
export interface RealityTriangleTopology {
  readonly vertexSurfelIds: Uint32Array
  readonly triangleCount: number
}

// Small enough to inspect the measured 2.5 cm lattice without splat-like overlap.
const RAW_POINT_SIZE_METERS = 0.008
const BASE_SPLAT_RADIUS_SCALE = 1.05
const DENSE_SPLAT_RADIUS_SCALE = 1.02
const SPLAT_MINOR_AXIS_SCALE = 0.95
const MIN_VISUAL_RADIUS_METERS = 0.004
const MAX_VISUAL_RADIUS_METERS = 0.055
const MAX_LOCAL_EDGE_DISTANCE_METERS = 0.12
const MAX_TRIANGLE_EDGE_DISTANCE_METERS = 0.1
const MAX_LOCAL_PLANE_RESIDUAL_METERS = 0.028
const MIN_NORMAL_DOT = Math.cos((42 * Math.PI) / 180)
const MAX_NEIGHBORS_PER_SURFEL = 8
const MAX_TRIANGLE_EDGE_MULTIPLIER = 2.5
const MIN_TRIANGLE_EDGE_DISTANCE_METERS = 0.05
// Scale-relative degeneracy, not a structural-scale area gate: the former
// 1e-6 cross-length-squared gate rejected valid 2.5 cm right triangles (3.9e-7).
const MIN_TRIANGLE_SINE_SQUARED = 0.01
const SMALL_GAP_LIMIT_METERS = 0.055
const LARGE_GAP_LIMIT_METERS = 0.16
const POSITION_EPSILON = 1e-6
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0)
const SPLAT_CORE_RADIUS = 0.82
const SPLAT_FEATHER_START = 0.76
const SPLAT_FEATHER_END = 0.99
const SPLAT_ALPHA_THRESHOLD = 0.18
const MAX_ADAPTIVE_EXPANSION_SCALE = 1.3
const SPLAT_OVERLAP_MARGIN = 1.04

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
uniform float uCorePass;
varying vec3 vColor;
varying vec2 vSplatLocal;

void main() {
  float distanceFromCenter = length(vSplatLocal);
  if (uCorePass > 0.5) {
    if (distanceFromCenter > ${SPLAT_CORE_RADIUS.toFixed(3)}) {
      discard;
    }
    gl_FragColor = vec4(vColor, 1.0);
  } else {
    if (distanceFromCenter < ${SPLAT_CORE_RADIUS.toFixed(3)}) {
      discard;
    }
    float edgeAlpha = 1.0 - smoothstep(${SPLAT_FEATHER_START.toFixed(3)}, ${SPLAT_FEATHER_END.toFixed(3)}, distanceFromCenter);
    if (edgeAlpha < ${SPLAT_ALPHA_THRESHOLD.toFixed(3)}) {
      discard;
    }
    gl_FragColor = vec4(vColor, edgeAlpha * uOpacity);
  }
  // Match MeshBasicMaterial: vertex RGB is linear, display output is sRGB.
  #include <colorspace_fragment>
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
  readonly spatialIndexMs: number
  readonly neighborAnalysisMs: number
  readonly distribution: RealityDistributionDiagnostics
}

export interface RealityDistributionDiagnostics {
  /** Folded tangent angles [0, pi), 12 bins. Not a reconstruction quality score. */
  readonly directionBins: readonly number[]
  /** Nearest compatible spacing in 5 mm bins, clamped at 12 cm. */
  readonly spacingBins: readonly number[]
  readonly dominantSpacingMeters: number | null
  readonly medianTangentUSpacing: number | null
  readonly medianTangentVSpacing: number | null
  readonly anisotropyRatio: number | null
  readonly missingTangentU: number
  readonly missingTangentV: number
  readonly truncatedQueries: number
  readonly darkRgbSamples: number
}

interface SplatGeometryResult {
  readonly geometry: THREE.BufferGeometry
  readonly renderedSplatCount: number
  readonly suppressedSplatCount: number
  readonly averageVisualRadiusScale: number
}

interface TriangleGeometryResult {
  readonly geometry: THREE.BufferGeometry
  readonly triangleCount: number
  readonly coveredSurfelIndices: Uint8Array
  readonly coveredSurfelCount: number
  readonly topology: RealityTriangleTopology
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
  reconstruction: Pick<FinalizedRealityReconstruction, 'surfels'>,
): FinalizedRealitySurfel[] {
  return reconstruction.surfels
    .filter((surfel) => surfel.colorRgb !== null)
    .sort((first, second) => first.id - second.id)
}

function writeColor(
  colors: number[] | Float32Array,
  offset: number,
  surfel: FinalizedRealitySurfel,
  displayColors?: ReadonlyMap<number, RealityRgbColor>,
): void {
  const linearDisplayColor = displayColors?.get(surfel.id)
  if (linearDisplayColor) {
    colors[offset] = linearDisplayColor.r
    colors[offset + 1] = linearDisplayColor.g
    colors[offset + 2] = linearDisplayColor.b
    return
  }
  const color = surfel.colorRgb
  if (!color) {
    return
  }
  colors[offset] = srgbToLinear(color.r)
  colors[offset + 1] = srgbToLinear(color.g)
  colors[offset + 2] = srgbToLinear(color.b)
}

function createEmptyColorStatistics(colorSpace: 'srgb' | 'linear'): RealityColorStatistics {
  return {
    colorSpace,
    sampleCount: 0,
    min: { r: 0, g: 0, b: 0 },
    max: { r: 0, g: 0, b: 0 },
    mean: { r: 0, g: 0, b: 0 },
    nonWhiteSampleCount: 0,
    uniqueApproximateColorCount: 0,
  }
}

function calculateRenderColorStatistics(
  geometries: readonly THREE.BufferGeometry[],
): RealityColorStatistics {
  let sampleCount = 0
  let nonWhiteSampleCount = 0
  let redTotal = 0
  let greenTotal = 0
  let blueTotal = 0
  let minRed = Infinity
  let minGreen = Infinity
  let minBlue = Infinity
  let maxRed = -Infinity
  let maxGreen = -Infinity
  let maxBlue = -Infinity
  const uniqueColors = new Set<string>()
  const visited = new Set<THREE.BufferGeometry>()

  for (const geometry of geometries) {
    if (visited.has(geometry)) {
      continue
    }
    visited.add(geometry)
    const attribute = geometry.getAttribute('color')
    if (!attribute) {
      continue
    }
    for (let index = 0; index < attribute.count; index += 1) {
      const red = attribute.getX(index)
      const green = attribute.getY(index)
      const blue = attribute.getZ(index)
      sampleCount += 1
      redTotal += red
      greenTotal += green
      blueTotal += blue
      minRed = Math.min(minRed, red)
      minGreen = Math.min(minGreen, green)
      minBlue = Math.min(minBlue, blue)
      maxRed = Math.max(maxRed, red)
      maxGreen = Math.max(maxGreen, green)
      maxBlue = Math.max(maxBlue, blue)
      if (Math.min(red, green, blue) < 0.98 || Math.max(red, green, blue) - Math.min(red, green, blue) > 0.01) {
        nonWhiteSampleCount += 1
      }
      if (uniqueColors.size < 1024) {
        uniqueColors.add(`${Math.round(red * 31)}:${Math.round(green * 31)}:${Math.round(blue * 31)}`)
      }
    }
  }

  if (sampleCount === 0) {
    return createEmptyColorStatistics('linear')
  }

  return {
    colorSpace: 'linear',
    sampleCount,
    min: { r: minRed, g: minGreen, b: minBlue },
    max: { r: maxRed, g: maxGreen, b: maxBlue },
    mean: {
      r: redTotal / sampleCount,
      g: greenTotal / sampleCount,
      b: blueTotal / sampleCount,
    },
    nonWhiteSampleCount,
    uniqueApproximateColorCount: uniqueColors.size,
  }
}

function createPointGeometry(surfels: readonly FinalizedRealitySurfel[], displayColors?: ReadonlyMap<number, RealityRgbColor>): THREE.BufferGeometry {
  const positions = new Float32Array(surfels.length * 3)
  const colors = new Float32Array(surfels.length * 3)
  surfels.forEach((surfel, index) => {
    const offset = index * 3
    positions[offset] = surfel.position.x
    positions[offset + 1] = surfel.position.y
    positions[offset + 2] = surfel.position.z
    writeColor(colors, offset, surfel, displayColors)
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
  const search = findRealityNeighbors(sortedSurfels, MAX_LOCAL_EDGE_DISTANCE_METERS,
    MAX_NEIGHBORS_PER_SURFEL, (a, b) => areLocallyCompatible(a, b).compatible)
  const neighbors = search.neighbors
  const distributionStarted = getTimestamp()
  const directionBins = Array<number>(12).fill(0)
  const spacingBins = Array<number>(25).fill(0)
  const uSpacing: number[] = [], vSpacing: number[] = []
  const normal = new THREE.Vector3(), tangent = new THREE.Vector3(), bitangent = new THREE.Vector3()
  let missingTangentU = 0, missingTangentV = 0, darkRgbSamples = 0

  const nearestSpacingMeters = new Float32Array(sortedSurfels.length)
  nearestSpacingMeters.fill(Infinity)
  const nearestDistances: number[] = []
  let estimatedSmallGapRegions = 0
  let estimatedLargeUnsupportedGaps = 0
  for (let index = 0; index < sortedSurfels.length; index += 1) {
    const nearest = neighbors[index][0]
    const surfel = sortedSurfels[index]
    if (surfel.colorRgb && Math.max(surfel.colorRgb.r, surfel.colorRgb.g, surfel.colorRgb.b) < 0.08) darkRgbSamples++
    normal.set(surfel.normal.x, surfel.normal.y, surfel.normal.z).normalize()
    getStableTangent(normal, tangent)
    bitangent.crossVectors(normal, tangent)
    let nearestU = Infinity, nearestV = Infinity
    for (const neighbor of neighbors[index]) {
      const point = sortedSurfels[neighbor.index].position
      const dx = point.x - surfel.position.x, dy = point.y - surfel.position.y, dz = point.z - surfel.position.z
      const u = dx * tangent.x + dy * tangent.y + dz * tangent.z
      const v = dx * bitangent.x + dy * bitangent.y + dz * bitangent.z
      const angle = (Math.atan2(v, u) + Math.PI) % Math.PI
      directionBins[Math.min(11, Math.floor(angle / Math.PI * 12))]++
      // Nearest link inside each +/-22.5 degree tangent-axis cone.
      if (Math.abs(v) <= Math.abs(u) * Math.tan(Math.PI / 8)) nearestU = Math.min(nearestU, Math.abs(u))
      if (Math.abs(u) <= Math.abs(v) * Math.tan(Math.PI / 8)) nearestV = Math.min(nearestV, Math.abs(v))
    }
    if (Number.isFinite(nearestU)) uSpacing.push(nearestU); else missingTangentU++
    if (Number.isFinite(nearestV)) vSpacing.push(nearestV); else missingTangentV++
    if (!nearest) {
      estimatedLargeUnsupportedGaps += 1
      continue
    }
    const nearestDistance = Math.sqrt(nearest.distanceSquared)
    nearestSpacingMeters[index] = nearestDistance
    nearestDistances.push(nearestDistance)
    spacingBins[Math.min(24, Math.floor((nearestDistance + 1e-9) / .005))]++
    const gap = nearestDistance - sortedSurfels[index].radius * 2
    if (gap > 0 && gap <= SMALL_GAP_LIMIT_METERS) {
      estimatedSmallGapRegions += 1
    } else if (gap > LARGE_GAP_LIMIT_METERS) {
      estimatedLargeUnsupportedGaps += 1
    }
  }

  const medianU = calculatePercentile(uSpacing, .5), medianV = calculatePercentile(vSpacing, .5)
  const peak = spacingBins.indexOf(Math.max(...spacingBins))
  return {
    surfels: sortedSurfels,
    neighbors,
    nearestSpacingMeters,
    medianNearestNeighborSpacingMeters: calculatePercentile(nearestDistances, 0.5),
    p90NearestNeighborSpacingMeters: calculatePercentile(nearestDistances, 0.9),
    estimatedSmallGapRegions,
    estimatedLargeUnsupportedGaps,
    buildMs: Math.max(0, getTimestamp() - startedAt),
    spatialIndexMs: search.spatialIndexMs,
    neighborAnalysisMs: search.neighborAnalysisMs + getTimestamp() - distributionStarted,
    distribution: {
      directionBins, spacingBins, dominantSpacingMeters: nearestDistances.length ? peak * .005 : null,
      medianTangentUSpacing: medianU, medianTangentVSpacing: medianV,
      anisotropyRatio: medianU && medianV ? Math.max(medianU, medianV) / Math.min(medianU, medianV) : null,
      missingTangentU, missingTangentV, truncatedQueries: search.truncatedQueries, darkRgbSamples,
    },
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

  const coverageRadius = (nearestSpacing / (2 * SPLAT_MINOR_AXIS_SCALE)) * SPLAT_OVERLAP_MARGIN
  const maxAdaptiveRadius = Math.min(
    MAX_VISUAL_RADIUS_METERS,
    baseRadius * MAX_ADAPTIVE_EXPANSION_SCALE,
  )
  const radius = clamp(
    Math.max(baseRadius, Math.min(maxAdaptiveRadius, coverageRadius)),
    MIN_VISUAL_RADIUS_METERS,
    MAX_VISUAL_RADIUS_METERS,
  )
  return { radius, scale: radius / measuredRadius }
}

function createSplatGeometry(
  index: RealityNeighborIndex,
  radiusScale: number,
  splatSuppressionMask?: Uint8Array,
  displayColors?: ReadonlyMap<number, RealityRgbColor>,
): SplatGeometryResult {
  const surfels = index.surfels
  const verticesPerSurfel = 6
  let splatCapacity = surfels.length
  if (splatSuppressionMask) {
    splatCapacity = 0
    for (const suppressed of splatSuppressionMask) if (!suppressed) splatCapacity++
  }
  const positions = new Float32Array(splatCapacity * verticesPerSurfel * 3)
  const colors = new Float32Array(splatCapacity * verticesPerSurfel * 3)
  const localCoordinates = new Float32Array(splatCapacity * verticesPerSurfel * 2)
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
  let suppressedSplatCount = 0

  for (let surfelIndex = 0; surfelIndex < surfels.length; surfelIndex += 1) {
    if (splatSuppressionMask?.[surfelIndex] === 1) {
      suppressedSplatCount += 1
      continue
    }
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
      writeColor(colors, positionOffset, surfel, displayColors)
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
    suppressedSplatCount,
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

function createDenseTriangleGeometry(index: RealityNeighborIndex, displayColors?: ReadonlyMap<number, RealityRgbColor>): TriangleGeometryResult {
  const surfels = index.surfels
  const positions: number[] = []
  const colors: number[] = []
  const vertexSurfelIds: number[] = []
  const centerNormal = new THREE.Vector3()
  const edgeA = new THREE.Vector3()
  const edgeB = new THREE.Vector3()
  const cross = new THREE.Vector3()
  const coveredSurfelIndices = new Uint8Array(surfels.length)
  const emitted = new Set<string>()
  const tangent = new THREE.Vector3(), bitangent = new THREE.Vector3()
  let triangleCount = 0
  let coveredSurfelCount = 0

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
    getStableTangent(centerNormal, tangent)
    bitangent.crossVectors(centerNormal, tangent)
    const boundedNeighbors = index.neighbors[centerIndex]
      .filter((neighbor) => neighbor.distanceSquared <= edgeLimit ** 2)
      .map((neighbor) => {
        const p = surfels[neighbor.index].position
        const dx = p.x - center.position.x, dy = p.y - center.position.y, dz = p.z - center.position.z
        const u = dx * tangent.x + dy * tangent.y + dz * tangent.z
        const v = dx * bitangent.x + dy * bitangent.y + dz * bitangent.z
        return { ...neighbor, u, v, angle: Math.atan2(v, u) }
      }).sort((a, b) => a.angle - b.angle || a.distanceSquared - b.distanceSquared)
    // Local empty-circle triangles: balanced in the tangent plane, not the
    // first four distance/ID-ordered pairs. Only measured vertices are emitted.
    for (let firstNeighborIndex = 0; firstNeighborIndex < boundedNeighbors.length; firstNeighborIndex += 1) {
      for (let secondNeighborIndex = firstNeighborIndex + 1; secondNeighborIndex < boundedNeighbors.length; secondNeighborIndex += 1) {
        const firstNeighbor = boundedNeighbors[firstNeighborIndex]
        const secondNeighbor = boundedNeighbors[secondNeighborIndex]
        const { u: au, v: av } = firstNeighbor, { u: bu, v: bv } = secondNeighbor
        const determinant = au * bv - av * bu
        const a2 = au * au + av * av, b2 = bu * bu + bv * bv
        if (determinant * determinant <= a2 * b2 * MIN_TRIANGLE_SINE_SQUARED || a2 * b2 <= 1e-16) continue
        // Do not form a fan across an unsupported half-plane / large angular hole.
        if (au * bu + av * bv < -0.5 * Math.sqrt(a2 * b2)) continue
        const circleU = (a2 * bv - b2 * av) / (2 * determinant)
        const circleV = (au * b2 - bu * a2) / (2 * determinant)
        const radiusSquared = circleU * circleU + circleV * circleV
        let occupied = false
        for (const other of boundedNeighbors) {
          if (other.index === firstNeighbor.index || other.index === secondNeighbor.index) continue
          const difference = (other.u - circleU) ** 2 + (other.v - circleV) ** 2 - radiusSquared
          const tolerance = Math.max(1e-14, radiusSquared * 1e-8)
          if (difference < -tolerance) { occupied = true; break }
          if (Math.abs(difference) <= tolerance) {
            // Cocircular tie: choose the lexicographically shorter endpoint pair,
            // independent of sample IDs / capture insertion order.
            const vertices = [
              { index: centerIndex, u: 0, v: 0 }, firstNeighbor, secondNeighbor,
            ]
            for (let edge = 0; edge < 3; edge++) {
              const a = vertices[edge], b = vertices[(edge + 1) % 3], c = vertices[(edge + 2) % 3]
              const sideC = (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u)
              const sideOther = (b.u - a.u) * (other.v - a.v) - (b.v - a.v) * (other.u - a.u)
              if (sideC * sideOther >= 0) continue
              const compare = (i: number, j: number) => {
                const p = surfels[i].position, q = surfels[j].position
                return p.x - q.x || p.y - q.y || p.z - q.z
              }
              const current = [a.index, b.index].sort(compare), alternate = [c.index, other.index].sort(compare)
              if ((compare(current[0], alternate[0]) || compare(current[1], alternate[1])) > 0) occupied = true
            }
            if (occupied) break
          }
        }
        if (occupied) continue
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
        if (cross.lengthSq() <= edgeA.lengthSq() * edgeB.lengthSq() * MIN_TRIANGLE_SINE_SQUARED) {
          continue
        }
        const key = [centerIndex, firstNeighbor.index, secondNeighbor.index].sort((a, b) => a - b).join(':')
        if (emitted.has(key)) continue
        emitted.add(key)
        if (coveredSurfelIndices[centerIndex] === 0) {
          coveredSurfelIndices[centerIndex] = 1
          coveredSurfelCount += 1
        }
        if (coveredSurfelIndices[firstNeighbor.index] === 0) {
          coveredSurfelIndices[firstNeighbor.index] = 1
          coveredSurfelCount += 1
        }
        if (coveredSurfelIndices[secondNeighbor.index] === 0) {
          coveredSurfelIndices[secondNeighbor.index] = 1
          coveredSurfelCount += 1
        }
        const ordered = cross.dot(centerNormal) >= 0
          ? [center, first, second]
          : [center, second, first]
        for (const surfel of ordered) {
          positions.push(surfel.position.x, surfel.position.y, surfel.position.z)
          writeColor(colors, colors.length, surfel, displayColors)
          vertexSurfelIds.push(surfel.id)
        }
        triangleCount += 1
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
  return { geometry, triangleCount, coveredSurfelIndices, coveredSurfelCount,
    topology: { vertexSurfelIds: new Uint32Array(vertexSurfelIds), triangleCount } }
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

function createSplatMaterial(opacity: number, corePass: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SPLAT_VERTEX_SHADER,
    fragmentShader: SPLAT_FRAGMENT_SHADER,
    uniforms: {
      uOpacity: { value: opacity },
      uCorePass: { value: corePass ? 1 : 0 },
    },
    depthTest: true,
    depthWrite: corePass,
    side: THREE.DoubleSide,
    transparent: !corePass,
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

/** Transfer only prepared numeric geometry, never XR resources or camera frames. */
export interface PreparedRealitySurface {
  geometries: { attributes: { name: string; array: Float32Array; itemSize: number }[] }[]
  layers: { geometry: number; kind: 'points' | 'core' | 'feather' | 'triangles'; opacity: number }[]
  stats: RealitySurfaceRenderStats
  triangleTopology?: RealityTriangleTopology
  designTriangleAssociation?: RealityWallTriangleAssociation
  /** M8.5.5 foreground/attached barriers for M8.5.7 hit-seeded ownership. */
  ownershipClassifications?: Uint8Array
  designComposite?: {
    mode: RealityDesignCompositeMode
    structuralPatchIds: readonly string[]
    masks: readonly RealityPaintablePatchMask[]
    stats: RealityDesignCompositorStats
  }
}

export function packRealitySurface(resources: RealitySurfaceRenderResources): PreparedRealitySurface {
  const geometries = resources.geometries.map((geometry) => ({
    attributes: Object.entries(geometry.attributes).map(([name, attribute]) => ({
      name, array: attribute.array as Float32Array, itemSize: attribute.itemSize,
    })),
  }))
  const layers: PreparedRealitySurface['layers'] = []
  for (const object of resources.group.children) {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) continue
    const material = object.material
    if (Array.isArray(material)) continue
    const kind = object instanceof THREE.Points ? 'points'
      : material instanceof THREE.ShaderMaterial ? (material.uniforms.uCorePass.value ? 'core' : 'feather')
        : 'triangles'
    layers.push({ geometry: resources.geometries.indexOf(object.geometry), kind,
      opacity: material instanceof THREE.ShaderMaterial ? material.uniforms.uOpacity.value : material.opacity })
  }
  return { geometries, layers, stats: resources.stats, triangleTopology: resources.triangleTopology ?? undefined }
}

export function restoreRealitySurface(prepared: PreparedRealitySurface): RealitySurfaceRenderResources {
  const geometries = prepared.geometries.map((source) => {
    const geometry = new THREE.BufferGeometry()
    for (const attribute of source.attributes) geometry.setAttribute(attribute.name, new THREE.BufferAttribute(attribute.array, attribute.itemSize))
    return geometry
  })
  const group = new THREE.Group(), materials: THREE.Material[] = []
  for (const layer of prepared.layers) {
    const material = layer.kind === 'points' ? createPointMaterial()
      : layer.kind === 'triangles' ? createSurfaceMaterial()
        : createSplatMaterial(layer.opacity, layer.kind === 'core')
    materials.push(material)
    group.add(layer.kind === 'points'
      ? new THREE.Points(geometries[layer.geometry], material)
      : new THREE.Mesh(geometries[layer.geometry], material))
  }
  return { group, geometries, materials, stats: prepared.stats,
    triangleTopology: prepared.triangleTopology ?? null, triangleGeometry: null }
}

/** Builds post-scan Reality geometry once; it never changes the measured data. */
export function createRealitySurfaceRenderResources(
  reconstruction: Pick<FinalizedRealityReconstruction, 'surfels'>,
  mode: RealitySurfaceRenderMode,
  displayColors?: ReadonlyMap<number, RealityRgbColor>,
): RealitySurfaceRenderResources {
  const startedAt = getTimestamp()
  const group = new THREE.Group()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const coloredSurfels = getColoredSurfels(reconstruction)
  const neighborIndex = buildRealityNeighborIndex(coloredSurfels)
  let renderedSplatCount = 0
  let renderedTriangleCount = 0
  let coloredTriangleVertexCount = 0
  let triangleCoveredSurfelCount = 0
  let fallbackSplatCount = 0
  let splatsSuppressedByTriangles = 0
  let visualRadiusScale = 1
  let splatGeometryMs = 0
  let triangleGenerationMs = 0
  let splatSuppressionMask: Uint8Array | undefined
  let triangleTopology: RealityTriangleTopology | null = null
  let triangleGeometry: THREE.BufferGeometry | null = null

  if (mode === 'points') {
    const geometry = createPointGeometry(coloredSurfels, displayColors)
    const material = createPointMaterial()
    group.add(new THREE.Points(geometry, material))
    geometries.push(geometry)
    materials.push(material)
  } else if (neighborIndex) {
    if (mode === 'dense' || mode === 'triangles') {
      const triangleStartedAt = getTimestamp()
      const triangleResult = createDenseTriangleGeometry(neighborIndex, displayColors)
      triangleGenerationMs = Math.max(0, getTimestamp() - triangleStartedAt)
      const triangleMaterial = createSurfaceMaterial(1)
      group.add(new THREE.Mesh(triangleResult.geometry, triangleMaterial))
      geometries.push(triangleResult.geometry)
      materials.push(triangleMaterial)
      renderedTriangleCount = triangleResult.triangleCount
      coloredTriangleVertexCount = triangleResult.triangleCount * 3
      triangleCoveredSurfelCount = triangleResult.coveredSurfelCount
      splatSuppressionMask = triangleResult.coveredSurfelIndices
      triangleTopology = triangleResult.topology
      triangleGeometry = triangleResult.geometry
    }

    if (mode !== 'triangles') {
      const splatStartedAt = getTimestamp()
      const splatResult = createSplatGeometry(
        neighborIndex,
        mode === 'dense' ? DENSE_SPLAT_RADIUS_SCALE : BASE_SPLAT_RADIUS_SCALE,
        splatSuppressionMask,
        displayColors,
      )
      splatGeometryMs = Math.max(0, getTimestamp() - splatStartedAt)
      const splatCoreMaterial = createSplatMaterial(1, true)
      const splatFeatherMaterial = createSplatMaterial(mode === 'dense' ? 0.92 : 1, false)
      group.add(
        new THREE.Mesh(splatResult.geometry, splatCoreMaterial),
        new THREE.Mesh(splatResult.geometry, splatFeatherMaterial),
      )
      geometries.push(splatResult.geometry)
      materials.push(splatCoreMaterial, splatFeatherMaterial)
      renderedSplatCount = splatResult.renderedSplatCount
      fallbackSplatCount = mode === 'dense' ? splatResult.renderedSplatCount : 0
      splatsSuppressedByTriangles = splatResult.suppressedSplatCount
      visualRadiusScale = splatResult.averageVisualRadiusScale
    }
  }

  const memoryBytes = geometries.reduce(
    (total, geometry) => total + getGeometryMemoryBytes(geometry),
    0,
  )
  const renderColorStatistics = calculateRenderColorStatistics(geometries)
  return {
    group,
    geometries,
    materials,
    triangleTopology,
    triangleGeometry,
    stats: {
      mode,
      sourceSurfelCount: reconstruction.surfels.length,
      coloredSurfelCount: coloredSurfels.length,
      renderedSurfelCount: mode === 'dense' || mode === 'triangles'
        ? triangleCoveredSurfelCount + renderedSplatCount
        : coloredSurfels.length,
      renderedSplatCount,
      renderedTriangleCount,
      coloredTriangleVertexCount,
      uncoloredTriangleVertexCount: 0,
      fallbackSplatCount,
      uncoloredFallbackSplatCount: 0,
      splatsSuppressedByTriangles,
      visualRadiusScale,
      renderPreparationMs: Math.max(0, getTimestamp() - startedAt),
      neighborIndexBuildMs: neighborIndex.spatialIndexMs,
      neighborAnalysisMs: neighborIndex.neighborAnalysisMs,
      distribution: neighborIndex.distribution,
      triangleParticipantCount: triangleCoveredSurfelCount,
      triangleParticipationPercentage: coloredSurfels.length ? triangleCoveredSurfelCount / coloredSurfels.length * 100 : 0,
      fallbackPercentage: coloredSurfels.length ? fallbackSplatCount / coloredSurfels.length * 100 : 0,
      splatGeometryMs,
      triangleGenerationMs,
      medianNearestNeighborSpacingMeters: neighborIndex?.medianNearestNeighborSpacingMeters ?? null,
      p90NearestNeighborSpacingMeters: neighborIndex?.p90NearestNeighborSpacingMeters ?? null,
      estimatedSmallGapRegions: neighborIndex?.estimatedSmallGapRegions ?? 0,
      estimatedLargeUnsupportedGaps: neighborIndex?.estimatedLargeUnsupportedGaps ?? 0,
      memoryBytes,
      renderColorStatistics,
    },
  }
}

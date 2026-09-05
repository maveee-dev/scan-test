import type { FinalizedRealitySurfel, RealityRgbColor, SpatialPoint } from '../types'
import type { RealityTriangleTopology } from './realitySurfaceRenderingService'
import { RealityMembershipCode, type RealityDesignColorInput, type RealityStructuralAssociationTable } from './realityStructuralAssociationService'

export interface RealityWallTriangleAssociationStats {
  readonly adjacencyBuildMs: number
  readonly seedClassificationMs: number
  readonly componentGrowthMs: number
  readonly triangleAssignmentMs: number
  readonly triangleCount: number
  readonly seedTriangleCount: number
  readonly assignedTriangleCount: number
  readonly componentCount: number
  readonly memoryBytes: number
}

export interface RealityWallTriangleAssociation {
  /** Logical-surface index per Dense Reality triangle; -1 means preserve original Reality. */
  readonly logicalSurfaceIndices: Int32Array
  /** Connected component identity per triangle; -1 means no confirmed wall component. */
  readonly componentIds: Int32Array
  readonly seedMask: Uint8Array
  readonly stats: RealityWallTriangleAssociationStats
}

const EPSILON = 1e-8
const MAX_COMPONENT_PLANE_RESIDUAL_METERS = 0.06
const MIN_COMPONENT_NORMAL_DOT = 0.65
const MIN_ADJACENT_TRIANGLE_NORMAL_DOT = Math.cos((52 * Math.PI) / 180)

function timestamp(): number { return typeof performance === 'undefined' ? Date.now() : performance.now() }

function dot(first: SpatialPoint, second: SpatialPoint): number { return first.x * second.x + first.y * second.y + first.z * second.z }

function normalize(point: SpatialPoint): SpatialPoint | null {
  const length = Math.hypot(point.x, point.y, point.z)
  return length > EPSILON ? { x: point.x / length, y: point.y / length, z: point.z / length } : null
}

function triangleNormal(samples: readonly FinalizedRealitySurfel[], indices: readonly number[]): SpatialPoint | null {
  const a = samples[indices[0]].position, b = samples[indices[1]].position, c = samples[indices[2]].position
  return normalize({ x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) })
}

function normalizedDot(first: SpatialPoint, second: SpatialPoint): number {
  const firstNormalized = normalize(first), secondNormalized = normalize(second)
  return firstNormalized && secondNormalized ? Math.abs(dot(firstNormalized, secondNormalized)) : 0
}

function edgeKey(first: number, second: number): string { return first < second ? `${first}:${second}` : `${second}:${first}` }

/**
 * Builds connected, measured Reality wall components. Structural surfaces only
 * name/seed these components; all assigned geometry remains original triangles.
 */
export function associateRealityWallTriangles(
  samples: readonly FinalizedRealitySurfel[],
  topology: RealityTriangleTopology,
  table: RealityStructuralAssociationTable,
  preserveSampleMask: Uint8Array,
): RealityWallTriangleAssociation {
  const startedAt = timestamp(), triangleCount = topology.triangleCount
  const logicalSurfaceIndices = new Int32Array(triangleCount).fill(-1)
  const componentIds = new Int32Array(triangleCount).fill(-1)
  const seedMask = new Uint8Array(triangleCount)
  const sampleIndexById = new Map<number, number>()
  for (let index = 0; index < samples.length; index++) sampleIndexById.set(samples[index].id, index)
  const triangleSamples: number[][] = Array.from({ length: triangleCount }, () => [])
  const normals: Array<SpatialPoint | null> = Array.from({ length: triangleCount }, () => null)
  const candidates = new Uint8Array(triangleCount)
  const calibrationOffsets = table.perLogicalSurface.map((entry) => entry.membershipReferenceApplied ? entry.membershipReferenceOffsetMeters : 0)

  const seedStartedAt = timestamp()
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    const indices: number[] = []
    for (let vertex = 0; vertex < 3; vertex++) {
      const sampleIndex = sampleIndexById.get(topology.vertexSurfelIds[triangleIndex * 3 + vertex])
      if (sampleIndex === undefined) break
      indices.push(sampleIndex)
    }
    if (indices.length !== 3) continue
    triangleSamples[triangleIndex] = indices
    // M8.5.5 classification 1 is exposed wall. Only foreground, attached, or
    // uncertain values (2+) form conservative triangle-growth barriers.
    if (indices.some((index) => preserveSampleMask[index] >= 2 || table.foregroundMask[index] === 1)) continue
    const votes = new Map<number, number>()
    for (const index of indices) {
      const logical = table.logicalSurfaceIndices[index]
      if (logical >= 0) votes.set(logical, (votes.get(logical) ?? 0) + 1)
    }
    let logicalIndex = -1, voteCount = 0
    for (const [candidate, count] of votes) if (count > voteCount) { logicalIndex = candidate; voteCount = count }
    if (logicalIndex < 0 || voteCount < 2) continue
    const logical = table.logicalSurfaces[logicalIndex]
    const normal = triangleNormal(samples, indices)
    if (!normal || normalizedDot(normal, logical.representativeNormal) < MIN_COMPONENT_NORMAL_DOT) continue
    const normalLength = Math.hypot(logical.representativeNormal.x, logical.representativeNormal.y, logical.representativeNormal.z)
    if (normalLength <= EPSILON) continue
    const offset = calibrationOffsets[logicalIndex] ?? 0
    const residual = Math.max(...indices.map((index) => Math.abs((dot(logical.representativeNormal, samples[index].position) - logical.representativePlaneConstant) / normalLength - offset)))
    if (residual > MAX_COMPONENT_PLANE_RESIDUAL_METERS) continue
    logicalSurfaceIndices[triangleIndex] = logicalIndex
    normals[triangleIndex] = normal
    candidates[triangleIndex] = 1
    if (indices.every((index) => table.memberships[index] === RealityMembershipCode.CORE_WALL_MEMBER || table.memberships[index] === RealityMembershipCode.EXPANDED_WALL_MEMBER)) seedMask[triangleIndex] = 1
  }
  const seedClassificationMs = timestamp() - seedStartedAt

  const adjacencyStartedAt = timestamp()
  const edgeToTriangles = new Map<string, number[]>()
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    if (!candidates[triangleIndex]) continue
    const ids = topology.vertexSurfelIds.subarray(triangleIndex * 3, triangleIndex * 3 + 3)
    for (const key of [edgeKey(ids[0], ids[1]), edgeKey(ids[1], ids[2]), edgeKey(ids[2], ids[0])]) {
      const triangles = edgeToTriangles.get(key) ?? []; triangles.push(triangleIndex); edgeToTriangles.set(key, triangles)
    }
  }
  const adjacency: number[][] = Array.from({ length: triangleCount }, () => [])
  for (const triangles of edgeToTriangles.values()) for (let first = 0; first < triangles.length; first++) for (let second = first + 1; second < triangles.length; second++) {
    adjacency[triangles[first]].push(triangles[second]); adjacency[triangles[second]].push(triangles[first])
  }
  const adjacencyBuildMs = timestamp() - adjacencyStartedAt

  const growthStartedAt = timestamp()
  let componentCount = 0, assignedTriangleCount = 0
  for (let start = 0; start < triangleCount; start++) {
    if (!seedMask[start] || componentIds[start] >= 0) continue
    const logicalIndex = logicalSurfaceIndices[start], componentId = componentCount++, queue = [start]
    componentIds[start] = componentId
    while (queue.length) {
      const current = queue.pop() as number
      assignedTriangleCount++
      for (const neighbor of adjacency[current]) {
        if (componentIds[neighbor] >= 0 || logicalSurfaceIndices[neighbor] !== logicalIndex) continue
        const currentNormal = normals[current], neighborNormal = normals[neighbor]
        if (!currentNormal || !neighborNormal || normalizedDot(currentNormal, neighborNormal) < MIN_ADJACENT_TRIANGLE_NORMAL_DOT) continue
        componentIds[neighbor] = componentId
        queue.push(neighbor)
      }
    }
  }
  const componentGrowthMs = timestamp() - growthStartedAt
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) if (componentIds[triangleIndex] < 0) logicalSurfaceIndices[triangleIndex] = -1
  const triangleAssignmentMs = timestamp() - startedAt - seedClassificationMs - adjacencyBuildMs - componentGrowthMs
  let seedTriangleCount = 0
  for (const seed of seedMask) seedTriangleCount += seed
  return { logicalSurfaceIndices, componentIds, seedMask, stats: { adjacencyBuildMs, seedClassificationMs, componentGrowthMs, triangleAssignmentMs, triangleCount, seedTriangleCount, assignedTriangleCount, componentCount, memoryBytes: logicalSurfaceIndices.byteLength + componentIds.byteLength + seedMask.byteLength } }
}

export function componentDiagnosticColor(componentId: number): RealityRgbColor {
  const colors: readonly RealityRgbColor[] = [{ r: 0.1, g: 0.7, b: 0.98 }, { r: 0.96, g: 0.35, b: 0.15 }, { r: 0.2, g: 0.88, b: 0.38 }, { r: 0.85, g: 0.25, b: 0.88 }, { r: 0.95, g: 0.8, b: 0.15 }]
  return colors[Math.abs(componentId) % colors.length]
}

function srgbToLinear(value: number): number { return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4 }

function paintColor(hex: string): RealityRgbColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return { r: srgbToLinear(((value >> 16) & 255) / 255), g: srgbToLinear(((value >> 8) & 255) / 255), b: srgbToLinear((value & 255) / 255) }
}

/** Writes only confirmed component triangle colors. Positions and original scan RGB remain untouched. */
export function applyRealityTrianglePaint(
  colorBuffer: Float32Array,
  samples: readonly FinalizedRealitySurfel[],
  topology: RealityTriangleTopology,
  triangleAssociation: RealityWallTriangleAssociation,
  table: RealityStructuralAssociationTable,
  inputs: readonly RealityDesignColorInput[],
  componentDebug = false,
  selectedOnly = false,
): void {
  const sampleById = new Map(samples.map((sample) => [sample.id, sample]))
  const paintBySurface = new Map(inputs.map((input) => [input.surfaceId, paintColor(input.paintColor)]))
  for (let triangle = 0; triangle < topology.triangleCount; triangle++) {
    const logicalIndex = triangleAssociation.logicalSurfaceIndices[triangle]
    if (logicalIndex < 0) continue
    const logical = table.logicalSurfaces[logicalIndex]
    let paint = paintBySurface.get(logical.id) ?? null
    if (!paint) for (const patchId of logical.memberPatchIds) { paint = paintBySurface.get(patchId) ?? null; if (paint) break }
    if (selectedOnly && !paint) continue
    const diagnostic = componentDebug ? componentDiagnosticColor(triangleAssociation.componentIds[triangle]) : null
    if (!paint && !diagnostic) continue
    for (let vertex = 0; vertex < 3; vertex++) {
      const offset = (triangle * 3 + vertex) * 3
      const source = sampleById.get(topology.vertexSurfelIds[triangle * 3 + vertex])
      if (!source?.colorRgb) continue
      if (diagnostic) { colorBuffer[offset] = diagnostic.r; colorBuffer[offset + 1] = diagnostic.g; colorBuffer[offset + 2] = diagnostic.b; continue }
      if (!paint) continue
      const original = source.colorRgb
      const originalLuminance = srgbToLinear(original.r) * 0.2126 + srgbToLinear(original.g) * 0.7152 + srgbToLinear(original.b) * 0.0722
      const paintLuminance = Math.max(0.04, paint.r * 0.2126 + paint.g * 0.7152 + paint.b * 0.0722)
      const shading = Math.max(0.38, Math.min(1.55, originalLuminance / paintLuminance))
      colorBuffer[offset] = Math.min(1, paint.r * shading)
      colorBuffer[offset + 1] = Math.min(1, paint.g * shading)
      colorBuffer[offset + 2] = Math.min(1, paint.b * shading)
    }
  }
}

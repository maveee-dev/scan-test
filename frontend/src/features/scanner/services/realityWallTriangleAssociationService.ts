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

/** A user-selected, frontmost Reality component. This is derived preview
 * state only: it never changes Dense Reality or M7 structural geometry. */
export interface VisibleRealitySurfaceOwnership {
  readonly logicalSurfaceId: string
  readonly logicalSurfaceIndex: number
  readonly componentId: number
  readonly triangleIndices: Uint32Array
  readonly seedTriangleId: number
  readonly componentNormal: SpatialPoint
  readonly componentPlaneOffsetMeters: number
  readonly areaMetersSquared: number
  readonly confidence: number
  readonly source: 'user-hit' | 'automatic'
  readonly additionalComponentCount: number
}

export interface HitSeededOwnershipResult {
  readonly ownership: VisibleRealitySurfaceOwnership | null
  readonly reason: string
  readonly candidateLogicalSurfaceIds: readonly string[]
  readonly rejectedNearbyComponentCount: number
  readonly adjacencyBuildMs: number
  readonly growthMs: number
}

const EPSILON = 1e-8
const MAX_COMPONENT_PLANE_RESIDUAL_METERS = 0.06
const MIN_COMPONENT_NORMAL_DOT = 0.65
const MIN_ADJACENT_TRIANGLE_NORMAL_DOT = Math.cos((52 * Math.PI) / 180)
// M8.5.7 uses M7 as a semantic validator for a surface selected in front of
// the viewer. This is deliberately broader than automatic structural seeds:
// the connected Reality component supplies the visible-surface evidence.
const HIT_MAX_COMPONENT_PLANE_RESIDUAL_METERS = 0.12
const HIT_MIN_STRUCTURAL_NORMAL_DOT = 0.55
const HIT_MIN_ADJACENT_TRIANGLE_NORMAL_DOT = Math.cos((58 * Math.PI) / 180)
const HIT_MIN_COMPONENT_AREA_METERS_SQUARED = 0.003
const HIT_PATCH_EDGE_TOLERANCE_METERS = 0.09

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

function triangleArea(samples: readonly FinalizedRealitySurfel[], indices: readonly number[]): number {
  const a = samples[indices[0]].position, b = samples[indices[1]].position, c = samples[indices[2]].position
  const crossX = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y)
  const crossY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z)
  const crossZ = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return 0.5 * Math.hypot(crossX, crossY, crossZ)
}

function triangleCentroid(samples: readonly FinalizedRealitySurfel[], indices: readonly number[]): SpatialPoint {
  const a = samples[indices[0]].position, b = samples[indices[1]].position, c = samples[indices[2]].position
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 }
}

function patchContainsWithTolerance(point: SpatialPoint, patch: RealityStructuralAssociationTable['patches'][number]): boolean {
  const dx = point.x - patch.basis.origin.x, dy = point.y - patch.basis.origin.y, dz = point.z - patch.basis.origin.z
  const local = { u: dx * patch.basis.axisU.x + dy * patch.basis.axisU.y + dz * patch.basis.axisU.z, v: dx * patch.basis.axisV.x + dy * patch.basis.axisV.y + dz * patch.basis.axisV.z }
  let inside = false, edgeDistance = Infinity
  for (let index = 0, previous = patch.vertices2DLocal.length - 1; index < patch.vertices2DLocal.length; previous = index++) {
    const current = patch.vertices2DLocal[index], prior = patch.vertices2DLocal[previous]
    const edgeU = current.u - prior.u, edgeV = current.v - prior.v
    const edgeLengthSquared = edgeU * edgeU + edgeV * edgeV
    const t = edgeLengthSquared <= EPSILON ? 0 : Math.max(0, Math.min(1, ((local.u - prior.u) * edgeU + (local.v - prior.v) * edgeV) / edgeLengthSquared))
    edgeDistance = Math.min(edgeDistance, Math.hypot(local.u - (prior.u + edgeU * t), local.v - (prior.v + edgeV * t)))
    if ((current.v > local.v) !== (prior.v > local.v) && local.u < (prior.u - current.u) * (local.v - current.v) / (prior.v - current.v) + current.u) inside = !inside
  }
  return inside || edgeDistance <= HIT_PATCH_EDGE_TOLERANCE_METERS
}

function triangleIndicesFor(
  topology: RealityTriangleTopology,
  sampleIndexById: ReadonlyMap<number, number>,
  triangleIndex: number,
): number[] | null {
  const indices: number[] = []
  for (let vertex = 0; vertex < 3; vertex++) {
    const sampleIndex = sampleIndexById.get(topology.vertexSurfelIds[triangleIndex * 3 + vertex])
    if (sampleIndex === undefined) return null
    indices.push(sampleIndex)
  }
  return indices
}

function logicalPlaneResidual(
  samples: readonly FinalizedRealitySurfel[],
  indices: readonly number[],
  table: RealityStructuralAssociationTable,
  logicalIndex: number,
): number {
  const logical = table.logicalSurfaces[logicalIndex]
  const normalLength = Math.hypot(logical.representativeNormal.x, logical.representativeNormal.y, logical.representativeNormal.z)
  if (normalLength <= EPSILON) return Infinity
  const diagnostic = table.perLogicalSurface[logicalIndex]
  const offset = diagnostic?.membershipReferenceApplied ? diagnostic.membershipReferenceOffsetMeters : 0
  return Math.max(...indices.map((index) => Math.abs((dot(logical.representativeNormal, samples[index].position) - logical.representativePlaneConstant) / normalLength - offset)))
}

function triangleHasBarrier(indices: readonly number[], table: RealityStructuralAssociationTable, preserveSampleMask: Uint8Array | undefined): boolean {
  // M8.5.5 codes 2/3 are positive foreground or attached-object evidence.
  // Code 4 is merely unresolved; a frontmost user-hit wall must be allowed to
  // prove itself through component continuity and M7 validation instead of
  // being rejected as an object by default.
  return indices.some((index) => {
    const classification = preserveSampleMask?.[index] ?? 0
    return table.foregroundMask[index] === 1 || classification === 2 || classification === 3
  })
}

/**
 * Resolves the exact frontmost triangle hit by a Reality raycast, then grows a
 * connected visible component. M7 validates the resulting surface; it does not
 * substitute a hidden, structurally closer component for the user hit.
 */
export function createHitSeededVisibleRealityOwnership(
  samples: readonly FinalizedRealitySurfel[],
  topology: RealityTriangleTopology,
  table: RealityStructuralAssociationTable,
  hitTriangleIndex: number,
  preserveSampleMask?: Uint8Array,
  automaticAssociation?: RealityWallTriangleAssociation,
): HitSeededOwnershipResult {
  const adjacencyStartedAt = timestamp()
  if (hitTriangleIndex < 0 || hitTriangleIndex >= topology.triangleCount) {
    return { ownership: null, reason: 'invalid Reality triangle hit', candidateLogicalSurfaceIds: [], rejectedNearbyComponentCount: 0, adjacencyBuildMs: 0, growthMs: 0 }
  }
  const sampleIndexById = new Map<number, number>()
  for (let index = 0; index < samples.length; index++) sampleIndexById.set(samples[index].id, index)
  const triangleSamples: Array<number[] | null> = Array.from({ length: topology.triangleCount }, () => null)
  const normals: Array<SpatialPoint | null> = Array.from({ length: topology.triangleCount }, () => null)
  const edgeToTriangles = new Map<string, number[]>()
  for (let triangle = 0; triangle < topology.triangleCount; triangle++) {
    const indices = triangleIndicesFor(topology, sampleIndexById, triangle)
    if (!indices) continue
    triangleSamples[triangle] = indices
    normals[triangle] = triangleNormal(samples, indices)
    const ids = topology.vertexSurfelIds.subarray(triangle * 3, triangle * 3 + 3)
    for (const key of [edgeKey(ids[0], ids[1]), edgeKey(ids[1], ids[2]), edgeKey(ids[2], ids[0])]) {
      const entries = edgeToTriangles.get(key) ?? []
      entries.push(triangle)
      edgeToTriangles.set(key, entries)
    }
  }
  const adjacency: number[][] = Array.from({ length: topology.triangleCount }, () => [])
  for (const entries of edgeToTriangles.values()) for (let first = 0; first < entries.length; first++) for (let second = first + 1; second < entries.length; second++) {
    adjacency[entries[first]].push(entries[second])
    adjacency[entries[second]].push(entries[first])
  }
  const adjacencyBuildMs = timestamp() - adjacencyStartedAt
  const hitIndices = triangleSamples[hitTriangleIndex], hitNormal = normals[hitTriangleIndex]
  if (!hitIndices || !hitNormal) return { ownership: null, reason: 'hit Reality triangle has invalid measured geometry', candidateLogicalSurfaceIds: [], rejectedNearbyComponentCount: 0, adjacencyBuildMs, growthMs: 0 }
  if (triangleHasBarrier(hitIndices, table, preserveSampleMask)) return { ownership: null, reason: 'hit Reality triangle has foreground or attached-object evidence', candidateLogicalSurfaceIds: [], rejectedNearbyComponentCount: 0, adjacencyBuildMs, growthMs: 0 }

  const centroid = triangleCentroid(samples, hitIndices)
  const candidates: { index: number; score: number }[] = []
  for (let logicalIndex = 0; logicalIndex < table.logicalSurfaces.length; logicalIndex++) {
    const logical = table.logicalSurfaces[logicalIndex]
    const normalCompatibility = normalizedDot(hitNormal, logical.representativeNormal)
    const residual = logicalPlaneResidual(samples, hitIndices, table, logicalIndex)
    const withinPatch = logical.memberPatchIds.some((id) => {
      const patch = table.patches.find((candidate) => candidate.id === id)
      return patch ? patchContainsWithTolerance(centroid, patch) : false
    })
    if (!withinPatch || normalCompatibility < HIT_MIN_STRUCTURAL_NORMAL_DOT || residual > HIT_MAX_COMPONENT_PLANE_RESIDUAL_METERS) continue
    candidates.push({ index: logicalIndex, score: normalCompatibility * 0.55 + (1 - residual / HIT_MAX_COMPONENT_PLANE_RESIDUAL_METERS) * 0.45 })
  }
  candidates.sort((first, second) => second.score - first.score)
  const candidateLogicalSurfaceIds = candidates.map((candidate) => table.logicalSurfaces[candidate.index].id)
  const candidate = candidates[0]
  if (!candidate || candidate.score < 0.58) return { ownership: null, reason: 'visible Reality component is not structurally compatible with an editable surface', candidateLogicalSurfaceIds, rejectedNearbyComponentCount: 0, adjacencyBuildMs, growthMs: 0 }

  const growthStartedAt = timestamp(), logicalIndex = candidate.index
  const accepted = new Uint8Array(topology.triangleCount), queue = [hitTriangleIndex]
  accepted[hitTriangleIndex] = 1
  while (queue.length) {
    const current = queue.pop() as number
    const currentNormal = normals[current]
    for (const neighbor of adjacency[current]) {
      if (accepted[neighbor]) continue
      const indices = triangleSamples[neighbor], normal = normals[neighbor]
      if (!indices || !normal || !currentNormal || triangleHasBarrier(indices, table, preserveSampleMask)) continue
      if (normalizedDot(currentNormal, normal) < HIT_MIN_ADJACENT_TRIANGLE_NORMAL_DOT) continue
      if (normalizedDot(normal, table.logicalSurfaces[logicalIndex].representativeNormal) < HIT_MIN_STRUCTURAL_NORMAL_DOT) continue
      if (logicalPlaneResidual(samples, indices, table, logicalIndex) > HIT_MAX_COMPONENT_PLANE_RESIDUAL_METERS) continue
      accepted[neighbor] = 1
      queue.push(neighbor)
    }
  }
  // Join only already-confirmed automatic components that agree with the
  // frontmost component's local surface. This catches separated observed wall
  // pieces around curtains/scan gaps without inventing a bridge.
  const hitNormalForJoin = normals[hitTriangleIndex] as SpatialPoint
  const hitOffsetForJoin = logicalPlaneResidual(samples, hitIndices, table, logicalIndex)
  let additionalComponentCount = 0, rejectedNearbyComponentCount = 0
  if (automaticAssociation) {
    const componentTriangles = new Map<number, number[]>()
    for (let triangle = 0; triangle < automaticAssociation.componentIds.length; triangle++) {
      if (automaticAssociation.logicalSurfaceIndices[triangle] !== logicalIndex || automaticAssociation.componentIds[triangle] < 0 || accepted[triangle]) continue
      const componentId = automaticAssociation.componentIds[triangle]
      const entries = componentTriangles.get(componentId) ?? []
      entries.push(triangle)
      componentTriangles.set(componentId, entries)
    }
    for (const entries of componentTriangles.values()) {
      const firstNormal = normals[entries[0]], firstIndices = triangleSamples[entries[0]]
      if (!firstNormal || !firstIndices || normalizedDot(firstNormal, hitNormalForJoin) < MIN_ADJACENT_TRIANGLE_NORMAL_DOT) {
        rejectedNearbyComponentCount++
        continue
      }
      const offset = logicalPlaneResidual(samples, firstIndices, table, logicalIndex)
      if (Math.abs(offset - hitOffsetForJoin) > 0.045) {
        rejectedNearbyComponentCount++
        continue
      }
      for (const triangle of entries) accepted[triangle] = 1
      additionalComponentCount++
    }
  }
  const triangles: number[] = []
  let areaMetersSquared = 0, normalX = 0, normalY = 0, normalZ = 0, offsetSum = 0
  for (let triangle = 0; triangle < topology.triangleCount; triangle++) {
    if (!accepted[triangle]) continue
    const indices = triangleSamples[triangle] as number[], normal = normals[triangle] as SpatialPoint
    const area = triangleArea(samples, indices)
    triangles.push(triangle)
    areaMetersSquared += area
    normalX += normal.x * area; normalY += normal.y * area; normalZ += normal.z * area
    const logical = table.logicalSurfaces[logicalIndex]
    const normalLength = Math.hypot(logical.representativeNormal.x, logical.representativeNormal.y, logical.representativeNormal.z)
    offsetSum += normalLength <= EPSILON ? 0 : ((dot(logical.representativeNormal, triangleCentroid(samples, indices)) - logical.representativePlaneConstant) / normalLength) * area
  }
  const componentNormal = normalize({ x: normalX, y: normalY, z: normalZ })
  const growthMs = timestamp() - growthStartedAt
  if (!componentNormal || areaMetersSquared < HIT_MIN_COMPONENT_AREA_METERS_SQUARED) return { ownership: null, reason: 'hit Reality component is too small or fragmented to verify as wall material', candidateLogicalSurfaceIds, rejectedNearbyComponentCount: 0, adjacencyBuildMs, growthMs }
  const confidence = Math.max(0, Math.min(1, candidate.score * 0.7 + Math.min(1, areaMetersSquared / 0.12) * 0.3))
  return {
    ownership: {
      logicalSurfaceId: table.logicalSurfaces[logicalIndex].id,
      logicalSurfaceIndex: logicalIndex,
      componentId: hitTriangleIndex,
      triangleIndices: Uint32Array.from(triangles),
      seedTriangleId: hitTriangleIndex,
      componentNormal,
      componentPlaneOffsetMeters: offsetSum / Math.max(EPSILON, areaMetersSquared),
      areaMetersSquared,
      confidence,
      source: 'user-hit',
      additionalComponentCount,
    },
    reason: 'frontmost user-hit Reality component validated against structural surface',
    candidateLogicalSurfaceIds,
    rejectedNearbyComponentCount,
    adjacencyBuildMs,
    growthMs,
  }
}

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
  visibleOwnerships: readonly VisibleRealitySurfaceOwnership[] = [],
): void {
  const sampleById = new Map(samples.map((sample) => [sample.id, sample]))
  const paintBySurface = new Map(inputs.map((input) => [input.surfaceId, paintColor(input.paintColor)]))
  // A user-hit component owns its logical surface for this finalized scan.
  // Suppress automatic components for that same logical surface so a hidden
  // M7-closer layer cannot override the actually tapped/frontmost layer.
  const manualLogicalIndices = new Set(visibleOwnerships.map((ownership) => ownership.logicalSurfaceIndex))
  const manualTriangleLogicalIndices = new Map<number, number>()
  const manualComponentIds = new Map<number, number>()
  for (const ownership of visibleOwnerships) for (const triangle of ownership.triangleIndices) {
    manualTriangleLogicalIndices.set(triangle, ownership.logicalSurfaceIndex)
    manualComponentIds.set(triangle, ownership.componentId)
  }
  for (let triangle = 0; triangle < topology.triangleCount; triangle++) {
    const automaticLogicalIndex = triangleAssociation.logicalSurfaceIndices[triangle]
    const logicalIndex = manualTriangleLogicalIndices.get(triangle) ?? (manualLogicalIndices.has(automaticLogicalIndex) ? -1 : automaticLogicalIndex)
    if (logicalIndex < 0) continue
    const logical = table.logicalSurfaces[logicalIndex]
    let paint = paintBySurface.get(logical.id) ?? null
    if (!paint) for (const patchId of logical.memberPatchIds) { paint = paintBySurface.get(patchId) ?? null; if (paint) break }
    if (selectedOnly && !paint) continue
    const diagnostic = componentDebug ? componentDiagnosticColor(manualComponentIds.get(triangle) ?? triangleAssociation.componentIds[triangle]) : null
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

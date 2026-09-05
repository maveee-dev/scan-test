import type { RoomSurfacePatch, RoomSurfacePatchRole } from '../../room-analysis/types'
import type { SpatialPoint } from '../types'

export interface LogicalStructuralSurface {
  readonly id: string
  readonly role: RoomSurfacePatchRole
  readonly memberPatchIds: readonly string[]
  readonly representativeNormal: SpatialPoint
  readonly representativePlaneConstant: number
  readonly totalAreaMetersSquared: number
  readonly confidence: number
  readonly normalSpreadDegrees: number
  readonly planeOffsetSpreadMeters: number
  readonly adjacencyEvidence: string
}

export interface LogicalSurfaceGroupingConfig {
  readonly maximumNormalAngleDegrees: number
  readonly maximumPlaneOffsetMeters: number
  readonly maximumCentroidPlaneResidualMeters: number
  readonly maximumBoundaryDistanceMeters: number
}

export const DEFAULT_LOGICAL_SURFACE_GROUPING_CONFIG: LogicalSurfaceGroupingConfig = {
  maximumNormalAngleDegrees: 18,
  maximumPlaneOffsetMeters: 0.16,
  maximumCentroidPlaneResidualMeters: 0.18,
  maximumBoundaryDistanceMeters: 1.2,
}

function magnitude(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function dot(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function normalize(point: SpatialPoint): SpatialPoint {
  const length = magnitude(point)
  return length > 1e-8 ? { x: point.x / length, y: point.y / length, z: point.z / length } : { x: 0, y: 0, z: 0 }
}

function distance(first: SpatialPoint, second: SpatialPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

function computeCentroid(vertices: readonly SpatialPoint[]): SpatialPoint {
  if (vertices.length === 0) return { x: 0, y: 0, z: 0 }
  let sumX = 0, sumY = 0, sumZ = 0
  for (const vertex of vertices) {
    sumX += vertex.x
    sumY += vertex.y
    sumZ += vertex.z
  }
  const count = vertices.length
  return { x: sumX / count, y: sumY / count, z: sumZ / count }
}

function pointPlaneDistance(point: SpatialPoint, normal: SpatialPoint, planeConstant: number): number {
  return Math.abs(dot(normal, point) - planeConstant)
}

/**
 * Calculates the minimum distance between the 3D boundary vertices of two patches.
 */
function minimumPatchBoundaryDistance(first: RoomSurfacePatch, second: RoomSurfacePatch): number {
  let minDistance = Infinity
  for (const v1 of first.vertices3D) {
    for (const v2 of second.vertices3D) {
      const d = distance(v1, v2)
      if (d < minDistance) {
        minDistance = d
      }
    }
  }
  return minDistance
}

function getMaximumNormalAngleDegrees(role: RoomSurfacePatchRole, config: LogicalSurfaceGroupingConfig): number {
  return role === 'wall' ? config.maximumNormalAngleDegrees : 15
}

/**
 * Determines whether two structural patches belong to the same physical structural surface.
 *
 * Requirements:
 * 1. Exactly the same role (e.g. wall with wall; never wall with ceiling or floor).
 * 2. Compatible normals pointing in the same general direction (normal angle <= 18°).
 *    Opposite parallel walls (dot < 0) must NEVER group together.
 * 3. Compatible plane offset (|c1 - c2| <= 0.16m) and mutual coplanarity (centroids within 0.18m of the other plane).
 * 4. Spatial connectivity / adjacency: distance between 3D boundaries must be <= 1.2m.
 *    Parallel walls that are spatially separated (e.g. opposite walls or distinct hallway partitions)
 *    must NEVER group together.
 */
export function arePatchesCompatibleForGrouping(
  first: RoomSurfacePatch,
  second: RoomSurfacePatch,
  config: LogicalSurfaceGroupingConfig = DEFAULT_LOGICAL_SURFACE_GROUPING_CONFIG,
): { compatible: boolean; reason: string; normalSpreadDegrees: number; planeOffsetDiff: number; boundaryDistance: number } {
  if (first.role !== second.role) {
    return {
      compatible: false,
      reason: `different structural roles (${first.role} vs ${second.role})`,
      normalSpreadDegrees: Infinity,
      planeOffsetDiff: Infinity,
      boundaryDistance: Infinity,
    }
  }

  const normalDot = dot(first.normal, second.normal)
  // Opposite parallel walls have dot <= 0. They must NEVER be grouped together.
  if (normalDot <= 0) {
    return {
      compatible: false,
      reason: 'opposing normals (e.g. opposite parallel walls)',
      normalSpreadDegrees: 180,
      planeOffsetDiff: Infinity,
      boundaryDistance: Infinity,
    }
  }

  const clampedDot = Math.max(-1, Math.min(1, normalDot))
  const normalAngleDegrees = (Math.acos(clampedDot) * 180) / Math.PI
  const maxAngle = getMaximumNormalAngleDegrees(first.role, config)
  if (normalAngleDegrees > maxAngle) {
    return {
      compatible: false,
      reason: `incompatible normals (${normalAngleDegrees.toFixed(1)}° > limit ${maxAngle}°)`,
      normalSpreadDegrees: normalAngleDegrees,
      planeOffsetDiff: Infinity,
      boundaryDistance: Infinity,
    }
  }

  const planeOffsetDiff = Math.abs(first.planeConstant - second.planeConstant)
  if (planeOffsetDiff > config.maximumPlaneOffsetMeters) {
    return {
      compatible: false,
      reason: `plane offset difference too large (${planeOffsetDiff.toFixed(3)}m > ${config.maximumPlaneOffsetMeters}m)`,
      normalSpreadDegrees: normalAngleDegrees,
      planeOffsetDiff,
      boundaryDistance: Infinity,
    }
  }

  const centroid1 = computeCentroid(first.vertices3D)
  const centroid2 = computeCentroid(second.vertices3D)
  const residual1To2 = pointPlaneDistance(centroid1, second.normal, second.planeConstant)
  const residual2To1 = pointPlaneDistance(centroid2, first.normal, first.planeConstant)
  if (residual1To2 > config.maximumCentroidPlaneResidualMeters || residual2To1 > config.maximumCentroidPlaneResidualMeters) {
    return {
      compatible: false,
      reason: `centroid plane residual too large (${Math.max(residual1To2, residual2To1).toFixed(3)}m > ${config.maximumCentroidPlaneResidualMeters}m)`,
      normalSpreadDegrees: normalAngleDegrees,
      planeOffsetDiff,
      boundaryDistance: Infinity,
    }
  }

  const boundaryDistance = minimumPatchBoundaryDistance(first, second)
  if (boundaryDistance > config.maximumBoundaryDistanceMeters) {
    return {
      compatible: false,
      reason: `spatially separated patches (${boundaryDistance.toFixed(3)}m > ${config.maximumBoundaryDistanceMeters}m limit)`,
      normalSpreadDegrees: normalAngleDegrees,
      planeOffsetDiff,
      boundaryDistance,
    }
  }

  return {
    compatible: true,
    reason: `coplanar (offset diff ${planeOffsetDiff.toFixed(3)}m, angle ${normalAngleDegrees.toFixed(1)}°), adjacent (boundary dist ${boundaryDistance.toFixed(3)}m)`,
    normalSpreadDegrees: normalAngleDegrees,
    planeOffsetDiff,
    boundaryDistance,
  }
}

/**
 * Groups M7.4 patches into logical structural surfaces.
 * Each logical structural surface represents a user-facing physical wall, floor, or ceiling.
 * Member M7.4 patches remain unchanged as geometry primitives.
 */
export function groupPatchesIntoLogicalSurfaces(
  patches: readonly RoomSurfacePatch[],
  config: LogicalSurfaceGroupingConfig = DEFAULT_LOGICAL_SURFACE_GROUPING_CONFIG,
): LogicalStructuralSurface[] {
  if (patches.length === 0) return []

  const n = patches.length
  // Union-Find data structure
  const parent = Array.from({ length: n }, (_, index) => index)
  function find(index: number): number {
    if (parent[index] === index) return index
    parent[index] = find(parent[index])
    return parent[index]
  }
  function union(index1: number, index2: number): void {
    const root1 = find(index1)
    const root2 = find(index2)
    if (root1 !== root2) {
      parent[root2] = root1
    }
  }

  // Evaluate all pairs
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const evaluation = arePatchesCompatibleForGrouping(patches[i], patches[j], config)
      if (evaluation.compatible) {
        union(i, j)
      }
    }
  }

  // Collect components
  const components = new Map<number, RoomSurfacePatch[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const list = components.get(root) ?? []
    list.push(patches[i])
    components.set(root, list)
  }

  // Partition components by role and create stable derived IDs
  const roleGroups: Record<RoomSurfacePatchRole, RoomSurfacePatch[][]> = {
    wall: [],
    floor: [],
    ceiling: [],
  }

  for (const memberPatches of components.values()) {
    const role = memberPatches[0].role
    roleGroups[role].push(memberPatches)
  }

  const result: LogicalStructuralSurface[] = []

  // Deterministically sort components within each role by total area descending
  for (const role of ['wall', 'ceiling', 'floor'] as const) {
    const groups = roleGroups[role].sort((a, b) => {
      const areaA = a.reduce((sum, p) => sum + p.areaMetersSquared, 0)
      const areaB = b.reduce((sum, p) => sum + p.areaMetersSquared, 0)
      if (Math.abs(areaB - areaA) > 1e-4) return areaB - areaA
      return a[0].id.localeCompare(b[0].id)
    })

    groups.forEach((members, index) => {
      const id = `logical-${role}-${index + 1}`
      const memberPatchIds = members.map((p) => p.id).sort((a, b) => a.localeCompare(b))
      const totalArea = members.reduce((sum, p) => sum + p.areaMetersSquared, 0)

      // Compute area-weighted representative normal and plane constant
      let weightedNx = 0, weightedNy = 0, weightedNz = 0, weightedConstant = 0, weightedConfidence = 0
      for (const p of members) {
        const weight = Math.max(0.01, p.areaMetersSquared)
        weightedNx += p.normal.x * weight
        weightedNy += p.normal.y * weight
        weightedNz += p.normal.z * weight
        weightedConstant += p.planeConstant * weight
        weightedConfidence += p.confidence * weight
      }
      const totalWeight = members.reduce((sum, p) => sum + Math.max(0.01, p.areaMetersSquared), 0)
      const repNormal = normalize({ x: weightedNx / totalWeight, y: weightedNy / totalWeight, z: weightedNz / totalWeight })
      const repConstant = weightedConstant / totalWeight
      const confidence = weightedConfidence / totalWeight

      // Compute spreads
      let maxAngle = 0
      let minOffset = Infinity
      let maxOffset = -Infinity
      for (const p of members) {
        const angle = (Math.acos(Math.max(-1, Math.min(1, dot(p.normal, repNormal)))) * 180) / Math.PI
        if (angle > maxAngle) maxAngle = angle
        if (p.planeConstant < minOffset) minOffset = p.planeConstant
        if (p.planeConstant > maxOffset) maxOffset = p.planeConstant
      }
      const planeOffsetSpread = members.length > 1 ? maxOffset - minOffset : 0

      const adjacencyEvidence = members.length === 1
        ? 'single structural patch'
        : `${members.length} coplanar adjacent patches (normal spread ${maxAngle.toFixed(1)}°, offset spread ${planeOffsetSpread.toFixed(3)}m)`

      result.push(Object.freeze({
        id,
        role,
        memberPatchIds: Object.freeze(memberPatchIds),
        representativeNormal: repNormal,
        representativePlaneConstant: repConstant,
        totalAreaMetersSquared: totalArea,
        confidence,
        normalSpreadDegrees: maxAngle,
        planeOffsetSpreadMeters: planeOffsetSpread,
        adjacencyEvidence,
      }))
    })
  }

  return result
}

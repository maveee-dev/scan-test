import type { SpatialPoint } from '../types'
import type { RoomSurfaceLocalPoint, RoomSurfacePatch } from '../../room-analysis/types'

export interface FirstPersonMovementInput {
  readonly forward: number
  readonly strafe: number
}

export interface FirstPersonCollisionResult {
  readonly position: SpatialPoint
  readonly collided: boolean
  readonly surfaceId: string | null
}

function dot(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function subtract(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }
}

function addScaled(first: SpatialPoint, second: SpatialPoint, scalar: number): SpatialPoint {
  return {
    x: first.x + second.x * scalar,
    y: first.y + second.y * scalar,
    z: first.z + second.z * scalar,
  }
}

function magnitude(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function pointToLocal(point: SpatialPoint, patch: RoomSurfacePatch): RoomSurfaceLocalPoint {
  const relative = subtract(point, patch.basis.origin)
  return {
    u: dot(relative, patch.basis.axisU),
    v: dot(relative, patch.basis.axisV),
  }
}

function pointInPolygon(point: RoomSurfaceLocalPoint, polygon: readonly RoomSurfaceLocalPoint[]): boolean {
  let inside = false
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index]
    const previous = polygon[previousIndex]
    const crossesRay = (current.v > point.v) !== (previous.v > point.v)
    if (crossesRay) {
      const intersectionU = (previous.u - current.u) * (point.v - current.v) / (previous.v - current.v) + current.u
      if (point.u < intersectionU) {
        inside = !inside
      }
    }
  }
  return inside
}

function horizontalPlaneDistance(point: SpatialPoint, patch: RoomSurfacePatch): number {
  const horizontalNormalLength = Math.hypot(patch.normal.x, patch.normal.z)
  if (horizontalNormalLength <= Number.EPSILON) {
    return Infinity
  }
  return (dot(patch.normal, point) - patch.planeConstant) / horizontalNormalLength
}

function supportPatchContains(point: SpatialPoint, patch: RoomSurfacePatch): boolean {
  return pointInPolygon(pointToLocal(point, patch), patch.vertices2DLocal)
}

export function calculateMovementDelta(
  yaw: number,
  input: FirstPersonMovementInput,
  moveSpeedMetersPerSecond: number,
  deltaSeconds: number,
): SpatialPoint {
  const safeDeltaSeconds = Math.min(0.1, Math.max(0, deltaSeconds))
  const forwardLength = Math.hypot(input.forward, input.strafe)
  if (forwardLength <= Number.EPSILON || !Number.isFinite(moveSpeedMetersPerSecond)) {
    return { x: 0, y: 0, z: 0 }
  }
  const inputMagnitude = Math.min(1, forwardLength)
  const forward = input.forward / forwardLength
  const strafe = input.strafe / forwardLength
  const forwardAxis = { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) }
  const rightAxis = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) }
  const direction = {
    x: forwardAxis.x * forward + rightAxis.x * strafe,
    y: 0,
    z: forwardAxis.z * forward + rightAxis.z * strafe,
  }
  return addScaled({ x: 0, y: 0, z: 0 }, direction, moveSpeedMetersPerSecond * safeDeltaSeconds * inputMagnitude)
}

export function resolveWallCollision(
  current: SpatialPoint,
  proposed: SpatialPoint,
  wallPatches: readonly RoomSurfacePatch[],
  collisionRadiusMeters: number,
): FirstPersonCollisionResult {
  const midpoint = {
    x: (current.x + proposed.x) * 0.5,
    y: proposed.y,
    z: (current.z + proposed.z) * 0.5,
  }
  for (const patch of wallPatches) {
    const horizontalNormalLength = Math.hypot(patch.normal.x, patch.normal.z)
    if (patch.role !== 'wall' || horizontalNormalLength <= 0.2 || patch.vertices2DLocal.length < 3) {
      continue
    }
    const hasSurfaceAlongPath = [current, midpoint, proposed].some((point) => supportPatchContains(point, patch))
    if (!hasSurfaceAlongPath) {
      continue
    }
    const currentDistance = horizontalPlaneDistance(current, patch)
    const proposedDistance = horizontalPlaneDistance(proposed, patch)
    const crossedPlane = currentDistance * proposedDistance <= 0
    const movingTowardSurface = Math.abs(proposedDistance) < Math.abs(currentDistance)
    if (crossedPlane || (movingTowardSurface && Math.abs(proposedDistance) < collisionRadiusMeters)) {
      return {
        position: current,
        collided: true,
        surfaceId: patch.sourceSurfaceId,
      }
    }
  }
  return { position: proposed, collided: false, surfaceId: null }
}

export function calculateHorizontalDistance(first: SpatialPoint, second: SpatialPoint): number {
  return Math.hypot(first.x - second.x, first.z - second.z)
}

export function isFiniteNavigationPoint(point: SpatialPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) && magnitude(point) < 1e6
}

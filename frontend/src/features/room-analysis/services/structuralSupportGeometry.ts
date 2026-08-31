import type { FinalizedSpatialScan, SpatialPoint } from '../../scanner/types'
import type { PlaneLocalBounds, StructuralIntersectionLine, StructuralIntersectionRange } from '../types'

export interface SupportPlaneGeometry {
  readonly id: string
  readonly normal: SpatialPoint
  /** Plane representation used by the scanner: n dot x = planeConstant. */
  readonly planeConstant: number
  readonly centroid: SpatialPoint
  readonly localBounds: PlaneLocalBounds
  readonly tangentU: SpatialPoint
  readonly tangentV: SpatialPoint
}

export interface NormalizedSupportPlane {
  readonly normal: SpatialPoint
  readonly planeConstant: number
}

export interface SupportAssociationConfig {
  readonly maximumPlaneResidualMeters: number
  readonly minimumNormalDot: number
  readonly boundsPaddingMeters: number
}

export interface SupportAssociation {
  readonly pointsBySurfaceId: Map<string, SpatialPoint[]>
  readonly rmsBySurfaceId: Map<string, number>
  readonly supportPointsEvaluated: number
}

export interface NearLineSupportSummary {
  readonly nearLineValues: readonly number[]
  readonly minimumDistance: number
  readonly interval: StructuralIntersectionRange | null
}

export interface PlaneIntersectionCalculation {
  readonly line: StructuralIntersectionLine | null
  readonly reason: string | null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function dot(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function cross(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  }
}

function subtract(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }
}

function scale(point: SpatialPoint, scalar: number): SpatialPoint {
  return { x: point.x * scalar, y: point.y * scalar, z: point.z * scalar }
}

function magnitude(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function isFinitePoint(point: SpatialPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

function canonicalizeDirection(direction: SpatialPoint): SpatialPoint {
  const components = [direction.x, direction.y, direction.z]
  let largestIndex = 0
  for (let index = 1; index < components.length; index += 1) {
    if (Math.abs(components[index]) > Math.abs(components[largestIndex])) {
      largestIndex = index
    }
  }
  return components[largestIndex] < 0 ? scale(direction, -1) : direction
}

function quantile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return 0
  }
  const position = clamp(fraction, 0, 1) * (sortedValues.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) {
    return sortedValues[lower]
  }
  const amount = position - lower
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * amount
}

function trimmedRange(values: readonly number[], trimFraction: number): StructuralIntersectionRange | null {
  if (values.length === 0) {
    return null
  }
  const sortedValues = [...values].sort((first, second) => first - second)
  if (sortedValues.length < 5) {
    return { minimum: sortedValues[0], maximum: sortedValues[sortedValues.length - 1] }
  }
  const boundedTrim = clamp(trimFraction, 0, 0.45)
  return {
    minimum: quantile(sortedValues, boundedTrim),
    maximum: quantile(sortedValues, 1 - boundedTrim),
  }
}

export function normalizeSupportPlane(surface: SupportPlaneGeometry): NormalizedSupportPlane | null {
  const normalLength = magnitude(surface.normal)
  if (!Number.isFinite(normalLength) || normalLength <= Number.EPSILON) {
    return null
  }
  const normal = scale(surface.normal, 1 / normalLength)
  const planeConstant = surface.planeConstant / normalLength
  if (!isFinitePoint(normal) || !Number.isFinite(planeConstant)) {
    return null
  }
  return { normal, planeConstant }
}

/** Solve n1 dot x = c1 and n2 dot x = c2 without constructing Three.js objects. */
export function computePlanePlaneIntersectionLine(
  first: NormalizedSupportPlane,
  second: NormalizedSupportPlane,
  minimumCrossMagnitude: number,
): PlaneIntersectionCalculation {
  const directionCross = cross(first.normal, second.normal)
  const crossMagnitude = magnitude(directionCross)
  if (!Number.isFinite(crossMagnitude) || crossMagnitude <= minimumCrossMagnitude) {
    return { line: null, reason: 'planes are parallel or nearly parallel' }
  }

  const direction = canonicalizeDirection(scale(directionCross, 1 / crossMagnitude))
  const firstTerm = scale(cross(second.normal, direction), first.planeConstant)
  const secondTerm = scale(cross(direction, first.normal), second.planeConstant)
  const origin = scale({
    x: firstTerm.x + secondTerm.x,
    y: firstTerm.y + secondTerm.y,
    z: firstTerm.z + secondTerm.z,
  }, 1 / (crossMagnitude * crossMagnitude))

  if (!isFinitePoint(origin) || !isFinitePoint(direction)) {
    return { line: null, reason: 'intersection line was not finite' }
  }
  return { line: { origin, direction }, reason: null }
}

export function distancePointToLine(point: SpatialPoint, line: StructuralIntersectionLine): number {
  return magnitude(cross(subtract(point, line.origin), line.direction))
}

export function collectNearLineSupport(
  points: readonly SpatialPoint[],
  line: StructuralIntersectionLine,
  maximumDistanceMeters: number,
  trimFraction: number,
): NearLineSupportSummary {
  const nearLineValues: number[] = []
  let minimumDistance = Infinity
  for (const point of points) {
    if (!isFinitePoint(point)) {
      continue
    }
    const lineDistance = distancePointToLine(point, line)
    if (!Number.isFinite(lineDistance)) {
      continue
    }
    minimumDistance = Math.min(minimumDistance, lineDistance)
    if (lineDistance <= maximumDistanceMeters) {
      nearLineValues.push(dot(subtract(point, line.origin), line.direction))
    }
  }
  return {
    nearLineValues,
    minimumDistance,
    interval: trimmedRange(nearLineValues, trimFraction),
  }
}

function isWithinSurfaceExtent(
  point: SpatialPoint,
  surface: SupportPlaneGeometry,
  paddingMeters: number,
): boolean {
  const relative = subtract(point, surface.centroid)
  const u = dot(relative, surface.tangentU)
  const v = dot(relative, surface.tangentV)
  return u >= surface.localBounds.minU - paddingMeters &&
    u <= surface.localBounds.maxU + paddingMeters &&
    v >= surface.localBounds.minV - paddingMeters &&
    v <= surface.localBounds.maxV + paddingMeters
}

/**
 * Associate each finalized fused surfel with at most one real surface using the
 * same residual, extent, and normal semantics used by intersection validation.
 */
export function associateFinalizedSupportPoints(
  scan: FinalizedSpatialScan,
  surfaces: readonly SupportPlaneGeometry[],
  config: SupportAssociationConfig,
): SupportAssociation {
  const normalizedSurfaces = surfaces
    .map((surface) => ({ source: surface, normalized: normalizeSupportPlane(surface) }))
    .filter((surface): surface is { source: SupportPlaneGeometry; normalized: NormalizedSupportPlane } => surface.normalized !== null)
  const pointsBySurfaceId = new Map<string, SpatialPoint[]>()
  const squaredResidualsBySurfaceId = new Map<string, number>()
  for (const surface of normalizedSurfaces) {
    pointsBySurfaceId.set(surface.source.id, [])
    squaredResidualsBySurfaceId.set(surface.source.id, 0)
  }

  for (const surfel of scan.fusedSurface) {
    if (!isFinitePoint(surfel.position)) {
      continue
    }
    let bestSurface: { source: SupportPlaneGeometry; normalized: NormalizedSupportPlane } | null = null
    let bestScore = Infinity
    const surfelNormalLength = magnitude(surfel.normal)
    const surfelNormal = Number.isFinite(surfelNormalLength) && surfelNormalLength > Number.EPSILON
      ? scale(surfel.normal, 1 / surfelNormalLength)
      : null

    for (const surface of normalizedSurfaces) {
      const residual = Math.abs(dot(surface.normalized.normal, surfel.position) - surface.normalized.planeConstant)
      if (!Number.isFinite(residual) || residual > config.maximumPlaneResidualMeters ||
        !isWithinSurfaceExtent(surfel.position, surface.source, config.boundsPaddingMeters)) {
        continue
      }
      let normalPenalty = 0
      if (surfelNormal) {
        const normalAgreement = Math.abs(dot(surface.normalized.normal, surfelNormal))
        if (normalAgreement < config.minimumNormalDot) {
          continue
        }
        normalPenalty = 1 - normalAgreement
      }
      const score = residual / Math.max(config.maximumPlaneResidualMeters, Number.EPSILON) + normalPenalty * 0.5
      if (score < bestScore) {
        bestScore = score
        bestSurface = surface
      }
    }

    if (bestSurface) {
      const surfaceId = bestSurface.source.id
      pointsBySurfaceId.get(surfaceId)?.push(surfel.position)
      const residual = dot(bestSurface.normalized.normal, surfel.position) - bestSurface.normalized.planeConstant
      squaredResidualsBySurfaceId.set(
        surfaceId,
        (squaredResidualsBySurfaceId.get(surfaceId) ?? 0) + residual * residual,
      )
    }
  }

  const rmsBySurfaceId = new Map<string, number>()
  for (const [surfaceId, points] of pointsBySurfaceId) {
    const squaredResidual = squaredResidualsBySurfaceId.get(surfaceId) ?? 0
    rmsBySurfaceId.set(surfaceId, points.length > 0 ? Math.sqrt(squaredResidual / points.length) : 0)
  }
  return {
    pointsBySurfaceId,
    rmsBySurfaceId,
    supportPointsEvaluated: scan.fusedSurface.length,
  }
}

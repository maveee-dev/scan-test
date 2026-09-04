import type {
  DenseSpatialPointFrame,
  FinalizedRealityGeometrySurfel,
  FinalizedRealityReconstruction,
  FinalizedRealitySurfel,
  RealityCaptureStatus,
  RealityColorFusionDebug,
  RealityRgbColor,
  ScannerReferenceSpaceType,
  SpatialBounds,
  SpatialPoint,
  ViewerPosition,
} from '../types'
import { LIVE_SURFACE_CONFIG } from './spatialCoverageVisualConfig'
import type { PersistentLiveSurfaceService } from './persistentLiveSurfaceService'
import type { RgbDepthRegistrationResult } from './rgbDepthRegistrationService'

const MAX_COLOR_WEIGHT = 16
const MIN_OUTLIER_OBSERVATIONS = 3
const COLOR_OUTLIER_DISTANCE = 0.45
const MAX_COLOR_FUSION_DISTANCE_METERS = 0.12
const DENSITY_CELL_SIZE_METERS = 0.16
const MAX_SURFELS = LIVE_SURFACE_CONFIG.maxSurfels

function getTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function srgbToLinear(value: number): number {
  const normalized = clamp(value / 255, 0, 1)
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function linearToSrgb(value: number): number {
  const normalized = clamp(value, 0, 1)
  return normalized <= 0.0031308
    ? normalized * 12.92
    : 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055
}

function copyPoint(point: SpatialPoint): Readonly<SpatialPoint> {
  return Object.freeze({ x: point.x, y: point.y, z: point.z })
}

function createInitialDiagnostics(): RealityColorFusionDebug {
  return {
    status: 'idle',
    captureStatus: 'unavailable',
    captureEnabled: false,
    eligibleRgbdTickCount: 0,
    colorSamplesAttempted: 0,
    colorSamplesFused: 0,
    colorSamplesFusedTotal: 0,
    unmatchedSurfelSamples: 0,
    colorRejects: 0,
    coloredSurfelCount: 0,
    totalSurfelCount: 0,
    colorCoveragePercentage: 0,
    averageColorObservations: 0,
    averageColorConfidence: 0,
    colorFusionMs: 0,
    cameraCapturesUsed: 0,
    lastCameraSequence: null,
    lastRealityCaptureTimestamp: null,
    lastColorTimestamp: null,
  }
}

export function createInitialRealityColorFusionDebug(): RealityColorFusionDebug {
  return createInitialDiagnostics()
}

function calculateBounds(surfels: readonly FinalizedRealitySurfel[]): SpatialBounds | null {
  if (surfels.length === 0) {
    return null
  }

  const minimum = { x: Infinity, y: Infinity, z: Infinity }
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const surfel of surfels) {
    minimum.x = Math.min(minimum.x, surfel.position.x)
    minimum.y = Math.min(minimum.y, surfel.position.y)
    minimum.z = Math.min(minimum.z, surfel.position.z)
    maximum.x = Math.max(maximum.x, surfel.position.x)
    maximum.y = Math.max(maximum.y, surfel.position.y)
    maximum.z = Math.max(maximum.z, surfel.position.z)
  }

  return Object.freeze({
    min: copyPoint(minimum),
    max: copyPoint(maximum),
  })
}

function getDensityCellKey(point: SpatialPoint): string {
  return `${Math.floor(point.x / DENSITY_CELL_SIZE_METERS)}:${Math.floor(point.y / DENSITY_CELL_SIZE_METERS)}:${Math.floor(point.z / DENSITY_CELL_SIZE_METERS)}`
}

function calculateDensitySummary(
  surfels: readonly FinalizedRealityGeometrySurfel[],
  surfelCapacity: number,
  capacityReached: boolean,
): Pick<
  import('../types').RealityCaptureSummary,
  'averageNearestNeighborSpacingMeters' | 'approximateUncoveredGapMeters' | 'surfelCapacity' | 'capacityReached'
> {
  if (surfels.length < 2) {
    return {
      averageNearestNeighborSpacingMeters: null,
      approximateUncoveredGapMeters: null,
      surfelCapacity,
      capacityReached,
    }
  }

  const cells = new Map<string, number[]>()
  for (let index = 0; index < surfels.length; index += 1) {
    const key = getDensityCellKey(surfels[index].position)
    const cell = cells.get(key)
    if (cell) {
      cell.push(index)
    } else {
      cells.set(key, [index])
    }
  }

  let spacingTotal = 0
  let spacingCount = 0
  let radiusTotal = 0
  for (let index = 0; index < surfels.length; index += 1) {
    const surfel = surfels[index]
    radiusTotal += surfel.radius
    const cellX = Math.floor(surfel.position.x / DENSITY_CELL_SIZE_METERS)
    const cellY = Math.floor(surfel.position.y / DENSITY_CELL_SIZE_METERS)
    const cellZ = Math.floor(surfel.position.z / DENSITY_CELL_SIZE_METERS)
    let nearestDistanceSquared = Infinity
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
          const neighborCell = cells.get(`${cellX + offsetX}:${cellY + offsetY}:${cellZ + offsetZ}`)
          if (!neighborCell) {
            continue
          }
          for (const neighborIndex of neighborCell) {
            if (neighborIndex === index) {
              continue
            }
            const neighbor = surfels[neighborIndex]
            const dx = surfel.position.x - neighbor.position.x
            const dy = surfel.position.y - neighbor.position.y
            const dz = surfel.position.z - neighbor.position.z
            nearestDistanceSquared = Math.min(
              nearestDistanceSquared,
              dx * dx + dy * dy + dz * dz,
            )
          }
        }
      }
    }
    if (Number.isFinite(nearestDistanceSquared)) {
      spacingTotal += Math.sqrt(nearestDistanceSquared)
      spacingCount += 1
    }
  }

  const averageNearestNeighborSpacingMeters = spacingCount > 0
    ? spacingTotal / spacingCount
    : null
  const averageRadius = radiusTotal / surfels.length
  return {
    averageNearestNeighborSpacingMeters,
    approximateUncoveredGapMeters: averageNearestNeighborSpacingMeters === null
      ? null
      : Math.max(0, averageNearestNeighborSpacingMeters - averageRadius * 2),
    surfelCapacity,
    capacityReached,
  }
}

/**
 * Maintains only application-owned, per-surfel color state. Geometry matching
 * remains exclusively owned by PersistentLiveSurfaceService.
 */
export class RealitySurfelColorFusionService {
  private readonly linearRed = new Float32Array(MAX_SURFELS)

  private readonly linearGreen = new Float32Array(MAX_SURFELS)

  private readonly linearBlue = new Float32Array(MAX_SURFELS)

  private readonly colorWeight = new Float32Array(MAX_SURFELS)

  private readonly colorObservationCount = new Uint32Array(MAX_SURFELS)

  private readonly colorConfidence = new Float32Array(MAX_SURFELS)

  private readonly lastColorObservationAt = new Float64Array(MAX_SURFELS)

  private readonly slotGenerations = new Int32Array(MAX_SURFELS)

  private coloredSurfelCount = 0

  private totalColorObservations = 0

  private totalColorConfidence = 0

  private lastCameraSequence: number | null = null

  private cameraCapturesUsed = 0

  private cameraAvailable = false

  private diagnostics = createInitialDiagnostics()

  public setCaptureState(status: RealityCaptureStatus, enabled: boolean): void {
    this.cameraAvailable = enabled
    this.diagnostics = {
      ...this.diagnostics,
      captureStatus: status,
      captureEnabled: enabled,
      status: enabled ? this.diagnostics.status : 'unavailable',
    }
  }

  public setCameraAvailability(available: boolean): void {
    this.setCaptureState(available ? 'active' : 'unavailable', available)
  }

  public recordEligibleRgbdTick(): void {
    if (!this.cameraAvailable) {
      return
    }

    this.diagnostics = {
      ...this.diagnostics,
      captureStatus: 'active',
      captureEnabled: true,
      eligibleRgbdTickCount: this.diagnostics.eligibleRgbdTickCount + 1,
    }
  }

  public process(
    registration: RgbDepthRegistrationResult,
    denseFrame: DenseSpatialPointFrame,
    matchedSurfelIds: Int32Array,
    matchedSurfelGenerations: Int32Array,
    removedSurfelIds: readonly number[],
    persistentSurfaceService: PersistentLiveSurfaceService,
    cameraPosition: ViewerPosition | null,
    timestamp: number,
    totalSurfelCount: number,
  ): void {
    const startedAt = getTimestamp()
    for (const surfelId of removedSurfelIds) {
      this.resetSlot(surfelId)
    }

    if (!this.cameraAvailable) {
      this.diagnostics = {
        ...this.diagnostics,
        status: 'unavailable',
        totalSurfelCount,
        colorCoveragePercentage: 0,
        colorFusionMs: Math.max(0, getTimestamp() - startedAt),
      }
      return
    }

    if (
      registration.cameraCopySequence >= 0 &&
      registration.cameraCopySequence !== this.lastCameraSequence
    ) {
      this.lastCameraSequence = registration.cameraCopySequence
      this.cameraCapturesUsed += 1
    }
    this.diagnostics = {
      ...this.diagnostics,
      captureStatus: 'active',
      captureEnabled: true,
      lastRealityCaptureTimestamp: timestamp,
    }

    let fusedCount = 0
    let unmatchedCount = 0
    let rejectCount = 0
    for (let observationIndex = 0; observationIndex < registration.coloredSampleCount; observationIndex += 1) {
      const sourceIndex = registration.sourceSampleIndices[observationIndex]
      const surfelId = matchedSurfelIds[sourceIndex] ?? -1
      const generation = matchedSurfelGenerations[sourceIndex] ?? 0
      const target = surfelId >= 0
        ? persistentSurfaceService.getSurfelColorFusionTarget(surfelId)
        : null
      if (!target || target.generation !== generation || !target.active) {
        unmatchedCount += 1
        continue
      }

      this.prepareSlot(target.id, target.generation)
      const pointOffset = sourceIndex * 3
      const sampleX = denseFrame.points[pointOffset]
      const sampleY = denseFrame.points[pointOffset + 1]
      const sampleZ = denseFrame.points[pointOffset + 2]
      if (!Number.isFinite(sampleX) || !Number.isFinite(sampleY) || !Number.isFinite(sampleZ)) {
        rejectCount += 1
        continue
      }

      const colorOffset = observationIndex * 3
      const red = srgbToLinear(registration.srgbColors[colorOffset])
      const green = srgbToLinear(registration.srgbColors[colorOffset + 1])
      const blue = srgbToLinear(registration.srgbColors[colorOffset + 2])
      if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
        rejectCount += 1
        continue
      }

      const dx = sampleX - target.position.x
      const dy = sampleY - target.position.y
      const dz = sampleZ - target.position.z
      const distance = Math.hypot(dx, dy, dz)
      const distanceWeight = clamp(
        1 - distance / MAX_COLOR_FUSION_DISTANCE_METERS,
        0.25,
        1,
      )
      let incidenceWeight = 0.7
      if (target.normal && cameraPosition) {
        const cameraX = cameraPosition.x - target.position.x
        const cameraY = cameraPosition.y - target.position.y
        const cameraZ = cameraPosition.z - target.position.z
        const cameraDistance = Math.hypot(cameraX, cameraY, cameraZ)
        if (cameraDistance > 1e-6 && Number.isFinite(cameraDistance)) {
          const normalDot = Math.abs(
            target.normal.x * (cameraX / cameraDistance) +
            target.normal.y * (cameraY / cameraDistance) +
            target.normal.z * (cameraZ / cameraDistance),
          )
          incidenceWeight = 0.35 + 0.65 * clamp(normalDot, 0, 1)
        }
      }
      const geometryWeight = 0.5 + 0.5 * clamp(target.geometryObservationCount / 3, 0, 1)
      let observationWeight = distanceWeight * incidenceWeight * geometryWeight
      const priorWeight = this.colorWeight[target.id]
      const priorCount = this.colorObservationCount[target.id]
      if (priorCount >= MIN_OUTLIER_OBSERVATIONS && priorWeight > 0) {
        const colorDistance = Math.hypot(
          red - this.linearRed[target.id],
          green - this.linearGreen[target.id],
          blue - this.linearBlue[target.id],
        )
        if (colorDistance > COLOR_OUTLIER_DISTANCE) {
          observationWeight *= 0.1
          if (observationWeight < 0.08) {
            rejectCount += 1
            continue
          }
        } else {
          observationWeight *= clamp(1 - colorDistance * 0.45, 0.7, 1)
        }
      }

      const boundedWeight = Math.max(0.05, observationWeight)
      const nextWeight = Math.min(MAX_COLOR_WEIGHT, priorWeight + boundedWeight)
      const blend = boundedWeight / Math.max(Number.EPSILON, priorWeight + boundedWeight)
      const priorConfidence = this.colorConfidence[target.id]
      if (priorWeight === 0) {
        this.coloredSurfelCount += 1
      }
      this.linearRed[target.id] += (red - this.linearRed[target.id]) * blend
      this.linearGreen[target.id] += (green - this.linearGreen[target.id]) * blend
      this.linearBlue[target.id] += (blue - this.linearBlue[target.id]) * blend
      this.colorWeight[target.id] = nextWeight
      this.colorObservationCount[target.id] += 1
      this.colorConfidence[target.id] = clamp(
        (nextWeight / MAX_COLOR_WEIGHT) * geometryWeight,
        0,
        1,
      )
      this.lastColorObservationAt[target.id] = timestamp
      this.totalColorObservations += 1
      this.totalColorConfidence += this.colorConfidence[target.id] - priorConfidence
      fusedCount += 1
    }

    const colorCoveragePercentage = totalSurfelCount > 0
      ? (this.coloredSurfelCount / totalSurfelCount) * 100
      : 0
    this.diagnostics = {
      ...this.diagnostics,
      status: 'active',
      colorSamplesAttempted: registration.coloredSampleCount,
      colorSamplesFused: fusedCount,
      colorSamplesFusedTotal: this.totalColorObservations,
      unmatchedSurfelSamples: unmatchedCount,
      colorRejects: rejectCount,
      coloredSurfelCount: this.coloredSurfelCount,
      totalSurfelCount,
      colorCoveragePercentage,
      averageColorObservations: this.coloredSurfelCount > 0
        ? this.totalColorObservations / this.coloredSurfelCount
        : 0,
      averageColorConfidence: this.coloredSurfelCount > 0
        ? this.totalColorConfidence / this.coloredSurfelCount
        : 0,
      colorFusionMs: Math.max(0, getTimestamp() - startedAt),
      cameraCapturesUsed: this.cameraCapturesUsed,
      lastCameraSequence: this.lastCameraSequence,
      lastColorTimestamp: timestamp,
    }
  }

  public getDiagnostics(): RealityColorFusionDebug {
    return { ...this.diagnostics }
  }

  public createSnapshot(
    scanId: string,
    referenceSpaceType: ScannerReferenceSpaceType,
    surfels: readonly FinalizedRealityGeometrySurfel[],
    cameraAvailable: boolean,
    surfelCapacity: number = MAX_SURFELS,
    capacityReached = false,
  ): FinalizedRealityReconstruction {
    const finalizedSurfels: FinalizedRealitySurfel[] = surfels.map((surfel) => {
      const hasColor = surfel.id >= 0 && surfel.id < MAX_SURFELS && this.colorWeight[surfel.id] > 0
      const colorRgb: RealityRgbColor | null = hasColor
        ? Object.freeze({
          r: linearToSrgb(this.linearRed[surfel.id]),
          g: linearToSrgb(this.linearGreen[surfel.id]),
          b: linearToSrgb(this.linearBlue[surfel.id]),
        })
        : null
      return Object.freeze({
        id: surfel.id,
        position: copyPoint(surfel.position),
        normal: copyPoint(surfel.normal),
        radius: surfel.radius,
        colorRgb,
        colorSpace: 'srgb' as const,
        geometryConfidence: surfel.geometryConfidence,
        colorConfidence: hasColor ? this.colorConfidence[surfel.id] : 0,
        colorObservationCount: hasColor ? this.colorObservationCount[surfel.id] : 0,
      })
    })
    const frozenSurfels = Object.freeze(finalizedSurfels)
    let colorObservationTotal = 0
    let confidenceTotal = 0
    let coloredSurfels = 0
    for (const surfel of frozenSurfels) {
      if (!surfel.colorRgb) {
        continue
      }
      coloredSurfels += 1
      colorObservationTotal += surfel.colorObservationCount
      confidenceTotal += surfel.colorConfidence
    }
    const densitySummary = calculateDensitySummary(surfels, surfelCapacity, capacityReached)
    const captureSummary = Object.freeze({
      totalSurfels: frozenSurfels.length,
      coloredSurfels,
      colorCoveragePercentage: frozenSurfels.length > 0
        ? (coloredSurfels / frozenSurfels.length) * 100
        : 0,
      averageColorObservations: coloredSurfels > 0 ? colorObservationTotal / coloredSurfels : 0,
      cameraCapturesUsed: this.cameraCapturesUsed,
      averageColorConfidence: coloredSurfels > 0 ? confidenceTotal / coloredSurfels : 0,
      ...densitySummary,
    })
    const status = !cameraAvailable
      ? 'unavailable'
      : coloredSurfels === 0
        ? 'empty'
        : 'available'
    return Object.freeze({
      scanId,
      referenceSpaceType,
      status,
      surfels: frozenSurfels,
      bounds: calculateBounds(frozenSurfels),
      captureSummary,
    })
  }

  public reset(): void {
    this.linearRed.fill(0)
    this.linearGreen.fill(0)
    this.linearBlue.fill(0)
    this.colorWeight.fill(0)
    this.colorObservationCount.fill(0)
    this.colorConfidence.fill(0)
    this.lastColorObservationAt.fill(0)
    this.slotGenerations.fill(0)
    this.coloredSurfelCount = 0
    this.totalColorObservations = 0
    this.totalColorConfidence = 0
    this.lastCameraSequence = null
    this.cameraCapturesUsed = 0
    this.cameraAvailable = false
    this.diagnostics = createInitialDiagnostics()
  }

  public dispose(): void {
    this.reset()
  }

  private prepareSlot(id: number, generation: number): void {
    if (id < 0 || id >= MAX_SURFELS || generation <= 0) {
      return
    }
    if (this.slotGenerations[id] !== generation) {
      this.resetSlot(id)
      this.slotGenerations[id] = generation
    }
  }

  private resetSlot(id: number): void {
    if (id < 0 || id >= MAX_SURFELS) {
      return
    }
    if (this.colorWeight[id] > 0) {
      this.coloredSurfelCount = Math.max(0, this.coloredSurfelCount - 1)
      this.totalColorObservations = Math.max(
        0,
        this.totalColorObservations - this.colorObservationCount[id],
      )
      this.totalColorConfidence -= this.colorConfidence[id]
    }
    this.linearRed[id] = 0
    this.linearGreen[id] = 0
    this.linearBlue[id] = 0
    this.colorWeight[id] = 0
    this.colorObservationCount[id] = 0
    this.colorConfidence[id] = 0
    this.lastColorObservationAt[id] = 0
    this.slotGenerations[id] = 0
  }
}

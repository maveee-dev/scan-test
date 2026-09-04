import type {
  DenseRealityFusionDebug,
  DenseSpatialPointFrame,
  FinalizedDenseRealityReconstruction,
  FinalizedRealitySurfel,
  RealityCaptureSummary,
  RealityRgbColor,
  ScannerReferenceSpaceType,
  SpatialBounds,
  SpatialPoint,
  ViewerPosition,
} from '../types'
import type { PersistentLiveSurfaceService } from './persistentLiveSurfaceService'
import type { RgbDepthRegistrationResult } from './rgbDepthRegistrationService'

export const DENSE_REALITY_CONFIG = Object.freeze({
  cellSizeMeters: 0.025,
  maxSamples: 60000,
  maxMergeDistanceMeters: 0.021,
  maxPointToPlaneResidualMeters: 0.012,
  minNormalDot: Math.cos(40 * Math.PI / 180),
  maxCandidatesPerSample: 48,
  minimumStableObservations: 2,
  sampleRadiusMeters: 0.0125,
})

const MAX_COLOR_WEIGHT = 16
const MIN_COLOR_OUTLIER_OBSERVATIONS = 3
const COLOR_OUTLIER_DISTANCE = 0.5
const VECTOR_EPSILON = 1e-6
const DENSITY_CELL_SIZE_METERS = 0.05
const SMALL_GAP_LIMIT_METERS = 0.04
const LARGE_GAP_LIMIT_METERS = 0.12
const MAX_DENSITY_CANDIDATES = 64

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
  return (normalized <= 0.0031308
    ? normalized * 12.92
    : 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055) * 255
}

function copyPoint(point: SpatialPoint): Readonly<SpatialPoint> {
  return Object.freeze({ x: point.x, y: point.y, z: point.z })
}

function normalize(point: SpatialPoint, target: SpatialPoint): boolean {
  const length = Math.hypot(point.x, point.y, point.z)
  if (!Number.isFinite(length) || length <= VECTOR_EPSILON) {
    return false
  }

  target.x = point.x / length
  target.y = point.y / length
  target.z = point.z / length
  return true
}

function getCellCoordinate(value: number): number {
  return Math.floor(value / DENSE_REALITY_CONFIG.cellSizeMeters)
}

function getCellKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`
}

function getPointCellKey(point: SpatialPoint): string {
  return getCellKey(
    getCellCoordinate(point.x),
    getCellCoordinate(point.y),
    getCellCoordinate(point.z),
  )
}

function getDensityCellKey(point: SpatialPoint): string {
  return `${Math.floor(point.x / DENSITY_CELL_SIZE_METERS)}:${Math.floor(point.y / DENSITY_CELL_SIZE_METERS)}:${Math.floor(point.z / DENSITY_CELL_SIZE_METERS)}`
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

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index] ?? null
}

function createDensitySummary(
  surfels: readonly FinalizedRealitySurfel[],
  capacity: number,
  capacityUsed: number,
  capacityReached: boolean,
): Pick<
  RealityCaptureSummary,
  | 'averageNearestNeighborSpacingMeters'
  | 'medianNearestNeighborSpacingMeters'
  | 'p90NearestNeighborSpacingMeters'
  | 'approximateUncoveredGapMeters'
  | 'estimatedSmallGapRegionCount'
  | 'estimatedLargeUnsupportedGapCount'
  | 'surfelCapacity'
  | 'capacityUtilizationPercentage'
  | 'capacityReached'
> {
  const capacityUtilizationPercentage = capacity > 0
    ? Math.min(100, (capacityUsed / capacity) * 100)
    : 0
  if (surfels.length < 2) {
    return {
      averageNearestNeighborSpacingMeters: null,
      medianNearestNeighborSpacingMeters: null,
      p90NearestNeighborSpacingMeters: null,
      approximateUncoveredGapMeters: null,
      estimatedSmallGapRegionCount: 0,
      estimatedLargeUnsupportedGapCount: 0,
      surfelCapacity: capacity,
      capacityUtilizationPercentage,
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

  const nearestDistances: number[] = []
  let smallGapCount = 0
  let largeGapCount = 0
  let spacingTotal = 0
  for (let index = 0; index < surfels.length; index += 1) {
    const surfel = surfels[index]
    const cellX = Math.floor(surfel.position.x / DENSITY_CELL_SIZE_METERS)
    const cellY = Math.floor(surfel.position.y / DENSITY_CELL_SIZE_METERS)
    const cellZ = Math.floor(surfel.position.z / DENSITY_CELL_SIZE_METERS)
    let nearestDistanceSquared = Infinity
    let candidatesChecked = 0
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
          const neighborCell = cells.get(getCellKey(cellX + offsetX, cellY + offsetY, cellZ + offsetZ))
          if (!neighborCell) {
            continue
          }
          for (const neighborIndex of neighborCell) {
            if (neighborIndex === index || candidatesChecked >= MAX_DENSITY_CANDIDATES) {
              continue
            }
            candidatesChecked += 1
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

    if (!Number.isFinite(nearestDistanceSquared)) {
      largeGapCount += 1
      continue
    }

    const nearestDistance = Math.sqrt(nearestDistanceSquared)
    nearestDistances.push(nearestDistance)
    spacingTotal += nearestDistance
    const gap = nearestDistance - surfel.radius * 2
    if (gap > 0 && gap <= SMALL_GAP_LIMIT_METERS) {
      smallGapCount += 1
    } else if (gap > LARGE_GAP_LIMIT_METERS) {
      largeGapCount += 1
    }
  }

  const averageSpacing = nearestDistances.length > 0
    ? spacingTotal / nearestDistances.length
    : null
  return {
    averageNearestNeighborSpacingMeters: averageSpacing,
    medianNearestNeighborSpacingMeters: percentile(nearestDistances, 0.5),
    p90NearestNeighborSpacingMeters: percentile(nearestDistances, 0.9),
    approximateUncoveredGapMeters: averageSpacing === null
      ? null
      : Math.max(0, averageSpacing - (surfels.reduce((total, surfel) => total + surfel.radius, 0) / surfels.length) * 2),
    estimatedSmallGapRegionCount: smallGapCount,
    estimatedLargeUnsupportedGapCount: largeGapCount,
    surfelCapacity: capacity,
    capacityUtilizationPercentage,
    capacityReached,
  }
}

function createInitialDiagnostics(): DenseRealityFusionDebug {
  return {
    status: 'idle',
    inputSampleCount: 0,
    inputColorSampleCount: 0,
    createdSampleCount: 0,
    fusedSampleCount: 0,
    rejectedSampleCount: 0,
    activeSampleCount: 0,
    stableSampleCount: 0,
    capacity: DENSE_REALITY_CONFIG.maxSamples,
    capacityUtilizationPercentage: 0,
    capacityReached: false,
    fusionMs: 0,
    lastCaptureTimestamp: null,
    lastCameraSequence: null,
    cameraCapturesUsed: 0,
  }
}

export function createInitialDenseRealityFusionDebug(): DenseRealityFusionDebug {
  return createInitialDiagnostics()
}

/**
 * Maintains a visual-only, finer RGB-D store. Structural geometry remains
 * owned by PersistentLiveSurfaceService; this service never matches or edits
 * structural surfels.
 */
export class DenseRealityReconstructionService {
  private readonly positions = new Float32Array(DENSE_REALITY_CONFIG.maxSamples * 3)

  private readonly normals = new Float32Array(DENSE_REALITY_CONFIG.maxSamples * 3)

  private readonly linearColors = new Float32Array(DENSE_REALITY_CONFIG.maxSamples * 3)

  private readonly colorWeights = new Float32Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly colorObservationCounts = new Uint32Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly geometryObservationCounts = new Uint32Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly lastObservedAt = new Float64Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly active = new Uint8Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly nextInCell = new Int32Array(DENSE_REALITY_CONFIG.maxSamples)

  private readonly cellHeads = new Map<string, number>()

  private readonly samplePoint: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly sampleNormal: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly cameraVector: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly normalizedCameraVector: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly normalScratch: SpatialPoint = { x: 0, y: 0, z: 0 }

  private bestMatchDistance = 0

  private activeSampleCount = 0

  private stableSampleCount = 0

  private capacityReached = false

  private totalCreatedSampleCount = 0

  private totalFusedSampleCount = 0

  private totalRejectedSampleCount = 0

  private totalInputSampleCount = 0

  private totalInputColorSampleCount = 0

  private lastCameraSequence: number | null = null

  private cameraCapturesUsed = 0

  private diagnostics = createInitialDiagnostics()

  constructor() {
    this.nextInCell.fill(-1)
  }

  public process(
    registration: RgbDepthRegistrationResult,
    denseFrame: DenseSpatialPointFrame,
    persistentSurfaceService: PersistentLiveSurfaceService,
    cameraPosition: ViewerPosition | null,
    timestamp: number,
  ): void {
    const startedAt = getTimestamp()
    this.totalInputSampleCount += denseFrame.validPointCount
    this.totalInputColorSampleCount += registration.coloredSampleCount
    if (registration.cameraCopySequence >= 0 && registration.cameraCopySequence !== this.lastCameraSequence) {
      this.lastCameraSequence = registration.cameraCopySequence
      this.cameraCapturesUsed += 1
    }

    let createdCount = 0
    let fusedCount = 0
    let rejectedCount = 0
    for (let observationIndex = 0; observationIndex < registration.coloredSampleCount; observationIndex += 1) {
      const sourceIndex = registration.sourceSampleIndices[observationIndex]
      if (
        sourceIndex < 0 ||
        sourceIndex >= denseFrame.valid.length ||
        denseFrame.valid[sourceIndex] !== 1
      ) {
        rejectedCount += 1
        continue
      }

      const pointOffset = sourceIndex * 3
      this.samplePoint.x = denseFrame.points[pointOffset]
      this.samplePoint.y = denseFrame.points[pointOffset + 1]
      this.samplePoint.z = denseFrame.points[pointOffset + 2]
      if (!Number.isFinite(this.samplePoint.x) || !Number.isFinite(this.samplePoint.y) || !Number.isFinite(this.samplePoint.z)) {
        rejectedCount += 1
        continue
      }

      if (!persistentSurfaceService.copySampleNormal(sourceIndex, this.sampleNormal)) {
        rejectedCount += 1
        continue
      }

      const colorOffset = observationIndex * 3
      const red = srgbToLinear(registration.srgbColors[colorOffset])
      const green = srgbToLinear(registration.srgbColors[colorOffset + 1])
      const blue = srgbToLinear(registration.srgbColors[colorOffset + 2])
      if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
        rejectedCount += 1
        continue
      }

      const matchIndex = this.findCompatibleSample(this.samplePoint, this.sampleNormal)
      if (matchIndex >= 0) {
        if (this.fuseSample(matchIndex, this.bestMatchDistance, red, green, blue, cameraPosition, timestamp)) {
          fusedCount += 1
        } else {
          rejectedCount += 1
        }
        continue
      }

      if (this.activeSampleCount >= DENSE_REALITY_CONFIG.maxSamples) {
        this.capacityReached = true
        rejectedCount += 1
        continue
      }

      this.createSample(this.samplePoint, this.sampleNormal, red, green, blue, timestamp)
      createdCount += 1
    }

    this.totalCreatedSampleCount += createdCount
    this.totalFusedSampleCount += fusedCount
    this.totalRejectedSampleCount += rejectedCount
    this.diagnostics = {
      ...this.diagnostics,
      status: this.activeSampleCount > 0 ? 'active' : 'empty',
      inputSampleCount: this.totalInputSampleCount,
      inputColorSampleCount: this.totalInputColorSampleCount,
      createdSampleCount: this.totalCreatedSampleCount,
      fusedSampleCount: this.totalFusedSampleCount,
      rejectedSampleCount: this.totalRejectedSampleCount,
      activeSampleCount: this.activeSampleCount,
      stableSampleCount: this.stableSampleCount,
      capacity: DENSE_REALITY_CONFIG.maxSamples,
      capacityUtilizationPercentage: (this.activeSampleCount / DENSE_REALITY_CONFIG.maxSamples) * 100,
      capacityReached: this.capacityReached,
      fusionMs: Math.max(0, getTimestamp() - startedAt),
      lastCaptureTimestamp: timestamp,
      lastCameraSequence: this.lastCameraSequence,
      cameraCapturesUsed: this.cameraCapturesUsed,
    }
  }

  public getDiagnostics(): DenseRealityFusionDebug {
    return { ...this.diagnostics }
  }

  public createSnapshot(
    scanId: string,
    referenceSpaceType: ScannerReferenceSpaceType,
    cameraAvailable: boolean,
  ): FinalizedDenseRealityReconstruction | null {
    if (!cameraAvailable) {
      return null
    }

    const finalizedSurfels: FinalizedRealitySurfel[] = []
    let colorObservationTotal = 0
    let colorConfidenceTotal = 0
    for (let index = 0; index < this.activeSampleCount; index += 1) {
      if (
        this.active[index] !== 1 ||
        this.geometryObservationCounts[index] < DENSE_REALITY_CONFIG.minimumStableObservations
      ) {
        continue
      }

      const positionOffset = index * 3
      const colorOffset = index * 3
      const hasColor = this.colorWeights[index] > 0
      const colorRgb: RealityRgbColor | null = hasColor
        ? Object.freeze({
          r: linearToSrgb(this.linearColors[colorOffset]),
          g: linearToSrgb(this.linearColors[colorOffset + 1]),
          b: linearToSrgb(this.linearColors[colorOffset + 2]),
        })
        : null
      const colorConfidence = hasColor
        ? clamp(this.colorWeights[index] / MAX_COLOR_WEIGHT, 0, 1)
        : 0
      colorObservationTotal += this.colorObservationCounts[index]
      colorConfidenceTotal += colorConfidence
      finalizedSurfels.push(Object.freeze({
        id: index,
        position: Object.freeze({
          x: this.positions[positionOffset],
          y: this.positions[positionOffset + 1],
          z: this.positions[positionOffset + 2],
        }),
        normal: Object.freeze({
          x: this.normals[positionOffset],
          y: this.normals[positionOffset + 1],
          z: this.normals[positionOffset + 2],
        }),
        radius: DENSE_REALITY_CONFIG.sampleRadiusMeters,
        colorRgb,
        colorSpace: 'srgb' as const,
        geometryConfidence: clamp(this.geometryObservationCounts[index] / 4, 0, 1),
        colorConfidence,
        colorObservationCount: this.colorObservationCounts[index],
      }))
    }

    const frozenSurfels = Object.freeze(finalizedSurfels)
    const coloredSurfels = frozenSurfels.filter((surfel) => surfel.colorRgb !== null).length
    const densitySummary = createDensitySummary(
      frozenSurfels,
      DENSE_REALITY_CONFIG.maxSamples,
      this.activeSampleCount,
      this.capacityReached,
    )
    const captureSummary: RealityCaptureSummary = Object.freeze({
      totalSurfels: frozenSurfels.length,
      coloredSurfels,
      colorCoveragePercentage: frozenSurfels.length > 0
        ? (coloredSurfels / frozenSurfels.length) * 100
        : 0,
      averageColorObservations: coloredSurfels > 0 ? colorObservationTotal / coloredSurfels : 0,
      cameraCapturesUsed: this.cameraCapturesUsed,
      averageColorConfidence: coloredSurfels > 0 ? colorConfidenceTotal / coloredSurfels : 0,
      ...densitySummary,
    })
    const status = coloredSurfels > 0 ? 'available' : 'empty'
    return Object.freeze({
      scanId,
      referenceSpaceType,
      status,
      surfels: frozenSurfels,
      bounds: calculateBounds(frozenSurfels),
      captureSummary,
      fusionDiagnostics: Object.freeze({ ...this.diagnostics }),
    })
  }

  public reset(): void {
    this.positions.fill(0)
    this.normals.fill(0)
    this.linearColors.fill(0)
    this.colorWeights.fill(0)
    this.colorObservationCounts.fill(0)
    this.geometryObservationCounts.fill(0)
    this.lastObservedAt.fill(0)
    this.active.fill(0)
    this.nextInCell.fill(-1)
    this.cellHeads.clear()
    this.activeSampleCount = 0
    this.stableSampleCount = 0
    this.capacityReached = false
    this.totalCreatedSampleCount = 0
    this.totalFusedSampleCount = 0
    this.totalRejectedSampleCount = 0
    this.totalInputSampleCount = 0
    this.totalInputColorSampleCount = 0
    this.lastCameraSequence = null
    this.cameraCapturesUsed = 0
    this.diagnostics = createInitialDiagnostics()
  }

  public dispose(): void {
    this.reset()
  }

  private findCompatibleSample(point: SpatialPoint, normal: SpatialPoint): number {
    const cellX = getCellCoordinate(point.x)
    const cellY = getCellCoordinate(point.y)
    const cellZ = getCellCoordinate(point.z)
    let candidateCount = 0
    let bestIndex = -1
    let bestDistance = Infinity
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
          const head = this.cellHeads.get(getCellKey(cellX + offsetX, cellY + offsetY, cellZ + offsetZ))
          let index = head ?? -1
          while (index >= 0 && candidateCount < DENSE_REALITY_CONFIG.maxCandidatesPerSample) {
            candidateCount += 1
            if (this.active[index] === 1) {
              const positionOffset = index * 3
              const dx = point.x - this.positions[positionOffset]
              const dy = point.y - this.positions[positionOffset + 1]
              const dz = point.z - this.positions[positionOffset + 2]
              const distanceSquared = dx * dx + dy * dy + dz * dz
              if (distanceSquared <= DENSE_REALITY_CONFIG.maxMergeDistanceMeters ** 2) {
                const normalDot = Math.abs(
                  normal.x * this.normals[positionOffset] +
                  normal.y * this.normals[positionOffset + 1] +
                  normal.z * this.normals[positionOffset + 2],
                )
                const residual = Math.abs(
                  dx * this.normals[positionOffset] +
                  dy * this.normals[positionOffset + 1] +
                  dz * this.normals[positionOffset + 2],
                )
                if (
                  normalDot >= DENSE_REALITY_CONFIG.minNormalDot &&
                  residual <= DENSE_REALITY_CONFIG.maxPointToPlaneResidualMeters
                ) {
                  const distance = Math.sqrt(distanceSquared)
                  if (distance < bestDistance) {
                    bestIndex = index
                    bestDistance = distance
                  }
                }
              }
            }
            index = this.nextInCell[index]
          }
        }
      }
    }
    this.bestMatchDistance = bestDistance
    return bestIndex
  }

  private createSample(
    point: SpatialPoint,
    normal: SpatialPoint,
    red: number,
    green: number,
    blue: number,
    timestamp: number,
  ): void {
    const index = this.activeSampleCount
    const offset = index * 3
    this.positions[offset] = point.x
    this.positions[offset + 1] = point.y
    this.positions[offset + 2] = point.z
    this.normals[offset] = normal.x
    this.normals[offset + 1] = normal.y
    this.normals[offset + 2] = normal.z
    this.linearColors[offset] = red
    this.linearColors[offset + 1] = green
    this.linearColors[offset + 2] = blue
    this.colorWeights[index] = 1
    this.colorObservationCounts[index] = 1
    this.geometryObservationCounts[index] = 1
    this.lastObservedAt[index] = timestamp
    this.active[index] = 1
    const key = getPointCellKey(point)
    this.nextInCell[index] = this.cellHeads.get(key) ?? -1
    this.cellHeads.set(key, index)
    this.activeSampleCount += 1
  }

  private fuseSample(
    matchIndex: number,
    matchDistance: number,
    red: number,
    green: number,
    blue: number,
    cameraPosition: ViewerPosition | null,
    timestamp: number,
  ): boolean {
    const index = matchIndex
    const offset = index * 3
    const priorWeight = this.colorWeights[index]
    const priorCount = this.colorObservationCounts[index]
    let observationWeight = clamp(
      1 - matchDistance / DENSE_REALITY_CONFIG.maxMergeDistanceMeters,
      0.4,
      1,
    )
    if (cameraPosition) {
      this.cameraVector.x = cameraPosition.x - this.positions[offset]
      this.cameraVector.y = cameraPosition.y - this.positions[offset + 1]
      this.cameraVector.z = cameraPosition.z - this.positions[offset + 2]
      if (normalize(this.cameraVector, this.normalizedCameraVector)) {
        const incidence = Math.abs(
          this.normals[offset] * this.normalizedCameraVector.x +
          this.normals[offset + 1] * this.normalizedCameraVector.y +
          this.normals[offset + 2] * this.normalizedCameraVector.z,
        )
        observationWeight *= 0.35 + 0.65 * clamp(incidence, 0, 1)
      }
    }

    if (priorCount >= MIN_COLOR_OUTLIER_OBSERVATIONS && priorWeight > 0) {
      const colorDistance = Math.hypot(
        red - this.linearColors[offset],
        green - this.linearColors[offset + 1],
        blue - this.linearColors[offset + 2],
      )
      if (colorDistance > COLOR_OUTLIER_DISTANCE) {
        observationWeight *= 0.1
        if (observationWeight < 0.08) {
          return false
        }
      } else {
        observationWeight *= clamp(1 - colorDistance * 0.45, 0.7, 1)
      }
    }

    const boundedWeight = Math.max(0.05, observationWeight)
    const nextWeight = Math.min(MAX_COLOR_WEIGHT, priorWeight + boundedWeight)
    const blend = boundedWeight / Math.max(Number.EPSILON, priorWeight + boundedWeight)
    this.positions[offset] += (this.samplePoint.x - this.positions[offset]) * Math.min(0.35, blend)
    this.positions[offset + 1] += (this.samplePoint.y - this.positions[offset + 1]) * Math.min(0.35, blend)
    this.positions[offset + 2] += (this.samplePoint.z - this.positions[offset + 2]) * Math.min(0.35, blend)
    this.normals[offset] += (this.sampleNormal.x - this.normals[offset]) * Math.min(0.35, blend)
    this.normals[offset + 1] += (this.sampleNormal.y - this.normals[offset + 1]) * Math.min(0.35, blend)
    this.normals[offset + 2] += (this.sampleNormal.z - this.normals[offset + 2]) * Math.min(0.35, blend)
    this.normalScratch.x = this.normals[offset]
    this.normalScratch.y = this.normals[offset + 1]
    this.normalScratch.z = this.normals[offset + 2]
    if (normalize(this.normalScratch, this.sampleNormal)) {
      this.normals[offset] = this.sampleNormal.x
      this.normals[offset + 1] = this.sampleNormal.y
      this.normals[offset + 2] = this.sampleNormal.z
    }
    this.linearColors[offset] += (red - this.linearColors[offset]) * blend
    this.linearColors[offset + 1] += (green - this.linearColors[offset + 1]) * blend
    this.linearColors[offset + 2] += (blue - this.linearColors[offset + 2]) * blend
    this.colorWeights[index] = nextWeight
    this.colorObservationCounts[index] += 1
    if (
      this.geometryObservationCounts[index] < DENSE_REALITY_CONFIG.minimumStableObservations &&
      this.geometryObservationCounts[index] + 1 >= DENSE_REALITY_CONFIG.minimumStableObservations
    ) {
      this.stableSampleCount += 1
    }
    this.geometryObservationCounts[index] += 1
    this.lastObservedAt[index] = timestamp
    return true
  }

}

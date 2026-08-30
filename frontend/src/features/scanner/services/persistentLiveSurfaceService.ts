import type {
  CoverageCellState,
  DenseCoverageMesh,
  DenseSpatialPointFrame,
  FinalizedSurfaceSurfel,
  PersistentLiveSurfaceDebug,
  SpatialPoint,
  ViewerPosition,
} from '../types'
import {
  COVERAGE_VISUAL_COLORS,
  COVERAGE_VISUAL_CONFIDENCE,
  COVERAGE_VISUAL_OPACITY,
  LIVE_SURFACE_CONFIG,
} from './spatialCoverageVisualConfig'
import { SpatialCoverageService } from './spatialCoverageService'

const FLOATS_PER_VERTEX = 7
const VERTICES_PER_SURFEL = 6
const VECTOR_EPSILON = 1e-6

interface LiveSurfaceSurfel {
  id: number
  bucketKey: string
  position: SpatialPoint
  normal: SpatialPoint | null
  radius: number
  observationWeight: number
  geometryObservationCount: number
  lastFusionUpdate: number
  lastMeasuredAt: number
  geometryState: 'new' | 'confirmed' | 'stable'
  visualConfidence: number
  active: boolean
  lastTouchedUpdate: number
}

interface CompatibleSurfelResult {
  surfel: LiveSurfaceSurfel | null
  candidateCount: number
}

export interface PersistentLiveSurfaceFrameResult {
  persistentSurfaceMesh: DenseCoverageMesh
  candidateSurfaceMesh: DenseCoverageMesh
}

function getPerformanceTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function getBucketCoordinate(value: number): number {
  return Math.floor(value / LIVE_SURFACE_CONFIG.spatialBucketSizeMeters)
}

function getBucketKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`
}

function getPointBucketKey(point: SpatialPoint): string {
  return getBucketKey(
    getBucketCoordinate(point.x),
    getBucketCoordinate(point.y),
    getBucketCoordinate(point.z),
  )
}

function getPointFromFrame(
  frame: DenseSpatialPointFrame,
  index: number,
  target: SpatialPoint,
): void {
  const offset = index * 3
  target.x = frame.points[offset]
  target.y = frame.points[offset + 1]
  target.z = frame.points[offset + 2]
}

function isFinitePoint(point: SpatialPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

function dot(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function length(point: SpatialPoint): number {
  return Math.hypot(point.x, point.y, point.z)
}

function normalize(point: SpatialPoint, target: SpatialPoint): boolean {
  const pointLength = length(point)
  if (!Number.isFinite(pointLength) || pointLength <= VECTOR_EPSILON) {
    return false
  }

  target.x = point.x / pointLength
  target.y = point.y / pointLength
  target.z = point.z / pointLength
  return Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z)
}

function writeVertex(
  data: Float32Array,
  offset: number,
  point: SpatialPoint,
  color: readonly [number, number, number],
  opacity: number,
): void {
  data[offset] = point.x
  data[offset + 1] = point.y
  data[offset + 2] = point.z
  data[offset + 3] = color[0]
  data[offset + 4] = color[1]
  data[offset + 5] = color[2]
  data[offset + 6] = opacity
}

function stateForConfidence(confidence: number): CoverageCellState {
  if (confidence >= COVERAGE_VISUAL_CONFIDENCE.partial) {
    return confidence >= COVERAGE_VISUAL_CONFIDENCE.captured ? 'captured' : 'partial'
  }

  return 'observed'
}

function maskOpacityForConfidence(confidence: number): number {
  const boundedConfidence = Math.max(0, Math.min(1, confidence))
  return COVERAGE_VISUAL_OPACITY.candidate * (1 - boundedConfidence)
}

/**
 * Fuses measured world-space depth points into bounded persistent live surfels.
 * The service owns active-session fused geometry. A finish operation may copy
 * confirmed real surfels into plain application data before this service is
 * disposed; visualization buffers never leave this service.
 */
export class PersistentLiveSurfaceService {
  private readonly surfels: LiveSurfaceSurfel[] = []

  private readonly freeSurfelIds: number[] = []

  private readonly buckets = new Map<string, number[]>()

  private activeSurfelCount = 0

  private readonly samplePoint: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly sampleNormal: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly horizontal: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly vertical: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly normalScratch: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly cameraOffset: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly incomingNormal: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly tangent: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly bitangent: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly cornerA: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly cornerB: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly cornerC: SpatialPoint = { x: 0, y: 0, z: 0 }

  private readonly cornerD: SpatialPoint = { x: 0, y: 0, z: 0 }

  private vertexData = new Float32Array(0)

  private candidateVertexData = new Float32Array(0)

  private candidateVertexOffset = 0

  private updateSequence = 0

  private meshRevision = 0

  private candidateMeshRevision = 0

  private firstUpdateAt: number | null = null

  private cleanupCursor = 0

  private diagnostics: PersistentLiveSurfaceDebug = this.createInitialDiagnostics()

  public processFrame(
    frame: DenseSpatialPointFrame,
    cameraPosition: ViewerPosition | null,
    timestamp: number,
    coverageService: SpatialCoverageService,
    debugVisible = false,
  ): PersistentLiveSurfaceFrameResult {
    const processingStartedAt = getPerformanceTimestamp()
    const sampleCount = frame.columns * frame.rows
    this.updateSequence += 1
    this.candidateVertexOffset = 0
    this.ensureNormalCapacity(sampleCount)
    this.estimateNormals(frame, cameraPosition)
    this.removeWeakSurfels(timestamp)

    let incomingMeasuredPointCount = 0
    let newSurfelCount = 0
    let fusedSurfelCount = 0
    let candidateCount = 0
    let fusionRejectCount = 0
    let distanceRejectedCount = 0
    let pointToPlaneRejectedCount = 0
    let normalRejectedCount = 0
    let matchedCurrentPointCount = 0
    let unmatchedCandidateSampleCount = 0
    let candidateSuppressedByCapturedMatchCount = 0
    let candidateSuppressedByIncompleteMatchCount = 0

    for (let index = 0; index < sampleCount; index += 1) {
      if (frame.valid[index] !== 1) {
        continue
      }

      getPointFromFrame(frame, index, this.samplePoint)
      if (!isFinitePoint(this.samplePoint)) {
        continue
      }

      incomingMeasuredPointCount += 1
      const hasNormal = this.normalValidity[index] === 1
      if (hasNormal) {
        const normalOffset = index * 3
        this.sampleNormal.x = this.sampleNormals[normalOffset]
        this.sampleNormal.y = this.sampleNormals[normalOffset + 1]
        this.sampleNormal.z = this.sampleNormals[normalOffset + 2]
      }

      const match = this.findCompatibleSurfel(
        this.samplePoint,
        hasNormal ? this.sampleNormal : null,
      )
      candidateCount += match.candidateCount
      fusionRejectCount += this.lastRejectedCandidates
      distanceRejectedCount += this.lastDistanceRejectedCandidates
      pointToPlaneRejectedCount += this.lastPointToPlaneRejectedCandidates
      normalRejectedCount += this.lastNormalRejectedCandidates

      if (match.surfel) {
        matchedCurrentPointCount += 1
        if (match.surfel.visualConfidence >= COVERAGE_VISUAL_CONFIDENCE.captured) {
          candidateSuppressedByCapturedMatchCount += 1
        } else {
          candidateSuppressedByIncompleteMatchCount += 1
        }
      } else {
        unmatchedCandidateSampleCount += 1
        // This candidate is world-space geometry from the current measured
        // frame. It fills the brief gap before a new surfel is available and
        // is deliberately subsampled to keep first-contact work mobile-safe.
        if (
          hasNormal &&
          index % 2 === 0 &&
          Math.floor(index / frame.columns) % 2 === 0
        ) {
          this.ensureCandidateVertexCapacity(this.candidateVertexOffset + VERTICES_PER_SURFEL * FLOATS_PER_VERTEX)
          this.writeOrientedQuad(
            this.candidateVertexData,
            this.samplePoint,
            this.sampleNormal,
            LIVE_SURFACE_CONFIG.candidateFootprintRadiusMeters,
            COVERAGE_VISUAL_COLORS.observed,
            COVERAGE_VISUAL_OPACITY.candidate,
            this.candidateVertexOffset,
          )
          this.candidateVertexOffset += VERTICES_PER_SURFEL * FLOATS_PER_VERTEX
        }
      }

      let surfel = match.surfel
      if (!surfel) {
        if (this.activeSurfelCount >= LIVE_SURFACE_CONFIG.maxSurfels) {
          this.diagnostics.capacityReached = true
          continue
        }

        surfel = this.createSurfel(
          this.samplePoint,
          hasNormal ? this.sampleNormal : null,
          timestamp,
        )
        if (!surfel) {
          this.diagnostics.capacityReached = true
          continue
        }
        newSurfelCount += 1
      } else {
        this.fuseSurfel(surfel, this.samplePoint, hasNormal ? this.sampleNormal : null, timestamp)
        fusedSurfelCount += 1
      }

      if (surfel.lastTouchedUpdate !== this.updateSequence) {
        surfel.lastTouchedUpdate = this.updateSequence
        this.touchedSurfelIds.push(surfel.id)
      }
    }

    for (const surfelId of this.touchedSurfelIds) {
      const surfel = this.surfels[surfelId]
      if (!surfel || !surfel.active) {
        continue
      }

      const coverage = coverageService.getCoverageVisualConfidenceAtPoint(
        surfel.position,
        surfel.normal,
      )
      // Preserve the last measured visual confidence across a transient lookup
      // miss. A new surfel starts at zero and therefore remains blue.
      if (coverage.kind !== 'miss' || surfel.geometryObservationCount === 1) {
        // Direct captured evidence is authoritative. Neighborhood support is
        // allowed to soften the frontier, but it must never re-blue a
        // captured physical surface.
        surfel.visualConfidence = coverage.directState === 'captured'
          ? COVERAGE_VISUAL_CONFIDENCE.captured
          : coverage.confidence
      }
    }
    this.touchedSurfelIds.length = 0

    this.diagnostics = {
      ...this.diagnostics,
      incomingMeasuredPointCount,
      surfelCount: this.activeSurfelCount,
      spatialBucketCount: this.buckets.size,
      newSurfelCount,
      fusedSurfelCount,
      fusionRate: incomingMeasuredPointCount > 0
        ? fusedSurfelCount / incomingMeasuredPointCount
        : null,
      fusionRejectCount,
      distanceRejectedCount,
      pointToPlaneRejectedCount,
      normalRejectedCount,
      averageCandidatesPerPoint: incomingMeasuredPointCount > 0
        ? candidateCount / incomingMeasuredPointCount
        : 0,
      matchedCurrentPointCount,
      unmatchedCandidateSampleCount,
      candidateVisualSurfelCount: this.candidateVertexOffset /
        (VERTICES_PER_SURFEL * FLOATS_PER_VERTEX),
      candidateSuppressedByCapturedMatchCount,
      candidateSuppressedByIncompleteMatchCount,
      updateCount: this.diagnostics.updateCount + 1,
      processingDurationMs: Math.max(
        0,
        getPerformanceTimestamp() - processingStartedAt,
      ),
    }

    if (this.firstUpdateAt === null) {
      this.firstUpdateAt = timestamp
    }
    this.diagnostics.updateRateHz = this.diagnostics.updateCount /
      Math.max(1, (timestamp - this.firstUpdateAt) / 1000)

    return {
      persistentSurfaceMesh: this.buildMesh(debugVisible),
      candidateSurfaceMesh: this.buildCandidateMesh(),
    }
  }

  public getDiagnostics(): PersistentLiveSurfaceDebug {
    return { ...this.diagnostics }
  }

  /**
   * Copies confirmed measured geometry for FinalizedSpatialScan. The returned
   * values contain no service, spatial-index, or GPU references and are
   * independently safe to retain after active-session cleanup.
   */
  public getFinalizationSurfels(
    coverageService: SpatialCoverageService,
  ): readonly FinalizedSurfaceSurfel[] {
    const finalized: FinalizedSurfaceSurfel[] = []
    for (const surfel of this.surfels) {
      if (
        !surfel.active ||
        !surfel.normal ||
        surfel.geometryObservationCount < LIVE_SURFACE_CONFIG.minimumFinalizationObservationCount
      ) {
        continue
      }

      const coverage = coverageService.getCoverageVisualConfidenceAtPoint(
        surfel.position,
        surfel.normal,
      )
      const coverageState = coverage.directState ?? stateForConfidence(surfel.visualConfidence)
      const geometryConfidence = Math.min(1, surfel.geometryObservationCount / 3)
      finalized.push(Object.freeze({
        position: Object.freeze({ ...surfel.position }),
        normal: Object.freeze({ ...surfel.normal }),
        observationWeight: surfel.observationWeight,
        geometryObservationCount: surfel.geometryObservationCount,
        geometryConfidence,
        coverageState,
      }))
    }

    return Object.freeze(finalized)
  }

  public rebuildForDebugVisibility(visible: boolean): DenseCoverageMesh {
    return this.buildMesh(visible)
  }

  public reset(): void {
    this.surfels.length = 0
    this.freeSurfelIds.length = 0
    this.buckets.clear()
    this.touchedSurfelIds.length = 0
    this.activeSurfelCount = 0
    this.vertexData = new Float32Array(0)
    this.candidateVertexData = new Float32Array(0)
    this.candidateVertexOffset = 0
    this.normalScratchArrays()
    this.updateSequence = 0
    this.meshRevision = 0
    this.candidateMeshRevision = 0
    this.firstUpdateAt = null
    this.cleanupCursor = 0
    this.diagnostics = this.createInitialDiagnostics()
  }

  public dispose(): void {
    this.reset()
  }

  private readonly touchedSurfelIds: number[] = []

  private sampleNormals = new Float32Array(0)

  private normalValidity = new Uint8Array(0)

  private lastRejectedCandidates = 0

  private lastDistanceRejectedCandidates = 0

  private lastPointToPlaneRejectedCandidates = 0

  private lastNormalRejectedCandidates = 0

  private createInitialDiagnostics(): PersistentLiveSurfaceDebug {
    return {
      incomingMeasuredPointCount: 0,
      surfelCount: 0,
      surfelCapacity: LIVE_SURFACE_CONFIG.maxSurfels,
      spatialBucketCount: 0,
      newSurfelCount: 0,
      fusedSurfelCount: 0,
      fusionRate: null,
      fusionRejectCount: 0,
      distanceRejectedCount: 0,
      pointToPlaneRejectedCount: 0,
      normalRejectedCount: 0,
      averageCandidatesPerPoint: 0,
      weakSurfelCount: 0,
      confirmedSurfelCount: 0,
      stableSurfelCount: 0,
      removedSurfelCount: 0,
      candidateCheckCount: 0,
      renderedSurfelCount: 0,
      matchedCurrentPointCount: 0,
      unmatchedCandidateSampleCount: 0,
      candidateVisualSurfelCount: 0,
      candidateSuppressedByCapturedMatchCount: 0,
      candidateSuppressedByIncompleteMatchCount: 0,
      capturedPersistentSurfelCount: 0,
      partialPersistentSurfelCount: 0,
      observedPersistentSurfelCount: 0,
      unknownPersistentSurfelCount: 0,
      updateCount: 0,
      updateRateHz: 0,
      processingDurationMs: 0,
      footprintRadiusMeters: LIVE_SURFACE_CONFIG.footprintRadiusMeters,
      maxFusionDistanceMeters: LIVE_SURFACE_CONFIG.maxFusionDistanceMeters,
      maxPointToPlaneMeters: LIVE_SURFACE_CONFIG.maxPointToPlaneMeters,
      minNormalDot: LIVE_SURFACE_CONFIG.minNormalDot,
      capacityReached: false,
    }
  }

  private ensureNormalCapacity(sampleCount: number): void {
    if (this.normalValidity.length >= sampleCount) {
      this.normalValidity.fill(0, 0, sampleCount)
      return
    }

    this.sampleNormals = new Float32Array(sampleCount * 3)
    this.normalValidity = new Uint8Array(sampleCount)
  }

  private normalScratchArrays(): void {
    this.sampleNormals = new Float32Array(0)
    this.normalValidity = new Uint8Array(0)
  }

  private estimateNormals(
    frame: DenseSpatialPointFrame,
    cameraPosition: ViewerPosition | null,
  ): void {
    const { columns, rows } = frame
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column
        if (frame.valid[index] !== 1 ||
          column === 0 || column === columns - 1 || row === 0 || row === rows - 1) {
          continue
        }

        const leftIndex = index - 1
        const rightIndex = index + 1
        const upIndex = index - columns
        const downIndex = index + columns
        if (
          frame.valid[leftIndex] !== 1 ||
          frame.valid[rightIndex] !== 1 ||
          frame.valid[upIndex] !== 1 ||
          frame.valid[downIndex] !== 1
        ) {
          continue
        }

        const centerDepth = frame.distancesMeters[index]
        const hasDepthDiscontinuity =
          Math.abs(frame.distancesMeters[leftIndex] - centerDepth) >
            LIVE_SURFACE_CONFIG.maxNormalNeighborDepthDifferenceMeters ||
          Math.abs(frame.distancesMeters[rightIndex] - centerDepth) >
            LIVE_SURFACE_CONFIG.maxNormalNeighborDepthDifferenceMeters ||
          Math.abs(frame.distancesMeters[upIndex] - centerDepth) >
            LIVE_SURFACE_CONFIG.maxNormalNeighborDepthDifferenceMeters ||
          Math.abs(frame.distancesMeters[downIndex] - centerDepth) >
            LIVE_SURFACE_CONFIG.maxNormalNeighborDepthDifferenceMeters
        if (hasDepthDiscontinuity) {
          continue
        }

        const centerOffset = index * 3
        const leftOffset = leftIndex * 3
        const rightOffset = rightIndex * 3
        const upOffset = upIndex * 3
        const downOffset = downIndex * 3
        this.horizontal.x = frame.points[rightOffset] - frame.points[leftOffset]
        this.horizontal.y = frame.points[rightOffset + 1] - frame.points[leftOffset + 1]
        this.horizontal.z = frame.points[rightOffset + 2] - frame.points[leftOffset + 2]
        this.vertical.x = frame.points[downOffset] - frame.points[upOffset]
        this.vertical.y = frame.points[downOffset + 1] - frame.points[upOffset + 1]
        this.vertical.z = frame.points[downOffset + 2] - frame.points[upOffset + 2]

        if (
          length(this.horizontal) > LIVE_SURFACE_CONFIG.maxNormalNeighborSpanMeters ||
          length(this.vertical) > LIVE_SURFACE_CONFIG.maxNormalNeighborSpanMeters
        ) {
          continue
        }

        this.normalScratch.x =
          this.horizontal.y * this.vertical.z - this.horizontal.z * this.vertical.y
        this.normalScratch.y =
          this.horizontal.z * this.vertical.x - this.horizontal.x * this.vertical.z
        this.normalScratch.z =
          this.horizontal.x * this.vertical.y - this.horizontal.y * this.vertical.x
        if (!normalize(this.normalScratch, this.normalScratch)) {
          continue
        }

        if (cameraPosition) {
          this.cameraOffset.x = cameraPosition.x - frame.points[centerOffset]
          this.cameraOffset.y = cameraPosition.y - frame.points[centerOffset + 1]
          this.cameraOffset.z = cameraPosition.z - frame.points[centerOffset + 2]
          if (dot(this.normalScratch, this.cameraOffset) < 0) {
            this.normalScratch.x *= -1
            this.normalScratch.y *= -1
            this.normalScratch.z *= -1
          }
        }

        this.sampleNormals[centerOffset] = this.normalScratch.x
        this.sampleNormals[centerOffset + 1] = this.normalScratch.y
        this.sampleNormals[centerOffset + 2] = this.normalScratch.z
        this.normalValidity[index] = 1
      }
    }
  }

  private findCompatibleSurfel(
    point: SpatialPoint,
    normal: SpatialPoint | null,
  ): CompatibleSurfelResult {
    const x = getBucketCoordinate(point.x)
    const y = getBucketCoordinate(point.y)
    const z = getBucketCoordinate(point.z)
    const maxDistanceSquared = LIVE_SURFACE_CONFIG.maxFusionDistanceMeters ** 2
    const maxPlaneDistance = LIVE_SURFACE_CONFIG.maxPointToPlaneMeters
    let bestSurfel: LiveSurfaceSurfel | null = null
    let bestScore = Number.POSITIVE_INFINITY
    let candidateCount = 0
    let compatibleCandidateCount = 0
    this.lastRejectedCandidates = 0
    this.lastDistanceRejectedCandidates = 0
    this.lastPointToPlaneRejectedCandidates = 0
    this.lastNormalRejectedCandidates = 0

    outer:
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
          const bucket = this.buckets.get(getBucketKey(x + xOffset, y + yOffset, z + zOffset))
          if (!bucket) {
            continue
          }

          for (const surfelId of bucket) {
            if (candidateCount >= LIVE_SURFACE_CONFIG.maxCandidatesPerSample) {
              break outer
            }
            const surfel = this.surfels[surfelId]
            if (!surfel || !surfel.active) {
              continue
            }

            candidateCount += 1
            this.diagnostics.candidateCheckCount += 1
            const deltaX = point.x - surfel.position.x
            const deltaY = point.y - surfel.position.y
            const deltaZ = point.z - surfel.position.z
            const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ
            if (distanceSquared > maxDistanceSquared) {
              this.lastRejectedCandidates += 1
              this.lastDistanceRejectedCandidates += 1
              continue
            }

            let pointToPlaneDistance = 0
            if (surfel.normal) {
              pointToPlaneDistance = Math.abs(
                deltaX * surfel.normal.x +
                deltaY * surfel.normal.y +
                deltaZ * surfel.normal.z,
              )
              if (pointToPlaneDistance > maxPlaneDistance) {
                this.lastRejectedCandidates += 1
                this.lastPointToPlaneRejectedCandidates += 1
                continue
              }
            }

            let normalWeight = 1
            if (normal && surfel.normal) {
              normalWeight = Math.abs(dot(normal, surfel.normal))
              if (normalWeight < LIVE_SURFACE_CONFIG.minNormalDot) {
                this.lastRejectedCandidates += 1
                this.lastNormalRejectedCandidates += 1
                continue
              }
            } else if (normal !== null || surfel.normal !== null) {
              // Do not fuse a reliable oriented surface with a measurement
              // whose local geometry is unknown.
              this.lastRejectedCandidates += 1
              this.lastNormalRejectedCandidates += 1
              continue
            }

            compatibleCandidateCount += 1
            const score = distanceSquared + pointToPlaneDistance ** 2 - normalWeight * 1e-4
            if (score < bestScore) {
              bestScore = score
              bestSurfel = surfel
            }
          }
        }
      }
    }

    // A candidate set can be compatible but still produce no match only when
    // the input was invalid; the explicit count keeps diagnostics honest.
    if (compatibleCandidateCount === 0 && candidateCount > 0) {
      this.lastRejectedCandidates = Math.max(1, this.lastRejectedCandidates)
    }
    return { surfel: bestSurfel, candidateCount }
  }

  private createSurfel(
    point: SpatialPoint,
    normal: SpatialPoint | null,
    timestamp: number,
  ): LiveSurfaceSurfel | null {
    const recycledId = this.freeSurfelIds.pop()
    const id = recycledId === undefined ? this.surfels.length : recycledId
    const bucketKey = getPointBucketKey(point)
    const surfel: LiveSurfaceSurfel = {
      id,
      bucketKey,
      position: { ...point },
      normal: normal ? { ...normal } : null,
      radius: LIVE_SURFACE_CONFIG.footprintRadiusMeters,
      observationWeight: 1,
      geometryObservationCount: 1,
      lastFusionUpdate: this.updateSequence,
      lastMeasuredAt: timestamp,
      geometryState: 'new',
      visualConfidence: 0,
      active: true,
      lastTouchedUpdate: 0,
    }
    if (recycledId === undefined) {
      this.surfels.push(surfel)
    } else {
      this.surfels[id] = surfel
    }
    this.addToBucket(bucketKey, id)
    this.activeSurfelCount += 1
    return surfel
  }

  private fuseSurfel(
    surfel: LiveSurfaceSurfel,
    point: SpatialPoint,
    normal: SpatialPoint | null,
    timestamp: number,
  ): void {
    const priorWeight = Math.min(
      LIVE_SURFACE_CONFIG.maxObservationWeight,
      Math.max(1, surfel.observationWeight),
    )
    const blend = 1 / (priorWeight + 1)
    surfel.position.x += (point.x - surfel.position.x) * blend
    surfel.position.y += (point.y - surfel.position.y) * blend
    surfel.position.z += (point.z - surfel.position.z) * blend
    surfel.observationWeight = Math.min(
      LIVE_SURFACE_CONFIG.maxObservationWeight,
      surfel.observationWeight + 1,
    )
    if (surfel.lastFusionUpdate !== this.updateSequence) {
      surfel.lastFusionUpdate = this.updateSequence
      surfel.geometryObservationCount += 1
    }
    surfel.geometryState = surfel.geometryObservationCount >= 3
      ? 'stable'
      : surfel.geometryObservationCount >= 2
        ? 'confirmed'
        : 'new'
    surfel.lastMeasuredAt = timestamp

    if (!normal) {
      return
    }
    if (!surfel.normal) {
      surfel.normal = { ...normal }
      return
    }

    this.incomingNormal.x = normal.x
    this.incomingNormal.y = normal.y
    this.incomingNormal.z = normal.z
    if (dot(surfel.normal, this.incomingNormal) < 0) {
      this.incomingNormal.x *= -1
      this.incomingNormal.y *= -1
      this.incomingNormal.z *= -1
    }
    this.incomingNormal.x = surfel.normal.x * priorWeight + this.incomingNormal.x
    this.incomingNormal.y = surfel.normal.y * priorWeight + this.incomingNormal.y
    this.incomingNormal.z = surfel.normal.z * priorWeight + this.incomingNormal.z
    if (normalize(this.incomingNormal, this.incomingNormal)) {
      surfel.normal.x = this.incomingNormal.x
      surfel.normal.y = this.incomingNormal.y
      surfel.normal.z = this.incomingNormal.z
    }
  }

  private removeWeakSurfels(timestamp: number): void {
    if (this.surfels.length === 0) {
      return
    }

    let removed = 0
    const maxChecks = Math.min(
      this.surfels.length,
      LIVE_SURFACE_CONFIG.maxWeakSurfelsRemovedPerUpdate * 4,
    )
    for (let checked = 0; checked < maxChecks; checked += 1) {
      if (this.cleanupCursor >= this.surfels.length) {
        this.cleanupCursor = 0
      }
      const surfel = this.surfels[this.cleanupCursor]
      this.cleanupCursor += 1
      if (
        surfel &&
        surfel.active &&
        surfel.geometryObservationCount === 1 &&
        timestamp - surfel.lastMeasuredAt > LIVE_SURFACE_CONFIG.weakSurfelLifetimeMs
      ) {
        this.removeSurfel(surfel)
        removed += 1
        if (removed >= LIVE_SURFACE_CONFIG.maxWeakSurfelsRemovedPerUpdate) {
          break
        }
      }
    }
    this.diagnostics.removedSurfelCount += removed
  }

  private removeSurfel(surfel: LiveSurfaceSurfel): void {
    surfel.active = false
    this.freeSurfelIds.push(surfel.id)
    this.activeSurfelCount = Math.max(0, this.activeSurfelCount - 1)
    const bucket = this.buckets.get(surfel.bucketKey)
    if (!bucket) {
      return
    }
    const index = bucket.indexOf(surfel.id)
    if (index >= 0) {
      bucket.splice(index, 1)
    }
    if (bucket.length === 0) {
      this.buckets.delete(surfel.bucketKey)
    }
  }

  private addToBucket(bucketKey: string, surfelId: number): void {
    const bucket = this.buckets.get(bucketKey)
    if (bucket) {
      bucket.push(surfelId)
    } else {
      this.buckets.set(bucketKey, [surfelId])
    }
  }

  private buildMesh(debugVisible: boolean): DenseCoverageMesh {
    let requiredFloats = this.activeSurfelCount * VERTICES_PER_SURFEL * FLOATS_PER_VERTEX
    if (this.vertexData.length < requiredFloats) {
      this.vertexData = new Float32Array(Math.max(requiredFloats, this.vertexData.length * 1.5))
    }

    let offset = 0
    let renderedSurfelCount = 0
    let capturedPersistentSurfelCount = 0
    let partialPersistentSurfelCount = 0
    let observedPersistentSurfelCount = 0
    let unknownPersistentSurfelCount = 0
    const debugOpacity = 0.16
    for (const surfel of this.surfels) {
      if (!surfel.active) {
        continue
      }

      if (surfel.visualConfidence <= 0) {
        unknownPersistentSurfelCount += 1
      } else if (surfel.visualConfidence >= COVERAGE_VISUAL_CONFIDENCE.captured) {
        capturedPersistentSurfelCount += 1
      } else if (surfel.visualConfidence >= COVERAGE_VISUAL_CONFIDENCE.partial) {
        partialPersistentSurfelCount += 1
      } else {
        observedPersistentSurfelCount += 1
      }

      if (!surfel.normal) {
        continue
      }

      const state = stateForConfidence(surfel.visualConfidence)
      const opacity = debugVisible
        ? Math.max(debugOpacity, maskOpacityForConfidence(surfel.visualConfidence))
        : maskOpacityForConfidence(surfel.visualConfidence)
      if (opacity <= Number.EPSILON && !debugVisible) {
        continue
      }

      const color = debugVisible && state === 'captured'
        ? COVERAGE_VISUAL_COLORS.captured
        : COVERAGE_VISUAL_COLORS[state === 'captured' ? 'partial' : state]
      this.writeSurfelQuad(surfel, color, opacity, offset)
      offset += VERTICES_PER_SURFEL * FLOATS_PER_VERTEX
      renderedSurfelCount += 1
    }

    this.diagnostics.renderedSurfelCount = renderedSurfelCount
    this.diagnostics.capturedPersistentSurfelCount = capturedPersistentSurfelCount
    this.diagnostics.partialPersistentSurfelCount = partialPersistentSurfelCount
    this.diagnostics.observedPersistentSurfelCount = observedPersistentSurfelCount
    this.diagnostics.unknownPersistentSurfelCount = unknownPersistentSurfelCount
    this.diagnostics.weakSurfelCount = 0
    this.diagnostics.confirmedSurfelCount = 0
    this.diagnostics.stableSurfelCount = 0
    for (const surfel of this.surfels) {
      if (!surfel || !surfel.active) {
        continue
      }
      if (surfel.geometryState === 'new') {
        this.diagnostics.weakSurfelCount += 1
      } else if (surfel.geometryState === 'confirmed') {
        this.diagnostics.confirmedSurfelCount += 1
      } else {
        this.diagnostics.stableSurfelCount += 1
      }
    }

    this.meshRevision += 1
    requiredFloats = offset
    return {
      revision: this.meshRevision,
      vertexData: this.vertexData.subarray(0, requiredFloats),
      vertexCount: requiredFloats / FLOATS_PER_VERTEX,
    }
  }

  private buildCandidateMesh(): DenseCoverageMesh {
    this.candidateMeshRevision += 1
    return {
      revision: this.candidateMeshRevision,
      vertexData: this.candidateVertexData.subarray(0, this.candidateVertexOffset),
      vertexCount: this.candidateVertexOffset / FLOATS_PER_VERTEX,
    }
  }

  private ensureCandidateVertexCapacity(requiredFloats: number): void {
    if (this.candidateVertexData.length >= requiredFloats) {
      return
    }

    this.candidateVertexData = new Float32Array(
      Math.max(requiredFloats, Math.ceil(this.candidateVertexData.length * 1.5)),
    )
  }

  private writeSurfelQuad(
    surfel: LiveSurfaceSurfel,
    color: readonly [number, number, number],
    opacity: number,
    offset: number,
  ): void {
    const normal = surfel.normal as SpatialPoint
    this.writeOrientedQuad(
      this.vertexData,
      surfel.position,
      normal,
      surfel.radius,
      color,
      opacity,
      offset,
    )
  }

  private writeOrientedQuad(
    data: Float32Array,
    position: SpatialPoint,
    normal: SpatialPoint,
    radius: number,
    color: readonly [number, number, number],
    opacity: number,
    offset: number,
  ): void {
    // Cross a stable world axis with the normal to create an oriented tangent.
    // Switching axes near vertical keeps the basis well-conditioned.
    const referenceX = Math.abs(normal.y) < 0.9 ? 0 : 1
    const referenceY = Math.abs(normal.y) < 0.9 ? 1 : 0
    const referenceZ = 0
    this.tangent.x = referenceY * normal.z - referenceZ * normal.y
    this.tangent.y = referenceZ * normal.x - referenceX * normal.z
    this.tangent.z = referenceX * normal.y - referenceY * normal.x
    if (!normalize(this.tangent, this.tangent)) {
      return
    }

    this.bitangent.x = normal.y * this.tangent.z - normal.z * this.tangent.y
    this.bitangent.y = normal.z * this.tangent.x - normal.x * this.tangent.z
    this.bitangent.z = normal.x * this.tangent.y - normal.y * this.tangent.x
    if (!normalize(this.bitangent, this.bitangent)) {
      return
    }

    const offsetDistance = LIVE_SURFACE_CONFIG.surfaceOffsetMeters
    const centerX = position.x + normal.x * offsetDistance
    const centerY = position.y + normal.y * offsetDistance
    const centerZ = position.z + normal.z * offsetDistance
    this.cornerA.x = centerX - this.tangent.x * radius - this.bitangent.x * radius
    this.cornerA.y = centerY - this.tangent.y * radius - this.bitangent.y * radius
    this.cornerA.z = centerZ - this.tangent.z * radius - this.bitangent.z * radius
    this.cornerB.x = centerX + this.tangent.x * radius - this.bitangent.x * radius
    this.cornerB.y = centerY + this.tangent.y * radius - this.bitangent.y * radius
    this.cornerB.z = centerZ + this.tangent.z * radius - this.bitangent.z * radius
    this.cornerC.x = centerX - this.tangent.x * radius + this.bitangent.x * radius
    this.cornerC.y = centerY - this.tangent.y * radius + this.bitangent.y * radius
    this.cornerC.z = centerZ - this.tangent.z * radius + this.bitangent.z * radius
    this.cornerD.x = centerX + this.tangent.x * radius + this.bitangent.x * radius
    this.cornerD.y = centerY + this.tangent.y * radius + this.bitangent.y * radius
    this.cornerD.z = centerZ + this.tangent.z * radius + this.bitangent.z * radius

    writeVertex(data, offset, this.cornerA, color, opacity)
    writeVertex(data, offset + FLOATS_PER_VERTEX, this.cornerB, color, opacity)
    writeVertex(data, offset + FLOATS_PER_VERTEX * 2, this.cornerC, color, opacity)
    writeVertex(data, offset + FLOATS_PER_VERTEX * 3, this.cornerB, color, opacity)
    writeVertex(data, offset + FLOATS_PER_VERTEX * 4, this.cornerD, color, opacity)
    writeVertex(data, offset + FLOATS_PER_VERTEX * 5, this.cornerC, color, opacity)
  }
}

import type {
  FinalizedRealitySurfel,
  RealityColorStatistics,
  SpatialBounds,
  SpatialPoint,
} from '../types'
import type {
  CanonicalRealityFusionResult,
} from './canonicalRealityFusionService'
import {
  RETAINED_REALITY_CONFIG,
  type RetainedRealityMeasurementFrame,
  type RetainedRealityMeasurementSnapshot,
} from './retainedRealityMeasurementService'

/**
 * M8.8 intentionally uses a measured-cell field instead of a TSDF/occupancy
 * volume. Every output position is one of the source points in the retained
 * snapshot. The 22 mm plane gate is kept as the layer-safety boundary.
 */
export const M88_LAYERED_FIELD_CONFIG = Object.freeze({
  cellSizeMeters: .025,
  consolidationCellMeters: RETAINED_REALITY_CONFIG.consolidationCellMeters,
  maximumLayersPerCell: 4,
  maximumFieldLayers: 240000,
  maximumMedoidCandidates: 64,
  layerPlaneSafetyMeters: .022,
  layerTangentDistanceMeters: .046,
  minimumNormalDot: .90,
  coherenceDistanceMeters: .065,
  coherencePlaneResidualMeters: .018,
  minimumCoherentNeighbors: 2,
  maximumReportedComponents: 12,
})

/** Orientation is reported only when the measured component normal supports it. */
export type LayeredComponentOrientation = 'main-wall' | 'side-wall' | 'ceiling' | `generic-${number}`

export interface LayeredSurfaceComponentMetric {
  readonly id: string
  readonly orientation: LayeredComponentOrientation
  readonly measuredLayers: number
  readonly observedCells: number
  readonly baselineCells: number
  readonly candidateCells: number
  readonly baselineCoveragePercentage: number
  readonly candidateCoveragePercentage: number
  readonly candidateImprovementPercentagePoints: number
  readonly tangentBasis: Readonly<{ normal: SpatialPoint; u: SpatialPoint; v: SpatialPoint }>
}

export interface LayeredMeasuredSurfaceHoleClasses {
  /** Projected cells inside coherent measured component bounds with no source observation. */
  readonly A_unobserved: number
  /** Observed projected cells absent from the baseline representation. */
  readonly B_observedBaselineMissing: number
  /** B cells represented by the candidate. */
  readonly C_candidateRepresented: number
  /** B cells still rejected by the candidate. */
  readonly D_candidateStillRejected: number
  /** Observed cells with more than one compatible measured depth layer. */
  readonly E_conflictingMultilayer: number
}

export interface LayeredMeasuredSurfaceFieldDiagnostics {
  readonly inputFrames: number
  readonly inputRetainedMeasurements: number
  readonly candidateConsolidatedMeasurements: number
  readonly sameFrameConsolidated: number
  readonly uniqueObservedWorldCells: number
  readonly baselineConsolidatedMeasurements: number
  readonly baselineRepresentedWorldCells: number
  readonly candidateRepresentedWorldCells: number
  readonly baselineSurvivalPercentage: number
  readonly candidateSurvivalPercentage: number
  readonly measuredCellAreaSquareMeters: number
  readonly observedMeasuredAreaSquareMeters: number
  readonly baselineRepresentedMeasuredAreaSquareMeters: number
  readonly candidateRepresentedMeasuredAreaSquareMeters: number
  readonly baselineLostMeasuredAreaSquareMeters: number
  readonly candidateLostMeasuredAreaSquareMeters: number
  readonly unobservedMeasuredAreaSquareMeters: number
  readonly candidateUnownedOrInventedCount: number
  readonly candidateObservedCellMismatchCount: number
  readonly baselineRepresentedOutsideObservedWorldCells: number
  readonly candidateRepresentedOutsideObservedWorldCells: number
  readonly candidateRejectedWorldCells: number
  readonly candidateRejectedLayerCapacityCells: number
  /** Local four-layer cap: measurements rejected after a cell already has four layers. */
  readonly candidateLocalLayerCapacityRejectedMeasurements: number
  /** Global field cap: measurements rejected after the field reaches 240,000 layers. */
  readonly candidateGlobalFieldCapacityRejectedMeasurements: number
  /** At least one cell reached the local four-layer limit, whether or not a fifth sample was rejected. */
  readonly candidateLocalLayerCapacitySaturated: boolean
  /** The global 240,000-layer field limit was reached or rejected a measurement. */
  readonly candidateGlobalFieldCapacityReached: boolean
  readonly candidateLocalLayerCapacitySaturatedCells: number
  readonly candidateCapacityRejectedMeasurements: number
  readonly candidateCapacityReached: boolean
  readonly candidateCellLookups: number
  readonly candidateLayerCandidateVisits: number
  readonly coherenceCellLookups: number
  readonly coherenceLayerCandidateVisits: number
  readonly coherenceAdjacencyRelationChecks: number
  readonly coherenceAdjacencyUndirectedEdgeCount: number
  /** Actual numeric-hash neighbor-cell lookups; same-cell pairs are direct. */
  readonly coherenceNumericIndexLookupCount: number
  /** Number of hash buckets containing more than one exact cell coordinate. */
  readonly coherenceNumericIndexCollisionBucketCount: number
  /** Exact-coordinate comparisons that crossed a hash collision bucket. */
  readonly coherenceNumericIndexCollisionProbeCount: number
  readonly maximumFieldLayers: number
  readonly promotedLayerCount: number
  readonly observedLayerCount: number
  readonly maximumObservedLayersPerCell: number
  readonly maximumCandidateLayersPerCell: number
  readonly candidateLayerSafetyViolations: number
  readonly crossFrameSupportedLayerCount: number
  readonly coherentSupportPromotedLayerCount: number
  readonly frameLocalContinuityLayerCount: number
  readonly holeClasses: LayeredMeasuredSurfaceHoleClasses
  readonly coherentSurfaceComponents: readonly LayeredSurfaceComponentMetric[]
  readonly inputSnapshotSignature: string
  readonly workerTimeMs: number
  readonly numericMemoryBytes: number
  readonly inputMemoryBytes: number
  readonly candidateRepresentationMemoryBytes: number
  readonly candidateWorkingMemoryBytes: number
  readonly candidateOutputMemoryBytes: number
  readonly peakMemoryBytesEstimate: number
  readonly peakMemoryBytesLowerBound: number
  readonly consolidationCellIndexLookupCount: number
  readonly consolidationCellIndexCollisionBucketCount: number
  readonly consolidationCellIndexCollisionProbeCount: number
  readonly consolidationSourceGridNeighborLookups: number
  readonly consolidationSourceGridNeighborHits: number
  /** Exact work the former full medoid scan would have performed. */
  readonly medoidCandidateVisitsBeforeEquivalent: number
  readonly medoidDistanceVisitsBeforeEquivalent: number
  /** Work performed by the incremental medoid score maintenance. */
  readonly medoidCandidateVisits: number
  readonly medoidDistanceVisits: number
  readonly workerStageTimingsMs: Readonly<{
    input: number
    perFrameConsolidation: number
    fieldIntegration: number
    coherenceAndPromotion: number
    coherenceAdjacencyIndex: number
    coherenceConnectedComponents: number
    coherenceSupportPromotion: number
    componentMetrics: number
    finalPacking: number
  }>
}

export interface LayeredMeasuredSurfaceFieldResult {
  readonly surfels: readonly FinalizedRealitySurfel[]
  readonly diagnostics: LayeredMeasuredSurfaceFieldDiagnostics
  readonly ownership: readonly LayeredMeasuredSurfaceOwnership[]
  readonly bounds: SpatialBounds | null
  readonly colorStatistics: RealityColorStatistics
}

export interface LayeredMeasuredSurfaceOwnership {
  readonly surfelId: number
  readonly representativeFrameSequence: number
  readonly representativeSourceIndex: number
  readonly worldCellKey: string
  readonly layerId: string
  readonly position: SpatialPoint
}

export interface RetainedSnapshotSignaturePair {
  readonly inputSnapshotSignature: string
  readonly baselineInputSnapshotSignature: string
  readonly candidateInputSnapshotSignature: string
  readonly identicalInput: boolean
}

interface MeasuredColor {
  readonly r: number
  readonly g: number
  readonly b: number
}

interface MeasuredObservation {
  readonly sourceIndex: number
  readonly frameSequence: number
  readonly timestamp: number
  readonly trackingQuality: number
  readonly position: SpatialPoint
  readonly normal: SpatialPoint
  readonly color: MeasuredColor | null
  readonly localCellId: number
  readonly localNeighborCellIds?: readonly number[]
}

interface FrameConsolidatedObservation extends MeasuredObservation {
  readonly localNeighborCellIds: readonly number[]
}

interface MedoidWork {
  candidateVisitsBeforeEquivalent: number
  distanceVisitsBeforeEquivalent: number
  candidateVisits: number
  distanceVisits: number
}

interface LayerAccumulator {
  readonly index: number
  readonly cellId: number
  readonly cellX: number
  readonly cellY: number
  readonly cellZ: number
  readonly samples: MeasuredObservation[]
  readonly medoidScores: number[]
  supportFrameMask: FrameMask
  supportViewpointMask: ViewpointMask
  representative: MeasuredObservation
  color: MeasuredColor | null
  fallbackColor: MeasuredColor | null
  observationCount: number
  firstTimestamp: number
  lastTimestamp: number
  trackingQualitySum: number
  colorObservationCount: number
  coherentNeighborCount: number
  crossFrameNeighborCount: number
  sourceLocalContinuity: number
  positionMean: SpatialPoint
  positionM2: SpatialPoint
  depthReferencePosition: SpatialPoint
  depthReferenceNormal: SpatialPoint
  depthMean: number
  depthM2: number
  normalDeviationMean: number
  normalDeviationM2: number
  promoted: boolean
  rejectedByCapacity: boolean
}

interface SurfaceComponent {
  readonly id: number
  readonly layers: LayerAccumulator[]
  readonly cellIds: Set<number>
  normal: SpatialPoint
  origin: SpatialPoint
  u: SpatialPoint
  v: SpatialPoint
}

interface LayerAdjacencyIndex {
  readonly neighbors: readonly Uint32Array[]
  readonly coherenceCellLookups: number
  readonly coherenceLayerCandidateVisits: number
  readonly coherenceAdjacencyRelationChecks: number
  readonly coherenceAdjacencyUndirectedEdgeCount: number
  readonly coherenceNumericIndexLookupCount: number
  readonly coherenceNumericIndexCollisionBucketCount: number
  readonly coherenceNumericIndexCollisionProbeCount: number
}

interface FrameMask {
  low: number
  middle: number
  high: number
}

interface ViewpointMask {
  low: number
  middle: number
  high: number
}

interface ConsolidationWork {
  cellIndexLookupCount: number
  cellIndexCollisionBucketCount: number
  cellIndexCollisionProbeCount: number
  sourceGridNeighborLookups: number
  sourceGridNeighborHits: number
}

interface FrameCellRecord {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly samples: MeasuredObservation[]
}

interface WorldCellRecord {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly z: number
  layers?: LayerAccumulator[]
}

interface WorldCellIndex {
  readonly buckets: Map<number, WorldCellRecord | WorldCellRecord[]>
  readonly records: WorldCellRecord[]
  collisionBucketCount: number
}

interface SignatureHash {
  first: number
  second: number
}

const NEIGHBOR_OFFSETS: readonly (readonly [number, number, number])[] = [-1, 0, 1]
  .flatMap((x) => [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((z) => [x, y, z] as const)))
const REVERSE_NEIGHBOR_OFFSET_INDEX = NEIGHBOR_OFFSETS.map(([x, y, z]) =>
  NEIGHBOR_OFFSETS.findIndex(([candidateX, candidateY, candidateZ]) => candidateX === -x && candidateY === -y && candidateZ === -z),
)
const CENTER_NEIGHBOR_OFFSET_INDEX = NEIGHBOR_OFFSETS.findIndex(([x, y, z]) => x === 0 && y === 0 && z === 0)
const HALF_NEIGHBOR_OFFSET_INDICES = NEIGHBOR_OFFSETS
  .map((_offset, index) => index)
  .filter((index) => index !== CENTER_NEIGHBOR_OFFSET_INDEX && index < REVERSE_NEIGHBOR_OFFSET_INDEX[index])
// A layer index is bounded by maximumFieldLayers (240,000), so this keeps the
// offset rank and layer index in one sortable integer without allocating edge
// objects on every coherence visit.
const ADJACENCY_LAYER_INDEX_BASE = 1 << 18
const FRAME_MASK_WORD_BITS = 32
const FRAME_MASK_MAX_ORDINAL = FRAME_MASK_WORD_BITS * 3 - 1

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))

function createMask(): FrameMask {
  return { low: 0, middle: 0, high: 0 }
}

function setMaskBit(mask: FrameMask, ordinal: number): void {
  if (ordinal < 0 || ordinal > FRAME_MASK_MAX_ORDINAL) return
  const word = ordinal >>> 5
  const bit = ordinal & 31
  const value = (1 << bit) >>> 0
  if (word === 0) mask.low = (mask.low | value) >>> 0
  else if (word === 1) mask.middle = (mask.middle | value) >>> 0
  else mask.high = (mask.high | value) >>> 0
}

function hasMaskBit(mask: FrameMask, ordinal: number): boolean {
  if (ordinal < 0 || ordinal > FRAME_MASK_MAX_ORDINAL) return false
  const word = ordinal >>> 5
  const bit = ordinal & 31
  const value = (1 << bit) >>> 0
  return word === 0 ? (mask.low & value) !== 0 : word === 1 ? (mask.middle & value) !== 0 : (mask.high & value) !== 0
}

function maskBitCount(mask: FrameMask): number {
  const count = (value: number): number => {
    let bits = value >>> 0, total = 0
    while (bits) {
      bits = (bits & (bits - 1)) >>> 0
      total += 1
    }
    return total
  }
  return count(mask.low) + count(mask.middle) + count(mask.high)
}

function forEachMaskBit(mask: FrameMask, visit: (ordinal: number) => void): void {
  for (const [wordIndex, value] of [mask.low, mask.middle, mask.high].entries()) {
    let bits = value >>> 0
    while (bits) {
      const bit = 31 - Math.clz32(bits)
      visit(wordIndex * FRAME_MASK_WORD_BITS + bit)
      bits = (bits & ~(1 << bit)) >>> 0
    }
  }
}

function supportViewpointKey(frame: RetainedRealityMeasurementFrame): string {
  return `${Math.floor(frame.cameraPosition.x / .25)}:${Math.floor(frame.cameraPosition.y / .25)}:${Math.floor(frame.cameraPosition.z / .25)}:${Math.round(frame.cameraOrientation.x * 8)}:${Math.round(frame.cameraOrientation.y * 8)}:${Math.round(frame.cameraOrientation.z * 8)}:${Math.round(frame.cameraOrientation.w * 8)}`
}

function maximumLayersPerCell(
  worldCells: readonly WorldCellRecord[],
  promotedOnly = false,
): number {
  let maximum = 0
  for (const cell of worldCells) {
    const layers = cell.layers
    if (!layers) continue
    let count = 0
    if (promotedOnly) {
      for (const layer of layers) if (layer.promoted) count += 1
    } else {
      count = layers.length
    }
    maximum = Math.max(maximum, count)
  }
  return maximum
}

const pointKey = (point: SpatialPoint): string => `${Math.floor(point.x / M88_LAYERED_FIELD_CONFIG.cellSizeMeters)}:${Math.floor(point.y / M88_LAYERED_FIELD_CONFIG.cellSizeMeters)}:${Math.floor(point.z / M88_LAYERED_FIELD_CONFIG.cellSizeMeters)}`

function worldCellCoordinates(point: SpatialPoint): [number, number, number] {
  return [
    Math.floor(point.x / M88_LAYERED_FIELD_CONFIG.cellSizeMeters),
    Math.floor(point.y / M88_LAYERED_FIELD_CONFIG.cellSizeMeters),
    Math.floor(point.z / M88_LAYERED_FIELD_CONFIG.cellSizeMeters),
  ]
}

function formatWorldCellKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`
}

function numericCellHash(x: number, y: number, z: number): number {
  let hash = 2166136261
  hash = Math.imul(hash ^ (x | 0), 16777619) >>> 0
  hash = Math.imul(hash ^ (y | 0), 16777619) >>> 0
  hash = Math.imul(hash ^ (z | 0), 16777619) >>> 0
  return hash
}

function createWorldCellIndex(): WorldCellIndex {
  return { buckets: new Map<number, WorldCellRecord | WorldCellRecord[]>(), records: [], collisionBucketCount: 0 }
}

function findWorldCellRecord(index: WorldCellIndex, x: number, y: number, z: number, collisionProbeCounter?: { value: number }): WorldCellRecord | undefined {
  const bucket = index.buckets.get(numericCellHash(x, y, z))
  if (!bucket) return undefined
  if (!Array.isArray(bucket)) {
    return bucket.x === x && bucket.y === y && bucket.z === z ? bucket : undefined
  }
  for (const candidate of bucket) {
    if (candidate.x === x && candidate.y === y && candidate.z === z) return candidate
    if (collisionProbeCounter) collisionProbeCounter.value += 1
  }
  return undefined
}

function getOrCreateWorldCellRecord(index: WorldCellIndex, x: number, y: number, z: number): WorldCellRecord {
  const existing = findWorldCellRecord(index, x, y, z)
  if (existing) return existing
  const hash = numericCellHash(x, y, z)
  const bucket = index.buckets.get(hash)
  const cell: WorldCellRecord = { id: index.records.length, x, y, z }
  if (!bucket) {
    index.buckets.set(hash, cell)
  } else if (Array.isArray(bucket)) {
    bucket.push(cell)
  } else {
    index.buckets.set(hash, [bucket, cell])
    index.collisionBucketCount += 1
  }
  index.records.push(cell)
  return cell
}

function normalize(point: SpatialPoint): SpatialPoint {
  const magnitude = Math.hypot(point.x, point.y, point.z)
  return magnitude > 1e-7
    ? { x: point.x / magnitude, y: point.y / magnitude, z: point.z / magnitude }
    : { x: 0, y: 0, z: 1 }
}

function distanceSquared(left: SpatialPoint, right: SpatialPoint): number {
  const x = left.x - right.x, y = left.y - right.y, z = left.z - right.z
  return x * x + y * y + z * z
}

function dot(left: SpatialPoint, right: SpatialPoint): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function compatible(
  leftPosition: SpatialPoint,
  leftNormal: SpatialPoint,
  rightPosition: SpatialPoint,
  rightNormal: SpatialPoint,
): { normalDot: number; planeResidual: number; tangentDistance: number } {
  const normalizedLeftNormal = normalize(leftNormal)
  const normalizedRightNormal = normalize(rightNormal)
  // Plane/tangent relation is always derived from surface normals. Positions
  // are never used as normals: this keeps geometry decisions valid at the
  // world origin and for surfaces whose position vector is near-tangent.
  const alignedRightNormal = dot(normalizedLeftNormal, normalizedRightNormal) < 0
    ? { x: -normalizedRightNormal.x, y: -normalizedRightNormal.y, z: -normalizedRightNormal.z }
    : normalizedRightNormal
  const averagedNormal = normalize({
    x: normalizedLeftNormal.x + alignedRightNormal.x,
    y: normalizedLeftNormal.y + alignedRightNormal.y,
    z: normalizedLeftNormal.z + alignedRightNormal.z,
  })
  const dx = leftPosition.x - rightPosition.x, dy = leftPosition.y - rightPosition.y, dz = leftPosition.z - rightPosition.z
  const normalDot = Math.abs(dot(normalizedLeftNormal, normalizedRightNormal))
  const planeResidual = Math.abs(dx * averagedNormal.x + dy * averagedNormal.y + dz * averagedNormal.z)
  const tangentDistance = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - planeResidual * planeResidual))
  return { normalDot, planeResidual, tangentDistance }
}

function colorFromFrame(frame: RetainedRealityMeasurementFrame, sourceToColor: Int32Array, sourceIndex: number): MeasuredColor | null {
  const colorIndex = sourceToColor[sourceIndex]
  if (colorIndex < 0 || colorIndex * 3 + 2 >= frame.srgbColors.length) return null
  const offset = colorIndex * 3
  return { r: frame.srgbColors[offset] / 255, g: frame.srgbColors[offset + 1] / 255, b: frame.srgbColors[offset + 2] / 255 }
}

function chooseMedoid(samples: readonly MeasuredObservation[], work?: MedoidWork): MeasuredObservation {
  if (samples.length <= 1) return samples[0]
  const candidates = samples.length <= M88_LAYERED_FIELD_CONFIG.maximumMedoidCandidates
    ? samples
    : Array.from({ length: M88_LAYERED_FIELD_CONFIG.maximumMedoidCandidates }, (_unused, index) => samples[Math.floor(index * samples.length / M88_LAYERED_FIELD_CONFIG.maximumMedoidCandidates)])
  if (work) {
    work.candidateVisitsBeforeEquivalent += candidates.length
    work.distanceVisitsBeforeEquivalent += candidates.length * samples.length
  }
  let best = samples[0], bestScore = Infinity
  // A retained depth grid normally contributes only a handful of points per
  // 1.8 cm cell. The bounded pair loop is exact for those cells and avoids a
  // synthetic/averaged representative even under a pathological grid.
  for (const candidate of candidates) {
    let score = 0
    for (const other of samples) score += distanceSquared(candidate.position, other.position)
    if (score < bestScore || (score === bestScore && (candidate.frameSequence < best.frameSequence || candidate.sourceIndex < best.sourceIndex))) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

function consolidateFrame(
  frame: RetainedRealityMeasurementFrame,
  medoidWork: MedoidWork,
  consolidationWork: ConsolidationWork,
): FrameConsolidatedObservation[] {
  const sourceToColor = new Int32Array(frame.denseFrame.valid.length)
  sourceToColor.fill(-1)
  for (let index = 0; index < frame.colorSourceIndices.length; index += 1) {
    const sourceIndex = frame.colorSourceIndices[index]
    if (sourceIndex >= 0 && sourceIndex < sourceToColor.length) sourceToColor[sourceIndex] = index
  }
  const cellBuckets = new Map<number, FrameCellRecord | FrameCellRecord[]>()
  const cells: FrameCellRecord[] = []
  // This map describes the complete source image, not just the samples that
  // happened to land in one spatial cell. It lets continuity cross spatial
  // cell boundaries while still requiring two actually observed neighboring
  // source pixels.
  const sourceGridCellIds = new Int32Array(frame.denseFrame.valid.length)
  sourceGridCellIds.fill(-1)
  const sourceGridObservations: Array<MeasuredObservation | undefined> = new Array(frame.denseFrame.valid.length)
  const columns = Math.max(1, frame.denseFrame.columns)
  for (let sourceIndex = 0; sourceIndex < frame.denseFrame.valid.length; sourceIndex += 1) {
    if (!frame.denseFrame.valid[sourceIndex] || !frame.normalValid[sourceIndex]) continue
    const offset = sourceIndex * 3
    const position = { x: frame.denseFrame.points[offset], y: frame.denseFrame.points[offset + 1], z: frame.denseFrame.points[offset + 2] }
    const normal = normalize({ x: frame.normals[offset], y: frame.normals[offset + 1], z: frame.normals[offset + 2] })
    if (![position.x, position.y, position.z, normal.x, normal.y, normal.z].every(Number.isFinite)) continue
    const cellX = Math.floor(position.x / M88_LAYERED_FIELD_CONFIG.consolidationCellMeters)
    const cellY = Math.floor(position.y / M88_LAYERED_FIELD_CONFIG.consolidationCellMeters)
    const cellZ = Math.floor(position.z / M88_LAYERED_FIELD_CONFIG.consolidationCellMeters)
    consolidationWork.cellIndexLookupCount += 1
    const hash = numericCellHash(cellX, cellY, cellZ)
    const bucket = cellBuckets.get(hash)
    let cell: FrameCellRecord | undefined
    if (bucket) {
      if (Array.isArray(bucket)) {
        for (const candidate of bucket) {
          if (candidate.x === cellX && candidate.y === cellY && candidate.z === cellZ) {
            cell = candidate
            break
          }
          consolidationWork.cellIndexCollisionProbeCount += 1
        }
      } else if (bucket.x === cellX && bucket.y === cellY && bucket.z === cellZ) {
        cell = bucket
      }
    }
    if (!cell) {
      cell = { id: cells.length, x: cellX, y: cellY, z: cellZ, samples: [] }
      if (!bucket) cellBuckets.set(hash, cell)
      else if (Array.isArray(bucket)) bucket.push(cell)
      else {
        cellBuckets.set(hash, [bucket, cell])
        consolidationWork.cellIndexCollisionBucketCount += 1
      }
      cells.push(cell)
    }
    const observation: MeasuredObservation = {
      sourceIndex,
      frameSequence: frame.sequence,
      timestamp: frame.timestamp,
      trackingQuality: frame.trackingQuality,
      position,
      normal,
      color: colorFromFrame(frame, sourceToColor, sourceIndex),
      localCellId: cell.id,
    }
    cell.samples.push(observation)
    sourceGridCellIds[sourceIndex] = cell.id
    sourceGridObservations[sourceIndex] = observation
  }
  const result: FrameConsolidatedObservation[] = []
  for (const cell of cells) {
    const samples = cell.samples
    const medoid = chooseMedoid(samples, medoidWork)
    const representative = medoid.color ? medoid : samples.find((sample) => sample.color) ?? medoid
    const neighborCellIds = new Set<number>()
    for (const sample of samples) {
      const localGridX = sample.sourceIndex % columns
      const localGridY = Math.floor(sample.sourceIndex / columns)
      for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) {
        if (x === 0 && y === 0) continue
        const neighborGridX = localGridX + x
        const neighborGridY = localGridY + y
        if (neighborGridX < 0 || neighborGridX >= columns || neighborGridY < 0) continue
        const neighborIndex = neighborGridY * columns + neighborGridX
        if (neighborIndex >= sourceGridCellIds.length) continue
        consolidationWork.sourceGridNeighborLookups += 1
        const neighborCellId = sourceGridCellIds[neighborIndex]
        if (neighborCellId < 0) continue
        const neighbor = sourceGridObservations[neighborIndex]
        if (!neighbor) continue
        consolidationWork.sourceGridNeighborHits += 1
        if (neighborCellId === cell.id) continue
        const relation = compatible(sample.position, sample.normal, neighbor.position, neighbor.normal)
        // Continuity is evidence only when the adjacent source pixels agree in
        // normal, tangent spacing, and measured depth. No empty grid slot is
        // traversed and no synthesized bridge is introduced.
        if (relation.normalDot < M88_LAYERED_FIELD_CONFIG.minimumNormalDot ||
          relation.planeResidual > M88_LAYERED_FIELD_CONFIG.layerPlaneSafetyMeters ||
          relation.tangentDistance > M88_LAYERED_FIELD_CONFIG.coherenceDistanceMeters) continue
        neighborCellIds.add(neighborCellId)
      }
    }
    result.push(Object.freeze({ ...representative, localCellId: cell.id, localNeighborCellIds: Object.freeze([...neighborCellIds].sort((left, right) => left - right)) }))
  }
  result.sort((left, right) => left.sourceIndex - right.sourceIndex)
  return result
}

function makeSignatureHash(): SignatureHash {
  return { first: 2166136261, second: 2654435761 }
}

function hashByte(hash: SignatureHash, byte: number): void {
  hash.first = Math.imul(hash.first ^ byte, 16777619) >>> 0
  hash.second = Math.imul(hash.second ^ ((byte + 29) & 255), 2246822519) >>> 0
}

function hashString(hash: SignatureHash, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    hashByte(hash, code & 255)
    hashByte(hash, code >>> 8)
  }
  hashByte(hash, 0)
}

function hashNumber(hash: SignatureHash, value: number): void {
  hashString(hash, Number.isFinite(value) ? value.toString() : String(value))
}

function hashBytes(hash: SignatureHash, value: ArrayBufferView): void {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  for (const byte of bytes) hashByte(hash, byte)
  hashByte(hash, 0xff)
}

/** Stable, content-based proof that both post-scan arms saw one snapshot. */
export function createRetainedRealityMeasurementSnapshotSignature(snapshot: RetainedRealityMeasurementSnapshot): string {
  const hash = makeSignatureHash()
  hashString(hash, 'M8.8-retained-snapshot-v1')
  const frames = [...snapshot.frames].sort((left, right) => left.sequence - right.sequence || left.timestamp - right.timestamp)
  hashNumber(hash, frames.length)
  for (const frame of frames) {
    hashNumber(hash, frame.sequence); hashNumber(hash, frame.timestamp); hashNumber(hash, frame.samplingPhase); hashNumber(hash, frame.trackingQuality)
    for (const value of [frame.cameraPosition.x, frame.cameraPosition.y, frame.cameraPosition.z, frame.cameraOrientation.x, frame.cameraOrientation.y, frame.cameraOrientation.z, frame.cameraOrientation.w]) hashNumber(hash, value)
    const dense = frame.denseFrame
    for (const value of [dense.columns, dense.rows, dense.validPointCount, dense.attemptedSampleCount, dense.rejectedPointCount]) hashNumber(hash, value)
    hashBytes(hash, dense.valid); hashBytes(hash, dense.normalizedX); hashBytes(hash, dense.normalizedY); hashBytes(hash, dense.distancesMeters); hashBytes(hash, dense.points)
    hashBytes(hash, frame.normals); hashBytes(hash, frame.normalValid); hashBytes(hash, frame.colorSourceIndices); hashBytes(hash, frame.srgbColors)
  }
  hashString(hash, JSON.stringify(snapshot.diagnostics))
  return `m88-${hash.first.toString(16).padStart(8, '0')}-${hash.second.toString(16).padStart(8, '0')}`
}

function calculateBounds(surfels: readonly FinalizedRealitySurfel[]): SpatialBounds | null {
  if (!surfels.length) return null
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const surfel of surfels) {
    min.x = Math.min(min.x, surfel.position.x); min.y = Math.min(min.y, surfel.position.y); min.z = Math.min(min.z, surfel.position.z)
    max.x = Math.max(max.x, surfel.position.x); max.y = Math.max(max.y, surfel.position.y); max.z = Math.max(max.z, surfel.position.z)
  }
  return { min, max }
}

function calculateColorStatistics(surfels: readonly FinalizedRealitySurfel[]): RealityColorStatistics {
  const colors = surfels.flatMap((surfel) => surfel.colorRgb ? [surfel.colorRgb] : [])
  if (!colors.length) return { colorSpace: 'srgb', sampleCount: 0, min: { r: 0, g: 0, b: 0 }, max: { r: 0, g: 0, b: 0 }, mean: { r: 0, g: 0, b: 0 }, nonWhiteSampleCount: 0, uniqueApproximateColorCount: 0 }
  const min = { r: 1, g: 1, b: 1 }, max = { r: 0, g: 0, b: 0 }, mean = { r: 0, g: 0, b: 0 }, unique = new Set<string>()
  let nonWhite = 0
  for (const color of colors) {
    min.r = Math.min(min.r, color.r); min.g = Math.min(min.g, color.g); min.b = Math.min(min.b, color.b)
    max.r = Math.max(max.r, color.r); max.g = Math.max(max.g, color.g); max.b = Math.max(max.b, color.b)
    mean.r += color.r; mean.g += color.g; mean.b += color.b
    if (Math.min(color.r, color.g, color.b) < .98 || Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) > .01) nonWhite += 1
    if (unique.size < 1024) unique.add(`${Math.round(color.r * 31)}:${Math.round(color.g * 31)}:${Math.round(color.b * 31)}`)
  }
  mean.r /= colors.length; mean.g /= colors.length; mean.b /= colors.length
  return { colorSpace: 'srgb', sampleCount: colors.length, min, max, mean, nonWhiteSampleCount: nonWhite, uniqueApproximateColorCount: unique.size }
}

function chooseTangentBasis(normal: SpatialPoint): { u: SpatialPoint; v: SpatialPoint } {
  const reference = Math.abs(normal.y) < .9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const u = normalize({ x: reference.y * normal.z - reference.z * normal.y, y: reference.z * normal.x - reference.x * normal.z, z: reference.x * normal.y - reference.y * normal.x })
  const v = normalize({ x: normal.y * u.z - normal.z * u.y, y: normal.z * u.x - normal.x * u.z, z: normal.x * u.y - normal.y * u.x })
  return { u, v }
}

function projectedCell(point: SpatialPoint, component: SurfaceComponent): string {
  const dx = point.x - component.origin.x, dy = point.y - component.origin.y, dz = point.z - component.origin.z
  return `${Math.floor((dx * component.u.x + dy * component.u.y + dz * component.u.z) / M88_LAYERED_FIELD_CONFIG.cellSizeMeters)}:${Math.floor((dx * component.v.x + dy * component.v.y + dz * component.v.z) / M88_LAYERED_FIELD_CONFIG.cellSizeMeters)}`
}

function componentOrientations(components: readonly SurfaceComponent[]): Map<number, LayeredComponentOrientation> {
  const orientations = new Map<number, LayeredComponentOrientation>()
  const vertical = components.filter((component) => Math.abs(component.normal.y) < .5)
  const main = vertical[0] ?? null
  const side = main
    ? vertical.find((component) => component !== main && Math.abs(dot(component.normal, main.normal)) <= .45 && component.layers.length >= Math.max(4, main.layers.length * .2)) ?? null
    : null
  for (const component of components) {
    if (Math.abs(component.normal.y) >= .78 && component.origin.y > .5) orientations.set(component.id, 'ceiling')
    else if (component === main) orientations.set(component.id, 'main-wall')
    else if (component === side) orientations.set(component.id, 'side-wall')
    else orientations.set(component.id, `generic-${component.id + 1}`)
  }
  return orientations
}

/**
 * Builds one deterministic, undirected compatibility graph for the measured
 * layers. Occupied cells are indexed numerically once; same-cell pairs and one
 * deterministic half of the 26 neighboring offsets cover every undirected
 * layer pair exactly once. Legacy directed lookup/visit counters are derived
 * arithmetically so diagnostics retain their historical meaning.
 */
function buildLayerAdjacency(
  layers: readonly LayerAccumulator[],
  worldCellIndex: WorldCellIndex,
): LayerAdjacencyIndex {
  const encodedNeighbors: number[][] = Array.from({ length: layers.length }, () => [])

  // Preserve the old diagnostic definitions without repeating the directed
  // string-key traversal: each layer saw all 27 offsets, same-cell visits are
  // a², and each adjacent cell pair contributes 2ab directed visits.
  const coherenceCellLookups = layers.length * NEIGHBOR_OFFSETS.length
  let coherenceLayerCandidateVisits = 0
  let coherenceAdjacencyRelationChecks = 0
  let coherenceAdjacencyUndirectedEdgeCount = 0
  let coherenceNumericIndexLookupCount = 0
  const adjacencyCollisionProbeCounter = { value: 0 }
  const lookupNumericCell = (x: number, y: number, z: number): WorldCellRecord | undefined => {
    coherenceNumericIndexLookupCount += 1
    return findWorldCellRecord(worldCellIndex, x, y, z, adjacencyCollisionProbeCounter)
  }
  const evaluatePair = (leftIndex: number, rightIndex: number, offsetIndex: number): void => {
    coherenceAdjacencyRelationChecks += 1
    const left = layers[leftIndex], right = layers[rightIndex]
    const relation = compatible(
      left.representative.position,
      left.representative.normal,
      right.representative.position,
      right.representative.normal,
    )
    if (relation.tangentDistance > M88_LAYERED_FIELD_CONFIG.coherenceDistanceMeters ||
      relation.planeResidual > M88_LAYERED_FIELD_CONFIG.coherencePlaneResidualMeters ||
      relation.normalDot < M88_LAYERED_FIELD_CONFIG.minimumNormalDot) return

    coherenceAdjacencyUndirectedEdgeCount += 1

    // Store the offset rank with the neighbor index. Sorting by this packed
    // value reproduces the former per-layer offset/entry order, keeping
    // component IDs, representatives, and floating-point sums deterministic
    // while avoiding edge objects and pair-key strings.
    encodedNeighbors[leftIndex].push(offsetIndex * ADJACENCY_LAYER_INDEX_BASE + rightIndex)
    encodedNeighbors[rightIndex].push(REVERSE_NEIGHBOR_OFFSET_INDEX[offsetIndex] * ADJACENCY_LAYER_INDEX_BASE + leftIndex)
  }
  for (const cell of worldCellIndex.records) {
    const cellLayers = cell.layers
    const cellLayerCount = cellLayers?.length ?? 0
    if (!cellLayerCount) continue
    coherenceLayerCandidateVisits += cellLayerCount * cellLayerCount
    // Same-cell pairs use the center offset rank and retain insertion order.
    for (let left = 0; left < cellLayerCount; left += 1) {
      for (let right = left + 1; right < cellLayerCount; right += 1) {
        evaluatePair(cellLayers![left].index, cellLayers![right].index, CENTER_NEIGHBOR_OFFSET_INDEX)
      }
    }
    for (const offsetIndex of HALF_NEIGHBOR_OFFSET_INDICES) {
      const [offsetX, offsetY, offsetZ] = NEIGHBOR_OFFSETS[offsetIndex]
      const neighbor = lookupNumericCell(cell.x + offsetX, cell.y + offsetY, cell.z + offsetZ)
      if (!neighbor) continue
      const neighborLayers = neighbor.layers
      if (!neighborLayers?.length) continue
      coherenceLayerCandidateVisits += 2 * cellLayerCount * neighborLayers.length
      for (const leftLayer of cellLayers!) for (const rightLayer of neighborLayers) {
        const leftIndex = leftLayer.index, rightIndex = rightLayer.index
        evaluatePair(leftIndex, rightIndex, offsetIndex)
      }
    }
  }

  const neighbors = encodedNeighbors.map((encoded) => {
    encoded.sort((left, right) => left - right)
    return Uint32Array.from(encoded, (value) => value % ADJACENCY_LAYER_INDEX_BASE)
  })
  return Object.freeze({
    neighbors: Object.freeze(neighbors),
    coherenceCellLookups,
    coherenceLayerCandidateVisits,
    coherenceAdjacencyRelationChecks,
    coherenceAdjacencyUndirectedEdgeCount,
    coherenceNumericIndexLookupCount,
    coherenceNumericIndexCollisionBucketCount: worldCellIndex.collisionBucketCount,
    coherenceNumericIndexCollisionProbeCount: adjacencyCollisionProbeCounter.value,
  })
}

function buildComponents(
  layers: readonly LayerAccumulator[],
  adjacency: readonly Uint32Array[],
): SurfaceComponent[] {
  const visited = new Uint8Array(layers.length), components: SurfaceComponent[] = []
  for (let rootIndex = 0; rootIndex < layers.length; rootIndex += 1) {
    if (visited[rootIndex]) continue
    const queue = [rootIndex]; let queueIndex = 0; visited[rootIndex] = 1
    const group: LayerAccumulator[] = []
    while (queueIndex < queue.length) {
      const currentIndex = queue[queueIndex++]
      group.push(layers[currentIndex])
      for (const neighborIndex of adjacency[currentIndex]) {
        if (visited[neighborIndex]) continue
        visited[neighborIndex] = 1
        queue.push(neighborIndex)
      }
    }
    const normalSum = group.reduce((sum, layer) => ({ x: sum.x + layer.representative.normal.x, y: sum.y + layer.representative.normal.y, z: sum.z + layer.representative.normal.z }), { x: 0, y: 0, z: 0 })
    const normal = normalize(normalSum), origin = { ...group[0].representative.position }, basis = chooseTangentBasis(normal)
    components.push({ id: components.length, layers: group, cellIds: new Set(group.map((layer) => layer.cellId)), normal, origin, ...basis })
  }
  return components.sort((left, right) => right.layers.length - left.layers.length || left.id - right.id)
}

function createLayerAccumulator(cellId: number, cellX: number, cellY: number, cellZ: number, observation: MeasuredObservation, index: number): LayerAccumulator {
  return {
    index,
    cellId,
    cellX,
    cellY,
    cellZ,
    samples: [],
    medoidScores: [],
    supportFrameMask: createMask(),
    supportViewpointMask: createMask(),
    representative: observation,
    color: observation.color,
    fallbackColor: observation.color,
    observationCount: 0,
    firstTimestamp: observation.timestamp,
    lastTimestamp: observation.timestamp,
    trackingQualitySum: 0,
    colorObservationCount: 0,
    coherentNeighborCount: 0,
    crossFrameNeighborCount: 0,
    sourceLocalContinuity: 0,
    positionMean: { x: 0, y: 0, z: 0 },
    positionM2: { x: 0, y: 0, z: 0 },
    depthReferencePosition: { ...observation.position },
    depthReferenceNormal: { ...observation.normal },
    depthMean: 0,
    depthM2: 0,
    normalDeviationMean: 0,
    normalDeviationM2: 0,
    promoted: false,
    rejectedByCapacity: false,
  }
}

function recordLayerObservation(layer: LayerAccumulator, observation: MeasuredObservation, medoidWork: MedoidWork, frameOrdinal: number, viewpointOrdinal: number): void {
  const nextCount = layer.observationCount + 1
  const updatePosition = (axis: 'x' | 'y' | 'z'): void => {
    const delta = observation.position[axis] - layer.positionMean[axis]
    layer.positionMean[axis] += delta / nextCount
    layer.positionM2[axis] += delta * (observation.position[axis] - layer.positionMean[axis])
  }
  updatePosition('x'); updatePosition('y'); updatePosition('z')
  const depthDelta = dot({
    x: observation.position.x - layer.depthReferencePosition.x,
    y: observation.position.y - layer.depthReferencePosition.y,
    z: observation.position.z - layer.depthReferencePosition.z,
  }, layer.depthReferenceNormal) - layer.depthMean
  const signedDepth = dot({
    x: observation.position.x - layer.depthReferencePosition.x,
    y: observation.position.y - layer.depthReferencePosition.y,
    z: observation.position.z - layer.depthReferencePosition.z,
  }, layer.depthReferenceNormal)
  layer.depthMean += depthDelta / nextCount
  layer.depthM2 += depthDelta * (signedDepth - layer.depthMean)
  const normalDeviation = 1 - Math.abs(dot(observation.normal, layer.depthReferenceNormal))
  const normalDelta = normalDeviation - layer.normalDeviationMean
  layer.normalDeviationMean += normalDelta / nextCount
  layer.normalDeviationM2 += normalDelta * (normalDeviation - layer.normalDeviationMean)
  layer.observationCount = nextCount
  layer.firstTimestamp = Math.min(layer.firstTimestamp, observation.timestamp)
  layer.lastTimestamp = Math.max(layer.lastTimestamp, observation.timestamp)
  layer.trackingQualitySum += observation.trackingQuality
  if (observation.color) {
    layer.colorObservationCount += 1
    if (!layer.fallbackColor) layer.fallbackColor = observation.color
  }
  setMaskBit(layer.supportFrameMask, frameOrdinal)
  setMaskBit(layer.supportViewpointMask, viewpointOrdinal)
  if (layer.samples.length < M88_LAYERED_FIELD_CONFIG.maximumMedoidCandidates) {
    const equivalentSampleCount = layer.samples.length + 1
    if (equivalentSampleCount > 1) {
      medoidWork.candidateVisitsBeforeEquivalent += equivalentSampleCount
      medoidWork.distanceVisitsBeforeEquivalent += equivalentSampleCount * equivalentSampleCount
    }
    const previousSampleCount = layer.samples.length
    let newSampleScore = 0
    for (let sampleIndex = 0; sampleIndex < previousSampleCount; sampleIndex += 1) {
      const distance = distanceSquared(layer.samples[sampleIndex].position, observation.position)
      layer.medoidScores[sampleIndex] += distance
      newSampleScore += distance
      medoidWork.distanceVisits += 1
    }
    layer.samples.push(observation)
    layer.medoidScores.push(newSampleScore)
    if (layer.samples.length > 1) medoidWork.candidateVisits += layer.samples.length
    let bestIndex = 0
    let bestScore = layer.medoidScores[0] ?? Infinity
    for (let sampleIndex = 1; sampleIndex < layer.samples.length; sampleIndex += 1) {
      const candidate = layer.samples[sampleIndex]
      const best = layer.samples[bestIndex]
      const score = layer.medoidScores[sampleIndex]
      if (score < bestScore || (score === bestScore && (candidate.frameSequence < best.frameSequence || candidate.sourceIndex < best.sourceIndex))) {
        bestIndex = sampleIndex
        bestScore = score
      }
    }
    layer.representative = layer.samples[bestIndex] ?? observation
  }
  layer.color = layer.representative.color ?? layer.samples.find((sample) => sample.color)?.color ?? layer.fallbackColor
  layer.sourceLocalContinuity += observation.localNeighborCellIds?.length ?? 0
}

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

/**
 * Bounded layered measured-cell reconstruction for the M8.8 feasibility A/B.
 * It deliberately does not import M7 planes or the display/refinement path.
 */
export class LayeredMeasuredSurfaceFieldService {
  public reconstruct(
    snapshot: RetainedRealityMeasurementSnapshot,
    baseline: CanonicalRealityFusionResult | null = null,
    inputSnapshotSignature = createRetainedRealityMeasurementSnapshotSignature(snapshot),
    onStage?: (stage: 'reconstructing-geometry' | 'cleaning-surfaces' | 'applying-room-appearance') => void,
  ): LayeredMeasuredSurfaceFieldResult {
    const startedAt = performance.now()
    const stageTimings = {
      input: 0,
      perFrameConsolidation: 0,
      fieldIntegration: 0,
      coherenceAndPromotion: 0,
      coherenceAdjacencyIndex: 0,
      coherenceConnectedComponents: 0,
      coherenceSupportPromotion: 0,
      componentMetrics: 0,
      finalPacking: 0,
    }
    onStage?.('reconstructing-geometry')
    const inputStartedAt = performance.now()
    const frames = [...snapshot.frames].sort((left, right) => left.sequence - right.sequence || left.timestamp - right.timestamp)
    const frameOrdinalBySequence = new Map<number, { frameOrdinal: number; viewpointOrdinal: number }>()
    const viewpointOrdinalByKey = new Map<string, number>()
    for (const [frameOrdinal, frame] of frames.entries()) {
      const viewpointKey = supportViewpointKey(frame)
      let viewpointOrdinal = viewpointOrdinalByKey.get(viewpointKey)
      if (viewpointOrdinal === undefined) {
        viewpointOrdinal = viewpointOrdinalByKey.size
        viewpointOrdinalByKey.set(viewpointKey, viewpointOrdinal)
      }
      frameOrdinalBySequence.set(frame.sequence, { frameOrdinal, viewpointOrdinal })
    }
    const framesBySequence = new Map(frames.map((frame) => [frame.sequence, frame]))
    const worldCellIndex = createWorldCellIndex()
    const allLayers: LayerAccumulator[] = []
    let inputObservations = 0, candidateConsolidatedMeasurements = 0, sameFrameConsolidated = 0
    const candidateRejectedCellIds = new Set<number>(), candidateRejectedLayerCapacityCellIds = new Set<number>()
    let candidateLocalLayerCapacityRejectedMeasurements = 0
    let candidateGlobalFieldCapacityRejectedMeasurements = 0
    let candidateCellLookups = 0, candidateLayerCandidateVisits = 0, coherenceCellLookups = 0, coherenceLayerCandidateVisits = 0
    let coherenceAdjacencyRelationChecks = 0, coherenceAdjacencyUndirectedEdgeCount = 0
    let coherenceNumericIndexLookupCount = 0, coherenceNumericIndexCollisionBucketCount = 0, coherenceNumericIndexCollisionProbeCount = 0
    const consolidationWork: ConsolidationWork = {
      cellIndexLookupCount: 0,
      cellIndexCollisionBucketCount: 0,
      cellIndexCollisionProbeCount: 0,
      sourceGridNeighborLookups: 0,
      sourceGridNeighborHits: 0,
    }
    const medoidWork: MedoidWork = { candidateVisitsBeforeEquivalent: 0, distanceVisitsBeforeEquivalent: 0, candidateVisits: 0, distanceVisits: 0 }
    stageTimings.input = performance.now() - inputStartedAt

    let fieldIntegrationMs = 0
    for (const frame of frames) {
      let validNormalCount = 0
      for (let sourceIndex = 0; sourceIndex < frame.denseFrame.valid.length; sourceIndex += 1) {
        if (!frame.denseFrame.valid[sourceIndex] || !frame.normalValid[sourceIndex]) continue
        const offset = sourceIndex * 3
        const position = { x: frame.denseFrame.points[offset], y: frame.denseFrame.points[offset + 1], z: frame.denseFrame.points[offset + 2] }
        const normal = { x: frame.normals[offset], y: frame.normals[offset + 1], z: frame.normals[offset + 2] }
        if (![position.x, position.y, position.z, normal.x, normal.y, normal.z].every(Number.isFinite)) continue
        validNormalCount += 1
        // The A/B observed domain is complete over all valid+normal measured
        // source points, rather than only over consolidated representatives.
        const [cellX, cellY, cellZ] = worldCellCoordinates(position)
        getOrCreateWorldCellRecord(worldCellIndex, cellX, cellY, cellZ)
      }
      inputObservations += validNormalCount
      const frameStartedAt = performance.now()
      const observations = consolidateFrame(frame, medoidWork, consolidationWork)
      stageTimings.perFrameConsolidation += performance.now() - frameStartedAt
      candidateConsolidatedMeasurements += observations.length
      sameFrameConsolidated += Math.max(0, validNormalCount - observations.length)
      const integrationFrameStartedAt = performance.now()
      const frameOrdinals = frameOrdinalBySequence.get(frame.sequence)
      if (!frameOrdinals) throw new Error(`Missing frame ordinal for retained frame ${frame.sequence}`)
      for (const observation of observations) {
        const [cellX, cellY, cellZ] = worldCellCoordinates(observation.position)
        const cellRecord = getOrCreateWorldCellRecord(worldCellIndex, cellX, cellY, cellZ)
        const cellId = cellRecord.id
        const layers = cellRecord.layers ?? (cellRecord.layers = [])
        candidateCellLookups += 1
        let best: LayerAccumulator | null = null, bestScore = Infinity
        for (const layer of layers) {
          candidateLayerCandidateVisits += 1
          const relation = compatible(observation.position, observation.normal, layer.representative.position, layer.representative.normal)
          if (relation.normalDot < M88_LAYERED_FIELD_CONFIG.minimumNormalDot || relation.planeResidual > M88_LAYERED_FIELD_CONFIG.layerPlaneSafetyMeters || relation.tangentDistance > M88_LAYERED_FIELD_CONFIG.layerTangentDistanceMeters) continue
          const score = relation.planeResidual / M88_LAYERED_FIELD_CONFIG.layerPlaneSafetyMeters + relation.tangentDistance / M88_LAYERED_FIELD_CONFIG.layerTangentDistanceMeters + (1 - relation.normalDot)
          if (score < bestScore) { best = layer; bestScore = score }
        }
        if (!best) {
          if (layers.length >= M88_LAYERED_FIELD_CONFIG.maximumLayersPerCell) {
            candidateRejectedCellIds.add(cellId); candidateRejectedLayerCapacityCellIds.add(cellId)
            candidateLocalLayerCapacityRejectedMeasurements += 1
            continue
          }
          if (allLayers.length >= M88_LAYERED_FIELD_CONFIG.maximumFieldLayers) {
            candidateRejectedCellIds.add(cellId)
            candidateGlobalFieldCapacityRejectedMeasurements += 1
            continue
          }
          best = createLayerAccumulator(cellId, cellX, cellY, cellZ, observation, allLayers.length)
          layers.push(best); allLayers.push(best)
        }
        recordLayerObservation(best, observation, medoidWork, frameOrdinals.frameOrdinal, frameOrdinals.viewpointOrdinal)
      }
      fieldIntegrationMs += performance.now() - integrationFrameStartedAt
    }
    stageTimings.fieldIntegration = fieldIntegrationMs

    onStage?.('cleaning-surfaces')
    const coherenceStartedAt = performance.now()
    const adjacencyStartedAt = performance.now()
    const adjacency = buildLayerAdjacency(allLayers, worldCellIndex)
    stageTimings.coherenceAdjacencyIndex = performance.now() - adjacencyStartedAt
    const componentsStartedAt = performance.now()
    const components = buildComponents(allLayers, adjacency.neighbors)
    stageTimings.coherenceConnectedComponents = performance.now() - componentsStartedAt
    coherenceCellLookups = adjacency.coherenceCellLookups
    coherenceLayerCandidateVisits = adjacency.coherenceLayerCandidateVisits
    coherenceAdjacencyRelationChecks = adjacency.coherenceAdjacencyRelationChecks
    coherenceAdjacencyUndirectedEdgeCount = adjacency.coherenceAdjacencyUndirectedEdgeCount
    coherenceNumericIndexLookupCount = adjacency.coherenceNumericIndexLookupCount
    coherenceNumericIndexCollisionBucketCount = adjacency.coherenceNumericIndexCollisionBucketCount
    coherenceNumericIndexCollisionProbeCount = adjacency.coherenceNumericIndexCollisionProbeCount
    const supportStartedAt = performance.now()
    for (let layerIndex = 0; layerIndex < allLayers.length; layerIndex += 1) {
      const layer = allLayers[layerIndex]
      const neighborFrames = createMask(), localNeighborFrames = createMask()
      for (const neighborIndex of adjacency.neighbors[layerIndex]) {
        const neighbor = allLayers[neighborIndex]
        layer.coherentNeighborCount += 1
        forEachMaskBit(neighbor.supportFrameMask, (frameOrdinal) => {
          setMaskBit(neighborFrames, frameOrdinal)
          if (!hasMaskBit(layer.supportFrameMask, frameOrdinal)) setMaskBit(localNeighborFrames, frameOrdinal)
        })
      }
      layer.crossFrameNeighborCount = maskBitCount(localNeighborFrames)
      // Direct same-cell multi-frame support is sufficient. A layer supported
      // by coherent neighbors instead needs both source-grid continuity in its
      // own frame and independent neighbors from other frames; this prevents a
      // single noisy sheet from self-promoting.
      const directCrossFrameSupport = maskBitCount(layer.supportFrameMask) >= 2
      const coherentCrossFrameSupport = layer.sourceLocalContinuity > 0 &&
        layer.coherentNeighborCount >= M88_LAYERED_FIELD_CONFIG.minimumCoherentNeighbors &&
        maskBitCount(neighborFrames) >= 2 && layer.crossFrameNeighborCount >= 2
      layer.promoted = directCrossFrameSupport || coherentCrossFrameSupport
    }
    stageTimings.coherenceSupportPromotion = performance.now() - supportStartedAt
    stageTimings.coherenceAndPromotion = performance.now() - coherenceStartedAt

    const baselineSurfels = baseline?.surfels ?? []
    const baselineAllCellIds = new Set<number>()
    const baselineOutsideCellKeys = new Set<string>()
    for (const surfel of baselineSurfels) {
      const [cellX, cellY, cellZ] = worldCellCoordinates(surfel.position)
      const cell = findWorldCellRecord(worldCellIndex, cellX, cellY, cellZ)
      if (cell) baselineAllCellIds.add(cell.id)
      else baselineOutsideCellKeys.add(formatWorldCellKey(cellX, cellY, cellZ))
    }
    // All same-domain percentages use the candidate's complete observed-cell
    // domain. Baseline cells outside that domain remain visible as a separate
    // diagnostic but cannot inflate baseline survival above 100%.
    // Every world-cell record was created by the complete valid+normal input
    // pass above, so the index's records are the observed domain itself.
    const baselineCells = baselineAllCellIds
    const baselineRepresentedOutsideObservedWorldCells = baselineOutsideCellKeys.size
    const promotedLayers = allLayers.filter((layer) => layer.promoted)
    const candidateAllCellIds = new Set(promotedLayers.map((layer) => layer.cellId))
    const candidateCells = candidateAllCellIds
    const candidateRepresentedOutsideObservedWorldCells = 0
    const candidateObservedCellMismatchCount = 0
    const ownership: LayeredMeasuredSurfaceOwnership[] = promotedLayers.map((layer, surfelId) => {
      const sameCellLayers = worldCellIndex.records[layer.cellId]?.layers
      const layerOrdinal = sameCellLayers ? Math.max(0, sameCellLayers.indexOf(layer)) : 0
      const worldCellKey = formatWorldCellKey(layer.cellX, layer.cellY, layer.cellZ)
      return Object.freeze({
        surfelId,
        representativeFrameSequence: layer.representative.frameSequence,
        representativeSourceIndex: layer.representative.sourceIndex,
        worldCellKey,
        layerId: `${worldCellKey}:layer-${layerOrdinal}`,
        position: Object.freeze({ ...layer.representative.position }),
      })
    })
    const candidateUnownedOrInventedCount = ownership.reduce((count, owner) => {
      const frame = framesBySequence.get(owner.representativeFrameSequence)
      const sourceIndex = owner.representativeSourceIndex
      if (!frame || sourceIndex < 0 || sourceIndex >= frame.denseFrame.valid.length) return count + 1
      const offset = sourceIndex * 3
      const points = frame.denseFrame.points
      const exact = points[offset] === owner.position.x && points[offset + 1] === owner.position.y && points[offset + 2] === owner.position.z
      return exact ? count : count + 1
    }, 0)
    const observedLayerCount = allLayers.length
    const maximumObservedLayersPerCell = maximumLayersPerCell(worldCellIndex.records)
    const maximumCandidateLayersPerCell = maximumLayersPerCell(worldCellIndex.records, true)
    const candidateLocalLayerCapacitySaturatedCells = worldCellIndex.records.filter((cell) => (cell.layers?.length ?? 0) >= M88_LAYERED_FIELD_CONFIG.maximumLayersPerCell).length
    const candidateLocalLayerCapacitySaturated = candidateLocalLayerCapacitySaturatedCells > 0
    const candidateGlobalFieldCapacityReached = candidateGlobalFieldCapacityRejectedMeasurements > 0 || allLayers.length >= M88_LAYERED_FIELD_CONFIG.maximumFieldLayers
    const candidateCapacityRejectedMeasurements = candidateLocalLayerCapacityRejectedMeasurements + candidateGlobalFieldCapacityRejectedMeasurements
    // Keep the legacy aggregate field, but do not report global exhaustion just
    // because one local cell reached its four-layer safety bound.
    const candidateCapacityReached = candidateCapacityRejectedMeasurements > 0 || candidateGlobalFieldCapacityReached
    const candidateLayerSafetyViolations = worldCellIndex.records.reduce((count, cell) => count + Math.max(0, (cell.layers?.filter((layer) => layer.promoted).length ?? 0) - M88_LAYERED_FIELD_CONFIG.maximumLayersPerCell), 0)

    const metricsStartedAt = performance.now()
    const cellToComponent = new Map<number, number>()
    for (const component of components) for (const layer of component.layers) if (!cellToComponent.has(layer.cellId)) cellToComponent.set(layer.cellId, component.id)
    const componentById = new Map(components.map((component) => [component.id, component]))
    const orientationByComponentId = componentOrientations(components)
    const majorComponents = components.slice(0, M88_LAYERED_FIELD_CONFIG.maximumReportedComponents)
    const componentMetrics: LayeredSurfaceComponentMetric[] = []
    let unobservedProjectedCells = 0, baselineMissing = 0, candidateRepresented = 0, candidateStillRejected = 0, conflictingMultilayer = 0
    const componentForPoint = (point: SpatialPoint): SurfaceComponent | null => {
      const [cx, cy, cz] = worldCellCoordinates(point)
      const directCell = findWorldCellRecord(worldCellIndex, cx, cy, cz)
      const direct = directCell ? cellToComponent.get(directCell.id) : undefined
      if (direct !== undefined) return componentById.get(direct) ?? null
      for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
        const neighborCell = findWorldCellRecord(worldCellIndex, cx + dx, cy + dy, cz + dz)
        const id = neighborCell ? cellToComponent.get(neighborCell.id) : undefined
        if (id !== undefined) return componentById.get(id) ?? null
      }
      return null
    }
    for (const component of majorComponents) {
      const observedProjected = new Set(component.layers.map((layer) => projectedCell(layer.representative.position, component)))
      const baselineProjected = new Set<string>(), candidateProjected = new Set<string>()
      for (const surfel of baselineSurfels) if (componentForPoint(surfel.position)?.id === component.id && observedProjected.has(projectedCell(surfel.position, component))) baselineProjected.add(projectedCell(surfel.position, component))
      for (const layer of promotedLayers) if (componentForPoint(layer.representative.position)?.id === component.id) candidateProjected.add(projectedCell(layer.representative.position, component))
      const values = [...observedProjected].map((value) => value.split(':').map(Number) as [number, number])
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const [x, y] of values) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
      const observedByProjected = observedProjected
      const componentConflicts = new Set([...component.cellIds].filter((cellId) => (worldCellIndex.records[cellId]?.layers?.length ?? 0) > 1))
      conflictingMultilayer += componentConflicts.size
      for (const cell of observedByProjected) {
        if (!baselineProjected.has(cell)) {
          baselineMissing += 1
          if (candidateProjected.has(cell)) candidateRepresented += 1
          else candidateStillRejected += 1
        }
      }
      // Only interior cells with at least two adjacent measured projections are
      // classified as A. They remain diagnostics; no such cell is output.
      if (Number.isFinite(minX) && Number.isFinite(minY) && (maxX - minX) * (maxY - minY) < 200000) {
        for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
          const cell = `${x}:${y}`
          if (observedByProjected.has(cell)) continue
          let adjacent = 0
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (observedByProjected.has(`${x + dx}:${y + dy}`)) adjacent += 1
          if (adjacent >= 2) unobservedProjectedCells += 1
        }
      }
      const observedCount = observedProjected.size
      componentMetrics.push(Object.freeze({
        id: `component-${component.id + 1}`,
        orientation: orientationByComponentId.get(component.id) ?? `generic-${component.id + 1}`,
        measuredLayers: component.layers.length,
        observedCells: observedCount,
        baselineCells: baselineProjected.size,
        candidateCells: candidateProjected.size,
        baselineCoveragePercentage: Math.min(100, baselineProjected.size / Math.max(1, observedCount) * 100),
        candidateCoveragePercentage: Math.min(100, candidateProjected.size / Math.max(1, observedCount) * 100),
        candidateImprovementPercentagePoints: (candidateProjected.size - baselineProjected.size) / Math.max(1, observedCount) * 100,
        tangentBasis: Object.freeze({ normal: component.normal, u: component.u, v: component.v }),
      }))
    }
    const holeClasses: LayeredMeasuredSurfaceHoleClasses = Object.freeze({
      A_unobserved: unobservedProjectedCells,
      B_observedBaselineMissing: baselineMissing,
      C_candidateRepresented: candidateRepresented,
      D_candidateStillRejected: candidateStillRejected,
      E_conflictingMultilayer: conflictingMultilayer,
    })
    stageTimings.componentMetrics = performance.now() - metricsStartedAt

    onStage?.('applying-room-appearance')
    const packingStartedAt = performance.now()
    const finalSurfels = promotedLayers.map((layer, id): FinalizedRealitySurfel => {
      const representative = layer.representative
      const color = layer.color
      const framesSupported = maskBitCount(layer.supportFrameMask)
      const varianceDenominator = Math.max(1, layer.observationCount - 1)
      const positionVarianceMetersSquared = (layer.positionM2.x + layer.positionM2.y + layer.positionM2.z) / varianceDenominator
      const depthVarianceMetersSquared = layer.depthM2 / varianceDenominator
      const normalVariance = layer.normalDeviationM2 / varianceDenominator
      const stabilityClass = framesSupported >= 2 && (layer.coherentNeighborCount >= M88_LAYERED_FIELD_CONFIG.minimumCoherentNeighbors || layer.sourceLocalContinuity > 0)
        ? 'high' as const
        : 'low' as const
      return Object.freeze({
        id,
        position: Object.freeze({ ...representative.position }),
        normal: Object.freeze({ ...representative.normal }),
        radius: M88_LAYERED_FIELD_CONFIG.cellSizeMeters / 2,
        colorRgb: color ? Object.freeze({ ...color }) : null,
        colorSpace: 'srgb' as const,
        geometryConfidence: clamp(.45 + Math.min(.3, framesSupported * .1) + Math.min(.2, layer.coherentNeighborCount * .025) + representative.trackingQuality * .1, 0, 1),
        geometryObservationCount: layer.observationCount,
        viewObservationCount: maskBitCount(layer.supportViewpointMask),
        firstObservedAt: layer.firstTimestamp,
        lastObservedAt: layer.lastTimestamp,
        positionVarianceMetersSquared,
        depthVarianceMetersSquared,
        normalVariance,
        trackingQuality: layer.trackingQualitySum / Math.max(1, layer.observationCount),
        duplicateSurfaceCandidate: (worldCellIndex.records[layer.cellId]?.layers?.length ?? 0) > 1,
        stabilityClass,
        colorConfidence: Math.min(1, layer.colorObservationCount / 4),
        colorObservationCount: layer.colorObservationCount,
      })
    })
    stageTimings.finalPacking = performance.now() - packingStartedAt
    const observedCellCount = worldCellIndex.records.length
    const candidateCoveragePercentage = Math.min(100, candidateCells.size / Math.max(1, observedCellCount) * 100)
    const baselineCoveragePercentage = Math.min(100, baselineCells.size / Math.max(1, observedCellCount) * 100)
    const observedArea = observedCellCount * M88_LAYERED_FIELD_CONFIG.cellSizeMeters ** 2
    const baselineArea = baselineCells.size * M88_LAYERED_FIELD_CONFIG.cellSizeMeters ** 2
    const candidateArea = candidateCells.size * M88_LAYERED_FIELD_CONFIG.cellSizeMeters ** 2
    const baselineConsolidatedMeasurements = baseline?.diagnostics.consolidatedObservations ?? candidateConsolidatedMeasurements
    const retainedMedoidSamples = allLayers.reduce((sum, layer) => sum + layer.samples.length, 0)
    const inputMemoryBytes = snapshot.diagnostics.memoryBytes
    const candidateRepresentationMemoryBytes = candidateConsolidatedMeasurements * 48 + retainedMedoidSamples * 96
    const candidateWorkingMemoryBytes = allLayers.length * 224 + worldCellIndex.records.length * 48 + ownership.length * 96
    const candidateOutputMemoryBytes = finalSurfels.length * 128 + ownership.length * 96
    const numericMemoryBytes = inputMemoryBytes + candidateRepresentationMemoryBytes + candidateWorkingMemoryBytes + candidateOutputMemoryBytes
    const peakMemoryBytesLowerBound = inputMemoryBytes + candidateRepresentationMemoryBytes + candidateWorkingMemoryBytes
    const peakMemoryBytesEstimate = peakMemoryBytesLowerBound + candidateOutputMemoryBytes
    const diagnostics: LayeredMeasuredSurfaceFieldDiagnostics = Object.freeze({
      inputFrames: frames.length,
      inputRetainedMeasurements: inputObservations,
      candidateConsolidatedMeasurements,
      sameFrameConsolidated,
      uniqueObservedWorldCells: observedCellCount,
      baselineConsolidatedMeasurements,
      baselineRepresentedWorldCells: baselineCells.size,
      candidateRepresentedWorldCells: candidateCells.size,
      baselineSurvivalPercentage: baselineCoveragePercentage,
      candidateSurvivalPercentage: candidateCoveragePercentage,
      measuredCellAreaSquareMeters: M88_LAYERED_FIELD_CONFIG.cellSizeMeters ** 2,
      observedMeasuredAreaSquareMeters: observedArea,
      baselineRepresentedMeasuredAreaSquareMeters: baselineArea,
      candidateRepresentedMeasuredAreaSquareMeters: candidateArea,
      baselineLostMeasuredAreaSquareMeters: Math.max(0, observedArea - baselineArea),
      candidateLostMeasuredAreaSquareMeters: Math.max(0, observedArea - candidateArea),
      unobservedMeasuredAreaSquareMeters: unobservedProjectedCells * M88_LAYERED_FIELD_CONFIG.cellSizeMeters ** 2,
      candidateUnownedOrInventedCount,
      candidateObservedCellMismatchCount,
      baselineRepresentedOutsideObservedWorldCells,
      candidateRepresentedOutsideObservedWorldCells,
      candidateRejectedWorldCells: candidateRejectedCellIds.size,
      candidateRejectedLayerCapacityCells: candidateRejectedLayerCapacityCellIds.size,
      candidateLocalLayerCapacityRejectedMeasurements,
      candidateGlobalFieldCapacityRejectedMeasurements,
      candidateLocalLayerCapacitySaturated,
      candidateGlobalFieldCapacityReached,
      candidateLocalLayerCapacitySaturatedCells,
      candidateCapacityRejectedMeasurements,
      candidateCapacityReached,
      candidateCellLookups,
      candidateLayerCandidateVisits,
      coherenceCellLookups,
      coherenceLayerCandidateVisits,
      coherenceAdjacencyRelationChecks,
      coherenceAdjacencyUndirectedEdgeCount,
      coherenceNumericIndexLookupCount,
      coherenceNumericIndexCollisionBucketCount,
      coherenceNumericIndexCollisionProbeCount,
      maximumFieldLayers: M88_LAYERED_FIELD_CONFIG.maximumFieldLayers,
      promotedLayerCount: promotedLayers.length,
      observedLayerCount,
      maximumObservedLayersPerCell,
      maximumCandidateLayersPerCell,
      candidateLayerSafetyViolations,
      crossFrameSupportedLayerCount: allLayers.filter((layer) => maskBitCount(layer.supportFrameMask) >= 2).length,
      coherentSupportPromotedLayerCount: promotedLayers.filter((layer) => maskBitCount(layer.supportFrameMask) < 2).length,
      frameLocalContinuityLayerCount: allLayers.filter((layer) => layer.sourceLocalContinuity > 0).length,
      holeClasses,
      coherentSurfaceComponents: Object.freeze(componentMetrics),
      inputSnapshotSignature,
      workerTimeMs: performance.now() - startedAt,
      numericMemoryBytes,
      inputMemoryBytes,
      candidateRepresentationMemoryBytes,
      candidateWorkingMemoryBytes,
      candidateOutputMemoryBytes,
      peakMemoryBytesEstimate,
      peakMemoryBytesLowerBound,
      consolidationCellIndexLookupCount: consolidationWork.cellIndexLookupCount,
      consolidationCellIndexCollisionBucketCount: consolidationWork.cellIndexCollisionBucketCount,
      consolidationCellIndexCollisionProbeCount: consolidationWork.cellIndexCollisionProbeCount,
      consolidationSourceGridNeighborLookups: consolidationWork.sourceGridNeighborLookups,
      consolidationSourceGridNeighborHits: consolidationWork.sourceGridNeighborHits,
      medoidCandidateVisitsBeforeEquivalent: medoidWork.candidateVisitsBeforeEquivalent,
      medoidDistanceVisitsBeforeEquivalent: medoidWork.distanceVisitsBeforeEquivalent,
      medoidCandidateVisits: medoidWork.candidateVisits,
      medoidDistanceVisits: medoidWork.distanceVisits,
      workerStageTimingsMs: Object.freeze(stageTimings),
    })
    return Object.freeze({ surfels: Object.freeze(finalSurfels), ownership: Object.freeze(ownership), diagnostics, bounds: calculateBounds(finalSurfels), colorStatistics: calculateColorStatistics(finalSurfels) })
  }
}

export function buildSnapshotSignaturePair(snapshot: RetainedRealityMeasurementSnapshot, baseline: CanonicalRealityFusionResult, candidate: LayeredMeasuredSurfaceFieldResult, signature = createRetainedRealityMeasurementSnapshotSignature(snapshot)): RetainedSnapshotSignaturePair {
  const baselineInputSnapshotSignature = baseline.diagnostics.inputSnapshotSignature ?? signature
  const candidateInputSnapshotSignature = candidate.diagnostics.inputSnapshotSignature
  return Object.freeze({ inputSnapshotSignature: signature, baselineInputSnapshotSignature, candidateInputSnapshotSignature, identicalInput: baselineInputSnapshotSignature === candidateInputSnapshotSignature })
}

export function measuredCellKey(point: SpatialPoint): string {
  return pointKey(point)
}

export function measuredCellPercentages(result: LayeredMeasuredSurfaceFieldResult): { represented: number; lost: number } {
  const represented = result.diagnostics.candidateSurvivalPercentage
  return { represented, lost: Math.max(0, 100 - represented) }
}

export function measuredThicknessPercentiles(result: LayeredMeasuredSurfaceFieldResult): { p50Meters: number; p90Meters: number } {
  const thickness = result.surfels.map((surfel) => Math.sqrt(Math.max(0, surfel.depthVarianceMetersSquared ?? 0)))
  return { p50Meters: percentile(thickness, .5), p90Meters: percentile(thickness, .9) }
}

import type { FinalizedRealityRgbKeyframes, FinalizedRealitySurfel, RealityRgbKeyframe, SpatialPoint } from '../types'
import type { RealityStructuralAssociationTable } from './realityStructuralAssociationService'
import { RealityMembershipCode } from './realityStructuralAssociationService'
import { mapCameraUvToCopyPixelInto } from './xrRawCameraService'

export const VisibleWallMaskCode = { WALL: 1, NON_WALL: 2, UNCERTAIN: 3 } as const
/** Compact, per-pixel explanation for the local post-scan visual decision. */
export const VisibleWallMaskEvidenceCode = {
  UNKNOWN: 0,
  STRUCTURAL_SEED: 1,
  CONSISTENT_WALL_GROWTH: 2,
  STRONG_VISUAL_OBJECT: 3,
  ENCLOSED_VISUAL_OBJECT: 4,
  UNCERTAIN: 5,
  SECONDARY_WALL_EXPANSION: 6,
} as const

/** Mutually exclusive final explanation for pixels left unpainted. */
export const VisibleWallMaskTerminalReason = {
  NONE: 0,
  NO_REACHABLE_WALL_SEED: 1,
  SEED_COLOR_MISMATCH: 2,
  LOCAL_CONTINUITY_BREAK: 3,
  STRONG_GRADIENT_BOUNDARY: 4,
  OBJECT_BOUNDARY: 5,
  ENCLOSED_REGION: 6,
  INSUFFICIENT_NEIGHBOR_SUPPORT: 7,
} as const

/** Compact per-Dense-Reality-sample state for selected-wall diagnostics. */
export const VisibleWallMask3dCode = { OUTSIDE_DOMAIN: 0, WALL: 1, NON_WALL: 2, UNCERTAIN: 3 } as const
export const VisibleWallMask3dTerminalReason = {
  NONE: 0,
  NO_SELECTED_KEYFRAME_OBSERVES_SAMPLE: 1,
  PROJECTION_OUTSIDE_IMAGE: 2,
  PROJECTION_OUTSIDE_ROI: 3,
  MASK_PIXEL_UNCERTAIN: 4,
  INSUFFICIENT_OBSERVATIONS: 5,
  ONE_GOOD_WALL_VOTE_QUALITY_FAILED: 6,
  CONFLICTING_WALL_OBJECT_VOTES: 7,
  CONFLICTING_WALL_UNCERTAIN_VOTES: 8,
  VISIBILITY_OCCLUSION_UNCERTAINTY: 9,
  LOGICAL_SURFACE_MISMATCH: 10,
  OTHER: 11,
  GEOMETRY_FOREGROUND: 12,
  GEOMETRY_UNCERTAIN: 13,
} as const

/** Geometry-first post-scan veto for non-planar/foreground Reality surfaces. */
export const GeometryForegroundCode = {
  OUTSIDE_DOMAIN: 0,
  WALL_GEOMETRY: 1,
  FOREGROUND_CORE: 2,
  FOREGROUND_CONNECTED: 3,
  GEOMETRY_UNCERTAIN: 4,
} as const

export const GeometryForegroundReason = {
  NONE: 0,
  EXISTING_FOREGROUND: 1,
  PLANE_OFFSET: 2,
  NORMAL_DISAGREEMENT: 3,
  SURFACE_ROUGHNESS: 4,
  DEPTH_DISCONTINUITY: 5,
  CONNECTED_FOREGROUND: 6,
  GEOMETRY_UNCERTAIN: 7,
} as const

/**
 * A bounded 3D admission domain for a logical wall. M7 patches are trusted
 * anchors, while connected observed Reality can extend beyond their clean
 * support polygons without inventing any geometry.
 */
export const RealityWallDomainCode = {
  OUTSIDE_LOGICAL_WALL_DOMAIN: 0,
  M7_PATCH_CORE: 1,
  OBSERVED_WALL_EXTENSION: 2,
} as const

export interface RealityWallDomainAnalysis {
  readonly states: Uint8Array
  readonly patchCoreSampleCount: number
  readonly nearPatchSampleCount: number
  readonly observedWallExtensionSampleCount: number
  readonly outsideDomainSampleCount: number
  readonly rgbWallProjectedCandidateCount: number
  readonly rejectedByBoundsCount: number
  readonly rejectedByPlaneCount: number
  readonly rejectedByNormalCount: number
  readonly rejectedByForegroundCount: number
  readonly domainComponentCount: number
  readonly patchUvBounds: { readonly minU: number; readonly maxU: number; readonly minV: number; readonly maxV: number } | null
  readonly expandedUvBounds: { readonly minU: number; readonly maxU: number; readonly minV: number; readonly maxV: number } | null
  readonly planeEnvelopeMeters: number
  readonly patchEdgeToleranceMeters: number
  readonly maxExpansionDistanceMeters: number
  readonly seedClassificationMs: number
  readonly extensionGrowthMs: number
  readonly memoryBytes: number
}

export interface PreservedVisualIsland {
  readonly pixelCount: number
  readonly boundaryClosureScore: number
  readonly wallSurroundScore: number
}

/** A bounded, derived 2D object region. It never changes captured RGB. */
export interface PreservedVisualRegion {
  readonly id: string
  readonly sourceKeyframeId: number
  readonly pixelIndices: Uint32Array
  readonly boundingBox: { x: number; y: number; width: number; height: number }
  readonly rawFragmentPixelCount: number
  readonly enclosureScore: number
  readonly wallSurroundScore: number
  readonly appearanceDistinctness: number
  readonly confidence: number
}

/** A higher-level bounded enclosure assembled from compatible visual regions. */
export interface PreservedVisualObjectCluster {
  readonly id: string
  readonly sourceKeyframeId: number
  readonly memberRegionIds: readonly string[]
  readonly pixelIndices: Uint32Array
  readonly boundingBox: { x: number; y: number; width: number; height: number }
  readonly centroid: { x: number; y: number }
  readonly outerContour: readonly { x: number; y: number }[]
  readonly memberAreaPixels: number
  readonly filledInteriorPixelCount: number
  readonly boundaryBandPixelCount: number
  readonly wallSurroundScore: number
  readonly boundarySupport: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
  readonly closureScore: number
  readonly largestContourGapPixels: number
  readonly inferredBoundarySections: readonly string[]
  readonly confidence: number
  readonly accepted: boolean
  readonly rejectionReason: string | null
  readonly aspectRatio: number
  readonly heightOnWall: number
  readonly roiEdgeProximity: number
  readonly depthOffsetMeters: number | null
  readonly depthVarianceMeters: number | null
  readonly crossKeyframeSupport: number
  readonly foregroundPenalty: number
  readonly rankingScore: number
  readonly decision: 'dominant-wall-mounted' | 'preserved-non-dominant' | 'rejected'
}

export interface WallLocalPreservedObjectFusion {
  readonly width: number
  readonly height: number
  readonly objectVotes: Uint8Array
  readonly wallVotes: Uint8Array
  readonly protectedCells: Uint8Array
  readonly keyframeSupport: Uint8Array
  readonly protectedSampleMask: Uint8Array
  readonly objectSupportedCellCount: number
  readonly wallSupportedCellCount: number
  readonly uncertainCellCount: number
  readonly regionCount: number
  readonly protectedSampleCount: number
}

export interface GeometryForegroundComponent {
  readonly id: number
  readonly sampleCount: number
  readonly estimatedAreaMetersSquared: number
  readonly offsetMedianMeters: number | null
  readonly offsetP90Meters: number | null
  readonly normalDeviationMedianDegrees: number | null
  readonly roughnessMedianMeters: number | null
  readonly boundarySampleCount: number
  readonly coreFraction: number
  readonly connectedFraction: number
  readonly wallContactRatio: number
  readonly confidence: number
}

export interface GeometryForegroundAnalysis {
  readonly classifications: Uint8Array
  readonly reasons: Uint8Array
  readonly signedResidualMeters: Float32Array
  readonly normalDeviationDegrees: Uint8Array
  readonly roughnessMillimeters: Uint8Array
  readonly depthStepMillimeters: Uint8Array
  readonly componentIds: Int32Array
  readonly strongWallBarrier: Uint8Array
  readonly wallResidualMeters: { readonly median: number | null; readonly p75: number | null; readonly p90: number | null; readonly p95: number | null }
  readonly signedOffsetMeters: { readonly min: number | null; readonly p05: number | null; readonly p25: number | null; readonly median: number | null; readonly p75: number | null; readonly p90: number | null; readonly p95: number | null; readonly max: number | null }
  readonly wallEnvelopeMeters: number
  readonly ambiguousOffsetMeters: number
  readonly foregroundSeedOffsetMeters: number
  readonly foregroundSide: -1 | 0 | 1
  readonly calibrationSampleCount: number
  readonly geometryDomainSampleCount: number
  readonly rgbWallEnteringGeometryCount: number
  readonly geometryWallLikeSampleCount: number
  readonly foregroundCoreSampleCount: number
  readonly foregroundConnectedSampleCount: number
  readonly geometryUncertainSampleCount: number
  readonly rgbWallRejectedByGeometryCount: number
  readonly foregroundReasonCounts: Readonly<Record<string, number>>
  readonly components: readonly GeometryForegroundComponent[]
  readonly calibrationMs: number
  readonly localAnalysisMs: number
  readonly componentGrowthMs: number
  readonly memoryBytes: number
}

export interface VisibleWallMaskKeyframe {
  readonly keyframeId: number
  readonly roi: { x: number; y: number; width: number; height: number }
  readonly mask: Uint8Array
  readonly evidence: Uint8Array
  readonly terminalReasons: Uint8Array
  /** Pixel indices of high-confidence projected structural/Reality seeds. */
  readonly seedPixels: Uint32Array
  readonly seedPixelCount: number
  readonly wallPixelCount: number
  readonly nonWallPixelCount: number
  readonly uncertainPixelCount: number
  readonly seedWallPixelCount: number
  readonly grownWallPixelCount: number
  readonly strongVisualObjectPixelCount: number
  readonly enclosedVisualObjectPixelCount: number
  readonly secondaryExpandedWallPixelCount: number
  readonly preservedIslands: readonly PreservedVisualIsland[]
  readonly rawObjectFragmentPixelCount: number
  readonly rawObjectFragmentCount: number
  readonly rawObjectFragmentPixels: Uint32Array
  readonly preservedVisualRegions: readonly PreservedVisualRegion[]
  readonly preservedVisualObjectClusters: readonly PreservedVisualObjectCluster[]
  /** Pixels filled by an accepted M8.6.5 outer object envelope. */
  readonly completedObjectEnvelopePixels: Uint8Array
  readonly projectedAreaPixels: number
  readonly qualityScore: number
}

export interface VisibleWallMaskSurfaceResult {
  readonly logicalSurfaceId: string
  readonly selectedKeyframeIds: readonly number[]
  readonly masks: readonly VisibleWallMaskKeyframe[]
  readonly candidateKeyframeCount: number
  readonly roiPixelCount: number
  readonly paintableWallPixelCount: number
  readonly preservedObjectPixelCount: number
  readonly preservedUncertainPixelCount: number
  readonly wallConfirmedSampleCount: number
  readonly nonWallSampleCount: number
  readonly uncertainSampleCount: number
  readonly threeDUncertainReasonCounts: Readonly<Record<string, number>>
  readonly threeDObservationDiagnostics: {
    readonly totalDenseRealitySamples: number
    readonly logicalDomainCandidateSamples: number
    readonly projectableIntoSelectedKeyframes: number
    readonly validRoiObservations: number
    readonly wallMaskObservations: number
    readonly objectMaskObservations: number
    readonly uncertainMaskObservations: number
    readonly observedByZeroKeyframes: number
    readonly observedByOneKeyframe: number
    readonly observedByTwoKeyframes: number
    readonly observedByThreeKeyframes: number
    readonly singleUncontestedWallObservations: number
    readonly multiViewWallAgreementSamples: number
  }
  readonly threeDSampleClassifications: Uint8Array
  readonly threeDSampleObservationCounts: Uint8Array
  readonly threeDSampleWallConfidence: Uint8Array
  readonly threeDSampleTerminalReasons: Uint8Array
  /** Directly observed completed-envelope protection, before local expansion. */
  readonly threeDCompletedEnvelopeSampleMask: Uint8Array
  readonly completedEnvelopeSampleCount: number
  readonly wallLocalPreservedObjectFusion: WallLocalPreservedObjectFusion | null
  readonly realityWallDomain: RealityWallDomainAnalysis
  readonly geometryForeground: GeometryForegroundAnalysis
}

export interface VisibleWallMaskResult {
  readonly provider: 'geometric-rgb'
  readonly sampleLogicalSurfaceIndices: Int32Array
  readonly sampleConfidence: Uint8Array
  readonly surfaces: readonly VisibleWallMaskSurfaceResult[]
  readonly preparationMs: number
  readonly projectionMs: number
  readonly maskMs: number
  readonly componentAnalysisMs: number
  readonly secondaryExpansionMs: number
  readonly fragmentExtractionMs: number
  readonly componentMergeMs: number
  readonly enclosureAnalysisMs: number
  readonly clusterFormationMs: number
  readonly outerBoundaryAnalysisMs: number
  readonly gapCompletionMs: number
  readonly interiorFillMs: number
  readonly wallLocalFusionMs: number
  readonly objectProjectionMs: number
  readonly wallDomainMs: number
  readonly geometryForegroundMs: number
  readonly memoryBytes: number
}

export interface VisibleWallMaskProvider {
  build(surfels: readonly FinalizedRealitySurfel[], table: RealityStructuralAssociationTable, keyframes: FinalizedRealityRgbKeyframes): VisibleWallMaskResult | null
}

const MAX_KEYFRAMES_PER_SURFACE = 3
const EPSILON = 1e-8
// Paint only high-confidence visual wall continuation. Ambiguous pixels stay
// original, while enclosed divergent regions become preserved object evidence.
const WALL_GROWTH_CHROMA_DISTANCE = 0.105
const WALL_GROWTH_LUMINANCE_DISTANCE = 0.22
const WALL_LOCAL_EDGE_CHROMA_DISTANCE = 0.065
const WALL_LOCAL_EDGE_LUMINANCE_DISTANCE = 0.13
const STRONG_OBJECT_CHROMA_DISTANCE = 0.28
const STRONG_OBJECT_LUMINANCE_DISTANCE = 0.55
const ENCLOSED_OBJECT_MIN_PIXELS = 4
const ENCLOSED_OBJECT_BOUNDARY_CHROMA_DISTANCE = 0.055
const ENCLOSED_OBJECT_BOUNDARY_LUMINANCE_DISTANCE = 0.10
const COMPONENT_EDGE_CHROMA_DISTANCE = 0.07
const COMPONENT_EDGE_LUMINANCE_DISTANCE = 0.14
const SECONDARY_WALL_CHROMA_DISTANCE = 0.17
const SECONDARY_WALL_LUMINANCE_DISTANCE = 0.34
const MIN_LOCAL_WALL_OBSERVATION_CONFIDENCE = 0.58
const MAX_OBJECT_FRAGMENT_MERGE_GAP_PIXELS = 8
const OBJECT_REGION_MIN_RAW_PIXELS = 4
const OBJECT_REGION_MIN_DENSITY = 0.045
const OBJECT_REGION_MAX_ROI_FRACTION = 0.42
const OBJECT_PROTECTION_BAND_PIXELS = 1
const WALL_LOCAL_CELL_METERS = 0.03
const WALL_LOCAL_MAX_AXIS_CELLS = 96
const WALL_LOCAL_OBJECT_MERGE_CELLS = 2
// This is deliberately larger than the M8.6.4 fragment bridge: it is only
// reached after two independently accepted regions demonstrate one aligned
// outer enclosure, which is the black/gold painting failure this stage fixes.
const OUTER_OBJECT_MAX_HORIZONTAL_GAP_RATIO = 0.34
const OUTER_OBJECT_MAX_HORIZONTAL_GAP_PIXELS = 28
const OUTER_OBJECT_MIN_VERTICAL_OVERLAP = 0.42
const OUTER_OBJECT_MIN_MEMBER_REGIONS = 2
const OUTER_OBJECT_MIN_CLOSURE_SCORE = 0.32
const OUTER_OBJECT_MAX_ROI_FRACTION = 0.45
const FOREGROUND_GRID_CELL_METERS = 0.06
const FOREGROUND_NEIGHBOR_RADIUS_METERS = 0.075
const FOREGROUND_MAX_NEIGHBORS = 20
const FOREGROUND_MIN_COMPONENT_SUPPORT = 2
const FOREGROUND_MIN_WALL_ENVELOPE_METERS = 0.025
const FOREGROUND_MAX_WALL_ENVELOPE_METERS = 0.06
const FOREGROUND_NORMAL_DEVIATION_DEGREES = 28
const FOREGROUND_ROUGHNESS_METERS = 0.014
const FOREGROUND_DEPTH_STEP_METERS = 0.028
const FOREGROUND_COMPONENT_MAX_GEODESIC_METERS = 0.45
const FOREGROUND_SIDE_MINIMUM_SUPPORT = 4
const STRONG_WALL_BARRIER_NEIGHBORS = 3
const WALL_DOMAIN_NEIGHBOR_RADIUS_METERS = 0.09
const WALL_DOMAIN_MAX_NEIGHBORS = 24
const WALL_DOMAIN_MIN_PLANE_ENVELOPE_METERS = 0.055
const WALL_DOMAIN_MAX_PLANE_ENVELOPE_METERS = 0.12
const WALL_DOMAIN_MAX_EXTENSION_METERS = 0.55

function timestamp(): number { return typeof performance === 'undefined' ? Date.now() : performance.now() }

function project(point: SpatialPoint, frame: RealityRgbKeyframe, target: { u: number; v: number }): boolean {
  const matrix = frame.inverseCameraTransform
  const x = matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12]
  const y = matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13]
  const z = matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14]
  const w = matrix[3] * point.x + matrix[7] * point.y + matrix[11] * point.z + matrix[15]
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(w) || z >= 0) return false
  const projection = frame.projectionMatrix
  const clipX = projection[0] * x + projection[4] * y + projection[8] * z + projection[12]
  const clipY = projection[1] * x + projection[5] * y + projection[9] * z + projection[13]
  const clipW = projection[3] * x + projection[7] * y + projection[11] * z + projection[15]
  if (!Number.isFinite(clipX) || !Number.isFinite(clipY) || !Number.isFinite(clipW) || clipW <= EPSILON) return false
  target.u = (clipX / clipW + 1) / 2
  target.v = (1 - clipY / clipW) / 2
  return Number.isFinite(target.u) && Number.isFinite(target.v) && target.u >= 0 && target.u <= 1 && target.v >= 0 && target.v <= 1
}

/** Shared M8.2/M8.6 world-to-camera projection and copy mapping for diagnostics. */
export function projectWorldPointToKeyframePixel(point: SpatialPoint, frame: RealityRgbKeyframe, target: { x: number; y: number }): boolean {
  const projection = { u: 0, v: 0 }
  return project(point, frame, projection) && mapCameraUvToCopyPixelInto(frame.mapping, projection.u, projection.v, target)
}

/** Continuous pixel-centre coordinates for texture projection, not RGB lookup. */
export function projectWorldPointToKeyframeSubpixel(point: SpatialPoint, frame: RealityRgbKeyframe, target: { x: number; y: number }): boolean {
  const projection = { u: 0, v: 0 }
  return project(point, frame, projection) && mapCameraUvToCopyPixelInto(frame.mapping, projection.u, projection.v, target, false)
}

function rgb(frame: RealityRgbKeyframe, x: number, y: number): [number, number, number] {
  const offset = (y * frame.width + x) * 3
  return [frame.rgb[offset] / 255, frame.rgb[offset + 1] / 255, frame.rgb[offset + 2] / 255]
}

function chromaDistance(first: readonly number[], second: readonly number[]): number {
  const firstSum = Math.max(EPSILON, first[0] + first[1] + first[2]), secondSum = Math.max(EPSILON, second[0] + second[1] + second[2])
  return Math.hypot(first[0] / firstSum - second[0] / secondSum, first[1] / firstSum - second[1] / secondSum, first[2] / firstSum - second[2] / secondSum)
}

function luminance(value: readonly number[]): number { return value[0] * 0.2126 + value[1] * 0.7152 + value[2] * 0.0722 }

function surfaceVertices(table: RealityStructuralAssociationTable, logicalIndex: number): SpatialPoint[] {
  const logical = table.logicalSurfaces[logicalIndex], result: SpatialPoint[] = []
  for (const id of logical.memberPatchIds) {
    const patch = table.patches.find((candidate) => candidate.id === id)
    if (patch) result.push(...patch.vertices3D)
  }
  return result
}

function roiFor(frame: RealityRgbKeyframe, points: readonly SpatialPoint[]): { x: number; y: number; width: number; height: number; area: number } | null {
  const projection = { u: 0, v: 0 }
  let minX = frame.width, minY = frame.height, maxX = -1, maxY = -1
  for (const point of points) {
    if (!project(point, frame, projection)) continue
    const pixel = { x: 0, y: 0 }
    if (!mapCameraUvToCopyPixelInto(frame.mapping, projection.u, projection.v, pixel)) continue
    minX = Math.min(minX, pixel.x); minY = Math.min(minY, pixel.y); maxX = Math.max(maxX, pixel.x); maxY = Math.max(maxY, pixel.y)
  }
  if (maxX < minX || maxY < minY) return null
  const padding = 3
  minX = Math.max(0, minX - padding); minY = Math.max(0, minY - padding); maxX = Math.min(frame.width - 1, maxX + padding); maxY = Math.min(frame.height - 1, maxY + padding)
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area: (maxX - minX + 1) * (maxY - minY + 1) }
}

function forEachRoiNeighbor(x: number, y: number, roi: { x: number; y: number; width: number; height: number }, visit: (x: number, y: number) => void): void {
  if (x > roi.x) visit(x - 1, y)
  if (x + 1 < roi.x + roi.width) visit(x + 1, y)
  if (y > roi.y) visit(x, y - 1)
  if (y + 1 < roi.y + roi.height) visit(x, y + 1)
}

function visualEdge(first: readonly number[], second: readonly number[]): boolean {
  return chromaDistance(first, second) > COMPONENT_EDGE_CHROMA_DISTANCE ||
    Math.abs(luminance(first) - luminance(second)) > COMPONENT_EDGE_LUMINANCE_DISTANCE
}

function pixelInsideRoi(pixel: { x: number; y: number }, roi: { x: number; y: number; width: number; height: number }): boolean {
  return pixel.x >= roi.x && pixel.x < roi.x + roi.width && pixel.y >= roi.y && pixel.y < roi.y + roi.height
}

function localWallObservationConfidence(
  surfel: FinalizedRealitySurfel,
  frame: RealityRgbKeyframe,
  mask: VisibleWallMaskKeyframe,
  pixel: { x: number; y: number },
): number {
  const evidence = mask.evidence[pixel.y * frame.width + pixel.x]
  const evidenceStrength = evidence === VisibleWallMaskEvidenceCode.STRUCTURAL_SEED ? 1
    : evidence === VisibleWallMaskEvidenceCode.CONSISTENT_WALL_GROWTH ? 0.92
      : evidence === VisibleWallMaskEvidenceCode.SECONDARY_WALL_EXPANSION ? 0.76 : 0.7
  const edgeDistance = Math.min(pixel.x - mask.roi.x, mask.roi.x + mask.roi.width - 1 - pixel.x, pixel.y - mask.roi.y, mask.roi.y + mask.roi.height - 1 - pixel.y)
  const edgeConfidence = 0.85 + 0.15 * Math.min(1, Math.max(0, edgeDistance) / 3)
  const camera = frame.cameraTransform
  const dx = camera[12] - surfel.position.x, dy = camera[13] - surfel.position.y, dz = camera[14] - surfel.position.z
  const distance = Math.hypot(dx, dy, dz)
  const facing = distance > EPSILON ? Math.abs((surfel.normal.x * dx + surfel.normal.y * dy + surfel.normal.z * dz) / distance) : 1
  const facingConfidence = 0.86 + 0.14 * Math.min(1, facing)
  const distanceConfidence = distance <= 4 ? 1 : Math.max(0.86, 1 - (distance - 4) * 0.035)
  // Whole-frame quality only modulates a locally valid observation; it never
  // invalidates a well-projected wall pixel by itself.
  const frameConfidence = 0.9 + 0.1 * Math.max(0, Math.min(1, frame.qualityScore))
  return evidenceStrength * edgeConfidence * facingConfidence * distanceConfidence * frameConfidence
}

interface UncertainRegion {
  readonly pixels: readonly number[]
  readonly touchesRoiBoundary: boolean
  readonly wallBoundaryCount: number
  readonly objectBoundaryCount: number
  readonly boundaryChroma: number
  readonly boundaryLuminance: number
  readonly meanColor: readonly number[]
}

function collectUncertainRegions(
  frame: RealityRgbKeyframe,
  roi: { x: number; y: number; width: number; height: number },
  mask: Uint8Array,
): UncertainRegion[] {
  const visited = new Uint8Array(mask.length), queue: number[] = [], component: number[] = []
  const regions: UncertainRegion[] = []
  for (let y = roi.y; y < roi.y + roi.height; y++) for (let x = roi.x; x < roi.x + roi.width; x++) {
    const start = y * frame.width + x
    if (visited[start] || mask[start] !== VisibleWallMaskCode.UNCERTAIN) continue
    queue.length = 0; component.length = 0; queue.push(start); visited[start] = 1
    let touchesRoiBoundary = false, wallBoundaryCount = 0, objectBoundaryCount = 0, chromaSum = 0, luminanceSum = 0
    const colorSum = [0, 0, 0]
    while (queue.length > 0) {
      const current = queue.pop() as number, currentX = current % frame.width, currentY = Math.floor(current / frame.width)
      component.push(current)
      if (currentX === roi.x || currentX === roi.x + roi.width - 1 || currentY === roi.y || currentY === roi.y + roi.height - 1) touchesRoiBoundary = true
      const currentColor = rgb(frame, currentX, currentY)
      colorSum[0] += currentColor[0]; colorSum[1] += currentColor[1]; colorSum[2] += currentColor[2]
      forEachRoiNeighbor(currentX, currentY, roi, (nextX, nextY) => {
        const next = nextY * frame.width + nextX
        if (mask[next] === VisibleWallMaskCode.UNCERTAIN && !visited[next] && !visualEdge(currentColor, rgb(frame, nextX, nextY))) { visited[next] = 1; queue.push(next) }
        if (mask[next] === VisibleWallMaskCode.WALL) {
          const neighborColor = rgb(frame, nextX, nextY)
          chromaSum += chromaDistance(currentColor, neighborColor)
          luminanceSum += Math.abs(luminance(currentColor) - luminance(neighborColor))
          wallBoundaryCount++
        }
        else if (mask[next] === VisibleWallMaskCode.NON_WALL) objectBoundaryCount++
      })
    }
    regions.push({
      pixels: [...component],
      touchesRoiBoundary,
      wallBoundaryCount,
      objectBoundaryCount,
      boundaryChroma: wallBoundaryCount > 0 ? chromaSum / wallBoundaryCount : 0,
      boundaryLuminance: wallBoundaryCount > 0 ? luminanceSum / wallBoundaryCount : 0,
      meanColor: [colorSum[0] / component.length, colorSum[1] / component.length, colorSum[2] / component.length],
    })
  }
  return regions
}

function expandWallLikeUncertainRegions(
  frame: RealityRgbKeyframe,
  roi: { x: number; y: number; width: number; height: number },
  mask: Uint8Array,
  evidence: Uint8Array,
  terminalReasons: Uint8Array,
  wallMean: readonly number[],
): void {
  for (const region of collectUncertainRegions(frame, roi, mask)) {
    const chroma = chromaDistance(region.meanColor, wallMean)
    const luma = Math.abs(luminance(region.meanColor) - luminance(wallMean))
    // A broad smooth wall/shadow region has confirmed wall contact, no object
    // contact, and remains broadly wall-coloured. It can bridge around a
    // protected island but never cross a high-gradient island boundary.
    const likelyWall = region.wallBoundaryCount >= 2 && region.objectBoundaryCount === 0 &&
      chroma <= SECONDARY_WALL_CHROMA_DISTANCE && luma <= SECONDARY_WALL_LUMINANCE_DISTANCE &&
      region.boundaryChroma < COMPONENT_EDGE_CHROMA_DISTANCE && region.boundaryLuminance < COMPONENT_EDGE_LUMINANCE_DISTANCE
    if (likelyWall) {
      for (const pixel of region.pixels) {
        mask[pixel] = VisibleWallMaskCode.WALL
        evidence[pixel] = VisibleWallMaskEvidenceCode.SECONDARY_WALL_EXPANSION
        terminalReasons[pixel] = VisibleWallMaskTerminalReason.NONE
      }
    }
  }
}

function preserveEnclosedVisualObjects(
  frame: RealityRgbKeyframe,
  roi: { x: number; y: number; width: number; height: number },
  mask: Uint8Array,
  evidence: Uint8Array,
  terminalReasons: Uint8Array,
  wallMean: readonly number[],
): PreservedVisualIsland[] {
  const islands: PreservedVisualIsland[] = []
  for (const region of collectUncertainRegions(frame, roi, mask)) {
    const totalBoundary = Math.max(1, region.wallBoundaryCount + region.objectBoundaryCount)
    const wallSurroundScore = region.wallBoundaryCount / totalBoundary
    const boundaryClosureScore = region.wallBoundaryCount / Math.max(1, region.wallBoundaryCount + (region.touchesRoiBoundary ? region.pixels.length : 0))
    const distinctFromWall = chromaDistance(region.meanColor, wallMean) >= ENCLOSED_OBJECT_BOUNDARY_CHROMA_DISTANCE ||
      Math.abs(luminance(region.meanColor) - luminance(wallMean)) >= ENCLOSED_OBJECT_BOUNDARY_LUMINANCE_DISTANCE
    const boundedObject = !region.touchesRoiBoundary && region.pixels.length >= ENCLOSED_OBJECT_MIN_PIXELS &&
      region.wallBoundaryCount >= 2 && wallSurroundScore >= 0.5 && distinctFromWall &&
      (region.boundaryChroma >= ENCLOSED_OBJECT_BOUNDARY_CHROMA_DISTANCE || region.boundaryLuminance >= ENCLOSED_OBJECT_BOUNDARY_LUMINANCE_DISTANCE)
    if (boundedObject) {
      for (const pixel of region.pixels) {
        mask[pixel] = VisibleWallMaskCode.NON_WALL
        evidence[pixel] = VisibleWallMaskEvidenceCode.ENCLOSED_VISUAL_OBJECT
        terminalReasons[pixel] = VisibleWallMaskTerminalReason.ENCLOSED_REGION
      }
      islands.push({ pixelCount: region.pixels.length, boundaryClosureScore, wallSurroundScore })
      continue
    }
    const terminal = region.objectBoundaryCount > 0
      ? VisibleWallMaskTerminalReason.OBJECT_BOUNDARY
      : region.wallBoundaryCount < 2
        ? VisibleWallMaskTerminalReason.INSUFFICIENT_NEIGHBOR_SUPPORT
        : region.boundaryChroma >= COMPONENT_EDGE_CHROMA_DISTANCE || region.boundaryLuminance >= COMPONENT_EDGE_LUMINANCE_DISTANCE
          ? VisibleWallMaskTerminalReason.STRONG_GRADIENT_BOUNDARY
          : VisibleWallMaskTerminalReason.LOCAL_CONTINUITY_BREAK
    for (const pixel of region.pixels) {
      evidence[pixel] = VisibleWallMaskEvidenceCode.UNCERTAIN
      terminalReasons[pixel] = terminal
    }
  }
  return islands
}

interface ObjectPixelComponent {
  readonly pixels: readonly number[]
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

function collectActivePixelComponents(active: Uint8Array, frame: RealityRgbKeyframe, roi: { x: number; y: number; width: number; height: number }): ObjectPixelComponent[] {
  const visited = new Uint8Array(active.length), queue: number[] = [], pixels: number[] = [], components: ObjectPixelComponent[] = []
  for (let y = roi.y; y < roi.y + roi.height; y++) for (let x = roi.x; x < roi.x + roi.width; x++) {
    const start = y * frame.width + x
    if (!active[start] || visited[start]) continue
    let minX = x, minY = y, maxX = x, maxY = y
    queue.length = 0; pixels.length = 0; queue.push(start); visited[start] = 1
    while (queue.length) {
      const current = queue.pop() as number, currentX = current % frame.width, currentY = Math.floor(current / frame.width)
      pixels.push(current); minX = Math.min(minX, currentX); minY = Math.min(minY, currentY); maxX = Math.max(maxX, currentX); maxY = Math.max(maxY, currentY)
      forEachRoiNeighbor(currentX, currentY, roi, (nextX, nextY) => {
        const next = nextY * frame.width + nextX
        if (active[next] && !visited[next]) { visited[next] = 1; queue.push(next) }
      })
    }
    components.push({ pixels: [...pixels], minX, minY, maxX, maxY })
  }
  return components
}

function wallSurroundForBox(mask: Uint8Array, frame: RealityRgbKeyframe, roi: { x: number; y: number; width: number; height: number }, minX: number, minY: number, maxX: number, maxY: number): number {
  let wall = 0, total = 0
  const startX = Math.max(roi.x, minX - 1), endX = Math.min(roi.x + roi.width - 1, maxX + 1)
  const startY = Math.max(roi.y, minY - 1), endY = Math.min(roi.y + roi.height - 1, maxY + 1)
  for (let x = startX; x <= endX; x++) for (const y of [startY, endY]) {
    total++; if (mask[y * frame.width + x] === VisibleWallMaskCode.WALL) wall++
  }
  for (let y = startY + 1; y < endY; y++) for (const x of [startX, endX]) {
    total++; if (mask[y * frame.width + x] === VisibleWallMaskCode.WALL) wall++
  }
  return wall / Math.max(1, total)
}

function consolidatePreservedObjectRegions(
  frame: RealityRgbKeyframe,
  roi: { x: number; y: number; width: number; height: number },
  mask: Uint8Array,
  evidence: Uint8Array,
  terminalReasons: Uint8Array,
  wallMean: readonly number[],
): { rawFragmentPixelCount: number; rawFragmentCount: number; rawFragmentPixels: Uint32Array; regions: readonly PreservedVisualRegion[]; fragmentExtractionMs: number; componentMergeMs: number; enclosureAnalysisMs: number } {
  const extractionStarted = timestamp()
  const raw = new Uint8Array(mask.length)
  let rawPixelCount = 0
  for (let y = roi.y; y < roi.y + roi.height; y++) for (let x = roi.x; x < roi.x + roi.width; x++) {
    const index = y * frame.width + x
    if (mask[index] === VisibleWallMaskCode.NON_WALL) { raw[index] = 1; rawPixelCount++ }
  }
  const rawFragments = collectActivePixelComponents(raw, frame, roi)
  const fragmentExtractionMs = timestamp() - extractionStarted
  if (rawPixelCount === 0) return { rawFragmentPixelCount: 0, rawFragmentCount: 0, rawFragmentPixels: new Uint32Array(), regions: [], fragmentExtractionMs, componentMergeMs: 0, enclosureAnalysisMs: 0 }
  const mergeStarted = timestamp()
  const bridged = new Uint8Array(mask.length)
  const mergeGap = Math.min(MAX_OBJECT_FRAGMENT_MERGE_GAP_PIXELS, Math.max(3, Math.round(Math.min(roi.width, roi.height) * 0.12)))
  for (let y = roi.y; y < roi.y + roi.height; y++) for (let x = roi.x; x < roi.x + roi.width; x++) {
    if (!raw[y * frame.width + x]) continue
    for (let offsetY = -mergeGap; offsetY <= mergeGap; offsetY++) for (let offsetX = -mergeGap; offsetX <= mergeGap; offsetX++) {
      if (offsetX * offsetX + offsetY * offsetY > mergeGap * mergeGap) continue
      const targetX = x + offsetX, targetY = y + offsetY
      if (targetX >= roi.x && targetX < roi.x + roi.width && targetY >= roi.y && targetY < roi.y + roi.height) bridged[targetY * frame.width + targetX] = 1
    }
  }
  const mergedComponents = collectActivePixelComponents(bridged, frame, roi)
  const componentMergeMs = timestamp() - mergeStarted
  const enclosureStarted = timestamp()
  const regions: PreservedVisualRegion[] = []
  for (const component of mergedComponents) {
    const rawPixels = component.pixels.filter((pixel) => raw[pixel])
    const rawMinX = Math.min(...rawPixels.map((pixel) => pixel % frame.width)), rawMaxX = Math.max(...rawPixels.map((pixel) => pixel % frame.width))
    const rawMinY = Math.min(...rawPixels.map((pixel) => Math.floor(pixel / frame.width))), rawMaxY = Math.max(...rawPixels.map((pixel) => Math.floor(pixel / frame.width)))
    const boxWidth = rawMaxX - rawMinX + 1, boxHeight = rawMaxY - rawMinY + 1, boxArea = boxWidth * boxHeight
    const touchesRoi = rawMinX <= roi.x || rawMaxX >= roi.x + roi.width - 1 || rawMinY <= roi.y || rawMaxY >= roi.y + roi.height - 1
    const surround = wallSurroundForBox(mask, frame, roi, rawMinX, rawMinY, rawMaxX, rawMaxY)
    const mean = [0, 0, 0]
    for (const pixel of rawPixels) {
      const color = rgb(frame, pixel % frame.width, Math.floor(pixel / frame.width))
      mean[0] += color[0]; mean[1] += color[1]; mean[2] += color[2]
    }
    mean[0] /= Math.max(1, rawPixels.length); mean[1] /= Math.max(1, rawPixels.length); mean[2] /= Math.max(1, rawPixels.length)
    const distinctness = Math.max(chromaDistance(mean, wallMean), Math.abs(luminance(mean) - luminance(wallMean)))
    const density = rawPixels.length / Math.max(1, boxArea)
    const enclosure = surround * (touchesRoi ? 0.25 : 1)
    const accepted = !touchesRoi && rawPixels.length >= OBJECT_REGION_MIN_RAW_PIXELS && density >= OBJECT_REGION_MIN_DENSITY &&
      boxArea <= roi.width * roi.height * OBJECT_REGION_MAX_ROI_FRACTION && surround >= 0.24 && distinctness >= ENCLOSED_OBJECT_BOUNDARY_CHROMA_DISTANCE
    if (!accepted) continue
    // A one-pixel boundary band prevents paint bleed at the production
    // keyframe scale. In intentionally tiny ROIs it would cover too much
    // physical wall, so keep the band resolution-aware.
    const protectionBand = Math.min(OBJECT_PROTECTION_BAND_PIXELS, Math.floor(Math.min(roi.width, roi.height) / 24))
    const protectedPixels: number[] = []
    for (let y = Math.max(roi.y, rawMinY - protectionBand); y <= Math.min(roi.y + roi.height - 1, rawMaxY + protectionBand); y++) {
      for (let x = Math.max(roi.x, rawMinX - protectionBand); x <= Math.min(roi.x + roi.width - 1, rawMaxX + protectionBand); x++) {
        const pixel = y * frame.width + x
        mask[pixel] = VisibleWallMaskCode.NON_WALL
        evidence[pixel] = VisibleWallMaskEvidenceCode.ENCLOSED_VISUAL_OBJECT
        terminalReasons[pixel] = VisibleWallMaskTerminalReason.ENCLOSED_REGION
        protectedPixels.push(pixel)
      }
    }
    regions.push({
      id: `preserved-${frame.id}-${regions.length + 1}`,
      sourceKeyframeId: frame.id,
      pixelIndices: new Uint32Array(protectedPixels),
      boundingBox: { x: rawMinX, y: rawMinY, width: boxWidth, height: boxHeight },
      rawFragmentPixelCount: rawPixels.length,
      enclosureScore: enclosure,
      wallSurroundScore: surround,
      appearanceDistinctness: distinctness,
      confidence: Math.min(1, 0.35 + surround * 0.35 + Math.min(0.3, density)),
    })
  }
  const rawFragmentPixels = new Uint32Array(rawPixelCount)
  let rawIndex = 0
  for (let pixel = 0; pixel < raw.length; pixel++) if (raw[pixel]) rawFragmentPixels[rawIndex++] = pixel
  return { rawFragmentPixelCount: rawPixelCount, rawFragmentCount: rawFragments.length, rawFragmentPixels, regions, fragmentExtractionMs, componentMergeMs, enclosureAnalysisMs: timestamp() - enclosureStarted }
}

function overlapLength(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart) + 1)
}

function horizontalGap(left: PreservedVisualRegion, right: PreservedVisualRegion): number {
  const leftEnd = left.boundingBox.x + left.boundingBox.width - 1, rightEnd = right.boundingBox.x + right.boundingBox.width - 1
  return Math.max(0, Math.max(left.boundingBox.x, right.boundingBox.x) - Math.min(leftEnd, rightEnd) - 1)
}

function alignedObjectRegions(left: PreservedVisualRegion, right: PreservedVisualRegion, roi: { width: number }): boolean {
  const leftBottom = left.boundingBox.y + left.boundingBox.height - 1, rightBottom = right.boundingBox.y + right.boundingBox.height - 1
  const verticalOverlap = overlapLength(left.boundingBox.y, leftBottom, right.boundingBox.y, rightBottom)
  const sharedHeight = Math.max(1, Math.min(left.boundingBox.height, right.boundingBox.height))
  const maximumGap = Math.min(OUTER_OBJECT_MAX_HORIZONTAL_GAP_PIXELS, Math.max(4, Math.round(roi.width * OUTER_OBJECT_MAX_HORIZONTAL_GAP_RATIO)))
  return verticalOverlap / sharedHeight >= OUTER_OBJECT_MIN_VERTICAL_OVERLAP && horizontalGap(left, right) <= maximumGap
}

function outerSideSupport(
  frame: RealityRgbKeyframe,
  roi: { x: number; y: number; width: number; height: number },
  mask: Uint8Array,
  box: { x: number; y: number; width: number; height: number },
  side: 'top' | 'right' | 'bottom' | 'left',
): number {
  let supporting = 0, total = 0
  const xEnd = box.x + box.width - 1, yEnd = box.y + box.height - 1
  const evaluate = (insideX: number, insideY: number, outsideX: number, outsideY: number): void => {
    if (outsideX < roi.x || outsideX >= roi.x + roi.width || outsideY < roi.y || outsideY >= roi.y + roi.height) return
    total++
    const outsideWall = mask[outsideY * frame.width + outsideX] === VisibleWallMaskCode.WALL
    const inside = rgb(frame, insideX, insideY), outside = rgb(frame, outsideX, outsideY)
    const contrast = chromaDistance(inside, outside) >= ENCLOSED_OBJECT_BOUNDARY_CHROMA_DISTANCE || Math.abs(luminance(inside) - luminance(outside)) >= ENCLOSED_OBJECT_BOUNDARY_LUMINANCE_DISTANCE
    if (outsideWall || contrast) supporting++
  }
  if (side === 'top') for (let x = box.x; x <= xEnd; x++) evaluate(x, box.y, x, box.y - 1)
  else if (side === 'bottom') for (let x = box.x; x <= xEnd; x++) evaluate(x, yEnd, x, yEnd + 1)
  else if (side === 'left') for (let y = box.y; y <= yEnd; y++) evaluate(box.x, y, box.x - 1, y)
  else for (let y = box.y; y <= yEnd; y++) evaluate(xEnd, y, xEnd + 1, y)
  return supporting / Math.max(1, total)
}

function pointInsideContour(x: number, y: number, contour: readonly { x: number; y: number }[]): boolean {
  let inside = false
  for (let current = 0, previous = contour.length - 1; current < contour.length; previous = current++) {
    const a = contour[current], b = contour[previous]
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * Completes the outer envelope of a framed visual object after M8.6.4 has
 * already established its conservative member regions. It deliberately uses
 * only their spatial alignment plus exterior wall/edge evidence: black, gold,
 * glare, and other internal painting texture never participate in a new wall
 * decision once the common enclosure has been accepted.
 */
function completePreservedObjectOuterBoundaries(
  frame: RealityRgbKeyframe,
  roi: { x: number; y: number; width: number; height: number },
  mask: Uint8Array,
  regions: readonly PreservedVisualRegion[],
): { clusters: readonly PreservedVisualObjectCluster[]; clusterFormationMs: number; outerBoundaryAnalysisMs: number; gapCompletionMs: number; interiorFillMs: number } {
  const formationStarted = timestamp()
  const parent = regions.map((_region, index) => index)
  const root = (index: number): number => {
    let current = index
    while (parent[current] !== current) { parent[current] = parent[parent[current]]; current = parent[current] }
    return current
  }
  const join = (left: number, right: number): void => { const leftRoot = root(left), rightRoot = root(right); if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot }
  for (let left = 0; left < regions.length; left++) for (let right = left + 1; right < regions.length; right++) if (alignedObjectRegions(regions[left], regions[right], roi)) join(left, right)
  const groups = new Map<number, PreservedVisualRegion[]>()
  for (let index = 0; index < regions.length; index++) { const key = root(index), group = groups.get(key) ?? []; group.push(regions[index]); groups.set(key, group) }
  const clusterFormationMs = timestamp() - formationStarted
  const boundaryStarted = timestamp(), clusters: PreservedVisualObjectCluster[] = []
  let gapCompletionMs = 0, interiorFillMs = 0
  for (const members of groups.values()) {
    if (members.length < OUTER_OBJECT_MIN_MEMBER_REGIONS) continue
    const minX = Math.min(...members.map((region) => region.boundingBox.x)), minY = Math.min(...members.map((region) => region.boundingBox.y))
    const maxX = Math.max(...members.map((region) => region.boundingBox.x + region.boundingBox.width - 1)), maxY = Math.max(...members.map((region) => region.boundingBox.y + region.boundingBox.height - 1))
    const box = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    const orderedByX = [...members].sort((left, right) => left.boundingBox.x + left.boundingBox.width / 2 - (right.boundingBox.x + right.boundingBox.width / 2))
    const leftEdge = orderedByX[0], rightEdge = orderedByX[orderedByX.length - 1]
    // The outer image enclosure may be a trapezoid under camera perspective.
    // Its vertices still originate only from accepted object regions; it is not
    // a projection of the M7 wall rectangle.
    const outerContour = [
      { x: minX, y: leftEdge.boundingBox.y },
      { x: maxX, y: rightEdge.boundingBox.y },
      { x: maxX, y: rightEdge.boundingBox.y + rightEdge.boundingBox.height - 1 },
      { x: minX, y: leftEdge.boundingBox.y + leftEdge.boundingBox.height - 1 },
    ]
    const boxArea = box.width * box.height, memberAreaPixels = members.reduce((sum, region) => sum + region.pixelIndices.length, 0)
    const touchesRoi = minX <= roi.x || maxX >= roi.x + roi.width - 1 || minY <= roi.y || maxY >= roi.y + roi.height - 1
    const boundarySupport = {
      top: outerSideSupport(frame, roi, mask, box, 'top'), right: outerSideSupport(frame, roi, mask, box, 'right'),
      bottom: outerSideSupport(frame, roi, mask, box, 'bottom'), left: outerSideSupport(frame, roi, mask, box, 'left'),
    }
    const sideValues = Object.values(boundarySupport), closureScore = sideValues.reduce((sum, value) => sum + value, 0) / sideValues.length
    const sideCount = sideValues.filter((value) => value >= 0.22).length
    const surround = wallSurroundForBox(mask, frame, roi, minX, minY, maxX, maxY)
    let largestGap = 0
    for (let left = 0; left < members.length; left++) for (let right = left + 1; right < members.length; right++) largestGap = Math.max(largestGap, horizontalGap(members[left], members[right]))
    const inferredBoundarySections = (Object.entries(boundarySupport) as [string, number][]).filter(([, value]) => value < 0.22).map(([side]) => side)
    const accepted = !touchesRoi && boxArea <= roi.width * roi.height * OUTER_OBJECT_MAX_ROI_FRACTION && surround >= 0.24 && closureScore >= OUTER_OBJECT_MIN_CLOSURE_SCORE && sideCount >= 3
    const rejectionReason = accepted ? null : touchesRoi ? 'touches ROI boundary' : boxArea > roi.width * roi.height * OUTER_OBJECT_MAX_ROI_FRACTION ? 'outer envelope too large' : surround < 0.24 ? 'insufficient surrounding wall' : closureScore < OUTER_OBJECT_MIN_CLOSURE_SCORE ? 'weak outer boundary' : 'fewer than three supported sides'
    const gapStarted = timestamp(), protectedPixels: number[] = []
    const protectionBand = Math.min(OBJECT_PROTECTION_BAND_PIXELS, Math.floor(Math.min(roi.width, roi.height) / 24))
    let boundaryBandPixelCount = 0
    if (accepted) for (let y = Math.max(roi.y, minY - protectionBand); y <= Math.min(roi.y + roi.height - 1, maxY + protectionBand); y++) for (let x = Math.max(roi.x, minX - protectionBand); x <= Math.min(roi.x + roi.width - 1, maxX + protectionBand); x++) {
      if (!pointInsideContour(x + 0.5, y + 0.5, outerContour)) continue
      const pixel = y * frame.width + x
      const isBand = x < minX || x > maxX || y < minY || y > maxY
      if (isBand) boundaryBandPixelCount++
      protectedPixels.push(pixel)
    }
    gapCompletionMs += timestamp() - gapStarted
    const confidence = Math.min(1, 0.32 + closureScore * 0.38 + surround * 0.24 + Math.min(0.06, members.length * 0.02))
    clusters.push({
      id: `object-cluster-${frame.id}-${clusters.length + 1}`, sourceKeyframeId: frame.id, memberRegionIds: members.map((region) => region.id), pixelIndices: new Uint32Array(protectedPixels), boundingBox: box,
      centroid: { x: box.x + (box.width - 1) / 2, y: box.y + (box.height - 1) / 2 },
      outerContour,
      memberAreaPixels, filledInteriorPixelCount: protectedPixels.length, boundaryBandPixelCount, wallSurroundScore: surround, boundarySupport, closureScore, largestContourGapPixels: largestGap,
      inferredBoundarySections, confidence, accepted, rejectionReason,
      aspectRatio: Math.max(box.width / Math.max(1, box.height), box.height / Math.max(1, box.width)),
      heightOnWall: 1 - (box.y + box.height / 2 - roi.y) / Math.max(1, roi.height),
      roiEdgeProximity: Math.min(box.x - roi.x, roi.x + roi.width - 1 - maxX, box.y - roi.y, roi.y + roi.height - 1 - maxY) / Math.max(1, Math.min(roi.width, roi.height)),
      depthOffsetMeters: null, depthVarianceMeters: null, crossKeyframeSupport: 0, foregroundPenalty: 0, rankingScore: 0,
      decision: accepted ? 'preserved-non-dominant' : 'rejected',
    })
    interiorFillMs += timestamp() - gapStarted
  }
  return { clusters, clusterFormationMs, outerBoundaryAnalysisMs: timestamp() - boundaryStarted - gapCompletionMs, gapCompletionMs, interiorFillMs }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right), middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle]
}

function clampUnit(value: number): number { return Math.max(0, Math.min(1, value)) }

function normalizedClusterBox(cluster: PreservedVisualObjectCluster, roi: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  return { x: (cluster.boundingBox.x - roi.x) / roi.width, y: (cluster.boundingBox.y - roi.y) / roi.height, width: cluster.boundingBox.width / roi.width, height: cluster.boundingBox.height / roi.height }
}

function crossKeyframeClusterSupport(cluster: PreservedVisualObjectCluster, owner: VisibleWallMaskKeyframe, masks: readonly VisibleWallMaskKeyframe[]): number {
  const source = normalizedClusterBox(cluster, owner.roi)
  let support = 0
  for (const otherMask of masks) {
    if (otherMask.keyframeId === owner.keyframeId) continue
    for (const other of otherMask.preservedVisualObjectClusters) {
      if (!other.accepted) continue
      const target = normalizedClusterBox(other, otherMask.roi)
      const sourceCenterX = source.x + source.width / 2, sourceCenterY = source.y + source.height / 2
      const targetCenterX = target.x + target.width / 2, targetCenterY = target.y + target.height / 2
      const centerDistance = Math.hypot(sourceCenterX - targetCenterX, sourceCenterY - targetCenterY)
      const aspectDifference = Math.abs(Math.log(Math.max(EPSILON, cluster.aspectRatio) / Math.max(EPSILON, other.aspectRatio)))
      if (centerDistance <= 0.24 && aspectDifference <= 0.7) { support++; break }
    }
  }
  // One selected view is meaningful but cannot pretend to be multi-view proof.
  return masks.length <= 1 ? 0.5 : support / Math.max(1, masks.length - 1)
}

function clusterGeometryEvidence(
  cluster: PreservedVisualObjectCluster,
  mask: VisibleWallMaskKeyframe,
  frame: RealityRgbKeyframe,
  surfels: readonly FinalizedRealitySurfel[],
  referencePatch: RealityStructuralAssociationTable['patches'][number] | undefined,
  wallLocalVRange: { min: number; max: number } | null,
): { depthOffsetMeters: number | null; depthVarianceMeters: number | null; foregroundPenalty: number; wallLocalHeight: number | null } {
  if (!referencePatch) return { depthOffsetMeters: null, depthVarianceMeters: null, foregroundPenalty: 0, wallLocalHeight: null }
  const pixels = new Uint8Array(frame.width * frame.height)
  for (const pixel of cluster.pixelIndices) pixels[pixel] = 1
  const offsets: number[] = [], localVs: number[] = [], projected = { x: 0, y: 0 }
  for (const surfel of surfels) {
    if (!projectWorldPointToKeyframePixel(surfel.position, frame, projected) || !pixelInsideRoi(projected, mask.roi) || !pixels[projected.y * frame.width + projected.x]) continue
    const normal = referencePatch.normal
    offsets.push(Math.abs(normal.x * surfel.position.x + normal.y * surfel.position.y + normal.z * surfel.position.z - referencePatch.planeConstant))
    if (wallLocalVRange) localVs.push(wallLocalCoordinate(surfel.position, referencePatch.basis).v)
  }
  const offset = median(offsets)
  if (offset === null) return { depthOffsetMeters: null, depthVarianceMeters: null, foregroundPenalty: 0, wallLocalHeight: null }
  const mean = offsets.reduce((sum, value) => sum + value, 0) / offsets.length
  const variance = Math.sqrt(offsets.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / offsets.length)
  // Calibrated Reality can legitimately sit a few centimetres from M7. Penalize
  // only the larger, more variable offsets typical of shelf/furniture geometry.
  const foregroundPenalty = clampUnit(Math.max(0, offset - 0.045) / 0.09 * 0.72 + Math.max(0, variance - 0.018) / 0.07 * 0.28)
  const localV = median(localVs)
  const wallLocalHeight = localV === null || !wallLocalVRange ? null : clampUnit((localV - wallLocalVRange.min) / Math.max(EPSILON, wallLocalVRange.max - wallLocalVRange.min))
  return { depthOffsetMeters: offset, depthVarianceMeters: variance, foregroundPenalty, wallLocalHeight }
}

function summarizeMask(mask: VisibleWallMaskKeyframe, frame: RealityRgbKeyframe): Pick<VisibleWallMaskKeyframe, 'wallPixelCount' | 'nonWallPixelCount' | 'uncertainPixelCount' | 'seedWallPixelCount' | 'grownWallPixelCount' | 'strongVisualObjectPixelCount' | 'enclosedVisualObjectPixelCount' | 'secondaryExpandedWallPixelCount'> {
  let wall = 0, nonWall = 0, uncertain = 0, seed = 0, grown = 0, strong = 0, enclosed = 0, secondary = 0
  for (let y = mask.roi.y; y < mask.roi.y + mask.roi.height; y++) for (let x = mask.roi.x; x < mask.roi.x + mask.roi.width; x++) {
    const pixel = y * frame.width + x
    const value = mask.mask[pixel], reason = mask.evidence[pixel]
    if (value === VisibleWallMaskCode.WALL) wall++; else if (value === VisibleWallMaskCode.NON_WALL) nonWall++; else uncertain++
    if (reason === VisibleWallMaskEvidenceCode.STRUCTURAL_SEED) seed++
    else if (reason === VisibleWallMaskEvidenceCode.CONSISTENT_WALL_GROWTH) grown++
    else if (reason === VisibleWallMaskEvidenceCode.STRONG_VISUAL_OBJECT) strong++
    else if (reason === VisibleWallMaskEvidenceCode.ENCLOSED_VISUAL_OBJECT) enclosed++
    else if (reason === VisibleWallMaskEvidenceCode.SECONDARY_WALL_EXPANSION) secondary++
  }
  return { wallPixelCount: wall, nonWallPixelCount: nonWall, uncertainPixelCount: uncertain, seedWallPixelCount: seed, grownWallPixelCount: grown, strongVisualObjectPixelCount: strong, enclosedVisualObjectPixelCount: enclosed, secondaryExpandedWallPixelCount: secondary }
}

function rankAndApplyDominantObjectEnvelopes(
  masks: readonly VisibleWallMaskKeyframe[],
  frames: ReadonlyMap<number, RealityRgbKeyframe>,
  surfels: readonly FinalizedRealitySurfel[],
  table: RealityStructuralAssociationTable,
  logicalIndex: number,
): VisibleWallMaskKeyframe[] {
  const logical = table.logicalSurfaces[logicalIndex]
  const referencePatch = logical ? table.patches.find((patch) => logical.memberPatchIds.includes(patch.id)) : undefined
  const localVertices = logical && referencePatch
    ? logical.memberPatchIds.flatMap((id) => table.patches.find((patch) => patch.id === id)?.vertices3D ?? []).map((point) => wallLocalCoordinate(point, referencePatch.basis))
    : []
  const wallLocalVRange = localVertices.length > 0
    ? { min: Math.min(...localVertices.map((point) => point.v)), max: Math.max(...localVertices.map((point) => point.v)) }
    : null
  const ranked = masks.map((mask) => {
    const frame = frames.get(mask.keyframeId)
    if (!frame) return mask
    const clusters = mask.preservedVisualObjectClusters.map((cluster) => {
      if (!cluster.accepted) return { ...cluster, decision: 'rejected' as const }
      const geometry = clusterGeometryEvidence(cluster, mask, frame, surfels, referencePatch, wallLocalVRange)
      const crossKeyframeSupport = crossKeyframeClusterSupport(cluster, mask, masks)
      const areaRatio = cluster.filledInteriorPixelCount / Math.max(1, mask.roi.width * mask.roi.height)
      const areaScore = areaRatio <= 0 || areaRatio > OUTER_OBJECT_MAX_ROI_FRACTION ? 0 : Math.min(1, Math.sqrt(areaRatio / 0.075))
      const aspectScore = cluster.aspectRatio >= 1.1 && cluster.aspectRatio <= 5.5 ? 1 : clampUnit(1 - Math.abs(cluster.aspectRatio - 2.2) / 4.5)
      const upperWallScore = geometry.wallLocalHeight ?? clampUnit(cluster.heightOnWall)
      const edgeMarginScore = clampUnit(cluster.roiEdgeProximity * 10)
      const geometryScore = 1 - geometry.foregroundPenalty
      const rankingScore = clampUnit(
        cluster.closureScore * 0.22 + cluster.wallSurroundScore * 0.22 + areaScore * 0.16 + aspectScore * 0.08 +
        crossKeyframeSupport * 0.13 + upperWallScore * 0.08 + edgeMarginScore * 0.05 + geometryScore * 0.06 - geometry.foregroundPenalty * 0.30,
      )
      const dominant = rankingScore >= 0.48 && geometry.foregroundPenalty < 0.58
      const rankingReason = dominant ? null
        : geometry.foregroundPenalty >= 0.58 ? 'foreground depth/variance penalty'
          : rankingScore < 0.48 ? 'ranked below wall-mounted envelope threshold'
            : 'not a dominant wall-mounted candidate'
      return {
        ...cluster,
        depthOffsetMeters: geometry.depthOffsetMeters,
        depthVarianceMeters: geometry.depthVarianceMeters,
        heightOnWall: geometry.wallLocalHeight ?? cluster.heightOnWall,
        crossKeyframeSupport,
        foregroundPenalty: geometry.foregroundPenalty,
        rankingScore,
        rejectionReason: rankingReason,
        decision: dominant ? 'dominant-wall-mounted' as const : 'preserved-non-dominant' as const,
      }
    })
    const completedObjectEnvelopePixels = new Uint8Array(mask.mask.length)
    for (const cluster of clusters) if (cluster.decision === 'dominant-wall-mounted') for (const pixel of cluster.pixelIndices) {
      mask.mask[pixel] = VisibleWallMaskCode.NON_WALL
      mask.evidence[pixel] = VisibleWallMaskEvidenceCode.ENCLOSED_VISUAL_OBJECT
      mask.terminalReasons[pixel] = VisibleWallMaskTerminalReason.ENCLOSED_REGION
      completedObjectEnvelopePixels[pixel] = 1
    }
    return { ...mask, ...summarizeMask(mask, frame), preservedVisualObjectClusters: clusters, completedObjectEnvelopePixels }
  })
  return ranked
}

function bitCount(value: number): number {
  let count = 0, remaining = value
  while (remaining) { count += remaining & 1; remaining >>>= 1 }
  return count
}

function wallLocalCoordinate(point: SpatialPoint, basis: { origin: SpatialPoint; axisU: SpatialPoint; axisV: SpatialPoint }): { u: number; v: number } {
  const x = point.x - basis.origin.x, y = point.y - basis.origin.y, z = point.z - basis.origin.z
  return { u: x * basis.axisU.x + y * basis.axisU.y + z * basis.axisU.z, v: x * basis.axisV.x + y * basis.axisV.y + z * basis.axisV.z }
}

function pointInsidePatchDomain(point: SpatialPoint, patch: RealityStructuralAssociationTable['patches'][number], edgeToleranceMeters = 0.08): boolean {
  const local = wallLocalCoordinate(point, patch.basis), vertices = patch.vertices2DLocal
  let inside = false
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const a = vertices[index], b = vertices[previous]
    if ((a.v > local.v) !== (b.v > local.v) && local.u < (b.u - a.u) * (local.v - a.v) / Math.max(EPSILON, b.v - a.v) + a.u) inside = !inside
  }
  if (inside) return true
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length], dx = b.u - a.u, dy = b.v - a.v
    const lengthSquared = dx * dx + dy * dy
    const t = Math.max(0, Math.min(1, ((local.u - a.u) * dx + (local.v - a.v) * dy) / Math.max(EPSILON, lengthSquared)))
    if (Math.hypot(local.u - (a.u + dx * t), local.v - (a.v + dy * t)) <= edgeToleranceMeters) return true
  }
  return false
}

function quantile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  const position = clampUnit(fraction) * (ordered.length - 1), lower = Math.floor(position), upper = Math.ceil(position)
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
}

function signedPlaneResidual(point: SpatialPoint, normal: SpatialPoint, planeConstant: number): number {
  return point.x * normal.x + point.y * normal.y + point.z * normal.z - planeConstant
}

function absoluteNormalDeviationDegrees(normal: SpatialPoint | undefined, wallNormal: SpatialPoint): number {
  if (!normal) return 0
  const length = Math.hypot(normal.x, normal.y, normal.z) * Math.hypot(wallNormal.x, wallNormal.y, wallNormal.z)
  if (length <= EPSILON) return 0
  const dot = Math.min(1, Math.max(-1, Math.abs((normal.x * wallNormal.x + normal.y * wallNormal.y + normal.z * wallNormal.z) / length)))
  return Math.acos(dot) * 180 / Math.PI
}

function foregroundGridKey(point: SpatialPoint): string {
  return `${Math.floor(point.x / FOREGROUND_GRID_CELL_METERS)},${Math.floor(point.y / FOREGROUND_GRID_CELL_METERS)},${Math.floor(point.z / FOREGROUND_GRID_CELL_METERS)}`
}

function foregroundNeighbors(
  point: SpatialPoint,
  cells: ReadonlyMap<string, readonly number[]>,
  surfels: readonly FinalizedRealitySurfel[],
): number[] {
  const originX = Math.floor(point.x / FOREGROUND_GRID_CELL_METERS), originY = Math.floor(point.y / FOREGROUND_GRID_CELL_METERS), originZ = Math.floor(point.z / FOREGROUND_GRID_CELL_METERS)
  const candidates: Array<{ index: number; distanceSquared: number }> = []
  const radiusSquared = FOREGROUND_NEIGHBOR_RADIUS_METERS * FOREGROUND_NEIGHBOR_RADIUS_METERS
  for (let x = originX - 1; x <= originX + 1; x++) for (let y = originY - 1; y <= originY + 1; y++) for (let z = originZ - 1; z <= originZ + 1; z++) {
    for (const index of cells.get(`${x},${y},${z}`) ?? []) {
      const candidate = surfels[index].position, dx = candidate.x - point.x, dy = candidate.y - point.y, dz = candidate.z - point.z
      const distanceSquared = dx * dx + dy * dy + dz * dz
      if (distanceSquared > EPSILON && distanceSquared <= radiusSquared) candidates.push({ index, distanceSquared })
    }
  }
  candidates.sort((left, right) => left.distanceSquared - right.distanceSquared)
  return candidates.slice(0, FOREGROUND_MAX_NEIGHBORS).map((candidate) => candidate.index)
}

function wallDomainNeighbors(
  point: SpatialPoint,
  cells: ReadonlyMap<string, readonly number[]>,
  surfels: readonly FinalizedRealitySurfel[],
): number[] {
  const originX = Math.floor(point.x / FOREGROUND_GRID_CELL_METERS), originY = Math.floor(point.y / FOREGROUND_GRID_CELL_METERS), originZ = Math.floor(point.z / FOREGROUND_GRID_CELL_METERS)
  const candidates: Array<{ index: number; distanceSquared: number }> = []
  const radiusSquared = WALL_DOMAIN_NEIGHBOR_RADIUS_METERS * WALL_DOMAIN_NEIGHBOR_RADIUS_METERS
  for (let x = originX - 2; x <= originX + 2; x++) for (let y = originY - 2; y <= originY + 2; y++) for (let z = originZ - 2; z <= originZ + 2; z++) {
    for (const index of cells.get(`${x},${y},${z}`) ?? []) {
      const candidate = surfels[index].position, dx = candidate.x - point.x, dy = candidate.y - point.y, dz = candidate.z - point.z
      const distanceSquared = dx * dx + dy * dy + dz * dz
      if (distanceSquared > EPSILON && distanceSquared <= radiusSquared) candidates.push({ index, distanceSquared })
    }
  }
  candidates.sort((left, right) => left.distanceSquared - right.distanceSquared)
  return candidates.slice(0, WALL_DOMAIN_MAX_NEIGHBORS).map((candidate) => candidate.index)
}

function normalCompatibility(first: SpatialPoint | undefined, second: SpatialPoint | undefined): number {
  if (!first || !second) return 1
  return Math.abs((first.x * second.x + first.y * second.y + first.z * second.z) / Math.max(EPSILON, Math.hypot(first.x, first.y, first.z) * Math.hypot(second.x, second.y, second.z)))
}

/**
 * Builds a physical Reality domain before foreground classification. The
 * structural patch union starts the domain, but only connected RGB-supported
 * and wall-compatible observed samples can extend it.
 */
function buildRealityWallDomain(
  surfels: readonly FinalizedRealitySurfel[],
  table: RealityStructuralAssociationTable,
  logicalIndex: number,
  rgbClassifications: Uint8Array,
): RealityWallDomainAnalysis {
  const seedStarted = timestamp()
  const logical = table.logicalSurfaces[logicalIndex]
  const diagnostics = table.perLogicalSurface?.find((entry) => entry.logicalSurfaceId === logical.id)
  const planeConstant = logical.representativePlaneConstant + (diagnostics?.membershipReferenceOffsetMeters ?? 0)
  const memberPatches = logical.memberPatchIds.map((id) => table.patches.find((patch) => patch.id === id)).filter((patch): patch is RealityStructuralAssociationTable['patches'][number] => Boolean(patch))
  const referencePatch = memberPatches[0]
  const states = new Uint8Array(surfels.length)
  if (!referencePatch || memberPatches.length === 0) return {
    states, patchCoreSampleCount: 0, nearPatchSampleCount: 0, observedWallExtensionSampleCount: 0, outsideDomainSampleCount: surfels.length,
    rgbWallProjectedCandidateCount: 0, rejectedByBoundsCount: 0, rejectedByPlaneCount: 0, rejectedByNormalCount: 0, rejectedByForegroundCount: 0,
    domainComponentCount: 0, patchUvBounds: null, expandedUvBounds: null, planeEnvelopeMeters: 0, patchEdgeToleranceMeters: 0,
    maxExpansionDistanceMeters: 0, seedClassificationMs: timestamp() - seedStarted, extensionGrowthMs: 0, memoryBytes: states.byteLength,
  }
  const patchLocals = memberPatches.flatMap((patch) => patch.vertices3D.map((point) => wallLocalCoordinate(point, referencePatch.basis)))
  const patchUvBounds = {
    minU: Math.min(...patchLocals.map((point) => point.u)), maxU: Math.max(...patchLocals.map((point) => point.u)),
    minV: Math.min(...patchLocals.map((point) => point.v)), maxV: Math.max(...patchLocals.map((point) => point.v)),
  }
  const trustedResiduals: number[] = []
  for (let index = 0; index < surfels.length; index++) {
    const membership = table.memberships?.[index] ?? RealityMembershipCode.NON_WALL
    if (table.logicalSurfaceIndices[index] === logicalIndex && (membership === RealityMembershipCode.CORE_WALL_MEMBER || membership === RealityMembershipCode.EXPANDED_WALL_MEMBER)) {
      trustedResiduals.push(Math.abs(signedPlaneResidual(surfels[index].position, logical.representativeNormal, planeConstant)))
    }
  }
  const residualP95 = quantile(trustedResiduals, 0.95) ?? 0.035
  const planeEnvelopeMeters = Math.max(WALL_DOMAIN_MIN_PLANE_ENVELOPE_METERS, Math.min(WALL_DOMAIN_MAX_PLANE_ENVELOPE_METERS, residualP95 + 0.025))
  const spacing = median(surfels.map((surfel) => surfel.radius * 2)) ?? 0.025
  const patchEdgeToleranceMeters = Math.max(0.06, Math.min(0.16, spacing * 2 + residualP95))
  const maxExpansionDistanceMeters = Math.max(0.25, Math.min(WALL_DOMAIN_MAX_EXTENSION_METERS, patchEdgeToleranceMeters * 6))
  const expandedUvBounds = {
    minU: patchUvBounds.minU - maxExpansionDistanceMeters, maxU: patchUvBounds.maxU + maxExpansionDistanceMeters,
    minV: patchUvBounds.minV - maxExpansionDistanceMeters, maxV: patchUvBounds.maxV + maxExpansionDistanceMeters,
  }
  const candidates = new Uint8Array(surfels.length)
  const cells = new Map<string, number[]>()
  let patchCoreSampleCount = 0, nearPatchSampleCount = 0, rgbWallProjectedCandidateCount = 0
  let rejectedByBoundsCount = 0, rejectedByPlaneCount = 0, rejectedByNormalCount = 0, rejectedByForegroundCount = 0
  for (let index = 0; index < surfels.length; index++) {
    if (rgbClassifications[index] !== VisibleWallMask3dCode.WALL) continue
    rgbWallProjectedCandidateCount++
    if ((table.foregroundMask?.[index] ?? 0) > 0 || (table.logicalSurfaceIndices[index] >= 0 && table.logicalSurfaceIndices[index] !== logicalIndex)) { rejectedByForegroundCount++; continue }
    const exactPatch = memberPatches.some((patch) => pointInsidePatchDomain(surfels[index].position, patch, 0))
    const nearPatch = !exactPatch && memberPatches.some((patch) => pointInsidePatchDomain(surfels[index].position, patch, patchEdgeToleranceMeters))
    const residual = Math.abs(signedPlaneResidual(surfels[index].position, logical.representativeNormal, planeConstant))
    // A patch-core pixel may be a true foreground object hanging in front of
    // the wall. Admit it only for the existing geometry veto; it can never
    // become an observed-wall extension from this relaxed probe path.
    const foregroundProbe = (exactPatch || nearPatch) && residual <= 0.14
    if (residual > planeEnvelopeMeters && !foregroundProbe) { rejectedByPlaneCount++; continue }
    if (absoluteNormalDeviationDegrees(surfels[index].normal, logical.representativeNormal) > 38 && !foregroundProbe) { rejectedByNormalCount++; continue }
    const local = wallLocalCoordinate(surfels[index].position, referencePatch.basis)
    if (local.u < expandedUvBounds.minU || local.u > expandedUvBounds.maxU || local.v < expandedUvBounds.minV || local.v > expandedUvBounds.maxV) { rejectedByBoundsCount++; continue }
    candidates[index] = 1
    const key = foregroundGridKey(surfels[index].position), cell = cells.get(key)
    if (cell) cell.push(index); else cells.set(key, [index])
    if (exactPatch) { states[index] = RealityWallDomainCode.M7_PATCH_CORE; patchCoreSampleCount++ }
    else if (nearPatch) nearPatchSampleCount++
  }
  const seedClassificationMs = timestamp() - seedStarted
  const growthStarted = timestamp()
  const queue: number[] = []
  for (let index = 0; index < states.length; index++) if (states[index] === RealityWallDomainCode.M7_PATCH_CORE) queue.push(index)
  let observedWallExtensionSampleCount = 0
  const visitedRoots = new Uint8Array(surfels.length)
  for (const seed of queue) if (!visitedRoots[seed]) {
    const componentQueue = [seed]; visitedRoots[seed] = 1
    for (let cursor = 0; cursor < componentQueue.length; cursor++) {
      const current = componentQueue[cursor]
      for (const neighbor of wallDomainNeighbors(surfels[current].position, cells, surfels)) {
        if (!candidates[neighbor] || states[neighbor] !== RealityWallDomainCode.OUTSIDE_LOGICAL_WALL_DOMAIN) continue
        const residualStep = Math.abs(signedPlaneResidual(surfels[current].position, logical.representativeNormal, planeConstant) - signedPlaneResidual(surfels[neighbor].position, logical.representativeNormal, planeConstant))
        if (residualStep > 0.045 || normalCompatibility(surfels[current].normal, surfels[neighbor].normal) < 0.64) continue
        states[neighbor] = RealityWallDomainCode.OBSERVED_WALL_EXTENSION
        observedWallExtensionSampleCount++
        if (!visitedRoots[neighbor]) { visitedRoots[neighbor] = 1; componentQueue.push(neighbor) }
      }
    }
  }
  let domainComponentCount = 0
  const visitedDomain = new Uint8Array(surfels.length)
  for (let start = 0; start < states.length; start++) {
    if (states[start] === RealityWallDomainCode.OUTSIDE_LOGICAL_WALL_DOMAIN || visitedDomain[start]) continue
    domainComponentCount++
    const componentQueue = [start]; visitedDomain[start] = 1
    for (let cursor = 0; cursor < componentQueue.length; cursor++) for (const neighbor of wallDomainNeighbors(surfels[componentQueue[cursor]].position, cells, surfels)) {
      if (states[neighbor] !== RealityWallDomainCode.OUTSIDE_LOGICAL_WALL_DOMAIN && !visitedDomain[neighbor]) { visitedDomain[neighbor] = 1; componentQueue.push(neighbor) }
    }
  }
  const extensionGrowthMs = timestamp() - growthStarted
  return {
    states, patchCoreSampleCount, nearPatchSampleCount, observedWallExtensionSampleCount, outsideDomainSampleCount: surfels.length - patchCoreSampleCount - observedWallExtensionSampleCount,
    rgbWallProjectedCandidateCount, rejectedByBoundsCount, rejectedByPlaneCount, rejectedByNormalCount, rejectedByForegroundCount, domainComponentCount,
    patchUvBounds, expandedUvBounds, planeEnvelopeMeters, patchEdgeToleranceMeters, maxExpansionDistanceMeters, seedClassificationMs, extensionGrowthMs,
    memoryBytes: states.byteLength + candidates.byteLength + visitedRoots.byteLength + visitedDomain.byteLength,
  }
}

function analyzeGeometryForeground(
  surfels: readonly FinalizedRealitySurfel[],
  table: RealityStructuralAssociationTable,
  logicalIndex: number,
  rgbClassifications: Uint8Array,
  wallDomain: RealityWallDomainAnalysis,
): GeometryForegroundAnalysis {
  const calibrationStarted = timestamp()
  const logical = table.logicalSurfaces[logicalIndex]
  const diagnostics = table.perLogicalSurface?.find((entry) => entry.logicalSurfaceId === logical.id)
  const calibratedPlaneConstant = logical.representativePlaneConstant + (diagnostics?.membershipReferenceOffsetMeters ?? 0)
  const classifications = new Uint8Array(surfels.length)
  const reasons = new Uint8Array(surfels.length)
  const signedResidualMeters = new Float32Array(surfels.length)
  const normalDeviationDegrees = new Uint8Array(surfels.length)
  const roughnessMillimeters = new Uint8Array(surfels.length)
  const depthStepMillimeters = new Uint8Array(surfels.length)
  const componentIds = new Int32Array(surfels.length).fill(-1)
  const domain = new Uint8Array(surfels.length)
  const stableWallResiduals: number[] = []
  let geometryDomainSampleCount = 0, rgbWallEnteringGeometryCount = 0
  for (let index = 0; index < surfels.length; index++) {
    const signed = signedPlaneResidual(surfels[index].position, logical.representativeNormal, calibratedPlaneConstant)
    signedResidualMeters[index] = signed
    const visuallyObserved = rgbClassifications[index] !== VisibleWallMask3dCode.OUTSIDE_DOMAIN
    const structurallyRelated = table.logicalSurfaceIndices[index] === logicalIndex
    // M8.6.7.2 separates bounded wall-domain admission from foreground
    // classification. This classifier consumes only M7-patch core plus its
    // connected, observed Reality extension; it never uses the RGB ROI alone.
    if (!visuallyObserved || wallDomain.states[index] === RealityWallDomainCode.OUTSIDE_LOGICAL_WALL_DOMAIN) continue
    domain[index] = 1
    geometryDomainSampleCount++
    if (rgbClassifications[index] === VisibleWallMask3dCode.WALL) rgbWallEnteringGeometryCount++
    const membership = table.memberships?.[index] ?? RealityMembershipCode.NON_WALL
    if (structurallyRelated && (membership === RealityMembershipCode.CORE_WALL_MEMBER || membership === RealityMembershipCode.EXPANDED_WALL_MEMBER)) stableWallResiduals.push(Math.abs(signed))
  }
  if (stableWallResiduals.length < 8) for (let index = 0; index < surfels.length; index++) {
    if (!domain[index] || rgbClassifications[index] !== VisibleWallMask3dCode.WALL) continue
    const deviation = absoluteNormalDeviationDegrees(surfels[index].normal, logical.representativeNormal)
    if (deviation <= 16 && Math.abs(signedResidualMeters[index]) <= 0.04) stableWallResiduals.push(Math.abs(signedResidualMeters[index]))
  }
  const residualMedian = quantile(stableWallResiduals, 0.5)
  const residualP75 = quantile(stableWallResiduals, 0.75)
  const residualP90 = quantile(stableWallResiduals, 0.9)
  const residualP95 = quantile(stableWallResiduals, 0.95)
  const wallEnvelopeMeters = Math.max(FOREGROUND_MIN_WALL_ENVELOPE_METERS, Math.min(FOREGROUND_MAX_WALL_ENVELOPE_METERS, (residualP90 ?? residualMedian ?? 0.018) + 0.012))
  const ambiguousOffsetMeters = wallEnvelopeMeters + 0.012
  const foregroundSeedOffsetMeters = wallEnvelopeMeters + 0.03
  const knownForegroundSignedOffsets: number[] = []
  for (let index = 0; index < surfels.length; index++) if (domain[index] && (table.foregroundMask?.[index] ?? 0) > 0) knownForegroundSignedOffsets.push(signedResidualMeters[index])
  const foregroundSideMedian = median(knownForegroundSignedOffsets)
  const foregroundSide: -1 | 0 | 1 = knownForegroundSignedOffsets.length >= FOREGROUND_SIDE_MINIMUM_SUPPORT && foregroundSideMedian !== null && Math.abs(foregroundSideMedian) > 0.006
    ? foregroundSideMedian > 0 ? 1 : -1
    : 0
  const calibrationMs = timestamp() - calibrationStarted

  const localStarted = timestamp()
  const cells = new Map<string, number[]>()
  for (let index = 0; index < surfels.length; index++) if (domain[index]) {
    const key = foregroundGridKey(surfels[index].position), cell = cells.get(key)
    if (cell) cell.push(index); else cells.set(key, [index])
  }
  const neighborLists: number[][] = Array.from({ length: surfels.length }, () => [])
  const localNormalDeviation: number[] = Array(surfels.length).fill(0)
  const localNormalConsensus: number[] = Array(surfels.length).fill(1)
  const localRoughness: number[] = Array(surfels.length).fill(0)
  const localDepthStep: number[] = Array(surfels.length).fill(0)
  for (let index = 0; index < surfels.length; index++) if (domain[index]) {
    const neighbors = foregroundNeighbors(surfels[index].position, cells, surfels)
    neighborLists[index] = neighbors
    const offsets = neighbors.map((neighbor) => signedResidualMeters[neighbor])
    const offsetCenter = median(offsets)
    if (offsetCenter !== null && offsets.length > 0) {
      localRoughness[index] = Math.sqrt(offsets.reduce((sum, value) => sum + (value - offsetCenter) * (value - offsetCenter), 0) / offsets.length)
      localDepthStep[index] = Math.max(...offsets.map((value) => Math.abs(value - signedResidualMeters[index])))
    }
    localNormalDeviation[index] = absoluteNormalDeviationDegrees(surfels[index].normal, logical.representativeNormal)
    const normalDots = neighbors.flatMap((neighbor) => {
      const first = surfels[index].normal, second = surfels[neighbor].normal
      if (!first || !second || Math.abs(signedResidualMeters[neighbor] - signedResidualMeters[index]) > 0.03) return []
      return [Math.abs((first.x * second.x + first.y * second.y + first.z * second.z) / Math.max(EPSILON, Math.hypot(first.x, first.y, first.z) * Math.hypot(second.x, second.y, second.z)))]
    })
    localNormalConsensus[index] = median(normalDots) ?? 0
    normalDeviationDegrees[index] = Math.min(255, Math.round(localNormalDeviation[index]))
    roughnessMillimeters[index] = Math.min(255, Math.round(localRoughness[index] * 1000))
    depthStepMillimeters[index] = Math.min(255, Math.round(localDepthStep[index] * 1000))
  }
  const localAnalysisMs = timestamp() - localStarted

  const reasonCounts: Record<string, number> = { 'existing foreground': 0, 'plane offset': 0, 'normal disagreement': 0, roughness: 0, 'depth discontinuity': 0, 'connected foreground': 0, 'geometry uncertain': 0 }
  let geometryWallLikeSampleCount = 0, foregroundCoreSampleCount = 0, geometryUncertainSampleCount = 0
  for (let index = 0; index < surfels.length; index++) if (domain[index]) {
    const signedOffset = signedResidualMeters[index], offset = Math.abs(signedOffset), normal = localNormalDeviation[index], normalConsensus = localNormalConsensus[index], roughness = localRoughness[index], depthStep = localDepthStep[index]
    const existingForeground = (table.foregroundMask?.[index] ?? 0) > 0
    const onForegroundSide = foregroundSide === 0 ? false : signedOffset * foregroundSide > 0
    const nearbyForegroundOffsetSupport = neighborLists[index].filter((neighbor) => {
      const candidateOffset = signedResidualMeters[neighbor]
      return foregroundSide === 0
        ? Math.abs(candidateOffset) >= ambiguousOffsetMeters
        : candidateOffset * foregroundSide >= ambiguousOffsetMeters
    }).length >= 2
    const strongOffset = onForegroundSide && signedOffset * foregroundSide >= foregroundSeedOffsetMeters && nearbyForegroundOffsetSupport
    const offsetWithShape = onForegroundSide && signedOffset * foregroundSide >= ambiguousOffsetMeters && nearbyForegroundOffsetSupport && normalConsensus >= 0.72 && (normal >= 24 || roughness >= FOREGROUND_ROUGHNESS_METERS || depthStep >= FOREGROUND_DEPTH_STEP_METERS)
    const foldedSurface = normal >= FOREGROUND_NORMAL_DEVIATION_DEGREES && normalConsensus >= 0.72 && (roughness >= FOREGROUND_ROUGHNESS_METERS || depthStep >= FOREGROUND_DEPTH_STEP_METERS || (offset >= ambiguousOffsetMeters && nearbyForegroundOffsetSupport))
    const existingForegroundWithSupport = existingForeground && (nearbyForegroundOffsetSupport || (normalConsensus >= 0.7 && (normal >= 22 || roughness >= 0.01 || depthStep >= 0.02)))
    if (existingForegroundWithSupport || strongOffset || offsetWithShape || foldedSurface) {
      classifications[index] = GeometryForegroundCode.FOREGROUND_CORE
      reasons[index] = existingForegroundWithSupport ? GeometryForegroundReason.EXISTING_FOREGROUND : strongOffset || offsetWithShape ? GeometryForegroundReason.PLANE_OFFSET : normal >= FOREGROUND_NORMAL_DEVIATION_DEGREES ? GeometryForegroundReason.NORMAL_DISAGREEMENT : roughness >= FOREGROUND_ROUGHNESS_METERS ? GeometryForegroundReason.SURFACE_ROUGHNESS : GeometryForegroundReason.DEPTH_DISCONTINUITY
      reasonCounts[reasons[index] === GeometryForegroundReason.EXISTING_FOREGROUND ? 'existing foreground' : reasons[index] === GeometryForegroundReason.PLANE_OFFSET ? 'plane offset' : reasons[index] === GeometryForegroundReason.NORMAL_DISAGREEMENT ? 'normal disagreement' : reasons[index] === GeometryForegroundReason.SURFACE_ROUGHNESS ? 'roughness' : 'depth discontinuity']++
      foregroundCoreSampleCount++
    } else if (offset <= ambiguousOffsetMeters && normal <= 32 && (normalConsensus >= 0.62 || normal <= 18) && roughness <= FOREGROUND_ROUGHNESS_METERS * 1.35 && depthStep <= FOREGROUND_DEPTH_STEP_METERS * 1.35) {
      classifications[index] = GeometryForegroundCode.WALL_GEOMETRY
      geometryWallLikeSampleCount++
    } else {
      classifications[index] = GeometryForegroundCode.GEOMETRY_UNCERTAIN
      reasons[index] = GeometryForegroundReason.GEOMETRY_UNCERTAIN
      geometryUncertainSampleCount++; reasonCounts['geometry uncertain']++
    }
  }

  const growthStarted = timestamp()
  const components: GeometryForegroundComponent[] = []
  let foregroundConnectedSampleCount = 0, nextComponentId = 0
  const strongWallBarrier = new Uint8Array(surfels.length)
  for (let index = 0; index < surfels.length; index++) if (classifications[index] === GeometryForegroundCode.WALL_GEOMETRY) {
    const wallNeighbors = neighborLists[index].filter((neighbor) => classifications[neighbor] === GeometryForegroundCode.WALL_GEOMETRY).length
    if (wallNeighbors >= STRONG_WALL_BARRIER_NEIGHBORS && Math.abs(signedResidualMeters[index]) <= wallEnvelopeMeters && localNormalDeviation[index] <= 22 && localRoughness[index] <= 0.012) strongWallBarrier[index] = 1
  }
  for (let seed = 0; seed < surfels.length; seed++) {
    if (classifications[seed] !== GeometryForegroundCode.FOREGROUND_CORE || componentIds[seed] >= 0) continue
    const componentId = nextComponentId++, queue = [seed], geodesic = [0], members: number[] = []
    componentIds[seed] = componentId
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]
      members.push(current)
      for (const neighbor of neighborLists[current]) {
        if (!domain[neighbor] || componentIds[neighbor] >= 0 || rgbClassifications[neighbor] === VisibleWallMask3dCode.NON_WALL) continue
        if (strongWallBarrier[neighbor]) continue
        const predecessorNormal = surfels[current].normal, neighborNormal = surfels[neighbor].normal
        const normalCompatibility = !predecessorNormal || !neighborNormal ? 1 : Math.abs((predecessorNormal.x * neighborNormal.x + predecessorNormal.y * neighborNormal.y + predecessorNormal.z * neighborNormal.z) / Math.max(EPSILON, Math.hypot(predecessorNormal.x, predecessorNormal.y, predecessorNormal.z) * Math.hypot(neighborNormal.x, neighborNormal.y, neighborNormal.z)))
        const offsetStep = Math.abs(signedResidualMeters[current] - signedResidualMeters[neighbor])
        const distance = Math.hypot(surfels[current].position.x - surfels[neighbor].position.x, surfels[current].position.y - surfels[neighbor].position.y, surfels[current].position.z - surfels[neighbor].position.z)
        const foregroundNeighbors = neighborLists[neighbor].filter((candidate) => componentIds[candidate] === componentId).length
        const coreAnchors = neighborLists[neighbor].filter((candidate) => componentIds[candidate] === componentId && classifications[candidate] === GeometryForegroundCode.FOREGROUND_CORE).length
        const nearForegroundShape = localNormalDeviation[neighbor] >= 20 || localRoughness[neighbor] >= 0.009 || Math.abs(signedResidualMeters[neighbor]) > ambiguousOffsetMeters
        const continuesForegroundOffset = foregroundSide === 0
          ? Math.abs(signedResidualMeters[neighbor]) >= wallEnvelopeMeters * 0.75
          : signedResidualMeters[neighbor] * foregroundSide >= wallEnvelopeMeters * 0.65
        if (geodesic[cursor] + distance > FOREGROUND_COMPONENT_MAX_GEODESIC_METERS || normalCompatibility < 0.62 || offsetStep > 0.032 || foregroundNeighbors < FOREGROUND_MIN_COMPONENT_SUPPORT || (!nearForegroundShape && !continuesForegroundOffset && coreAnchors < 2)) continue
        if (classifications[neighbor] !== GeometryForegroundCode.FOREGROUND_CORE) {
          const wasWallGeometry = classifications[neighbor] === GeometryForegroundCode.WALL_GEOMETRY
          const wasGeometryUncertain = classifications[neighbor] === GeometryForegroundCode.GEOMETRY_UNCERTAIN
          classifications[neighbor] = GeometryForegroundCode.FOREGROUND_CONNECTED
          reasons[neighbor] = GeometryForegroundReason.CONNECTED_FOREGROUND
          foregroundConnectedSampleCount++; if (wasWallGeometry) geometryWallLikeSampleCount--; if (wasGeometryUncertain) geometryUncertainSampleCount--
          reasonCounts['connected foreground']++
        }
        componentIds[neighbor] = componentId
        queue.push(neighbor); geodesic.push(geodesic[cursor] + distance)
      }
    }
    const offsets = members.map((index) => Math.abs(signedResidualMeters[index]))
    const normals = members.map((index) => localNormalDeviation[index])
    const roughness = members.map((index) => localRoughness[index])
    let boundarySampleCount = 0
    for (const member of members) if (neighborLists[member].some((neighbor) => classifications[neighbor] === GeometryForegroundCode.WALL_GEOMETRY)) boundarySampleCount++
    const coreCount = members.filter((index) => reasons[index] !== GeometryForegroundReason.CONNECTED_FOREGROUND).length
    const connectedCount = members.length - coreCount
    const wallContactRatio = members.length === 0 ? 0 : boundarySampleCount / members.length
    // A very large component that contains almost no direct foreground proof
    // is a flood, not an object. Return its marginal growth to conservative
    // uncertainty instead of allowing it to erase a wall.
    const flood = members.length >= 32 && coreCount / members.length < 0.12 && (median(offsets) ?? 0) <= ambiguousOffsetMeters && wallContactRatio > 0.35
    if (flood) for (const member of members) if (reasons[member] === GeometryForegroundReason.CONNECTED_FOREGROUND) {
      classifications[member] = GeometryForegroundCode.GEOMETRY_UNCERTAIN
      reasons[member] = GeometryForegroundReason.GEOMETRY_UNCERTAIN
      foregroundConnectedSampleCount--; geometryUncertainSampleCount++; reasonCounts['connected foreground']--; reasonCounts['geometry uncertain']++
    }
    components.push({ id: componentId, sampleCount: members.length, estimatedAreaMetersSquared: members.length * 0.000625, offsetMedianMeters: median(offsets), offsetP90Meters: quantile(offsets, 0.9), normalDeviationMedianDegrees: median(normals), roughnessMedianMeters: median(roughness), boundarySampleCount, coreFraction: members.length === 0 ? 0 : coreCount / members.length, connectedFraction: members.length === 0 ? 0 : connectedCount / members.length, wallContactRatio, confidence: clampUnit(Math.min(1, coreCount / 8) * 0.45 + Math.min(1, (quantile(offsets, 0.9) ?? 0) / Math.max(EPSILON, ambiguousOffsetMeters)) * 0.35 + Math.min(1, (median(normals) ?? 0) / 40) * 0.2) })
  }
  const componentGrowthMs = timestamp() - growthStarted
  let rgbWallRejectedByGeometryCount = 0
  for (let index = 0; index < surfels.length; index++) if (rgbClassifications[index] === VisibleWallMask3dCode.WALL && (classifications[index] === GeometryForegroundCode.FOREGROUND_CORE || classifications[index] === GeometryForegroundCode.FOREGROUND_CONNECTED || classifications[index] === GeometryForegroundCode.GEOMETRY_UNCERTAIN)) rgbWallRejectedByGeometryCount++
  const domainSignedOffsets = Array.from(signedResidualMeters).filter((_value, index) => domain[index])
  const memoryBytes = classifications.byteLength + reasons.byteLength + signedResidualMeters.byteLength + normalDeviationDegrees.byteLength + roughnessMillimeters.byteLength + depthStepMillimeters.byteLength + componentIds.byteLength + strongWallBarrier.byteLength
  return { classifications, reasons, signedResidualMeters, normalDeviationDegrees, roughnessMillimeters, depthStepMillimeters, componentIds, strongWallBarrier, wallResidualMeters: { median: residualMedian, p75: residualP75, p90: residualP90, p95: residualP95 }, signedOffsetMeters: { min: domainSignedOffsets.length ? Math.min(...domainSignedOffsets) : null, p05: quantile(domainSignedOffsets, 0.05), p25: quantile(domainSignedOffsets, 0.25), median: median(domainSignedOffsets), p75: quantile(domainSignedOffsets, 0.75), p90: quantile(domainSignedOffsets, 0.9), p95: quantile(domainSignedOffsets, 0.95), max: domainSignedOffsets.length ? Math.max(...domainSignedOffsets) : null }, wallEnvelopeMeters, ambiguousOffsetMeters, foregroundSeedOffsetMeters, foregroundSide, calibrationSampleCount: stableWallResiduals.length, geometryDomainSampleCount, rgbWallEnteringGeometryCount, geometryWallLikeSampleCount, foregroundCoreSampleCount, foregroundConnectedSampleCount, geometryUncertainSampleCount, rgbWallRejectedByGeometryCount, foregroundReasonCounts: reasonCounts, components, calibrationMs, localAnalysisMs, componentGrowthMs, memoryBytes }
}

function createWallLocalPreservedObjectFusion(
  surfels: readonly FinalizedRealitySurfel[],
  table: RealityStructuralAssociationTable,
  logicalIndex: number,
  classifications: Uint8Array,
  objectKeyframeBits: Uint8Array,
): WallLocalPreservedObjectFusion | null {
  const logical = table.logicalSurfaces[logicalIndex], referencePatch = logical && table.patches.find((patch) => logical.memberPatchIds.includes(patch.id))
  if (!referencePatch) return null
  const basis = referencePatch.basis
  const localVertices = logical.memberPatchIds.flatMap((id) => table.patches.find((patch) => patch.id === id)?.vertices3D ?? []).map((point) => wallLocalCoordinate(point, basis))
  if (localVertices.length === 0) return null
  const minU = Math.min(...localVertices.map((point) => point.u)), maxU = Math.max(...localVertices.map((point) => point.u))
  const minV = Math.min(...localVertices.map((point) => point.v)), maxV = Math.max(...localVertices.map((point) => point.v))
  const width = Math.max(8, Math.min(WALL_LOCAL_MAX_AXIS_CELLS, Math.ceil((maxU - minU) / WALL_LOCAL_CELL_METERS) + 1))
  const height = Math.max(8, Math.min(WALL_LOCAL_MAX_AXIS_CELLS, Math.ceil((maxV - minV) / WALL_LOCAL_CELL_METERS) + 1))
  const count = width * height, objectVotes = new Uint8Array(count), wallVotes = new Uint8Array(count), uncertainVotes = new Uint8Array(count), keyframeSupport = new Uint8Array(count)
  const cellFor = (point: SpatialPoint): number => {
    const local = wallLocalCoordinate(point, basis)
    const x = Math.floor((local.u - minU) / Math.max(EPSILON, maxU - minU) * width), y = Math.floor((local.v - minV) / Math.max(EPSILON, maxV - minV) * height)
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x
  }
  for (let index = 0; index < surfels.length; index++) {
    const cell = cellFor(surfels[index].position); if (cell < 0) continue
    const classification = classifications[index]
    if (classification === VisibleWallMask3dCode.NON_WALL) {
      objectVotes[cell] = Math.min(255, objectVotes[cell] + 1)
      keyframeSupport[cell] |= objectKeyframeBits[index]
    } else if (classification === VisibleWallMask3dCode.WALL) wallVotes[cell] = Math.min(255, wallVotes[cell] + 1)
    else if (classification === VisibleWallMask3dCode.UNCERTAIN) uncertainVotes[cell] = Math.min(255, uncertainVotes[cell] + 1)
  }
  const bridged = new Uint8Array(count)
  for (let cell = 0; cell < count; cell++) if (objectVotes[cell] > 0) {
    const x = cell % width, y = Math.floor(cell / width)
    for (let offsetY = -WALL_LOCAL_OBJECT_MERGE_CELLS; offsetY <= WALL_LOCAL_OBJECT_MERGE_CELLS; offsetY++) for (let offsetX = -WALL_LOCAL_OBJECT_MERGE_CELLS; offsetX <= WALL_LOCAL_OBJECT_MERGE_CELLS; offsetX++) {
      const targetX = x + offsetX, targetY = y + offsetY
      if (targetX >= 0 && targetY >= 0 && targetX < width && targetY < height && offsetX * offsetX + offsetY * offsetY <= WALL_LOCAL_OBJECT_MERGE_CELLS * WALL_LOCAL_OBJECT_MERGE_CELLS) bridged[targetY * width + targetX] = 1
    }
  }
  const protectedCells = new Uint8Array(count), visited = new Uint8Array(count), queue: number[] = []
  let regionCount = 0
  for (let start = 0; start < count; start++) {
    if (!bridged[start] || visited[start]) continue
    let minX = start % width, maxX = minX, minY = Math.floor(start / width), maxY = minY, coreCount = 0, supportBits = 0
    queue.length = 0; queue.push(start); visited[start] = 1
    while (queue.length) {
      const cell = queue.pop() as number, x = cell % width, y = Math.floor(cell / width)
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      if (objectVotes[cell] > 0) { coreCount++; supportBits |= keyframeSupport[cell] }
      for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
        const next = nextY * width + nextX
        if (bridged[next] && !visited[next]) { visited[next] = 1; queue.push(next) }
      }
    }
    const boxArea = (maxX - minX + 1) * (maxY - minY + 1)
    let surroundWall = 0, surroundTotal = 0
    for (let x = Math.max(0, minX - 1); x <= Math.min(width - 1, maxX + 1); x++) for (const y of [Math.max(0, minY - 1), Math.min(height - 1, maxY + 1)]) { surroundTotal++; if (wallVotes[y * width + x] > 0) surroundWall++ }
    for (let y = Math.max(0, minY); y <= Math.min(height - 1, maxY); y++) for (const x of [Math.max(0, minX - 1), Math.min(width - 1, maxX + 1)]) { surroundTotal++; if (wallVotes[y * width + x] > 0) surroundWall++ }
    const touchesBoundary = minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1
    const accepted = !touchesBoundary && coreCount >= 3 && bitCount(supportBits) >= 2 && coreCount / Math.max(1, boxArea) >= 0.035 && surroundWall / Math.max(1, surroundTotal) >= 0.16
    if (!accepted) continue
    regionCount++
    for (let y = Math.max(0, minY - 1); y <= Math.min(height - 1, maxY + 1); y++) for (let x = Math.max(0, minX - 1); x <= Math.min(width - 1, maxX + 1); x++) protectedCells[y * width + x] = 1
  }
  let objectSupportedCellCount = 0, wallSupportedCellCount = 0, uncertainCellCount = 0, protectedSampleCount = 0
  for (let cell = 0; cell < count; cell++) { if (objectVotes[cell] > 0) objectSupportedCellCount++; if (wallVotes[cell] > 0) wallSupportedCellCount++; if (uncertainVotes[cell] > 0) uncertainCellCount++ }
  const protectedSampleMask = new Uint8Array(surfels.length)
  for (let index = 0; index < surfels.length; index++) if (protectedCells[cellFor(surfels[index].position)] > 0) { protectedSampleMask[index] = 1; protectedSampleCount++ }
  return { width, height, objectVotes, wallVotes, protectedCells, keyframeSupport, protectedSampleMask, objectSupportedCellCount, wallSupportedCellCount, uncertainCellCount, regionCount, protectedSampleCount }
}

/** Local deterministic seed-and-grow mask provider; replaceable by future semantic providers. */
export class GeometricRgbVisibleWallMaskProvider implements VisibleWallMaskProvider {
  public build(surfels: readonly FinalizedRealitySurfel[], table: RealityStructuralAssociationTable, keyframes: FinalizedRealityRgbKeyframes): VisibleWallMaskResult | null {
    if (keyframes.status !== 'available' || keyframes.keyframes.length === 0) return null
    const started = timestamp(), sampleLogicalSurfaceIndices = new Int32Array(surfels.length).fill(-1), sampleConfidence = new Uint8Array(surfels.length)
    // Prevent a sample from leaking between overlapping projected M7 ROIs.
    // The strongest multi-view wall vote owns it; equal evidence stays with the
    // first deterministic logical surface rather than oscillating by loop order.
    const sampleVoteStrength = new Uint8Array(surfels.length)
    const surfaces: VisibleWallMaskSurfaceResult[] = []
    let projectionMs = 0, maskMs = 0, componentAnalysisMs = 0, secondaryExpansionMs = 0, fragmentExtractionMs = 0, componentMergeMs = 0, enclosureAnalysisMs = 0, clusterFormationMs = 0, outerBoundaryAnalysisMs = 0, gapCompletionMs = 0, interiorFillMs = 0, wallLocalFusionMs = 0, objectProjectionMs = 0, wallDomainMs = 0, geometryForegroundMs = 0, memoryBytes = sampleLogicalSurfaceIndices.byteLength + sampleConfidence.byteLength + sampleVoteStrength.byteLength
    const projection = { u: 0, v: 0 }, pixel = { x: 0, y: 0 }
    for (let logicalIndex = 0; logicalIndex < table.logicalSurfaces.length; logicalIndex++) {
      const vertices = surfaceVertices(table, logicalIndex)
      const ranked = keyframes.keyframes.map((frame) => ({ frame, roi: roiFor(frame, vertices) })).filter((entry): entry is { frame: RealityRgbKeyframe; roi: NonNullable<ReturnType<typeof roiFor>> } => entry.roi !== null).sort((left, right) => right.roi.area * right.frame.qualityScore - left.roi.area * left.frame.qualityScore).slice(0, MAX_KEYFRAMES_PER_SURFACE)
      let masks: VisibleWallMaskKeyframe[] = []
      for (const entry of ranked) {
        const maskStarted = timestamp(), mask = new Uint8Array(entry.frame.width * entry.frame.height).fill(VisibleWallMaskCode.UNCERTAIN), evidence = new Uint8Array(entry.frame.width * entry.frame.height), terminalReasons = new Uint8Array(entry.frame.width * entry.frame.height).fill(VisibleWallMaskTerminalReason.NO_REACHABLE_WALL_SEED)
        const seedColors: number[][] = [], seedPixels: number[] = []
        for (let index = 0; index < surfels.length; index++) {
          const membership = table.memberships[index]
          if (table.logicalSurfaceIndices[index] !== logicalIndex || (membership !== RealityMembershipCode.CORE_WALL_MEMBER && membership !== RealityMembershipCode.EXPANDED_WALL_MEMBER)) continue
          if (!project(surfels[index].position, entry.frame, projection) || !mapCameraUvToCopyPixelInto(entry.frame.mapping, projection.u, projection.v, pixel)) continue
          if (pixel.x < entry.roi.x || pixel.x >= entry.roi.x + entry.roi.width || pixel.y < entry.roi.y || pixel.y >= entry.roi.y + entry.roi.height) continue
          const seedPixel = pixel.y * entry.frame.width + pixel.x
          if (mask[seedPixel] !== VisibleWallMaskCode.WALL) {
            seedColors.push(rgb(entry.frame, pixel.x, pixel.y))
            seedPixels.push(seedPixel)
            mask[seedPixel] = VisibleWallMaskCode.WALL
            evidence[seedPixel] = VisibleWallMaskEvidenceCode.STRUCTURAL_SEED
            terminalReasons[seedPixel] = VisibleWallMaskTerminalReason.NONE
          }
        }
        if (seedColors.length === 0) continue
        const mean = [0, 0, 0]
        for (const color of seedColors) { mean[0] += color[0]; mean[1] += color[1]; mean[2] += color[2] }
        mean[0] /= seedColors.length; mean[1] /= seedColors.length; mean[2] /= seedColors.length
        const queue = [...seedPixels]
        while (queue.length) {
          const current = queue.pop() as number, x = current % entry.frame.width, y = Math.floor(current / entry.frame.width)
          const currentColor = rgb(entry.frame, x, y)
          forEachRoiNeighbor(x, y, entry.roi, (nextX, nextY) => {
            const next = nextY * entry.frame.width + nextX
            if (mask[next] !== VisibleWallMaskCode.UNCERTAIN) return
            const color = rgb(entry.frame, nextX, nextY)
            const chroma = chromaDistance(color, mean), luminanceDifference = Math.abs(luminance(color) - luminance(mean))
            const localChroma = chromaDistance(color, currentColor), localLuminanceDifference = Math.abs(luminance(color) - luminance(currentColor))
            if (chroma <= WALL_GROWTH_CHROMA_DISTANCE && luminanceDifference <= WALL_GROWTH_LUMINANCE_DISTANCE && localChroma <= WALL_LOCAL_EDGE_CHROMA_DISTANCE && localLuminanceDifference <= WALL_LOCAL_EDGE_LUMINANCE_DISTANCE) {
              mask[next] = VisibleWallMaskCode.WALL
              evidence[next] = VisibleWallMaskEvidenceCode.CONSISTENT_WALL_GROWTH
              terminalReasons[next] = VisibleWallMaskTerminalReason.NONE
              queue.push(next)
            } else if (chroma > STRONG_OBJECT_CHROMA_DISTANCE || luminanceDifference > STRONG_OBJECT_LUMINANCE_DISTANCE) {
              mask[next] = VisibleWallMaskCode.NON_WALL
              evidence[next] = VisibleWallMaskEvidenceCode.STRONG_VISUAL_OBJECT
              terminalReasons[next] = VisibleWallMaskTerminalReason.OBJECT_BOUNDARY
            } else if (chroma > WALL_GROWTH_CHROMA_DISTANCE || luminanceDifference > WALL_GROWTH_LUMINANCE_DISTANCE) {
              terminalReasons[next] = VisibleWallMaskTerminalReason.SEED_COLOR_MISMATCH
            } else {
              terminalReasons[next] = VisibleWallMaskTerminalReason.LOCAL_CONTINUITY_BREAK
            }
          })
        }
        // First recover smooth wall-like regions; then identify enclosed
        // visually distinct islands against the newly established surround.
        const expansionStarted = timestamp()
        expandWallLikeUncertainRegions(entry.frame, entry.roi, mask, evidence, terminalReasons, mean)
        secondaryExpansionMs += timestamp() - expansionStarted
        const componentStarted = timestamp()
        const islands = preserveEnclosedVisualObjects(entry.frame, entry.roi, mask, evidence, terminalReasons, mean)
        componentAnalysisMs += timestamp() - componentStarted
        const consolidatedObjects = consolidatePreservedObjectRegions(entry.frame, entry.roi, mask, evidence, terminalReasons, mean)
        fragmentExtractionMs += consolidatedObjects.fragmentExtractionMs
        componentMergeMs += consolidatedObjects.componentMergeMs
        enclosureAnalysisMs += consolidatedObjects.enclosureAnalysisMs
        const completedObjects = completePreservedObjectOuterBoundaries(entry.frame, entry.roi, mask, consolidatedObjects.regions)
        clusterFormationMs += completedObjects.clusterFormationMs
        outerBoundaryAnalysisMs += completedObjects.outerBoundaryAnalysisMs
        gapCompletionMs += completedObjects.gapCompletionMs
        interiorFillMs += completedObjects.interiorFillMs
        // M8.6.6 selects which valid candidates are wall-mounted only after
        // candidates from every selected keyframe can be ranked together.
        const completedObjectEnvelopePixels = new Uint8Array(mask.length)
        let wall = 0, nonWall = 0, uncertain = 0, seedWall = 0, grownWall = 0, secondaryWall = 0, strongObject = 0, enclosedObject = 0
        for (let y = entry.roi.y; y < entry.roi.y + entry.roi.height; y++) for (let x = entry.roi.x; x < entry.roi.x + entry.roi.width; x++) {
          const cell = y * entry.frame.width + x, value = mask[cell], reason = evidence[cell]
          if (value === VisibleWallMaskCode.WALL) wall++; else if (value === VisibleWallMaskCode.NON_WALL) nonWall++; else uncertain++
          if (reason === VisibleWallMaskEvidenceCode.STRUCTURAL_SEED) seedWall++
          else if (reason === VisibleWallMaskEvidenceCode.CONSISTENT_WALL_GROWTH) grownWall++
          else if (reason === VisibleWallMaskEvidenceCode.SECONDARY_WALL_EXPANSION) secondaryWall++
          else if (reason === VisibleWallMaskEvidenceCode.STRONG_VISUAL_OBJECT) strongObject++
          else if (reason === VisibleWallMaskEvidenceCode.ENCLOSED_VISUAL_OBJECT) enclosedObject++
        }
        const seedPixelArray = new Uint32Array(seedPixels)
        maskMs += timestamp() - maskStarted; memoryBytes += mask.byteLength + evidence.byteLength + terminalReasons.byteLength + seedPixelArray.byteLength + completedObjectEnvelopePixels.byteLength + consolidatedObjects.rawFragmentPixels.byteLength + consolidatedObjects.regions.reduce((sum, region) => sum + region.pixelIndices.byteLength, 0) + completedObjects.clusters.reduce((sum, cluster) => sum + cluster.pixelIndices.byteLength, 0)
        masks.push({ keyframeId: entry.frame.id, roi: entry.roi, mask, evidence, terminalReasons, seedPixels: seedPixelArray, seedPixelCount: seedColors.length, wallPixelCount: wall, nonWallPixelCount: nonWall, uncertainPixelCount: uncertain, seedWallPixelCount: seedWall, grownWallPixelCount: grownWall, secondaryExpandedWallPixelCount: secondaryWall, strongVisualObjectPixelCount: strongObject, enclosedVisualObjectPixelCount: enclosedObject, preservedIslands: islands, rawObjectFragmentPixelCount: consolidatedObjects.rawFragmentPixelCount, rawObjectFragmentCount: consolidatedObjects.rawFragmentCount, rawObjectFragmentPixels: consolidatedObjects.rawFragmentPixels, preservedVisualRegions: consolidatedObjects.regions, preservedVisualObjectClusters: completedObjects.clusters, completedObjectEnvelopePixels, projectedAreaPixels: entry.roi.area, qualityScore: entry.frame.qualityScore })
      }
      masks = rankAndApplyDominantObjectEnvelopes(masks, new Map(keyframes.keyframes.map((frame) => [frame.id, frame])), surfels, table, logicalIndex)
      let wallConfirmed = 0, nonWall = 0, uncertain = 0
      const threeDSampleClassifications = new Uint8Array(surfels.length)
      const threeDSampleObservationCounts = new Uint8Array(surfels.length)
      const threeDSampleWallConfidence = new Uint8Array(surfels.length)
      const threeDSampleTerminalReasons = new Uint8Array(surfels.length)
      const threeDSampleObjectKeyframeBits = new Uint8Array(surfels.length)
      const threeDSampleCompletedEnvelopeKeyframeBits = new Uint8Array(surfels.length)
      const threeDUncertainReasonCounts: Record<string, number> = {
        'mask pixel uncertain': 0,
        'one good wall vote quality failed': 0,
        'insufficient observations': 0,
        'conflicting wall/uncertain votes': 0,
        'logical-surface mismatch': 0,
        other: 0,
      }
      let projectableIntoSelectedKeyframes = 0, logicalDomainCandidateSamples = 0, validRoiObservations = 0
      let wallMaskObservations = 0, objectMaskObservations = 0, uncertainMaskObservations = 0
      let observedByZeroKeyframes = 0, observedByOneKeyframe = 0, observedByTwoKeyframes = 0, observedByThreeKeyframes = 0
      let singleUncontestedWallObservations = 0, multiViewWallAgreementSamples = 0
      const frameById = new Map(keyframes.keyframes.map((frame) => [frame.id, frame]))
      const projectionStarted = timestamp()
      for (let index = 0; index < surfels.length; index++) {
        let wallVotes = 0, nonWallVotes = 0, uncertainVotes = 0, validObservations = 0, imageProjectable = false, strongestWallConfidence = 0
        for (let maskIndex = 0; maskIndex < masks.length; maskIndex++) {
          const mask = masks[maskIndex]
          const frame = frameById.get(mask.keyframeId)
          if (!frame || !project(surfels[index].position, frame, projection) || !mapCameraUvToCopyPixelInto(frame.mapping, projection.u, projection.v, pixel)) continue
          imageProjectable = true
          // A projection outside this structural ROI is not a mask observation.
          // It must not be converted into an UNCERTAIN or negative wall vote.
          if (!pixelInsideRoi(pixel, mask.roi)) continue
          validObservations++
          validRoiObservations++
          const value = mask.mask[pixel.y * frame.width + pixel.x]
          if (value === VisibleWallMaskCode.WALL) {
            wallVotes++; wallMaskObservations++
            strongestWallConfidence = Math.max(strongestWallConfidence, localWallObservationConfidence(surfels[index], frame, mask, pixel))
          } else if (value === VisibleWallMaskCode.NON_WALL) {
            nonWallVotes++; objectMaskObservations++; threeDSampleObjectKeyframeBits[index] |= 1 << maskIndex
            if (mask.completedObjectEnvelopePixels[pixel.y * frame.width + pixel.x]) threeDSampleCompletedEnvelopeKeyframeBits[index] |= 1 << maskIndex
          } else {
            uncertainVotes++; uncertainMaskObservations++
          }
        }
        if (imageProjectable) projectableIntoSelectedKeyframes++
        threeDSampleObservationCounts[index] = validObservations
        if (validObservations === 0) {
          observedByZeroKeyframes++
          threeDSampleTerminalReasons[index] = imageProjectable
            ? VisibleWallMask3dTerminalReason.PROJECTION_OUTSIDE_ROI
            : VisibleWallMask3dTerminalReason.NO_SELECTED_KEYFRAME_OBSERVES_SAMPLE
          continue
        }
        logicalDomainCandidateSamples++
        if (validObservations === 1) observedByOneKeyframe++
        else if (validObservations === 2) observedByTwoKeyframes++
        else observedByThreeKeyframes++
        if (wallVotes === 1 && nonWallVotes === 0) singleUncontestedWallObservations++
        if (wallVotes >= 2 && nonWallVotes === 0) multiViewWallAgreementSamples++
        threeDSampleWallConfidence[index] = Math.round(Math.min(1, strongestWallConfidence) * 255)
        if (nonWallVotes > 0) {
          threeDSampleClassifications[index] = VisibleWallMask3dCode.NON_WALL
          nonWall++
          threeDSampleTerminalReasons[index] = wallVotes > 0
            ? VisibleWallMask3dTerminalReason.CONFLICTING_WALL_OBJECT_VOTES
            : VisibleWallMask3dTerminalReason.NONE
          continue
        }
        if (wallVotes > 0 && strongestWallConfidence >= MIN_LOCAL_WALL_OBSERVATION_CONFIDENCE) {
          const strength = Math.min(255, Math.round(strongestWallConfidence * 100) + wallVotes)
          if (strength > sampleVoteStrength[index] || sampleLogicalSurfaceIndices[index] === logicalIndex) {
            sampleLogicalSurfaceIndices[index] = logicalIndex
            sampleConfidence[index] = 2
            sampleVoteStrength[index] = strength
            threeDSampleClassifications[index] = VisibleWallMask3dCode.WALL
            wallConfirmed++
          } else {
            threeDSampleClassifications[index] = VisibleWallMask3dCode.UNCERTAIN
            threeDSampleTerminalReasons[index] = VisibleWallMask3dTerminalReason.LOGICAL_SURFACE_MISMATCH
            threeDUncertainReasonCounts['logical-surface mismatch']++
            uncertain++
          }
        } else {
          threeDSampleClassifications[index] = VisibleWallMask3dCode.UNCERTAIN
          uncertain++
          if (wallVotes > 0) {
            threeDSampleTerminalReasons[index] = VisibleWallMask3dTerminalReason.ONE_GOOD_WALL_VOTE_QUALITY_FAILED
            threeDUncertainReasonCounts['one good wall vote quality failed']++
          } else if (uncertainVotes > 0) {
            threeDSampleTerminalReasons[index] = VisibleWallMask3dTerminalReason.MASK_PIXEL_UNCERTAIN
            threeDUncertainReasonCounts['mask pixel uncertain']++
          } else {
            threeDSampleTerminalReasons[index] = VisibleWallMask3dTerminalReason.OTHER
            threeDUncertainReasonCounts.other++
          }
        }
      }
      projectionMs += timestamp() - projectionStarted
      const fusionStarted = timestamp()
      const wallLocalPreservedObjectFusion = createWallLocalPreservedObjectFusion(surfels, table, logicalIndex, threeDSampleClassifications, threeDSampleObjectKeyframeBits)
      wallLocalFusionMs += timestamp() - fusionStarted
      const objectProjectionStarted = timestamp()
      if (wallLocalPreservedObjectFusion) for (let index = 0; index < surfels.length; index++) {
        if (!wallLocalPreservedObjectFusion.protectedSampleMask[index] || threeDSampleClassifications[index] !== VisibleWallMask3dCode.WALL) continue
        threeDSampleClassifications[index] = VisibleWallMask3dCode.NON_WALL
        if (sampleLogicalSurfaceIndices[index] === logicalIndex) sampleLogicalSurfaceIndices[index] = -1
        wallConfirmed--; nonWall++
      }
      objectProjectionMs += timestamp() - objectProjectionStarted
      const wallDomainStarted = timestamp()
      const realityWallDomain = buildRealityWallDomain(surfels, table, logicalIndex, threeDSampleClassifications)
      wallDomainMs += timestamp() - wallDomainStarted
      const geometryForegroundStarted = timestamp()
      const geometryForeground = analyzeGeometryForeground(surfels, table, logicalIndex, threeDSampleClassifications, realityWallDomain)
      for (let index = 0; index < surfels.length; index++) {
        if (threeDSampleClassifications[index] !== VisibleWallMask3dCode.WALL) continue
        const geometry = geometryForeground.classifications[index]
        if (geometry === GeometryForegroundCode.WALL_GEOMETRY) continue
        // Geometry is a safety gate after the validated M8.6.3 RGB fusion:
        // RGB may establish visible wall likelihood, but cannot paint an
        // offset/folded foreground surface or a geometry-uncertain boundary.
        threeDSampleClassifications[index] = VisibleWallMask3dCode.NON_WALL
        threeDSampleTerminalReasons[index] = geometry === GeometryForegroundCode.GEOMETRY_UNCERTAIN
          ? VisibleWallMask3dTerminalReason.GEOMETRY_UNCERTAIN
          : VisibleWallMask3dTerminalReason.GEOMETRY_FOREGROUND
        if (sampleLogicalSurfaceIndices[index] === logicalIndex) sampleLogicalSurfaceIndices[index] = -1
        wallConfirmed--; nonWall++
      }
      geometryForegroundMs += timestamp() - geometryForegroundStarted
      const threeDCompletedEnvelopeSampleMask = new Uint8Array(surfels.length)
      let completedEnvelopeSampleCount = 0
      for (let index = 0; index < surfels.length; index++) if (threeDSampleClassifications[index] === VisibleWallMask3dCode.NON_WALL && threeDSampleCompletedEnvelopeKeyframeBits[index]) { threeDCompletedEnvelopeSampleMask[index] = 1; completedEnvelopeSampleCount++ }
      memoryBytes += threeDSampleClassifications.byteLength + threeDSampleObservationCounts.byteLength + threeDSampleWallConfidence.byteLength + threeDSampleTerminalReasons.byteLength + threeDSampleObjectKeyframeBits.byteLength + threeDSampleCompletedEnvelopeKeyframeBits.byteLength + threeDCompletedEnvelopeSampleMask.byteLength + realityWallDomain.memoryBytes + geometryForeground.memoryBytes + (wallLocalPreservedObjectFusion ? wallLocalPreservedObjectFusion.objectVotes.byteLength + wallLocalPreservedObjectFusion.wallVotes.byteLength + wallLocalPreservedObjectFusion.protectedCells.byteLength + wallLocalPreservedObjectFusion.keyframeSupport.byteLength + wallLocalPreservedObjectFusion.protectedSampleMask.byteLength : 0)
      surfaces.push({
        logicalSurfaceId: table.logicalSurfaces[logicalIndex].id,
        selectedKeyframeIds: masks.map((mask) => mask.keyframeId),
        masks,
        candidateKeyframeCount: ranked.length,
        roiPixelCount: masks.reduce((sum, mask) => sum + mask.projectedAreaPixels, 0),
        paintableWallPixelCount: masks.reduce((sum, mask) => sum + mask.wallPixelCount, 0),
        preservedObjectPixelCount: masks.reduce((sum, mask) => sum + mask.strongVisualObjectPixelCount + mask.enclosedVisualObjectPixelCount, 0),
        preservedUncertainPixelCount: masks.reduce((sum, mask) => sum + mask.uncertainPixelCount, 0),
        wallConfirmedSampleCount: wallConfirmed,
        nonWallSampleCount: nonWall,
        uncertainSampleCount: uncertain,
        threeDUncertainReasonCounts,
        threeDObservationDiagnostics: {
          totalDenseRealitySamples: surfels.length,
          logicalDomainCandidateSamples,
          projectableIntoSelectedKeyframes,
          validRoiObservations,
          wallMaskObservations,
          objectMaskObservations,
          uncertainMaskObservations,
          observedByZeroKeyframes,
          observedByOneKeyframe,
          observedByTwoKeyframes: observedByTwoKeyframes,
          observedByThreeKeyframes: observedByThreeKeyframes,
          singleUncontestedWallObservations,
          multiViewWallAgreementSamples,
        },
        threeDSampleClassifications,
        threeDSampleObservationCounts,
        threeDSampleWallConfidence,
        threeDSampleTerminalReasons,
        threeDCompletedEnvelopeSampleMask,
        completedEnvelopeSampleCount,
        wallLocalPreservedObjectFusion,
        realityWallDomain,
        geometryForeground,
      })
    }
    return { provider: 'geometric-rgb', sampleLogicalSurfaceIndices, sampleConfidence, surfaces, preparationMs: timestamp() - started, projectionMs, maskMs, componentAnalysisMs, secondaryExpansionMs, fragmentExtractionMs, componentMergeMs, enclosureAnalysisMs, clusterFormationMs, outerBoundaryAnalysisMs, gapCompletionMs, interiorFillMs, wallLocalFusionMs, objectProjectionMs, wallDomainMs, geometryForegroundMs, memoryBytes }
  }
}

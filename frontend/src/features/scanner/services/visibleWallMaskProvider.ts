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

export interface PreservedVisualIsland {
  readonly pixelCount: number
  readonly boundaryClosureScore: number
  readonly wallSurroundScore: number
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
    let projectionMs = 0, maskMs = 0, componentAnalysisMs = 0, secondaryExpansionMs = 0, memoryBytes = sampleLogicalSurfaceIndices.byteLength + sampleConfidence.byteLength + sampleVoteStrength.byteLength
    const projection = { u: 0, v: 0 }, pixel = { x: 0, y: 0 }
    for (let logicalIndex = 0; logicalIndex < table.logicalSurfaces.length; logicalIndex++) {
      const vertices = surfaceVertices(table, logicalIndex)
      const ranked = keyframes.keyframes.map((frame) => ({ frame, roi: roiFor(frame, vertices) })).filter((entry): entry is { frame: RealityRgbKeyframe; roi: NonNullable<ReturnType<typeof roiFor>> } => entry.roi !== null).sort((left, right) => right.roi.area * right.frame.qualityScore - left.roi.area * left.frame.qualityScore).slice(0, MAX_KEYFRAMES_PER_SURFACE)
      const masks: VisibleWallMaskKeyframe[] = []
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
        maskMs += timestamp() - maskStarted; memoryBytes += mask.byteLength + evidence.byteLength + terminalReasons.byteLength + seedPixelArray.byteLength
        masks.push({ keyframeId: entry.frame.id, roi: entry.roi, mask, evidence, terminalReasons, seedPixels: seedPixelArray, seedPixelCount: seedColors.length, wallPixelCount: wall, nonWallPixelCount: nonWall, uncertainPixelCount: uncertain, seedWallPixelCount: seedWall, grownWallPixelCount: grownWall, secondaryExpandedWallPixelCount: secondaryWall, strongVisualObjectPixelCount: strongObject, enclosedVisualObjectPixelCount: enclosedObject, preservedIslands: islands, projectedAreaPixels: entry.roi.area, qualityScore: entry.frame.qualityScore })
      }
      let wallConfirmed = 0, nonWall = 0, uncertain = 0
      const threeDUncertainReasonCounts: Record<string, number> = {
        'not observed enough': 0,
        'conflicting keyframes': 0,
        '2D mask uncertain': 0,
        'object evidence': 0,
        'UV outside': 0,
        'insufficient wall votes': 0,
      }
      const frameById = new Map(keyframes.keyframes.map((frame) => [frame.id, frame]))
      const projectionStarted = timestamp()
      for (let index = 0; index < surfels.length; index++) {
        let wallVotes = 0, nonWallVotes = 0, uncertainVotes = 0, observedVotes = 0, strongestWallQuality = 0
        for (const mask of masks) {
          const frame = frameById.get(mask.keyframeId)
          if (!frame || !project(surfels[index].position, frame, projection) || !mapCameraUvToCopyPixelInto(frame.mapping, projection.u, projection.v, pixel)) continue
          observedVotes++
          const value = mask.mask[pixel.y * frame.width + pixel.x]
          if (value === VisibleWallMaskCode.WALL) { wallVotes++; strongestWallQuality = Math.max(strongestWallQuality, frame.qualityScore) }
          else if (value === VisibleWallMaskCode.NON_WALL) nonWallVotes++
          else uncertainVotes++
        }
        const strongBestWall = wallVotes === 1 && nonWallVotes === 0 && strongestWallQuality >= 0.9
        const robustWall = wallVotes >= 2 && wallVotes > nonWallVotes
        if (robustWall || strongBestWall) {
          const strength = wallVotes - nonWallVotes
          if (strength > sampleVoteStrength[index]) {
            sampleLogicalSurfaceIndices[index] = logicalIndex
            sampleConfidence[index] = 2
            sampleVoteStrength[index] = strength
          }
          wallConfirmed++
        } else if (nonWallVotes > 0) {
          nonWall++
          if (wallVotes > 0) threeDUncertainReasonCounts['conflicting keyframes']++
          else threeDUncertainReasonCounts['object evidence']++
        } else {
          uncertain++
          if (observedVotes === 0) threeDUncertainReasonCounts['UV outside']++
          else if (uncertainVotes === observedVotes) threeDUncertainReasonCounts['2D mask uncertain']++
          else if (wallVotes === 0) threeDUncertainReasonCounts['not observed enough']++
          else threeDUncertainReasonCounts['insufficient wall votes']++
        }
      }
      projectionMs += timestamp() - projectionStarted
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
      })
    }
    return { provider: 'geometric-rgb', sampleLogicalSurfaceIndices, sampleConfidence, surfaces, preparationMs: timestamp() - started, projectionMs, maskMs, componentAnalysisMs, secondaryExpansionMs, memoryBytes }
  }
}

import type {
  CoverageCellState,
  DenseCoverageMesh,
  DenseSpatialDiagnosticSample,
  DenseSpatialPointFrame,
  SpatialBounds,
  SpatialCoverageDenseDebug,
  SpatialPoint,
} from '../types'
import {
  COVERAGE_VISUAL_COLORS,
  COVERAGE_VISUAL_OPACITY,
  DENSE_MASK_COLUMNS,
  DENSE_MASK_ROWS,
  DENSE_VISUAL_STABILIZATION_CONFIG,
} from './spatialCoverageVisualConfig'
import { SpatialCoverageService } from './spatialCoverageService'

const FLOATS_PER_VERTEX = 7
const VISUAL_CACHE_KEY_SIZE_METERS = 0.05
const VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS = 1
// At 80x45, adjacent samples should be close; these limits preserve a seam
// at wall/object and wall/ceiling changes instead of spanning the gap.
const MAX_DEPTH_DISCONTINUITY_METERS = 0.22
const MAX_NEIGHBOR_SPAN_METERS = 0.22
const MIN_NEIGHBOR_SPAN_METERS = 0.08
const NEIGHBOR_SPAN_DEPTH_SCALE = 0.09

function getPerformanceTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

interface VisualPointCacheEntry {
  key: string
  point: SpatialPoint
  normal: SpatialPoint | null
  lastSeenAt: number
}

interface VisualTriangleFragment {
  key: string
  points: Float32Array
  states: [CoverageCellState | null, CoverageCellState | null, CoverageCellState | null]
  lastSeenAt: number
}

interface VisualSurfaceGrid {
  columns: number
  rows: number
  valid: Uint8Array
  inferred: Uint8Array
  distancesMeters: Float32Array
  points: Float32Array
  normals: Float32Array
  normalValid: Uint8Array
}

interface VisualGridDiagnostics {
  holeFillSampleCount: number
  holeFillRejectCount: number
  smoothedVisualFragmentCount: number
}

function createInitialDiagnostics(): SpatialCoverageDenseDebug {
  return {
    columns: DENSE_MASK_COLUMNS,
    rows: DENSE_MASK_ROWS,
    attemptedSampleCount: 0,
    validSampleCount: 0,
    generatedTriangleCount: 0,
    rejectedInvalidSampleCount: 0,
    rejectedDepthDiscontinuityCount: 0,
    unknownMaskSampleCount: 0,
    observedMaskSampleCount: 0,
    partialMaskSampleCount: 0,
    capturedMaskSampleCount: 0,
    exactCoverageLookupHitCount: 0,
    neighborCoverageLookupHitCount: 0,
    coverageLookupMissCount: 0,
    coverageLookupHitPercentage: null,
    depthMinMeters: null,
    depthMaxMeters: null,
    worldBounds: null,
    representativeSamples: [],
    updateCount: 0,
    updateRateHz: 0,
    processingDurationMs: 0,
    visualCacheEntryCount: 0,
    visualCacheMaxEntries: DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries,
    visualCacheHitCount: 0,
    visualCacheRefreshCount: 0,
    visualCacheExpirationCount: 0,
    visualHoleFillSampleCount: 0,
    visualHoleFillRejectCount: 0,
    smoothedVisualFragmentCount: 0,
  }
}

function getPoint(frame: DenseSpatialPointFrame, index: number): SpatialPoint {
  return {
    x: frame.points[index * 3],
    y: frame.points[index * 3 + 1],
    z: frame.points[index * 3 + 2],
  }
}

function updateBounds(bounds: SpatialBounds | null, point: SpatialPoint): SpatialBounds {
  if (!bounds) {
    return { min: { ...point }, max: { ...point } }
  }

  return {
    min: {
      x: Math.min(bounds.min.x, point.x),
      y: Math.min(bounds.min.y, point.y),
      z: Math.min(bounds.min.z, point.z),
    },
    max: {
      x: Math.max(bounds.max.x, point.x),
      y: Math.max(bounds.max.y, point.y),
      z: Math.max(bounds.max.z, point.z),
    },
  }
}

function getSampleIndex(
  frame: DenseSpatialPointFrame,
  normalizedX: number,
  normalizedY: number,
): number {
  const column = Math.round(normalizedX * (frame.columns - 1))
  const row = Math.round(normalizedY * (frame.rows - 1))
  return row * frame.columns + column
}

function getRepresentativeSamples(
  frame: DenseSpatialPointFrame,
): DenseSpatialDiagnosticSample[] {
  const coordinates = [
    { label: 'top-center' as const, x: 0.5, y: 0 },
    { label: 'center' as const, x: 0.5, y: 0.5 },
    { label: 'bottom-center' as const, x: 0.5, y: 1 },
    { label: 'left-center' as const, x: 0, y: 0.5 },
    { label: 'right-center' as const, x: 1, y: 0.5 },
  ]

  return coordinates.map(({ label, x, y }) => {
    const index = getSampleIndex(frame, x, y)
    if (frame.valid[index] !== 1) {
      return { label, depthMeters: null, point: null }
    }

    return {
      label,
      depthMeters: frame.distancesMeters[index],
      point: getPoint(frame, index),
    }
  })
}

function getGridPoint(points: Float32Array, index: number): SpatialPoint {
  const offset = index * 3
  return {
    x: points[offset],
    y: points[offset + 1],
    z: points[offset + 2],
  }
}

function setGridPoint(points: Float32Array, index: number, point: SpatialPoint): void {
  const offset = index * 3
  points[offset] = point.x
  points[offset + 1] = point.y
  points[offset + 2] = point.z
}

function subtractPoints(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.x - second.x,
    y: first.y - second.y,
    z: first.z - second.z,
  }
}

function addPoints(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.x + second.x,
    y: first.y + second.y,
    z: first.z + second.z,
  }
}

function scalePoint(point: SpatialPoint, scale: number): SpatialPoint {
  return { x: point.x * scale, y: point.y * scale, z: point.z * scale }
}

function dotPoints(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function crossPoints(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  }
}

function normalizePoint(point: SpatialPoint): SpatialPoint | null {
  const length = Math.hypot(point.x, point.y, point.z)
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    return null
  }

  return scalePoint(point, 1 / length)
}

function getVisualCacheKey(point: SpatialPoint): string {
  return [
    Math.round(point.x / VISUAL_CACHE_KEY_SIZE_METERS),
    Math.round(point.y / VISUAL_CACHE_KEY_SIZE_METERS),
    Math.round(point.z / VISUAL_CACHE_KEY_SIZE_METERS),
  ].join(':')
}

function getVisualCacheCoordinates(point: SpatialPoint): { x: number; y: number; z: number } {
  return {
    x: Math.round(point.x / VISUAL_CACHE_KEY_SIZE_METERS),
    y: Math.round(point.y / VISUAL_CACHE_KEY_SIZE_METERS),
    z: Math.round(point.z / VISUAL_CACHE_KEY_SIZE_METERS),
  }
}

function getVisualNormal(grid: VisualSurfaceGrid, index: number): SpatialPoint | null {
  if (grid.normalValid[index] !== 1) {
    return null
  }

  return {
    x: grid.normals[index * 3],
    y: grid.normals[index * 3 + 1],
    z: grid.normals[index * 3 + 2],
  }
}

function setVisualNormal(
  grid: VisualSurfaceGrid,
  index: number,
  normal: SpatialPoint,
): void {
  grid.normalValid[index] = 1
  grid.normals[index * 3] = normal.x
  grid.normals[index * 3 + 1] = normal.y
  grid.normals[index * 3 + 2] = normal.z
}

function isGridPointContinuous(
  grid: VisualSurfaceGrid,
  firstIndex: number,
  secondIndex: number,
): boolean {
  if (grid.valid[firstIndex] !== 1 || grid.valid[secondIndex] !== 1) {
    return false
  }

  const firstDepth = grid.distancesMeters[firstIndex]
  const secondDepth = grid.distancesMeters[secondIndex]
  const first = getGridPoint(grid.points, firstIndex)
  const second = getGridPoint(grid.points, secondIndex)
  const maxNeighborSpan = Math.min(
    MAX_NEIGHBOR_SPAN_METERS,
    Math.max(
      MIN_NEIGHBOR_SPAN_METERS,
      Math.max(firstDepth, secondDepth) * NEIGHBOR_SPAN_DEPTH_SCALE,
    ),
  )

  return (
    Number.isFinite(firstDepth) &&
    Number.isFinite(secondDepth) &&
    Math.abs(firstDepth - secondDepth) <= MAX_DEPTH_DISCONTINUITY_METERS &&
    Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z) <=
      maxNeighborSpan
  )
}

function estimateGridNormal(grid: VisualSurfaceGrid, index: number): SpatialPoint | null {
  const row = Math.floor(index / grid.columns)
  const column = index % grid.columns
  if (
    column <= 0 ||
    column >= grid.columns - 1 ||
    row <= 0 ||
    row >= grid.rows - 1
  ) {
    return null
  }

  const leftIndex = index - 1
  const rightIndex = index + 1
  const upIndex = index - grid.columns
  const downIndex = index + grid.columns
  if (
    !isGridPointContinuous(grid, leftIndex, rightIndex) ||
    !isGridPointContinuous(grid, upIndex, downIndex)
  ) {
    return null
  }

  const horizontal = subtractPoints(
    getGridPoint(grid.points, rightIndex),
    getGridPoint(grid.points, leftIndex),
  )
  const vertical = subtractPoints(
    getGridPoint(grid.points, downIndex),
    getGridPoint(grid.points, upIndex),
  )
  return normalizePoint(crossPoints(horizontal, vertical))
}

function isContinuous(
  grid: VisualSurfaceGrid,
  firstIndex: number,
  secondIndex: number,
): boolean {
  return isGridPointContinuous(grid, firstIndex, secondIndex)
}

function getImmediateNeighborIndices(grid: VisualSurfaceGrid, index: number): number[] {
  const row = Math.floor(index / grid.columns)
  const column = index % grid.columns
  const neighbors: number[] = []
  if (column > 0) neighbors.push(index - 1)
  if (column < grid.columns - 1) neighbors.push(index + 1)
  if (row > 0) neighbors.push(index - grid.columns)
  if (row < grid.rows - 1) neighbors.push(index + grid.columns)
  return neighbors
}

function estimateHolePoint(
  grid: VisualSurfaceGrid,
  index: number,
): { point: SpatialPoint; depthMeters: number } | null {
  const neighbors = getImmediateNeighborIndices(grid, index).filter(
    (neighborIndex) => grid.valid[neighborIndex] === 1 && grid.inferred[neighborIndex] === 0,
  )
  if (neighbors.length < DENSE_VISUAL_STABILIZATION_CONFIG.holeFillMinNeighbors) {
    return null
  }

  let depthMin = Number.POSITIVE_INFINITY
  let depthMax = Number.NEGATIVE_INFINITY
  let pointSum: SpatialPoint = { x: 0, y: 0, z: 0 }
  const normals: SpatialPoint[] = []
  for (const neighborIndex of neighbors) {
    const depth = grid.distancesMeters[neighborIndex]
    const point = getGridPoint(grid.points, neighborIndex)
    if (!Number.isFinite(depth)) {
      return null
    }

    depthMin = Math.min(depthMin, depth)
    depthMax = Math.max(depthMax, depth)
    pointSum = addPoints(pointSum, point)
    const normal = getVisualNormal(grid, neighborIndex)
    if (normal) {
      normals.push(normal)
    }
  }

  if (
    depthMax - depthMin >
    DENSE_VISUAL_STABILIZATION_CONFIG.holeFillMaxDepthSpreadMeters
  ) {
    return null
  }

  for (let first = 0; first < neighbors.length; first += 1) {
    for (let second = first + 1; second < neighbors.length; second += 1) {
      const span = getPointDistance(
        getGridPoint(grid.points, neighbors[first]),
        getGridPoint(grid.points, neighbors[second]),
      )
      if (span > DENSE_VISUAL_STABILIZATION_CONFIG.holeFillMaxNeighborSpanMeters) {
        return null
      }
    }
  }

  for (let first = 0; first < normals.length; first += 1) {
    for (let second = first + 1; second < normals.length; second += 1) {
      if (
        dotPoints(normals[first], normals[second]) <
        DENSE_VISUAL_STABILIZATION_CONFIG.smoothingMinNormalDot
      ) {
        return null
      }
    }
  }

  const point = scalePoint(pointSum, 1 / neighbors.length)
  const depthMeters = (depthMin + depthMax) / 2
  return Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z) &&
    Number.isFinite(depthMeters)
    ? { point, depthMeters }
    : null
}

function getPointDistance(first: SpatialPoint, second: SpatialPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

function getColor(
  state: CoverageCellState | null,
): readonly [number, number, number, number] {
  if (!state) {
    return [
      ...COVERAGE_VISUAL_COLORS.observed,
      COVERAGE_VISUAL_OPACITY.candidate,
    ]
  }

  return [
    ...COVERAGE_VISUAL_COLORS[state],
    state === 'captured'
      ? COVERAGE_VISUAL_OPACITY.captured
      : state === 'partial'
        ? COVERAGE_VISUAL_OPACITY.partial
        : COVERAGE_VISUAL_OPACITY.observed,
  ]
}

function getTriangleCacheKey(
  grid: VisualSurfaceGrid,
  firstIndex: number,
  secondIndex: number,
  thirdIndex: number,
): string {
  const first = getGridPoint(grid.points, firstIndex)
  const second = getGridPoint(grid.points, secondIndex)
  const third = getGridPoint(grid.points, thirdIndex)
  const center = scalePoint(addPoints(addPoints(first, second), third), 1 / 3)
  const normal = normalizePoint(
    crossPoints(subtractPoints(second, first), subtractPoints(third, first)),
  )
  const normalKey = normal
    ? [Math.round(normal.x * 4), Math.round(normal.y * 4), Math.round(normal.z * 4)].join(':')
    : 'none'
  return [
    Math.round(center.x / VISUAL_CACHE_KEY_SIZE_METERS),
    Math.round(center.y / VISUAL_CACHE_KEY_SIZE_METERS),
    Math.round(center.z / VISUAL_CACHE_KEY_SIZE_METERS),
    normalKey,
  ].join(':')
}

function appendFragment(
  data: Float32Array,
  offset: number,
  points: Float32Array,
  states: readonly (CoverageCellState | null)[],
): number {
  for (let vertex = 0; vertex < 3; vertex += 1) {
    const pointOffset = vertex * 3
    const outputOffset = offset + vertex * FLOATS_PER_VERTEX
    const color = getColor(states[vertex] ?? null)
    data[outputOffset] = points[pointOffset]
    data[outputOffset + 1] = points[pointOffset + 1]
    data[outputOffset + 2] = points[pointOffset + 2]
    data[outputOffset + 3] = color[0]
    data[outputOffset + 4] = color[1]
    data[outputOffset + 5] = color[2]
    data[outputOffset + 6] = color[3]
  }

  const nextOffset = offset + FLOATS_PER_VERTEX * 3
  return nextOffset
}

function hasVisibleMask(states: readonly (CoverageCellState | null)[]): boolean {
  return states.some((state) => state !== 'captured')
}

function createVisualSurfaceGrid(
  frame: DenseSpatialPointFrame,
): { grid: VisualSurfaceGrid; diagnostics: VisualGridDiagnostics } {
  const sampleCount = frame.columns * frame.rows
  const grid: VisualSurfaceGrid = {
    columns: frame.columns,
    rows: frame.rows,
    valid: new Uint8Array(frame.valid),
    inferred: new Uint8Array(sampleCount),
    distancesMeters: new Float32Array(frame.distancesMeters),
    points: new Float32Array(frame.points),
    normals: new Float32Array(sampleCount * 3),
    normalValid: new Uint8Array(sampleCount),
  }
  const diagnostics: VisualGridDiagnostics = {
    holeFillSampleCount: 0,
    holeFillRejectCount: 0,
    smoothedVisualFragmentCount: 0,
  }

  for (let index = 0; index < sampleCount; index += 1) {
    if (grid.valid[index] === 1) {
      const normal = estimateGridNormal(grid, index)
      if (normal) {
        setVisualNormal(grid, index, normal)
      }
    }
  }

  for (let index = 0; index < sampleCount; index += 1) {
    if (grid.valid[index] === 1) {
      continue
    }

    const hole = estimateHolePoint(grid, index)
    if (!hole) {
      diagnostics.holeFillRejectCount += 1
      continue
    }

    grid.valid[index] = 1
    grid.inferred[index] = 1
    setGridPoint(grid.points, index, hole.point)
    grid.distancesMeters[index] = hole.depthMeters
    diagnostics.holeFillSampleCount += 1
  }

  grid.normalValid.fill(0)
  for (let index = 0; index < sampleCount; index += 1) {
    if (grid.valid[index] === 1) {
      const normal = estimateGridNormal(grid, index)
      if (normal) {
        setVisualNormal(grid, index, normal)
      }
    }
  }

  return { grid, diagnostics }
}

/**
 * Builds a bounded current-frame surface mesh. It owns no XR resources and
 * never stores a historical point cloud; persistent state is queried from the
 * sparse world-space coverage service for each current sample.
 */
export class DenseSurfaceMaskService {
  private diagnostics = createInitialDiagnostics()

  private vertexData = new Float32Array(0)

  private revision = 0

  private readonly visualPointCache = new Map<string, VisualPointCacheEntry>()

  private readonly visualFragmentCache = new Map<string, VisualTriangleFragment>()

  private visualCacheHitCount = 0

  private visualCacheRefreshCount = 0

  private visualCacheExpirationCount = 0

  private firstUpdateAt: number | null = null

  public build(
    frame: DenseSpatialPointFrame,
    coverageService: SpatialCoverageService,
    timestamp: number,
  ): DenseCoverageMesh {
    const processingStartedAt = getPerformanceTimestamp()
    this.expireVisualCacheEntries(timestamp)
    const { grid, diagnostics: gridDiagnostics } = createVisualSurfaceGrid(frame)
    gridDiagnostics.smoothedVisualFragmentCount = this.smoothVisualGrid(grid, timestamp)

    const sampleStates = new Array<CoverageCellState | null>(frame.columns * frame.rows).fill(null)
    const diagnostics = createInitialDiagnostics()
    diagnostics.columns = frame.columns
    diagnostics.rows = frame.rows
    diagnostics.attemptedSampleCount = frame.attemptedSampleCount
    diagnostics.validSampleCount = frame.validPointCount
    diagnostics.representativeSamples = getRepresentativeSamples(frame)

    let worldBounds: SpatialBounds | null = null
    let depthMinMeters = Number.POSITIVE_INFINITY
    let depthMaxMeters = Number.NEGATIVE_INFINITY

    for (let index = 0; index < sampleStates.length; index += 1) {
      if (grid.valid[index] !== 1) {
        diagnostics.rejectedInvalidSampleCount += 1
        continue
      }

      const point = getGridPoint(grid.points, index)
      const lookup = coverageService.getCoverageLookupAtPoint(point)
      const state = lookup.state
      sampleStates[index] = state
      if (frame.valid[index] === 1) {
        worldBounds = updateBounds(worldBounds, getPoint(frame, index))
        depthMinMeters = Math.min(depthMinMeters, frame.distancesMeters[index])
        depthMaxMeters = Math.max(depthMaxMeters, frame.distancesMeters[index])
        if (lookup.kind === 'exact') {
          diagnostics.exactCoverageLookupHitCount += 1
        } else if (lookup.kind === 'neighbor') {
          diagnostics.neighborCoverageLookupHitCount += 1
        } else {
          diagnostics.coverageLookupMissCount += 1
        }
        if (state === null) {
          diagnostics.unknownMaskSampleCount += 1
        } else if (state === 'observed') {
          diagnostics.observedMaskSampleCount += 1
        } else if (state === 'partial') {
          diagnostics.partialMaskSampleCount += 1
        } else {
          diagnostics.capturedMaskSampleCount += 1
        }
      }
    }

    diagnostics.visualHoleFillSampleCount = gridDiagnostics.holeFillSampleCount
    diagnostics.visualHoleFillRejectCount = gridDiagnostics.holeFillRejectCount
    diagnostics.smoothedVisualFragmentCount = gridDiagnostics.smoothedVisualFragmentCount

    diagnostics.worldBounds = worldBounds
    diagnostics.depthMinMeters = Number.isFinite(depthMinMeters) ? depthMinMeters : null
    diagnostics.depthMaxMeters = Number.isFinite(depthMaxMeters) ? depthMaxMeters : null
    diagnostics.coverageLookupHitPercentage = diagnostics.validSampleCount > 0
      ? (
          (diagnostics.exactCoverageLookupHitCount +
            diagnostics.neighborCoverageLookupHitCount) /
          diagnostics.validSampleCount
        ) * 100
      : null

    const maximumTriangles = Math.max(0, (frame.columns - 1) * (frame.rows - 1) * 2)
    this.ensureVertexCapacity(maximumTriangles + DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries)

    let offset = 0
    const currentFragmentKeys = new Set<string>()
    for (let row = 0; row < frame.rows - 1; row += 1) {
      for (let column = 0; column < frame.columns - 1; column += 1) {
        const topLeft = row * frame.columns + column
        const topRight = topLeft + 1
        const bottomLeft = topLeft + frame.columns
        const bottomRight = bottomLeft + 1

        offset = this.processTriangle(
          this.vertexData,
          offset,
          grid,
          sampleStates,
          topLeft,
          bottomLeft,
          topRight,
          timestamp,
          currentFragmentKeys,
          diagnostics,
        )
        offset = this.processTriangle(
          this.vertexData,
          offset,
          grid,
          sampleStates,
          topRight,
          bottomLeft,
          bottomRight,
          timestamp,
          currentFragmentKeys,
          diagnostics,
        )
      }
    }

    this.enforceVisualCacheCapacity()
    offset = this.appendCachedFragments(
      this.vertexData,
      offset,
      coverageService,
      currentFragmentKeys,
      diagnostics,
    )

    return this.finalizeMesh(diagnostics, offset, timestamp, processingStartedAt)
  }

  public buildCached(
    coverageService: SpatialCoverageService,
    timestamp: number,
  ): DenseCoverageMesh {
    const processingStartedAt = getPerformanceTimestamp()
    this.expireVisualCacheEntries(timestamp)
    const diagnostics = createInitialDiagnostics()
    diagnostics.attemptedSampleCount = 0
    diagnostics.validSampleCount = 0
    diagnostics.worldBounds = null
    diagnostics.representativeSamples = []
    diagnostics.depthMinMeters = null
    diagnostics.depthMaxMeters = null
    this.ensureVertexCapacity(DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries)
    const offset = this.appendCachedFragments(
      this.vertexData,
      0,
      coverageService,
      new Set<string>(),
      diagnostics,
    )
    return this.finalizeMesh(diagnostics, offset, timestamp, processingStartedAt)
  }

  private processTriangle(
    data: Float32Array,
    offset: number,
    grid: VisualSurfaceGrid,
    sampleStates: readonly (CoverageCellState | null)[],
    firstIndex: number,
    secondIndex: number,
    thirdIndex: number,
    timestamp: number,
    currentFragmentKeys: Set<string>,
    diagnostics: SpatialCoverageDenseDebug,
  ): number {
    if (
      grid.valid[firstIndex] !== 1 ||
      grid.valid[secondIndex] !== 1 ||
      grid.valid[thirdIndex] !== 1
    ) {
      diagnostics.rejectedInvalidSampleCount += 1
      return offset
    }

    if (
      !isContinuous(grid, firstIndex, secondIndex) ||
      !isContinuous(grid, secondIndex, thirdIndex) ||
      !isContinuous(grid, thirdIndex, firstIndex)
    ) {
      diagnostics.rejectedDepthDiscontinuityCount += 1
      return offset
    }

    const key = getTriangleCacheKey(grid, firstIndex, secondIndex, thirdIndex)
    currentFragmentKeys.add(key)
    const previousFragment = this.visualFragmentCache.get(key)
    const states: [CoverageCellState | null, CoverageCellState | null, CoverageCellState | null] = [
      sampleStates[firstIndex] ?? previousFragment?.states[0] ?? null,
      sampleStates[secondIndex] ?? previousFragment?.states[1] ?? null,
      sampleStates[thirdIndex] ?? previousFragment?.states[2] ?? null,
    ]
    const fragment = this.refreshVisualFragment(
      key,
      grid,
      firstIndex,
      secondIndex,
      thirdIndex,
      states,
      timestamp,
    )

    if (!hasVisibleMask(fragment.states)) {
      return offset
    }

    diagnostics.generatedTriangleCount += 1
    return appendFragment(data, offset, fragment.points, fragment.states)
  }

  private refreshVisualFragment(
    key: string,
    grid: VisualSurfaceGrid,
    firstIndex: number,
    secondIndex: number,
    thirdIndex: number,
    states: [CoverageCellState | null, CoverageCellState | null, CoverageCellState | null],
    timestamp: number,
  ): VisualTriangleFragment {
    let fragment = this.visualFragmentCache.get(key)
    if (fragment) {
      this.visualCacheHitCount += 1
      this.visualCacheRefreshCount += 1
    } else {
      fragment = {
        key,
        points: new Float32Array(9),
        states: [null, null, null],
        lastSeenAt: timestamp,
      }
      this.visualFragmentCache.set(key, fragment)
    }

    const indices = [firstIndex, secondIndex, thirdIndex]
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const point = getGridPoint(grid.points, indices[vertex])
      setGridPoint(fragment.points, vertex, point)
      fragment.states[vertex] = states[vertex]
    }
    fragment.lastSeenAt = timestamp
    return fragment
  }

  private smoothVisualGrid(grid: VisualSurfaceGrid, timestamp: number): number {
    let smoothedSampleCount = 0
    for (let index = 0; index < grid.valid.length; index += 1) {
      if (grid.valid[index] !== 1 || grid.inferred[index] === 1) {
        continue
      }

      const point = getGridPoint(grid.points, index)
      const normal = getVisualNormal(grid, index)
      const entry = this.findCompatibleVisualPoint(point, normal)
      if (entry) {
        const alpha = DENSE_VISUAL_STABILIZATION_CONFIG.smoothingAlpha
        const smoothedPoint = addPoints(
          scalePoint(entry.point, 1 - alpha),
          scalePoint(point, alpha),
        )
        entry.point = smoothedPoint
        entry.lastSeenAt = timestamp
        if (normal) {
          const alignedNormal = entry.normal && dotPoints(entry.normal, normal) < 0
            ? scalePoint(normal, -1)
            : normal
          entry.normal = normalizePoint(
            addPoints(entry.normal ?? alignedNormal, alignedNormal),
          ) ?? entry.normal
        }
        setGridPoint(grid.points, index, smoothedPoint)
        smoothedSampleCount += 1
        this.visualCacheHitCount += 1
      } else {
        const key = getVisualCacheKey(point)
        this.visualPointCache.set(key, {
          key,
          point: { ...point },
          normal: normal ? { ...normal } : null,
          lastSeenAt: timestamp,
        })
      }
    }

    this.enforceVisualCacheCapacity()
    return smoothedSampleCount
  }

  private findCompatibleVisualPoint(
    point: SpatialPoint,
    normal: SpatialPoint | null,
  ): VisualPointCacheEntry | null {
    const coordinates = getVisualCacheCoordinates(point)
    let nearest: VisualPointCacheEntry | null = null
    let nearestDistance: number = DENSE_VISUAL_STABILIZATION_CONFIG.smoothingMaxDistanceMeters

    for (
      let xOffset = -VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS;
      xOffset <= VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS;
      xOffset += 1
    ) {
      for (
        let yOffset = -VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS;
        yOffset <= VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS;
        yOffset += 1
      ) {
        for (
          let zOffset = -VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS;
          zOffset <= VISUAL_CACHE_NEIGHBOR_RADIUS_CELLS;
          zOffset += 1
        ) {
          const candidate = this.visualPointCache.get(
            [
              coordinates.x + xOffset,
              coordinates.y + yOffset,
              coordinates.z + zOffset,
            ].join(':'),
          )
          if (!candidate) {
            continue
          }

          const distance = getPointDistance(candidate.point, point)
          if (distance > nearestDistance) {
            continue
          }
          if (normal && candidate.normal) {
            const normalDot = dotPoints(normal, candidate.normal)
            if (normalDot < DENSE_VISUAL_STABILIZATION_CONFIG.smoothingMinNormalDot) {
              continue
            }
          }
          if (candidate.normal) {
            const pointToPlaneDistance = Math.abs(
              dotPoints(subtractPoints(point, candidate.point), candidate.normal),
            )
            if (
              pointToPlaneDistance >
              DENSE_VISUAL_STABILIZATION_CONFIG.smoothingMaxPointToPlaneMeters
            ) {
              continue
            }
          }

          nearest = candidate
          nearestDistance = distance
        }
      }
    }

    return nearest
  }

  private appendCachedFragments(
    data: Float32Array,
    offset: number,
    coverageService: SpatialCoverageService,
    currentFragmentKeys: ReadonlySet<string>,
    diagnostics: SpatialCoverageDenseDebug,
  ): number {
    let nextOffset = offset
    for (const [key, fragment] of this.visualFragmentCache) {
      if (currentFragmentKeys.has(key)) {
        continue
      }

      const states: [CoverageCellState | null, CoverageCellState | null, CoverageCellState | null] = [
        this.resolveCachedState(fragment, 0, coverageService),
        this.resolveCachedState(fragment, 1, coverageService),
        this.resolveCachedState(fragment, 2, coverageService),
      ]
      fragment.states[0] = states[0]
      fragment.states[1] = states[1]
      fragment.states[2] = states[2]

      if (!hasVisibleMask(states)) {
        continue
      }

      diagnostics.generatedTriangleCount += 1
      nextOffset = appendFragment(data, nextOffset, fragment.points, states)
    }
    return nextOffset
  }

  private resolveCachedState(
    fragment: VisualTriangleFragment,
    vertex: 0 | 1 | 2,
    coverageService: SpatialCoverageService,
  ): CoverageCellState | null {
    const point = getGridPoint(fragment.points, vertex)
    return coverageService.getCoverageLookupAtPoint(point).state ?? fragment.states[vertex]
  }

  private expireVisualCacheEntries(timestamp: number): void {
    const lifetime = DENSE_VISUAL_STABILIZATION_CONFIG.cacheLifetimeMs
    for (const [key, fragment] of this.visualFragmentCache) {
      if (timestamp - fragment.lastSeenAt > lifetime) {
        this.visualFragmentCache.delete(key)
        this.visualCacheExpirationCount += 1
      }
    }
    for (const [key, point] of this.visualPointCache) {
      if (timestamp - point.lastSeenAt > lifetime) {
        this.visualPointCache.delete(key)
        this.visualCacheExpirationCount += 1
      }
    }
  }

  private enforceVisualCacheCapacity(): void {
    while (
      this.visualPointCache.size + this.visualFragmentCache.size >
      DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries
    ) {
      let oldestKey: string | null = null
      let oldestTimestamp = Number.POSITIVE_INFINITY
      let oldestCache: Map<string, { lastSeenAt: number }> | null = null
      for (const [key, entry] of this.visualPointCache) {
        if (
          entry.lastSeenAt < oldestTimestamp ||
          (entry.lastSeenAt === oldestTimestamp && (oldestKey === null || key < oldestKey))
        ) {
          oldestKey = key
          oldestTimestamp = entry.lastSeenAt
          oldestCache = this.visualPointCache
        }
      }
      for (const [key, entry] of this.visualFragmentCache) {
        if (
          entry.lastSeenAt < oldestTimestamp ||
          (entry.lastSeenAt === oldestTimestamp && (oldestKey === null || key < oldestKey))
        ) {
          oldestKey = key
          oldestTimestamp = entry.lastSeenAt
          oldestCache = this.visualFragmentCache
        }
      }
      if (oldestKey === null || !oldestCache) {
        break
      }
      oldestCache.delete(oldestKey)
    }
  }

  private ensureVertexCapacity(maximumFragments: number): void {
    const requiredFloats = maximumFragments * 3 * FLOATS_PER_VERTEX
    if (this.vertexData.length < requiredFloats) {
      this.vertexData = new Float32Array(requiredFloats)
    }
  }

  private finalizeMesh(
    diagnostics: SpatialCoverageDenseDebug,
    offset: number,
    timestamp: number,
    processingStartedAt: number,
  ): DenseCoverageMesh {
    const updateTimestamp = Number.isFinite(timestamp) ? timestamp : getPerformanceTimestamp()
    const firstUpdateAt = this.firstUpdateAt ?? updateTimestamp
    this.firstUpdateAt = firstUpdateAt
    diagnostics.updateCount = this.diagnostics.updateCount + 1
    diagnostics.updateRateHz = diagnostics.updateCount /
      Math.max(1, (updateTimestamp - firstUpdateAt) / 1000)
    diagnostics.processingDurationMs = Math.max(
      0,
      getPerformanceTimestamp() - processingStartedAt,
    )
    diagnostics.visualCacheEntryCount =
      this.visualPointCache.size + this.visualFragmentCache.size
    diagnostics.visualCacheMaxEntries = DENSE_VISUAL_STABILIZATION_CONFIG.maxCacheEntries
    diagnostics.visualCacheHitCount = this.visualCacheHitCount
    diagnostics.visualCacheRefreshCount = this.visualCacheRefreshCount
    diagnostics.visualCacheExpirationCount = this.visualCacheExpirationCount
    this.diagnostics = diagnostics
    this.revision += 1

    return {
      revision: this.revision,
      vertexData: this.vertexData.subarray(0, offset),
      vertexCount: offset / FLOATS_PER_VERTEX,
    }
  }

  public getDiagnostics(): SpatialCoverageDenseDebug {
    return { ...this.diagnostics }
  }

  public reset(): void {
    this.diagnostics = createInitialDiagnostics()
    this.vertexData = new Float32Array(0)
    this.revision = 0
    this.visualPointCache.clear()
    this.visualFragmentCache.clear()
    this.visualCacheHitCount = 0
    this.visualCacheRefreshCount = 0
    this.visualCacheExpirationCount = 0
    this.firstUpdateAt = null
  }

  public dispose(): void {
    this.reset()
  }
}

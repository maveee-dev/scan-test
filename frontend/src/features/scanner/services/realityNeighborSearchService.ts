import type { FinalizedRealitySurfel } from '../types'

export interface RealityNeighbor {
  readonly index: number
  readonly distanceSquared: number
}

interface RealityNeighborSearchResult {
  neighbors: RealityNeighbor[][]
  spatialIndexMs: number
  neighborAnalysisMs: number
  truncatedQueries: number
}

const AXES = ['x', 'y', 'z'] as const
const MAX_QUERY_VISITS = 512

/** Post-scan only. Near-first balanced spatial queries, never hash/ID-order budgets. */
export function findRealityNeighbors(
  surfels: readonly FinalizedRealitySurfel[],
  maximumDistance: number,
  neighborCount: number,
  compatible: (a: FinalizedRealitySurfel, b: FinalizedRealitySurfel) => boolean,
): RealityNeighborSearchResult {
  const started = performance.now()
  const left = new Int32Array(surfels.length).fill(-1)
  const right = new Int32Array(surfels.length).fill(-1)
  const axes = new Uint8Array(surfels.length)
  const comparePosition = (a: number, b: number) => {
    for (const axis of AXES) {
      const difference = surfels[a].position[axis] - surfels[b].position[axis]
      if (difference !== 0) return difference
    }
    return a - b // coincident positions only; IDs cannot prioritize one direction
  }
  function build(indices: number[]): number {
    if (!indices.length) return -1
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (const i of indices) for (let a = 0; a < 3; a++) {
      const value = surfels[i].position[AXES[a]]
      min[a] = Math.min(min[a], value)
      max[a] = Math.max(max[a], value)
    }
    let axis = 0
    for (let a = 1; a < 3; a++) if (max[a] - min[a] > max[axis] - min[axis]) axis = a
    indices.sort((a, b) => surfels[a].position[AXES[axis]] - surfels[b].position[AXES[axis]] || comparePosition(a, b))
    const middle = indices.length >> 1, index = indices[middle]
    axes[index] = axis
    left[index] = build(indices.slice(0, middle))
    right[index] = build(indices.slice(middle + 1))
    return index
  }
  const root = build(surfels.map((_, index) => index))
  const spatialIndexMs = performance.now() - started
  const queryStarted = performance.now()
  let truncatedQueries = 0
  const neighbors = surfels.map((center, centerIndex) => {
    const nearest: RealityNeighbor[] = []
    let visits = 0, truncated = false
    function visit(index: number): void {
      if (index < 0) return
      if (visits >= MAX_QUERY_VISITS) { truncated = true; return }
      visits++
      const candidate = surfels[index]
      const delta = center.position[AXES[axes[index]]] - candidate.position[AXES[axes[index]]]
      const near = delta <= 0 ? left[index] : right[index]
      const far = delta <= 0 ? right[index] : left[index]
      const dx = candidate.position.x - center.position.x
      const dy = candidate.position.y - center.position.y
      const dz = candidate.position.z - center.position.z
      const distanceSquared = dx * dx + dy * dy + dz * dz
      const limit = nearest.length === neighborCount ? nearest[nearest.length - 1].distanceSquared : maximumDistance ** 2
      if (index !== centerIndex && distanceSquared <= limit && compatible(center, candidate)) {
        nearest.push({ index, distanceSquared })
        nearest.sort((a, b) => a.distanceSquared - b.distanceSquared || comparePosition(a.index, b.index))
        if (nearest.length > neighborCount) nearest.pop()
      }
      visit(near)
      const updatedLimit = nearest.length === neighborCount ? nearest[nearest.length - 1].distanceSquared : maximumDistance ** 2
      if (delta * delta <= updatedLimit) visit(far)
    }
    visit(root)
    if (truncated) truncatedQueries++
    return nearest
  })
  return { neighbors, spatialIndexMs, neighborAnalysisMs: performance.now() - queryStarted, truncatedQueries }
}

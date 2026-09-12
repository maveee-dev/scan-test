import type { SpatialPoint } from '../types'
import type { RetainedRealityMeasurementFrame } from './retainedRealityMeasurementService'

export interface MeasuredVisibilityDiagnostics {
  readonly checkedFrames: number
  readonly testedSamples: number
  readonly removedSamples: number
  readonly supportedComparisons: number
  readonly freeSpaceContradictions: number
  readonly occludedComparisons: number
  readonly elapsedMs: number
}

/** A mismatched camera/depth calibration is not evidence for deleting geometry. */
function hasConsistentViewDepth(frame: RetainedRealityMeasurementFrame): boolean {
  const m = frame.inverseViewTransform, projection = frame.projectionMatrix, grid = frame.denseFrame
  if (m?.length !== 16 || projection?.length !== 16 || !m.every(Number.isFinite) || !projection.every(Number.isFinite) || grid.columns < 2 || grid.rows < 2) return false
  let checked = 0
  const probes = Math.min(32, grid.valid.length)
  for (let probe = 0; probe < probes; probe++) {
    const index = Math.floor(probe * (grid.valid.length - 1) / (probes - 1))
    if (!grid.valid[index]) continue
    const a = grid.points[index * 3], b = grid.points[index * 3 + 1], c = grid.points[index * 3 + 2]
    const x = m[0] * a + m[4] * b + m[8] * c + m[12]
    const y = m[1] * a + m[5] * b + m[9] * c + m[13]
    const z = m[2] * a + m[6] * b + m[10] * c + m[14]
    const w = projection[3] * x + projection[7] * y + projection[11] * z + projection[15]
    if (!Number.isFinite(w) || w <= 0 || z >= 0) return false
    const u = .5 + .5 * (projection[0] * x + projection[4] * y + projection[8] * z + projection[12]) / w
    const v = .5 - .5 * (projection[1] * x + projection[5] * y + projection[9] * z + projection[13]) / w
    if (Math.abs(u - grid.normalizedX[index]) > .002 || Math.abs(v - grid.normalizedY[index]) > .002 || Math.abs(-z - grid.distancesMeters[index]) > .005 + .001 * -z) return false
    checked++
  }
  return checked >= 4
}

/** Rejects only repeated, diverse evidence that a sample lies in measured free space.
 * A nearer occluder, an invalid pixel, or an unobserved region is never a rejection.
 */
export function filterMeasuredVisibility<T extends { position: SpatialPoint; normal: SpatialPoint }>(
  source: readonly T[], frames: readonly RetainedRealityMeasurementFrame[],
): { surfels: readonly T[]; diagnostics: MeasuredVisibilityDiagnostics } {
  const started = performance.now()
  const calibrated = new Set(frames.map(frame => frame.trackingEpoch ?? 0)).size > 1 ? [] : frames.filter(hasConsistentViewDepth)
  const selected = calibrated.length <= 24 ? calibrated : Array.from({ length: 24 }, (_, i) => calibrated[Math.round(i * (calibrated.length - 1) / 23)])
  let testedSamples = 0, removedSamples = 0, supportedComparisons = 0, freeSpaceContradictions = 0, occludedComparisons = 0
  const surfels = selected.length < 3 ? source : source.filter(surfel => {
    const p = surfel.position
    let support = 0, contradictions = 0, firstContradiction: RetainedRealityMeasurementFrame | null = null, diverse = false, temporalSpan = 0
    for (const frame of selected) {
      const m = frame.inverseViewTransform!, projection = frame.projectionMatrix!, grid = frame.denseFrame
      const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]
      const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]
      const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]
      const w = projection[3] * x + projection[7] * y + projection[11] * z + projection[15]
      if (!Number.isFinite(w) || w <= 0 || z >= 0) continue
      const u = .5 + .5 * (projection[0] * x + projection[4] * y + projection[8] * z + projection[12]) / w
      const v = .5 - .5 * (projection[1] * x + projection[5] * y + projection[9] * z + projection[13]) / w
      if (u <= .02 || u >= .98 || v <= .02 || v >= .98) continue
      const dx = frame.cameraPosition.x - p.x, dy = frame.cameraPosition.y - p.y, dz = frame.cameraPosition.z - p.z
      if (Math.abs(dx * surfel.normal.x + dy * surfel.normal.y + dz * surfel.normal.z) < .35 * Math.hypot(dx, dy, dz)) continue
      const stepX = grid.normalizedX[1] - grid.normalizedX[0], stepY = grid.normalizedY[grid.columns] - grid.normalizedY[0]
      if (!(stepX > 0 && stepY > 0)) continue
      const column = Math.floor((u - grid.normalizedX[0]) / stepX), row = Math.floor((v - grid.normalizedY[0]) / stepY)
      if (column < 0 || row < 0 || column + 1 >= grid.columns || row + 1 >= grid.rows) continue
      const index = row * grid.columns + column
      let minDepth = Infinity, maxDepth = -Infinity, valid = true
      for (const offset of [0, 1, grid.columns, grid.columns + 1]) {
        const d = grid.distancesMeters[index + offset]
        if (!grid.valid[index + offset] || !Number.isFinite(d) || d <= 0) { valid = false; break }
        minDepth = Math.min(minDepth, d); maxDepth = Math.max(maxDepth, d)
      }
      // Mixed foreground/background blocks and grazing surfaces are ambiguous.
      if (!valid || maxDepth - minDepth > Math.max(.025, minDepth * .015)) continue
      const tolerance = Math.max(.035, minDepth * .02)
      if (-z < minDepth - tolerance) {
        contradictions++; freeSpaceContradictions++
        firstContradiction ??= frame
        const a = firstContradiction.cameraPosition, b = frame.cameraPosition
        diverse ||= Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= .06
        temporalSpan = Math.max(temporalSpan, Math.abs(frame.timestamp - firstContradiction.timestamp))
      } else if (-z > maxDepth + tolerance) occludedComparisons++
      else { support++; supportedComparisons++ }
    }
    if (support + contradictions > 0) testedSamples++
    const reject = contradictions >= Math.max(3, support * 3) && diverse && temporalSpan >= 220
    if (reject) removedSamples++
    return !reject
  })
  return { surfels, diagnostics: { checkedFrames: selected.length, testedSamples, removedSamples, supportedComparisons, freeSpaceContradictions, occludedComparisons, elapsedMs: performance.now() - started } }
}

import type { FinalizedRealitySurfel, RealityRgbKeyframe, SpatialPoint } from '../types'
import { projectWorldPointToKeyframePixel } from './visibleWallMaskProvider'

export interface RealityRefinementStats {
  geometryMs: number; colorMs: number; movedSamples: number; refinedColors: number; visibilityRejects: number
  singleView: number; multipleViews: number; colorConflictRejects: number; rawNoiseMeters: number; refinedNoiseMeters: number
  edgeSamplesRetained: number; numericTemporaryBytes: number; positionNormalBytes: number; colorBytes: number
  meanDisplacementMeters: number; p90DisplacementMeters: number; p95DisplacementMeters: number; maxDisplacementMeters: number
  retainedRawByDisplacementSafety: number
}
export interface RealityDisplayRefinement {
  discontinuities: Uint8Array
  geometry: FinalizedRealitySurfel[]; appearance: FinalizedRealitySurfel[]; combined: FinalizedRealitySurfel[]
  stats: RealityRefinementStats
}
const dot = (a: SpatialPoint, b: SpatialPoint) => a.x * b.x + a.y * b.y + a.z * b.z
const distance = (a: SpatialPoint, b: SpatialPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const key = (x: number, y: number, z: number) => `${x},${y},${z}`

/** Local measured-neighbor refinement only. No M7 input and no added samples. */
export function refineRealityDisplay(source: readonly FinalizedRealitySurfel[], frames: readonly RealityRgbKeyframe[]): RealityDisplayRefinement {
  const started = performance.now(), cell = .06, buckets = new Map<string, number[]>()
  const stats: RealityRefinementStats = { geometryMs: 0, colorMs: 0, movedSamples: 0, refinedColors: 0, visibilityRejects: 0,
    singleView: 0, multipleViews: 0, colorConflictRejects: 0, rawNoiseMeters: 0, refinedNoiseMeters: 0, edgeSamplesRetained: 0,
    numericTemporaryBytes: source.length * 20, positionNormalBytes: source.length * 24, colorBytes: source.length * 12,
    meanDisplacementMeters: 0, p90DisplacementMeters: 0, p95DisplacementMeters: 0, maxDisplacementMeters: 0,
    retainedRawByDisplacementSafety: 0 }
  source.forEach((s, i) => { const p = s.position, k = key(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell)); const list = buckets.get(k); if (list) list.push(i); else buckets.set(k, [i]) })
  let rawNoise = 0, refinedNoise = 0
  const displacements: number[] = []
  const discontinuities = new Uint8Array(source.length)
  const geometry = source.map((s, sourceIndex) => {
    const p = s.position, n = s.normal, cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell)
    const nearby: { index: number; distance: number }[] = []
    for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      for (const index of buckets.get(key(cx + x, cy + y, cz + z)) ?? []) {
        const d = distance(p, source[index].position)
        if (d > .001 && d < cell) nearby.push({ index, distance: d })
      }
    }
    nearby.sort((a, b) => a.distance - b.distance || a.index - b.index)
    discontinuities[sourceIndex] = nearby.slice(0, 8).some(({ index }) => {
      const other = source[index], delta = { x: other.position.x - p.x, y: other.position.y - p.y, z: other.position.z - p.z }
      return Math.abs(dot(n, other.normal)) < .8 || Math.abs(dot(delta, n)) > .02
    }) ? 1 : 0
    const residuals: number[] = [], centroid = { x: 0, y: 0, z: 0 }, normal = { ...n }
    for (const neighbor of nearby.slice(0, 32)) {
      const other = source[neighbor.index], delta = { x: other.position.x - p.x, y: other.position.y - p.y, z: other.position.z - p.z }
      const residual = dot(delta, n), alignment = dot(n, other.normal)
      // 12mm tangent envelope and 20-degree orientation gate preserve layers,
      // corners and cloth folds; 4mm maximum displacement cannot flatten recesses.
      if (Math.abs(residual) > .012 || Math.abs(alignment) < .94) continue
      residuals.push(residual); centroid.x += delta.x; centroid.y += delta.y; centroid.z += delta.z
      const sign = alignment < 0 ? -1 : 1
      normal.x += other.normal.x * sign; normal.y += other.normal.y * sign; normal.z += other.normal.z * sign
    }
    const count = residuals.length
    // A one-sided neighborhood marks a silhouette/opening, not a hole to fill.
    if (count < 6 || Math.hypot(centroid.x, centroid.y, centroid.z) / count > .015) { stats.edgeSamplesRetained++; return s }
    residuals.sort((a, b) => a - b)
    const target = residuals[Math.floor(count / 2)], proposedDisplacement = target * .5
    // Refinement is display-only and may never manufacture a displaced sheet.
    // If local smoothing asks for more than 4 mm, keep the measured position.
    if (Math.abs(proposedDisplacement) > .004) { stats.retainedRawByDisplacementSafety++; return s }
    const displacement = proposedDisplacement
    rawNoise += Math.abs(target); refinedNoise += Math.abs(target - displacement)
    const length = Math.hypot(normal.x, normal.y, normal.z)
    if (Math.abs(displacement) > .00001) { stats.movedSamples++; displacements.push(Math.abs(displacement)) }
    return { ...s, position: { x: p.x + n.x * displacement, y: p.y + n.y * displacement, z: p.z + n.z * displacement },
      normal: { x: normal.x / length, y: normal.y / length, z: normal.z / length } }
  })
  stats.rawNoiseMeters = rawNoise / Math.max(1, source.length - stats.edgeSamplesRetained)
  stats.refinedNoiseMeters = refinedNoise / Math.max(1, source.length - stats.edgeSamplesRetained)
  displacements.sort((a,b)=>a-b)
  stats.meanDisplacementMeters=displacements.reduce((sum,value)=>sum+value,0)/Math.max(1,displacements.length)
  stats.p90DisplacementMeters=displacements[Math.floor(Math.max(0,displacements.length-1)*.9)]??0
  stats.p95DisplacementMeters=displacements[Math.floor(Math.max(0,displacements.length-1)*.95)]??0
  stats.maxDisplacementMeters=displacements[displacements.length-1]??0
  stats.geometryMs = performance.now() - started
  const colorStarted = performance.now(), bestScore = new Float32Array(source.length), observations = new Uint8Array(source.length)
  const appearance = source.slice(), pixel = { x: 0, y: 0 }
  const conflict = new Uint8Array(source.length)
  // One frame at a time: bounded temporary visibility raster, never N*frames.
  for (const frame of frames.slice(0, 8)) {
    const pixels = frame.width * frame.height, depth = new Float32Array(pixels); depth.fill(Infinity)
    const projected = new Int32Array(source.length); projected.fill(-1)
    const distances = new Float32Array(source.length)
    stats.numericTemporaryBytes = Math.max(stats.numericTemporaryBytes, depth.byteLength + projected.byteLength + distances.byteLength + bestScore.byteLength + observations.byteLength + conflict.byteLength + discontinuities.byteLength)
    const m = frame.inverseCameraTransform, camera = { x: frame.cameraTransform[12], y: frame.cameraTransform[13], z: frame.cameraTransform[14] }
    source.forEach((s, i) => {
      if (!projectWorldPointToKeyframePixel(s.position, frame, pixel)) return
      const x = Math.round(pixel.x), y = Math.round(pixel.y), p = s.position
      if (x < 2 || y < 2 || x >= frame.width - 2 || y >= frame.height - 2) return
      const d = -(m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]); if (d <= 0) return
      projected[i] = y * frame.width + x; distances[i] = d
      // Project the MEASURED surfel footprint as an occluder, not a wall plane.
      const radius = Math.min(6, Math.max(1, Math.ceil(Math.abs(frame.projectionMatrix[5]) * frame.height * s.radius / (2 * d))))
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const px = x + dx, py = y + dy
        if (dx * dx + dy * dy > radius * radius || px < 0 || py < 0 || px >= frame.width || py >= frame.height) continue
        const index = py * frame.width + px; depth[index] = Math.min(depth[index], d)
      }
    })
    source.forEach((s, i) => {
      const index = projected[i]; if (index < 0) return
      const z = distances[i], dx = camera.x - s.position.x, dy = camera.y - s.position.y, dz = camera.z - s.position.z, d = Math.hypot(dx, dy, dz)
      const incidence = Math.abs((s.normal.x * dx + s.normal.y * dy + s.normal.z * dz) / Math.max(.001, d))
      // Reject occluded points and silhouette footprints containing mixed layers.
      const x = index % frame.width, y = Math.floor(index / frame.width)
      let visible = Math.abs(z - depth[index]) <= .025
      for (const delta of [-1, 1, -frame.width, frame.width]) if (Number.isFinite(depth[index + delta]) && Math.abs(z - depth[index + delta]) > .04) visible = false
      if (!visible || incidence < .45) { stats.visibilityRejects++; return }
      const edge = Math.min(1, Math.min(x, y, frame.width - 1 - x, frame.height - 1 - y) / 8)
      const score = incidence * edge * (.5 + .5 * frame.qualityScore) / (1 + d * d * .15)
      if (score < .18) return
      observations[i]++
      const k = index * 3, prior = appearance[i].colorRgb
      if (bestScore[i] > 0 && prior && Math.min(score, bestScore[i]) >= Math.max(score, bestScore[i]) * .85) {
        if (Math.hypot(prior.r - frame.rgb[k] / 255, prior.g - frame.rgb[k + 1] / 255, prior.b - frame.rgb[k + 2] / 255) > .45) conflict[i] = 1
      } else if (score > bestScore[i] / .85) conflict[i] = 0
      if (score <= bestScore[i]) return
      bestScore[i] = score
      appearance[i] = { ...s, colorRgb: { r: frame.rgb[k] / 255, g: frame.rgb[k + 1] / 255, b: frame.rgb[k + 2] / 255 } }
    })
  }
  observations.forEach((count, i) => {
    if (conflict[i]) { appearance[i] = source[i]; stats.colorConflictRejects++; return }
    if (count) stats.refinedColors++; if (count === 1) stats.singleView++; if (count > 1) stats.multipleViews++
  })
  stats.colorMs = performance.now() - colorStarted
  return { discontinuities, geometry, appearance, combined: geometry.map((s, i) => ({ ...s, colorRgb: appearance[i].colorRgb })), stats }
}

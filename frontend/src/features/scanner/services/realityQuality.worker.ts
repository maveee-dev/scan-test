/// <reference lib="webworker" />
import { filterRealityConfidence, type RealityConfidenceFilterResult } from './realityConfidenceFiltering'
import { refineRealityDisplay, type RealityDisplayRefinement } from './realityDisplayRefinement'
import { createRealitySurfaceRenderResources, packRealitySurface } from './realitySurfaceRenderingService'
import type { FinalizedDenseRealityReconstruction, FinalizedRealitySurfel } from '../types'

let raw: FinalizedDenseRealityReconstruction | null = null
let filtered: RealityConfidenceFilterResult | null = null
let refined: RealityDisplayRefinement | null = null

self.onmessage = (event: MessageEvent<{ source?: FinalizedDenseRealityReconstruction; mode: string; id: number }>) => {
  try {
    const { source, mode, id } = event.data
    if (source) {
      raw = source
      const canonical = source.canonicalSurfels ?? source.surfels
      filtered = filterRealityConfidence(canonical)
      refined = refineRealityDisplay(filtered.surfels, source.appearanceKeyframes?.keyframes ?? [])
    }
    if (!raw || !filtered || !refined) return
    const live = raw.liveLightweightSurfels ?? raw.fusedRawSurfels ?? raw.surfels
    const canonical = raw.canonicalSurfels ?? raw.surfels
    const measured = (raw.rawMeasurements ?? []).map((sample, index): FinalizedRealitySurfel => ({
      id: index, position: sample.position, normal: sample.normal, radius: .006,
      colorRgb: sample.accepted ? { r: .12, g: .82, b: .42 } : { r: 1, g: .18, b: .08 },
      colorSpace: 'srgb', geometryConfidence: sample.accepted ? .8 : .1,
      colorConfidence: 1, colorObservationCount: 1, geometryObservationCount: 1,
      firstObservedAt: sample.timestamp, lastObservedAt: sample.timestamp, stabilityClass: 'provisional',
    }))
    const acceptedMeasured = measured.filter((_surfel, index) => raw!.rawMeasurements?.[index]?.accepted)
    const surfels = mode === 'raw-accepted' ? acceptedMeasured
      : mode === 'raw-measured' ? measured
      : mode === 'live' || mode === 'fused-raw' || mode === 'raw' || mode === 'density' ? live
      : mode === 'canonical' ? canonical
      : mode === 'confidence' ? filtered.surfels
      : mode === 'geometry' ? refined.geometry
      : mode === 'canonical-triangulated' || mode === 'triangulated' ? refined.geometry
      : mode === 'color' ? refined.appearance : refined.combined
    const diagnostic = ['raw-accepted', 'raw-measured', 'live', 'fused-raw', 'canonical', 'confidence', 'layers', 'discontinuities', 'new', 'views', 'reveal', 'trajectory'].includes(mode)
    const latest = canonical.reduce((time, s) => Math.max(time, s.firstObservedAt ?? 0), 0)
    const earliest = canonical.reduce((time, s) => Math.min(time, s.firstObservedAt ?? 0), latest)
    const observer = raw.qualityTelemetry?.trajectory[0]?.position ?? { x: 0, y: 0, z: 0 }
    const stageDisplay = mode === 'live' || mode === 'fused-raw' ? live.map((s) => ({ ...s, colorRgb: s.stabilityClass === 'high' ? { r: .12, g: .85, b: .4 } : s.stabilityClass === 'low' ? { r: 1, g: .65, b: .08 } : { r: 1, g: .15, b: .08 } }))
      : mode === 'canonical' ? canonical.map((s) => ({ ...s, colorRgb: { r: .15, g: .75, b: 1 } }))
      : mode === 'confidence' ? filtered.surfels.map((s) => ({ ...s, colorRgb: s.stabilityClass === 'high' ? { r: .12, g: .85, b: .4 } : { r: .15, g: .55, b: 1 } }))
      : mode === 'geometry' || mode === 'canonical-triangulated' || mode === 'triangulated' || mode === 'color' || mode === 'final'
        ? surfels.map((s) => ({ ...s, colorRgb: s.colorRgb ?? { r: .34, g: .39, b: .43 } })) : surfels
    const display = diagnostic && !['raw-accepted','raw-measured','live','fused-raw','canonical','confidence'].includes(mode) ? canonical.map((s, index) => {
      let color = { r: .15, g: .2, b: .25 }
      if (mode === 'discontinuities') color = refined!.discontinuities[index] ? { r: 1, g: .2, b: .05 } : { r: .1, g: .7, b: .4 }
      if (mode === 'new' && (s.firstObservedAt ?? 0) >= latest - 180) color = { r: 0, g: 1, b: 1 }
      if (mode === 'views') { const support = s.viewObservationCount ?? 0; color = support >= 2 ? { r: .1, g: 1, b: .35 } : { r: 1, g: .6, b: .1 } }
      if (mode === 'layers') { const band = Math.floor(Math.hypot(s.position.x - observer.x, s.position.y - observer.y, s.position.z - observer.z) / .1) % 3; color = { r: band === 0 ? 1 : .1, g: band === 1 ? 1 : .1, b: band === 2 ? 1 : .1 } }
      if (mode === 'reveal') { const t = ((s.firstObservedAt ?? 0) - earliest) / Math.max(1, latest - earliest); color = { r: t, g: 1 - t, b: .8 } }
      return { ...s, colorRgb: color }
    }) : stageDisplay
    const pointsOnly = diagnostic || mode === 'density' || mode === 'geometry' || mode === 'canonical'
    const resources = createRealitySurfaceRenderResources({ surfels: display }, pointsOnly ? 'points' : 'dense')
    const prepared = packRealitySurface(resources)
    const transfers = [...new Set(prepared.geometries.flatMap((g) => g.attributes.map((a) => a.array.buffer as ArrayBuffer)))]
    self.postMessage({ id, prepared, stats: refined.stats, filterStats: filtered.stats }, { transfer: transfers })
    resources.geometries.forEach((g) => g.dispose())
    resources.materials.forEach((m) => m.dispose())
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : 'Reality preparation failed' })
  }
}

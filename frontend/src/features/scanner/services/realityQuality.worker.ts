/// <reference lib="webworker" />
import { refineRealityDisplay, type RealityDisplayRefinement } from './realityDisplayRefinement'
import { createRealitySurfaceRenderResources, packRealitySurface } from './realitySurfaceRenderingService'
import type { FinalizedDenseRealityReconstruction } from '../types'

let raw: FinalizedDenseRealityReconstruction | null = null, refined: RealityDisplayRefinement | null = null
self.onmessage = (event: MessageEvent<{ source?: FinalizedDenseRealityReconstruction; mode: string; id: number }>) => {
  try {
    const { source, mode, id } = event.data
    if (source) { raw = source; refined = refineRealityDisplay(source.surfels, source.appearanceKeyframes?.keyframes ?? []) }
    if (!raw || !refined) return
    const surfels = mode === 'raw' || mode === 'density' ? raw.surfels : mode === 'geometry' ? refined.geometry : mode === 'color' ? refined.appearance : refined.combined
    const diagnostic = ['layers', 'discontinuities', 'new', 'views', 'reveal', 'trajectory'].includes(mode)
    const latest = raw.surfels.reduce((time, s) => Math.max(time, s.firstObservedAt ?? 0), 0)
    const earliest = raw.surfels.reduce((time, s) => Math.min(time, s.firstObservedAt ?? 0), latest)
    const observer = raw.qualityTelemetry?.trajectory[0]?.position ?? { x: 0, y: 0, z: 0 }
    const display = diagnostic ? raw.surfels.map((s, index) => {
      let color = { r: .15, g: .2, b: .25 }
      if (mode === 'discontinuities') color = refined!.discontinuities[index] ? { r: 1, g: .2, b: .05 } : { r: .1, g: .7, b: .4 }
      if (mode === 'new' && (s.firstObservedAt ?? 0) >= latest - 180) color = { r: 0, g: 1, b: 1 }
      if (mode === 'views') { const support = s.viewObservationCount ?? 0; color = support >= 2 ? { r: .1, g: 1, b: .35 } : { r: 1, g: .6, b: .1 } }
      if (mode === 'layers') { const band = Math.floor(Math.hypot(s.position.x - observer.x, s.position.y - observer.y, s.position.z - observer.z) / .1) % 3; color = { r: band === 0 ? 1 : .1, g: band === 1 ? 1 : .1, b: band === 2 ? 1 : .1 } }
      if (mode === 'reveal') { const t = ((s.firstObservedAt ?? 0) - earliest) / Math.max(1, latest - earliest); color = { r: t, g: 1 - t, b: .8 } }
      return { ...s, colorRgb: color }
    }) : surfels
    const resources = createRealitySurfaceRenderResources({ surfels: display }, diagnostic || mode === 'density' ? 'points' : 'dense')
    const prepared = packRealitySurface(resources)
    const transfers = [...new Set(prepared.geometries.flatMap((g) => g.attributes.map((a) => a.array.buffer as ArrayBuffer)))]
    self.postMessage({ id, prepared, stats: refined.stats }, { transfer: transfers })
    resources.geometries.forEach((g) => g.dispose()); resources.materials.forEach((m) => m.dispose())
  } catch (error) { self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : 'Reality preparation failed' }) }
}

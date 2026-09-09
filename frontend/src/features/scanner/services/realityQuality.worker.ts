/// <reference lib="webworker" />
import { filterRealityConfidence, type RealityConfidenceFilterResult } from './realityConfidenceFiltering'
import { refineRealityDisplay, type RealityDisplayRefinement } from './realityDisplayRefinement'
import { appendRealityTextureBatches, createRealitySurfaceRenderResources, packRealitySurface } from './realitySurfaceRenderingService'
import type { FinalizedDenseRealityReconstruction, FinalizedRealitySurfel } from '../types'
import { PROVISIONAL_EXPIRY_REASON } from './canonicalRealityFusionService'

let raw: FinalizedDenseRealityReconstruction | null = null
let filtered: RealityConfidenceFilterResult | null = null
let refined: RealityDisplayRefinement | null = null
let experimentalSurfels: readonly FinalizedRealitySurfel[] | null = null

self.onmessage = (event: MessageEvent<{ source?: FinalizedDenseRealityReconstruction; experimentalSurfels?: readonly FinalizedRealitySurfel[]; mode: string; id: number }>) => {
  try {
    const { source, mode, id } = event.data
    if (source) {
      raw = source
      const canonical = source.canonicalSurfels ?? source.surfels
      filtered = filterRealityConfidence(canonical)
      refined = refineRealityDisplay(filtered.surfels, source.appearanceKeyframes?.keyframes ?? [])
    }
    if (event.data.experimentalSurfels && raw) {
      experimentalSurfels = event.data.experimentalSurfels
    }
    if (!raw || !filtered || !refined) return
    const live = raw.liveLightweightSurfels ?? raw.fusedRawSurfels ?? raw.surfels
    const canonical = raw.canonicalSurfels ?? raw.surfels
    const useExperimental = mode === 'experimental' || mode === 'm88-experimental'
    const activeSurfels = useExperimental ? (experimentalSurfels ?? []) : canonical
    // M8.8 is deliberately a measured-only display mode. Do not eagerly run
    // the production confidence/refinement pipeline for it on initial mount.
    // If a future candidate-refined mode is added, it can opt into these arms.
    const activeFiltered = filtered
    const activeRefined = refined
    const measured = (raw.rawMeasurements ?? []).map((sample, index): FinalizedRealitySurfel => ({
      id: index, position: sample.position, normal: sample.normal, radius: .006,
      colorRgb: sample.accepted ? { r: .12, g: .82, b: .42 } : { r: 1, g: .18, b: .08 },
      colorSpace: 'srgb', geometryConfidence: sample.accepted ? .8 : .1,
      colorConfidence: 1, colorObservationCount: 1, geometryObservationCount: 1,
      firstObservedAt: sample.timestamp, lastObservedAt: sample.timestamp, stabilityClass: 'provisional',
    }))
    const acceptedMeasured = measured.filter((_surfel, index) => raw!.rawMeasurements?.[index]?.accepted)
    const consolidatedMap = raw.consolidatedMeasurementMap
    const consolidatedMeasured: FinalizedRealitySurfel[] = consolidatedMap
      ? Array.from({ length: Math.min(consolidatedMap.sampled, Math.floor(consolidatedMap.positions.length / 3)) }, (_unused, index) => {
        const offset = index * 3
        return {
          id: index,
          position: { x: consolidatedMap.positions[offset], y: consolidatedMap.positions[offset + 1], z: consolidatedMap.positions[offset + 2] },
          normal: { x: 0, y: 0, z: 1 }, radius: .006,
          colorRgb: { r: .12, g: .82, b: .42 }, colorSpace: 'srgb', geometryConfidence: .8,
          colorConfidence: 1, colorObservationCount: 1, geometryObservationCount: 1, stabilityClass: 'provisional',
        }
      })
      : acceptedMeasured
    const expiryMap = raw.provisionalExpiryMap ?? raw.canonicalFusionDiagnostics?.provisionalExpiryMap
    const expiryColors: Record<number, { r: number; g: number; b: number }> = {
      [PROVISIONAL_EXPIRY_REASON.insufficientTemporalSupport]: { r: 1, g: .63, b: .08 },
      [PROVISIONAL_EXPIRY_REASON.insufficientMultiViewSupport]: { r: .9, g: .22, b: .9 },
      [PROVISIONAL_EXPIRY_REASON.replacedByCanonical]: { r: .2, g: .85, b: 1 },
      [PROVISIONAL_EXPIRY_REASON.duplicateParallelLayer]: { r: 1, g: .18, b: .2 },
      [PROVISIONAL_EXPIRY_REASON.isolatedOrNoisy]: { r: .55, g: .55, b: .6 },
      [PROVISIONAL_EXPIRY_REASON.capacityOrLayerPolicy]: { r: 1, g: .95, b: .12 },
      [PROVISIONAL_EXPIRY_REASON.other]: { r: .95, g: .95, b: .95 },
      [PROVISIONAL_EXPIRY_REASON.successfulPromotion]: { r: .18, g: 1, b: .38 },
    }
    // These are packed positions from actual measurements/hypotheses only. The
    // renderer never creates a point for omitted map entries.
    const expirySurfels: FinalizedRealitySurfel[] = expiryMap
      ? Array.from({ length: Math.min(expiryMap.sampled, expiryMap.reasonCodes.length, Math.floor(expiryMap.positions.length / 3)) }, (_unused, index) => {
        const offset = index * 3
        return {
          id: index,
          position: { x: expiryMap.positions[offset], y: expiryMap.positions[offset + 1], z: expiryMap.positions[offset + 2] },
          normal: { x: 0, y: 0, z: 1 }, radius: .009,
          colorRgb: expiryColors[expiryMap.reasonCodes[index]] ?? expiryColors[PROVISIONAL_EXPIRY_REASON.other],
          colorSpace: 'srgb', geometryConfidence: .5, colorConfidence: 1, colorObservationCount: 1,
          geometryObservationCount: 1, stabilityClass: 'provisional',
        }
      })
      : []
    const surfels = mode === 'raw-accepted' ? acceptedMeasured
      : mode === 'retained' ? consolidatedMeasured
      : mode === 'raw-measured' ? measured
      : mode === 'live' || mode === 'fused-raw' || mode === 'raw' || mode === 'density' ? live
      : mode === 'canonical' || mode === 'baseline-canonical' ? canonical
      : useExperimental ? activeSurfels
      : mode === 'provisional-expiry' ? expirySurfels
      : mode === 'confidence' ? activeFiltered.surfels
      : mode === 'base-color' ? activeRefined.geometry
      : mode === 'geometry' ? activeRefined.geometry
      : mode === 'canonical-triangulated' || mode === 'triangulated' ? activeRefined.geometry
      : mode === 'color' || mode === 'high-res' || mode === 'textured' ? activeRefined.appearance : activeRefined.combined
    const diagnostic = ['raw-accepted', 'raw-measured', 'live', 'fused-raw', 'canonical', 'confidence', 'provisional-expiry', 'layers', 'discontinuities', 'new', 'views', 'reveal', 'trajectory'].includes(mode)
    const temporalSurfels = useExperimental ? activeSurfels : canonical
    const latest = temporalSurfels.reduce((time, s) => Math.max(time, s.firstObservedAt ?? 0), 0)
    const earliest = temporalSurfels.reduce((time, s) => Math.min(time, s.firstObservedAt ?? 0), latest)
    const observer = raw.qualityTelemetry?.trajectory[0]?.position ?? { x: 0, y: 0, z: 0 }
    const stageDisplay = mode === 'live' || mode === 'fused-raw' ? live.map((s) => ({ ...s, colorRgb: s.stabilityClass === 'high' ? { r: .12, g: .85, b: .4 } : s.stabilityClass === 'low' ? { r: 1, g: .65, b: .08 } : { r: 1, g: .15, b: .08 } }))
      : mode === 'canonical' || mode === 'baseline-canonical' ? canonical.map((s) => ({ ...s, colorRgb: { r: .15, g: .75, b: 1 } }))
      : useExperimental ? activeSurfels.map((s) => ({ ...s, colorRgb: s.colorRgb ?? { r: .95, g: .55, b: .15 } }))
      : mode === 'confidence' ? activeFiltered.surfels.map((s) => ({ ...s, colorRgb: s.stabilityClass === 'high' ? { r: .12, g: .85, b: .4 } : { r: .15, g: .55, b: 1 } }))
      : mode === 'geometry' || mode === 'canonical-triangulated' || mode === 'triangulated' || mode === 'hybrid' || mode === 'base-color' || mode === 'color' || mode === 'high-res' || mode === 'textured' || mode === 'final'
        ? surfels.map((s) => ({ ...s, colorRgb: s.colorRgb ?? { r: .34, g: .39, b: .43 } })) : surfels
    const display = mode === 'provisional-expiry' ? expirySurfels : diagnostic && !['raw-accepted','raw-measured','live','fused-raw','canonical','confidence'].includes(mode) ? canonical.map((s, index) => {
      let color = { r: .15, g: .2, b: .25 }
      if (mode === 'discontinuities') color = activeRefined.discontinuities[index] ? { r: 1, g: .2, b: .05 } : { r: .1, g: .7, b: .4 }
      if (mode === 'new' && (s.firstObservedAt ?? 0) >= latest - 180) color = { r: 0, g: 1, b: 1 }
      if (mode === 'views') { const support = s.viewObservationCount ?? 0; color = support >= 2 ? { r: .1, g: 1, b: .35 } : { r: 1, g: .6, b: .1 } }
      if (mode === 'layers') { const band = Math.floor(Math.hypot(s.position.x - observer.x, s.position.y - observer.y, s.position.z - observer.z) / .1) % 3; color = { r: band === 0 ? 1 : .1, g: band === 1 ? 1 : .1, b: band === 2 ? 1 : .1 } }
      if (mode === 'reveal') { const t = ((s.firstObservedAt ?? 0) - earliest) / Math.max(1, latest - earliest); color = { r: t, g: 1 - t, b: .8 } }
      return { ...s, colorRgb: color }
    }) : stageDisplay
    const pointsOnly = diagnostic || mode === 'density' || mode === 'geometry' || mode === 'canonical' || mode === 'baseline-canonical' || mode === 'experimental' || mode === 'm88-experimental' || mode === 'retained'
    const renderMode = pointsOnly ? 'points' : mode === 'canonical-triangulated' || mode === 'triangulated' ? 'triangles' : 'dense'
    const resources = createRealitySurfaceRenderResources({ surfels: display }, renderMode)
    if (mode === 'textured' || mode === 'final') appendRealityTextureBatches(resources, display, activeRefined.textureBindingCandidates, raw.appearanceKeyframes?.keyframes ?? [])
    const prepared = packRealitySurface(resources)
    const transfers = [...new Set([
      ...prepared.geometries.flatMap((g) => g.attributes.map((a) => a.array.buffer as ArrayBuffer)),
      ...(prepared.textureBatches ?? []).map((batch) => batch.rgb.buffer as ArrayBuffer),
    ])]
    self.postMessage({ id, prepared, stats: activeRefined.stats, filterStats: activeFiltered.stats }, { transfer: transfers })
    resources.geometries.forEach((g) => g.dispose())
    resources.materials.forEach((m) => m.dispose())
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : 'Reality preparation failed' })
  }
}

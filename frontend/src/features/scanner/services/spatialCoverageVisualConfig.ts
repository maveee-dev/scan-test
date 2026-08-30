import type { CoverageCellState, DenseMaskStabilizationOptions } from '../types'

/** Logical persistence uses 5 cm cells; rendered patches remain subtly inset. */
export const COVERAGE_VISUAL_PATCH_SIZE_METERS = 0.085

/** Dense live mask resolution, independent from the persistent mapping grid. */
export const DENSE_MASK_COLUMNS = 80
export const DENSE_MASK_ROWS = 45

export const COVERAGE_VISUAL_OPACITY = {
  candidate: 0.45,
  observed: 0.3,
  partial: 0.14,
  captured: 0,
} as const

/** Continuous live-mask confidence; persistent states remain discrete. */
export const COVERAGE_VISUAL_CONFIDENCE = {
  unknown: 0,
  observed: 1 / 3,
  partial: 2 / 3,
  captured: 1,
} as const

/** Bounded, stricter support used only to smooth live-mask appearance. */
export const COVERAGE_VISUAL_CONFIDENCE_CONFIG = {
  supportRadiusMeters: 0.12,
  maxPointToPlaneMeters: 0.035,
  minNormalDot: Math.cos((30 * Math.PI) / 180),
  maxCandidates: 6,
  directEvidenceWeight: 3,
  singleNeighborConfidenceFactor: 0.5,
} as const

export const COVERAGE_VISUAL_COLORS: Record<CoverageCellState, readonly [number, number, number]> = {
  observed: [0.22, 0.62, 0.86],
  partial: [0.38, 0.78, 0.94],
  captured: [0.56, 0.9, 1],
}

/** Short-lived presentation-only stabilization; never enters persistent scan data. */
export const DENSE_VISUAL_STABILIZATION_CONFIG = {
  cacheLifetimeMs: 220,
  // One shared world-space sample cache is capped at 3,000 entries so visual
  // continuity cannot create unbounded mobile-memory or matching work.
  maxCacheEntries: 3_000,
  smoothingAlpha: 0.35,
  smoothingMaxDistanceMeters: 0.06,
  smoothingMaxPointToPlaneMeters: 0.035,
  smoothingMinNormalDot: Math.cos((35 * Math.PI) / 180),
  holeFillMinNeighbors: 3,
  holeFillMaxDepthSpreadMeters: 0.12,
  holeFillMaxNeighborSpanMeters: 0.16,
} as const

/**
 * Bounded live surface fusion configuration. Surfels are persistent for the
 * active scan, while the existing coverage map remains the finalized data
 * source. The 8.5 cm footprint is only rendered geometry, not a coverage
 * cell or confidence radius.
 */
export const LIVE_SURFACE_CONFIG = {
  spatialBucketSizeMeters: 0.05,
  maxFusionDistanceMeters: 0.075,
  maxPointToPlaneMeters: 0.04,
  minNormalDot: Math.cos((42 * Math.PI) / 180),
  maxNormalNeighborDepthDifferenceMeters: 0.35,
  maxNormalNeighborSpanMeters: 0.45,
  footprintRadiusMeters: 0.0425,
  candidateFootprintRadiusMeters: 0.028,
  surfaceOffsetMeters: 0.001,
  maxSurfels: 20_000,
  maxCandidatesPerSample: 12,
  maxObservationWeight: 16,
  weakSurfelLifetimeMs: 10_000,
  maxWeakSurfelsRemovedPerUpdate: 48,
} as const

export const DEFAULT_DENSE_MASK_STABILIZATION_OPTIONS: DenseMaskStabilizationOptions = {
  cacheEnabled: true,
  smoothingEnabled: true,
  holeFillEnabled: true,
  hysteresisEnabled: true,
}

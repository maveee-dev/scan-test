import type { CoverageCellState } from '../types'

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

export const COVERAGE_VISUAL_COLORS: Record<CoverageCellState, readonly [number, number, number]> = {
  observed: [0.22, 0.62, 0.86],
  partial: [0.38, 0.78, 0.94],
  captured: [0.56, 0.9, 1],
}

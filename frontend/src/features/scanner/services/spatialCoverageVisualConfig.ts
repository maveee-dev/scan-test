import type { CoverageCellState } from '../types'

/** Visual patches are slightly smaller than the logical 10 cm cells. */
export const COVERAGE_VISUAL_PATCH_SIZE_METERS = 0.09

export const COVERAGE_VISUAL_OPACITY = {
  observed: 0.08,
  partial: 0.14,
  captured: 0.24,
} as const

export const COVERAGE_VISUAL_COLORS: Record<CoverageCellState, readonly [number, number, number]> = {
  observed: [0.36, 0.78, 0.92],
  partial: [0.38, 0.84, 0.96],
  captured: [0.56, 0.92, 1],
}

import type { SpatialPoint } from '../scanner/types'

export type PlaneOrientationCategory = 'horizontal-like' | 'vertical-like' | 'other'

export interface PlaneLocalBounds {
  readonly minU: number
  readonly maxU: number
  readonly minV: number
  readonly maxV: number
}

export interface PlaneCandidate {
  readonly id: string
  readonly normal: SpatialPoint
  readonly centroid: SpatialPoint
  readonly planeConstant: number
  readonly supportPointCount: number
  readonly areaEstimate: number
  readonly rmsError: number
  readonly bounds: {
    readonly min: SpatialPoint
    readonly max: SpatialPoint
  }
  readonly localBounds: PlaneLocalBounds
  readonly tangentU: SpatialPoint
  readonly tangentV: SpatialPoint
  readonly orientationAngleDegrees: number
  readonly orientationCategory: PlaneOrientationCategory
  readonly confidence: number
}

export interface RoomAnalysisTimings {
  readonly inputPreparationMs: number
  readonly downsamplingMs: number
  readonly planeExtractionMs: number
  readonly totalMs: number
}

export interface RoomAnalysisResult {
  readonly sourceScanId: string
  readonly planes: readonly PlaneCandidate[]
  readonly stats: {
    readonly inputPoints: number
    readonly filteredPoints: number
    readonly downsampledPoints: number
    readonly planeCount: number
    readonly rejectedPoints: number
  }
  readonly timings: RoomAnalysisTimings
}

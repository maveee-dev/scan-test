import type {
  CoverageCellState,
  DenseCoverageMesh,
  DenseSpatialPointFrame,
  SpatialCoverageDenseDebug,
  SpatialPoint,
} from '../types'
import {
  COVERAGE_VISUAL_COLORS,
  COVERAGE_VISUAL_OPACITY,
  DENSE_MASK_COLUMNS,
  DENSE_MASK_ROWS,
} from './spatialCoverageVisualConfig'
import { SpatialCoverageService } from './spatialCoverageService'

const FLOATS_PER_VERTEX = 7
const MAX_DEPTH_DISCONTINUITY_METERS = 0.4
const MAX_NEIGHBOR_SPAN_METERS = 0.45

function createInitialDiagnostics(): SpatialCoverageDenseDebug {
  return {
    columns: DENSE_MASK_COLUMNS,
    rows: DENSE_MASK_ROWS,
    attemptedSampleCount: 0,
    validSampleCount: 0,
    generatedTriangleCount: 0,
    rejectedInvalidSampleCount: 0,
    rejectedDepthDiscontinuityCount: 0,
    unknownMaskSampleCount: 0,
    observedMaskSampleCount: 0,
    partialMaskSampleCount: 0,
    capturedMaskSampleCount: 0,
    updateCount: 0,
  }
}

function getPoint(frame: DenseSpatialPointFrame, index: number): SpatialPoint {
  return {
    x: frame.points[index * 3],
    y: frame.points[index * 3 + 1],
    z: frame.points[index * 3 + 2],
  }
}

function isContinuous(
  frame: DenseSpatialPointFrame,
  firstIndex: number,
  secondIndex: number,
): boolean {
  const firstOffset = firstIndex * 3
  const secondOffset = secondIndex * 3
  const firstDepth = frame.distancesMeters[firstIndex]
  const secondDepth = frame.distancesMeters[secondIndex]
  const firstX = frame.points[firstOffset]
  const firstY = frame.points[firstOffset + 1]
  const firstZ = frame.points[firstOffset + 2]
  const secondX = frame.points[secondOffset]
  const secondY = frame.points[secondOffset + 1]
  const secondZ = frame.points[secondOffset + 2]

  return (
    Number.isFinite(firstX) &&
    Number.isFinite(firstY) &&
    Number.isFinite(firstZ) &&
    Number.isFinite(secondX) &&
    Number.isFinite(secondY) &&
    Number.isFinite(secondZ) &&
    Number.isFinite(firstDepth) &&
    Number.isFinite(secondDepth) &&
    Math.abs(firstDepth - secondDepth) <= MAX_DEPTH_DISCONTINUITY_METERS &&
    Math.hypot(firstX - secondX, firstY - secondY, firstZ - secondZ) <=
      MAX_NEIGHBOR_SPAN_METERS
  )
}

function getColor(
  state: CoverageCellState | null,
): readonly [number, number, number, number] {
  if (!state) {
    return [
      ...COVERAGE_VISUAL_COLORS.observed,
      COVERAGE_VISUAL_OPACITY.candidate,
    ]
  }

  return [
    ...COVERAGE_VISUAL_COLORS[state],
    state === 'captured'
      ? COVERAGE_VISUAL_OPACITY.captured
      : state === 'partial'
        ? COVERAGE_VISUAL_OPACITY.partial
        : COVERAGE_VISUAL_OPACITY.observed,
  ]
}

function appendFrameVertex(
  data: Float32Array,
  offset: number,
  frame: DenseSpatialPointFrame,
  index: number,
  color: readonly [number, number, number, number],
): number {
  const pointOffset = index * 3
  data[offset] = frame.points[pointOffset]
  data[offset + 1] = frame.points[pointOffset + 1]
  data[offset + 2] = frame.points[pointOffset + 2]
  data[offset + 3] = color[0]
  data[offset + 4] = color[1]
  data[offset + 5] = color[2]
  data[offset + 6] = color[3]
  return offset + FLOATS_PER_VERTEX
}

function appendTriangle(
  data: Float32Array,
  offset: number,
  frame: DenseSpatialPointFrame,
  sampleStates: readonly (CoverageCellState | null)[],
  firstIndex: number,
  secondIndex: number,
  thirdIndex: number,
  diagnostics: SpatialCoverageDenseDebug,
): number {
  if (
    frame.valid[firstIndex] !== 1 ||
    frame.valid[secondIndex] !== 1 ||
    frame.valid[thirdIndex] !== 1
  ) {
    diagnostics.rejectedInvalidSampleCount += 1
    return offset
  }

  if (
    !isContinuous(frame, firstIndex, secondIndex) ||
    !isContinuous(frame, secondIndex, thirdIndex) ||
    !isContinuous(frame, thirdIndex, firstIndex)
  ) {
    diagnostics.rejectedDepthDiscontinuityCount += 1
    return offset
  }

  const firstState = sampleStates[firstIndex]
  const secondState = sampleStates[secondIndex]
  const thirdState = sampleStates[thirdIndex]
  if (
    firstState === 'captured' &&
    secondState === 'captured' &&
    thirdState === 'captured'
  ) {
    return offset
  }

  let nextOffset = appendFrameVertex(
    data,
    offset,
    frame,
    firstIndex,
    getColor(firstState),
  )
  nextOffset = appendFrameVertex(
    data,
    nextOffset,
    frame,
    secondIndex,
    getColor(secondState),
  )
  nextOffset = appendFrameVertex(
    data,
    nextOffset,
    frame,
    thirdIndex,
    getColor(thirdState),
  )
  diagnostics.generatedTriangleCount += 1
  return nextOffset
}

/**
 * Builds a bounded current-frame surface mesh. It owns no XR resources and
 * never stores a historical point cloud; persistent state is queried from the
 * sparse world-space coverage service for each current sample.
 */
export class DenseSurfaceMaskService {
  private diagnostics = createInitialDiagnostics()

  private vertexData = new Float32Array(0)

  private revision = 0

  public build(
    frame: DenseSpatialPointFrame,
    coverageService: SpatialCoverageService,
  ): DenseCoverageMesh {
    const sampleStates = new Array<CoverageCellState | null>(
      frame.columns * frame.rows,
    ).fill(null)
    const diagnostics = createInitialDiagnostics()
    diagnostics.columns = frame.columns
    diagnostics.rows = frame.rows
    diagnostics.attemptedSampleCount = frame.attemptedSampleCount
    diagnostics.validSampleCount = frame.validPointCount

    for (let index = 0; index < sampleStates.length; index += 1) {
      if (frame.valid[index] !== 1) {
        diagnostics.rejectedInvalidSampleCount += 1
        continue
      }

      const state = coverageService.getCoverageStateAtPoint(getPoint(frame, index))
      sampleStates[index] = state
      if (state === null) {
        diagnostics.unknownMaskSampleCount += 1
      } else if (state === 'observed') {
        diagnostics.observedMaskSampleCount += 1
      } else if (state === 'partial') {
        diagnostics.partialMaskSampleCount += 1
      } else {
        diagnostics.capturedMaskSampleCount += 1
      }
    }

    const maximumTriangles = Math.max(0, (frame.columns - 1) * (frame.rows - 1) * 2)
    const requiredFloats = maximumTriangles * 3 * FLOATS_PER_VERTEX
    if (this.vertexData.length < requiredFloats) {
      this.vertexData = new Float32Array(requiredFloats)
    }

    let offset = 0
    for (let row = 0; row < frame.rows - 1; row += 1) {
      for (let column = 0; column < frame.columns - 1; column += 1) {
        const topLeft = row * frame.columns + column
        const topRight = topLeft + 1
        const bottomLeft = topLeft + frame.columns
        const bottomRight = bottomLeft + 1

        offset = appendTriangle(
          this.vertexData,
          offset,
          frame,
          sampleStates,
          topLeft,
          bottomLeft,
          topRight,
          diagnostics,
        )
        offset = appendTriangle(
          this.vertexData,
          offset,
          frame,
          sampleStates,
          topRight,
          bottomLeft,
          bottomRight,
          diagnostics,
        )
      }
    }

    diagnostics.updateCount = this.diagnostics.updateCount + 1
    this.diagnostics = diagnostics
    this.revision += 1

    return {
      revision: this.revision,
      vertexData: this.vertexData.subarray(0, offset),
      vertexCount: offset / FLOATS_PER_VERTEX,
    }
  }

  public getDiagnostics(): SpatialCoverageDenseDebug {
    return { ...this.diagnostics }
  }

  public reset(): void {
    this.diagnostics = createInitialDiagnostics()
    this.vertexData = new Float32Array(0)
    this.revision = 0
  }

  public dispose(): void {
    this.reset()
  }
}

import type {
  LivePerformanceDebug,
  LivePerformanceWindowDebug,
} from '../types'

const ROLLING_FRAME_CAPACITY = 120
const WINDOW_COUNT = 4
const STAGE_COUNT = 9

export type LivePerformanceStage =
  | 'depthAcquisition'
  | 'candidateGeneration'
  | 'normalFiltering'
  | 'fusionUpdate'
  | 'coverageUpdate'
  | 'candidateVisualization'
  | 'persistentRenderPreparation'
  | 'webGlDraw'
  | 'reactDiagnostics'

export interface LivePerformanceCounts {
  activeSurfelCount: number
  renderedSurfelCount: number
  candidatePatchCount: number
  coverageCellCount: number
}

const WINDOW_LABELS: LivePerformanceWindowDebug['label'][] = [
  '0-10 s',
  '10-20 s',
  '20-40 s',
  '40+ s',
]

function getPerformanceTimestamp(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function getStageIndex(stage: LivePerformanceStage): number {
  switch (stage) {
    case 'depthAcquisition':
      return 0
    case 'candidateGeneration':
      return 1
    case 'normalFiltering':
      return 2
    case 'fusionUpdate':
      return 3
    case 'coverageUpdate':
      return 4
    case 'candidateVisualization':
      return 5
    case 'persistentRenderPreparation':
      return 6
    case 'webGlDraw':
      return 7
    case 'reactDiagnostics':
      return 8
  }
}

function getWindowIndex(elapsedMs: number): number {
  if (elapsedMs < 10_000) {
    return 0
  }
  if (elapsedMs < 20_000) {
    return 1
  }
  if (elapsedMs < 40_000) {
    return 2
  }
  return 3
}

function percentage(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0
}

function createEmptyCounts(): LivePerformanceCounts {
  return {
    activeSurfelCount: 0,
    renderedSurfelCount: 0,
    candidatePatchCount: 0,
    coverageCellCount: 0,
  }
}

/**
 * Allocation-light rolling telemetry for the active XR session. Recording a
 * frame or stage only writes into fixed typed arrays; diagnostic objects are
 * materialized at the existing throttled publication cadence.
 */
export class LivePerformanceTracker {
  private readonly frameTimes = new Float64Array(ROLLING_FRAME_CAPACITY)

  private readonly frameIntervals = new Float64Array(ROLLING_FRAME_CAPACITY)

  private readonly stageDurations = new Float64Array(ROLLING_FRAME_CAPACITY * STAGE_COUNT)

  private readonly stageRunCounts = new Uint16Array(ROLLING_FRAME_CAPACITY * STAGE_COUNT)

  private readonly currentStageDurations = new Float64Array(STAGE_COUNT)

  private readonly currentStageRunCounts = new Uint16Array(STAGE_COUNT)

  private readonly frameSortScratch = new Float64Array(ROLLING_FRAME_CAPACITY)

  private readonly windowFrameCounts = new Uint32Array(WINDOW_COUNT)

  private readonly windowSlowFrameCounts = new Uint32Array(WINDOW_COUNT)

  private readonly windowFrameTimeTotals = new Float64Array(WINDOW_COUNT)

  private readonly windowFirstTimestamps = new Float64Array(WINDOW_COUNT)

  private readonly windowLastTimestamps = new Float64Array(WINDOW_COUNT)

  private sessionStartedAt: number | null = null

  private currentFrameStartedAt: number | null = null

  private currentFrameTimestamp: number | null = null

  private lastFrameTimestamp: number | null = null

  private writeIndex = 0

  private sampleCount = 0

  private rollingFrameTimeTotal = 0

  private rollingFrameIntervalTotal = 0

  private rollingFrameIntervalCount = 0

  private rollingDroppedFrameCount = 0

  private rollingOver16Point7MsCount = 0

  private rollingOver22MsCount = 0

  private rollingOver33MsCount = 0

  private readonly rollingStageDurationTotals = new Float64Array(STAGE_COUNT)

  private readonly rollingStageRunCounts = new Uint32Array(STAGE_COUNT)

  public reset(sessionStartedAt = getPerformanceTimestamp()): void {
    this.frameTimes.fill(0)
    this.frameIntervals.fill(0)
    this.stageDurations.fill(0)
    this.stageRunCounts.fill(0)
    this.currentStageDurations.fill(0)
    this.currentStageRunCounts.fill(0)
    this.windowFrameCounts.fill(0)
    this.windowSlowFrameCounts.fill(0)
    this.windowFrameTimeTotals.fill(0)
    this.windowFirstTimestamps.fill(-1)
    this.windowLastTimestamps.fill(-1)
    this.sessionStartedAt = sessionStartedAt
    this.currentFrameStartedAt = null
    this.currentFrameTimestamp = null
    this.lastFrameTimestamp = null
    this.writeIndex = 0
    this.sampleCount = 0
    this.rollingFrameTimeTotal = 0
    this.rollingFrameIntervalTotal = 0
    this.rollingFrameIntervalCount = 0
    this.rollingDroppedFrameCount = 0
    this.rollingOver16Point7MsCount = 0
    this.rollingOver22MsCount = 0
    this.rollingOver33MsCount = 0
    this.rollingStageDurationTotals.fill(0)
    this.rollingStageRunCounts.fill(0)
  }

  public beginFrame(frameTimestamp: number, startedAt = getPerformanceTimestamp()): void {
    this.currentFrameTimestamp = frameTimestamp
    this.currentFrameStartedAt = startedAt
    this.currentStageDurations.fill(0)
    this.currentStageRunCounts.fill(0)
  }

  public recordStage(stage: LivePerformanceStage, durationMs: number): void {
    if (this.currentFrameStartedAt === null || !Number.isFinite(durationMs) || durationMs < 0) {
      return
    }

    const stageIndex = getStageIndex(stage)
    this.currentStageDurations[stageIndex] += durationMs
    this.currentStageRunCounts[stageIndex] += 1
  }

  public endFrame(frameTimestamp = this.currentFrameTimestamp ?? 0, finishedAt = getPerformanceTimestamp()): void {
    if (this.currentFrameStartedAt === null) {
      return
    }

    const frameTimeMs = Math.max(0, finishedAt - this.currentFrameStartedAt)
    const frameIntervalMs = this.lastFrameTimestamp === null
      ? 0
      : Math.max(0, frameTimestamp - this.lastFrameTimestamp)
    const slot = this.writeIndex
    if (this.sampleCount === ROLLING_FRAME_CAPACITY) {
      this.removeRollingSample(slot)
    } else {
      this.sampleCount += 1
    }

    this.frameTimes[slot] = frameTimeMs
    this.frameIntervals[slot] = frameIntervalMs
    this.rollingFrameTimeTotal += frameTimeMs
    if (frameIntervalMs > 0) {
      this.rollingFrameIntervalTotal += frameIntervalMs
      this.rollingFrameIntervalCount += 1
    }
    if (frameTimeMs > 16.7) {
      this.rollingOver16Point7MsCount += 1
    }
    if (frameTimeMs > 22) {
      this.rollingOver22MsCount += 1
    }
    if (frameTimeMs > 33) {
      this.rollingOver33MsCount += 1
      this.rollingDroppedFrameCount += 1
    }
    for (let stageIndex = 0; stageIndex < STAGE_COUNT; stageIndex += 1) {
      const duration = this.currentStageDurations[stageIndex]
      const runCount = this.currentStageRunCounts[stageIndex]
      const stageOffset = slot * STAGE_COUNT + stageIndex
      this.stageDurations[stageOffset] = duration
      this.stageRunCounts[stageOffset] = runCount
      this.rollingStageDurationTotals[stageIndex] += duration
      this.rollingStageRunCounts[stageIndex] += runCount
    }

    const sessionElapsedMs = this.sessionStartedAt === null
      ? 0
      : Math.max(0, finishedAt - this.sessionStartedAt)
    const windowIndex = getWindowIndex(sessionElapsedMs)
    this.windowFrameCounts[windowIndex] += 1
    this.windowFrameTimeTotals[windowIndex] += frameTimeMs
    if (frameTimeMs > 33) {
      this.windowSlowFrameCounts[windowIndex] += 1
    }
    if (this.windowFirstTimestamps[windowIndex] < 0) {
      this.windowFirstTimestamps[windowIndex] = frameTimestamp
    }
    this.windowLastTimestamps[windowIndex] = frameTimestamp

    this.writeIndex = (slot + 1) % ROLLING_FRAME_CAPACITY
    this.lastFrameTimestamp = frameTimestamp
    this.currentFrameStartedAt = null
    this.currentFrameTimestamp = null
  }

  public getDiagnostics(now = getPerformanceTimestamp(), counts: LivePerformanceCounts = createEmptyCounts()): LivePerformanceDebug {
    const frameCount = this.sampleCount
    const averageFrameIntervalMs = this.rollingFrameIntervalCount > 0
      ? this.rollingFrameIntervalTotal / this.rollingFrameIntervalCount
      : 0
    const performanceWindows = WINDOW_LABELS.map((label, index) => {
      const windowFrameCount = this.windowFrameCounts[index]
      const timestampSpanMs = this.windowLastTimestamps[index] - this.windowFirstTimestamps[index]
      return {
        label,
        frameCount: windowFrameCount,
        averageFrameTimeMs: windowFrameCount > 0
          ? this.windowFrameTimeTotals[index] / windowFrameCount
          : 0,
        fps: timestampSpanMs > 0
          ? ((windowFrameCount - 1) * 1000) / timestampSpanMs
          : 0,
        slowFramePercentage: percentage(this.windowSlowFrameCounts[index], windowFrameCount),
      }
    })

    return {
      frameCount,
      fps: averageFrameIntervalMs > 0 ? 1000 / averageFrameIntervalMs : 0,
      averageFrameIntervalMs,
      averageFrameTimeMs: frameCount > 0 ? this.rollingFrameTimeTotal / frameCount : 0,
      p95FrameTimeMs: this.getP95FrameTime(frameCount),
      droppedFrameCount: this.rollingDroppedFrameCount,
      frameOver16Point7MsCount: this.rollingOver16Point7MsCount,
      frameOver22MsCount: this.rollingOver22MsCount,
      frameOver33MsCount: this.rollingOver33MsCount,
      frameOver16Point7MsPercentage: percentage(this.rollingOver16Point7MsCount, frameCount),
      frameOver22MsPercentage: percentage(this.rollingOver22MsCount, frameCount),
      frameOver33MsPercentage: percentage(this.rollingOver33MsCount, frameCount),
      depthAcquisitionMs: this.getStageAverage(0),
      candidateGenerationMs: this.getStageAverage(1),
      normalFilteringMs: this.getStageAverage(2),
      fusionUpdateMs: this.getStageAverage(3),
      coverageUpdateMs: this.getStageAverage(4),
      candidateVisualizationMs: this.getStageAverage(5),
      persistentRenderPreparationMs: this.getStageAverage(6),
      webGlDrawMs: this.getStageAverage(7),
      reactDiagnosticsMs: this.getStageAverage(8),
      activeSurfelCount: counts.activeSurfelCount,
      renderedSurfelCount: counts.renderedSurfelCount,
      candidatePatchCount: counts.candidatePatchCount,
      coverageCellCount: counts.coverageCellCount,
      xrSessionElapsedMs: this.sessionStartedAt === null ? 0 : Math.max(0, now - this.sessionStartedAt),
      performanceWindows,
    }
  }

  private removeRollingSample(slot: number): void {
    const oldFrameTime = this.frameTimes[slot]
    const oldFrameInterval = this.frameIntervals[slot]
    this.rollingFrameTimeTotal -= oldFrameTime
    if (oldFrameInterval > 0) {
      this.rollingFrameIntervalTotal -= oldFrameInterval
      this.rollingFrameIntervalCount = Math.max(0, this.rollingFrameIntervalCount - 1)
    }
    if (oldFrameTime > 16.7) {
      this.rollingOver16Point7MsCount = Math.max(0, this.rollingOver16Point7MsCount - 1)
    }
    if (oldFrameTime > 22) {
      this.rollingOver22MsCount = Math.max(0, this.rollingOver22MsCount - 1)
    }
    if (oldFrameTime > 33) {
      this.rollingOver33MsCount = Math.max(0, this.rollingOver33MsCount - 1)
      this.rollingDroppedFrameCount = Math.max(0, this.rollingDroppedFrameCount - 1)
    }
    for (let stageIndex = 0; stageIndex < STAGE_COUNT; stageIndex += 1) {
      const stageOffset = slot * STAGE_COUNT + stageIndex
      this.rollingStageDurationTotals[stageIndex] -= this.stageDurations[stageOffset]
      this.rollingStageRunCounts[stageIndex] = Math.max(
        0,
        this.rollingStageRunCounts[stageIndex] - this.stageRunCounts[stageOffset],
      )
    }
  }

  private getStageAverage(stageIndex: number): number {
    const runCount = this.rollingStageRunCounts[stageIndex]
    return runCount > 0 ? this.rollingStageDurationTotals[stageIndex] / runCount : 0
  }

  private getP95FrameTime(frameCount: number): number {
    if (frameCount === 0) {
      return 0
    }

    for (let index = 0; index < frameCount; index += 1) {
      this.frameSortScratch[index] = this.frameTimes[index]
    }
    for (let index = 1; index < frameCount; index += 1) {
      const value = this.frameSortScratch[index]
      let insertIndex = index - 1
      while (insertIndex >= 0 && this.frameSortScratch[insertIndex] > value) {
        this.frameSortScratch[insertIndex + 1] = this.frameSortScratch[insertIndex]
        insertIndex -= 1
      }
      this.frameSortScratch[insertIndex + 1] = value
    }
    return this.frameSortScratch[Math.max(0, Math.ceil(frameCount * 0.95) - 1)]
  }
}

export function createInitialLivePerformanceDebug(): LivePerformanceDebug {
  return new LivePerformanceTracker().getDiagnostics(0)
}

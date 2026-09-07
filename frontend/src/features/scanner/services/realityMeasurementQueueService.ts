export interface RealityMeasurementQueueDiagnostics {
  readonly enqueuedPackets: number
  readonly processingPackets: number
  readonly completedPackets: number
  readonly failedPackets: number
  readonly packetsReplaced: number
  readonly packetsDropped: number
  readonly queueDepth: number
  readonly maximumQueueDepth: number
  readonly latencyP50Ms: number
  readonly latencyP95Ms: number
  readonly latencyMaxMs: number
  readonly processingP50Ms: number
  readonly processingP95Ms: number
  readonly processingMaxMs: number
  readonly stageTimings: Readonly<Record<RealityDeferredStage, RealityStageTiming>>
}

export type RealityDeferredStage =
  | 'depth-capture'
  | 'world-reconstruction'
  | 'packet-validation'
  | 'rgb-registration'
  | 'appearance-copy'
  | 'coverage'
  | 'persistent-surface'
  | 'dense-fusion'
  | 'render-preparation'
export interface RealityStageTiming { readonly p50Ms: number; readonly p95Ms: number; readonly maxMs: number }

interface PendingMeasurement<T> {
  readonly value: T
  readonly enqueuedAt: number
}

type Scheduler = (callback: () => void) => void

const now = (): number => typeof performance === 'undefined' ? Date.now() : performance.now()

function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

/**
 * Latest-only asynchronous handoff for immutable measurement packets. One
 * packet may be processing and one may wait; a newer packet atomically
 * replaces the waiting packet so stale XR work can never accumulate.
 */
export class RealityMeasurementQueueService<T> {
  private readonly processor: (value: T) => void | Promise<void>
  private readonly scheduler: Scheduler
  private readonly clock: () => number
  private pending: PendingMeasurement<T> | null = null
  private processing = false
  private scheduled = false
  private disposed = false
  private flushResolvers: Array<() => void> = []
  private latencies: number[] = []
  private processingDurations: number[] = []
  private readonly stageDurations: Record<RealityDeferredStage, number[]> = {
    'depth-capture': [], 'world-reconstruction': [], 'packet-validation': [],
    'rgb-registration': [], 'appearance-copy': [], coverage: [],
    'persistent-surface': [], 'dense-fusion': [], 'render-preparation': [],
  }
  private enqueuedPackets = 0
  private completedPackets = 0
  private failedPackets = 0
  private packetsReplaced = 0
  private packetsDropped = 0
  private maximumQueueDepth = 0

  public constructor(
    processor: (value: T) => void | Promise<void>,
    scheduler: Scheduler = (callback) => { setTimeout(callback, 0) },
    clock: () => number = now,
  ) {
    this.processor = processor
    this.scheduler = scheduler
    this.clock = clock
  }

  public enqueue(value: T): 'queued' | 'replaced' | 'dropped' {
    if (this.disposed) {
      this.packetsDropped += 1
      return 'dropped'
    }
    this.enqueuedPackets += 1
    const item = { value, enqueuedAt: this.clock() }
    if (this.pending) {
      this.pending = item
      this.packetsReplaced += 1
      this.packetsDropped += 1
      this.maximumQueueDepth = Math.max(this.maximumQueueDepth, this.getQueueDepth())
      this.schedule()
      return 'replaced'
    } else {
      this.pending = item
    }
    this.maximumQueueDepth = Math.max(this.maximumQueueDepth, this.getQueueDepth())
    this.schedule()
    return 'queued'
  }

  public flush(): Promise<void> {
    if (!this.processing && !this.pending && !this.scheduled) return Promise.resolve()
    return new Promise((resolve) => this.flushResolvers.push(resolve))
  }

  public reset(): void {
    if (this.pending) this.packetsDropped += 1
    this.pending = null
    this.scheduled = false
    this.disposed = false
    this.latencies = []
    this.processingDurations = []
    for (const values of Object.values(this.stageDurations)) values.length = 0
    this.enqueuedPackets = 0
    this.completedPackets = 0
    this.failedPackets = 0
    this.packetsReplaced = 0
    this.packetsDropped = 0
    this.maximumQueueDepth = 0
    this.resolveFlushesIfIdle()
  }

  public dispose(): void {
    if (this.pending) this.packetsDropped += 1
    this.pending = null
    this.disposed = true
    this.resolveFlushesIfIdle()
  }

  public getDiagnostics(): RealityMeasurementQueueDiagnostics {
    const stageTimings = Object.fromEntries(Object.entries(this.stageDurations).map(([stage, values]) => [stage, {
      p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), maxMs: values.length ? Math.max(...values) : 0,
    }])) as unknown as Readonly<Record<RealityDeferredStage, RealityStageTiming>>
    return {
      enqueuedPackets: this.enqueuedPackets,
      processingPackets: this.processing ? 1 : 0,
      completedPackets: this.completedPackets,
      failedPackets: this.failedPackets,
      packetsReplaced: this.packetsReplaced,
      packetsDropped: this.packetsDropped,
      queueDepth: this.getQueueDepth(),
      maximumQueueDepth: this.maximumQueueDepth,
      latencyP50Ms: percentile(this.latencies, .5),
      latencyP95Ms: percentile(this.latencies, .95),
      latencyMaxMs: this.latencies.length ? Math.max(...this.latencies) : 0,
      processingP50Ms: percentile(this.processingDurations, .5),
      processingP95Ms: percentile(this.processingDurations, .95),
      processingMaxMs: this.processingDurations.length ? Math.max(...this.processingDurations) : 0,
      stageTimings,
    }
  }

  public recordStage(stage: RealityDeferredStage, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return
    this.pushBounded(this.stageDurations[stage], durationMs)
  }

  private getQueueDepth(): number {
    return (this.processing ? 1 : 0) + (this.pending ? 1 : 0)
  }

  private schedule(): void {
    if (this.scheduled || this.processing || !this.pending || this.disposed) return
    this.scheduled = true
    this.scheduler(() => {
      this.scheduled = false
      void this.drainOne()
    })
  }

  private async drainOne(): Promise<void> {
    if (this.processing || !this.pending || this.disposed) {
      this.resolveFlushesIfIdle()
      return
    }
    const item = this.pending
    this.pending = null
    this.processing = true
    const startedAt = this.clock()
    this.pushBounded(this.latencies, Math.max(0, startedAt - item.enqueuedAt))
    try {
      await this.processor(item.value)
      this.completedPackets += 1
    } catch {
      this.failedPackets += 1
    } finally {
      this.pushBounded(this.processingDurations, Math.max(0, this.clock() - startedAt))
      this.processing = false
      this.schedule()
      this.resolveFlushesIfIdle()
    }
  }

  private pushBounded(target: number[], value: number): void {
    if (target.length >= 128) target.shift()
    target.push(value)
  }

  private resolveFlushesIfIdle(): void {
    if (this.processing || this.pending || this.scheduled) return
    const resolvers = this.flushResolvers
    this.flushResolvers = []
    resolvers.forEach((resolve) => resolve())
  }
}

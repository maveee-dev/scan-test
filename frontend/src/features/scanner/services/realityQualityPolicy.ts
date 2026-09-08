import type { SpatialPoint } from '../types'

export const DEPTH_TIERS = [{ columns: 80, rows: 45 }, { columns: 96, rows: 54 }, { columns: 120, rows: 68 }] as const
export const DEPTH_PHASES = [[0.25, 0.25], [0.75, 0.75], [0.75, 0.25], [0.25, 0.75]] as const
export interface ScanTrajectoryPoint { position: SpatialPoint; orientation: { x: number; y: number; z: number; w: number }; timestamp: number }
export interface RealityQualityTelemetry {
  tier: number; phase: number; ticks: number; attempted: number; valid: number; processingMs: number
  translationMeters: number; rotationDegrees: number; distanceWalkedMeters: number; skippedStationaryTicks: number
  xrFrameIntervalMs?: number
  columns?: number; rows?: number
  trajectory: readonly ScanTrajectoryPoint[]
}

export type AppearanceCaptureDecisionReason =
  | 'stable-opportunity'
  | 'queue-pressure'
  | 'xr-timing-pressure'
  | 'processing-pressure'

export interface AppearanceCaptureDecision {
  readonly allowed: boolean
  readonly reason: AppearanceCaptureDecisionReason
}

/** Timing feedback uses whole processing ticks, with slow-down hysteresis. */
export class RealityQualityPolicy {
  private tier = 0
  private fastTicks = 0
  private slowTicks = 0
  private tick = 0
  private samplingTick = 0
  private lastFusion: ScanTrajectoryPoint | null = null
  private lastFrameTime = 0
  private motion = { translationMetersPerSecond: 0, rotationDegreesPerSecond: 0 }
  private trail: ScanTrajectoryPoint[] = []
  private telemetry: RealityQualityTelemetry = { tier: 0, phase: 0, ticks: 0, attempted: 0, valid: 0, processingMs: 0, translationMeters: 0, rotationDegrees: 0, distanceWalkedMeters: 0, skippedStationaryTicks: 0, trajectory: [] }

  public observePose(point: ScanTrajectoryPoint): void {
    const last = this.trail.at(-1)
    if (last && point.timestamp - last.timestamp < 250) return
    const distance = last ? Math.hypot(point.position.x - last.position.x, point.position.y - last.position.y, point.position.z - last.position.z) : 0
    if (last && distance < 0.04 && Math.abs(quaternionDot(last.orientation, point.orientation)) > 0.998) return
    this.telemetry.distanceWalkedMeters += distance
    this.trail.push({ position: { ...point.position }, orientation: { ...point.orientation }, timestamp: point.timestamp })
    // Decimate history uniformly instead of dropping the beginning of a walk.
    if (this.trail.length > 1024) this.trail = this.trail.filter((_point, index) => index % 2 === 0)
  }

  public shouldProcess(point: ScanTrajectoryPoint): boolean {
    const last = this.lastFusion
    const translation = last ? Math.hypot(point.position.x - last.position.x, point.position.y - last.position.y, point.position.z - last.position.z) : 1
    const rotation = last ? 2 * Math.acos(Math.min(1, Math.abs(quaternionDot(last.orientation, point.orientation)))) * 180 / Math.PI : 180
    this.telemetry.translationMeters = translation; this.telemetry.rotationDegrees = rotation
    const seconds = last ? Math.max(.001, (point.timestamp - last.timestamp) / 1000) : 1
    this.motion = { translationMetersPerSecond: last ? translation / seconds : 0, rotationDegreesPerSecond: last ? rotation / seconds : 0 }
    // Complete a phase cycle before throttling stationary confirmation.
    if (last && this.tick >= 8 && translation < 0.012 && rotation < 1 && point.timestamp - last.timestamp < 700) {
      this.telemetry.skippedStationaryTicks++; return false
    }
    this.lastFusion = { ...point, position: { ...point.position }, orientation: { ...point.orientation } }
    return true
  }

  public sampling(viewAspect?: number): { columns: number; rows: number; phase: number } {
    // RGB is copied every second tick. Advancing after TWO ticks ensures all
    // four subgrids reach RGB-D fusion rather than aliasing into two phases.
    const tier = DEPTH_TIERS[this.tier]
    if (viewAspect !== undefined && Number.isFinite(viewAspect) && viewAspect >= .2 && viewAspect <= 5) {
      const budget = tier.columns * tier.rows, columns = Math.max(16, Math.round(Math.sqrt(budget * viewAspect)))
      return { columns, rows: Math.floor(budget / columns), phase: Math.floor(this.samplingTick / 2) % DEPTH_PHASES.length }
    }
    return { ...tier, phase: Math.floor(this.samplingTick / 2) % DEPTH_PHASES.length }
  }

  /** Reserves a frame-local phase before a packet can enter backpressure. */
  public claimSampling(viewAspect?: number): { columns: number; rows: number; phase: number } {
    const sampling = this.sampling(viewAspect)
    this.samplingTick += 1
    return sampling
  }

  /**
   * Gives the XR scheduler a non-mutating, attributable timing decision. The
   * limits are intentionally modestly wider than M8.7.1.2: an empty queue is
   * still the hard backpressure gate, while the cheaper bounded live path can
   * use stable ~40 ms frames without starving all appearance opportunities.
   */
  public appearanceCaptureDecision(queueDepth: number): AppearanceCaptureDecision {
    if (queueDepth > 0) return { allowed: false, reason: 'queue-pressure' }
    if ((this.telemetry.xrFrameIntervalMs ?? 0) >= 48) return { allowed: false, reason: 'xr-timing-pressure' }
    if (this.telemetry.processingMs >= 42) return { allowed: false, reason: 'processing-pressure' }
    return { allowed: true, reason: 'stable-opportunity' }
  }

  public getAppearanceCaptureDecision(queueDepth: number): AppearanceCaptureDecision {
    return this.appearanceCaptureDecision(queueDepth)
  }

  public shouldCaptureAppearance(queueDepth: number): boolean {
    return this.appearanceCaptureDecision(queueDepth).allowed
  }

  public recordTick(ms: number, attempted: number, valid: number, grid: { columns: number; rows: number; phase?: number } = DEPTH_TIERS[this.tier], phaseAlreadyClaimed = false): void {
    this.telemetry.columns = grid.columns; this.telemetry.rows = grid.rows
    this.telemetry.phase = grid.phase ?? this.sampling().phase
    this.tick++; if(!phaseAlreadyClaimed)this.samplingTick++; this.telemetry.ticks = this.tick
    this.telemetry.attempted += attempted; this.telemetry.valid += valid; this.telemetry.processingMs = ms
    this.fastTicks = ms < 12 && (this.telemetry.xrFrameIntervalMs ?? 0) < 26 ? this.fastTicks + 1 : 0
    this.slowTicks = ms > 26 ? this.slowTicks + 1 : 0
    if (this.slowTicks >= 2) { this.tier = Math.max(0, this.tier - 1); this.slowTicks = 0 }
    if (this.fastTicks >= 24) { this.tier = Math.min(2, this.tier + 1); this.fastTicks = 0 }
    this.telemetry.tier = this.tier
  }
  public recordFrame(time: number): void {
    if (this.lastFrameTime > 0) {
      const dt = time - this.lastFrameTime
      this.telemetry.xrFrameIntervalMs = (this.telemetry.xrFrameIntervalMs ?? dt) * .9 + Math.min(200, dt) * .1
      if (this.telemetry.xrFrameIntervalMs > 38) { this.tier = Math.max(0, this.tier - 1); this.fastTicks = 0 }
    }
    this.lastFrameTime = time
  }
  public appearanceMotion(): Readonly<typeof this.motion> { return this.motion }
  public snapshot(): RealityQualityTelemetry { return { ...this.telemetry, trajectory: this.trail.map((p) => ({ ...p, position: { ...p.position }, orientation: { ...p.orientation } })) } }
  public reset(): void { const fresh = new RealityQualityPolicy(); Object.assign(this, fresh) }
}

function quaternionDot(a: ScanTrajectoryPoint['orientation'], b: ScanTrajectoryPoint['orientation']): number { return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w }

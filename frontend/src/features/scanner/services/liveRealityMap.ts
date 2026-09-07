import type { ScanTrajectoryPoint } from './realityQualityPolicy'

export interface LiveMapFrame { pose: ScanTrajectoryPoint; copy: (positions: Float32Array, colors: Float32Array) => number; underPressure?: boolean }
export const getLiveMapCadenceMs = (underPressure: boolean): { render: number; geometryCopy: number } => underPressure
  ? { render: 100, geometryCopy: 900 }
  : { render: 33, geometryCopy: 350 }
/** One-way physical-pose publisher. No API writes to XR or reconstruction. */
export class LiveRealityMap {
  public listener: ((frame: LiveMapFrame) => void) | null = null
  private onError: ((message: string) => void) | null = null
  public subscribe(listener: (frame: LiveMapFrame) => void, onError?: (message: string) => void): () => void {
    this.listener = listener
    this.onError = onError ?? null
    return () => { if (this.listener === listener) { this.listener = null; this.onError = null } }
  }
  public publish(frame: LiveMapFrame): void {
    try { this.listener?.(frame) } catch {
      this.listener = null
      this.onError?.('Live map rendering failed. AR capture remains active; return to AR Scan View.')
      this.onError = null
    }
  }
  public reset(): void { this.listener = null; this.onError = null }
}

export class InspectionPose {
  public position = { x: 0, y: 1.5, z: 0 }
  public yaw = 0
  public pitch = 0
  public follow = true
  public updateScanner(pose: ScanTrajectoryPoint): void {
    if (!this.follow) return
    this.position = { ...pose.position }
    const q = pose.orientation
    this.yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))
    this.pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.x - q.y * q.z))))
  }
  public look(dx: number, dy: number): void {
    if (this.follow) return
    this.yaw -= dx * 0.004; this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy * 0.004))
  }
  public move(strafe: number, forward: number, seconds: number, blocked: (x: number, y: number, z: number) => boolean = () => false): void {
    if (this.follow) return
    const dt = Math.min(0.05, Math.max(0, seconds)), length = Math.max(1, Math.hypot(strafe, forward))
    const x = this.position.x + (Math.cos(this.yaw) * strafe - Math.sin(this.yaw) * forward) / length * dt
    const z = this.position.z + (-Math.sin(this.yaw) * strafe - Math.cos(this.yaw) * forward) / length * dt
    if (!blocked(x, this.position.y, z)) this.position = { ...this.position, x, z }
  }
}

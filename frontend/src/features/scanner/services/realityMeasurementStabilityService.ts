import type { DenseDepthFrameObservation, DenseSpatialPointFrame, ScannerReferenceSpaceType, SpatialPoint } from '../types'
import type { ScanTrajectoryPoint } from './realityQualityPolicy'

export type RealityMeasurementRejectionReason = 'none' | 'tracking' | 'motion' | 'pose-discontinuity' | 'reference-space-reset' | 'depth' | 'consistency'
export type ScanQualityGuidance = 'good' | 'move-slower' | 'tracking-unstable' | 'scan-again' | 'move-around-object' | 'more-coverage'
export type ScanSpatialHealthStatus = 'healthy' | 'recovering' | 'invalid'
export type ScanSpatialHealthReason = 'none' | 'pose-discontinuity' | 'reference-space-reset' | 'repeated-discontinuities'
export interface ScanSpatialHealth {
  readonly status: ScanSpatialHealthStatus
  readonly finishAllowed: boolean
  readonly reason: ScanSpatialHealthReason
  readonly quarantineActive: boolean
  readonly poseEpochCount: number
  readonly acceptedPoseEpochCount: number
  readonly relocalizationLikeEvents: number
  readonly referenceSpaceResetCount: number
  readonly stableRecoveryFrames: number
}
export interface RealityFrameConsistency { consistentRatio: number; duplicateRatio: number; unknownRatio: number; establishedSamples: number }
export interface RealityMeasurementPacket {
  readonly sequence: number; readonly timestamp: number; readonly referenceSpaceType: ScannerReferenceSpaceType
  readonly samplingPhase: number; readonly qualityTier: number; readonly pose: ScanTrajectoryPoint
  readonly viewTransform: Float32Array; readonly inverseViewTransform: Float32Array; readonly projectionMatrix: Float32Array
  readonly depthProjectionMatrix: Float32Array | null; readonly depthTransformMatrix: Float32Array | null
  readonly depthWidth: number | null; readonly depthHeight: number | null; readonly depthScale: number | null
  readonly denseFrame: DenseSpatialPointFrame; readonly normals: Float32Array; readonly normalValid: Uint8Array
  readonly attempted: number; readonly valid: number; readonly validRatio: number; readonly medianDepth: number
  readonly p05Depth: number; readonly p95Depth: number; readonly discontinuityRatio: number; readonly isolatedOutlierRatio: number
}
export interface RealityFrameAcceptance { packet: RealityMeasurementPacket; accepted: boolean; reason: RealityMeasurementRejectionReason; trackingQuality: number; consistency: RealityFrameConsistency; trackingEpoch: number }
export interface RawRealityMeasurement { position: SpatialPoint; normal: SpatialPoint; timestamp: number; frameSequence: number; accepted: boolean; rejectionReason: RealityMeasurementRejectionReason }
export interface RealityMeasurementDiagnostics {
  candidateTicks: number; cadenceSkipped: number; backpressureSkipped: number
  ticksConsidered: number; accepted: number; fusedSuccessfully: number; producedNewSamples: number; matchedExistingSamples: number
  skippedTogether: number; motionRejected: number; trackingRejected: number
  depthRejected: number; poseDiscontinuityRejected: number; consistencyRejected: number; badDepthFrames: number
  depthRejectedMissing: number; depthRejectedValidRatio: number; depthRejectedSampleCount: number
  depthRejectedOutliers: number; depthRejectedDiscontinuity: number; depthRejectedRange: number
  largestTranslationMeters: number; largestRotationDegrees: number; largestVelocityMetersPerSecond: number
  translationP50Meters: number; translationP90Meters: number; translationP95Meters: number
  rotationP50Degrees: number; rotationP90Degrees: number; rotationP95Degrees: number
  largestAngularVelocityDegreesPerSecond: number; relocalizationLikeEvents: number; stableRecoveryFrames: number
  referenceSpaceResetCount: number; poseEpochCount: number; acceptedPoseEpochCount: number
  quarantineActive: boolean; scanSpatialValidity: ScanSpatialHealthStatus; scanSpatialValidityReason: ScanSpatialHealthReason
  validRatio: number; outlierRatio: number; medianDepthMeters: number; p95DepthMeters: number
  guidance: ScanQualityGuidance; validationMs: number
  acceptedPercentage: number; fusedPercentage: number; usefulPercentage: number
}

const MIN_VALID_SAMPLES = 96, MIN_VALID_RATIO = .18, MAX_RAW_MEASUREMENTS = 30000

/**
 * Spatial-validity policy calibrated against the available POCO translation
 * trace and deterministic motion/recovery fixtures. Keep this explicit so a
 * future device trace can change policy without hiding the boundary in the
 * frame evaluator.
 */
export const REALITY_SPATIAL_VALIDITY_CONFIG = Object.freeze({
  suspiciousJumpMaxIntervalSeconds: .75,
  suspiciousTranslationMeters: .45,
  suspiciousTranslationVelocityMetersPerSecond: 1,
  suspiciousRotationDegrees: 75,
  suspiciousAngularVelocityDegreesPerSecond: 180,
  motionMaxIntervalSeconds: .5,
  motionTranslationMeters: .35,
  motionTranslationVelocityMetersPerSecond: 2.8,
  motionRotationDegrees: 48,
  motionAngularVelocityDegreesPerSecond: 220,
  recoveryStableFrames: 3,
  recoveryTranslationMeters: .12,
  recoveryRotationDegrees: 15,
  recoveryConsistencyRatio: .32,
  repeatedDiscontinuityLimit: 2,
})
const copyMatrix = (value: ArrayLike<number> | null | undefined) => value ? new Float32Array(value) : null
const percentile = (sorted: readonly number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0
const quaternionDot = (a: ScanTrajectoryPoint['orientation'], b: ScanTrajectoryPoint['orientation']) => Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)

/** Owns frame-local copies and rejects a whole packet atomically before any map update. */
export class RealityMeasurementStabilityService {
  private lastAccepted: ScanTrajectoryPoint | null = null
  private lastSeen: ScanTrajectoryPoint | null = null
  private quarantine = false
  private recoveryFrames = 0
  private hardInvalid = false
  private referenceSpaceResetCount = 0
  private poseEpochCount = 1
  private acceptedPoseEpochs = new Set<number>()
  private scanSpatialValidityReason: ScanSpatialHealthReason = 'none'
  private raw: RawRealityMeasurement[] = []
  private translations: number[] = []
  private rotations: number[] = []
  private diagnostics: RealityMeasurementDiagnostics = this.createDiagnostics()

  public createPacket(input: {
    sequence: number; timestamp: number; referenceSpaceType: ScannerReferenceSpaceType; samplingPhase: number; qualityTier: number
    pose: ScanTrajectoryPoint; view: XRView; depth: DenseDepthFrameObservation; spatial: DenseSpatialPointFrame
    depthWidth: number | null; depthHeight: number | null; depthScale: number | null
  }): RealityMeasurementPacket {
    const valid = new Uint8Array(input.spatial.valid), normalizedX = new Float32Array(input.spatial.normalizedX)
    const normalizedY = new Float32Array(input.spatial.normalizedY), distancesMeters = new Float32Array(input.spatial.distancesMeters)
    const points = new Float32Array(input.spatial.points)
    const denseFrame: DenseSpatialPointFrame = Object.freeze({ columns: input.spatial.columns, rows: input.spatial.rows, valid,
      normalizedX, normalizedY, distancesMeters, points, attemptedSampleCount: input.spatial.attemptedSampleCount,
      validPointCount: input.spatial.validPointCount, rejectedPointCount: input.spatial.rejectedPointCount })
    const { normals, normalValid } = estimateGridNormals(denseFrame)
    const depthValues: number[] = []
    for (let i=0;i<valid.length;i++) if (valid[i] && Number.isFinite(distancesMeters[i]) && distancesMeters[i] > 0) depthValues.push(distancesMeters[i])
    depthValues.sort((a,b)=>a-b)
    const depthShape = inspectDepthGrid(denseFrame)
    const viewTransform = copyMatrix(input.view.transform.matrix) ?? new Float32Array(16)
    const inverseViewTransform = copyMatrix(input.view.transform.inverse.matrix) ?? new Float32Array(16)
    const projectionMatrix = copyMatrix(input.view.projectionMatrix) ?? new Float32Array(16)
    return Object.freeze({ sequence: input.sequence, timestamp: input.timestamp, referenceSpaceType: input.referenceSpaceType,
      samplingPhase: input.samplingPhase, qualityTier: input.qualityTier,
      pose: Object.freeze({ timestamp: input.pose.timestamp, position: Object.freeze({ ...input.pose.position }), orientation: Object.freeze({ ...input.pose.orientation }) }),
      viewTransform, inverseViewTransform, projectionMatrix,
      depthProjectionMatrix: copyMatrix(input.depth.depthProjectionMatrix), depthTransformMatrix: copyMatrix(input.depth.depthTransformMatrix),
      depthWidth: input.depthWidth, depthHeight: input.depthHeight, depthScale: input.depthScale, denseFrame, normals, normalValid,
      attempted: denseFrame.attemptedSampleCount, valid: denseFrame.validPointCount,
      validRatio: denseFrame.validPointCount / Math.max(1,denseFrame.attemptedSampleCount), medianDepth: percentile(depthValues,.5),
      p05Depth: percentile(depthValues,.05), p95Depth: percentile(depthValues,.95), ...depthShape })
  }

  public evaluate(packet: RealityMeasurementPacket, consistency: RealityFrameConsistency): RealityFrameAcceptance {
    const started = performance.now(); this.diagnostics.ticksConsidered++
    const previous = this.lastSeen, accepted = this.lastAccepted
    const dt = previous ? Math.max(.001,(packet.timestamp-previous.timestamp)/1000) : 1
    const translation = previous ? Math.hypot(packet.pose.position.x-previous.position.x,packet.pose.position.y-previous.position.y,packet.pose.position.z-previous.position.z) : 0
    const rotation = previous ? 2*Math.acos(Math.min(1,quaternionDot(packet.pose.orientation,previous.orientation)))*180/Math.PI : 0
    const velocity=translation/dt, angularVelocity=rotation/dt
    this.diagnostics.largestTranslationMeters=Math.max(this.diagnostics.largestTranslationMeters,translation)
    this.diagnostics.largestRotationDegrees=Math.max(this.diagnostics.largestRotationDegrees,rotation)
    this.diagnostics.largestVelocityMetersPerSecond=Math.max(this.diagnostics.largestVelocityMetersPerSecond,velocity)
    this.diagnostics.largestAngularVelocityDegreesPerSecond=Math.max(this.diagnostics.largestAngularVelocityDegreesPerSecond,angularVelocity)
    if(previous){if(this.translations.length>=512)this.translations.shift();if(this.rotations.length>=512)this.rotations.shift();this.translations.push(translation);this.rotations.push(rotation)}
    this.lastSeen=packet.pose
    let reason: RealityMeasurementRejectionReason='none'
    // A relocalization can be smaller than the old 0.75 m "impossible" jump,
    // yet still be far beyond a controlled phone scan. Quarantine the 0.45 m
    // class so a stable frame in a shifted coordinate island cannot enter the
    // retained map. Keep the earlier rotational boundary until a device trace
    // provides evidence of an angular reset: a coherent 45–70° room turn must
    // remain usable, while an abrupt 75°+ turn is still treated as a reset-like
    // discontinuity.
    const validityConfig = REALITY_SPATIAL_VALIDITY_CONFIG
    const suspiciousJump = previous !== null && dt < validityConfig.suspiciousJumpMaxIntervalSeconds && ((translation > validityConfig.suspiciousTranslationMeters && velocity > validityConfig.suspiciousTranslationVelocityMetersPerSecond) || (rotation > validityConfig.suspiciousRotationDegrees && angularVelocity > validityConfig.suspiciousAngularVelocityDegreesPerSecond))
    const unreliableMotion = previous !== null && dt < validityConfig.motionMaxIntervalSeconds && ((translation > validityConfig.motionTranslationMeters && velocity > validityConfig.motionTranslationVelocityMetersPerSecond) || (rotation > validityConfig.motionRotationDegrees && angularVelocity > validityConfig.motionAngularVelocityDegreesPerSecond))
    const depthFailure = packet.valid < MIN_VALID_SAMPLES ? 'sample-count'
      : packet.validRatio < MIN_VALID_RATIO ? 'valid-ratio'
        : !Number.isFinite(packet.medianDepth) || packet.medianDepth <= 0 || packet.p95Depth > 20 ? 'range'
          : packet.isolatedOutlierRatio > .28 ? 'outliers'
            : packet.discontinuityRatio > .72 ? 'discontinuity' : null
    const badDepth = depthFailure !== null
    if (this.hardInvalid) reason=this.referenceSpaceResetCount > 0 ? 'reference-space-reset' : 'tracking'
    else if (suspiciousJump) {
      reason='pose-discontinuity'; this.quarantine=true; this.recoveryFrames=0
      this.scanSpatialValidityReason='pose-discontinuity'; this.diagnostics.relocalizationLikeEvents++
      this.poseEpochCount += 1
      // Repeated excursions make a scan untrustworthy even if each excursion
      // is rejected locally; this is the Finish validity gate.
      if (this.diagnostics.relocalizationLikeEvents >= validityConfig.repeatedDiscontinuityLimit) {
        this.hardInvalid=true; this.scanSpatialValidityReason='repeated-discontinuities'
      }
    }
    else if (unreliableMotion) reason='motion'
    else if (badDepth) reason='depth'
    else if (this.quarantine) {
      const localStable = translation < validityConfig.recoveryTranslationMeters && rotation < validityConfig.recoveryRotationDegrees
      this.recoveryFrames = localStable ? this.recoveryFrames + 1 : 0
      // After a relocalization-like jump, only established-world agreement or
      // return near the last accepted pose can release quarantine.
      const returned = accepted ? Math.hypot(packet.pose.position.x-accepted.position.x,packet.pose.position.y-accepted.position.y,packet.pose.position.z-accepted.position.z) < .3 : true
      if (this.recoveryFrames >= validityConfig.recoveryStableFrames && (returned || consistency.consistentRatio >= validityConfig.recoveryConsistencyRatio)) {
        this.quarantine=false; this.scanSpatialValidityReason='none'
      }
      else reason='tracking'
    }
    if (reason==='none' && consistency.establishedSamples >= 32 && consistency.duplicateRatio > .58 && consistency.consistentRatio < .12) reason='consistency'
    const acceptedFrame=reason==='none'
    if (acceptedFrame) { this.lastAccepted=packet.pose; this.diagnostics.accepted++ }
    else if(reason==='motion')this.diagnostics.motionRejected++
    else if(reason==='tracking')this.diagnostics.trackingRejected++
    else if(reason==='depth'){
      this.diagnostics.depthRejected++;this.diagnostics.badDepthFrames++
      if(depthFailure==='sample-count')this.diagnostics.depthRejectedSampleCount++
      else if(depthFailure==='valid-ratio')this.diagnostics.depthRejectedValidRatio++
      else if(depthFailure==='outliers')this.diagnostics.depthRejectedOutliers++
      else if(depthFailure==='discontinuity')this.diagnostics.depthRejectedDiscontinuity++
      else this.diagnostics.depthRejectedRange++
    }
    else if(reason==='pose-discontinuity')this.diagnostics.poseDiscontinuityRejected++
    else if(reason==='reference-space-reset')this.diagnostics.trackingRejected++
    else this.diagnostics.consistencyRejected++
    if (acceptedFrame) this.acceptedPoseEpochs.add(0)
    this.diagnostics.referenceSpaceResetCount=this.referenceSpaceResetCount
    this.diagnostics.poseEpochCount=this.poseEpochCount
    this.diagnostics.acceptedPoseEpochCount=this.acceptedPoseEpochs.size
    this.diagnostics.quarantineActive=this.quarantine
    this.diagnostics.scanSpatialValidity=this.getScanHealth().status
    this.diagnostics.scanSpatialValidityReason=this.getScanHealth().reason
    this.diagnostics.stableRecoveryFrames=this.recoveryFrames;this.diagnostics.validRatio=packet.validRatio;this.diagnostics.outlierRatio=packet.isolatedOutlierRatio
    this.diagnostics.medianDepthMeters=packet.medianDepth;this.diagnostics.p95DepthMeters=packet.p95Depth
    this.diagnostics.guidance=reason==='motion'?'move-slower':reason==='tracking'||reason==='pose-discontinuity'?'tracking-unstable':reason==='depth'||reason==='consistency'?'scan-again':consistency.establishedSamples>0&&consistency.unknownRatio>.65?'more-coverage':consistency.establishedSamples>0&&consistency.consistentRatio>.75?'move-around-object':'good'
    this.diagnostics.validationMs=performance.now()-started
    this.captureRaw(packet,acceptedFrame,reason)
    // Accepted packets stay in epoch 0: no transform migration is attempted,
    // and quarantine must fully resolve before another packet can be retained.
    return { packet, accepted: acceptedFrame, reason, trackingQuality: acceptedFrame ? Math.max(.5,1-Math.min(1,velocity/3)*.3-Math.min(1,angularVelocity/240)*.2) : 0, consistency, trackingEpoch: 0 }
  }

  /** A native XRReferenceSpace reset changes the effective world origin. No
   * transform migration is attempted, so all prior measurements are invalid. */
  public recordReferenceSpaceReset(): void {
    this.referenceSpaceResetCount += 1
    this.hardInvalid = true
    this.quarantine = true
    this.recoveryFrames = 0
    this.poseEpochCount += 1
    this.scanSpatialValidityReason = 'reference-space-reset'
    this.diagnostics.referenceSpaceResetCount = this.referenceSpaceResetCount
    this.diagnostics.poseEpochCount = this.poseEpochCount
    this.diagnostics.quarantineActive = true
    this.diagnostics.scanSpatialValidity = 'invalid'
    this.diagnostics.scanSpatialValidityReason = this.scanSpatialValidityReason
  }

  public getScanHealth(): ScanSpatialHealth {
    const status: ScanSpatialHealthStatus = this.hardInvalid ? 'invalid' : this.quarantine ? 'recovering' : 'healthy'
    const reason = this.hardInvalid && this.referenceSpaceResetCount > 0 ? 'reference-space-reset' : this.hardInvalid ? 'repeated-discontinuities' : this.quarantine ? 'pose-discontinuity' : 'none'
    return { status, finishAllowed: status === 'healthy', reason, quarantineActive: this.quarantine,
      poseEpochCount: this.poseEpochCount, acceptedPoseEpochCount: this.acceptedPoseEpochs.size,
      relocalizationLikeEvents: this.diagnostics.relocalizationLikeEvents, referenceSpaceResetCount: this.referenceSpaceResetCount,
      stableRecoveryFrames: this.recoveryFrames }
  }

  public recordCandidateTick(): void { this.diagnostics.candidateTicks++ }
  public recordCadenceSkipped(): void { this.diagnostics.cadenceSkipped++ }
  public recordSkippedTogether(): void { this.diagnostics.skippedTogether++ }
  public recordBackpressureSkipped(): void { this.diagnostics.backpressureSkipped++ }
  public recordDepthMissing(): void { this.diagnostics.ticksConsidered++;this.diagnostics.depthRejected++;this.diagnostics.depthRejectedMissing++;this.diagnostics.badDepthFrames++;this.diagnostics.guidance='scan-again' }
  public recordFusion(created: number, matched: number): void { this.diagnostics.fusedSuccessfully++;this.diagnostics.producedNewSamples+=created;this.diagnostics.matchedExistingSamples+=matched }
  public recordTrackingMissing(): void { this.diagnostics.ticksConsidered++;this.diagnostics.trackingRejected++;this.diagnostics.guidance='tracking-unstable' }
  public getDiagnostics(): RealityMeasurementDiagnostics { const translations=[...this.translations].sort((a,b)=>a-b),rotations=[...this.rotations].sort((a,b)=>a-b),considered=Math.max(1,this.diagnostics.ticksConsidered);return { ...this.diagnostics,
    translationP50Meters:percentile(translations,.5),translationP90Meters:percentile(translations,.9),translationP95Meters:percentile(translations,.95),
    rotationP50Degrees:percentile(rotations,.5),rotationP90Degrees:percentile(rotations,.9),rotationP95Degrees:percentile(rotations,.95),
    acceptedPercentage:this.diagnostics.accepted/considered*100,fusedPercentage:this.diagnostics.fusedSuccessfully/considered*100,
    usefulPercentage:(this.diagnostics.producedNewSamples+this.diagnostics.matchedExistingSamples)>0?this.diagnostics.fusedSuccessfully/considered*100:0 } }
  public createRawSnapshot(): RawRealityMeasurement[] { return this.raw.map((s)=>({ ...s, position:{...s.position}, normal:{...s.normal} })) }
  public reset(): void { this.lastAccepted=null;this.lastSeen=null;this.quarantine=false;this.recoveryFrames=0;this.hardInvalid=false;this.referenceSpaceResetCount=0;this.poseEpochCount=1;this.acceptedPoseEpochs.clear();this.scanSpatialValidityReason='none';this.raw=[];this.translations=[];this.rotations=[];this.diagnostics=this.createDiagnostics() }
  private createDiagnostics(): RealityMeasurementDiagnostics { return { candidateTicks:0,cadenceSkipped:0,backpressureSkipped:0,ticksConsidered:0,accepted:0,fusedSuccessfully:0,producedNewSamples:0,matchedExistingSamples:0,skippedTogether:0,motionRejected:0,trackingRejected:0,depthRejected:0,depthRejectedMissing:0,depthRejectedValidRatio:0,depthRejectedSampleCount:0,depthRejectedOutliers:0,depthRejectedDiscontinuity:0,depthRejectedRange:0,poseDiscontinuityRejected:0,consistencyRejected:0,badDepthFrames:0,largestTranslationMeters:0,largestRotationDegrees:0,largestVelocityMetersPerSecond:0,translationP50Meters:0,translationP90Meters:0,translationP95Meters:0,rotationP50Degrees:0,rotationP90Degrees:0,rotationP95Degrees:0,largestAngularVelocityDegreesPerSecond:0,relocalizationLikeEvents:0,stableRecoveryFrames:0,referenceSpaceResetCount:0,poseEpochCount:1,acceptedPoseEpochCount:0,quarantineActive:false,scanSpatialValidity:'healthy',scanSpatialValidityReason:'none',validRatio:0,outlierRatio:0,medianDepthMeters:0,p95DepthMeters:0,guidance:'more-coverage',validationMs:0,acceptedPercentage:0,fusedPercentage:0,usefulPercentage:0 } }
  private captureRaw(packet: RealityMeasurementPacket, accepted: boolean, reason: RealityMeasurementRejectionReason): void {
    const stride=Math.max(1,Math.ceil(packet.valid/256)), frame=packet.denseFrame
    let seen=0
    for(let i=0;i<frame.valid.length;i++)if(frame.valid[i]&&seen++%stride===0){const o=i*3,n=packet.normalValid[i]?{x:packet.normals[o],y:packet.normals[o+1],z:packet.normals[o+2]}:{x:0,y:1,z:0};const value={position:{x:frame.points[o],y:frame.points[o+1],z:frame.points[o+2]},normal:n,timestamp:packet.timestamp,frameSequence:packet.sequence,accepted,rejectionReason:reason};if(this.raw.length<MAX_RAW_MEASUREMENTS)this.raw.push(value);else this.raw[(packet.sequence*257+seen)%MAX_RAW_MEASUREMENTS]=value}
  }
}

function inspectDepthGrid(frame: DenseSpatialPointFrame): { discontinuityRatio:number; isolatedOutlierRatio:number } {
  let pairs=0,jumps=0,outliers=0,valid=0
  for(let y=0;y<frame.rows;y++)for(let x=0;x<frame.columns;x++){const i=y*frame.columns+x;if(!frame.valid[i])continue;valid++;const d=frame.distancesMeters[i],neighbors:number[]=[]
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=frame.columns||ny>=frame.rows)continue;const j=ny*frame.columns+nx;if(!frame.valid[j])continue;const nd=frame.distancesMeters[j];neighbors.push(nd);if(dx>0||dy>0){pairs++;if(Math.abs(d-nd)>Math.max(.12,Math.min(d,nd)*.08))jumps++}}
    if(neighbors.length>=3&&neighbors.filter((n)=>Math.abs(d-n)>Math.max(.25,d*.25)).length>=3)outliers++
  }
  return {discontinuityRatio:jumps/Math.max(1,pairs),isolatedOutlierRatio:outliers/Math.max(1,valid)}
}

function estimateGridNormals(frame:DenseSpatialPointFrame):{normals:Float32Array;normalValid:Uint8Array}{const normals=new Float32Array(frame.valid.length*3),normalValid=new Uint8Array(frame.valid.length)
  for(let y=1;y<frame.rows-1;y++)for(let x=1;x<frame.columns-1;x++){const i=y*frame.columns+x,l=i-1,r=i+1,u=i-frame.columns,d=i+frame.columns;if(!frame.valid[l]||!frame.valid[r]||!frame.valid[u]||!frame.valid[d])continue;const p=frame.points,lr={x:p[r*3]-p[l*3],y:p[r*3+1]-p[l*3+1],z:p[r*3+2]-p[l*3+2]},ud={x:p[d*3]-p[u*3],y:p[d*3+1]-p[u*3+1],z:p[d*3+2]-p[u*3+2]},n={x:lr.y*ud.z-lr.z*ud.y,y:lr.z*ud.x-lr.x*ud.z,z:lr.x*ud.y-lr.y*ud.x},length=Math.hypot(n.x,n.y,n.z);if(length<1e-7)continue;const o=i*3;normals[o]=n.x/length;normals[o+1]=n.y/length;normals[o+2]=n.z/length;normalValid[i]=1}
  return{normals,normalValid}}

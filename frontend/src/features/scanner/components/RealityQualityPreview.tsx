import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { FinalizedDenseRealityReconstruction } from '../types'
import { restoreRealitySurface, type PreparedRealitySurface, type RealitySurfaceRenderResources } from '../services/realitySurfaceRenderingService'
import type { RealityRefinementStats } from '../services/realityDisplayRefinement'
import type { RealityConfidenceFilterStats } from '../services/realityConfidenceFiltering'

const modes = [['raw-measured', 'Raw Measured Reality'], ['fused-raw', 'Fused Raw Reality'], ['confidence', 'Confidence Filtered Reality'], ['geometry', 'Refined Geometry'], ['triangulated', 'Triangulated Reality'], ['final', 'Final M8.7.1 Reality'], ['layers', 'Depth Layers — 10 cm range bands'], ['discontinuities', 'Depth Discontinuities'], ['new', 'New Geometry — last creation tick'], ['views', 'Multi-View Observation Count'], ['reveal', 'Recess / Occlusion Reveal — first observed time'], ['trajectory', 'Scan Trajectory']]
export default function RealityQualityPreview({ source }: { source: FinalizedDenseRealityReconstruction }) {
  const host = useRef<HTMLDivElement>(null), worker = useRef<Worker | null>(null), requestId = useRef(0)
  const [mode, setMode] = useState('final'), [busy, setBusy] = useState(true), [error, setError] = useState('')
  const [result, setResult] = useState<{ prepared: PreparedRealitySurface; stats: RealityRefinementStats; filterStats: RealityConfidenceFilterStats } | null>(null)
  const [renderInfo, setRenderInfo] = useState({ width: 0, height: 0, dpr: 1, fps: 0, drawCalls: 0 })
  const currentMode = useRef(mode)
  useEffect(() => {
    if (!host.current) return
    const container = host.current
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) } catch {
      let cancelled = false
      queueMicrotask(() => { if (!cancelled) { setBusy(false); setError('Quality preview graphics unavailable. Open the frozen preview or retry on a supported device.') } })
      return () => { cancelled = true }
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); container.append(renderer.domElement)
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#111b24')
    const trailGeometry = new THREE.BufferGeometry().setFromPoints((source.qualityTelemetry?.trajectory ?? []).map((p) => new THREE.Vector3(p.position.x, p.position.y, p.position.z)))
    const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: '#ffcc33' })); scene.add(trail); trail.visible = false
    const camera = new THREE.PerspectiveCamera(60, 1, .04, 80)
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true
    const bounds = new THREE.Box3(); (source.fusedRawSurfels ?? source.surfels).forEach((s) => bounds.expandByPoint(new THREE.Vector3(s.position.x, s.position.y, s.position.z)))
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3()), extent = bounds.isEmpty() ? 2 : Math.max(1, bounds.getSize(new THREE.Vector3()).length())
    camera.position.copy(center).add(new THREE.Vector3(extent * .3, extent * .15, extent * .7)); controls.target.copy(center); controls.update()
    const resize = () => { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix() }
    const observer = new ResizeObserver(resize); observer.observe(container); resize()
    let resources: RealitySurfaceRenderResources | null = null, raf = 0, frames = 0, lastReport = performance.now(), slowReports = 0
    const disposeResources = () => { if (!resources) return; scene.remove(resources.group); resources.geometries.forEach((g) => g.dispose()); resources.materials.forEach((m) => m.dispose()) }
    const preparation = new Worker(new URL('../services/realityQuality.worker.ts', import.meta.url), { type: 'module' }); worker.current = preparation
    const id = ++requestId.current
    preparation.postMessage({ source, mode: currentMode.current, id })
    preparation.onmessage = (event: MessageEvent<{ id: number; error?: string; prepared: PreparedRealitySurface; stats: RealityRefinementStats; filterStats: RealityConfidenceFilterStats }>) => {
      if (event.data.id !== requestId.current) return
      setBusy(false)
      if (event.data.error) { setError(event.data.error); return }
      disposeResources(); resources = restoreRealitySurface(event.data.prepared); scene.add(resources.group); setResult(event.data)
    }
    preparation.onerror = () => { setBusy(false); setError('Quality worker failed. Original Reality remains available below.') }
    const render = (time: number) => {
      raf = requestAnimationFrame(render); controls.update(); trail.visible = currentMode.current === 'trajectory'; renderer.render(scene, camera); frames++
      if (time - lastReport > 1500) {
        const fps = frames * 1000 / (time - lastReport)
        slowReports = fps < 32 ? slowReports + 1 : 0
        if (slowReports >= 2 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - .25)); resize(); slowReports = 0 }
        setRenderInfo({ width: renderer.domElement.width, height: renderer.domElement.height, dpr: renderer.getPixelRatio(), fps: Math.round(fps), drawCalls: renderer.info.render.calls })
        frames = 0; lastReport = time
      }
    }; raf = requestAnimationFrame(render)
    return () => { worker.current = null; preparation.terminate(); cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); disposeResources(); trailGeometry.dispose(); trail.material.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove() }
  }, [source])
  const select = (value: string) => { setMode(value); currentMode.current = value; setBusy(true); setError(''); worker.current?.postMessage({ mode: value, id: ++requestId.current }) }
  const stats = result?.stats, filter = result?.filterStats, q = source.qualityTelemetry, fusion = source.fusionDiagnostics, appearance = source.appearanceKeyframes?.diagnostics, measurement = source.measurementDiagnostics
  const lowQuality = Boolean(filter && (filter.repeatability.stableSampleRatio < .3 || filter.floatingComponentsRejected > Math.max(4,filter.connectedComponentCount*.35)) || measurement && measurement.accepted < Math.max(3,measurement.ticksConsidered*.35))
  return <section aria-label="M8.7.1 measured Reality quality" style={{ marginBlock: 24 }}>
    <h2>M8.7.1 Clean Reality Preview</h2>
    <p>Drag to orbit; pinch to zoom. Raw stages remain inspectable; Final uses only confidence-supported measured geometry. No M7 surface or invented hole geometry is used.</p>
    {lowQuality && <p role="alert">Scan quality is low. For a cleaner model, continue scanning longer or rescan while moving slowly and viewing surfaces from another angle.</p>}
    <label>Quality comparison <select value={mode} onChange={(e) => select(e.target.value)}>{modes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {mode === 'layers' && <p>Range bands from the first recorded scanner position, not inferred planar layers.</p>}
    {mode === 'reveal' && <p>First-observed time: green/blue is earlier, magenta is later. This shows when geometry was revealed; it does not label a recess semantically.</p>}
    {mode === 'views' && <p>Orange: one angular view bin. Green: multiple bins. Repeat ticks alone do not establish viewpoint diversity.</p>}
    {mode === 'raw-measured' && <p>Green measurements passed the immutable frame gate; red measurements were retained only for diagnostics and were never fused.</p>}
    {mode === 'fused-raw' && <p>All fused measured samples, including provisional and low-confidence geometry.</p>}
    {mode === 'confidence' && <p>Unsupported one-frame points, weak duplicate sheets and tiny unstable islands are omitted. Supported recesses remain measured geometry.</p>}
    {busy && <p role="status">Preparing measured display geometry in worker…</p>}{error && <p role="alert">{error}</p>}
    <div ref={host} style={{ height: 440, maxHeight: '65vh', width: '100%', touchAction: 'none', borderRadius: 12, overflow: 'hidden' }} />
    <details><summary>Frame acceptance, stability, components and repeatability</summary>
      <p>Frames considered {measurement?.ticksConsidered ?? 0}; accepted {measurement?.accepted ?? 0}; atomically skipped {measurement?.skippedTogether ?? 0}; motion rejected {measurement?.motionRejected ?? 0}; tracking rejected {measurement?.trackingRejected ?? 0}; depth rejected {measurement?.depthRejected ?? 0}; pose discontinuities {measurement?.poseDiscontinuityRejected ?? 0}; consistency rejected {measurement?.consistencyRejected ?? 0}.</p>
      <p>Translation p50/p90/p95/max {measurement?.translationP50Meters.toFixed(3) ?? '?'} / {measurement?.translationP90Meters.toFixed(3) ?? '?'} / {measurement?.translationP95Meters.toFixed(3) ?? '?'} / {measurement?.largestTranslationMeters.toFixed(2) ?? '?'} m; rotation p50/p90/p95/max {measurement?.rotationP50Degrees.toFixed(1) ?? '?'} / {measurement?.rotationP90Degrees.toFixed(1) ?? '?'} / {measurement?.rotationP95Degrees.toFixed(1) ?? '?'} / {measurement?.largestRotationDegrees.toFixed(1) ?? '?'}°. Relocalization-like events {measurement?.relocalizationLikeEvents ?? 0}.</p>
      <p>Last depth valid {((measurement?.validRatio ?? 0)*100).toFixed(1)}%; outliers {((measurement?.outlierRatio ?? 0)*100).toFixed(1)}%; median/p95 {measurement?.medianDepthMeters.toFixed(2) ?? '?'} / {measurement?.p95DepthMeters.toFixed(2) ?? '?'} m; validation {measurement?.validationMs.toFixed(2) ?? '?'} ms.</p>
      {filter && <><p>Confidence filter retained {filter.retainedSamples}/{filter.sourceSamples}; stable {filter.stableSamples}; low-confidence {filter.lowConfidenceSamples}; view-diverse {filter.viewDiverseSamples}; single-view {filter.singleViewSamples}. Removed {filter.samplesRemoved} display candidates.</p>
        <p>Components {filter.connectedComponentCount}; floating low-confidence components excluded {filter.floatingComponentsRejected}; duplicate-sheet candidates {filter.duplicateCandidates}, rejected {filter.duplicateCandidatesRejected}. Mean position/depth/normal variation {filter.meanPositionStdMeters.toFixed(4)} m / {filter.meanDepthStdMeters.toFixed(4)} m / {filter.meanNormalStd.toFixed(3)}. Analysis {filter.componentAnalysisMs.toFixed(1)} ms.</p>
        <p>Repeatability: extent {filter.repeatability.extentMeters.x.toFixed(2)} × {filter.repeatability.extentMeters.y.toFixed(2)} × {filter.repeatability.extentMeters.z.toFixed(2)} m; major components {filter.repeatability.majorComponentCount}; stable {(filter.repeatability.stableSampleRatio*100).toFixed(1)}%; low confidence {(filter.repeatability.lowConfidenceSampleRatio*100).toFixed(1)}%; largest unsupported component {filter.repeatability.largestUnsupportedComponentSamples} samples; ceiling-height proxy {filter.repeatability.ceilingHeightEstimateMeters?.toFixed(2) ?? 'N/A'} m.</p></>}
    </details>
    <details><summary>Depth, appearance, memory and walking diagnostics</summary>
      <p>Depth source {source.depthSource?.width ?? '?'} × {source.depthSource?.height ?? '?'}; scale {source.depthSource?.scale ?? '?'} m/raw unit. Tier {q?.tier ?? 0}, four temporal phases. Attempted {q?.attempted ?? 0}; valid {q?.valid ?? 0}. Last processing {q?.processingMs.toFixed(1) ?? '?'} ms.</p>
      <p>Actual normalized-view grid {q?.columns ?? '?'} × {q?.rows ?? '?'}; view-aspect adjusted within the tier sample budget. Smoothed XR frame interval {q?.xrFrameIntervalMs?.toFixed(1) ?? '?'} ms.</p>
      <p>2.5 cm cells; 60,000 capacity. Active {fusion.activeSampleCount}; stable {fusion.stableSampleCount}; created {fusion.createdSampleCount}; fused {fusion.fusedSampleCount}. Capacity rejects {fusion.capacityRejectedSampleCount ?? 0}; stale unconfirmed reclaimed {fusion.reclaimedSampleCount ?? 0}.</p>
      <p>Appearance {appearance?.width ?? 0} × {appearance?.height ?? 0}; {appearance?.retainedCount ?? 0}/8 frames; {((appearance?.totalBytes ?? 0) / 1048576).toFixed(2)} MiB. Last copy {appearance?.captureMs.toFixed(1) ?? '?'} ms. Mask keyframes unchanged.</p>
      <p>Live RGB {source.liveRgbDimensions?.width ?? '?'} × {source.liveRgbDimensions?.height ?? '?'}. Shared spatial buckets with multiple stored samples: {fusion.multiLayerBucketCount ?? 0} (not a semantic surface count). Last new-observation ratio {((fusion.newGeometryRatio ?? 0) * 100).toFixed(1)}%; fused/repeat ratio {((1 - (fusion.newGeometryRatio ?? 0)) * 100).toFixed(1)}%.</p>
      {stats && <p>Conflicting high-quality appearance observations retaining original RGB: {stats.colorConflictRejects}.</p>}
      {stats && <><p>Color refinement {stats.refinedColors}/{source.surfels.length} ({(100 * stats.refinedColors / Math.max(1, source.surfels.length)).toFixed(1)}%); visibility rejects {stats.visibilityRejects}; one view {stats.singleView}; multi-view {stats.multipleViews}; {stats.colorMs.toFixed(1)} ms.</p>
        <p>Local noise proxy {(stats.rawNoiseMeters * 1000).toFixed(2)} → {(stats.refinedNoiseMeters * 1000).toFixed(2)} mm. Moved {stats.movedSamples}; displacement mean/p90/p95/max {(stats.meanDisplacementMeters*1000).toFixed(2)} / {(stats.p90DisplacementMeters*1000).toFixed(2)} / {(stats.p95DisplacementMeters*1000).toFixed(2)} / {(stats.maxDisplacementMeters*1000).toFixed(2)} mm; raw retained by displacement safety {stats.retainedRawByDisplacementSafety}; edge samples unchanged {stats.edgeSamplesRetained}; {stats.geometryMs.toFixed(1)} ms. No synthesized vertices or explicit hole filling.</p>
        <p>Triangles {result?.prepared.stats.renderedTriangleCount}; fallback splats {result?.prepared.stats.fallbackSplatCount}; median/p90 spacing {result?.prepared.stats.medianNearestNeighborSpacingMeters?.toFixed(3)} / {result?.prepared.stats.p90NearestNeighborSpacingMeters?.toFixed(3)} m. Preparation {result?.prepared.stats.renderPreparationMs.toFixed(1)} ms.</p>
        <p>Triangle rejects: edge {result?.prepared.stats.trianglesRejectedByDistance}; normal {result?.prepared.stats.trianglesRejectedByNormal}; depth layer {result?.prepared.stats.trianglesRejectedByDepthLayer}; unsupported {result?.prepared.stats.trianglesRejectedByUnsupportedNeighborhood}. Accepted edge p95/max {result?.prepared.stats.p95AcceptedTriangleEdgeMeters.toFixed(3)} / {result?.prepared.stats.largestAcceptedTriangleEdgeMeters.toFixed(3)} m.</p>
        <p>Numeric memory: live Dense {((fusion.numericMemoryBytes ?? 3660000) / 1048576).toFixed(2)} MiB; derived position/normal {(stats.positionNormalBytes / 1048576).toFixed(2)}; colors {(stats.colorBytes / 1048576).toFixed(2)}; worker scratch {(stats.numericTemporaryBytes / 1048576).toFixed(2)}; mesh {((result?.prepared.stats.memoryBytes ?? 0) / 1048576).toFixed(2)}. JS objects/hash and worker clone overhead are additional, not included.</p></>}
      <p>Canvas {renderInfo.width} × {renderInfo.height}; DPR {renderInfo.dpr}; {renderInfo.fps} FPS; {renderInfo.drawCalls} draw calls.</p>
      <p>Position/normal/color memory figures are packed-equivalent estimates; derived samples are JS objects. Browser peak memory and GPU allocations require device profiling. Snapshot cloning temporarily duplicates raw samples/keyframes; only one preview is mounted at a time.</p>
      <p>Walked {q?.distanceWalkedMeters.toFixed(2) ?? '0'} m; trajectory {q?.trajectory.length ?? 0}/1024 poses; stationary ticks skipped {q?.skippedStationaryTicks ?? 0}. Walking distance is tracked pose-path length, not drift-corrected ground truth.</p>
    </details>
  </section>
}

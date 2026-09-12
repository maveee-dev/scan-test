import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { FinalizedRealitySurfel } from '../types'
import {
  cloneM812SynchronizedRgbdSnapshot,
  getM812SynchronizedRgbdTransferBuffers,
  type M812SynchronizedRgbdSnapshot,
} from '../services/m812SynchronizedRgbdCaptureService'
import {
  M813_VIEW_DEPENDENT_CONFIG,
  selectM813ViewDependentKeyframes,
  type M813ViewDependentVisualRealityProgress,
  type M813ViewDependentVisualRealityResult,
} from '../services/m813ViewDependentVisualRealityService'
import type { M813WorkerResult } from '../services/m813ViewDependentVisualReality.worker'
import { auditRealitySurfaceScreenSpace, auditRealityTriangleScreenSpace, type RealityScreenSpaceCoverageDiagnostics } from '../services/realitySurfaceRenderingService'

interface BrowserDiagnostics {
  readonly postMessageMs: number | null
  readonly workerRoundTripMs: number | null
  readonly gpuSetupMs: number | null
  readonly firstPaintMs: number | null
  readonly fps: number
  readonly drawCalls: number
  readonly activeKeyframeIds: readonly number[]
}

const clockNow = (): number => typeof performance === 'undefined' ? Date.now() : performance.now()
const epochNow = (): number => typeof performance === 'undefined' ? Date.now() : performance.timeOrigin + performance.now()
const emptyBrowserDiagnostics: BrowserDiagnostics = { postMessageMs: null, workerRoundTripMs: null, gpuSetupMs: null, firstPaintMs: null, fps: 0, drawCalls: 0, activeKeyframeIds: [] }

function mergeSelectedGeometry(result: M813ViewDependentVisualRealityResult, selected: ReadonlySet<number>): THREE.BufferGeometry {
  const positions: number[] = []
  for (const keyframe of result.keyframes) {
    if (!selected.has(keyframe.keyframeId)) continue
    for (const sourceIndex of keyframe.indices) {
      const offset = sourceIndex * 3
      positions.push(keyframe.positions[offset], keyframe.positions[offset + 1], keyframe.positions[offset + 2])
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
}

export default function M813ViewDependentVisualRealityPreview({
  snapshot,
  baselineSurfels,
}: {
  snapshot: M812SynchronizedRgbdSnapshot
  baselineSurfels: readonly FinalizedRealitySurfel[]
}) {
  const host = useRef<HTMLDivElement>(null)
  const activeWorker = useRef<Worker | null>(null)
  const [status, setStatus] = useState<'idle' | 'working' | 'complete' | 'error'>('idle')
  const [progress, setProgress] = useState<M813ViewDependentVisualRealityProgress | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<M813ViewDependentVisualRealityResult | null>(null)
  const [browser, setBrowser] = useState<BrowserDiagnostics>(emptyBrowserDiagnostics)
  const [audits, setAudits] = useState<{ baseline: RealityScreenSpaceCoverageDiagnostics; experimental: RealityScreenSpaceCoverageDiagnostics } | null>(null)

  useEffect(() => () => activeWorker.current?.terminate(), [])

  const build = (): void => {
    activeWorker.current?.terminate()
    setStatus('working'); setProgress(null); setError(''); setResult(null); setAudits(null); setBrowser(emptyBrowserDiagnostics)
    const worker = new Worker(new URL('../services/m813ViewDependentVisualReality.worker.ts', import.meta.url), { type: 'module' })
    activeWorker.current = worker
    const input = cloneM812SynchronizedRgbdSnapshot(snapshot, M813_VIEW_DEPENDENT_CONFIG.maximumInputKeyframes)
    const first = input.keyframes[0]
    const view = {
      position: first ? { x: first.rgbKeyframe.cameraTransform[12], y: first.rgbKeyframe.cameraTransform[13], z: first.rgbKeyframe.cameraTransform[14] } : { x: 0, y: 0, z: 1 },
      target: { x: 0, y: 0, z: 0 },
    }
    const postedAt = epochNow()
    const postStartedAt = clockNow()
    worker.postMessage({ id: 1, snapshot: input, view }, getM812SynchronizedRgbdTransferBuffers(input))
    const postMessageMs = Math.max(0, clockNow() - postStartedAt)
    worker.onmessage = (event: MessageEvent<M813WorkerResult>) => {
      if (event.data.id !== 1) return
      if (event.data.type === 'progress') {
        setProgress(event.data.progress)
        return
      }
      activeWorker.current = null
      worker.terminate()
      setProgress(null)
      if (event.data.type === 'error') {
        setStatus('error'); setError(event.data.error)
        return
      }
      setBrowser({ ...emptyBrowserDiagnostics, postMessageMs, workerRoundTripMs: Math.max(0, epochNow() - postedAt) })
      setResult(event.data.result)
      setStatus('complete')
    }
    worker.onerror = () => {
      activeWorker.current = null
      worker.terminate()
      setProgress(null); setStatus('error'); setError('M8.13 worker failed.')
    }
  }

  useEffect(() => {
    if (!result || !host.current) return
    const container = host.current
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) } catch {
      queueMicrotask(() => { setStatus('error'); setError('M8.13 WebGL preview is unavailable on this device.') })
      return
    }
    const setupStartedAt = clockNow()
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    container.append(renderer.domElement)
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#111b24')
    const camera = new THREE.PerspectiveCamera(60, 1, 0.04, 80)
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true
    const bounds = new THREE.Box3()
    const meshes = new Map<number, THREE.Mesh>()
    for (const [order, keyframe] of result.keyframes.entries()) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(keyframe.positions, 3))
      geometry.setAttribute('uv', new THREE.BufferAttribute(keyframe.sourceGridUvs, 2))
      geometry.setIndex(new THREE.BufferAttribute(keyframe.indices, 1))
      geometry.computeBoundingBox()
      if (geometry.boundingBox) bounds.union(geometry.boundingBox)
      const texture = new THREE.DataTexture(keyframe.rgb, keyframe.width, keyframe.height, THREE.RGBFormat, THREE.UnsignedByteType)
      texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false
      texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping
      texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true
      const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, depthTest: true, depthWrite: true, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -order * 0.02, polygonOffsetUnits: -order * 0.02 })
      const mesh = new THREE.Mesh(geometry, material); mesh.renderOrder = order; scene.add(mesh); meshes.set(keyframe.keyframeId, mesh)
    }
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3())
    const extent = bounds.isEmpty() ? 2 : Math.max(1, bounds.getSize(new THREE.Vector3()).length())
    camera.position.copy(center).add(new THREE.Vector3(extent * 0.3, extent * 0.15, extent * 0.7))
    controls.target.copy(center); controls.update()
    const resize = (): void => {
      const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight)
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize); observer.observe(container); resize()
    let raf = 0, frames = 0, lastReport = clockNow(), firstPaintPending = true, auditTimer = 0
    const updateSelection = (): readonly number[] => {
      const ids = selectM813ViewDependentKeyframes(result, {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      })
      const selected = new Set(ids)
      for (const [id, mesh] of meshes) mesh.visible = selected.has(id)
      return ids
    }
    const audit = (): void => {
      const ids = updateSelection(), selected = new Set(ids)
      const merged = mergeSelectedGeometry(result, selected)
      const experimental = auditRealityTriangleScreenSpace(merged, camera, renderer.domElement.width, renderer.domElement.height)
      const baseline = auditRealitySurfaceScreenSpace(baselineSurfels, camera, renderer.domElement.width, renderer.domElement.height)
      merged.dispose(); setAudits({ baseline, experimental })
    }
    const queueAudit = (): void => { window.clearTimeout(auditTimer); auditTimer = window.setTimeout(audit, 250) }
    controls.addEventListener('change', queueAudit)
    const initialIds = updateSelection()
    const gpuSetupMs = Math.max(0, clockNow() - setupStartedAt)
    queueAudit()
    const render = (time: number): void => {
      raf = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); frames += 1
      if (firstPaintPending) {
        firstPaintPending = false
        const paintStartedAt = clockNow()
        requestAnimationFrame(() => setBrowser((previous) => ({ ...previous, gpuSetupMs, activeKeyframeIds: initialIds,
          firstPaintMs: Math.max(0, clockNow() - paintStartedAt) })))
      }
      if (time - lastReport >= 1000) {
        const ids = updateSelection()
        setBrowser((previous) => ({ ...previous, fps: Math.round(frames * 1000 / Math.max(1, time - lastReport)), drawCalls: renderer.info.render.calls, activeKeyframeIds: ids }))
        frames = 0; lastReport = time
      }
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf); window.clearTimeout(auditTimer); controls.removeEventListener('change', queueAudit); controls.dispose(); observer.disconnect()
      for (const mesh of meshes.values()) { mesh.geometry.dispose(); (mesh.material as THREE.MeshBasicMaterial).map?.dispose(); (mesh.material as THREE.Material).dispose() }
      renderer.dispose(); renderer.domElement.remove()
    }
  }, [baselineSurfels, result])

  const diagnostic = result?.diagnostics
  const memory = snapshot.diagnostics.memory
  const activeKeyframeIds = browser.activeKeyframeIds.length > 0
    ? browser.activeKeyframeIds
    : diagnostic?.selectedKeyframeIds ?? []
  const activeKeyframeLuma = activeKeyframeIds.map((keyframeId) => {
    const keyframeDiagnostic = diagnostic?.keyframeDiagnostics.find((entry) => entry.keyframeId === keyframeId)
    return `${keyframeId}: ${keyframeDiagnostic ? `${keyframeDiagnostic.meanSourceRgbLuma.toFixed(1)}/${keyframeDiagnostic.meanMappedRgbLuma.toFixed(1)}` : 'N/A'}`
  }).join(', ')
  return <section style={{ marginBlock: 20 }} aria-label="M8.13 experimental same-scan comparison">
    <h3>M8.13 View-Dependent Visual Reality (experimental)</h3>
    <p>M8.7.1.6 Final Reality remains the production result above. This optional same-scan renderer uses only bounded, synchronized measured RGB-D keyframes; it never fills gaps or merges geometry between keyframes.</p>
    <p>Available input: {snapshot.keyframes.length}/{snapshot.capacity} synchronized keyframes, {(memory.rawPackedLowerBoundBytes / 1048576).toFixed(2)} MiB packed lower bound. Nothing is built on the Finish critical path.</p>
    <button type="button" className="scan-button scan-button-secondary" onClick={build} disabled={status === 'working'}>
      {status === 'working' ? 'Building M8.13 measured views…' : result ? 'Rebuild M8.13 comparison' : 'Build M8.13 same-scan comparison'}
    </button>
    {status === 'working' && <div role="status" aria-live="polite" style={{ marginBlock: 8 }}>
      {progress ? <>
        <p>{progress.stage === 'ranking' ? 'Ranking retained RGB-D views' : progress.stage === 'geometry' ? 'Building measured keyframe geometry' : 'Checking source ownership'} — keyframe {progress.completedKeyframes} of {progress.totalKeyframes}.</p>
        <progress value={progress.completedKeyframes} max={Math.max(1, progress.totalKeyframes)} aria-label={`${progress.stage} keyframe progress`} />
      </> : <p>Preparing the retained synchronized scan for the worker…</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
    {result && <>
      <div ref={host} style={{ width: '100%', minHeight: 420, aspectRatio: '1 / 1', marginBlock: 12, borderRadius: 12, overflow: 'hidden', background: '#111b24' }} />
      <p>Active view layers {browser.activeKeyframeIds.join(', ') || 'none'} ({browser.drawCalls} draw calls, {browser.fps} FPS). Drag to orbit and verify that selection changes without rebuilding geometry.</p>
      <p>Active keyframe source/mapped RGB luma (0–255): {activeKeyframeLuma || 'Waiting for active view selection'}.</p>
      <p>Bounded input/built/active {diagnostic?.boundedInputKeyframeCount}/{result.keyframes.length}/{diagnostic?.activeKeyframeCount}; measured triangles/vertices {diagnostic?.retainedTriangleCount}/{diagnostic?.retainedVertexCount}; rejected quads invalid/depth-edge/long-edge/degenerate {diagnostic?.rejectedInvalidDepthQuads}/{diagnostic?.rejectedDepthDiscontinuityQuads}/{diagnostic?.rejectedEdgeTooLongQuads}/{diagnostic?.rejectedDegenerateQuads}. Ownership violations/invented vertices {diagnostic?.sourceOwnershipViolations}/{diagnostic?.inventedVertexCount}; source/mapped RGB mean luma {diagnostic?.meanSourceRgbLuma.toFixed(1) ?? 'N/A'}/{diagnostic?.meanMappedRgbLuma.toFixed(1) ?? 'N/A'} / 255.</p>
      <p>Build/worker round-trip/postMessage/GPU setup/first-paint proxy {diagnostic?.buildTimeMs.toFixed(1)} / {browser.workerRoundTripMs?.toFixed(1) ?? 'N/A'} / {browser.postMessageMs?.toFixed(1) ?? 'N/A'} / {browser.gpuSetupMs?.toFixed(1) ?? 'N/A'} / {browser.firstPaintMs?.toFixed(1) ?? 'N/A'} ms; packed geometry {(diagnostic?.packedArrayBytes ?? 0) / 1048576 >= 0.01 ? ((diagnostic?.packedArrayBytes ?? 0) / 1048576).toFixed(2) : '<0.01'} MiB.</p>
      {audits && <p>Same virtual camera screen audit — M8.7.1.6 vs M8.13 useful pixels {audits.baseline.usefulPixelCount}/{audits.experimental.usefulPixelCount}; viewport-hole proxy {(audits.baseline.holeFraction * 100).toFixed(1)}%/{(audits.experimental.holeFraction * 100).toFixed(1)}%; visible primitives {audits.baseline.visiblePrimitiveCount}/{audits.experimental.visiblePrimitiveCount}. This is a deterministic viewport diagnostic, not proof of physical room completeness.</p>}
    </>}
  </section>
}

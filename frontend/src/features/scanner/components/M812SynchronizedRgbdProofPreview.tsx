import { useEffect, useRef, useState } from 'react'
import {
  cloneM812SynchronizedRgbdSnapshot,
  getM812SynchronizedRgbdTransferBuffers,
  type M812SynchronizedRgbdSnapshot,
} from '../services/m812SynchronizedRgbdCaptureService'
import type { M812ProofWorkerResult } from '../services/m812SynchronizedRgbdProof.worker'
import type { M812ProofImage, M812RgbdBrowserProof } from '../services/m812SynchronizedRgbdProofService'

interface BrowserTimings {
  readonly inputTransferMs: number | null
  readonly workerRoundTripMs: number | null
  readonly canvasSetupMs: number | null
  readonly firstPaintMs: number | null
}

const emptyTimings: BrowserTimings = { inputTransferMs: null, workerRoundTripMs: null, canvasSetupMs: null, firstPaintMs: null }
const epochNow = (): number => typeof performance === 'undefined' ? Date.now() : performance.timeOrigin + performance.now()
const clockNow = (): number => typeof performance === 'undefined' ? Date.now() : performance.now()

export default function M812SynchronizedRgbdProofPreview({ snapshot }: { snapshot: M812SynchronizedRgbdSnapshot }) {
  const activeWorker = useRef<Worker | null>(null)
  const sourceCanvas = useRef<HTMLCanvasElement>(null)
  const depthCanvas = useRef<HTMLCanvasElement>(null)
  const measuredCanvas = useRef<HTMLCanvasElement>(null)
  const oneCanvas = useRef<HTMLCanvasElement>(null)
  const twoCanvas = useRef<HTMLCanvasElement>(null)
  const [proof, setProof] = useState<M812RgbdBrowserProof | null>(null)
  const [status, setStatus] = useState<'idle' | 'working' | 'complete' | 'error'>('idle')
  const [error, setError] = useState('')
  const [timings, setTimings] = useState<BrowserTimings>(emptyTimings)

  useEffect(() => () => activeWorker.current?.terminate(), [])

  useEffect(() => {
    if (!proof) return
    const startedAt = clockNow()
    const canvases: readonly [HTMLCanvasElement | null, M812ProofImage][] = [
      [sourceCanvas.current, proof.sourceCamera],
      [depthCanvas.current, proof.depthDerivedGeometry],
      [measuredCanvas.current, proof.sourceMeasuredRgb],
      [oneCanvas.current, proof.displacedOneKeyframe],
      [twoCanvas.current, proof.displacedTwoKeyframe],
    ]
    for (const [canvas, image] of canvases) {
      if (!canvas) continue
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (!context) continue
      context.clearRect(0, 0, image.width, image.height)
      const pixels = new Uint8ClampedArray(image.rgba.length)
      pixels.set(image.rgba)
      context.putImageData(new ImageData(pixels, image.width, image.height), 0, 0)
    }
    const canvasSetupMs = Math.max(0, clockNow() - startedAt)
    const firstPaintStartedAt = clockNow()
    const raf = requestAnimationFrame(() => setTimings((previous) => ({ ...previous, canvasSetupMs,
      firstPaintMs: Math.max(0, clockNow() - firstPaintStartedAt) })))
    return () => cancelAnimationFrame(raf)
  }, [proof])

  const runProof = (): void => {
    activeWorker.current?.terminate()
    setStatus('working'); setError(''); setProof(null); setTimings(emptyTimings)
    const worker = new Worker(new URL('../services/m812SynchronizedRgbdProof.worker.ts', import.meta.url), { type: 'module' })
    activeWorker.current = worker
    const proofInput = cloneM812SynchronizedRgbdSnapshot(snapshot, 2)
    const postedEpochMs = epochNow()
    const postStartedAt = clockNow()
    worker.postMessage({ id: 1, snapshot: proofInput, postedEpochMs }, getM812SynchronizedRgbdTransferBuffers(proofInput))
    const inputTransferMs = Math.max(0, clockNow() - postStartedAt)
    worker.onmessage = (event: MessageEvent<M812ProofWorkerResult>) => {
      if (event.data.id !== 1) return
      activeWorker.current = null
      worker.terminate()
      if (event.data.error || !event.data.proof) {
        setStatus('error'); setError(event.data.error ?? 'M8.12 proof returned no result.')
        return
      }
      setTimings({ inputTransferMs, workerRoundTripMs: Math.max(0, epochNow() - postedEpochMs), canvasSetupMs: null, firstPaintMs: null })
      setProof(event.data.proof)
      setStatus('complete')
    }
    worker.onerror = () => {
      activeWorker.current = null
      worker.terminate()
      setStatus('error'); setError('M8.12 proof worker failed.')
    }
  }

  const memory = snapshot.diagnostics.memory
  const diagnostic = proof?.diagnostics
  const canvasStyle = { width: '100%', imageRendering: 'pixelated' as const, background: '#111b24', borderRadius: 8 }
  return <details style={{ marginBlock: 16 }}>
    <summary>M8.12 synchronized RGB-D browser proof (experimental)</summary>
    <p>This proof is isolated from production Reality. It uses at most two retained, source-owned RGB-D keyframes and leaves unmeasured/disoccluded pixels empty.</p>
    <p>Contract: same XRFrame invocation and XRView alignment. Raw-camera sensor exposure and depth sensor exposure are <strong>not</strong> guaranteed to be simultaneous by WebXR.</p>
    <p>Retained {snapshot.keyframes.length}/{snapshot.capacity} synchronized keyframes; unpaired RGB {snapshot.diagnostics.unpairedRgbKeyframes}; contract mismatches {snapshot.diagnostics.contractMismatchRejects}. Raw typed lower bound {(memory.rawPackedLowerBoundBytes / 1048576).toFixed(2)} MiB (RGB {(memory.rgbBytes / 1048576).toFixed(2)}, depth/valid/world/metadata {((memory.depthBytes + memory.validityBytes + memory.worldPointBytes + memory.poseProjectionBytes) / 1048576).toFixed(2)} MiB). JS, browser, and GPU overhead is additional.</p>
    <button type="button" className="scan-button scan-button-secondary" onClick={runProof} disabled={status === 'working'}>
      {status === 'working' ? 'Building bounded measured proof…' : proof ? 'Rebuild bounded measured proof' : 'Run bounded measured proof'}
    </button>
    {error && <p role="alert">{error}</p>}
    {proof && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBlock: 12 }}>
        <figure><figcaption>1. Retained source RGB</figcaption><canvas ref={sourceCanvas} style={canvasStyle} /></figure>
        <figure><figcaption>2. Depth-derived measured geometry</figcaption><canvas ref={depthCanvas} style={canvasStyle} /></figure>
        <figure><figcaption>3. Same-view measured RGB reprojection</figcaption><canvas ref={measuredCanvas} style={canvasStyle} /></figure>
        <figure><figcaption>4. Displaced view, keyframe 1 only</figcaption><canvas ref={oneCanvas} style={canvasStyle} /></figure>
        <figure><figcaption>5. Displaced view, up to two measured keyframes</figcaption><canvas ref={twoCanvas} style={canvasStyle} /></figure>
      </div>
      <p>Measured triangles {diagnostic?.retainedMeasuredTriangles}/{diagnostic?.candidateTriangles}; valid/rejected depth samples {diagnostic?.validDepthSamples}/{diagnostic?.rejectedDepthSamples}. Source-owned pixels {diagnostic?.sourceOwnedVisiblePixels}; displaced visible {diagnostic?.reprojectedVisiblePixels}; one/two-keyframe holes {diagnostic?.oneKeyframeDisocclusionHoles}/{diagnostic?.twoKeyframeDisocclusionHoles}; overdraw {diagnostic?.overdrawAttempts}; depth conflicts {diagnostic?.conflictingDepthSamples}.</p>
      <p>Final displaced pixels supplied by keyframe 1/keyframe 2: {diagnostic?.pixelsSuppliedByKeyframe1}/{diagnostic?.pixelsSuppliedByKeyframe2}. Invented pixels: {diagnostic?.inventedPixels}. Rejected triangles invalid/depth-edge/long-edge/degenerate/RGB-map: {diagnostic?.trianglesRejectedInvalid}/{diagnostic?.trianglesRejectedDepthDiscontinuity}/{diagnostic?.trianglesRejectedEdgeLength}/{diagnostic?.trianglesRejectedDegenerate}/{diagnostic?.trianglesRejectedRgbMapping}.</p>
      <p>Worker proof ms geometry/source/one/two/total: {diagnostic?.geometryGenerationMs.toFixed(1)} / {diagnostic?.sourceReprojectionMs.toFixed(1)} / {diagnostic?.oneKeyframeReprojectionMs.toFixed(1)} / {diagnostic?.twoKeyframeReprojectionMs.toFixed(1)} / {diagnostic?.totalProofMs.toFixed(1)}. Browser postMessage/round-trip/canvas setup/first-paint proxy: {timings.inputTransferMs?.toFixed(1) ?? 'N/A'} / {timings.workerRoundTripMs?.toFixed(1) ?? 'N/A'} / {timings.canvasSetupMs?.toFixed(1) ?? 'N/A'} / {timings.firstPaintMs?.toFixed(1) ?? 'N/A'} ms.</p>
    </>}
  </details>
}

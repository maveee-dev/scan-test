import { useEffect, useState } from 'react'
import type { FinalizedRealityReconstruction } from '../types'
import type { PreparedRealitySurface, RealitySurfaceRenderMode } from '../services/realitySurfaceRenderingService'

/** One cancellable post-scan job; no live/XR work or per-frame React updates. */
export function usePreparedRealitySurface(source: FinalizedRealityReconstruction | null | undefined, mode: RealitySurfaceRenderMode, enabled: boolean): {
  prepared: PreparedRealitySurface | null
  error: string | null
  pending: boolean
} {
  const [result, setResult] = useState<{
    source: FinalizedRealityReconstruction
    mode: RealitySurfaceRenderMode
    prepared?: PreparedRealitySurface
    error?: string
  } | null>(null)
  useEffect(() => {
    if (!enabled || source?.status !== 'available') return
    let worker: Worker | undefined
    let cancelled = false
    const fail = (error: string) => { if (!cancelled) setResult({ source, mode, error }) }
    try {
      worker = new Worker(new URL('../services/realitySurfacePreparation.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ prepared?: PreparedRealitySurface; error?: string }>) => {
        if (!cancelled) setResult({ source, mode, ...event.data })
        worker?.terminate()
      }
      worker.onerror = () => { fail('Reality preparation failed. Select another comparison or return to review.'); worker?.terminate() }
      worker.postMessage({ surfels: source.surfels, mode })
    } catch (error) { fail(error instanceof Error ? error.message : 'Reality worker unavailable.'); worker?.terminate() }
    return () => { cancelled = true; worker?.terminate() }
  }, [enabled, source, mode])
  const current = enabled && result?.source === source && result?.mode === mode ? result : null
  return { prepared: current?.prepared ?? null, error: current?.error ?? null,
    pending: enabled && source?.status === 'available' && !current }
}

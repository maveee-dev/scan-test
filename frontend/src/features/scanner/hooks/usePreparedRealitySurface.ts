import { useEffect, useState } from 'react'
import type { FinalizedRealityReconstruction } from '../types'
import type { PreparedRealitySurface, RealitySurfaceRenderMode } from '../services/realitySurfaceRenderingService'
import type {
  RealityDebugColorMode,
  RealityDesignColorInput,
  RealityStructuralAssociationTable,
} from '../services/realityStructuralAssociationService'

/** One cancellable post-scan job; no live/XR work or per-frame React updates. */
export function usePreparedRealitySurface(
  source: FinalizedRealityReconstruction | null | undefined,
  mode: RealitySurfaceRenderMode,
  enabled: boolean,
  association: RealityStructuralAssociationTable | null = null,
  designInputs: readonly RealityDesignColorInput[] = [],
  debugColorMode: RealityDebugColorMode = 'none',
): {
  prepared: PreparedRealitySurface | null
  error: string | null
  pending: boolean
} {
  const [result, setResult] = useState<{
    source: FinalizedRealityReconstruction
    mode: RealitySurfaceRenderMode
    association: RealityStructuralAssociationTable | null
    designKey: string
    debugColorMode: RealityDebugColorMode
    prepared?: PreparedRealitySurface
    error?: string
  } | null>(null)

  useEffect(() => {
    if (!enabled || source?.status !== 'available') return
    let worker: Worker | undefined
    let cancelled = false
    const designKey = designInputs.map((input) => `${input.surfaceId}:${input.paintColor}`).sort().join('|')
    const fail = (error: string) => {
      if (!cancelled) setResult({ source, mode, association, designKey, debugColorMode, error })
    }
    try {
      worker = new Worker(new URL('../services/realitySurfacePreparation.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ prepared?: PreparedRealitySurface; error?: string }>) => {
        if (!cancelled) setResult({ source, mode, association, designKey, debugColorMode, ...event.data })
        worker?.terminate()
      }
      worker.onerror = () => {
        fail('Reality preparation failed. Select another comparison or return to review.')
        worker?.terminate()
      }
      worker.postMessage({ surfels: source.surfels, mode, association, designInputs, debugColorMode })
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Reality worker unavailable.')
      worker?.terminate()
    }
    return () => {
      cancelled = true
      worker?.terminate()
    }
  }, [association, debugColorMode, designInputs, enabled, mode, source])

  const designKey = designInputs.map((input) => `${input.surfaceId}:${input.paintColor}`).sort().join('|')
  const current = enabled && result?.source === source && result?.mode === mode && result.association === association &&
    result.designKey === designKey && result.debugColorMode === debugColorMode ? result : null

  return {
    prepared: current?.prepared ?? null,
    error: current?.error ?? null,
    pending: enabled && source?.status === 'available' && !current,
  }
}

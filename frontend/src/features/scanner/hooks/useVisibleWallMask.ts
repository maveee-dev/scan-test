import { useEffect, useState } from 'react'
import type { FinalizedRealityReconstruction, FinalizedRealityRgbKeyframes } from '../types'
import type { RealityStructuralAssociationTable } from '../services/realityStructuralAssociationService'
import type { VisibleWallMaskResult } from '../services/visibleWallMaskProvider'

/** Cancellable post-analysis RGB mask job; it never runs in the XR loop. */
export function useVisibleWallMask(
  reality: FinalizedRealityReconstruction | null | undefined,
  table: RealityStructuralAssociationTable | null,
  keyframes: FinalizedRealityRgbKeyframes | null | undefined,
): { result: VisibleWallMaskResult | null; pending: boolean; error: string | null } {
  const [state, setState] = useState<{ reality: FinalizedRealityReconstruction; table: RealityStructuralAssociationTable; keyframes: FinalizedRealityRgbKeyframes; result?: VisibleWallMaskResult | null; error?: string } | null>(null)
  useEffect(() => {
    if (reality?.status !== 'available' || !table || keyframes?.status !== 'available') return
    let worker: Worker | undefined, cancelled = false
    const fail = (error: string) => { if (!cancelled) setState({ reality, table, keyframes, error }) }
    try {
      worker = new Worker(new URL('../services/visibleWallMask.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ result?: VisibleWallMaskResult | null; error?: string }>) => { if (!cancelled) setState({ reality, table, keyframes, ...event.data }); worker?.terminate() }
      worker.onerror = () => { fail('RGB wall-mask preparation failed. Original Reality remains available.'); worker?.terminate() }
      worker.postMessage({ surfels: reality.surfels, table, keyframes })
    } catch (error) { fail(error instanceof Error ? error.message : 'RGB wall-mask worker unavailable.') }
    return () => { cancelled = true; worker?.terminate() }
  }, [keyframes, reality, table])
  const current = state && state.reality === reality && state.table === table && state.keyframes === keyframes ? state : null
  return { result: current?.result ?? null, pending: reality?.status === 'available' && table !== null && keyframes?.status === 'available' && !current, error: current?.error ?? null }
}

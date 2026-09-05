import { useEffect, useState } from 'react'
import type { RoomSurfacePatch } from '../../room-analysis/types'
import type { FinalizedRealityReconstruction } from '../types'
import type { RealityStructuralAssociationTable } from '../services/realityStructuralAssociationService'

/** One post-analysis pass. It never feeds back into either immutable source model. */
export function useRealityStructuralAssociation(
  reality: FinalizedRealityReconstruction | null | undefined,
  patches: readonly RoomSurfacePatch[],
): { table: RealityStructuralAssociationTable | null; pending: boolean; error: string | null } {
  const [result, setResult] = useState<{ reality: FinalizedRealityReconstruction; patches: readonly RoomSurfacePatch[]; table?: RealityStructuralAssociationTable; error?: string } | null>(null)
  useEffect(() => {
    if (reality?.status !== 'available' || patches.length === 0) return
    let worker: Worker | undefined
    let cancelled = false
    const fail = (error: string) => { if (!cancelled) setResult({ reality, patches, error }) }
    try {
      worker = new Worker(new URL('../services/realityStructuralAssociation.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ table?: RealityStructuralAssociationTable; error?: string }>) => {
        if (!cancelled) setResult({ reality, patches, ...event.data })
        worker?.terminate()
      }
      worker.onerror = () => { fail('Reality-to-surface association failed. Original Reality remains available.'); worker?.terminate() }
      worker.postMessage({ surfels: reality.surfels, patches })
    } catch (error) { fail(error instanceof Error ? error.message : 'Association worker unavailable.'); worker?.terminate() }
    return () => { cancelled = true; worker?.terminate() }
  }, [patches, reality])
  const current = result !== null && result.reality === reality && result.patches === patches ? result : null
  return { table: current?.table ?? null, error: current?.error ?? null,
    pending: reality?.status === 'available' && patches.length > 0 && !current }
}

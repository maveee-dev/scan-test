/// <reference lib="webworker" />

import type { M812SynchronizedRgbdSnapshot } from './m812SynchronizedRgbdCaptureService'
import {
  createM812SynchronizedRgbdBrowserProof,
  getM812ProofTransferBuffers,
  type M812RgbdBrowserProof,
} from './m812SynchronizedRgbdProofService'

interface ProofRequest {
  readonly id: number
  readonly snapshot: M812SynchronizedRgbdSnapshot
  readonly postedEpochMs: number
}

export interface M812ProofWorkerResult {
  readonly id: number
  readonly proof?: M812RgbdBrowserProof
  readonly error?: string
  readonly postedEpochMs: number
  readonly workerReceiveEpochMs: number
  readonly workerPostEpochMs: number
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope
const epochNow = (): number => performance.timeOrigin + performance.now()

workerScope.onmessage = (event: MessageEvent<ProofRequest>): void => {
  const workerReceiveEpochMs = epochNow()
  try {
    const proof = createM812SynchronizedRgbdBrowserProof(event.data.snapshot)
    const result: M812ProofWorkerResult = {
      id: event.data.id,
      proof,
      postedEpochMs: event.data.postedEpochMs,
      workerReceiveEpochMs,
      workerPostEpochMs: epochNow(),
    }
    workerScope.postMessage(result, getM812ProofTransferBuffers(proof))
  } catch (error) {
    const result: M812ProofWorkerResult = {
      id: event.data.id,
      error: error instanceof Error ? error.message : 'M8.12 proof failed.',
      postedEpochMs: event.data.postedEpochMs,
      workerReceiveEpochMs,
      workerPostEpochMs: epochNow(),
    }
    workerScope.postMessage(result)
  }
}

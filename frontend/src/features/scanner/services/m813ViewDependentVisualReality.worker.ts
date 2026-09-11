/// <reference lib="webworker" />
import {
  buildM813ViewDependentVisualReality,
  type M813ViewDependentVisualRealityResult,
  type M813VirtualView,
} from './m813ViewDependentVisualRealityService'
import type { M812SynchronizedRgbdSnapshot } from './m812SynchronizedRgbdCaptureService'

export interface M813WorkerResult {
  readonly id: number
  readonly result?: M813ViewDependentVisualRealityResult
  readonly error?: string
  readonly workerReceiveEpochMs?: number
  readonly workerResultPostEpochMs?: number
}

self.onmessage = (event: MessageEvent<{ id: number; snapshot: M812SynchronizedRgbdSnapshot; view: M813VirtualView }>) => {
  const workerReceiveEpochMs = Date.now()
  try {
    const result = buildM813ViewDependentVisualReality(event.data.snapshot, event.data.view)
    const transfers = new Set<ArrayBuffer>()
    for (const keyframe of result.keyframes) {
      for (const array of [keyframe.rgb, keyframe.positions, keyframe.sourceGridUvs, keyframe.sourceSampleIndices, keyframe.indices]) {
        if (array.buffer instanceof ArrayBuffer) transfers.add(array.buffer)
      }
    }
    const workerResultPostEpochMs = Date.now()
    self.postMessage({ id: event.data.id, result, workerReceiveEpochMs, workerResultPostEpochMs }, [...transfers])
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : 'M8.13 build failed.', workerReceiveEpochMs })
  }
}

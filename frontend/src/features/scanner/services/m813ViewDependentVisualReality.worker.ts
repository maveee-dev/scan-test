/// <reference lib="webworker" />
import {
  buildM813ViewDependentVisualReality,
  type M813ViewDependentVisualRealityProgress,
  type M813ViewDependentVisualRealityResult,
  type M813VirtualView,
} from './m813ViewDependentVisualRealityService'
import type { M812SynchronizedRgbdSnapshot } from './m812SynchronizedRgbdCaptureService'

export type M813WorkerResult =
  | {
    readonly id: number
    readonly type: 'progress'
    readonly progress: M813ViewDependentVisualRealityProgress
  }
  | {
    readonly id: number
    readonly type: 'complete'
    readonly result: M813ViewDependentVisualRealityResult
    readonly workerReceiveEpochMs: number
    readonly workerResultPostEpochMs: number
  }
  | {
    readonly id: number
    readonly type: 'error'
    readonly error: string
    readonly workerReceiveEpochMs: number
  }

self.onmessage = (event: MessageEvent<{ id: number; snapshot: M812SynchronizedRgbdSnapshot; view: M813VirtualView }>) => {
  const workerReceiveEpochMs = Date.now()
  try {
    const result = buildM813ViewDependentVisualReality(event.data.snapshot, event.data.view, {
      onProgress: (progress) => self.postMessage({ id: event.data.id, type: 'progress', progress } satisfies M813WorkerResult),
    })
    const transfers = new Set<ArrayBuffer>()
    for (const keyframe of result.keyframes) {
      for (const array of [keyframe.rgb, keyframe.positions, keyframe.sourceGridUvs, keyframe.vertexColors, keyframe.sourceSampleIndices, keyframe.indices]) {
        if (array.buffer instanceof ArrayBuffer) transfers.add(array.buffer)
      }
    }
    const workerResultPostEpochMs = Date.now()
    self.postMessage({ id: event.data.id, type: 'complete', result, workerReceiveEpochMs, workerResultPostEpochMs } satisfies M813WorkerResult, [...transfers])
  } catch (error) {
    self.postMessage({ id: event.data.id, type: 'error', error: error instanceof Error ? error.message : 'M8.13 build failed.', workerReceiveEpochMs } satisfies M813WorkerResult)
  }
}

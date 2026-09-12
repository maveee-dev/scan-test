import { parseScanJsonExportStream } from './scanJsonExportService'
import type { LoadedScanReplayReview } from './scanReplayLoadService'

interface ScanJsonImportRequest {
  readonly id: number
  readonly file: File
}

interface ScanJsonImportResponse {
  readonly id: number
  readonly stage?: 'parsing-json'
  readonly review?: LoadedScanReplayReview
  readonly error?: string
}

interface ScanJsonWorkerScope {
  onmessage: ((event: MessageEvent<ScanJsonImportRequest>) => void) | null
  postMessage(message: ScanJsonImportResponse): void
}

const workerScope = self as unknown as ScanJsonWorkerScope

workerScope.onmessage = (event): void => {
  const { id, file } = event.data
  workerScope.postMessage({ id, stage: 'parsing-json' })
  void parseScanJsonExportStream(file.stream(), file.name)
    .then((review) => workerScope.postMessage({ id, review }))
    .catch((cause: unknown) => workerScope.postMessage({
      id,
      error: cause instanceof Error ? cause.message : 'Could not load this JSON scan file.',
    }))
}

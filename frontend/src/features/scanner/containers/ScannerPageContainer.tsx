import { useCallback, useRef, useState } from 'react'
import ScannerPage from '../components/ScannerPage'
import { useScannerSession } from '../hooks/useScannerSession'
import { useWebXRSupport } from '../hooks/useWebXRSupport'
import { loadScanReplayFile, type LoadedScanReplayReview, type ScanReplayLoadStage } from '../services/scanReplayLoadService'

const LOAD_STAGE_LABELS: Record<ScanReplayLoadStage, string> = {
  'reading-file': 'Reading the saved scan locally…',
  'parsing-json': 'Reading the saved room model…',
  'reconstructing-geometry': 'Rebuilding measured room geometry…',
  'cleaning-surfaces': 'Preparing the room preview…',
  'applying-room-appearance': 'Applying saved room appearance…',
}

interface ScannerPageContainerProps {
  onExit: () => void
}

function ScannerPageContainer({ onExit }: ScannerPageContainerProps) {
  const overlayRootRef = useRef<HTMLDivElement>(null)
  const pointPreviewCanvasRef = useRef<HTMLCanvasElement>(null)
  const checkState = useWebXRSupport()
  const sessionController = useScannerSession(overlayRootRef, pointPreviewCanvasRef)
  const canStartScan = checkState.capabilities?.immersiveAr === true
  const [loadedScanReview, setLoadedScanReview] = useState<LoadedScanReplayReview | null>(null)
  const [isLoadingScan, setIsLoadingScan] = useState(false)
  const [scanLoadStage, setScanLoadStage] = useState('')
  const [scanLoadError, setScanLoadError] = useState<string | null>(null)

  const onLoadScan = useCallback((file: File): void => {
    setIsLoadingScan(true)
    setScanLoadError(null)
    setScanLoadStage(LOAD_STAGE_LABELS['reading-file'])
    void loadScanReplayFile(file, (stage) => setScanLoadStage(LOAD_STAGE_LABELS[stage]))
      .then(setLoadedScanReview)
      .catch((cause: unknown) => {
        setScanLoadError(cause instanceof Error ? cause.message : 'Could not load this scan file.')
      })
      .finally(() => {
        setIsLoadingScan(false)
        setScanLoadStage('')
      })
  }, [])

  const clearLoadedScan = useCallback((): void => {
    setLoadedScanReview(null)
    setScanLoadError(null)
    setScanLoadStage('')
  }, [])

  return (
    <ScannerPage
      {...checkState}
      canStartScan={canStartScan}
      loadedScanReview={loadedScanReview}
      isLoadingScan={isLoadingScan}
      scanLoadStage={scanLoadStage}
      scanLoadError={scanLoadError}
      overlayRootRef={overlayRootRef}
      pointPreviewCanvasRef={pointPreviewCanvasRef}
      onStartScan={() => {
        clearLoadedScan()
        sessionController.startScan()
      }}
      onLoadScan={onLoadScan}
      onLoadAnotherScan={clearLoadedScan}
      onDebugGeometryToggle={sessionController.setDebugGeometryVisible}
      onCoverageOverlayToggle={sessionController.setCoverageOverlayVisible}
      onPersistentSurfelDebugToggle={sessionController.setPersistentSurfelDebugVisible}
      onRawCameraDebugToggle={sessionController.setRawCameraDebugVisible}
      onRgbDepthDebugToggle={sessionController.setRgbDepthDebugVisible}
      onDenseMaskStabilizationOptionsChange={sessionController.setDenseMaskStabilizationOptions}
      onCancelScan={sessionController.cancelScan}
      onFinishScan={sessionController.finishScan}
      onStartNewScan={() => {
        if (loadedScanReview) {
          clearLoadedScan()
          return
        }
        sessionController.startNewScan()
      }}
      onDiscardScan={() => {
        if (loadedScanReview) {
          clearLoadedScan()
          return
        }
        sessionController.discardScan()
      }}
      onExit={onExit}
      sessionState={sessionController.sessionState}
      liveMap={sessionController.liveMap}
    />
  )
}

export default ScannerPageContainer

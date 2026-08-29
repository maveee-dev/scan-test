import { useRef } from 'react'
import ScannerPage from '../components/ScannerPage'
import { useScannerSession } from '../hooks/useScannerSession'
import { useWebXRSupport } from '../hooks/useWebXRSupport'

function ScannerPageContainer() {
  const overlayRootRef = useRef<HTMLDivElement>(null)
  const pointPreviewCanvasRef = useRef<HTMLCanvasElement>(null)
  const checkState = useWebXRSupport()
  const sessionController = useScannerSession(overlayRootRef, pointPreviewCanvasRef)
  const canStartScan = checkState.capabilities?.immersiveAr === true

  return (
    <ScannerPage
      {...checkState}
      canStartScan={canStartScan}
      overlayRootRef={overlayRootRef}
      pointPreviewCanvasRef={pointPreviewCanvasRef}
      onStartScan={sessionController.startScan}
      onCancelScan={sessionController.cancelScan}
      onFinishScan={sessionController.finishScan}
      onStartNewScan={sessionController.startNewScan}
      onDiscardScan={sessionController.discardScan}
      sessionState={sessionController.sessionState}
    />
  )
}

export default ScannerPageContainer

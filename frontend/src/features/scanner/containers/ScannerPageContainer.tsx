import { useRef } from 'react'
import ScannerPage from '../components/ScannerPage'
import { useScannerSession } from '../hooks/useScannerSession'
import { useWebXRSupport } from '../hooks/useWebXRSupport'

function ScannerPageContainer() {
  const overlayRootRef = useRef<HTMLDivElement>(null)
  const checkState = useWebXRSupport()
  const sessionController = useScannerSession(overlayRootRef)
  const canStartScan = checkState.capabilities?.immersiveAr === true

  return (
    <ScannerPage
      {...checkState}
      canStartScan={canStartScan}
      overlayRootRef={overlayRootRef}
      onStartScan={sessionController.startScan}
      onStopScan={sessionController.stopScan}
      sessionState={sessionController.sessionState}
    />
  )
}

export default ScannerPageContainer

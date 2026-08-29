import ScannerPage from '../components/ScannerPage'
import { useScannerSession } from '../hooks/useScannerSession'
import { useWebXRSupport } from '../hooks/useWebXRSupport'

function ScannerPageContainer() {
  const checkState = useWebXRSupport()
  const sessionController = useScannerSession()
  const canStartScan = checkState.capabilities?.immersiveAr === true

  return (
    <ScannerPage
      {...checkState}
      canStartScan={canStartScan}
      onStartScan={sessionController.startScan}
      onStopScan={sessionController.stopScan}
      sessionState={sessionController.sessionState}
    />
  )
}

export default ScannerPageContainer

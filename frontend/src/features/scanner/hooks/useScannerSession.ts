import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  XRSessionError,
  XRSessionService,
} from '../services/xrSessionService'
import { createInitialDepthDebug } from '../services/xrDepthService'
import { createInitialSpatialPointDebug } from '../services/spatialPointService'
import { createInitialSpatialCoverageDebug } from '../services/spatialCoverageService'
import type {
  FinalizedSpatialScan,
  ScanSessionStatus,
  ScannerSessionState,
  ViewerPoseDebug,
} from '../types'

const createInitialDebug = (): ViewerPoseDebug => ({
  sessionActive: false,
  glContextStatus: 'unknown',
  baseLayerStatus: 'unknown',
  referenceSpaceStatus: 'idle',
  xrFrameCount: 0,
  poseSampleCount: 0,
  trackingStatus: 'waiting',
  trackingActive: false,
  position: null,
  referenceSpaceType: null,
  lastSampledAt: null,
  depth: createInitialDepthDebug(),
  spatial: createInitialSpatialPointDebug(),
  coverage: createInitialSpatialCoverageDebug(),
})

const createInitialState = (): ScannerSessionState => ({
  status: 'ready',
  debug: createInitialDebug(),
  domOverlayStatus: 'unknown',
  error: null,
  finalizedScan: null,
})

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof XRSessionError) {
    return error.message
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallbackMessage
}

export interface ScannerSessionController {
  sessionState: ScannerSessionState
  startScan: () => void
  cancelScan: () => void
  finishScan: () => void
  startNewScan: () => void
  discardScan: () => void
}

export function useScannerSession(
  overlayRootRef: RefObject<HTMLDivElement | null>,
  pointPreviewCanvasRef: RefObject<HTMLCanvasElement | null>,
): ScannerSessionController {
  const [service] = useState(() => new XRSessionService())
  const mountedRef = useRef(true)
  const statusRef = useRef<ScanSessionStatus>('ready')
  const [sessionState, setSessionState] = useState<ScannerSessionState>(createInitialState)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      void service.dispose()
    }
  }, [service])

  const startScan = useCallback(() => {
    if (statusRef.current !== 'ready' && statusRef.current !== 'error') {
      return
    }

    const overlayRoot = overlayRootRef.current
    if (!overlayRoot) {
      statusRef.current = 'error'
      setSessionState((currentState) => ({
        ...currentState,
        status: 'error',
        error: 'The scanner overlay could not be prepared. Reload and try again.',
      }))
      return
    }

    statusRef.current = 'starting'
    setSessionState((currentState) => ({
      ...currentState,
      status: 'starting',
      debug: createInitialDebug(),
      domOverlayStatus: 'unknown',
      error: null,
    }))

    void service
      .start({
        callbacks: {
          onDomOverlayState: (domOverlayStatus) => {
            if (!mountedRef.current) {
              return
            }

            setSessionState((currentState) => ({
              ...currentState,
              domOverlayStatus,
            }))
          },
          onDiagnostics: (debug) => {
            if (!mountedRef.current) {
              return
            }

            setSessionState((currentState) => ({ ...currentState, debug }))
          },
          onError: (error) => {
            if (!mountedRef.current) {
              return
            }

            statusRef.current = 'error'
            setSessionState((currentState) => ({
              ...currentState,
              status: 'error',
              error: error.message,
            }))
          },
          onSessionEnded: (reason) => {
            if (!mountedRef.current) {
              return
            }

            if (reason === 'finished') {
              setSessionState((currentState) => ({
                ...currentState,
                status: 'finishing',
                debug: createInitialDebug(),
                domOverlayStatus: 'unknown',
                error: null,
              }))
              return
            }

            if (reason === 'external') {
              statusRef.current = 'error'
              setSessionState((currentState) => ({
                ...currentState,
                status: 'error',
                debug: {
                  ...currentState.debug,
                  sessionActive: false,
                  trackingActive: false,
                  trackingStatus: 'waiting',
                  position: null,
                  depth: createInitialDepthDebug(),
                  spatial: createInitialSpatialPointDebug(),
                  coverage: createInitialSpatialCoverageDebug(),
                },
                error:
                  currentState.error ??
                  'The XR session ended unexpectedly. Start a new scan to try again.',
              }))
              return
            }

            statusRef.current = 'ready'
            setSessionState((currentState) => ({
              ...currentState,
              status: 'ready',
              debug: createInitialDebug(),
              finalizedScan: null,
              error: null,
            }))
          },
        },
        overlayRoot,
        pointPreviewCanvas: pointPreviewCanvasRef.current ?? undefined,
      })
      .then(() => {
        if (!mountedRef.current || statusRef.current !== 'starting') {
          return
        }

        statusRef.current = 'scanning'
        setSessionState((currentState) => ({
          ...currentState,
          status: 'scanning',
          finalizedScan: null,
          error: null,
        }))
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) {
          return
        }

        statusRef.current = 'error'
        setSessionState((currentState) => ({
          ...currentState,
          status: 'error',
          error: getErrorMessage(
            error,
            'Unable to start immersive AR. Check permissions and try again.',
          ),
        }))
      })
  }, [overlayRootRef, pointPreviewCanvasRef, service])

  const cancelScan = useCallback(() => {
    if (statusRef.current !== 'scanning' && statusRef.current !== 'starting') {
      return
    }

    statusRef.current = 'cancelling'
    setSessionState((currentState) => ({
      ...currentState,
      status: 'cancelling',
      error: null,
    }))

    void service
      .stop()
      .then(() => {
        if (!mountedRef.current || statusRef.current !== 'cancelling') {
          return
        }

        statusRef.current = 'ready'
        setSessionState((currentState) => ({
          ...currentState,
          status: 'ready',
          debug: createInitialDebug(),
          finalizedScan: null,
          error: null,
        }))
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) {
          return
        }

        statusRef.current = 'error'
        setSessionState((currentState) => ({
          ...currentState,
          status: 'error',
          error: getErrorMessage(error, 'Unable to stop the XR session cleanly.'),
        }))
      })
  }, [service])

  const finishScan = useCallback(() => {
    if (statusRef.current !== 'scanning') {
      return
    }

    statusRef.current = 'finishing'
    setSessionState((currentState) => ({
      ...currentState,
      status: 'finishing',
      error: null,
    }))

    void service
      .finish()
      .then((finalizedScan: FinalizedSpatialScan) => {
        if (!mountedRef.current || statusRef.current !== 'finishing') {
          return
        }

        statusRef.current = 'finished'
        setSessionState((currentState) => ({
          ...currentState,
          status: 'finished',
          debug: createInitialDebug(),
          domOverlayStatus: 'unknown',
          finalizedScan,
          error: null,
        }))
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) {
          return
        }

        statusRef.current = 'error'
        setSessionState((currentState) => ({
          ...currentState,
          status: 'error',
          error: getErrorMessage(error, 'Unable to finish the scan cleanly.'),
        }))
      })
  }, [service])

  const startNewScan = useCallback(() => {
    if (statusRef.current !== 'finished') {
      return
    }

    statusRef.current = 'ready'
    startScan()
  }, [startScan])

  const discardScan = useCallback(() => {
    if (statusRef.current !== 'finished') {
      return
    }

    statusRef.current = 'ready'
    setSessionState(createInitialState())
  }, [])

  return {
    sessionState,
    startScan,
    cancelScan,
    finishScan,
    startNewScan,
    discardScan,
  }
}

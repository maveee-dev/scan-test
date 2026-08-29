import { useCallback, useEffect, useRef, useState } from 'react'
import {
  XRSessionError,
  XRSessionService,
} from '../services/xrSessionService'
import type {
  ScanSessionStatus,
  ScannerSessionState,
  ViewerPoseDebug,
} from '../types'

const createInitialDebug = (): ViewerPoseDebug => ({
  trackingActive: false,
  sampledFrameCount: 0,
  position: null,
  referenceSpaceType: null,
  lastSampledAt: null,
})

const createInitialState = (): ScannerSessionState => ({
  status: 'ready',
  debug: createInitialDebug(),
  error: null,
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
  stopScan: () => void
}

export function useScannerSession(): ScannerSessionController {
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

    statusRef.current = 'starting'
    setSessionState((currentState) => ({
      ...currentState,
      status: 'starting',
      error: null,
    }))

    void service
      .start({
        onDebugUpdate: (debug) => {
          if (!mountedRef.current) {
            return
          }

          setSessionState((currentState) => {
            if (currentState.status !== 'scanning') {
              return currentState
            }

            return { ...currentState, debug }
          })
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

          if (reason === 'external') {
            statusRef.current = 'error'
            setSessionState({
              status: 'error',
              debug: createInitialDebug(),
              error: 'The XR session ended unexpectedly. Start a new scan to try again.',
            })
            return
          }

          statusRef.current = 'ready'
          setSessionState({
            status: 'ready',
            debug: createInitialDebug(),
            error: null,
          })
        },
      })
      .then(() => {
        if (!mountedRef.current || statusRef.current !== 'starting') {
          return
        }

        statusRef.current = 'scanning'
        setSessionState((currentState) => ({
          ...currentState,
          status: 'scanning',
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
  }, [service])

  const stopScan = useCallback(() => {
    if (statusRef.current !== 'scanning') {
      return
    }

    statusRef.current = 'stopping'
    setSessionState((currentState) => ({
      ...currentState,
      status: 'stopping',
      error: null,
    }))

    void service
      .stop()
      .then(() => {
        if (!mountedRef.current || statusRef.current !== 'stopping') {
          return
        }

        statusRef.current = 'ready'
        setSessionState({
          status: 'ready',
          debug: createInitialDebug(),
          error: null,
        })
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

  return { sessionState, startScan, stopScan }
}

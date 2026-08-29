import { useEffect, useState } from 'react'
import { detectWebXRSupport } from '../services/webxrSupport'
import type { WebXRCheckState } from '../types'

const initialState: WebXRCheckState = {
  status: 'checking',
  capabilities: null,
}

export function useWebXRSupport(): WebXRCheckState {
  const [state, setState] = useState<WebXRCheckState>(initialState)

  useEffect(() => {
    let isCurrent = true

    void detectWebXRSupport().then(
      (capabilities) => {
        if (isCurrent) {
          setState({ status: 'complete', capabilities })
        }
      },
      () => {
        if (isCurrent) {
          setState({ status: 'error', capabilities: null })
        }
      },
    )

    return () => {
      isCurrent = false
    }
  }, [])

  return state
}

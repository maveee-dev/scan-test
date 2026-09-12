import { useEffect, useRef, useState } from 'react'
import { BUILD_INFO } from '../../../config/buildInfo'
import type { FinalizedDenseRealityReconstruction } from '../types'
import { encodeScanReplay } from '../services/scanReplayCaptureService'

export default function ScanCaptureDownload({ source }: { source: FinalizedDenseRealityReconstruction }) {
  const [error, setError] = useState('')
  const [file, setFile] = useState<{ url: string; name: string; bytes: number } | null>(null)
  const downloadUrl = useRef<string | null>(null)
  useEffect(() => () => {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    downloadUrl.current = null
  }, [source])
  if (!source.retainedMeasurements) return null
  const download = () => {
    if (!source.retainedMeasurements) return
    try {
      const blob = encodeScanReplay({
        format: 'spatial-scan-replay', version: 1, scanId: source.scanId,
        referenceSpaceType: source.referenceSpaceType,
        build: `${BUILD_INFO.scannerMilestone}/${BUILD_INFO.commit}/texture-visibility-v1`,
        measurements: source.retainedMeasurements, appearance: source.appearanceKeyframes ?? null,
        diagnostics: { depthSource: source.depthSource, measurement: source.measurementDiagnostics, canonical: source.canonicalFusionDiagnostics },
      })
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
      downloadUrl.current = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl.current
      link.download = `room-${source.scanId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}.scan`
      document.body.append(link); link.click(); link.remove()
      setFile({ url: downloadUrl.current, name: link.download, bytes: blob.size })
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this scan capture.')
    }
  }
  return <div style={{ marginBlock: 16 }}>
    <button type="button" className="scan-button scan-button-secondary" onClick={download}>Download scan capture</button>
    <p>Save the captured room photos, depth and camera positions for troubleshooting. This downloads a local .scan file; nothing is uploaded.</p>
    {file && <p>Capture ready ({(file.bytes / 1024 / 1024).toFixed(1)} MiB). If the download did not start, <a href={file.url} download={file.name} style={{ color: 'inherit', textDecoration: 'underline' }}>save the capture file</a>.</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}

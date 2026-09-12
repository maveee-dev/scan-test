import type { ScanCaptureGuidance } from '../services/scanCaptureGuidance'

interface ScanCoverageGuideProps {
  guidance: ScanCaptureGuidance
  visible: boolean
  available: boolean
  onToggle: () => void
}

export default function ScanCoverageGuide({ guidance, visible, available, onToggle }: ScanCoverageGuideProps) {
  return <section className="scan-coverage-guide" aria-label="Scan coverage">
    <div className="scan-coverage-heading">
      <strong>Surface coverage</strong>
      <button type="button" aria-pressed={visible} onClick={onToggle}>{visible ? 'Hide colors' : 'Show colors'}</button>
    </div>
    {!available && <p role="status">Coverage colors are unavailable. Move slowly and inspect every side before finishing.</p>}
    {visible && available && <ul className="scan-coverage-legend">
      <li><i className="is-observed" />New</li>
      <li><i className="is-partial" />Another angle</li>
      <li><i className="is-captured" />Reinforced</li>
    </ul>}
    <div className="scan-coverage-meter">
      <span>{guidance.reinforcedPercentage === null ? 'Waiting for measured surfaces' : `${guidance.reinforcedPercentage}% of observed area reinforced`}</span>
      <progress max={100} value={guidance.reinforcedPercentage ?? 0} aria-label="Observed area reinforced" />
    </div>
    <p>Unmarked areas have no confirmed coverage. This is not a percentage of the whole room.</p>
  </section>
}

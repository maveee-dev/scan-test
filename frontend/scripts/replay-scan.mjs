import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { loadScannerModule } from './load-scanner-module.mjs'

try {
  const [file, destination] = process.argv.slice(2)
  if (!file) throw new Error('Usage: npm run replay:scan -- path/to/room.scan [output-directory]')
  const { decodeScanReplay, MAX_SCAN_REPLAY_BYTES } = await loadScannerModule('scanReplayCaptureService')
  if (statSync(file).size > MAX_SCAN_REPLAY_BYTES) throw new Error('Capture exceeds the replay size limit.')
  const bytes = readFileSync(file)
  const capture = decodeScanReplay(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const { CanonicalRealityFusionService } = await loadScannerModule('canonicalRealityFusionService')
  const { createRetainedRealityMeasurementSnapshotSignature } = await loadScannerModule('layeredMeasuredSurfaceFieldService')
  const { filterRealityConfidence } = await loadScannerModule('realityConfidenceFiltering')
  const { refineRealityDisplay } = await loadScannerModule('realityDisplayRefinement')
  const { createRealitySurfaceRenderResources, appendRealityTextureBatches, packRealitySurface } = await loadScannerModule('realitySurfaceRenderingService')
  const canonical = new CanonicalRealityFusionService().reconstruct(capture.measurements)
  const filtered = filterRealityConfidence(canonical.surfels)
  const refined = refineRealityDisplay(filtered.surfels, capture.appearance?.keyframes ?? [])
  const resources = createRealitySurfaceRenderResources({ surfels: refined.combined }, 'dense')
  try {
    appendRealityTextureBatches(resources, refined.combined, refined.textureBindingCandidates, capture.appearance?.keyframes ?? [])
    const prepared = packRealitySurface(resources)
    const output = resolve(destination ?? join('replay-output', capture.scanId.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) || 'scan'))
    mkdirSync(output, { recursive: true })
    const report = {
      scanId: capture.scanId, capturedBuild: capture.build,
      inputSignature: createRetainedRealityMeasurementSnapshotSignature(capture.measurements),
      inputBytes: bytes.byteLength, depthSource: capture.diagnostics?.depthSource,
      retainedFrames: capture.measurements.frames.length,
      appearanceFrames: capture.appearance?.keyframes.length ?? 0,
      recordedCanonicalCount: capture.diagnostics?.canonical?.canonicalSurfels,
      replayCanonicalCount: canonical.surfels.length, finalCount: refined.combined.length,
      canonical: canonical.diagnostics, confidence: filtered.stats, refinement: refined.stats,
      texture: prepared.textureStats,
    }
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
    const header = ['ply', 'format ascii 1.0', 'comment Measured canonical samples, metres; no inferred geometry',
      `element vertex ${canonical.surfels.length}`, 'property float x', 'property float y', 'property float z',
      'property uchar red', 'property uchar green', 'property uchar blue', 'end_header']
    const points = canonical.surfels.map(s => {
      const color = s.colorRgb ?? { r: .34, g: .39, b: .43 }
      return [s.position.x, s.position.y, s.position.z, ...[color.r, color.g, color.b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255))].join(' ')
    })
    writeFileSync(join(output, 'canonical.ply'), [...header, ...points, ''].join('\n'))
    console.log(JSON.stringify({ output, inputSignature: report.inputSignature, retainedFrames: report.retainedFrames,
      canonicalSamples: canonical.surfels.length, finalSamples: refined.combined.length,
      removedByVisibility: canonical.diagnostics.visibility?.removedSamples ?? 0,
      texture: prepared.textureStats }, null, 2))
  } finally {
    resources.geometries.forEach(geometry => geometry.dispose())
    resources.materials.forEach(material => material.dispose())
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Replay failed.')
  process.exitCode = 1
}

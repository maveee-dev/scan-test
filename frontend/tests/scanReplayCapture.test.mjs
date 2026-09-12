import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadScannerModule as load } from '../scripts/load-scanner-module.mjs'

const { filterMeasuredVisibility } = await load('measuredVisibilityService')
const { encodeScanReplay, decodeScanReplay } = await load('scanReplayCaptureService')
const { retainedMeasurementTransferBuffers } = await load('retainedRealityMeasurementService')
const { CanonicalRealityFusionService } = await load('canonicalRealityFusionService')
const { createRetainedRealityMeasurementSnapshotSignature } = await load('layeredMeasuredSurfaceFieldService')
const { loadScanReplayFile } = await load('scanReplayLoadService')
const identity = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
const projection = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,-1,-1, 0,0,-.1,0])
function frame(sequence, cameraX = (sequence - 1) * .12, depth = 2) {
  const columns = 16, rows = 16, count = columns * rows
  const normalizedX = new Float32Array(count), normalizedY = new Float32Array(count), points = new Float32Array(count * 3), normals = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const u = .44 + (i % columns + .5) * .12 / columns, v = .44 + (Math.floor(i / columns) + .5) * .12 / rows
    normalizedX[i] = u; normalizedY[i] = v
    points.set([(2 * u - 1) * depth + cameraX, (1 - 2 * v) * depth, -depth], i * 3)
    normals[i * 3 + 2] = 1
  }
  const inverseViewTransform = identity(); inverseViewTransform[12] = -cameraX
  return { sequence, timestamp: sequence * 300, samplingPhase: sequence % 4, trackingEpoch: 0, trackingQuality: 1,
    cameraPosition: { x: cameraX, y: 0, z: 0 }, cameraOrientation: { x: 0, y: 0, z: 0, w: 1 },
    projectionMatrix: projection(), inverseViewTransform,
    denseFrame: { columns, rows, valid: new Uint8Array(count).fill(1), normalizedX, normalizedY, points,
      distancesMeters: new Float32Array(count).fill(depth), attemptedSampleCount: count, validPointCount: count, rejectedPointCount: 0 },
    normals, normalValid: new Uint8Array(count).fill(1), colorSourceIndices: Int32Array.from({ length: count }, (_, i) => i),
    srgbColors: new Uint8Array(count * 3).fill(180), coverageProxyKeys: [], viewpointProxyKey: 'test' }
}
const sample = (z, normal = { x: 0, y: 0, z: 1 }) => ({ position: { x: 0, y: 0, z }, normal })
const views = () => [frame(0), frame(1), frame(2)]
const snapshot = frames => ({ frames, diagnostics: { framesRetained: frames.length, samplesRetained: frames.reduce((sum, f) => sum + f.denseFrame.validPointCount, 0) } })
function capture() {
  return { format: 'spatial-scan-replay', version: 1, scanId: 'test-room', build: 'test', referenceSpaceType: 'local-floor',
    measurements: snapshot(views()), appearance: { keyframes: [{ id: 1, timestamp: 1, width: 2, height: 2,
      rgb: new Uint8Array([255,0,0, 255,0,0, 0,0,255, 0,0,255]), cameraTransform: identity(), inverseCameraTransform: identity(), projectionMatrix: projection(), qualityScore: 1,
      mapping: { sourceCameraWidth: 2, sourceCameraHeight: 2, copyWidth: 2, copyHeight: 2, orientation: 'upright', sourceUvRect: { x: 0, y: 0, width: 1, height: 1 } } }] }, diagnostics: {} }
}

test('visibility removes a free-space ghost after separated measured views, preserving the real wall and occluded background', () => {
  const wall = sample(-2), background = sample(-2.3), ghost = sample(-1.9)
  const result = filterMeasuredVisibility([wall, background, ghost], views())
  assert.deepEqual(result.surfels, [wall, background])
  assert.equal(result.diagnostics.removedSamples, 1)
  assert.equal(result.diagnostics.occludedComparisons, 3)
  assert.equal(result.diagnostics.supportedComparisons, 3)
})

test('visibility preserves actual protrusions and recessed surfaces supported by their own depth', () => {
  for (const depth of [1.7, 2, 2.4]) {
    const measured = sample(-depth)
    assert.deepEqual(filterMeasuredVisibility([measured], [frame(0, -.1, depth), frame(1, 0, depth), frame(2, .1, depth)]).surfels, [measured])
    assert.equal(measured.position.z, -depth)
  }
})

test('invalid depth, mixed edges, grazing normals, single positions and a short burst cannot remove a surface', () => {
  for (const condition of ['invalid', 'edge', 'grazing', 'stationary', 'short', 'missing-calibration', 'off-screen']) {
    const frames = condition === 'stationary' ? [frame(0, 0), frame(1, 0), frame(2, 0)] : views(), surfel = sample(-1.9)
    for (const f of frames) {
      if (condition === 'invalid') { f.denseFrame.valid.fill(0, 7 * 16, 9 * 16); f.denseFrame.validPointCount -= 32 }
      if (condition === 'edge') f.denseFrame.distancesMeters.forEach((_d, i, array) => {
        const depth = i % 2 ? 2 : 2.3
        array[i] = depth
        f.denseFrame.points.set([(2 * f.denseFrame.normalizedX[i] - 1) * depth + f.cameraPosition.x, (1 - 2 * f.denseFrame.normalizedY[i]) * depth, -depth], i * 3)
      })
      if (condition === 'short') f.timestamp = f.sequence * 20
      if (condition === 'missing-calibration') delete f.projectionMatrix
    }
    if (condition === 'grazing') surfel.normal = { x: 1, y: 0, z: 0 }
    if (condition === 'off-screen') surfel.position.x = 100
    assert.deepEqual(filterMeasuredVisibility([surfel], frames).surfels, [surfel], condition)
  }
})

test('repeated measured support outweighs a minority of contradictory views and work stays bounded', () => {
  const surfel = sample(-1.9), frames = Array.from({ length: 96 }, (_, i) => frame(i, i % 2 ? .1 : -.1, i % 4 ? 1.9 : 2))
  const result = filterMeasuredVisibility([surfel], frames)
  assert.equal(result.diagnostics.checkedFrames, 24)
  assert.deepEqual(result.surfels, [surfel])
})

test('mismatched calibration and tracking epochs cannot turn measurements into free-space evidence', () => {
  for (const condition of ['projection', 'pose', 'epoch']) {
    const frames = views(), surfel = sample(-1.9)
    if (condition === 'projection') for (const frame of frames) frame.projectionMatrix[0] *= 2
    if (condition === 'pose') for (const frame of frames) frame.inverseViewTransform[14] = .2
    if (condition === 'epoch') frames[1].trackingEpoch = 1
    const result = filterMeasuredVisibility([surfel], frames)
    assert.deepEqual(result.surfels, [surfel])
    assert.equal(result.diagnostics.checkedFrames, 0)
  }
})

test('binary capture round trip keeps exact arrays, calibration, image rows and deterministic reconstruction', async () => {
  const input = capture(), blob = encodeScanReplay(input), decoded = decodeScanReplay(await blob.arrayBuffer())
  assert.deepEqual(decoded, input)
  assert.ok(input.measurements.frames[0].denseFrame.points.byteLength > 0)
  assert.equal(createRetainedRealityMeasurementSnapshotSignature(decoded.measurements), createRetainedRealityMeasurementSnapshotSignature(input.measurements))
  const reconstruct = measurements => new CanonicalRealityFusionService().reconstruct(measurements).surfels
  const before = reconstruct(input.measurements)
  assert.ok(before.length > 0)
  assert.deepEqual(reconstruct(decoded.measurements), before)
})

test('local scan loader rebuilds a review from the selected file without uploading it', async () => {
  const bytes = await encodeScanReplay(capture()).arrayBuffer()
  const stages = []
  const review = await loadScanReplayFile({
    name: 'phone-room.scan',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes,
  }, (stage) => stages.push(stage))

  assert.equal(review.fileName, 'phone-room.scan')
  assert.equal(review.frameCount, 3)
  assert.equal(review.sampleCount, 3 * 16 * 16)
  assert.equal(review.sampleLabel, 'Retained measurements')
  assert.ok(review.reconstruction.surfels.length > 0)
  assert.equal(review.reconstruction.canonicalSurfels, review.reconstruction.surfels)
  assert.equal(review.reconstruction.appearanceKeyframes.keyframes.length, 1)
  assert.ok(stages.includes('reading-file'))
  assert.ok(stages.includes('reconstructing-geometry'))
})

test('large JSON scan exports stream past auxiliary payloads and keep the saved room model', async () => {
  const exported = JSON.stringify({
    version: 1,
    exportedAt: '2026-09-12T00:00:00Z',
    ignored: { text: '"reconstruction":{"surfels":[]}', nested: [{ value: 12 }] },
    reconstruction: {
      scanId: 'json-room',
      referenceSpaceType: 'local-floor',
      status: 'available',
      surfels: [{ id: 7, position: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 0, z: 1 }, radius: .04,
        colorRgb: { r: .8, g: .5, b: .2 }, geometryConfidence: .9, colorConfidence: .7,
        colorObservationCount: 2, geometryObservationCount: 3, viewObservationCount: 1 }],
      m812SynchronizedRgbd: { largeExperimentalPayload: ['ignored', { text: 'escaped quote: \\" and brackets: [}]' }] },
    },
  })
  const bytes = new TextEncoder().encode(exported)
  let offset = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return }
      const end = Math.min(offset + 23, bytes.length)
      controller.enqueue(bytes.slice(offset, end))
      offset = end
    },
  })
  const stages = []
  const review = await loadScanReplayFile({
    name: 'laptop-room.json',
    type: 'application/json',
    size: bytes.byteLength,
    stream: () => stream,
  }, (stage) => stages.push(stage))
  assert.equal(review.fileName, 'laptop-room.json')
  assert.equal(review.capturedBuild, 'JSON scan export')
  assert.equal(review.frameCount, null)
  assert.equal(review.sampleCount, null)
  assert.equal(review.reconstruction.surfels.length, 1)
  assert.deepEqual(review.reconstruction.surfels[0].colorRgb, { r: .8, g: .5, b: .2 })
  assert.deepEqual(review.reconstruction.bounds, { min: { x: 1, y: 2, z: 3 }, max: { x: 1, y: 2, z: 3 } })
  assert.equal(review.reconstruction.status, 'available')
  assert.ok(stages.includes('parsing-json'))
})

test('calibration changes the replay signature', () => {
  const input = capture(), before = createRetainedRealityMeasurementSnapshotSignature(input.measurements)
  input.measurements.frames[0].inverseViewTransform[12] += .05
  assert.notEqual(createRetainedRealityMeasurementSnapshotSignature(input.measurements), before)
})

test('worker transfer returns owned capture buffers without copies and includes calibration', () => {
  const input = capture().measurements
  const buffers = retainedMeasurementTransferBuffers(input)
  assert.equal(new Set(buffers).size, buffers.length)
  assert.ok(buffers.includes(input.frames[0].projectionMatrix.buffer))
  const outbound = structuredClone(input, { transfer: buffers })
  assert.equal(input.frames[0].denseFrame.points.byteLength, 0)
  const returned = structuredClone(outbound, { transfer: retainedMeasurementTransferBuffers(outbound) })
  assert.equal(outbound.frames[0].denseFrame.points.byteLength, 0)
  assert.equal(returned.frames[0].denseFrame.points.length, 16 * 16 * 3)
  assert.equal(returned.frames[0].projectionMatrix.length, 16)
})

test('capture reader rejects corrupt files, unsafe dimensions, invalid calibration and mixed tracking epochs', async () => {
  const bytes = await encodeScanReplay(capture()).arrayBuffer()
  assert.throws(() => decodeScanReplay(bytes.slice(0, bytes.byteLength - 1)), /Invalid/)
  const badMagic = bytes.slice(0); new Uint8Array(badMagic)[0] = 0
  assert.throws(() => decodeScanReplay(badMagic), /Invalid/)
  for (const corrupt of [c => { c.measurements.frames[0].denseFrame.columns = 100000 },
    c => { c.measurements.frames[0].projectionMatrix[0] = Infinity },
    c => { c.measurements.frames[1].trackingEpoch = 1 },
    c => { c.measurements.frames[1].sequence = 0 },
    c => { c.appearance.keyframes[0].rgb = new Uint8Array(1) }]) {
    const c = capture(); corrupt(c)
    const invalid = await encodeScanReplay(c).arrayBuffer()
    assert.throws(() => decodeScanReplay(invalid), /Invalid/)
  }
})

test('replay CLI reconstructs the exported capture through confidence, refinement and texture stages', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'scan-replay-test-'))
  const input = join(directory, 'fixture.scan'), output = join(directory, 'result')
  try {
    writeFileSync(input, new Uint8Array(await encodeScanReplay(capture()).arrayBuffer()))
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/replay-scan.mjs', import.meta.url)), input, output], { encoding: 'utf8', timeout: 60000 })
    assert.equal(run.status, 0, run.stderr)
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'))
    assert.equal(report.retainedFrames, 3)
    assert.equal(report.appearanceFrames, 1)
    assert.ok(report.replayCanonicalCount > 0)
    assert.ok(report.finalCount > 0)
    assert.ok(report.texture)
    const surfaceBytes = readFileSync(join(output, 'prepared.surface'))
    const metadataLength = surfaceBytes.readUInt32LE(0)
    const prepared = JSON.parse(surfaceBytes.subarray(4, 4 + metadataLength).toString('utf8'))
    assert.equal(prepared.stats.renderedSurfelCount, report.finalCount)
    assert.equal(prepared.textureStats.texturedTriangleCount, report.texture.texturedTriangleCount)
    assert.ok(surfaceBytes.byteLength > 4 + metadataLength)
    assert.match(readFileSync(join(output, 'canonical.ply'), 'utf8'), /element vertex [1-9]/)
  } finally {
    for (const file of [input, join(output, 'report.json'), join(output, 'canonical.ply'), join(output, 'prepared.surface')]) if (existsSync(file)) unlinkSync(file)
    if (existsSync(output)) rmdirSync(output)
    rmdirSync(directory)
  }
})

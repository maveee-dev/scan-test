import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const cache = new Map()
function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href)
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => `from '${specifier.startsWith('.') ? moduleUrl(new URL(`${specifier}.ts`, url)) : import.meta.resolve(specifier)}'`)
  const result = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  cache.set(url.href, result)
  return result
}
const load = (name) => import(moduleUrl(new URL(`../src/features/scanner/services/${name}.ts`, import.meta.url)))
const {
  M812SynchronizedRgbdCaptureService,
  cloneM812SynchronizedRgbdSnapshot,
  getM812SynchronizedRgbdTransferBuffers,
} = await load('m812SynchronizedRgbdCaptureService')
const { createM812SynchronizedRgbdBrowserProof } = await load('m812SynchronizedRgbdProofService')
const { mapCameraUvToCopyPixel } = await load('xrRawCameraService')

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const projection = () => new Float32Array([5, 0, 0, 0, 0, 5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function mapping(width = 16, height = 16, orientation = 'upright', sourceUvRect = { x: 0, y: 0, width: 1, height: 1 }) {
  return { sourceCameraWidth: width * 4, sourceCameraHeight: height * 4, copyWidth: width, copyHeight: height, sourceUvRect, orientation }
}

function keyframe(id, options = {}) {
  const width = options.width ?? 16, height = options.height ?? 16
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3
    rgb[offset] = options.poster === false ? x * 13 % 256 : x < width / 2 ? 0 : 255
    rgb[offset + 1] = y * 11 % 256
    rgb[offset + 2] = (x + y) * 7 % 256
  }
  const cameraTransform = identity(), inverseCameraTransform = identity()
  const cameraX = options.cameraX ?? 0
  cameraTransform[12] = cameraX
  inverseCameraTransform[12] = -cameraX
  return {
    id,
    timestamp: options.timestamp ?? id * 1000,
    width,
    height,
    rgb,
    cameraTransform,
    inverseCameraTransform,
    projectionMatrix: projection(),
    mapping: options.mapping ?? mapping(width, height),
    qualityScore: options.qualityScore ?? 1,
    translationDeltaMeters: cameraX,
    rotationDeltaDegrees: 0,
    validDepthFraction: 1,
  }
}

function packetFor(keyframeValue, options = {}) {
  const columns = options.columns ?? 8, rows = options.rows ?? 8, count = columns * rows
  const valid = new Uint8Array(count), normalizedX = new Float32Array(count), normalizedY = new Float32Array(count)
  const distancesMeters = new Float32Array(count), points = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const column = index % columns, row = Math.floor(index / columns)
    const u = (column + 0.5) / columns, v = (row + 0.5) / rows
    const depth = options.depthAt?.(column, row, index) ?? 1
    valid[index] = options.validAt?.(column, row, index) === false ? 0 : 1
    normalizedX[index] = u; normalizedY[index] = v; distancesMeters[index] = depth
    points[index * 3] = (u - 0.5) * 0.35
    points[index * 3 + 1] = (0.5 - v) * 0.35
    points[index * 3 + 2] = -depth
  }
  return {
    sequence: options.sequence ?? keyframeValue.id * 10,
    timestamp: options.timestamp ?? keyframeValue.timestamp,
    referenceSpaceType: 'local-floor',
    samplingPhase: 0,
    qualityTier: 0,
    pose: { timestamp: keyframeValue.timestamp, position: { x: keyframeValue.cameraTransform[12], y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    viewTransform: new Float32Array(keyframeValue.cameraTransform),
    inverseViewTransform: new Float32Array(keyframeValue.inverseCameraTransform),
    projectionMatrix: new Float32Array(keyframeValue.projectionMatrix),
    depthProjectionMatrix: identity(),
    depthTransformMatrix: identity(),
    depthWidth: 160,
    depthHeight: 90,
    depthScale: 0.001,
    denseFrame: { columns, rows, valid, normalizedX, normalizedY, distancesMeters, points, attemptedSampleCount: count, validPointCount: valid.reduce((sum, value) => sum + value, 0), rejectedPointCount: valid.reduce((sum, value) => sum + (value ? 0 : 1), 0) },
    normals: new Float32Array(count * 3),
    normalValid: new Uint8Array(count),
    attempted: count,
    valid: valid.reduce((sum, value) => sum + value, 0),
    validRatio: 1,
    medianDepth: 1,
    p05Depth: 1,
    p95Depth: 1,
    discontinuityRatio: 0,
    isolatedOutlierRatio: 0,
  }
}

function viewFor(keyframeValue) {
  return { transform: { matrix: keyframeValue.cameraTransform, inverse: { matrix: keyframeValue.inverseCameraTransform } }, projectionMatrix: keyframeValue.projectionMatrix }
}

function appearanceSnapshot(keyframes) {
  return { scanId: 'm812', status: 'available', keyframes, diagnostics: {} }
}

function captureSnapshot(entries) {
  const service = new M812SynchronizedRgbdCaptureService()
  for (const entry of entries) {
    const result = service.retainSameXrFrameCapture({ frame: {}, view: viewFor(entry.keyframe), packet: entry.packet, keyframe: entry.keyframe,
      replacedKeyframeId: entry.replacedKeyframeId ?? null })
    assert.deepEqual(result, { accepted: true, reason: 'retained' })
  }
  return service.createSnapshot('m812', appearanceSnapshot(entries.filter((entry) => entry.replacedKeyframeId === null || entry.replacedKeyframeId === undefined).map((entry) => entry.keyframe)))
}

test('contract binds RGB, depth, pose and projection to one explicit XR-frame/view identity', () => {
  const rgb = keyframe(7), packet = packetFor(rgb, { sequence: 41 })
  const service = new M812SynchronizedRgbdCaptureService()
  assert.deepEqual(service.retainSameXrFrameCapture({ frame: {}, view: viewFor(rgb), packet, keyframe: rgb, replacedKeyframeId: null }), { accepted: true, reason: 'retained' })
  const snapshot = service.createSnapshot('scan', appearanceSnapshot([rgb])), capture = snapshot.keyframes[0]
  assert.equal(capture.captureIdentity, 'xr-frame-41:rgb-keyframe-7')
  assert.equal(capture.xrFrameTimestamp, rgb.timestamp)
  assert.equal(capture.sameXrFrameInvocation, true)
  assert.equal(capture.synchronizationBasis, 'same-xr-frame-view-aligned')
  assert.equal(capture.sensorExposureSynchronization, 'not-guaranteed-by-webxr')
  assert.deepEqual([...capture.rgbKeyframe.cameraTransform], [...packet.viewTransform])
  assert.deepEqual([...capture.rgbKeyframe.projectionMatrix], [...packet.projectionMatrix])
  assert.deepEqual([...capture.depth.worldPoints], [...packet.denseFrame.points])
  assert.equal(capture.depth.sampleIndexing, 'row-major-grid-index')
})

test('contract rejects timestamp, view metadata, and invalid depth-layout ambiguity', () => {
  const rgb = keyframe(1), service = new M812SynchronizedRgbdCaptureService()
  assert.equal(service.retainSameXrFrameCapture({ frame: {}, view: viewFor(rgb), packet: packetFor(rgb, { timestamp: rgb.timestamp + 1 }), keyframe: rgb, replacedKeyframeId: null }).reason, 'timestamp-mismatch')
  const wrongView = viewFor(rgb); wrongView.projectionMatrix = identity()
  assert.equal(service.retainSameXrFrameCapture({ frame: {}, view: wrongView, packet: packetFor(rgb), keyframe: rgb, replacedKeyframeId: null }).reason, 'view-metadata-mismatch')
  const invalid = packetFor(rgb); invalid.denseFrame.points = new Float32Array(1)
  assert.equal(service.retainSameXrFrameCapture({ frame: {}, view: viewFor(rgb), packet: invalid, keyframe: rgb, replacedKeyframeId: null }).reason, 'invalid-depth-layout')
  assert.equal(service.createSnapshot('scan', appearanceSnapshot([rgb])).diagnostics.contractMismatchRejects, 3)
})

test('crop, resize and orientation mapping remain explicit and deterministic', () => {
  const cropped = mapping(16, 16, 'upright', { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
  assert.deepEqual(mapCameraUvToCopyPixel(cropped, 0.5, 0.5), { x: 8, y: 8 })
  assert.equal(mapCameraUvToCopyPixel(cropped, 0.1, 0.5), null)
  assert.deepEqual(mapCameraUvToCopyPixel(mapping(16, 16, 'horizontal-mirrored'), 0.25, 0.5), { x: 12, y: 8 })
  assert.deepEqual(mapCameraUvToCopyPixel(mapping(16, 16, 'vertical-flipped'), 0.5, 0.25), { x: 8, y: 12 })
  const rgb = keyframe(2, { mapping: cropped }), packet = packetFor(rgb)
  const snapshot = captureSnapshot([{ keyframe: rgb, packet }])
  assert.deepEqual(snapshot.keyframes[0].rgbKeyframe.mapping, cropped)
})

test('proof reuses retained world-to-camera projection instead of assuming depth-grid UV equals RGB UV', () => {
  const rgb = keyframe(6, { poster: false })
  const packet = packetFor(rgb)
  packet.denseFrame.normalizedX.fill(0.5)
  packet.denseFrame.normalizedY.fill(0.5)
  const snapshot = captureSnapshot([{ keyframe: rgb, packet }])
  const proof = createM812SynchronizedRgbdBrowserProof(snapshot, { outputWidth: 64, outputHeight: 64, displacementMeters: 0 })
  const ownedPixels = new Set()
  for (const sourcePixel of proof.sourceMeasuredRgb.sourceRgbPixelIndices) if (sourcePixel >= 0) ownedPixels.add(sourcePixel)
  assert.ok(ownedPixels.size > 4)
  assert.equal(proof.diagnostics.inventedPixels, 0)
})

test('bounded replacement removes the replaced depth owner instead of mixing frames', () => {
  const first = keyframe(1), second = keyframe(2), service = new M812SynchronizedRgbdCaptureService()
  service.retainSameXrFrameCapture({ frame: {}, view: viewFor(first), packet: packetFor(first), keyframe: first, replacedKeyframeId: null })
  service.retainSameXrFrameCapture({ frame: {}, view: viewFor(second), packet: packetFor(second), keyframe: second, replacedKeyframeId: 1 })
  const snapshot = service.createSnapshot('scan', appearanceSnapshot([second]))
  assert.equal(snapshot.keyframes.length, 1)
  assert.equal(snapshot.keyframes[0].rgbKeyframe.id, 2)
  assert.equal(snapshot.diagnostics.replacements, 1)
  assert.equal(snapshot.diagnostics.unpairedRgbKeyframes, 0)
})

test('serialized proof input is deterministic, independent and transferable', () => {
  const rgb = keyframe(3), snapshot = captureSnapshot([{ keyframe: rgb, packet: packetFor(rgb) }])
  const cloned = cloneM812SynchronizedRgbdSnapshot(snapshot, 1)
  assert.notEqual(cloned.keyframes[0].rgbKeyframe.rgb, snapshot.keyframes[0].rgbKeyframe.rgb)
  assert.notEqual(cloned.keyframes[0].depth.worldPoints, snapshot.keyframes[0].depth.worldPoints)
  const buffers = getM812SynchronizedRgbdTransferBuffers(cloned)
  const expectedRgb = [...cloned.keyframes[0].rgbKeyframe.rgb]
  const transferred = structuredClone(cloned, { transfer: buffers })
  assert.equal(cloned.keyframes[0].rgbKeyframe.rgb.byteLength, 0)
  assert.deepEqual([...transferred.keyframes[0].rgbKeyframe.rgb], expectedRgb)
  assert.deepEqual(transferred.diagnostics.memory, snapshot.diagnostics.memory)
})

test('one-keyframe reprojection keeps exact source-pixel and depth-triangle ownership', () => {
  const rgb = keyframe(4), snapshot = captureSnapshot([{ keyframe: rgb, packet: packetFor(rgb) }])
  const proof = createM812SynchronizedRgbdBrowserProof(snapshot, { outputWidth: 64, outputHeight: 64, displacementMeters: 0.02 })
  assert.ok(proof.diagnostics.sourceOwnedVisiblePixels > 0)
  assert.ok(proof.diagnostics.reprojectedVisiblePixels > 0)
  assert.equal(proof.diagnostics.inventedPixels, 0)
  for (let pixel = 0; pixel < proof.displacedOneKeyframe.sourceKeyframeIds.length; pixel += 1) {
    if (proof.displacedOneKeyframe.sourceKeyframeIds[pixel] < 0) continue
    const sourcePixel = proof.displacedOneKeyframe.sourceRgbPixelIndices[pixel]
    const triangleId = proof.displacedOneKeyframe.sourceTriangleIds[pixel]
    assert.equal(proof.displacedOneKeyframe.sourceKeyframeIds[pixel], rgb.id)
    assert.ok(sourcePixel >= 0 && sourcePixel < rgb.width * rgb.height)
    assert.ok(triangleId >= 0)
    assert.equal(proof.displacedOneKeyframe.rgba[pixel * 4], rgb.rgb[sourcePixel * 3])
    assert.equal(proof.triangleSourceKeyframeIds[triangleId], rgb.id)
    for (let corner = 0; corner < 3; corner += 1) assert.ok(proof.triangleDepthSampleIndices[triangleId * 3 + corner] >= 0)
  }
})

test('poster-like source edges remain direct image samples rather than interpolated vertex colors', () => {
  const rgb = keyframe(5, { poster: true }), snapshot = captureSnapshot([{ keyframe: rgb, packet: packetFor(rgb) }])
  const proof = createM812SynchronizedRgbdBrowserProof(snapshot, { outputWidth: 96, outputHeight: 96 })
  const redValues = new Set()
  for (let pixel = 0; pixel < proof.sourceMeasuredRgb.sourceRgbPixelIndices.length; pixel += 1) {
    if (proof.sourceMeasuredRgb.sourceRgbPixelIndices[pixel] >= 0) redValues.add(proof.sourceMeasuredRgb.rgba[pixel * 4])
  }
  assert.deepEqual([...redValues].sort((a, b) => a - b), [0, 255])
})

test('invalid depth creates a genuine unobserved gap and a second equally-gapped keyframe cannot fill it', () => {
  const gap = (column) => column !== 3 && column !== 4
  const first = keyframe(10), second = keyframe(11, { qualityScore: 0.9 })
  const snapshot = captureSnapshot([
    { keyframe: first, packet: packetFor(first, { validAt: gap }) },
    { keyframe: second, packet: packetFor(second, { validAt: gap }) },
  ])
  const proof = createM812SynchronizedRgbdBrowserProof(snapshot, { outputWidth: 96, outputHeight: 96, displacementMeters: 0 })
  assert.equal(proof.displacedTwoKeyframe.diagnostics.visiblePixels, proof.displacedOneKeyframe.diagnostics.visiblePixels)
  assert.equal(proof.diagnostics.pixelsSuppliedByKeyframe2, 0)
  assert.ok(proof.diagnostics.twoKeyframeDisocclusionHoles > 0)
})

test('a second keyframe fills only its measured disocclusion samples', () => {
  const first = keyframe(20), second = keyframe(21, { qualityScore: 0.9 })
  const snapshot = captureSnapshot([
    { keyframe: first, packet: packetFor(first, { validAt: (column) => column !== 3 && column !== 4 }) },
    { keyframe: second, packet: packetFor(second) },
  ])
  const proof = createM812SynchronizedRgbdBrowserProof(snapshot, { outputWidth: 96, outputHeight: 96, displacementMeters: 0 })
  console.log('M8.12 measured disocclusion fixture', JSON.stringify({
    sourceOwnedVisiblePixels: proof.diagnostics.sourceOwnedVisiblePixels,
    reprojectedVisiblePixels: proof.diagnostics.reprojectedVisiblePixels,
    oneKeyframeHoles: proof.diagnostics.oneKeyframeDisocclusionHoles,
    twoKeyframeHoles: proof.diagnostics.twoKeyframeDisocclusionHoles,
    overdrawAttempts: proof.diagnostics.overdrawAttempts,
    conflictingDepthSamples: proof.diagnostics.conflictingDepthSamples,
    rejectedDepthSamples: proof.diagnostics.rejectedDepthSamples,
    pixelsByKeyframe: [proof.diagnostics.pixelsSuppliedByKeyframe1, proof.diagnostics.pixelsSuppliedByKeyframe2],
    inventedPixels: proof.diagnostics.inventedPixels,
  }))
  assert.ok(proof.displacedTwoKeyframe.diagnostics.visiblePixels > proof.displacedOneKeyframe.diagnostics.visiblePixels)
  assert.ok(proof.diagnostics.pixelsSuppliedByKeyframe2 > 0)
  assert.ok(proof.diagnostics.twoKeyframeDisocclusionHoles < proof.diagnostics.oneKeyframeDisocclusionHoles)
  assert.equal(proof.diagnostics.inventedPixels, 0)
})

test('28 mm layers, 8 cm protrusions and recess bands remain separate measured evidence', () => {
  const rgb = keyframe(30)
  const packet = packetFor(rgb, { columns: 9, rows: 6, depthAt: (column) => column < 3 ? 1 : column < 6 ? 1.028 : 1.108 })
  const snapshot = captureSnapshot([{ keyframe: rgb, packet }])
  const proof = createM812SynchronizedRgbdBrowserProof(snapshot, { outputWidth: 96, outputHeight: 64, displacementMeters: 0 })
  assert.ok(proof.diagnostics.trianglesRejectedDepthDiscontinuity > 0)
  const representedBands = new Set()
  for (let triangle = 0; triangle < proof.triangleSourceKeyframeIds.length; triangle += 1) {
    const depths = []
    for (let corner = 0; corner < 3; corner += 1) depths.push(packet.denseFrame.distancesMeters[proof.triangleDepthSampleIndices[triangle * 3 + corner]])
    assert.ok(Math.max(...depths) - Math.min(...depths) <= 0.022)
    representedBands.add(depths[0].toFixed(3))
  }
  assert.deepEqual([...representedBands].sort(), ['1.000', '1.028', '1.108'])
})

test('memory accounting is bounded and includes no redundant ownership index buffer', () => {
  const rgb = keyframe(40), snapshot = captureSnapshot([{ keyframe: rgb, packet: packetFor(rgb) }])
  const memory = snapshot.diagnostics.memory
  assert.equal(snapshot.capacity, 8)
  assert.equal(memory.ownershipIndexBytes, 0)
  assert.equal(memory.rgbBytes, rgb.rgb.byteLength)
  assert.equal(memory.rawPackedLowerBoundBytes, memory.rgbBytes + memory.depthBytes + memory.validityBytes + memory.worldPointBytes + memory.poseProjectionBytes)
  assert.ok(memory.rawPackedLowerBoundBytes < 4096)
})

test('bounded two-keyframe 80x45 / 432x960 proof stays inside a broad desktop worker budget', () => {
  const first = keyframe(50, { width: 432, height: 960, poster: false })
  const second = keyframe(51, { width: 432, height: 960, poster: false, qualityScore: 0.9 })
  const snapshot = captureSnapshot([
    { keyframe: first, packet: packetFor(first, { columns: 80, rows: 45 }) },
    { keyframe: second, packet: packetFor(second, { columns: 80, rows: 45 }) },
  ])
  const startedAt = performance.now()
  const proof = createM812SynchronizedRgbdBrowserProof(snapshot)
  const elapsedMs = performance.now() - startedAt
  const transferInput = cloneM812SynchronizedRgbdSnapshot(snapshot, 2)
  const transferStartedAt = performance.now()
  const transferred = structuredClone(transferInput, { transfer: getM812SynchronizedRgbdTransferBuffers(transferInput) })
  const transferProxyMs = performance.now() - transferStartedAt
  console.log('M8.12 bounded proof benchmark', JSON.stringify({ elapsedMs: Number(elapsedMs.toFixed(2)),
    proofStagesMs: { geometry: Number(proof.diagnostics.geometryGenerationMs.toFixed(2)), source: Number(proof.diagnostics.sourceReprojectionMs.toFixed(2)),
      one: Number(proof.diagnostics.oneKeyframeReprojectionMs.toFixed(2)), two: Number(proof.diagnostics.twoKeyframeReprojectionMs.toFixed(2)) },
    maximumCaptureRetentionMs: Number(snapshot.diagnostics.maximumRetentionMs.toFixed(3)), transferProxyMs: Number(transferProxyMs.toFixed(3)),
    contractMiB: Number((snapshot.diagnostics.memory.rawPackedLowerBoundBytes / 1048576).toFixed(3)),
    keyframes: snapshot.keyframes.length, triangles: proof.diagnostics.retainedMeasuredTriangles,
    raster: [proof.displacedTwoKeyframe.width, proof.displacedTwoKeyframe.height],
    sourceOwnedVisiblePixels: proof.diagnostics.sourceOwnedVisiblePixels,
    reprojectedVisiblePixels: proof.diagnostics.reprojectedVisiblePixels,
    oneKeyframeHoles: proof.diagnostics.oneKeyframeDisocclusionHoles,
    twoKeyframeHoles: proof.diagnostics.twoKeyframeDisocclusionHoles,
    overdrawAttempts: proof.diagnostics.overdrawAttempts,
    conflictingDepthSamples: proof.diagnostics.conflictingDepthSamples,
    rejectedDepthSamples: proof.diagnostics.rejectedDepthSamples,
    pixelsByKeyframe: [proof.diagnostics.pixelsSuppliedByKeyframe1, proof.diagnostics.pixelsSuppliedByKeyframe2],
    inventedPixels: proof.diagnostics.inventedPixels }))
  assert.equal(proof.diagnostics.usedKeyframeCount, 2)
  assert.equal(transferred.keyframes.length, 2)
  assert.equal(proof.diagnostics.inventedPixels, 0)
  assert.ok(snapshot.diagnostics.memory.rawPackedLowerBoundBytes < 3 * 1048576)
  assert.ok(elapsedMs < 2000)
})

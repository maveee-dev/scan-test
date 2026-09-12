import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const cache = new Map()
function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href)
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from '${specifier.startsWith('.') ? moduleUrl(new URL(`${specifier}.ts`, url)) : import.meta.resolve(specifier)}'`)
  const result = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  cache.set(url.href, result)
  return result
}
const serviceUrl = new URL('../src/features/scanner/services/m813ViewDependentVisualRealityService.ts', import.meta.url)
const {
  buildM813ViewDependentVisualReality,
  selectM813ViewDependentKeyframes,
  M813_VIEW_DEPENDENT_CONFIG,
} = await import(moduleUrl(serviceUrl))
const { CanonicalRealityFusionService } = await import(moduleUrl(new URL('../src/features/scanner/services/canonicalRealityFusionService.ts', import.meta.url)))
const { auditRealitySurfaceScreenSpace, auditRealityTriangleScreenSpace } = await import(moduleUrl(new URL('../src/features/scanner/services/realitySurfaceRenderingService.ts', import.meta.url)))
const THREE = await import('three')

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const projection = () => new Float32Array([5, 0, 0, 0, 0, 5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function capture(id, options = {}) {
  const columns = options.columns ?? 8, rows = options.rows ?? 6, count = columns * rows
  const width = 32, height = 24
  const valid = new Uint8Array(count), normalizedX = new Float32Array(count), normalizedY = new Float32Array(count)
  const distancesMeters = new Float32Array(count), worldPoints = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const column = index % columns, row = Math.floor(index / columns)
    const u = (column + 0.5) / columns, v = (row + 0.5) / rows
    const depth = options.depthAt?.(column, row) ?? 1
    valid[index] = options.validAt?.(column, row) === false ? 0 : 1
    normalizedX[index] = options.gridUvOverride ?? u; normalizedY[index] = options.gridUvOverride ?? v
    distancesMeters[index] = depth
    worldPoints[index * 3] = (u - 0.5) * 0.35
    worldPoints[index * 3 + 1] = (0.5 - v) * 0.35
    worldPoints[index * 3 + 2] = -depth
  }
  const rgb = new Uint8Array(width * height * 3)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgb[pixel * 3] = pixel % width * 7
    rgb[pixel * 3 + 1] = Math.floor(pixel / width) * 9
    rgb[pixel * 3 + 2] = id * 11
  }
  const cameraTransform = identity(), inverseCameraTransform = identity()
  cameraTransform[12] = options.cameraX ?? 0; inverseCameraTransform[12] = -(options.cameraX ?? 0)
  return {
    captureIdentity: `capture-${id}`, frameSequence: id, xrFrameTimestamp: id * 1000,
    synchronizationBasis: 'same-xr-frame-view-aligned', sameXrFrameInvocation: true,
    depthCurrentness: 'current-xr-frame-requested-user-agent-should-provide', sensorExposureSynchronization: 'not-guaranteed-by-webxr',
    rgbKeyframe: {
      id, timestamp: id * 1000, width, height, rgb, cameraTransform, inverseCameraTransform, projectionMatrix: projection(),
      mapping: { sourceCameraWidth: 128, sourceCameraHeight: 96, copyWidth: width, copyHeight: height,
        sourceUvRect: { x: 0, y: 0, width: 1, height: 1 }, orientation: 'upright' },
      qualityScore: options.qualityScore ?? 1, translationDeltaMeters: 0, rotationDeltaDegrees: 0, validDepthFraction: 1,
    },
    depth: { columns, rows, sampleIndexing: 'row-major-grid-index', valid, normalizedX, normalizedY, distancesMeters, worldPoints,
      depthBufferWidth: 160, depthBufferHeight: 90, rawValueToMeters: 0.001,
      depthProjectionMatrix: identity(), depthTransformMatrix: identity() },
  }
}

function snapshot(keyframes) {
  return { scanId: 'same-synthetic-scan', status: 'available', capacity: 8, keyframes,
    diagnostics: { captureAttempts: keyframes.length, capturesRetained: keyframes.length, replacements: 0, contractMismatchRejects: 0,
      unpairedRgbKeyframes: 0, lastRetentionMs: 0, maximumRetentionMs: 0, memory: {} } }
}
const view = (x = 0) => ({ position: { x, y: 0, z: 0.7 }, target: { x: 0, y: 0, z: -1 } })

test('M8.13 retains only source-owned measured vertices and leaves missing depth empty', () => {
  const source = capture(1, { validAt: (column) => column !== 3 && column !== 4 })
  const result = buildM813ViewDependentVisualReality(snapshot([source]), view())
  assert.ok(result.diagnostics.retainedTriangleCount > 0)
  assert.ok(result.diagnostics.rejectedInvalidDepthQuads > 0)
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  assert.equal(result.diagnostics.inventedVertexCount, 0)
  assert.equal(result.diagnostics.noGapFill, true)
  for (const sourceIndex of result.keyframes[0].sourceSampleIndices) assert.equal(source.depth.valid[sourceIndex], 1)
})

test('M8.13 maps top-left RGB rows to DataTexture coordinates and reports live build progress', () => {
  const source = capture(1)
  source.rgbKeyframe.rgb.fill(64)
  const progress = []
  const result = buildM813ViewDependentVisualReality(snapshot([source]), view(), { onProgress: (update) => progress.push(update) })
  const geometry = result.keyframes[0]
  const topVertex = Array.from(geometry.sourceSampleIndices).findIndex((index) => index < source.depth.columns)
  const bottomVertex = Array.from(geometry.sourceSampleIndices).findIndex((index) => index >= source.depth.columns * (source.depth.rows - 1))
  assert.ok(topVertex >= 0 && bottomVertex >= 0)
  assert.ok(geometry.sourceGridUvs[topVertex * 2 + 1] < 0.5, 'top-left RGB row must map to DataTexture v=0')
  assert.ok(geometry.sourceGridUvs[bottomVertex * 2 + 1] > 0.5, 'bottom RGB row must map to DataTexture v=1')
  assert.equal(geometry.diagnostics.meanSourceRgbLuma, 64)
  assert.equal(geometry.diagnostics.meanMappedRgbLuma, 64)
  assert.equal(result.diagnostics.meanSourceRgbLuma, 64)
  assert.equal(result.diagnostics.meanMappedRgbLuma, 64)
  assert.deepEqual(progress, [
    { stage: 'ranking', completedKeyframes: 0, totalKeyframes: 1 },
    { stage: 'ranking', completedKeyframes: 1, totalKeyframes: 1 },
    { stage: 'geometry', completedKeyframes: 0, totalKeyframes: 1 },
    { stage: 'geometry', completedKeyframes: 1, totalKeyframes: 1 },
    { stage: 'ownership', completedKeyframes: 0, totalKeyframes: 1 },
    { stage: 'ownership', completedKeyframes: 1, totalKeyframes: 1 },
  ])
})

test('RGB UVs are projected from world geometry rather than copied from the depth grid', () => {
  const source = capture(2, { gridUvOverride: 0.5 })
  const result = buildM813ViewDependentVisualReality(snapshot([source]), view())
  const uniqueU = new Set(Array.from(result.keyframes[0].sourceGridUvs).filter((_value, index) => index % 2 === 0).map((value) => value.toFixed(3)))
  assert.ok(uniqueU.size > 2)
  assert.equal(result.keyframes[0].rgb, source.rgbKeyframe.rgb)
  assert.equal(result.diagnostics.sourceOwnedRgb, true)
})

test('22 mm discontinuity barrier preserves real separated measured layers', () => {
  const source = capture(3, { columns: 9, depthAt: (column) => column < 3 ? 1 : column < 6 ? 1.028 : 1.108 })
  const result = buildM813ViewDependentVisualReality(snapshot([source]), view())
  const geometry = result.keyframes[0]
  assert.ok(result.diagnostics.rejectedDepthDiscontinuityQuads > 0)
  const represented = new Set()
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const depths = [0, 1, 2].map((corner) => source.depth.distancesMeters[geometry.sourceSampleIndices[geometry.indices[offset + corner]]])
    assert.ok(Math.max(...depths) - Math.min(...depths) <= M813_VIEW_DEPENDENT_CONFIG.maximumDepthDiscontinuityMeters + 1e-6)
    represented.add(depths[0].toFixed(3))
  }
  assert.deepEqual([...represented].sort(), ['1.000', '1.028', '1.108'])
})

test('all bounded keyframes are built once while the virtual camera selects at most four', () => {
  const captures = Array.from({ length: 10 }, (_unused, index) => capture(index + 10, { cameraX: index - 4.5 }))
  const result = buildM813ViewDependentVisualReality(snapshot(captures), view(-4))
  assert.equal(result.keyframes.length, 8)
  assert.equal(result.diagnostics.boundedInputKeyframeCount, 8)
  assert.equal(result.diagnostics.ignoredInputKeyframeCount, 2)
  assert.equal(result.diagnostics.activeKeyframeCount, 4)
  const left = selectM813ViewDependentKeyframes(result, view(-4))
  const right = selectM813ViewDependentKeyframes(result, view(3))
  assert.equal(left.length, 4); assert.equal(right.length, 4)
  assert.notDeepEqual(left, right)
  assert.ok(left.every((id) => result.keyframes.some((keyframe) => keyframe.keyframeId === id)))
})

test('production Finish worker no longer eagerly builds closed or experimental renderers', () => {
  const worker = readFileSync(new URL('../src/features/scanner/services/postScanCanonicalFusion.worker.ts', import.meta.url), 'utf8')
  const session = readFileSync(new URL('../src/features/scanner/services/xrSessionService.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(worker, /buildM810DepthKeyframePatchAtlas|buildM813ViewDependentVisualReality/)
  assert.doesNotMatch(session, /canonicalReality\?\.m810/)
  assert.match(session, /closedExperimentalWorkSkipped/)
})

test('same synthetic scan produces an automated M8.7.1.6 versus M8.13 screen audit', () => {
  const captures = [
    capture(30, { cameraX: -0.06 }), capture(31, { cameraX: -0.02 }),
    capture(32, { cameraX: 0.02 }), capture(33, { cameraX: 0.06 }),
  ]
  const frames = captures.map((source, index) => {
    const count = source.depth.valid.length
    const normals = new Float32Array(count * 3), normalValid = new Uint8Array(count).fill(1)
    for (let sample = 0; sample < count; sample += 1) normals[sample * 3 + 2] = 1
    const colorSourceIndices = new Int32Array(count); colorSourceIndices.fill(-1)
    return {
      sequence: index + 1, timestamp: (index + 1) * 250, samplingPhase: index,
      trackingQuality: 1, cameraPosition: { x: source.rgbKeyframe.cameraTransform[12], y: 0, z: 0 },
      cameraOrientation: { x: 0, y: 0, z: 0, w: 1 },
      denseFrame: { columns: source.depth.columns, rows: source.depth.rows, valid: new Uint8Array(source.depth.valid),
        normalizedX: new Float32Array(source.depth.normalizedX), normalizedY: new Float32Array(source.depth.normalizedY),
        distancesMeters: new Float32Array(source.depth.distancesMeters), points: new Float32Array(source.depth.worldPoints),
        attemptedSampleCount: count, validPointCount: count, rejectedPointCount: 0 },
      normals, normalValid, colorSourceIndices, srgbColors: new Uint8Array(count * 3),
      coverageProxyKeys: Object.freeze([]), viewpointProxyKey: `same-scan-${index}`,
    }
  })
  const retained = { frames: Object.freeze(frames), diagnostics: { framesConsidered: 4, framesRetained: 4, duplicateFramesRejected: 0,
    redundancyRejects: 0, temporalCompactions: 0, compactionReplacements: 0, coverageLostDueToRemoval: 0,
    samplesRetained: frames.reduce((sum, frame) => sum + frame.denseFrame.valid.length, 0), retainedColorEvidenceCount: 0,
    retainedColorFrameCount: 0, memoryBytes: 0, viewpointBinCount: 4, earliestTimestamp: 250, latestTimestamp: 1000,
    retainedFrameCoverage: [] } }
  const baseline = new CanonicalRealityFusionService().reconstruct(retained)
  const experimental = buildM813ViewDependentVisualReality(snapshot(captures), view())
  assert.ok(baseline.surfels.length > 0)
  assert.ok(experimental.diagnostics.retainedTriangleCount > 0)
  const selected = new Set(selectM813ViewDependentKeyframes(experimental, view()))
  const positions = []
  for (const keyframe of experimental.keyframes) if (selected.has(keyframe.keyframeId)) for (const vertex of keyframe.indices) {
    const offset = vertex * 3
    positions.push(keyframe.positions[offset], keyframe.positions[offset + 1], keyframe.positions[offset + 2])
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const camera = new THREE.PerspectiveCamera(60, 1, 0.04, 80)
  camera.position.set(0, 0, 0.7); camera.lookAt(0, 0, -1); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
  const baselineAudit = auditRealitySurfaceScreenSpace(baseline.surfels, camera, 800, 800)
  const experimentalAudit = auditRealityTriangleScreenSpace(geometry, camera, 800, 800)
  geometry.dispose()
  console.log('M813_SAME_SCAN_AB ' + JSON.stringify({
    retainedSamples: retained.diagnostics.samplesRetained,
    baselineSurfels: baseline.surfels.length,
    baselineWorkerMs: Number(baseline.diagnostics.workerTimeMs.toFixed(2)),
    experimentalTriangles: experimental.diagnostics.retainedTriangleCount,
    experimentalBuildMs: Number(experimental.diagnostics.buildTimeMs.toFixed(2)),
    activeViews: selected.size,
    baselineUsefulPixels: baselineAudit.usefulPixelCount,
    experimentalUsefulPixels: experimentalAudit.usefulPixelCount,
    baselineHoleFraction: Number(baselineAudit.holeFraction.toFixed(4)),
    experimentalHoleFraction: Number(experimentalAudit.holeFraction.toFixed(4)),
    inventedVertices: experimental.diagnostics.inventedVertexCount,
  }))
  assert.ok(baselineAudit.usefulPixelCount > 0)
  assert.ok(experimentalAudit.usefulPixelCount > 0)
  assert.equal(experimental.diagnostics.inventedVertexCount, 0)
})

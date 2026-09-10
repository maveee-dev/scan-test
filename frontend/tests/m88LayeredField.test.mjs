import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import ts from 'typescript'

const cache = new Map()
function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href)
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from ['"]([^'"]+)['"]/g, (_m, s) => `from '${s.startsWith('.') ? moduleUrl(new URL(`${s}.ts`, url)) : import.meta.resolve(s)}'`)
  const result = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  cache.set(url.href, result)
  return result
}

const candidateModule = await import(moduleUrl(new URL('../src/features/scanner/services/layeredMeasuredSurfaceFieldService.ts', import.meta.url)))
const canonicalModule = await import(moduleUrl(new URL('../src/features/scanner/services/canonicalRealityFusionService.ts', import.meta.url)))
const { LayeredMeasuredSurfaceFieldService, buildSnapshotSignaturePair, createRetainedRealityMeasurementSnapshotSignature, M88_LAYERED_FIELD_CONFIG } = candidateModule
const { CanonicalRealityFusionService } = canonicalModule

function point(id, x, y, z, normal = { x: 0, y: 0, z: 1 }) { return { id, position: { x, y, z }, normal } }
function retainedFrame(points, sequence, cameraX = sequence * .05, grid = null) {
  const inferredColumns = Math.max(1, Math.round(Math.sqrt(points.length)))
  const columns = grid?.columns ?? (inferredColumns * inferredColumns === points.length ? inferredColumns : points.length)
  const sourceIndices = grid?.sourceIndices ?? points.map((_sample, index) => index)
  const count = grid?.totalCount ?? Math.max(points.length, ...sourceIndices.map((index) => index + 1))
  const valid = new Uint8Array(count), normalValid = new Uint8Array(count)
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3)
  const colorSourceIndices = new Int32Array(count).fill(-1)
  points.forEach((sample, pointIndex) => { const index = sourceIndices[pointIndex] ?? pointIndex; valid[index] = 1; normalValid[index] = 1; positions.set([sample.position.x, sample.position.y, sample.position.z], index * 3); normals.set([sample.normal.x, sample.normal.y, sample.normal.z], index * 3); colorSourceIndices[index] = pointIndex })
  return {
    sequence, timestamp: sequence * 250, samplingPhase: sequence % 4, trackingQuality: .95,
    cameraPosition: { x: cameraX, y: .6, z: .4 }, cameraOrientation: { x: 0, y: 0, z: 0, w: 1 },
    denseFrame: { columns, rows: Math.ceil(count / columns), valid, normalizedX: new Float32Array(count), normalizedY: new Float32Array(count), distancesMeters: new Float32Array(count).fill(2), points: positions, attemptedSampleCount: count, validPointCount: points.length, rejectedPointCount: count - points.length },
    normals, normalValid, colorSourceIndices, srgbColors: new Uint8Array(points.length * 3).fill(180),
  }
}
function snapshot(frames) {
  return { frames, diagnostics: { framesConsidered: frames.length, framesRetained: frames.length, duplicateFramesRejected: 0, redundancyRejects: 0, temporalCompactions: 0, compactionReplacements: 0, coverageLostDueToRemoval: 0, samplesRetained: frames.reduce((sum, frame) => sum + frame.denseFrame.validPointCount, 0), retainedColorEvidenceCount: frames.length, retainedColorFrameCount: frames.length, memoryBytes: frames.reduce((sum, frame) => sum + frame.denseFrame.points.byteLength + frame.normals.byteLength + frame.normalValid.byteLength + frame.denseFrame.valid.byteLength + frame.colorSourceIndices.byteLength + frame.srgbColors.byteLength, 0), viewpointBinCount: frames.length, earliestTimestamp: frames[0]?.timestamp ?? null, latestTimestamp: frames.at(-1)?.timestamp ?? null, retainedFrameCoverage: [] } }
}
function run(frames) {
  const input = snapshot(frames), baseline = new CanonicalRealityFusionService().reconstruct(input), candidate = new LayeredMeasuredSurfaceFieldService().reconstruct(input, baseline)
  return { input, baseline, candidate }
}
function assertExactOwnership(result) {
  assert.equal(result.candidate.ownership.length, result.candidate.surfels.length)
  for (const owner of result.candidate.ownership) {
    const frame = result.input.frames.find((candidate) => candidate.sequence === owner.representativeFrameSequence)
    assert.ok(frame, `missing source frame ${owner.representativeFrameSequence}`)
    const offset = owner.representativeSourceIndex * 3
    assert.equal(owner.position.x, frame.denseFrame.points[offset])
    assert.equal(owner.position.y, frame.denseFrame.points[offset + 1])
    assert.equal(owner.position.z, frame.denseFrame.points[offset + 2])
    assert.equal(owner.layerId, `${owner.worldCellKey}:layer-${Number(owner.layerId.split(':layer-').at(-1))}`)
    assert.equal(result.candidate.surfels[owner.surfelId].position.x, owner.position.x)
  }
}
function plane(size = 10, z = -2) { return Array.from({ length: size * size }, (_unused, index) => point(index, (index % size - size / 2) * .025, (Math.floor(index / size) - size / 2) * .025, z)) }

test('M8.8 clean measured plane promotes repeated source representatives', () => {
  const result = run(Array.from({ length: 5 }, (_unused, frame) => retainedFrame(plane(10), frame + 1)))
  assert.ok(result.candidate.surfels.length > 0)
  assert.equal(result.candidate.diagnostics.candidateUnownedOrInventedCount, 0)
  assert.ok(result.candidate.diagnostics.candidateSurvivalPercentage > 0)
  assertExactOwnership(result)
  assert.ok(result.candidate.surfels.every((surfel) => result.input.frames.some((frame) => [...frame.denseFrame.points].some((value, index) => index % 3 === 0 && value === surfel.position.x))))
  console.log('M8.8 synthetic clean A/B', JSON.stringify({ baselineCells: result.candidate.diagnostics.baselineRepresentedWorldCells, candidateCells: result.candidate.diagnostics.candidateRepresentedWorldCells, observedCells: result.candidate.diagnostics.uniqueObservedWorldCells, baselineSurvival: result.candidate.diagnostics.baselineSurvivalPercentage, candidateSurvival: result.candidate.diagnostics.candidateSurvivalPercentage, invented: result.candidate.diagnostics.candidateUnownedOrInventedCount }))
})

test('M8.8 noisy plane remains measured and deterministic', () => {
  const frames = Array.from({ length: 6 }, (_unused, frame) => retainedFrame(plane(12).map((sample, index) => ({ ...sample, position: { ...sample.position, z: sample.position.z + Math.sin(index * 1.7 + frame) * .012 } })), frame + 1))
  const first = run(frames), second = run(frames.map((frame) => ({ ...frame, denseFrame: { ...frame.denseFrame, points: frame.denseFrame.points.slice() }, normals: frame.normals.slice() })))
  assert.deepEqual(first.candidate.surfels.map((surfel) => [surfel.position, surfel.normal]), second.candidate.surfels.map((surfel) => [surfel.position, surfel.normal]))
  assert.deepEqual(first.candidate.ownership, second.candidate.ownership)
  assert.equal(createRetainedRealityMeasurementSnapshotSignature(first.input), createRetainedRealityMeasurementSnapshotSignature(second.input))
  assert.ok(first.candidate.diagnostics.workerStageTimingsMs.perFrameConsolidation >= 0)
  assert.ok(first.candidate.surfels.every((surfel) => (surfel.positionVarianceMetersSquared ?? 0) >= 0 && (surfel.depthVarianceMetersSquared ?? 0) >= 0 && (surfel.normalVariance ?? 0) >= 0))
})

test('M8.8 exact 36mm noisy planar comparison remains bounded and source-owned', () => {
  const frames = Array.from({ length: 6 }, (_unused, frame) => retainedFrame(plane(10).map((sample, index) => ({ ...sample, position: { ...sample.position, z: sample.position.z + Math.sin(index * 1.31 + frame * .7) * .036 } })), frame + 1))
  const result = run(frames)
  assertExactOwnership(result)
  assert.equal(result.candidate.diagnostics.candidateUnownedOrInventedCount, 0)
  assert.ok(result.candidate.diagnostics.baselineSurvivalPercentage <= 100)
  assert.ok(result.candidate.diagnostics.candidateSurvivalPercentage <= 100)
  assert.ok(result.candidate.diagnostics.candidateRepresentedWorldCells >= result.candidate.diagnostics.baselineRepresentedWorldCells)
  assert.ok(result.candidate.diagnostics.baselineRepresentedOutsideObservedWorldCells >= 0)
})

test('M8.8 coherent cross-frame support recovers observed cells baseline expires', () => {
  const wall = plane(12)
  const frames = Array.from({ length: 3 }, (_unused, frame) => {
    const samples = wall.filter((sample) => Math.abs(sample.id % 3) === frame)
    return retainedFrame(samples, frame + 1, (frame + 1) * .05, { columns: 12, totalCount: 144, sourceIndices: samples.map((sample) => sample.id) })
  })
  const result = run(frames)
  console.log('M8.8 coherent sparse A/B', JSON.stringify({ baseline: result.baseline.surfels.length, candidate: result.candidate.surfels.length, observed: result.candidate.diagnostics.uniqueObservedWorldCells, coherent: result.candidate.diagnostics.coherentSupportPromotedLayerCount, cross: result.candidate.diagnostics.crossFrameSupportedLayerCount, holeClasses: result.candidate.diagnostics.holeClasses, baselineMs: result.baseline.diagnostics.workerTimeMs, candidateMs: result.candidate.diagnostics.workerTimeMs, baselineNumericBytes: result.baseline.diagnostics.numericMemoryBytes, candidatePeakEstimateBytes: result.candidate.diagnostics.peakMemoryBytesEstimate }))
  assert.ok(result.candidate.surfels.length > result.baseline.surfels.length)
  assert.ok(result.candidate.diagnostics.coherentSupportPromotedLayerCount > 0)
  assert.ok(result.candidate.diagnostics.frameLocalContinuityLayerCount > 0)
  assert.equal(result.candidate.diagnostics.candidateUnownedOrInventedCount, 0)
  assert.ok(result.candidate.diagnostics.coherentSurfaceComponents.every((component) => /^(main-wall|side-wall|ceiling|generic-\d+)$/.test(component.orientation)))
})

test('M8.8 never fills a genuinely unobserved plane gap', () => {
  const left = plane(12).filter((sample) => sample.position.x < -.08), right = plane(12).filter((sample) => sample.position.x > .08)
  const result = run(Array.from({ length: 4 }, (_unused, frame) => retainedFrame([...left, ...right], frame + 1)))
  assert.ok(result.candidate.surfels.every((surfel) => Math.abs(surfel.position.x) > .08))
  assert.equal(result.candidate.diagnostics.candidateUnownedOrInventedCount, 0)
  assert.ok(result.candidate.diagnostics.holeClasses.A_unobserved >= 0)
})

test('M8.8 preserves 28mm close real layers and an 8 cm protrusion as separate measured ownership', () => {
  const front = plane(8, -2), close = plane(8, -2.028).map((sample, index) => ({ ...sample, id: index + 1000 })), protrusion = plane(5, -1.92).map((sample, index) => ({ ...sample, id: index + 2000, position: { ...sample.position, x: sample.position.x + .35, y: sample.position.y + .1 } }))
  const result = run(Array.from({ length: 5 }, (_unused, frame) => retainedFrame([...front, ...close, ...protrusion], frame + 1)))
  for (const expected of [-2, -2.028, -1.92]) assert.ok(result.candidate.surfels.some((surfel) => Math.abs(surfel.position.z - expected) < .006), `missing measured band ${expected}`)
  assert.ok(result.candidate.diagnostics.maximumCandidateLayersPerCell <= M88_LAYERED_FIELD_CONFIG.maximumLayersPerCell)
})

test('M8.8 rejects a false one-frame forward/noise layer', () => {
  const wall = plane(10), falseForward = plane(4, -1.95).map((sample, index) => ({ ...sample, id: index + 1000 }))
  const result = run([retainedFrame(wall, 1), retainedFrame([...wall, ...falseForward], 2), retainedFrame(wall, 3), retainedFrame(wall, 4)])
  assert.ok(result.candidate.surfels.every((surfel) => surfel.position.z < -1.98))
  assert.equal(result.candidate.diagnostics.candidateUnownedOrInventedCount, 0)
})

test('M8.8 keeps measured recess front/side/back ownership', () => {
  const front = plane(8, -2).filter((sample) => sample.position.x < 0)
  const back = plane(8, -2.25).filter((sample) => sample.position.x >= 0).map((sample, index) => ({ ...sample, id: index + 1000 }))
  const side = Array.from({ length: 32 }, (_unused, index) => point(index + 2000, 0, (index % 8) * .025 - .1, -2 - Math.floor(index / 8) * .025, { x: 1, y: 0, z: 0 }))
  const result = run(Array.from({ length: 5 }, (_unused, frame) => retainedFrame([...front, ...side, ...back], frame + 1)))
  assert.ok(result.candidate.surfels.some((surfel) => surfel.position.z < -2.2))
  assert.ok(result.candidate.surfels.some((surfel) => surfel.normal.x > .9))
  assert.ok(result.candidate.surfels.some((surfel) => Math.abs(surfel.position.z + 2) < .01))
  assert.equal(result.candidate.diagnostics.candidateUnownedOrInventedCount, 0)
})

test('M8.8 A/B signature and preview semantics keep baseline authoritative', () => {
  const result = run(Array.from({ length: 4 }, (_unused, frame) => retainedFrame(plane(6), frame + 1)))
  const pair = buildSnapshotSignaturePair(result.input, result.baseline, result.candidate)
  assert.equal(pair.identicalInput, true)
  assert.equal(pair.baselineInputSnapshotSignature, pair.candidateInputSnapshotSignature)
  assert.notEqual(result.baseline.surfels, result.candidate.surfels)
  assertExactOwnership(result)
  const outsideBaseline = { ...result.baseline, surfels: [...result.baseline.surfels, { ...result.baseline.surfels[0], id: 999999, position: { x: 99, y: 99, z: 99 } }] }
  const domainChecked = new LayeredMeasuredSurfaceFieldService().reconstruct(result.input, outsideBaseline)
  assert.ok(domainChecked.diagnostics.baselineRepresentedOutsideObservedWorldCells >= 1)
  assert.ok(domainChecked.diagnostics.baselineSurvivalPercentage <= 100)
  const preview = readFileSync(new URL('../src/features/scanner/components/RealityQualityPreview.tsx', import.meta.url), 'utf8')
  assert.match(preview, /M8\.7\.1\.6 Baseline Canonical/)
  assert.match(preview, /M8\.8 Experimental Reconstruction/)
  assert.match(preview, /new THREE\.WebGLRenderer/)
  assert.match(preview, /new OrbitControls/)
  const finish = readFileSync(new URL('../src/features/scanner/services/xrSessionService.ts', import.meta.url), 'utf8')
  assert.match(finish, /rafHeartbeatCount/)
  assert.match(finish, /longTaskMaxDurationMs/)
  assert.match(finish, /actualMainPostMessageEpochMs/)
  assert.match(finish, /actualMainPostMessageBeginEpochMs/)
  assert.match(preview, /firstRestoredSurfacePaintEpochMs/)
  assert.match(preview, /experimentalSurfels/)
})

test('M8.8 field layers and memory remain bounded', () => {
  const result = run(Array.from({ length: 8 }, (_unused, frame) => retainedFrame(plane(16), frame + 1)))
  assert.ok(result.candidate.diagnostics.maximumObservedLayersPerCell <= 4)
  assert.ok(result.candidate.diagnostics.peakMemoryBytesEstimate >= result.candidate.diagnostics.numericMemoryBytes)
  assert.equal(result.candidate.diagnostics.candidateLayerSafetyViolations, 0)
})

function sameCellLayerFrames(layerCount) {
  const normals = [
    { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
    { x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 1 },
  ]
  return Array.from({ length: layerCount }, (_unused, index) =>
    retainedFrame([point(index, 0, 0, index === 4 ? 2.024 : 2, normals[index])], index + 1))
}

test('M8.8 separates local layer saturation from global field exhaustion', () => {
  const four = run(sameCellLayerFrames(4)).candidate.diagnostics
  assert.equal(four.candidateLocalLayerCapacitySaturated, true)
  assert.equal(four.candidateLocalLayerCapacitySaturatedCells, 1)
  assert.equal(four.candidateLocalLayerCapacityRejectedMeasurements, 0)
  assert.equal(four.candidateGlobalFieldCapacityRejectedMeasurements, 0)
  assert.equal(four.candidateGlobalFieldCapacityReached, false)
  assert.equal(four.candidateCapacityReached, false, 'four layers alone is not global exhaustion')

  const five = run(sameCellLayerFrames(5)).candidate.diagnostics
  assert.equal(five.candidateLocalLayerCapacityRejectedMeasurements, 1)
  assert.equal(five.candidateGlobalFieldCapacityRejectedMeasurements, 0)
  assert.equal(five.candidateGlobalFieldCapacityReached, false)
  assert.equal(five.candidateCapacityRejectedMeasurements, 1)
  assert.equal(five.candidateCapacityReached, true)
})

function stableDiagnostics(diagnostics) {
  const { workerTimeMs: _workerTimeMs, workerStageTimingsMs: _workerStageTimingsMs, ...stable } = diagnostics
  return stable
}

test('M8.8 indexed adjacency preserves deterministic output and bounds relation work', () => {
  const frames = Array.from({ length: 5 }, (_unused, frame) => retainedFrame(plane(14), frame + 1))
  const first = run(frames)
  const second = run(frames.map((frame) => ({
    ...frame,
    denseFrame: { ...frame.denseFrame, points: frame.denseFrame.points.slice() },
    normals: frame.normals.slice(),
  })))
  assert.deepEqual(first.candidate.surfels, second.candidate.surfels)
  assert.deepEqual(first.candidate.ownership, second.candidate.ownership)
  assert.deepEqual(stableDiagnostics(first.candidate.diagnostics), stableDiagnostics(second.candidate.diagnostics))
  const diagnostics = first.candidate.diagnostics
  assert.equal(diagnostics.coherenceCellLookups, diagnostics.observedLayerCount * 27)
  assert.ok(diagnostics.coherenceAdjacencyUndirectedEdgeCount <= diagnostics.coherenceAdjacencyRelationChecks)
  assert.ok(diagnostics.coherenceAdjacencyRelationChecks * 2 <= diagnostics.coherenceLayerCandidateVisits - diagnostics.observedLayerCount,
    'each compatible layer pair is evaluated once, not once per direction')
})

test('M8.8 representative adjacency fixture stays inside a broad non-mobile timing budget', () => {
  const frames = Array.from({ length: 4 }, (_unused, frame) => retainedFrame(plane(24), frame + 1))
  const startedAt = performance.now()
  const result = run(frames)
  const elapsedMs = performance.now() - startedAt
  assert.ok(result.candidate.diagnostics.coherenceAdjacencyRelationChecks > 0)
  // This is intentionally a broad desktop/CI guard; the deterministic work
  // bound above is the non-flaky regression signal, not this wall-clock ceiling.
  assert.ok(elapsedMs < 5000, `representative M8.8 fixture took ${elapsedMs.toFixed(1)} ms`)
})

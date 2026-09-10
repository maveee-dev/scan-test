import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

// Deterministic Finish scalability regression. It exercises both reconstruction
// arms directly so the large-data boundary remains covered without XR timing.
const moduleCache = new Map()
function moduleUrl(url) {
  if (moduleCache.has(url.href)) return moduleCache.get(url.href)
  const rewritten = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) =>
    `from '${specifier.startsWith('.') ? moduleUrl(new URL(`${specifier}.ts`, url)) : specifier}'`,
  )
  const result = `data:text/javascript;base64,${Buffer.from(rewritten).toString('base64')}`
  moduleCache.set(url.href, result)
  return result
}

const serviceUrl = new URL('../src/features/scanner/services/', import.meta.url)
const canonicalModule = await import(moduleUrl(new URL('canonicalRealityFusionService.ts', serviceUrl)))
const layeredModule = await import(moduleUrl(new URL('layeredMeasuredSurfaceFieldService.ts', serviceUrl)))
const { CanonicalRealityFusionService } = canonicalModule
const { LayeredMeasuredSurfaceFieldService } = layeredModule

function makeFrame(count, sequence, frameOrdinal) {
  const columns = 40
  const rows = Math.ceil(count / columns)
  const valid = new Uint8Array(count)
  const normalValid = new Uint8Array(count)
  const points = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const colorSourceIndices = new Int32Array(count)
  const colors = new Uint8Array(count * 3)
  colorSourceIndices.fill(-1)
  for (let index = 0; index < count; index += 1) {
    const x = frameOrdinal * 100 + (index % columns) * 0.05
    const y = Math.floor(index / columns) * 0.05
    valid[index] = 1
    normalValid[index] = 1
    points[index * 3] = x
    points[index * 3 + 1] = y
    points[index * 3 + 2] = -2
    normals[index * 3 + 2] = 1
  }
  return {
    sequence: sequence + 1,
    timestamp: (sequence + 1) * 250,
    samplingPhase: sequence % 4,
    trackingQuality: 0.95,
    cameraPosition: { x: frameOrdinal * 100, y: 0.6, z: 0.4 },
    cameraOrientation: { x: 0, y: 0, z: 0, w: 1 },
    denseFrame: {
      columns,
      rows,
      valid,
      normalizedX: new Float32Array(count),
      normalizedY: new Float32Array(count),
      distancesMeters: new Float32Array(count).fill(2),
      points,
      attemptedSampleCount: count,
      validPointCount: count,
      rejectedPointCount: 0,
    },
    normals,
    normalValid,
    colorSourceIndices,
    srgbColors: colors,
    coverageProxyKeys: Object.freeze([]),
    viewpointProxyKey: `fixture-${frameOrdinal}`,
  }
}

function makeSnapshot(totalSamples) {
  const frames = []
  if (totalSamples <= 153600) {
    const fullFrames = Math.floor(totalSamples / 1600)
    const remainder = totalSamples % 1600
    for (let frame = 0; frame < fullFrames; frame += 1) frames.push(makeFrame(1600, frame, frame))
    if (remainder > 0) frames.push(makeFrame(remainder, fullFrames, fullFrames))
  } else {
    // Keep the stress arm inside retainedRealityMeasurementService's 96-frame
    // evidence bound. A larger sample count is distributed evenly rather than
    // silently creating out-of-contract frame ordinals for the three-word masks.
    const frameCount = 96
    const samplesPerFrame = Math.ceil(totalSamples / frameCount)
    let remaining = totalSamples
    for (let frame = 0; frame < frameCount && remaining > 0; frame += 1) {
      const count = Math.min(samplesPerFrame, remaining)
      frames.push(makeFrame(count, frame, frame))
      remaining -= count
    }
  }
  const memoryBytes = frames.reduce((sum, frame) => sum +
    frame.denseFrame.valid.byteLength + frame.denseFrame.normalizedX.byteLength +
    frame.denseFrame.normalizedY.byteLength + frame.denseFrame.distancesMeters.byteLength +
    frame.denseFrame.points.byteLength + frame.normals.byteLength + frame.normalValid.byteLength +
    frame.colorSourceIndices.byteLength + frame.srgbColors.byteLength, 0)
  return {
    frames: Object.freeze(frames),
    diagnostics: Object.freeze({
      framesConsidered: frames.length,
      framesRetained: frames.length,
      duplicateFramesRejected: 0,
      redundancyRejects: 0,
      temporalCompactions: 0,
      compactionReplacements: 0,
      coverageLostDueToRemoval: 0,
      samplesRetained: totalSamples,
      retainedColorEvidenceCount: 0,
      retainedColorFrameCount: 0,
      memoryBytes,
      viewpointBinCount: frames.length,
      earliestTimestamp: frames[0]?.timestamp ?? null,
      latestTimestamp: frames.at(-1)?.timestamp ?? null,
      retainedFrameCoverage: [],
    }),
  }
}

function runArm(arm, snapshot) {
  const stages = []
  const startedAt = performance.now()
  try {
    if (arm === 'baseline') {
      const result = new CanonicalRealityFusionService().reconstruct(snapshot, (stage) => stages.push(stage))
      return { arm, ok: true, stages, elapsedMs: performance.now() - startedAt, result }
    }
    if (arm === 'candidate') {
      const result = new LayeredMeasuredSurfaceFieldService().reconstruct(snapshot, null, 'investigation', (stage) => stages.push(stage))
      return { arm, ok: true, stages, elapsedMs: performance.now() - startedAt, result }
    }
    const baseline = new CanonicalRealityFusionService().reconstruct(snapshot, (stage) => stages.push(`baseline:${stage}`))
    const candidate = new LayeredMeasuredSurfaceFieldService().reconstruct(snapshot, baseline, 'investigation', (stage) => stages.push(`candidate:${stage}`))
    return { arm, ok: true, stages, elapsedMs: performance.now() - startedAt, baseline, result: candidate }
  } catch (error) {
    const errorStack = typeof error?.stack === 'string'
      ? error.stack.replace(/data:text\/javascript;base64,[^:]+/g, 'data:<compiled-module>')
      : error?.stack
    return {
      arm,
      ok: false,
      stages,
      elapsedMs: performance.now() - startedAt,
      errorName: error?.name,
      errorMessage: error?.message,
      errorStack,
    }
  }
}

function layeredBenchmarkSummary(result) {
  const diagnostics = result?.result?.diagnostics
  if (!diagnostics) return null
  return {
    workerTimeMs: Number(diagnostics.workerTimeMs.toFixed(1)),
    workerStageTimingsMs: diagnostics.workerStageTimingsMs,
    observedLayerCount: diagnostics.observedLayerCount,
    promotedLayerCount: diagnostics.promotedLayerCount,
    coherenceCellLookups: diagnostics.coherenceCellLookups,
    coherenceLayerCandidateVisits: diagnostics.coherenceLayerCandidateVisits,
    coherenceAdjacencyRelationChecks: diagnostics.coherenceAdjacencyRelationChecks,
    coherenceAdjacencyUndirectedEdgeCount: diagnostics.coherenceAdjacencyUndirectedEdgeCount,
    coherenceNumericIndexLookupCount: diagnostics.coherenceNumericIndexLookupCount,
    coherenceNumericIndexCollisionBucketCount: diagnostics.coherenceNumericIndexCollisionBucketCount,
    coherenceNumericIndexCollisionProbeCount: diagnostics.coherenceNumericIndexCollisionProbeCount,
    consolidationCellIndexLookupCount: diagnostics.consolidationCellIndexLookupCount,
    consolidationCellIndexCollisionBucketCount: diagnostics.consolidationCellIndexCollisionBucketCount,
    consolidationCellIndexCollisionProbeCount: diagnostics.consolidationCellIndexCollisionProbeCount,
    consolidationSourceGridNeighborLookups: diagnostics.consolidationSourceGridNeighborLookups,
    consolidationSourceGridNeighborHits: diagnostics.consolidationSourceGridNeighborHits,
    medoidCandidateVisitsBeforeEquivalent: diagnostics.medoidCandidateVisitsBeforeEquivalent,
    medoidCandidateVisits: diagnostics.medoidCandidateVisits,
    medoidDistanceVisitsBeforeEquivalent: diagnostics.medoidDistanceVisitsBeforeEquivalent,
    medoidDistanceVisits: diagnostics.medoidDistanceVisits,
    inputMemoryBytes: diagnostics.inputMemoryBytes,
    candidateRepresentationMemoryBytes: diagnostics.candidateRepresentationMemoryBytes,
    candidateWorkingMemoryBytes: diagnostics.candidateWorkingMemoryBytes,
    candidateOutputMemoryBytes: diagnostics.candidateOutputMemoryBytes,
    peakMemoryBytesEstimate: diagnostics.peakMemoryBytesEstimate,
  }
}

test('bounded Finish scalability regression covers graduated full-room and A/B arms', () => {
  const oneCount = Number(process.env.INVESTIGATION_SAMPLES)
  const graduated = Number.isInteger(oneCount) && oneCount > 0 ? [
    ['ONE', oneCount],
  ] : process.env.FINISH_THRESHOLD === '1' ? [
    ['PROBE_125100', 125100],
    ['PROBE_125200', 125200],
    ['PROBE_125300', 125300],
    ['PROBE_125400', 125400],
    ['PROBE_125450', 125450],
    ['PROBE_125475', 125475],
    ['PROBE_125490', 125490],
    ['PROBE_125499', 125499],
  ] : [
    ['SMALL', 1600],
    ['MEDIUM', 12800],
    ['PREVIOUS_STACK_BOUNDARY', 124800],
    ['FULL_ROOM', 130000],
  ]
  const report = []
  let fullRoomSnapshot = null
  let fullRoomCandidate = null
  for (const [label, count] of graduated) {
    const snapshot = makeSnapshot(count)
    assert.ok(snapshot.frames.length <= 96, `${label} must stay within the 96 retained-frame mask bound`)
    const candidate = runArm('candidate', snapshot)
    report.push({
      label,
      samples: count,
      frames: snapshot.frames.length,
      retainedMemoryBytes: snapshot.diagnostics.memoryBytes,
      candidate: {
        ok: candidate.ok,
        lastStage: candidate.stages.at(-1) ?? null,
        elapsedMs: Number(candidate.elapsedMs.toFixed(1)),
        errorName: candidate.errorName ?? null,
        errorMessage: candidate.errorMessage ?? null,
        stack: candidate.errorStack ?? null,
        outputSurfels: candidate.result?.surfels.length ?? null,
        observedLayers: candidate.result?.diagnostics.observedLayerCount ?? null,
        inputMemoryBytes: candidate.result?.diagnostics.inputMemoryBytes ?? null,
        numericMemoryBytes: candidate.result?.diagnostics.numericMemoryBytes ?? null,
        peakMemoryBytesEstimate: candidate.result?.diagnostics.peakMemoryBytesEstimate ?? null,
        candidateRepresentationMemoryBytes: candidate.result?.diagnostics.candidateRepresentationMemoryBytes ?? null,
        candidateWorkingMemoryBytes: candidate.result?.diagnostics.candidateWorkingMemoryBytes ?? null,
        candidateOutputMemoryBytes: candidate.result?.diagnostics.candidateOutputMemoryBytes ?? null,
        layeredDiagnostics: layeredBenchmarkSummary(candidate),
      },
    })
    console.log('FINISH_SCALABILITY_CASE ' + JSON.stringify(report.at(-1)))
    if (label === 'FULL_ROOM') { fullRoomSnapshot = snapshot; fullRoomCandidate = candidate }
    if (label === 'ONE' || label.startsWith('PROBE_')) continue
    assert.equal(candidate.ok, true, `${label} candidate should finish without stack overflow`)
  }

  if (process.env.INVESTIGATION_SAMPLES || process.env.FINISH_THRESHOLD === '1') return

  // Run the identical full-room retained input through both reconstruction arms
  // and the actual A/B composition.
  const fullSnapshot = fullRoomSnapshot ?? makeSnapshot(130000)
  const baseline = runArm('baseline', fullSnapshot)
  const candidate = fullRoomCandidate ?? runArm('candidate', fullSnapshot)
  const both = runArm('ab', fullSnapshot)
  assert.equal(baseline.ok, true, 'baseline should finish on the large retained input')
  assert.equal(candidate.ok, true, 'candidate should finish on the large retained input')
  assert.equal(both.ok, true, 'A/B should finish on the large retained input')
  report.push({
    sameFullRoomInput: 130000,
    baseline: { ok: baseline.ok, lastStage: baseline.stages.at(-1) ?? null, elapsedMs: Number(baseline.elapsedMs.toFixed(1)), errorName: baseline.errorName ?? null, errorMessage: baseline.errorMessage ?? null, stack: baseline.errorStack ?? null, outputSurfels: baseline.result?.surfels.length ?? null },
    candidateOnly: { ok: candidate.ok, lastStage: candidate.stages.at(-1) ?? null, elapsedMs: Number(candidate.elapsedMs.toFixed(1)), baselineRatio: Number((candidate.elapsedMs / Math.max(.001, baseline.elapsedMs)).toFixed(3)), errorName: candidate.errorName ?? null, errorMessage: candidate.errorMessage ?? null, stack: candidate.errorStack ?? null, layeredDiagnostics: layeredBenchmarkSummary(candidate) },
    ab: { ok: both.ok, lastStage: both.stages.at(-1) ?? null, elapsedMs: Number(both.elapsedMs.toFixed(1)), errorName: both.errorName ?? null, errorMessage: both.errorMessage ?? null, stack: both.errorStack ?? null },
  })

  // A second, safe larger arm catches regressions that only appear above the
  // historical 130k boundary. It compares the same retained input through
  // baseline and candidate, but intentionally does not add another A/B pass.
  const stressSnapshot = makeSnapshot(150000)
  const stressBaseline = runArm('baseline', stressSnapshot)
  const stressCandidate = runArm('candidate', stressSnapshot)
  assert.equal(stressBaseline.ok, true, 'baseline should finish on the safe larger retained input')
  assert.equal(stressCandidate.ok, true, 'candidate should finish on the safe larger retained input')
  assert.ok(stressCandidate.result?.diagnostics.peakMemoryBytesEstimate > 0)
  report.push({
    sameStressInput: 150000,
    baseline: { ok: stressBaseline.ok, elapsedMs: Number(stressBaseline.elapsedMs.toFixed(1)), outputSurfels: stressBaseline.result?.surfels.length ?? null },
    candidateOnly: { ok: stressCandidate.ok, elapsedMs: Number(stressCandidate.elapsedMs.toFixed(1)), baselineRatio: Number((stressCandidate.elapsedMs / Math.max(.001, stressBaseline.elapsedMs)).toFixed(3)), layeredDiagnostics: layeredBenchmarkSummary(stressCandidate) },
  })
  console.log('FINISH_SCALABILITY_INVESTIGATION ' + JSON.stringify(report))
})

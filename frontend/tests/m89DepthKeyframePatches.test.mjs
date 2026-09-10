import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import ts from 'typescript'

function moduleUrl(url) {
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => {
    const resolved = specifier.startsWith('.')
      ? moduleUrl(new URL(`${specifier}.ts`, url))
      : import.meta.resolve(specifier)
    return `from '${resolved}'`
  })
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
}

const module = await import(moduleUrl(new URL('../src/features/scanner/services/m89DepthKeyframePatchService.ts', import.meta.url)))
const { M89_DEPTH_KEYFRAME_PATCH_CONFIG, buildM89DepthKeyframePatches } = module

function makeFrame(sequence, columns, rows, samples) {
  const count = columns * rows
  const valid = new Uint8Array(count)
  const normalValid = new Uint8Array(count)
  const points = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const colorSourceIndices = new Int32Array(count).fill(-1)
  samples.forEach((sample, sourceIndex) => {
    if (sample.valid === false) return
    valid[sourceIndex] = 1
    normalValid[sourceIndex] = 1
    points.set([sample.position.x, sample.position.y, sample.position.z], sourceIndex * 3)
    normals.set([sample.normal.x, sample.normal.y, sample.normal.z], sourceIndex * 3)
    colorSourceIndices[sourceIndex] = sourceIndex
  })
  return {
    sequence,
    timestamp: sequence * 250,
    samplingPhase: sequence % 4,
    trackingQuality: .95,
    cameraPosition: { x: sequence * .05, y: .6, z: .4 },
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
      validPointCount: samples.filter((sample) => sample.valid !== false).length,
      rejectedPointCount: samples.filter((sample) => sample.valid === false).length,
    },
    normals,
    normalValid,
    colorSourceIndices,
    srgbColors: new Uint8Array(count * 3).fill(160),
    coverageProxyKeys: [],
    viewpointProxyKey: `${sequence}:0`,
  }
}

function snapshot(frames) {
  return {
    frames,
    diagnostics: {
      framesConsidered: frames.length,
      framesRetained: frames.length,
      duplicateFramesRejected: 0,
      redundancyRejects: 0,
      temporalCompactions: 0,
      compactionReplacements: 0,
      coverageLostDueToRemoval: 0,
      samplesRetained: frames.reduce((sum, frame) => sum + frame.denseFrame.validPointCount, 0),
      retainedColorEvidenceCount: 0,
      retainedColorFrameCount: 0,
      memoryBytes: 0,
      viewpointBinCount: frames.length,
      earliestTimestamp: frames[0]?.timestamp ?? null,
      latestTimestamp: frames.at(-1)?.timestamp ?? null,
      retainedFrameCoverage: [],
    },
  }
}

function gridFrame(sequence, columns = 5, rows = 5, transform = {}) {
  const samples = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const u = (column - (columns - 1) / 2) * .025
      const v = (row - (rows - 1) / 2) * .025
      samples.push(transform.sample?.(u, v, column, row) ?? {
        position: { x: u, y: v, z: -2 },
        normal: { x: 0, y: 0, z: 1 },
      })
    }
  }
  return makeFrame(sequence, columns, rows, samples)
}

function outputVertex(result, vertexIndex) {
  const offset = vertexIndex * 3
  return {
    x: result.vertices.positions[offset],
    y: result.vertices.positions[offset + 1],
    z: result.vertices.positions[offset + 2],
  }
}

function outputNormal(result, vertexIndex) {
  const offset = vertexIndex * 3
  return {
    x: result.vertices.normals[offset],
    y: result.vertices.normals[offset + 1],
    z: result.vertices.normals[offset + 2],
  }
}

function triangleVertexIndices(result, triangleIndex) {
  return [
    result.triangles[triangleIndex * 3],
    result.triangles[triangleIndex * 3 + 1],
    result.triangles[triangleIndex * 3 + 2],
  ]
}

test('M8.9 emits deterministic source-owned patches for a clean measured plane', () => {
  const result = buildM89DepthKeyframePatches(snapshot([
    gridFrame(1),
    gridFrame(2),
    gridFrame(3),
  ]))
  assert.equal(result.diagnostics.candidateQuadCount, 3 * 4 * 4)
  assert.equal(result.diagnostics.observedQuadCount, result.diagnostics.candidateQuadCount)
  assert.equal(result.diagnostics.acceptedQuadCount, result.diagnostics.candidateQuadCount)
  assert.equal(result.diagnostics.emittedTriangleCount, 3 * 4 * 4 * 2)
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  assert.equal(result.diagnostics.inventedVertexCount, 0)
  assert.equal(result.diagnostics.allOutputVerticesSourceOwned, true)
  assert.equal(result.patches.length, 3)
  assert.equal(result.diagnostics.screenSpaceCoverageAvailable, false)
  assert.ok(result.diagnostics.packedArrayBytes > 0)
})

test('M8.9 never bridges a genuinely unobserved source-grid gap', () => {
  const frame = gridFrame(1, 6, 4)
  const samples = []
  for (let index = 0; index < frame.denseFrame.valid.length; index += 1) {
    const offset = index * 3
    samples.push({
      valid: index % 6 === 2 ? false : true,
      position: { x: frame.denseFrame.points[offset], y: frame.denseFrame.points[offset + 1], z: frame.denseFrame.points[offset + 2] },
      normal: { x: frame.normals[offset], y: frame.normals[offset + 1], z: frame.normals[offset + 2] },
    })
  }
  const result = buildM89DepthKeyframePatches(snapshot([makeFrame(1, 6, 4, samples)]))
  assert.ok(result.diagnostics.rejectedMissingVertexQuads > 0)
  assert.ok(result.diagnostics.acceptedQuadCount < result.diagnostics.candidateQuadCount)
  for (const sourceIndex of result.vertices.sourceSampleIndices) {
    assert.notEqual(sourceIndex % 6, 2)
  }
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
})

test('M8.9 preserves 28mm parallel layers and an 8cm protrusion as separate measured patches', () => {
  const closeLayer = gridFrame(2, 5, 5, {
    sample: (u, v) => ({ position: { x: u, y: v, z: -2.028 }, normal: { x: 0, y: 0, z: 1 } }),
  })
  const protrusion = gridFrame(3, 4, 4, {
    sample: (u, v) => ({ position: { x: u + .35, y: v + .1, z: -1.92 }, normal: { x: 0, y: 0, z: 1 } }),
  })
  const result = buildM89DepthKeyframePatches(snapshot([gridFrame(1), closeLayer, protrusion]))
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  assert.ok(result.diagnostics.acceptedQuadCount > 0)
  assert.ok(result.diagnostics.outputDepthMinMeters <= -2.027)
  assert.ok(result.diagnostics.outputDepthMaxMeters >= -1.921)
  const outputDepths = [...result.vertices.sourceSampleIndices].map((_sourceIndex, vertexIndex) => outputVertex(result, vertexIndex).z)
  assert.ok(outputDepths.some((depth) => Math.abs(depth + 2) < .0001))
  assert.ok(outputDepths.some((depth) => Math.abs(depth + 2.028) < .0001))
  assert.ok(outputDepths.some((depth) => Math.abs(depth + 1.92) < .0001))
  for (let triangle = 0; triangle < result.diagnostics.emittedTriangleCount; triangle += 1) {
    const depths = triangleVertexIndices(result, triangle).map((vertex) => outputVertex(result, vertex).z)
    assert.ok(Math.max(...depths) - Math.min(...depths) <= M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumDepthDiscontinuityMeters)
  }
})

test('M8.9 keeps recess front/side/back and perpendicular wall/ceiling ownership separate', () => {
  const front = gridFrame(1)
  const back = gridFrame(2, 5, 5, {
    sample: (u, v) => ({ position: { x: u, y: v, z: -2.25 }, normal: { x: 0, y: 0, z: 1 } }),
  })
  const side = gridFrame(3, 5, 5, {
    sample: (u, v) => ({ position: { x: .18, y: u, z: -2 + v }, normal: { x: 1, y: 0, z: 0 } }),
  })
  const ceiling = gridFrame(4, 5, 5, {
    sample: (u, v) => ({ position: { x: u, y: .2, z: -2 + v }, normal: { x: 0, y: 1, z: 0 } }),
  })
  const result = buildM89DepthKeyframePatches(snapshot([front, back, side, ceiling]))
  assert.equal(result.patches.length, 4)
  assert.ok(result.patches.every((patch) => patch.acceptedQuadCount > 0))
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  const normalFamilies = new Set()
  for (let vertex = 0; vertex < result.diagnostics.emittedVertexCount; vertex += 1) {
    const normal = outputNormal(result, vertex)
    if (Math.abs(normal.x) > .9) normalFamilies.add('x')
    if (Math.abs(normal.y) > .9) normalFamilies.add('y')
    if (Math.abs(normal.z) > .9) normalFamilies.add('z')
  }
  assert.deepEqual([...normalFamilies].sort(), ['x', 'y', 'z'])
  assert.ok(result.vertices.sourceFrameSequences.includes(1))
  assert.ok(result.vertices.sourceFrameSequences.includes(2))
  assert.ok(result.vertices.sourceFrameSequences.includes(3))
  assert.ok(result.vertices.sourceFrameSequences.includes(4))
})

test('M8.9 rejects false-forward/noisy source-grid joins without inventing replacements', () => {
  const frame = gridFrame(1, 6, 6, {
    sample: (u, v, column, row) => {
      const falseForward = column === 2 && row === 2
      return {
        position: { x: u, y: v, z: falseForward ? -1.95 : -2 },
        normal: { x: 0, y: 0, z: 1 },
      }
    },
  })
  const result = buildM89DepthKeyframePatches(snapshot([frame]))
  assert.ok(result.diagnostics.rejectedDepthDiscontinuityQuads > 0)
  assert.ok(result.diagnostics.acceptedQuadCount < result.diagnostics.observedQuadCount)
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  assert.ok([...result.vertices.sourceSampleIndices].every((sourceIndex) => sourceIndex !== 2 + 2 * 6))
})

test('M8.9 normal discontinuities are conservative and deterministic', () => {
  const frame = gridFrame(1, 5, 5, {
    sample: (u, v, column, row) => ({
      position: { x: u, y: v, z: -2 },
      normal: column === 2 && row === 2 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 },
    }),
  })
  const first = buildM89DepthKeyframePatches(snapshot([frame]))
  const second = buildM89DepthKeyframePatches(snapshot([frame]))
  assert.ok(first.diagnostics.rejectedNormalDiscontinuityQuads > 0)
  assert.deepEqual(first.triangles, second.triangles)
  assert.deepEqual(first.vertices.positions, second.vertices.positions)
  assert.deepEqual(first.vertices.normals, second.vertices.normals)
  assert.deepEqual(first.vertices.sourceFrameSequences, second.vertices.sourceFrameSequences)
  assert.deepEqual(first.vertices.sourceSampleIndices, second.vertices.sourceSampleIndices)
  assert.deepEqual(first.patches, second.patches)
  assert.deepEqual(first.diagnostics, second.diagnostics)
})

test('M8.9 output remains bounded for a larger retained-frame fixture', () => {
  const frames = Array.from({ length: 24 }, (_unused, index) => gridFrame(index + 1, 20, 20))
  const result = buildM89DepthKeyframePatches(snapshot(frames))
  assert.ok(result.diagnostics.emittedTriangleCount <= M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumOutputTriangles)
  assert.ok(result.diagnostics.emittedVertexCount <= M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumOutputVertices)
  assert.equal(result.diagnostics.capacityRejectedQuads, 0)
  assert.ok(result.diagnostics.packedArrayBytes < 10 * 1024 * 1024)
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
})

test('M8.9 physical-envelope scale stays bounded at 96 retained 80x45 grids', () => {
  const frames = Array.from({ length: 96 }, (_unused, index) => gridFrame(index + 1, 80, 45))
  const started = performance.now()
  const result = buildM89DepthKeyframePatches(snapshot(frames))
  const elapsedMs = performance.now() - started
  console.log('M8.9 physical-envelope scale', JSON.stringify({
    frames: 96,
    samples: result.diagnostics.emittedVertexCount,
    triangles: result.diagnostics.emittedTriangleCount,
    packedBytes: result.diagnostics.packedArrayBytes,
    elapsedMs: Number(elapsedMs.toFixed(2)),
  }))
  assert.equal(result.diagnostics.inputValidSourceSampleCount, 345_600)
  assert.equal(result.diagnostics.usableSourceSampleCount, 345_600)
  assert.equal(result.diagnostics.emittedVertexCount, 345_600)
  assert.equal(result.diagnostics.emittedTriangleCount, 667_392)
  assert.equal(result.diagnostics.capacityRejectedQuads, 0)
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  assert.ok(result.diagnostics.emittedTriangleCount <= M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumOutputTriangles)
  assert.ok(result.diagnostics.emittedVertexCount <= M89_DEPTH_KEYFRAME_PATCH_CONFIG.maximumOutputVertices)
})

test('M8.9 36mm noisy plane rejects unsafe joins while retaining measured ownership', () => {
  const frame = gridFrame(1, 12, 12, {
    sample: (u, v, column, row) => ({
      position: {
        x: u,
        y: v,
        z: -2 + Math.sin((column + row) * Math.PI / 2) * .018,
      },
      normal: { x: 0, y: 0, z: 1 },
    }),
  })
  const result = buildM89DepthKeyframePatches(snapshot([frame]))
  assert.ok(result.diagnostics.maxObservedDepthSpanMeters >= .036 - 1e-5)
  assert.ok(result.diagnostics.rejectedDepthDiscontinuityQuads > 0)
  assert.ok(result.diagnostics.acceptedQuadCount < result.diagnostics.observedQuadCount)
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  assert.equal(result.diagnostics.inventedVertexCount, 0)
})

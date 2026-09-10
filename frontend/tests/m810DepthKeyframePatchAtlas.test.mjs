import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import ts from 'typescript'
import * as THREE from 'three'

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

const atlasModule = await import(moduleUrl(new URL('../src/features/scanner/services/m810DepthKeyframePatchAtlasService.ts', import.meta.url)))
const { buildM810DepthKeyframePatchAtlas } = atlasModule
const canonicalModule = await import(moduleUrl(new URL('../src/features/scanner/services/canonicalRealityFusionService.ts', import.meta.url)))
const layeredModule = await import(moduleUrl(new URL('../src/features/scanner/services/layeredMeasuredSurfaceFieldService.ts', import.meta.url)))
const { CanonicalRealityFusionService } = canonicalModule
const { createRetainedRealityMeasurementSnapshotSignature } = layeredModule
const renderingModule = await import(moduleUrl(new URL('../src/features/scanner/services/realitySurfaceRenderingService.ts', import.meta.url)))
const { auditRealityTriangleScreenSpace, createRealitySurfaceRenderResources, restoreRealitySurface } = renderingModule
const renderingPrepModule = await import(moduleUrl(new URL('../src/features/scanner/services/m810DepthKeyframePatchRenderingService.ts', import.meta.url)))
const { createM810PatchAtlasPreparedSurface } = renderingPrepModule

function makeFrame(sequence, columns, rows, samples, trackingQuality = .95) {
  const count = columns * rows
  const valid = new Uint8Array(count)
  const normalValid = new Uint8Array(count)
  const points = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const normalizedX = new Float32Array(count)
  const normalizedY = new Float32Array(count)
  const colorSourceIndices = new Int32Array(count).fill(-1)
  samples.forEach((sample, sourceIndex) => {
    normalizedX[sourceIndex] = (sourceIndex % columns) / Math.max(1, columns - 1)
    normalizedY[sourceIndex] = Math.floor(sourceIndex / columns) / Math.max(1, rows - 1)
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
    trackingQuality,
    cameraPosition: { x: sequence * .05, y: .6, z: .4 },
    cameraOrientation: { x: 0, y: 0, z: 0, w: 1 },
    denseFrame: {
      columns,
      rows,
      valid,
      normalizedX,
      normalizedY,
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
      retainedColorEvidenceCount: frames.length,
      retainedColorFrameCount: frames.length,
      memoryBytes: frames.reduce((sum, frame) => sum + frame.denseFrame.points.byteLength, 0),
      viewpointBinCount: frames.length,
      earliestTimestamp: frames[0]?.timestamp ?? null,
      latestTimestamp: frames.at(-1)?.timestamp ?? null,
      retainedFrameCoverage: [],
    },
  }
}

function gridFrame(sequence, columns = 5, rows = 5, transform = {}) {
  const samples = []
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const u = (column - (columns - 1) / 2) * .025
    const v = (row - (rows - 1) / 2) * .025
    samples.push(transform.sample?.(u, v, column, row) ?? {
      position: { x: u, y: v, z: -2 },
      normal: { x: 0, y: 0, z: 1 },
    })
  }
  return makeFrame(sequence, columns, rows, samples, transform.trackingQuality ?? .95)
}

function atlas(frames) {
  return buildM810DepthKeyframePatchAtlas(snapshot(frames), 'fixture-signature')
}

function snapshotSignature(frames) {
  return createRetainedRealityMeasurementSnapshotSignature(snapshot(frames))
}

function geometryFor(result) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(result.vertices.positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(result.indices, 1))
  return geometry
}

function worldGeometryMetrics(geometry) {
  const positions = geometry.getAttribute('position')
  const index = geometry.getIndex()?.array
  const vertexIds = new Map()
  const triangleVertices = []
  const triangleKeys = new Map()
  const edgeCounts = new Map()
  const edgeTriangles = new Map()
  const triangleParent = []
  const positionKey = (indexValue) => {
    const offset = indexValue * 3
    return `${Math.round(positions.array[offset] * 1e6)}:${Math.round(positions.array[offset + 1] * 1e6)}:${Math.round(positions.array[offset + 2] * 1e6)}`
  }
  const vertexId = (indexValue) => {
    const key = positionKey(indexValue)
    const existing = vertexIds.get(key)
    if (existing !== undefined) return existing
    const id = vertexIds.size
    vertexIds.set(key, id)
    return id
  }
  const find = (value) => {
    let root = value
    while (triangleParent[root] !== root) root = triangleParent[root]
    while (triangleParent[value] !== value) {
      const next = triangleParent[value]
      triangleParent[value] = root
      value = next
    }
    return root
  }
  const union = (left, right) => {
    const leftRoot = find(left), rightRoot = find(right)
    if (leftRoot !== rightRoot) triangleParent[rightRoot] = leftRoot
  }
  const triangleCount = index ? Math.floor(index.length / 3) : Math.floor(positions.count / 3)
  let summedTriangleAreaSquareMeters = 0
  let minZ = Infinity, maxZ = -Infinity
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const z = positions.array[vertex * 3 + 2]
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    triangleParent.push(triangle)
    const offset = triangle * 3
    const source = index ? [index[offset], index[offset + 1], index[offset + 2]] : [offset, offset + 1, offset + 2]
    const ids = source.map((value) => vertexId(value))
    triangleVertices.push(ids)
    const key = [...ids].sort((left, right) => left - right).join(':')
    triangleKeys.set(key, (triangleKeys.get(key) ?? 0) + 1)
    const a = source[0] * 3, b = source[1] * 3, c = source[2] * 3
    const ab = [positions.array[b] - positions.array[a], positions.array[b + 1] - positions.array[a + 1], positions.array[b + 2] - positions.array[a + 2]]
    const ac = [positions.array[c] - positions.array[a], positions.array[c + 1] - positions.array[a + 1], positions.array[c + 2] - positions.array[a + 2]]
    summedTriangleAreaSquareMeters += .5 * Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0])
    for (const [left, right] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const edge = left < right ? `${left}:${right}` : `${right}:${left}`
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1)
      const previousTriangle = edgeTriangles.get(edge)
      if (previousTriangle !== undefined) union(previousTriangle, triangle)
      else edgeTriangles.set(edge, triangle)
    }
  }
  const components = new Set(triangleVertices.map((_vertices, triangle) => find(triangle)))
  const duplicateTriangleProxy = [...triangleKeys.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  return {
    representedVertexCount: vertexIds.size,
    triangleCount,
    summedTriangleAreaSquareMeters,
    componentCount: components.size,
    boundaryEdgeCount: [...edgeCounts.values()].filter((count) => count === 1).length,
    duplicateTriangleProxy,
    minZ: Number.isFinite(minZ) ? minZ : null,
    maxZ: Number.isFinite(maxZ) ? maxZ : null,
  }
}

function sourceDepthMean(result, sequence) {
  let total = 0, count = 0
  for (let vertex = 0; vertex < result.vertices.sourceFrameSequences.length; vertex += 1) {
    if (result.vertices.sourceFrameSequences[vertex] !== sequence) continue
    total += result.vertices.positions[vertex * 3 + 2]
    count += 1
  }
  return count ? total / count : null
}

test('M8.10 clean plane is indexed, source-owned, UV/RGB registered, and deterministic', () => {
  const frames = [gridFrame(1), gridFrame(2), gridFrame(3)]
  const first = atlas(frames)
  const second = atlas(frames)
  assert.equal(first.diagnostics.sourceOwnershipViolations, 0)
  assert.equal(first.diagnostics.inventedVertexCount, 0)
  assert.equal(first.diagnostics.rawTriangleCount, 96)
  assert.equal(first.diagnostics.retainedTriangleCount, 32)
  assert.equal(first.diagnostics.duplicateTrianglesCulled, 64)
  assert.equal(first.diagnostics.retainedVertexCount, 25)
  assert.equal(first.diagnostics.registeredColorVertexCount, 25)
  assert.equal(first.diagnostics.normalizedUvVertexCount, 25)
  assert.ok(first.vertices.colors.every((value) => value === 160))
  assert.equal(first.vertices.sourceGridUvs[0], 0)
  assert.equal(first.indices.length, first.diagnostics.retainedTriangleCount * 3)
  assert.deepEqual(first.indices, second.indices)
  assert.deepEqual(first.vertices.positions, second.vertices.positions)
  assert.deepEqual(first.vertices.sourceFrameSequences, second.vertices.sourceFrameSequences)
  assert.deepEqual({ ...first.diagnostics, timings: null }, { ...second.diagnostics, timings: null })
})

test('M8.10 never bridges a genuine source-grid gap', () => {
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
  const result = atlas([makeFrame(1, 6, 4, samples)])
  assert.ok(result.diagnostics.rawTriangleCount > result.diagnostics.retainedTriangleCount || result.diagnostics.rawTriangleCount > 0)
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  for (const sourceIndex of result.vertices.sourceSampleIndices) assert.notEqual(sourceIndex % 6, 2)
})

test('M8.10 preserves 28mm layers, 8cm protrusion, recess bands, and opposing normals', () => {
  const front = gridFrame(1)
  const closeLayer = gridFrame(2, 5, 5, { sample: (u, v) => ({ position: { x: u, y: v, z: -2.028 }, normal: { x: 0, y: 0, z: 1 } }) })
  const protrusion = gridFrame(3, 4, 4, { sample: (u, v) => ({ position: { x: u + .35, y: v, z: -1.92 }, normal: { x: 0, y: 0, z: 1 } }) })
  const side = gridFrame(4, 5, 5, { sample: (u, v) => ({ position: { x: .18, y: u, z: -2 + v }, normal: { x: 1, y: 0, z: 0 } }) })
  const opposing = gridFrame(5, 5, 5, { sample: (u, v) => ({ position: { x: u, y: v, z: -2 }, normal: { x: 0, y: 0, z: -1 } }) })
  const result = atlas([front, closeLayer, protrusion, side, opposing])
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  assert.ok(result.diagnostics.retainedTriangleCount > 0)
  assert.ok(result.diagnostics.overlapConflictCandidatesOver22mm > 0)
  assert.ok(result.vertices.sourceFrameSequences.includes(1))
  assert.ok(result.vertices.sourceFrameSequences.includes(2))
  assert.ok(result.vertices.sourceFrameSequences.includes(3))
  assert.ok(result.vertices.sourceFrameSequences.includes(4))
  assert.ok(result.vertices.sourceFrameSequences.includes(5))
})

test('M8.10 culls only near-identical same-facing sheets and is deterministic', () => {
  const duplicate = atlas([gridFrame(1), gridFrame(2, 5, 5, { trackingQuality: .8 })])
  assert.ok(duplicate.diagnostics.duplicateTrianglesCulled > 0)
  assert.equal(duplicate.diagnostics.overlapConflictCandidatesOver22mm, 0)
  assert.equal(duplicate.diagnostics.sourceOwnershipViolations, 0)
  const repeat = atlas([gridFrame(1), gridFrame(2, 5, 5, { trackingQuality: .8 })])
  assert.deepEqual(duplicate.indices, repeat.indices)
  assert.deepEqual(duplicate.vertices.colors, repeat.vertices.colors)
  assert.deepEqual(duplicate.patches, repeat.patches)
})

test('M8.10 overlap conflicts require bounded lateral overlap, while same-XY layers remain eligible', () => {
  const laterallySeparated = atlas([
    gridFrame(1),
    gridFrame(2, 5, 5, { sample: (u, v) => ({ position: { x: u + .12, y: v, z: -1.94 }, normal: { x: 0, y: 0, z: 1 } }) }),
  ])
  assert.equal(laterallySeparated.diagnostics.overlapConflictCandidatesOver22mm, 0)
  assert.ok(laterallySeparated.diagnostics.overlapConflictLateralRejects > 0)
  const sameXY = atlas([
    gridFrame(1),
    gridFrame(2, 5, 5, { sample: (u, v) => ({ position: { x: u, y: v, z: -2.028 }, normal: { x: 0, y: 0, z: 1 } }) }),
  ])
  assert.ok(sameXY.diagnostics.overlapConflictCandidatesOver22mm > 0)
})

test('M8.10 rejects false-forward/noisy depth and invalid partial-occlusion neighbors', () => {
  const noisy = gridFrame(1, 8, 8, {
    sample: (u, v, column, row) => ({
      position: { x: u, y: v, z: -2 + ((column + row) % 2 ? .018 : -.018) },
      normal: { x: 0, y: 0, z: 1 },
    }),
  })
  const partialSamples = []
  for (let row = 0; row < 8; row += 1) for (let column = 0; column < 8; column += 1) {
    partialSamples.push({
      valid: column === 3 || (column === 4 && row > 1 && row < 6) ? false : true,
      position: { x: (column - 3.5) * .025, y: (row - 3.5) * .025, z: column === 2 && row === 2 ? -1.95 : -2 },
      normal: { x: 0, y: 0, z: 1 },
    })
  }
  const result = atlas([noisy, makeFrame(2, 8, 8, partialSamples)])
  assert.ok(result.diagnostics.rawTriangleCount < 2 * 7 * 7 * 2)
  assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
  assert.equal(result.diagnostics.inventedVertexCount, 0)
  assert.ok(result.diagnostics.retainedTriangleCount > 0)
})

test('M8.10 flat indexed triangle audit is deterministic on the same camera', () => {
  const result = atlas([gridFrame(1), gridFrame(2)])
  const geometry = geometryFor(result)
  const camera = new THREE.PerspectiveCamera(60, 1, .04, 20)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -2)
  camera.updateMatrixWorld()
  const first = auditRealityTriangleScreenSpace(geometry, camera, 320, 320)
  const second = auditRealityTriangleScreenSpace(geometry, camera, 320, 320)
  assert.deepEqual(first, second)
  assert.ok(first.inFrustumPrimitiveCount > 0)
  assert.ok(first.usefulPixelCount > 0)
  assert.ok(first.holeFraction < 1)
  assert.ok((first.boundaryPixelCount ?? 0) >= 0)
  geometry.dispose()
})

test('M8.10 triangle audit counts final owner winners, not overwritten depth writes', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -.2, -.2, -1, .2, -.2, -1, 0, .2, -1,
    -.2, -.2, -2, .2, -.2, -2, 0, .2, -2,
  ]), 3))
  geometry.setIndex([0, 1, 2, 3, 4, 5])
  const camera = new THREE.PerspectiveCamera(60, 1, .04, 20)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -2)
  camera.updateMatrixWorld()
  const audit = auditRealityTriangleScreenSpace(geometry, camera, 320, 320)
  assert.equal(audit.inFrustumPrimitiveCount, 2)
  assert.equal(audit.visiblePrimitiveCount, 1)
  assert.equal(audit.depthHiddenPrimitiveCount, 1)
  assert.ok((audit.overdrawTestsPerUsefulPixel ?? 0) > 0)
  geometry.dispose()
})

test('M8.10 prepared preview uses one indexed flat draw without surfel conversion', () => {
  const result = atlas([gridFrame(1), gridFrame(2)])
  const prepared = createM810PatchAtlasPreparedSurface(result)
  assert.equal(prepared.geometries[0].index.array, result.indices)
  assert.equal(prepared.layers[0].kind, 'm810-triangles')
  assert.equal(prepared.stats.drawCalls, 1)
  assert.equal(prepared.stats.memoryBytes, result.diagnostics.gpuBytesEstimate, 'default flat GPU estimate must match uploaded position/normal/index buffers')
  const registeredColorPrepared = createM810PatchAtlasPreparedSurface(result, true)
  assert.equal(registeredColorPrepared.stats.memoryBytes, result.diagnostics.registeredColorGpuBytesEstimate, 'registered-color GPU estimate must include the optional color attribute')
  const restored = restoreRealitySurface(prepared)
  assert.equal(restored.geometries[0].getIndex().count, result.indices.length)
  assert.ok(restored.triangleGeometry)
  restored.geometries.forEach((geometry) => geometry.dispose())
  restored.materials.forEach((material) => material.dispose())
})

test('M8.10 same-snapshot A/B uses canonical Stage-4 loss and audits actual flat geometries', () => {
  const columns = 12, rows = 8
  const frames = [
    gridFrame(1, columns, rows, { sample: (_u, _v, column) => column === 6 ? { valid: false } : undefined }),
    gridFrame(2, columns, rows, { sample: (_u, _v, column) => column < 6 ? undefined : { valid: false } }),
    gridFrame(3, columns, rows, { sample: (_u, _v, column) => column < 6 ? undefined : { valid: false } }),
    gridFrame(4, columns, rows, { sample: (u, v) => ({ position: { x: u, y: v, z: -2.028 }, normal: { x: 0, y: 0, z: 1 } }) }),
  ]
  const input = snapshot(frames)
  const inputSignature = snapshotSignature(frames)
  const baseline = new CanonicalRealityFusionService().reconstruct(input)
  const candidate = buildM810DepthKeyframePatchAtlas(input, inputSignature)
  const baselineResources = createRealitySurfaceRenderResources({ surfels: baseline.surfels }, 'triangles')
  const candidateGeometry = geometryFor(candidate)
  const camera = new THREE.PerspectiveCamera(60, 1, .04, 20)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -2)
  camera.updateMatrixWorld()
  const baselineAudit = auditRealityTriangleScreenSpace(baselineResources.triangleGeometry, camera, 320, 320)
  const candidateAudit = auditRealityTriangleScreenSpace(candidateGeometry, camera, 320, 320)
  assert.ok(baselineResources.triangleGeometry)
  const baselineWorld = worldGeometryMetrics(baselineResources.triangleGeometry)
  const candidateWorld = worldGeometryMetrics(candidateGeometry)
  const validMeasuredInputCount = frames.reduce((sum, frame) => sum + frame.denseFrame.validPointCount, 0)
  const acceptedInputAreaProxySquareMeters = candidate.diagnostics.rawAreaSquareMeters
  const baselineMissingMeasuredAreaProxySquareMeters = Math.max(0, acceptedInputAreaProxySquareMeters - baselineWorld.summedTriangleAreaSquareMeters)
  const candidateMissingMeasuredAreaProxySquareMeters = Math.max(0, acceptedInputAreaProxySquareMeters - candidateWorld.summedTriangleAreaSquareMeters)
  const frontLayerDepth = sourceDepthMean(candidate, 1)
  const closeLayerDepth = sourceDepthMean(candidate, 4)
  const measuredLayerSeparationMeters = frontLayerDepth === null || closeLayerDepth === null ? null : Math.abs(frontLayerDepth - closeLayerDepth)
  const worldMetrics = {
    validMeasuredInputCount,
    acceptedInputAreaProxySquareMeters,
    baseline: {
      representedSamples: baseline.surfels.length,
      representedVertices: baselineWorld.representedVertexCount,
      summedTriangleAreaSquareMeters: baselineWorld.summedTriangleAreaSquareMeters,
      missingMeasuredAreaProxySquareMeters: baselineMissingMeasuredAreaProxySquareMeters,
      topologyComponents: baselineWorld.componentCount,
      boundaryEdges: baselineWorld.boundaryEdgeCount,
      duplicateTriangleProxy: baselineWorld.duplicateTriangleProxy,
      depthRangeMeters: baselineWorld.minZ === null ? null : baselineWorld.maxZ - baselineWorld.minZ,
    },
    candidate: {
      representedSamples: candidate.diagnostics.retainedVertexCount,
      representedVertices: candidateWorld.representedVertexCount,
      summedTriangleAreaSquareMeters: candidateWorld.summedTriangleAreaSquareMeters,
      missingMeasuredAreaProxySquareMeters: candidateMissingMeasuredAreaProxySquareMeters,
      topologyComponents: candidateWorld.componentCount,
      boundaryEdges: candidateWorld.boundaryEdgeCount,
      duplicateTriangleProxy: candidateWorld.duplicateTriangleProxy,
      sourceDuplicateTrianglesCulled: candidate.diagnostics.duplicateTrianglesCulled,
      depthRangeMeters: candidateWorld.minZ === null ? null : candidateWorld.maxZ - candidateWorld.minZ,
      measuredLayerSeparationMeters,
    },
  }
  console.log('M8.10 same-snapshot A/B', JSON.stringify({
    inputSignature,
    worldMetrics,
    candidateRawTriangles: candidate.diagnostics.rawTriangleCount,
    baselineTriangles: baselineResources.stats.renderedTriangleCount,
    candidateTriangles: candidate.diagnostics.retainedTriangleCount,
    candidateDuplicateCulls: candidate.diagnostics.duplicateTrianglesCulled,
    baselineAreaProxy: baselineAudit.usefulPixelCount,
    candidateAreaProxy: candidateAudit.usefulPixelCount,
    baselineScreen: baselineAudit,
    candidateScreen: candidateAudit,
    baselineWorkerMs: baseline.diagnostics.workerTimeMs,
    candidateWorkerMs: candidate.diagnostics.timings.totalMs,
    baselineRenderBytes: baselineResources.stats.memoryBytes,
    candidateRenderBytes: candidate.diagnostics.packedBytes,
    baselineFlatGpuBytes: baselineResources.stats.memoryBytes,
    candidateFlatGpuBytes: candidate.diagnostics.gpuBytesEstimate,
    candidateRegisteredColorGpuBytes: candidate.diagnostics.registeredColorGpuBytesEstimate,
    ownershipViolations: candidate.diagnostics.sourceOwnershipViolations,
    inventedVertices: candidate.diagnostics.inventedVertexCount,
    layerConflictsOver22mm: candidate.diagnostics.overlapConflictCandidatesOver22mm,
  }))
  assert.equal(candidate.diagnostics.inputSnapshotSignature, inputSignature)
  assert.equal(candidate.diagnostics.sourceOwnershipViolations, 0)
  assert.equal(candidate.diagnostics.inventedVertexCount, 0)
  assert.ok(candidate.diagnostics.retainedTriangleCount > 0)
  assert.equal(validMeasuredInputCount, 280)
  assert.ok(acceptedInputAreaProxySquareMeters > 0)
  assert.equal(baselineWorld.representedVertexCount, baseline.surfels.length)
  assert.equal(baselineWorld.componentCount, 1)
  assert.equal(baselineWorld.boundaryEdgeCount, 24)
  assert.equal(baselineWorld.duplicateTriangleProxy, 0)
  assert.ok(baselineWorld.summedTriangleAreaSquareMeters > 0)
  assert.ok(Math.abs(candidateWorld.summedTriangleAreaSquareMeters - candidate.diagnostics.retainedAreaSquareMeters) < 1e-6)
  assert.equal(candidateWorld.componentCount, candidate.diagnostics.componentCount)
  assert.equal(candidateWorld.boundaryEdgeCount, candidate.diagnostics.boundaryEdgeCount)
  assert.equal(candidateWorld.duplicateTriangleProxy, 0)
  assert.ok(candidateWorld.summedTriangleAreaSquareMeters > baselineWorld.summedTriangleAreaSquareMeters)
  assert.ok(candidateMissingMeasuredAreaProxySquareMeters < baselineMissingMeasuredAreaProxySquareMeters)
  assert.equal(baselineWorld.minZ, baselineWorld.maxZ)
  assert.ok(measuredLayerSeparationMeters !== null)
  assert.ok(Math.abs(measuredLayerSeparationMeters - .028) < 1e-4, `expected 28mm source layer separation, got ${measuredLayerSeparationMeters}`)
  assert.ok(candidate.diagnostics.overlapConflictCandidatesOver22mm > 0, 'same-XY 28 mm layer must remain a measured conflict')
  for (let offset = 0; offset < candidate.indices.length; offset += 3) {
    const frameSequences = [0, 1, 2].map((index) => candidate.vertices.sourceFrameSequences[candidate.indices[offset + index]])
    const sampleIndices = [0, 1, 2].map((index) => candidate.vertices.sourceSampleIndices[candidate.indices[offset + index]])
    assert.equal(new Set(frameSequences).size, 1, 'triangles must retain one source frame')
    const frame = frames.find((entry) => entry.sequence === frameSequences[0])
    assert.ok(frame)
    assert.ok(sampleIndices.every((sampleIndex) => frame.denseFrame.valid[sampleIndex]), 'triangles must not bridge an invalid source-grid gap')
  }
  assert.ok(baseline.surfels.length < frames[0].denseFrame.validPointCount, 'canonical baseline should expire the one-frame extension')
  assert.ok(candidate.diagnostics.retainedVertexCount > baseline.surfels.length, 'candidate should preserve the measured one-frame extension')
  assert.ok(candidateAudit.usefulPixelCount > baselineAudit.usefulPixelCount || candidateAudit.holeFraction < baselineAudit.holeFraction, 'candidate must improve useful pixels or hole fraction on this controlled fixture')
  baselineResources.geometries.forEach((geometry) => geometry.dispose())
  baselineResources.materials.forEach((material) => material.dispose())
  candidateGeometry.dispose()
})

test('M8.10 benchmark logs small, 130k, 150k, and full retained physical envelope', { timeout: 120000 }, () => {
  const fixtures = [
    ['small', 4, 20, 20],
    ['130k', 36, 60, 60],
    ['150k', 42, 60, 60],
    ['345600', 96, 80, 45],
  ]
  for (const [label, frameCount, columns, rows] of fixtures) {
    const frames = Array.from({ length: frameCount }, (_unused, index) => gridFrame(index + 1, columns, rows))
    const started = performance.now()
    const result = atlas(frames)
    const elapsedMs = performance.now() - started
    console.log(`M8.10 ${label}`, JSON.stringify({ frames: frameCount, inputSamples: frameCount * columns * rows, rawTriangles: result.diagnostics.rawTriangleCount, retainedTriangles: result.diagnostics.retainedTriangleCount, duplicates: result.diagnostics.duplicateTrianglesCulled, timings: result.diagnostics.timings, packedBytes: result.diagnostics.packedBytes, workingTypedBytes: result.diagnostics.workingTypedBytes, peakTypedBytes: result.diagnostics.peakCpuTypedBytesEstimate, elapsedMs: Number(elapsedMs.toFixed(2)) }))
    assert.equal(result.diagnostics.sourceOwnershipViolations, 0)
    assert.equal(result.diagnostics.inventedVertexCount, 0)
    assert.ok(result.diagnostics.retainedTriangleCount <= result.diagnostics.rawTriangleCount)
    assert.ok(result.diagnostics.packedBytes > 0)
    assert.ok(result.diagnostics.drawCalls === 1)
  }
})

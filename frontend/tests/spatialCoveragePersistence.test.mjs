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
const load = (name) => import(moduleUrl(new URL(`../src/features/scanner/services/${name}.ts`, import.meta.url)))
const { SpatialCoverageService } = await load('spatialCoverageService')
const { DenseSurfaceMaskService } = await load('denseSurfaceMaskService')
const { COVERAGE_VISUAL_OPACITY, DENSE_VISUAL_STABILIZATION_CONFIG } = await load('spatialCoverageVisualConfig')

function planeFrame(validValue = 1) {
  const columns = 3, rows = 3, count = columns * rows
  const valid = new Uint8Array(count).fill(validValue)
  const normalizedX = new Float32Array(count), normalizedY = new Float32Array(count)
  const distancesMeters = new Float32Array(count).fill(1)
  const points = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const column = index % columns, row = Math.floor(index / columns)
    normalizedX[index] = column / (columns - 1); normalizedY[index] = row / (rows - 1)
    points[index * 3] = (column - 1) * 0.05
    points[index * 3 + 1] = (row - 1) * 0.05
    points[index * 3 + 2] = -1
  }
  return { columns, rows, valid, normalizedX, normalizedY, distancesMeters, points,
    attemptedSampleCount: count, validPointCount: validValue ? count : 0, rejectedPointCount: validValue ? 0 : count }
}

test('stored coverage is monotonic while current-frame input can disappear', () => {
  const service = new SpatialCoverageService(), frame = planeFrame()
  const direction = { x: 0, y: 0, z: -1 }
  const counts = [], states = []
  for (const [index, timestamp] of [0, 140, 280].entries()) {
    service.processDenseFrame(frame, { x: index * 0.04, y: 0, z: 0 }, direction, timestamp, index)
    const cells = service.getFinalizationCells()
    counts.push(cells.length); states.push(new Map(cells.map((cell) => [cell.id, cell.state])))
  }
  assert.ok(counts[0] > 0)
  assert.ok(counts[1] >= counts[0] && counts[2] >= counts[1])
  for (let pass = 1; pass < states.length; pass += 1) for (const [id, previous] of states[pass - 1]) {
    const current = states[pass].get(id)
    if (!current) continue
    assert.ok(['observed', 'partial', 'captured'].indexOf(current) >= ['observed', 'partial', 'captured'].indexOf(previous))
  }
  const beforeMissingDepth = service.getFinalizationCells()
  service.processDenseFrame(planeFrame(0), { x: 0.2, y: 0, z: 0 }, direction, 420, 0)
  assert.deepEqual(service.getFinalizationCells(), beforeMissingDepth)
})

test('blue dense mesh expiry is presentation-only and captured cells keep a faint persistent cue', () => {
  const coverage = new SpatialCoverageService(), frame = planeFrame(), mask = new DenseSurfaceMaskService()
  mask.setStabilizationOptions({ cacheEnabled: true, smoothingEnabled: false, holeFillEnabled: false, hysteresisEnabled: false })
  coverage.processDenseFrame(frame, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 0, 0)
  const storedCount = coverage.getFinalizationCells().length
  const liveMesh = mask.build(frame, coverage, 0)
  assert.ok(liveMesh.vertexCount > 0)
  assert.ok(mask.buildCached(DENSE_VISUAL_STABILIZATION_CONFIG.cacheLifetimeMs).vertexCount > 0)
  assert.equal(mask.buildCached(DENSE_VISUAL_STABILIZATION_CONFIG.cacheLifetimeMs + 1).vertexCount, 0)
  assert.equal(coverage.getFinalizationCells().length, storedCount)
  assert.ok(COVERAGE_VISUAL_OPACITY.captured > 0)
  assert.ok(COVERAGE_VISUAL_OPACITY.captured < COVERAGE_VISUAL_OPACITY.partial)
})

test('finalized coverage copy survives the explicit session reset boundary', () => {
  const service = new SpatialCoverageService(), frame = planeFrame()
  service.processDenseFrame(frame, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 0, 0)
  const finalizedCopy = service.getFinalizationCells()
  service.reset()
  assert.equal(service.getFinalizationCells().length, 0)
  assert.ok(finalizedCopy.length > 0)
})

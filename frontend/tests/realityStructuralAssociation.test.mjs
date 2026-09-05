import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function serviceModule(url) {
  const source = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}
const association = await import(serviceModule(new URL('../src/features/scanner/services/realityStructuralAssociationService.ts', import.meta.url)))

function patch(id, offset = 0) {
  return {
    id, sourceSurfaceId: id, role: 'wall',
    vertices3D: [{ x: offset, y: 0, z: 0 }, { x: offset + 2, y: 0, z: 0 }, { x: offset + 2, y: 2, z: 0 }, { x: offset, y: 2, z: 0 }],
    vertices2DLocal: [{ u: 0, v: 0 }, { u: 2, v: 0 }, { u: 2, v: 2 }, { u: 0, v: 2 }],
    triangleIndices: [0, 1, 2, 0, 2, 3], boundaryProvenance: [], confidence: .9, completionStatus: 'observed', areaMetersSquared: 4,
    supportPointCount: 40, normal: { x: 0, y: 0, z: 1 }, planeConstant: 0,
    basis: { origin: { x: offset, y: 0, z: 0 }, axisU: { x: 1, y: 0, z: 0 }, axisV: { x: 0, y: 1, z: 0 } },
    structuralEdgeCount: 2, supportDerivedEdgeCount: 2, canonicalCornerCount: 1, maximumPlaneResidualMeters: .01, maximumBasisRoundTripResidualMeters: 0, triangulationValid: true,
  }
}
function surfel(id, x, y, z, color = { r: .5, g: .4, b: .3 }) {
  return { id, position: { x, y, z }, normal: { x: 0, y: 0, z: 1 }, radius: .0125, colorRgb: color, colorSpace: 'srgb', geometryConfidence: .9, colorConfidence: .9, colorObservationCount: 3 }
}

test('Reality hit resolves to the correct structural patch by plane and polygon, not centroid', () => {
  const result = association.associateRealityPoint({ x: 1.5, y: 1, z: .01 }, { x: 0, y: 0, z: 1 }, [patch('wall-a'), patch('wall-b', 3)])
  assert.equal(result.strength, 'strong')
  assert.equal(result.surfaceId, 'wall-a')
  assert.equal(result.insidePatch, true)
})
test('outside patch, foreground object, and incompatible normal do not create fake editable matches', () => {
  const wall = patch('wall-a')
  assert.equal(association.associateRealityPoint({ x: 2.2, y: 1, z: 0 }, null, [wall]).strength, 'none')
  assert.equal(association.associateRealityPoint({ x: 1, y: 1, z: .12 }, null, [wall]).strength, 'none')
  assert.equal(association.associateRealityPoint({ x: 1, y: 1, z: .01 }, { x: 1, y: 0, z: 0 }, [wall]).strength, 'none')
})
test('sample association preserves foreground and supports two independently customized walls', () => {
  const surfels = [surfel(1, .5, .5, .01), surfel(2, 3.5, .5, .01), surfel(3, .5, .5, .07)]
  const table = association.associateRealitySurfels(surfels, [patch('wall-a'), patch('wall-b', 3)])
  assert.deepEqual([...table.surfaceIndices], [0, 1, -1])
  assert.equal(table.preservedForegroundSampleCount, 1)
  const original = JSON.stringify(surfels)
  const colors = association.buildRealityDesignColors(surfels, table, [{ surfaceId: 'wall-a', paintColor: '#0000ff' }, { surfaceId: 'wall-b', paintColor: '#ff0000' }])
  assert.ok(colors.get(1).b > colors.get(1).r)
  assert.ok(colors.get(2).r > colors.get(2).b)
  assert.equal(colors.has(3), false, 'foreground Reality RGB is preserved')
  assert.equal(JSON.stringify(surfels), original, 'original Reality remains immutable')
})
test('partial patch only accepts its measured polygon and no-match objects remain valid', () => {
  const partial = patch('partial-wall')
  partial.vertices2DLocal = [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }]
  assert.equal(association.associateRealityPoint({ x: .5, y: .5, z: 0 }, null, [partial]).surfaceId, 'partial-wall')
  assert.equal(association.associateRealityPoint({ x: 1.5, y: .5, z: 0 }, null, [partial]).strength, 'none')
})

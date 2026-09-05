import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const logicalService = await import(moduleUrl(new URL('../src/features/scanner/services/logicalSurfaceService.ts', import.meta.url)))
const association = await import(moduleUrl(new URL('../src/features/scanner/services/realityStructuralAssociationService.ts', import.meta.url)))

function patch(id, {
  offsetX = 0,
  offsetZ = 0,
  width = 2,
  height = 2,
  normal = { x: 0, y: 0, z: 1 },
  planeConstant = offsetZ,
  role = 'wall',
} = {}) {
  const v0 = { x: offsetX, y: 0, z: offsetZ }
  const v1 = { x: offsetX + width, y: 0, z: offsetZ }
  const v2 = { x: offsetX + width, y: height, z: offsetZ }
  const v3 = { x: offsetX, y: height, z: offsetZ }
  return {
    id,
    sourceSurfaceId: id,
    role,
    vertices3D: [v0, v1, v2, v3],
    vertices2DLocal: [{ u: 0, v: 0 }, { u: width, v: 0 }, { u: width, v: height }, { u: 0, v: height }],
    triangleIndices: [0, 1, 2, 0, 2, 3],
    boundaryProvenance: [],
    confidence: 0.9,
    completionStatus: 'observed',
    areaMetersSquared: width * height,
    supportPointCount: 40,
    normal,
    planeConstant,
    basis: {
      origin: v0,
      axisU: { x: 1, y: 0, z: 0 },
      axisV: { x: 0, y: 1, z: 0 },
    },
    structuralEdgeCount: 2,
    supportDerivedEdgeCount: 2,
    canonicalCornerCount: 1,
    maximumPlaneResidualMeters: 0.01,
    maximumBasisRoundTripResidualMeters: 0,
    triangulationValid: true,
  }
}

function surfel(id, x, y, z, normal = { x: 0, y: 0, z: 1 }, color = { r: 0.5, g: 0.4, b: 0.3 }) {
  return {
    id,
    position: { x, y, z },
    normal,
    radius: 0.0125,
    colorRgb: { ...color },
    colorSpace: 'srgb',
    geometryConfidence: 0.9,
    colorConfidence: 0.9,
    colorObservationCount: 3,
  }
}

// 1. Two coplanar, adjacent M7.4 patches belonging to same physical wall form 1 LogicalStructuralSurface.
test('1. Two coplanar adjacent patches form 1 logical wall', () => {
  const patch1 = patch('wall-patch-1', { offsetX: 0, width: 2 })
  const patch2 = patch('wall-patch-2', { offsetX: 2.05, width: 2 }) // adjacent gap 5cm
  const groups = logicalService.groupPatchesIntoLogicalSurfaces([patch1, patch2])
  assert.equal(groups.length, 1)
  assert.deepEqual([...groups[0].memberPatchIds], ['wall-patch-1', 'wall-patch-2'])
  assert.equal(groups[0].role, 'wall')
  assert.ok(groups[0].totalAreaMetersSquared >= 7.9)
})

// 2. Parallel walls separated spatially by room width (>0.5 m) form DIFFERENT logical surfaces.
test('2. Parallel walls separated spatially form different logical surfaces', () => {
  const wallFront = patch('wall-front', { offsetX: 0, offsetZ: 0, planeConstant: 0 })
  const wallBack = patch('wall-back', { offsetX: 0, offsetZ: 3.0, planeConstant: 3.0 }) // 3m apart
  const groups = logicalService.groupPatchesIntoLogicalSurfaces([wallFront, wallBack])
  assert.equal(groups.length, 2)
  assert.notEqual(groups[0].id, groups[1].id)
})

// 3. Perpendicular adjacent walls form DIFFERENT logical surfaces.
test('3. Perpendicular adjacent walls form different logical surfaces', () => {
  const wallNorth = patch('wall-north', { offsetX: 0, normal: { x: 0, y: 0, z: 1 }, planeConstant: 0 })
  const wallEast = {
    ...patch('wall-east', { normal: { x: 1, y: 0, z: 0 }, planeConstant: 2.0 }),
    vertices3D: [{ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }, { x: 2, y: 2, z: 2 }, { x: 2, y: 2, z: 0 }],
  }
  const groups = logicalService.groupPatchesIntoLogicalSurfaces([wallNorth, wallEast])
  assert.equal(groups.length, 2)
})

// 4. Fragmented patches (e.g. patch 1, patch 3 from same wall separated by window gap <= 1.2 m) group into 1 logical wall.
test('4. Fragmented patches separated by obstacle gap <= 1.2m group into 1 logical wall', () => {
  const patchLeft = patch('patch-left', { offsetX: 0, width: 1.5 })
  const patchRight = patch('patch-right', { offsetX: 2.3, width: 1.5 }) // 0.8m gap (window / doorway)
  const groups = logicalService.groupPatchesIntoLogicalSurfaces([patchLeft, patchRight])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].memberPatchIds.length, 2)
})

// 5. Sample lying on wall plane inside patch polygon receives WALL_MEMBER classification.
test('5. Sample on wall plane receives WALL_MEMBER classification', () => {
  const wall = patch('wall-a')
  const samples = [surfel(1, 1.0, 1.0, 0.005)]
  const table = association.associateRealitySurfels(samples, [wall])
  assert.equal(table.memberships[0], 1, 'Sample on wall plane must be WALL_MEMBER (1)')
  assert.equal(table.wallMemberCount, 1)
})

// 6. Sample offset 0.08 m in front of wall receives NON_WALL classification (never painted).
test('6. Sample offset 0.08m in front of wall receives NON_WALL classification', () => {
  const wall = patch('wall-a')
  const samples = [surfel(1, 1.0, 1.0, 0.08)] // 8cm in front of wall plane
  const table = association.associateRealitySurfels(samples, [wall])
  assert.equal(table.memberships[0], 0, 'Sample offset 8cm must be NON_WALL (0)')
  assert.equal(table.nonWallCount, 1)
  assert.equal(table.wallMemberCount, 0)
})

// 7. Sample lying on wall plane but with perpendicular normal (shelf face / curtain fold) receives NON_WALL or UNCERTAIN.
test('7. Sample with incompatible normal receives NON_WALL or UNCERTAIN', () => {
  const wall = patch('wall-a')
  const samples = [surfel(1, 1.0, 1.0, 0.01, { x: 1, y: 0, z: 0 })] // normal perpendicular to wall
  const table = association.associateRealitySurfels(samples, [wall])
  assert.notEqual(table.memberships[0], 1, 'Incompatible normal must NOT be WALL_MEMBER')
})

// 8. Uncertain sample keeps original RGB (is NOT tinted in Design mode).
test('8. Uncertain sample keeps original RGB and is never tinted in Design mode', () => {
  const wall = patch('wall-a')
  const samples = [
    surfel(1, 1.0, 1.0, 0.005, { x: 0, y: 0, z: 1 }), // wall member
    surfel(2, 1.0, 1.0, 0.08, { x: 0, y: 0, z: 1 }),  // non-wall
  ]
  const table = association.associateRealitySurfels(samples, [wall])
  const colors = association.buildRealityDesignColors(samples, table, [{ surfaceId: 'wall-a', paintColor: '#3388ff' }])
  assert.ok(colors.has(1), 'Wall member receives design color')
  assert.equal(colors.has(2), false, 'Non-wall/uncertain sample preserves original RGB')
})

// 9. Close curtain-like region (residual > 0.035 m or depth step > 15 mm) does not automatically inherit wall paint.
test('9. Close curtain-like region (>0.035m residual) does not inherit wall paint', () => {
  const wall = patch('wall-a')
  const curtainSamples = [
    surfel(1, 1.0, 1.0, 0.045), // 4.5 cm in front of wall (curtain)
    surfel(2, 1.05, 1.0, 0.05),
  ]
  const table = association.associateRealitySurfels(curtainSamples, [wall])
  assert.equal(table.memberships[0], 0, 'Curtain sample must be NON_WALL')
  assert.equal(table.memberships[1], 0, 'Curtain sample must be NON_WALL')
  const colors = association.buildRealityDesignColors(curtainSamples, table, [{ surfaceId: 'wall-a', paintColor: '#ff0000' }])
  assert.equal(colors.size, 0, 'No curtain sample receives wall paint')
})

// 10. Reality tap hit on curtain / non-wall returns no editable surface / rejection reason.
test('10. Reality tap hit on curtain / non-wall is rejected', () => {
  const wall = patch('wall-a')
  const table = association.associateRealitySurfels([surfel(1, 1.0, 1.0, 0.005)], [wall])

  // Single point hit on curtain (4.5 cm offset)
  const tapHitCurtain = association.evaluateRealityTapHit({ x: 1.0, y: 1.0, z: 0.045 }, { x: 0, y: 0, z: 1 }, null, table)
  assert.equal(tapHitCurtain.accepted, false)
  assert.equal(tapHitCurtain.logicalSurfaceId, null)

  // Triangle hit where 2 of 3 vertices are curtain / non-wall
  const curtainVertices = [
    { x: 1.0, y: 1.0, z: 0.05 },
    { x: 1.05, y: 1.0, z: 0.05 },
    { x: 1.0, y: 1.0, z: 0.005 }, // 1 vertex touches wall
  ]
  const triangleTap = association.evaluateRealityTapHit(
    { x: 1.02, y: 1.0, z: 0.04 },
    { x: 0, y: 0, z: 1 },
    curtainVertices,
    table,
  )
  assert.equal(triangleTap.accepted, false)
  assert.ok(triangleTap.membershipVotes.nonWall >= 2)
  assert.ok(triangleTap.reason.includes('rejected'))
})

// 11. Reality tap hit on any member patch region resolves to the same parent logical wall.
test('11. Reality tap hit on any member patch region resolves to same parent logical wall', () => {
  const patch1 = patch('wall-p1', { offsetX: 0, width: 2 })
  const patch2 = patch('wall-p2', { offsetX: 2.1, width: 2 })
  const samples = [surfel(1, 1.0, 1.0, 0.005), surfel(2, 3.1, 1.0, 0.005)]
  const table = association.associateRealitySurfels(samples, [patch1, patch2])
  assert.equal(table.logicalSurfaces.length, 1)
  const expectedLogicalId = table.logicalSurfaces[0].id

  const tapP1 = association.evaluateRealityTapHit({ x: 1.0, y: 1.0, z: 0.005 }, { x: 0, y: 0, z: 1 }, null, table)
  assert.equal(tapP1.accepted, true)
  assert.equal(tapP1.logicalSurfaceId, expectedLogicalId)

  const tapP2 = association.evaluateRealityTapHit({ x: 3.1, y: 1.0, z: 0.005 }, { x: 0, y: 0, z: 1 }, null, table)
  assert.equal(tapP2.accepted, true)
  assert.equal(tapP2.logicalSurfaceId, expectedLogicalId)
})

// 12. Painting the logical wall colors all member patches Reality samples.
test('12. Painting logical wall colors all member patches Reality samples', () => {
  const patch1 = patch('wall-p1', { offsetX: 0, width: 2 })
  const patch2 = patch('wall-p2', { offsetX: 2.1, width: 2 })
  const samples = [surfel(1, 1.0, 1.0, 0.005), surfel(2, 3.1, 1.0, 0.005)]
  const table = association.associateRealitySurfels(samples, [patch1, patch2])
  const logicalId = table.logicalSurfaces[0].id

  // Customizing by logical wall ID
  const colorsByLogical = association.buildRealityDesignColors(samples, table, [{ surfaceId: logicalId, paintColor: '#ff0000' }])
  assert.ok(colorsByLogical.has(1), 'Sample on patch 1 is colored')
  assert.ok(colorsByLogical.has(2), 'Sample on patch 2 is colored')
  assert.ok(colorsByLogical.get(1).r > colorsByLogical.get(1).b)
  assert.ok(colorsByLogical.get(2).r > colorsByLogical.get(2).b)

  // Customizing by member patch ID also propagates to entire logical wall
  const colorsByMember = association.buildRealityDesignColors(samples, table, [{ surfaceId: 'wall-p1', paintColor: '#00ff00' }])
  assert.ok(colorsByMember.has(1))
  assert.ok(colorsByMember.has(2))
  assert.ok(colorsByMember.get(1).g > colorsByMember.get(1).r)
  assert.ok(colorsByMember.get(2).g > colorsByMember.get(2).r)
})

// 13. Painting one logical wall does NOT touch another logical wall.
test('13. Painting one logical wall does NOT touch another logical wall', () => {
  const wallNorth = patch('wall-north', { offsetX: 0, offsetZ: 0, planeConstant: 0 })
  const wallSouth = patch('wall-south', { offsetX: 0, offsetZ: 3.0, planeConstant: 3.0 })
  const samples = [surfel(1, 1.0, 1.0, 0.005), surfel(2, 1.0, 1.0, 3.005)]
  const table = association.associateRealitySurfels(samples, [wallNorth, wallSouth])
  assert.equal(table.logicalSurfaces.length, 2)

  const colors = association.buildRealityDesignColors(samples, table, [{ surfaceId: 'wall-north', paintColor: '#0000ff' }])
  assert.ok(colors.has(1), 'North wall sample is colored')
  assert.equal(colors.has(2), false, 'South wall sample is NOT colored')
})

// 14. Original captured RGB data remains 100% immutable throughout all tests.
test('14. Original captured RGB data remains 100% immutable', () => {
  const samples = [surfel(1, 1.0, 1.0, 0.005), surfel(2, 1.0, 1.0, 0.08)]
  const originalJson = JSON.stringify(samples)
  const wall = patch('wall-a')

  const table = association.associateRealitySurfels(samples, [wall])
  association.buildRealityDesignColors(samples, table, [{ surfaceId: 'wall-a', paintColor: '#123456' }])
  association.buildRealityDesignColors(samples, table, [], 'wall-mask')
  association.buildRealityDesignColors(samples, table, [], 'logical-wall')
  association.buildRealityDesignColors(samples, table, [], 'patch')

  assert.equal(JSON.stringify(samples), originalJson, 'Original Reality surfels must remain completely unmodified')
})

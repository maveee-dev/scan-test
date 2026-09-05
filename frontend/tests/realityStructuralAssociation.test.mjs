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
const structuralInterpretation = await import(moduleUrl(new URL('../src/features/room-analysis/services/structuralSurfaceInterpretationService.ts', import.meta.url)))
const compositor = await import(moduleUrl(new URL('../src/features/scanner/services/realityDesignCompositingService.ts', import.meta.url)))
const triangleAssociation = await import(moduleUrl(new URL('../src/features/scanner/services/realityWallTriangleAssociationService.ts', import.meta.url)))

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

function ceilingPatch(id = 'ceiling-a') {
  const y = 2
  return {
    ...patch(id, { normal: { x: 0, y: 1, z: 0 }, planeConstant: y, role: 'ceiling' }),
    vertices3D: [{ x: 0, y, z: 0 }, { x: 2, y, z: 0 }, { x: 2, y, z: 2 }, { x: 0, y, z: 2 }],
    vertices2DLocal: [{ u: 0, v: 0 }, { u: 2, v: 0 }, { u: 2, v: 2 }, { u: 0, v: 2 }],
    basis: {
      origin: { x: 0, y, z: 0 },
      axisU: { x: 1, y: 0, z: 0 },
      axisV: { x: 0, y: 0, z: 1 },
    },
  }
}

function clusteredWallSamples({ badCenterNormal = false } = {}) {
  const result = []
  let id = 1
  for (const y of [0.9, 0.92, 0.94]) {
    for (const x of [0.9, 0.92, 0.94]) {
      const center = Math.abs(x - 0.92) < 0.001 && Math.abs(y - 0.92) < 0.001
      result.push(surfel(id++, x, y, 0.006, center && badCenterNormal ? { x: 0.75, y: 0, z: 0.66 } : { x: 0, y: 0, z: 1 }))
    }
  }
  return result
}

function structuralPlane(id, {
  normal,
  planeConstant = 0,
  area = 4,
  support = 800,
  rmsError = 0.012,
  min = { x: 0, y: 0, z: 0 },
  max = { x: 3, y: 2.4, z: 0.04 },
} = {}) {
  const tangentU = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const tangentV = Math.abs(normal.y) < 0.9
    ? { x: normal.z, y: 0, z: -normal.x }
    : { x: 0, y: 0, z: 1 }
  return {
    id,
    normal,
    centroid: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
    planeConstant,
    supportPointCount: support,
    areaEstimate: area,
    projectedBoundsAreaEstimate: area,
    rmsError,
    bounds: { min, max },
    localBounds: { minU: 0, maxU: 3, minV: 0, maxV: 2.4 },
    tangentU,
    tangentV,
    orientationAngleDegrees: 90,
    orientationCategory: Math.abs(normal.y) < 0.2 ? 'vertical-like' : 'horizontal-like',
    confidence: 0.9,
  }
}

function interpretationInput(planes) {
  return {
    sourceScanId: 'synthetic-structural-scan',
    planes,
    surfaceConsensus: planes.map((plane) => ({
      consensusId: `consensus-${plane.id}`,
      finalPlaneId: plane.id,
      memberFamilyIds: [],
      memberPlaneIds: [plane.id],
      totalDepthSpanMeters: 0.01,
      representativePlaneId: plane.id,
      directRepresentativeSupport: plane.supportPointCount,
      absorbedLayerSupport: 0,
      finalOwnedSupport: plane.supportPointCount,
      finalOwnedAreaEstimate: plane.areaEstimate,
      representativeRmsError: plane.rmsError,
    })),
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

// 15. A bad individual depth normal may expand when its bounded local wall
// neighborhood supplies a strong plane-normal consensus.
test('15. Noisy planar wall normal expands from strict local core', () => {
  const samples = clusteredWallSamples({ badCenterNormal: true })
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  const center = samples[4]
  const index = samples.findIndex((sample) => sample.id === center.id)
  assert.equal(table.memberships[index], association.RealityMembershipCode.EXPANDED_WALL_MEMBER)
  assert.ok(table.coreWallMemberCount >= 6)
  assert.ok(table.expandedWallMemberCount >= 1)
})

// 16. The same evidence model is orientation independent: ceiling samples do
// not depend on a vertical-wall axis assumption.
test('16. Noisy planar ceiling expands identically to a wall', () => {
  const ceiling = ceilingPatch()
  const samples = []
  let id = 1
  for (const z of [0.9, 0.92, 0.94]) {
    for (const x of [0.9, 0.92, 0.94]) {
      const center = Math.abs(x - 0.92) < 0.001 && Math.abs(z - 0.92) < 0.001
      samples.push(surfel(id++, x, 2.006, z, center ? { x: 0.7, y: 0.7, z: 0 } : { x: 0, y: 1, z: 0 }))
    }
  }
  const table = association.associateRealitySurfels(samples, [ceiling])
  assert.equal(table.memberships[4], association.RealityMembershipCode.EXPANDED_WALL_MEMBER)
  assert.equal(table.logicalSurfaces[0].role, 'ceiling')
})

// 17. Logical member-patch union allows two observed fragments of one wall to
// share a paint identity without turning the unobserved opening into geometry.
test('17. Continuous logical member patches share expanded paint domain', () => {
  const first = patch('wall-a', { offsetX: 0, width: 1 })
  const second = patch('wall-b', { offsetX: 1.05, width: 1 })
  const samples = [
    ...clusteredWallSamples(),
    ...clusteredWallSamples().map((sample, index) => surfel(100 + index, sample.position.x + 1.05, sample.position.y, sample.position.z)),
  ]
  const table = association.associateRealitySurfels(samples, [first, second])
  assert.equal(table.logicalSurfaces.length, 1)
  const colors = association.buildRealityDesignColors(samples, table, [{ surfaceId: table.logicalSurfaces[0].id, paintColor: '#3366cc' }])
  assert.equal(colors.size, samples.length)
})

// 18. A lone noisy point does not become paintable merely because it lies in a
// structural polygon; it is explicitly UNCERTAIN instead of default NON_WALL.
test('18. Isolated plausible noisy sample remains uncertain, not wall-member', () => {
  const table = association.associateRealitySurfels([surfel(1, 1, 1, 0.02, { x: 1, y: 0, z: 0 })], [patch('wall-a')])
  assert.equal(table.memberships[0], association.RealityMembershipCode.UNCERTAIN)
})

// 19. A close curtain with a wall-like normal is protected by the measured
// out-of-plane step; it cannot grow from the wall core.
test('19. Close wall-like curtain blocks propagation', () => {
  const samples = [
    ...clusteredWallSamples(),
    surfel(50, 0.95, 0.92, 0.028),
    surfel(51, 0.97, 0.92, 0.028),
  ]
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  const curtainIndexes = [50, 51].map((id) => samples.findIndex((sample) => sample.id === id))
  for (const index of curtainIndexes) assert.equal(association.isPaintableRealityMembership(table.memberships[index]), false)
})

// 20. Large depth discontinuities remain hard barriers and are classified as
// positive foreground evidence rather than receiving design paint.
test('20. Large depth discontinuity remains non-wall', () => {
  const samples = [...clusteredWallSamples(), surfel(90, 0.96, 0.92, 0.06)]
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  assert.equal(table.memberships[samples.length - 1], association.RealityMembershipCode.NON_WALL)
})

// 21. A disconnected coplanar component without structural seed support is
// uncertain rather than painted across a large empty region.
test('21. Disconnected coplanar component is not painted', () => {
  const wall = patch('wall-a', { width: 4 })
  const structuralSupport = [{ position: { x: 1, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } }]
  const samples = [surfel(1, 1, 1, 0.006), surfel(2, 3.5, 1, 0.006)]
  const table = association.associateRealitySurfels(samples, [wall], structuralSupport)
  assert.equal(table.memberships[0], association.RealityMembershipCode.CORE_WALL_MEMBER)
  assert.equal(table.memberships[1], association.RealityMembershipCode.UNCERTAIN)
})

// 22. Core and expanded classifications both paint; uncertain/non-wall keep
// original RGB and therefore cannot mutate the Reality Original snapshot.
test('22. Core and expanded paint while uncertain and non-wall preserve RGB', () => {
  const samples = [...clusteredWallSamples({ badCenterNormal: true }), surfel(90, 1.5, 1, 0.02, { x: 1, y: 0, z: 0 }), surfel(91, 1.6, 1, 0.06)]
  const original = JSON.stringify(samples)
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  const colors = association.buildRealityDesignColors(samples, table, [{ surfaceId: 'logical-wall-1', paintColor: '#ff0033' }])
  assert.ok(colors.has(samples[0].id))
  assert.ok(colors.has(samples[4].id))
  assert.equal(colors.has(90), false)
  assert.equal(colors.has(91), false)
  assert.equal(JSON.stringify(samples), original)
})

// 23. Expanded geometry is selectable; nearby foreground/non-wall geometry is
// still rejected by the same membership lookup used by triangle voting.
test('23. Expanded wall tap is accepted and foreground tap is rejected', () => {
  const samples = clusteredWallSamples({ badCenterNormal: true })
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  const center = samples[4].position
  const expandedTap = association.evaluateRealityTapHit(center, { x: 0, y: 0, z: 1 }, null, table)
  assert.equal(expandedTap.accepted, true)
  const curtainTap = association.evaluateRealityTapHit({ x: center.x, y: center.y, z: 0.06 }, { x: 0, y: 0, z: 1 }, null, table)
  assert.equal(curtainTap.accepted, false)
})

function offsetWallSamples(offset, { startX = 0.9, startY = 0.9, idStart = 200 } = {}) {
  const samples = []
  let id = idStart
  for (const y of [startY, startY + 0.02, startY + 0.04]) {
    for (const x of [startX, startX + 0.02, startX + 0.04]) {
      samples.push(surfel(id++, x, y, offset))
    }
  }
  return samples
}

// 24. A coherent +3.5 cm dense Reality offset is calibrated only as a
// derived membership reference and restores paintability without moving M7.
test('24. Systematic dense Reality offset derives membership reference', () => {
  const samples = offsetWallSamples(0.035)
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  const diagnostic = table.perLogicalSurface[0]
  assert.equal(diagnostic.membershipReferenceApplied, true)
  assert.ok(Math.abs(diagnostic.membershipReferenceOffsetMeters - 0.035) < 0.008)
  assert.equal(table.wallMemberCount, samples.length)
})

// 25. A parallel curtain at +6 cm does not drag calibration or receive paint
// when the coherent wall mode is at +3.5 cm.
test('25. Disconnected +6 cm curtain remains excluded after calibration', () => {
  const wallSamples = offsetWallSamples(0.035)
  const curtainSamples = offsetWallSamples(0.06, { startX: 1.4, idStart: 300 })
  const samples = [...wallSamples, ...curtainSamples]
  const table = association.associateRealitySurfels(samples, [patch('wall-a', { width: 2 })])
  const colors = association.buildRealityDesignColors(samples, table, [{ surfaceId: 'wall-a', paintColor: '#3366cc' }])
  assert.equal(colors.size, wallSamples.length)
  for (const sample of curtainSamples) assert.equal(colors.has(sample.id), false)
})

// 26. Dense measured support can extend slightly past a partial M7.4 patch,
// but only through an actual local chain from an observed calibrated core.
test('26. Connected observed Reality extends slightly beyond patch support', () => {
  const wall = patch('wall-a', { width: 1 })
  const inside = offsetWallSamples(0.035, { startX: 0.9 })
  const extension = offsetWallSamples(0.035, { startX: 1.02, idStart: 400 })
  const samples = [...inside, ...extension]
  const table = association.associateRealitySurfels(samples, [wall])
  const diagnostic = table.perLogicalSurface[0]
  assert.ok(diagnostic.outsidePatchCandidateCount > 0)
  assert.ok(diagnostic.outsidePatchExpandedCount > 0)
  const colors = association.buildRealityDesignColors(samples, table, [{ surfaceId: 'wall-a', paintColor: '#00aa55' }])
  assert.ok(colors.has(extension[0].id))
})

// 27. A coplanar exterior component without a connected observation chain is
// not painted simply because it lies near the derived reference plane.
test('27. Disconnected exterior coplanar Reality remains unpainted', () => {
  const wall = patch('wall-a', { width: 1 })
  const inside = offsetWallSamples(0.035, { startX: 0.9 })
  const outside = offsetWallSamples(0.035, { startX: 1.5, idStart: 500 })
  const samples = [...inside, ...outside]
  const table = association.associateRealitySurfels(samples, [wall])
  const colors = association.buildRealityDesignColors(samples, table, [{ surfaceId: 'wall-a', paintColor: '#00aa55' }])
  for (const sample of outside) assert.equal(colors.has(sample.id), false)
})

// 28. Independently strong wall planes must not remain alternates solely
// because a room graph/triad happened to select a different wall first.
test('28. Strong standalone walls survive without a closed-room triad', () => {
  const planes = [
    structuralPlane('plane-1', {
      normal: { x: 0, y: 0, z: 1 },
      area: 4.65,
      support: 1042,
      min: { x: 0, y: 0, z: 0 }, max: { x: 3.2, y: 2.4, z: 0.02 },
    }),
    structuralPlane('plane-2', {
      normal: { x: 1, y: 0, z: 0 },
      planeConstant: 2.4,
      area: 3.03,
      support: 526,
      min: { x: 2.38, y: 0, z: 0 }, max: { x: 2.42, y: 2.4, z: 2.1 },
    }),
    structuralPlane('plane-3', {
      normal: { x: 0.707, y: 0, z: 0.707 },
      planeConstant: 1.8,
      area: 2.61,
      support: 407,
      min: { x: -1.1, y: 0, z: 1.4 }, max: { x: 1.1, y: 2.4, z: 3.0 },
    }),
    structuralPlane('cabinet-face', {
      normal: { x: -1, y: 0, z: 0 },
      planeConstant: -0.8,
      area: 0.42,
      support: 88,
      min: { x: 0.78, y: 0.4, z: 0.5 }, max: { x: 0.82, y: 1.3, z: 1.0 },
    }),
  ]
  const service = new structuralInterpretation.StructuralSurfaceInterpretationService()
  const result = service.interpret(interpretationInput(planes), 'local-floor')
  const selectedIds = new Set(result.selectedWalls.map((surface) => surface.planeId))

  assert.deepEqual(selectedIds, new Set(['plane-1', 'plane-2', 'plane-3']))
  assert.equal(result.stats.promotedStrongStandaloneWallCount, 2)
  assert.equal(selectedIds.has('cabinet-face'), false)
  assert.match(
    result.surfaces.find((surface) => surface.planeId === 'plane-3').selectionReason,
    /strong standalone wall/i,
  )
})

function compositedWallPlan(samples, patches, inputs = [{ surfaceId: 'wall-a', paintColor: '#2266dd' }], mode = 'composite') {
  const table = association.associateRealitySurfels(samples, patches)
  return {
    table,
    plan: compositor.buildRealityDesignCompositePlan(samples, table, inputs, mode),
  }
}

// 29. Design uses the bounded structural patch even when the old member mask
// is sparse: same-wall Reality is hidden instead of deciding paint coverage.
test('29. Structural Design paints trusted samples while unresolved sparse samples stay preserved', () => {
  const samples = [
    surfel(1, 0.9, 0.9, 0.006),
    surfel(2, 1.2, 1.2, 0.02, { x: 0.3, y: 0, z: 0.95 }),
  ]
  const { plan } = compositedWallPlan(samples, [patch('wall-a')])
  assert.deepEqual(plan.structuralPatchIds, ['wall-a'])
  assert.equal(plan.visibilityMask[0], 0)
  assert.equal(plan.visibilityMask[1], 1)
  assert.ok(plan.stats.realityMaskedSampleCount >= 1)
})

// 30. Original wall measurements never draw their captured RGB over the
// structural paint layer in the final composite.
test('30. Same-wall Reality samples are suppressed beneath structural paint', () => {
  const samples = clusteredWallSamples()
  const { plan } = compositedWallPlan(samples, [patch('wall-a')])
  assert.equal([...plan.visibilityMask].every((visible) => visible === 0), true)
  assert.equal(plan.stats.realityMaskedSampleCount, samples.length)
})

// 31. A curtain five centimetres in front is positive foreground evidence and
// remains visible above the structural wall rather than being painted over.
test('31. Close curtain foreground remains visible over structural paint', () => {
  const samples = [...clusteredWallSamples(), surfel(90, 0.92, 0.92, 0.05)]
  const { table, plan } = compositedWallPlan(samples, [patch('wall-a')])
  assert.equal(table.foregroundMask[samples.length - 1], 1)
  assert.equal(plan.visibilityMask[samples.length - 1], 1)
  assert.equal(plan.classifications[samples.length - 1], compositor.RealityDesignCompositeClassification.FOREGROUND_OBJECT)
})

// 32. A clearly offset cabinet face is also retained as foreground Reality.
test('32. Cabinet foreground remains visible over structural paint', () => {
  const samples = [...clusteredWallSamples(), surfel(91, 1.1, 1.0, 0.08, { x: 0, y: 0, z: 1 })]
  const { plan } = compositedWallPlan(samples, [patch('wall-a')])
  assert.equal(plan.visibilityMask[samples.length - 1], 1)
})

// 33. Independent walls receive independent structural Design patches; Wall B
// remains original Reality when only Wall A has a paint input.
test('33. Adjacent uncustomized wall stays outside Wall A composite domain', () => {
  const wallA = patch('wall-a', { offsetX: 0, width: 2 })
  const wallB = patch('wall-b', { offsetZ: 3, planeConstant: 3, width: 2 })
  const samples = [surfel(1, 1, 1, 0.006), surfel(2, 1, 1, 3.006)]
  const { plan } = compositedWallPlan(samples, [wallA, wallB], [{ surfaceId: 'wall-a', paintColor: '#2266dd' }])
  assert.equal(plan.visibilityMask[0], 0)
  assert.equal(plan.visibilityMask[1], 1)
  assert.deepEqual(plan.structuralPatchIds, ['wall-a'])
})

// 34. The same structural-depth compositor works for horizontal surfaces.
test('34. Ceiling structural Design suppresses same-surface Reality', () => {
  const ceiling = ceilingPatch()
  const samples = [surfel(1, 0.9, 2.006, 0.9, { x: 0, y: 1, z: 0 })]
  const table = association.associateRealitySurfels(samples, [ceiling])
  const plan = compositor.buildRealityDesignCompositePlan(samples, table, [{ surfaceId: 'ceiling-a', paintColor: '#3355ee' }])
  assert.equal(plan.visibilityMask[0], 0)
  assert.deepEqual(plan.structuralPatchIds, ['ceiling-a'])
})

// 35. Debug views are derived only: Original data remains immutable and the
// foreground-only view never includes the structural wall samples.
test('35. Original Reality data is unchanged across compositing modes', () => {
  const samples = [...clusteredWallSamples(), surfel(99, 0.92, 0.92, 0.08)]
  const original = JSON.stringify(samples)
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  const foreground = compositor.buildRealityDesignCompositePlan(samples, table, [{ surfaceId: 'wall-a', paintColor: '#2266dd' }], 'foreground-only')
  const classification = compositor.buildRealityDesignCompositePlan(samples, table, [{ surfaceId: 'wall-a', paintColor: '#2266dd' }], 'classification')
  assert.equal(foreground.visibilityMask[samples.length - 1], 1)
  assert.equal(foreground.visibilityMask[0], 0)
  assert.equal(classification.visibilityMask.every((visible) => visible === 1), true)
  assert.equal(JSON.stringify(samples), original)
})

// 36. Multiple customized logical walls produce separate bounded structural
// layers, while their own same-wall Reality samples are independently hidden.
test('36. Multiple differently painted walls keep independent compositor domains', () => {
  const wallA = patch('wall-a', { offsetX: 0, width: 2 })
  const wallB = patch('wall-b', { offsetZ: 3, planeConstant: 3, width: 2 })
  const samples = [surfel(1, 1, 1, 0.006), surfel(2, 1, 1, 3.006)]
  const table = association.associateRealitySurfels(samples, [wallA, wallB])
  const plan = compositor.buildRealityDesignCompositePlan(samples, table, [
    { surfaceId: 'wall-a', paintColor: '#2266dd' },
    { surfaceId: 'wall-b', paintColor: '#d7a35c' },
  ])
  assert.deepEqual(new Set(plan.structuralPatchIds), new Set(['wall-a', 'wall-b']))
  assert.equal(plan.visibilityMask[0], 0)
  assert.equal(plan.visibilityMask[1], 0)
  assert.equal(plan.stats.surfaces.length, 2)
})

// M8.5.5: structural material is continuous where measured wall support is
// exposed, while a locally coherent shallow component is retained as Reality.
test('37. Visible paintable mask keeps broad exposed wall paintable', () => {
  const samples = clusteredWallSamples()
  const { plan } = compositedWallPlan(samples, [patch('wall-a')])
  const mask = plan.masks[0]
  assert.ok(mask.paintableAreaMetersSquared > 0)
  assert.equal(mask.preservedAreaMetersSquared, 0)
  assert.equal([...plan.visibilityMask].every((visible) => visible === 0), true)
})

test('38. Shallow attached component with geometric and RGB support remains preserved', () => {
  const attachedColor = { r: 0.06, g: 0.12, b: 0.86 }
  const samples = [
    ...clusteredWallSamples(),
    surfel(201, 1.15, 1.10, 0.025, { x: 0, y: 0, z: 1 }, attachedColor),
    surfel(202, 1.18, 1.10, 0.025, { x: 0, y: 0, z: 1 }, attachedColor),
    surfel(203, 1.15, 1.13, 0.025, { x: 0, y: 0, z: 1 }, attachedColor),
  ]
  const { plan } = compositedWallPlan(samples, [patch('wall-a')])
  for (let index = samples.length - 3; index < samples.length; index++) {
    assert.equal(plan.classifications[index], compositor.RealityDesignCompositeClassification.ATTACHED_OR_NEAR_WALL_OBJECT)
    assert.equal(plan.visibilityMask[index], 1)
  }
  assert.ok(plan.masks[0].preservedAreaMetersSquared > 0)
})

test('39. RGB difference alone does not erase an otherwise exposed wall', () => {
  const samples = [...clusteredWallSamples(), surfel(210, 1.2, 1.2, 0.006, { x: 0, y: 0, z: 1 }, { r: 0.95, g: 0.08, b: 0.12 })]
  const { plan } = compositedWallPlan(samples, [patch('wall-a')])
  assert.notEqual(plan.classifications[samples.length - 1], compositor.RealityDesignCompositeClassification.ATTACHED_OR_NEAR_WALL_OBJECT)
  assert.notEqual(plan.classifications[samples.length - 1], compositor.RealityDesignCompositeClassification.FOREGROUND_OBJECT)
})

test('40. Unsupported wall-local regions remain unpainted rather than fabricated', () => {
  const { plan } = compositedWallPlan(clusteredWallSamples(), [patch('wall-a')])
  assert.ok(plan.masks[0].unsupportedAreaMetersSquared > 0)
})

test('41. Mask topology is deterministic and independent of paint color', () => {
  const samples = [...clusteredWallSamples(), surfel(220, 1.1, 1.1, 0.05)]
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  const blue = compositor.buildRealityDesignCompositePlan(samples, table, [{ surfaceId: 'wall-a', paintColor: '#1565d8' }])
  const beige = compositor.buildRealityDesignCompositePlan(samples, table, [{ surfaceId: 'wall-a', paintColor: '#e2c18c' }])
  assert.deepEqual([...blue.masks[0].paintableCells], [...beige.masks[0].paintableCells])
  assert.deepEqual([...blue.masks[0].preservedCells], [...beige.masks[0].preservedCells])
})

test('42. Ceiling paintable mask uses wall-local coordinates without vertical assumptions', () => {
  const ceiling = ceilingPatch()
  const samples = [surfel(301, 0.9, 2.006, 0.9, { x: 0, y: 1, z: 0 })]
  const table = association.associateRealitySurfels(samples, [ceiling])
  const plan = compositor.buildRealityDesignCompositePlan(samples, table, [{ surfaceId: 'ceiling-a', paintColor: '#3355ee' }])
  assert.ok(plan.masks[0].paintableAreaMetersSquared > 0)
  assert.equal(plan.visibilityMask[0], 0)
})

function triangleTopology(ids) {
  return { vertexSurfelIds: new Uint32Array(ids), triangleCount: ids.length / 3 }
}

function trianglePlan(samples, patches, topology) {
  const table = association.associateRealitySurfels(samples, patches)
  const mask = compositor.buildRealityDesignCompositePlan(samples, table, patches.map((item) => ({ surfaceId: item.id, paintColor: '#2468d8' })))
  return { table, mask, result: triangleAssociation.associateRealityWallTriangles(samples, topology, table, mask.classifications) }
}

test('43. Connected planar Reality triangles form one wall component with original positions', () => {
  const samples = clusteredWallSamples()
  const source = JSON.stringify(samples.map((sample) => sample.position))
  const { result } = trianglePlan(samples, [patch('wall-a')], triangleTopology([1, 2, 4, 2, 5, 4]))
  assert.equal(result.logicalSurfaceIndices[0], 0)
  assert.equal(result.logicalSurfaceIndices[1], 0)
  assert.equal(result.componentIds[0], result.componentIds[1])
  assert.equal(JSON.stringify(samples.map((sample) => sample.position)), source)
})

test('44. Offset object triangle breaks Reality wall component growth', () => {
  const samples = [...clusteredWallSamples(), surfel(401, 1.2, 1.1, 0.08), surfel(402, 1.25, 1.1, 0.08), surfel(403, 1.2, 1.15, 0.08)]
  const { result } = trianglePlan(samples, [patch('wall-a')], triangleTopology([1, 2, 4, 401, 402, 403]))
  assert.equal(result.logicalSurfaceIndices[0], 0)
  assert.equal(result.logicalSurfaceIndices[1], -1)
})

test('45. Sharp normal boundary does not become a wall triangle component', () => {
  const samples = [...clusteredWallSamples(), surfel(411, 1.2, 1.1, 0.01, { x: 1, y: 0, z: 0 }), surfel(412, 1.25, 1.1, 0.01, { x: 1, y: 0, z: 0 }), surfel(413, 1.2, 1.15, 0.01, { x: 1, y: 0, z: 0 })]
  const { result } = trianglePlan(samples, [patch('wall-a')], triangleTopology([1, 2, 4, 411, 412, 413]))
  assert.equal(result.logicalSurfaceIndices[1], -1)
})

test('46. Disconnected observed pieces retain one logical wall identity without fake bridging', () => {
  const samples = [...clusteredWallSamples(), ...clusteredWallSamples().map((sample) => ({ ...sample, id: sample.id + 100, position: { ...sample.position, x: sample.position.x + 0.7 } }))]
  const { result } = trianglePlan(samples, [patch('wall-a')], triangleTopology([1, 2, 4, 101, 102, 104]))
  assert.equal(result.logicalSurfaceIndices[0], 0)
  assert.equal(result.logicalSurfaceIndices[1], 0)
  assert.notEqual(result.componentIds[0], result.componentIds[1])
})

test('47. Ceiling triangle association has no vertical-wall assumption', () => {
  const ceiling = ceilingPatch()
  const samples = [
    surfel(501, 0.9, 2.006, 0.9, { x: 0, y: 1, z: 0 }),
    surfel(502, 1.0, 2.006, 0.9, { x: 0, y: 1, z: 0 }),
    surfel(503, 0.9, 2.006, 1.0, { x: 0, y: 1, z: 0 }),
  ]
  const { result } = trianglePlan(samples, [ceiling], triangleTopology([501, 502, 503]))
  assert.equal(result.logicalSurfaceIndices[0], 0)
})

test('48. Triangle paint changes only a derived GPU color buffer', () => {
  const samples = clusteredWallSamples()
  const { table, result } = trianglePlan(samples, [patch('wall-a')], triangleTopology([1, 2, 4]))
  const original = JSON.stringify(samples)
  const colors = new Float32Array(9).fill(0.5)
  triangleAssociation.applyRealityTrianglePaint(colors, samples, triangleTopology([1, 2, 4]), result, table, [{ surfaceId: 'wall-a', paintColor: '#1565d8' }])
  assert.notDeepEqual([...colors], Array(9).fill(0.5))
  assert.equal(JSON.stringify(samples), original)
})

function hitOwnershipPlan(samples, patches, topology, hitTriangle = 0, barrierMask = undefined) {
  const table = association.associateRealitySurfels(samples, patches)
  return triangleAssociation.createHitSeededVisibleRealityOwnership(samples, topology, table, hitTriangle, barrierMask)
}

test('49. Frontmost user hit becomes the visible wall component seed even when offset from the M7 plane', () => {
  const samples = [
    surfel(601, 0.5, 0.5, 0.075), surfel(602, 0.8, 0.5, 0.075), surfel(603, 0.5, 0.8, 0.075),
    // A hidden/other layer is closer to the structural plane but is not hit.
    surfel(611, 0.5, 0.5, 0.006), surfel(612, 0.8, 0.5, 0.006), surfel(613, 0.5, 0.8, 0.006),
  ]
  const result = hitOwnershipPlan(samples, [patch('wall-a')], triangleTopology([601, 602, 603, 611, 612, 613]))
  assert.ok(result.ownership)
  assert.equal(result.ownership.seedTriangleId, 0)
  assert.deepEqual([...result.ownership.triangleIndices], [0])
  assert.equal(result.ownership.logicalSurfaceId, 'logical-wall-1')
})

test('50. Hit-seeded ownership grows across shared-edge locally coherent Reality wall triangles', () => {
  const samples = [
    surfel(621, 0.5, 0.5, 0.02), surfel(622, 0.8, 0.5, 0.02), surfel(623, 0.5, 0.8, 0.02), surfel(624, 0.8, 0.8, 0.02),
  ]
  const result = hitOwnershipPlan(samples, [patch('wall-a')], triangleTopology([621, 622, 623, 622, 624, 623]))
  assert.ok(result.ownership)
  assert.deepEqual([...result.ownership.triangleIndices], [0, 1])
  assert.ok(result.ownership.areaMetersSquared > 0.08)
})

test('51. Hit-seeded wall growth stops at a sharp normal corner and another logical wall', () => {
  const samples = [
    surfel(631, 0.5, 0.5, 0.02), surfel(632, 0.8, 0.5, 0.02), surfel(633, 0.5, 0.8, 0.02),
    surfel(634, 0.8, 0.5, 0.02, { x: 1, y: 0, z: 0 }), surfel(635, 0.8, 0.8, 0.25, { x: 1, y: 0, z: 0 }), surfel(636, 0.8, 0.5, 0.45, { x: 1, y: 0, z: 0 }),
  ]
  const result = hitOwnershipPlan(samples, [patch('wall-a')], triangleTopology([631, 632, 633, 632, 635, 634]))
  assert.ok(result.ownership)
  assert.deepEqual([...result.ownership.triangleIndices], [0])
})

test('52. Foreground, curtain, and picture-barrier hit triangles are rejected rather than reassigned', () => {
  const samples = [surfel(641, 0.5, 0.5, 0.02), surfel(642, 0.8, 0.5, 0.02), surfel(643, 0.5, 0.8, 0.02)]
  const barrier = new Uint8Array(samples.length).fill(3)
  const result = hitOwnershipPlan(samples, [patch('wall-a')], triangleTopology([641, 642, 643]), 0, barrier)
  assert.equal(result.ownership, null)
  assert.match(result.reason, /foreground or attached-object/)
})

test('53. Ceiling hit ownership has no vertical-wall assumption', () => {
  const ceiling = ceilingPatch()
  const samples = [
    surfel(651, 0.5, 2.04, 0.5, { x: 0, y: 1, z: 0 }), surfel(652, 0.8, 2.04, 0.5, { x: 0, y: 1, z: 0 }), surfel(653, 0.5, 2.04, 0.8, { x: 0, y: 1, z: 0 }),
  ]
  const result = hitOwnershipPlan(samples, [ceiling], triangleTopology([651, 652, 653]))
  assert.ok(result.ownership)
  assert.equal(result.ownership.logicalSurfaceId, 'logical-ceiling-1')
})

test('54. Hit-owned triangle paint overrides a hidden automatic component for the same logical wall', () => {
  const samples = [
    surfel(661, 0.5, 0.5, 0.04), surfel(662, 0.8, 0.5, 0.04), surfel(663, 0.5, 0.8, 0.04),
    surfel(671, 0.5, 0.5, 0.006), surfel(672, 0.8, 0.5, 0.006), surfel(673, 0.5, 0.8, 0.006),
  ]
  const topology = triangleTopology([661, 662, 663, 671, 672, 673])
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  const automatic = triangleAssociation.associateRealityWallTriangles(samples, topology, table, new Uint8Array(samples.length))
  const hit = triangleAssociation.createHitSeededVisibleRealityOwnership(samples, topology, table, 0)
  assert.ok(hit.ownership)
  const colors = new Float32Array(18).fill(0.5)
  triangleAssociation.applyRealityTrianglePaint(colors, samples, topology, automatic, table, [{ surfaceId: 'wall-a', paintColor: '#1565d8' }], false, false, [hit.ownership])
  assert.notDeepEqual([...colors.slice(0, 9)], Array(9).fill(0.5))
  assert.deepEqual([...colors.slice(9)], Array(9).fill(0.5))
})

test('55. Separate compatible observed wall component may join a user-hit logical wall without filling its gap', () => {
  const samples = [
    surfel(681, 0.5, 0.5, 0.006), surfel(682, 0.8, 0.5, 0.006), surfel(683, 0.5, 0.8, 0.006),
    surfel(691, 1.2, 0.5, 0.006), surfel(692, 1.5, 0.5, 0.006), surfel(693, 1.2, 0.8, 0.006),
  ]
  const topology = triangleTopology([681, 682, 683, 691, 692, 693])
  const table = association.associateRealitySurfels(samples, [patch('wall-a')])
  const automatic = triangleAssociation.associateRealityWallTriangles(samples, topology, table, new Uint8Array(samples.length))
  const hit = triangleAssociation.createHitSeededVisibleRealityOwnership(samples, topology, table, 0, undefined, automatic)
  assert.ok(hit.ownership)
  assert.ok(hit.ownership.additionalComponentCount >= 1)
  assert.deepEqual([...hit.ownership.triangleIndices], [0, 1])
})

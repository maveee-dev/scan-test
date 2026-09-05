import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import ts from 'typescript'

// Exercise the actual renderer without a browser, GPU, or additional test dependency.
function moduleUrl(url, expose = '') {
  const compiled = ts.transpileModule(readFileSync(url, 'utf8') + expose, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from ['"]([^'"]+)['"]/g, (_match, specifier) => {
    const resolved = specifier.startsWith('.')
      ? moduleUrl(new URL(`${specifier}.ts`, url))
      : import.meta.resolve(specifier)
    return `from '${resolved}'`
  })
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
}
const renderer = await import(moduleUrl(new URL('../src/features/scanner/services/realitySurfaceRenderingService.ts', import.meta.url),
  '\nexport { buildRealityNeighborIndex, createDenseTriangleGeometry };'))

function plane(size = 32, spacing = 0.025, reverse = false, angle = 0) {
  return Array.from({ length: size * size }, (_, i) => {
    const u = (i % size) * spacing
    const v = Math.floor(i / size) * spacing
    return {
      id: reverse ? size * size - i : i,
      position: { x: u * Math.cos(angle) - v * Math.sin(angle), y: u * Math.sin(angle) + v * Math.cos(angle), z: 0 },
      normal: { x: 0, y: 0, z: 1 }, radius: 0.0125,
      colorRgb: { r: 0.7, g: 0.3, b: 0.1 }, colorSpace: 'srgb',
      geometryConfidence: 0.8, colorConfidence: 0.9, colorObservationCount: 4,
    }
  })
}
function measure(surfels) {
  const started = performance.now()
  const index = renderer.buildRealityNeighborIndex(surfels)
  const triangles = renderer.createDenseTriangleGeometry(index)
  const result = {
    samples: surfels.length, triangles: triangles.triangleCount,
    participation: triangles.coveredSurfelCount / surfels.length * 100,
    fallback: (surfels.length - triangles.coveredSurfelCount) / surfels.length * 100,
    median: index.medianNearestNeighborSpacingMeters,
    p90: index.p90NearestNeighborSpacingMeters,
    isolated: index.neighbors.filter((list) => list.length === 0).length,
    truncatedQueries: index.distribution?.truncatedQueries,
    indexMs: index.buildMs, totalMs: performance.now() - started,
    triangleBufferMiB: Object.values(triangles.geometry.attributes).reduce((sum, a) => sum + a.array.byteLength, 0) / 1048576,
  }
  triangles.geometry.dispose()
  return { result, index }
}

if (process.argv.includes('--audit')) {
  for (const [label, surfels] of [
    ['grid', plane()], ['reversed IDs', plane(32, .025, true)],
    ['rotated grid', plane(32, .025, false, .37)], ['room-scale grid', plane(170)],
    ...(process.argv.includes('--capacity') ? [['near-capacity grid', plane(244)]] : []),
  ]) console.log(label, JSON.stringify(measure(surfels).result))
} else {
  test('2.5 cm measured plane has balanced coverage independent of IDs', () => {
    const a = measure(plane())
    const b = measure(plane(32, .025, true))
    assert.equal(a.result.isolated, 0)
    assert.equal(a.result.participation, 100)
    assert.equal(b.result.participation, 100)
    assert.equal(a.result.triangles, b.result.triangles)
    assert.equal(a.result.triangles, 2 * 31 * 31)
    assert.equal(a.result.truncatedQueries, 0)
    assert.ok(Math.abs(a.result.median - .025) < 1e-6)
    assert.ok(measure(plane(32, .025, false, .37)).result.participation > 99)
  })
  test('small supported triangle is accepted; collinear samples are not', () => {
    const samples = plane(2).slice(0, 3)
    assert.equal(measure(samples).result.triangles, 1)
    samples[2].position = { x: .05, y: 0, z: 0 }
    assert.equal(measure(samples).result.triangles, 0)
  })
  test('large holes and separate foreground planes remain unconnected', () => {
    const samples = plane(24).filter((s) => s.position.x < .2 || s.position.x > .4)
    const second = samples.map((s) => ({ ...s, id: s.id + 1000, position: { ...s.position, z: .08 } }))
    const index = renderer.buildRealityNeighborIndex([...samples, ...second])
    for (let i = 0; i < index.surfels.length; i++) {
      for (const neighbor of index.neighbors[i]) {
        const a = index.surfels[i].position, b = index.surfels[neighbor.index].position
        assert.equal(a.z, b.z)
        assert.ok(Math.abs(a.x - b.x) < .12)
      }
    }
  })
  test('all comparison modes preserve measured positions/source RGB and isolate triangles', () => {
    const surfels = plane(8)
    const before = JSON.stringify(surfels)
    for (const mode of ['points', 'splats', 'triangles', 'dense']) {
      const resources = renderer.createRealitySurfaceRenderResources({ surfels }, mode)
      assert.ok(resources.stats.renderColorStatistics.max.r <= 1)
      assert.ok(resources.stats.renderColorStatistics.min.g > 0)
      if (mode === 'triangles') {
        assert.equal(resources.stats.renderedSplatCount, 0)
        assert.equal(resources.group.children.length, 1)
      }
      // Exercise the real worker-transfer/main-thread restore boundary too.
      const packed = renderer.packRealitySurface(resources)
      const buffers = [...new Set(packed.geometries.flatMap((g) => g.attributes.map((a) => a.array.buffer)))]
      const transferred = structuredClone(packed, { transfer: buffers })
      const restored = renderer.restoreRealitySurface(transferred)
      assert.equal(restored.group.children.length, resources.group.children.length)
      assert.deepEqual(restored.stats.renderColorStatistics, resources.stats.renderColorStatistics)
      for (const geometry of restored.geometries) {
        const colors = geometry.getAttribute('color')
        assert.equal(colors.itemSize, 3)
        for (let i = 0; i < colors.count; i++) {
          assert.ok(Math.abs(colors.getX(i) - ((.7 + .055) / 1.055) ** 2.4) < 1e-6)
        }
        geometry.dispose()
      }
      for (const material of restored.materials) {
        if (material.isShaderMaterial) {
          assert.equal((material.fragmentShader.match(/#include <colorspace_fragment>/g) ?? []).length, 1)
          assert.ok(!material.fragmentShader.includes('return;'), 'core cannot bypass display conversion')
          assert.equal(material.depthWrite, material.uniforms.uCorePass.value === 1)
        }
        material.dispose()
      }
      for (const geometry of resources.geometries) geometry.dispose()
      for (const material of resources.materials) material.dispose()
    }
    assert.equal(JSON.stringify(surfels), before)
  })
  test('distribution diagnostics distinguish genuine anisotropic sample rows', () => {
    const uniform = measure(plane()).index.distribution
    const rows = plane().map((s) => ({ ...s, position: { ...s.position, y: s.position.y * 2.8 } }))
    const striped = measure(rows).index.distribution
    assert.ok(Math.abs(uniform.anisotropyRatio - 1) < 1e-6)
    assert.ok(striped.anisotropyRatio > 2.5)
    assert.equal(striped.darkRgbSamples, 0)
  })
  test('empty, uncolored and single-sample scenes do not invent surfaces', () => {
    for (const surfels of [[], plane(1), plane(1).map((s) => ({ ...s, colorRgb: null }))]) {
      const result = renderer.createRealitySurfaceRenderResources({ surfels }, 'dense')
      assert.equal(result.stats.renderedTriangleCount, 0)
      for (const g of result.geometries) g.dispose()
      for (const m of result.materials) m.dispose()
    }
  })
}

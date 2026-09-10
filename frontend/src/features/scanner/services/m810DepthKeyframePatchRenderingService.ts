import type { M810DepthKeyframePatchAtlasResult } from './m810DepthKeyframePatchAtlasService'
import type { PreparedRealitySurface, RealitySurfaceRenderStats } from './realitySurfaceRenderingService'

function colorStatistics(result: M810DepthKeyframePatchAtlasResult): RealitySurfaceRenderStats['renderColorStatistics'] {
  const sampleCount = result.diagnostics.registeredColorVertexCount
  return {
    colorSpace: 'srgb',
    sampleCount,
    min: { r: 0, g: 0, b: 0 },
    max: { r: 1, g: 1, b: 1 },
    mean: { r: 0, g: 0, b: 0 },
    nonWhiteSampleCount: 0,
    uniqueApproximateColorCount: sampleCount > 0 ? 1 : 0,
  }
}

function makeStats(result: M810DepthKeyframePatchAtlasResult, useRegisteredColor: boolean): RealitySurfaceRenderStats {
  const diagnostics = result.diagnostics
  const renderedTriangleCount = diagnostics.retainedTriangleCount
  const renderedSurfelCount = diagnostics.retainedVertexCount
  const memoryBytes = result.vertices.positions.byteLength
    + result.vertices.normals.byteLength
    + (useRegisteredColor ? result.vertices.colors.byteLength : 0)
    + result.indices.byteLength
  return {
    mode: 'triangles',
    sourceSurfelCount: diagnostics.rawVertexCount,
    coloredSurfelCount: diagnostics.registeredColorVertexCount,
    renderedSurfelCount,
    renderedSplatCount: 0,
    renderedTriangleCount,
    coloredTriangleVertexCount: diagnostics.registeredColorVertexCount,
    uncoloredTriangleVertexCount: Math.max(0, renderedTriangleCount * 3 - diagnostics.registeredColorVertexCount),
    measuredUnderlaySplatCount: 0,
    fallbackSplatCount: 0,
    meshCoveredCanonicalSamples: renderedSurfelCount,
    splatCoveredCanonicalSamples: 0,
    visuallyRepresentedSamples: renderedSurfelCount,
    trulyUndisplayedSamples: Math.max(0, diagnostics.rawVertexCount - renderedSurfelCount),
    uncoloredFallbackSplatCount: 0,
    splatsSuppressedByTriangles: 0,
    visualRadiusScale: 1,
    visualFootprintKernel: 'measured-cell-rounded-square',
    renderPreparationMs: diagnostics.timings.totalMs,
    neighborIndexBuildMs: 0,
    neighborAnalysisMs: 0,
    distribution: null,
    triangleParticipantCount: renderedSurfelCount,
    triangleParticipationPercentage: diagnostics.rawVertexCount ? renderedSurfelCount / diagnostics.rawVertexCount * 100 : 0,
    fallbackPercentage: diagnostics.rawVertexCount ? Math.max(0, diagnostics.rawVertexCount - renderedSurfelCount) / diagnostics.rawVertexCount * 100 : 0,
    splatGeometryMs: 0,
    triangleGenerationMs: diagnostics.timings.m89PatchTopologyMs,
    medianNearestNeighborSpacingMeters: null,
    p90NearestNeighborSpacingMeters: null,
    estimatedSmallGapRegions: 0,
    estimatedLargeUnsupportedGaps: 0,
    trianglesRejectedByDistance: 0,
    trianglesRejectedByNormal: 0,
    trianglesRejectedByDepthLayer: 0,
    trianglesRejectedByUnsupportedNeighborhood: 0,
    triangleCandidatePairCount: diagnostics.rawTriangleCount,
    trianglesRejectedDegenerate: 0,
    trianglesRejectedAngularGap: 0,
    trianglesRejectedOccupiedCircumcircle: 0,
    triangleNonParticipantCount: Math.max(0, diagnostics.rawVertexCount - renderedSurfelCount),
    largestAcceptedTriangleEdgeMeters: 0,
    p95AcceptedTriangleEdgeMeters: 0,
    memoryBytes,
    renderColorStatistics: colorStatistics(result),
    gpuBytesEstimate: useRegisteredColor ? diagnostics.registeredColorGpuBytesEstimate : diagnostics.gpuBytesEstimate,
    drawCalls: diagnostics.drawCalls,
  }
}

/**
 * Prepare one indexed flat patch-atlas draw. This intentionally does not
 * convert vertices into FinalizedRealitySurfel objects or invoke the regular
 * surfel/triangle reconstruction path.
 */
export function createM810PatchAtlasPreparedSurface(
  result: M810DepthKeyframePatchAtlasResult,
  useRegisteredColor = false,
): PreparedRealitySurface {
  const attributes: PreparedRealitySurface['geometries'][number]['attributes'] = [
    { name: 'position', array: result.vertices.positions, itemSize: 3 },
    { name: 'normal', array: result.vertices.normals, itemSize: 3 },
  ]
  if (useRegisteredColor) attributes.push({ name: 'color', array: result.vertices.colors, itemSize: 3, normalized: true })
  return {
    geometries: [{ attributes, index: { array: result.indices, itemSize: 1 } }],
    layers: [{ geometry: 0, kind: 'm810-triangles', opacity: 1 }],
    stats: makeStats(result, useRegisteredColor),
  }
}

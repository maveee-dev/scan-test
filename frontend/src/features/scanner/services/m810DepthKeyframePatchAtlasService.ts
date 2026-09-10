/**
 * M8.10 experimental depth-keyframe patch atlas.
 *
 * This service is deliberately source-owned: every emitted vertex is copied
 * from a retained measurement and every emitted triangle is a source-grid
 * quad split produced by M8.9.  It does not infer texture/image
 * correspondences or synthesize geometry between keyframes.
 */

import {
  buildM89DepthKeyframePatches,
  type M89DepthKeyframePatchResult,
} from './m89DepthKeyframePatchService';
import type {
  RetainedRealityMeasurementFrame,
  RetainedRealityMeasurementSnapshot,
} from './retainedRealityMeasurementService';

export interface M810DepthKeyframePatchAtlasConfig {
  /** Maximum distance for a point-set/congruence duplicate comparison. */
  readonly duplicateVertexToleranceMeters?: number;
  /** Spatial bucket size for duplicate candidate lookup. */
  readonly duplicateBucketSizeMeters?: number;
  /** Spatial bucket size for non-culling overlap/conflict accounting. */
  readonly conflictBucketSizeMeters?: number;
  /** Maximum comparisons per triangle in each bounded diagnostic pass. */
  readonly maxOverlapComparisonsPerTriangle?: number;
}

export interface M810DepthKeyframePatch {
  readonly frameSequence: number;
  readonly trackingQuality: number;
  readonly rawTriangleStart: number;
  readonly rawTriangleCount: number;
  readonly retainedTriangleCount: number;
}

export interface M810DepthKeyframePatchAtlasTimings {
  readonly inputPreparationMs: number;
  readonly m89PatchTopologyMs: number;
  readonly redundancyMs: number;
  readonly packingMs: number;
  readonly totalMs: number;
}

export interface M810DepthKeyframePatchAtlasDiagnostics {
  readonly inputFrameCount: number;
  readonly inputValidSourceSampleCount: number;
  readonly usableSourceSampleCount: number;
  readonly rawVertexCount: number;
  readonly retainedVertexCount: number;
  readonly rawTriangleCount: number;
  readonly retainedTriangleCount: number;
  readonly duplicateTrianglesCulled: number;
  readonly duplicateCandidateComparisons: number;
  readonly duplicateProbeCapHits: number;
  readonly overlapConflictCandidatesOver22mm: number;
  readonly overlapConflictCandidatesOver50mm: number;
  /** Candidate pairs rejected by the bounded lateral-overlap proxy. */
  readonly overlapConflictLateralRejects: number;
  readonly overlapConflictComparisons: number;
  readonly overlapProbeCapHits: number;
  readonly sourceOwnershipViolations: number;
  readonly inventedVertexCount: number;
  readonly registeredColorVertexCount: number;
  readonly normalizedUvVertexCount: number;
  readonly rawAreaSquareMeters: number;
  readonly retainedAreaSquareMeters: number;
  readonly culledDuplicateAreaSquareMeters: number;
  readonly componentCount: number;
  readonly boundaryEdgeCount: number;
  readonly timings: M810DepthKeyframePatchAtlasTimings;
  /** Typed-array lower-bound accounting; JavaScript object overhead is unknown. */
  readonly rawPackedBytes: number;
  readonly packedBytes: number;
  readonly workingTypedBytes: number;
  readonly peakCpuTypedBytesEstimate: number;
  /** Default indexed flat triangle upload: position + normal + index; browser upload is not measured here. */
  readonly gpuBytesEstimate: number;
  /** Optional indexed flat upload if registered RGB is enabled: default estimate + color bytes. */
  readonly registeredColorGpuBytesEstimate: number;
  readonly drawCalls: number;
  readonly inputSnapshotSignature: string;
  readonly screenSpaceCoverageAvailable: false;
}

export interface M810DepthKeyframePatchAtlasResult {
  readonly vertices: {
    readonly positions: Float32Array;
    readonly normals: Float32Array;
    /** Registered per-sample RGB, three bytes per vertex; zero when unavailable. */
    readonly colors: Uint8Array;
    /** 1 when colors contains a registered sample, otherwise 0. */
    readonly colorValid: Uint8Array;
    /** Normalized source-grid coordinates, two floats per vertex. */
    readonly sourceGridUvs: Float32Array;
    readonly sourceFrameSequences: Int32Array;
    readonly sourceSampleIndices: Int32Array;
  };
  readonly indices: Uint32Array;
  readonly patches: readonly M810DepthKeyframePatch[];
  readonly diagnostics: M810DepthKeyframePatchAtlasDiagnostics;
}

const DEFAULT_CONFIG: Required<Pick<
  M810DepthKeyframePatchAtlasConfig,
  | 'duplicateVertexToleranceMeters'
  | 'duplicateBucketSizeMeters'
  | 'conflictBucketSizeMeters'
  | 'maxOverlapComparisonsPerTriangle'
>> = {
  duplicateVertexToleranceMeters: 0.0015,
  duplicateBucketSizeMeters: 0.006,
  conflictBucketSizeMeters: 0.25,
  maxOverlapComparisonsPerTriangle: 64,
};

const PERMUTATIONS = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2],
  [1, 2, 0], [2, 0, 1], [2, 1, 0],
] as const;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function bucketKey(x: number, y: number, z: number, size: number): string {
  return `${Math.floor(x / size)}:${Math.floor(y / size)}:${Math.floor(z / size)}`;
}

function addBucketNeighbourKeys(
  x: number,
  y: number,
  z: number,
  size: number,
  callback: (key: string) => void,
): void {
  const bx = Math.floor(x / size);
  const by = Math.floor(y / size);
  const bz = Math.floor(z / size);
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        callback(`${bx + dx}:${by + dy}:${bz + dz}`);
      }
    }
  }
}

function frameQuality(frame: RetainedRealityMeasurementFrame | undefined): number {
  const quality = frame?.trackingQuality ?? 0;
  return Number.isFinite(quality) ? quality : 0;
}

function buildFrameLookup(
  snapshot: RetainedRealityMeasurementSnapshot,
): Map<number, RetainedRealityMeasurementFrame> {
  const result = new Map<number, RetainedRealityMeasurementFrame>();
  for (const frame of snapshot.frames) result.set(frame.sequence, frame);
  return result;
}

function buildColorLookup(frame: RetainedRealityMeasurementFrame): Map<number, number> {
  const result = new Map<number, number>();
  const count = Math.min(
    frame.colorSourceIndices.length,
    Math.floor(frame.srgbColors.length / 3),
  );
  for (let slot = 0; slot < count; slot += 1) {
    const sourceIndex = frame.colorSourceIndices[slot];
    if (!result.has(sourceIndex)) result.set(sourceIndex, slot);
  }
  return result;
}

function triangleCentroid(
  positions: Float32Array,
  triangles: Uint32Array,
  triangleIndex: number,
): [number, number, number] {
  const offset = triangleIndex * 3;
  const a = triangles[offset] * 3;
  const b = triangles[offset + 1] * 3;
  const c = triangles[offset + 2] * 3;
  return [
    (positions[a] + positions[b] + positions[c]) / 3,
    (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3,
    (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3,
  ];
}

function triangleArea(
  positions: Float32Array,
  triangles: Uint32Array,
  triangleIndex: number,
): number {
  const offset = triangleIndex * 3;
  const a = triangles[offset] * 3;
  const b = triangles[offset + 1] * 3;
  const c = triangles[offset + 2] * 3;
  const abx = positions[b] - positions[a];
  const aby = positions[b + 1] - positions[a + 1];
  const abz = positions[b + 2] - positions[a + 2];
  const acx = positions[c] - positions[a];
  const acy = positions[c + 1] - positions[a + 1];
  const acz = positions[c + 2] - positions[a + 2];
  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;
  return 0.5 * Math.hypot(crossX, crossY, crossZ);
}

function triangleExtent(
  positions: Float32Array,
  triangles: Uint32Array,
  triangleIndex: number,
): number {
  const offset = triangleIndex * 3;
  const a = triangles[offset] * 3;
  const b = triangles[offset + 1] * 3;
  const c = triangles[offset + 2] * 3;
  const ab = Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]);
  const bc = Math.hypot(positions[c] - positions[b], positions[c + 1] - positions[b + 1], positions[c + 2] - positions[b + 2]);
  const ca = Math.hypot(positions[a] - positions[c], positions[a + 1] - positions[c + 1], positions[a + 2] - positions[c + 2]);
  return Math.max(ab, bc, ca);
}

function averagedNormal(normals: Float32Array, triangles: Uint32Array, triangleIndex: number): [number, number, number] {
  const offset = triangleIndex * 3;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let corner = 0; corner < 3; corner += 1) {
    const source = triangles[offset + corner] * 3;
    x += normals[source];
    y += normals[source + 1];
    z += normals[source + 2];
  }
  const length = Math.hypot(x, y, z);
  if (length <= 1e-9) return [0, 0, 0];
  return [x / length, y / length, z / length];
}

function pointSetMatches(
  positions: Float32Array,
  triangles: Uint32Array,
  candidate: number,
  existing: number,
  toleranceSquared: number,
): boolean {
  const candidateOffset = candidate * 3;
  const existingOffset = existing * 3;
  for (const permutation of PERMUTATIONS) {
    let matches = true;
    for (let corner = 0; corner < 3; corner += 1) {
      const a = triangles[candidateOffset + corner] * 3;
      const b = triangles[existingOffset + permutation[corner]] * 3;
      const dx = positions[a] - positions[b];
      const dy = positions[a + 1] - positions[b + 1];
      const dz = positions[a + 2] - positions[b + 2];
      if (dx * dx + dy * dy + dz * dz > toleranceSquared) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function sumByteLengths(...arrays: readonly ArrayBufferView[]): number {
  let total = 0;
  for (const array of arrays) total += array.byteLength;
  return total;
}

/**
 * Build an M8.10 patch atlas from the retained measurement snapshot.
 *
 * The optional signature is supplied by the worker so the result can prove
 * that baseline and candidate consumed the same transferred snapshot.
 */
export function buildM810DepthKeyframePatchAtlas(
  snapshot: RetainedRealityMeasurementSnapshot,
  inputSnapshotSignature = '',
  config: M810DepthKeyframePatchAtlasConfig = {},
): M810DepthKeyframePatchAtlasResult {
  const totalStart = performance.now();
  const duplicateTolerance = Math.min(0.0015, Math.max(0, config.duplicateVertexToleranceMeters ?? DEFAULT_CONFIG.duplicateVertexToleranceMeters));
  const duplicateBucketSize = Math.max(0.0015, config.duplicateBucketSizeMeters ?? DEFAULT_CONFIG.duplicateBucketSizeMeters);
  const conflictBucketSize = Math.max(0.022, config.conflictBucketSizeMeters ?? DEFAULT_CONFIG.conflictBucketSizeMeters);
  const maxOverlapComparisons = Math.max(1, Math.floor(config.maxOverlapComparisonsPerTriangle ?? DEFAULT_CONFIG.maxOverlapComparisonsPerTriangle));

  const preparationStart = performance.now();
  const frameLookup = buildFrameLookup(snapshot);
  const colorLookups = new Map<number, Map<number, number>>();
  let inputValidSourceSampleCount = 0;
  for (const frame of snapshot.frames) {
    inputValidSourceSampleCount += frame.denseFrame.valid.reduce((sum, value) => sum + (value ? 1 : 0), 0);
    colorLookups.set(frame.sequence, buildColorLookup(frame));
  }
  const preparationMs = performance.now() - preparationStart;

  const m89Start = performance.now();
  const m89: M89DepthKeyframePatchResult = buildM89DepthKeyframePatches(snapshot);
  const m89PatchTopologyMs = performance.now() - m89Start;
  const rawVertexCount = m89.vertices.positions.length / 3;
  const rawTriangleCount = m89.triangles.length / 3;

  const rawColors = new Uint8Array(rawVertexCount * 3);
  const rawColorValid = new Uint8Array(rawVertexCount);
  const rawSourceGridUvs = new Float32Array(rawVertexCount * 2);
  const rawFrameSequences = new Int32Array(m89.vertices.sourceFrameSequences);
  const rawSampleIndices = new Int32Array(m89.vertices.sourceSampleIndices);
  for (let vertex = 0; vertex < rawVertexCount; vertex += 1) {
    const frameSequence = rawFrameSequences[vertex];
    const sourceIndex = rawSampleIndices[vertex];
    const frame = frameLookup.get(frameSequence);
    if (!frame) continue;
    if (sourceIndex >= 0 && sourceIndex < frame.denseFrame.normalizedX.length && sourceIndex < frame.denseFrame.normalizedY.length) {
      rawSourceGridUvs[vertex * 2] = finiteOrZero(frame.denseFrame.normalizedX[sourceIndex]);
      rawSourceGridUvs[vertex * 2 + 1] = finiteOrZero(frame.denseFrame.normalizedY[sourceIndex]);
    }
    const colorSlot = colorLookups.get(frameSequence)?.get(sourceIndex);
    if (colorSlot === undefined || colorSlot * 3 + 2 >= frame.srgbColors.length) continue;
    rawColors[vertex * 3] = frame.srgbColors[colorSlot * 3];
    rawColors[vertex * 3 + 1] = frame.srgbColors[colorSlot * 3 + 1];
    rawColors[vertex * 3 + 2] = frame.srgbColors[colorSlot * 3 + 2];
    rawColorValid[vertex] = 1;
  }
  const redundancyStart = performance.now();
  const duplicateToleranceSquared = duplicateTolerance * duplicateTolerance;
  const kept = new Uint8Array(rawTriangleCount);
  const triangleOrder = Array.from({ length: rawTriangleCount }, (_, index) => index);
  const rawTriangleFrameSequences = new Int32Array(rawTriangleCount);
  const rawTriangleTrackingQualities = new Float32Array(rawTriangleCount);
  for (let triangle = 0; triangle < rawTriangleCount; triangle += 1) {
    const sourceVertex = m89.triangles[triangle * 3];
    const sequence = rawFrameSequences[sourceVertex];
    rawTriangleFrameSequences[triangle] = sequence;
    rawTriangleTrackingQualities[triangle] = frameQuality(frameLookup.get(sequence));
  }
  triangleOrder.sort((left, right) => (
    rawTriangleTrackingQualities[right] - rawTriangleTrackingQualities[left]
    || rawTriangleFrameSequences[left] - rawTriangleFrameSequences[right]
    || left - right
  ));

  const duplicateBuckets = new Map<string, number[]>();
  const conflictBuckets = new Map<string, Map<number, number[]>>();
  let duplicateTrianglesCulled = 0;
  let duplicateCandidateComparisons = 0;
  let duplicateProbeCapHits = 0;
  let overlapConflictCandidatesOver22mm = 0;
  let overlapConflictCandidatesOver50mm = 0;
  let overlapConflictLateralRejects = 0;
  let overlapConflictComparisons = 0;
  let overlapProbeCapHits = 0;
  const centroids = new Float32Array(rawTriangleCount * 3);
  const normals = new Float32Array(rawTriangleCount * 3);
  const triangleExtents = new Float32Array(rawTriangleCount);
  for (let triangle = 0; triangle < rawTriangleCount; triangle += 1) {
    const centroid = triangleCentroid(m89.vertices.positions, m89.triangles, triangle);
    centroids[triangle * 3] = centroid[0];
    centroids[triangle * 3 + 1] = centroid[1];
    centroids[triangle * 3 + 2] = centroid[2];
    const normal = averagedNormal(m89.vertices.normals, m89.triangles, triangle);
    normals[triangle * 3] = normal[0];
    normals[triangle * 3 + 1] = normal[1];
    normals[triangle * 3 + 2] = normal[2];
    triangleExtents[triangle] = triangleExtent(m89.vertices.positions, m89.triangles, triangle);
  }

  for (const triangle of triangleOrder) {
    const centroidX = centroids[triangle * 3];
    const centroidY = centroids[triangle * 3 + 1];
    const centroidZ = centroids[triangle * 3 + 2];
    let duplicate = false;
    let duplicateComparisonsForTriangle = 0;
    addBucketNeighbourKeys(centroidX, centroidY, centroidZ, duplicateBucketSize, (key) => {
      if (duplicate || duplicateComparisonsForTriangle >= maxOverlapComparisons) return;
      const candidates = duplicateBuckets.get(key);
      if (!candidates) return;
      for (const existing of candidates) {
        if (duplicateComparisonsForTriangle >= maxOverlapComparisons) {
          duplicateProbeCapHits += 1;
          break;
        }
        duplicateComparisonsForTriangle += 1;
        duplicateCandidateComparisons += 1;
        const sameFacing = normals[triangle * 3] * normals[existing * 3]
          + normals[triangle * 3 + 1] * normals[existing * 3 + 1]
          + normals[triangle * 3 + 2] * normals[existing * 3 + 2];
        if (sameFacing < 0.99) continue;
        if (pointSetMatches(m89.vertices.positions, m89.triangles, triangle, existing, duplicateToleranceSquared)) {
          duplicate = true;
          break;
        }
      }
    });
    if (duplicate) {
      duplicateTrianglesCulled += 1;
      continue;
    }
    kept[triangle] = 1;
    const duplicateKey = bucketKey(centroidX, centroidY, centroidZ, duplicateBucketSize);
    const duplicateList = duplicateBuckets.get(duplicateKey);
    if (duplicateList) duplicateList.push(triangle);
    else duplicateBuckets.set(duplicateKey, [triangle]);

    let comparisonsForTriangle = 0;
    addBucketNeighbourKeys(centroidX, centroidY, centroidZ, conflictBucketSize, (key) => {
      if (comparisonsForTriangle >= maxOverlapComparisons) return;
      const candidates = conflictBuckets.get(key);
      if (!candidates) return;
      for (const [candidateSequence, candidateTriangles] of candidates) {
        if (candidateSequence === rawTriangleFrameSequences[triangle]) continue;
        for (const existing of candidateTriangles) {
        if (comparisonsForTriangle >= maxOverlapComparisons) {
          overlapProbeCapHits += 1;
          break;
        }
        comparisonsForTriangle += 1;
        overlapConflictComparisons += 1;
        const dot = normals[triangle * 3] * normals[existing * 3]
          + normals[triangle * 3 + 1] * normals[existing * 3 + 1]
          + normals[triangle * 3 + 2] * normals[existing * 3 + 2];
        if (dot < 0.9) continue;
        const dx = centroidX - centroids[existing * 3];
        const dy = centroidY - centroids[existing * 3 + 1];
        const dz = centroidZ - centroids[existing * 3 + 2];
        const separation = Math.abs(
          dx * normals[triangle * 3]
          + dy * normals[triangle * 3 + 1]
          + dz * normals[triangle * 3 + 2],
        );
        const tangentX = dx - (dx * normals[triangle * 3] + dy * normals[triangle * 3 + 1] + dz * normals[triangle * 3 + 2]) * normals[triangle * 3];
        const tangentY = dy - (dx * normals[triangle * 3] + dy * normals[triangle * 3 + 1] + dz * normals[triangle * 3 + 2]) * normals[triangle * 3 + 1];
        const tangentZ = dz - (dx * normals[triangle * 3] + dy * normals[triangle * 3 + 1] + dz * normals[triangle * 3 + 2]) * normals[triangle * 3 + 2];
        // This is deliberately a conservative overlap proxy, not polygon
        // intersection: each centroid's tangent reach is half the local
        // triangle's longest edge, plus the duplicate tolerance. Exact
        // same-XY layers therefore remain eligible even at 28 mm depth.
        const lateralThreshold = (triangleExtents[triangle] + triangleExtents[existing]) * .5 + duplicateTolerance;
        if (Math.hypot(tangentX, tangentY, tangentZ) > lateralThreshold) {
          overlapConflictLateralRejects += 1;
          continue;
        }
        if (separation > 0.022) overlapConflictCandidatesOver22mm += 1;
        if (separation > 0.05) overlapConflictCandidatesOver50mm += 1;
        }
        if (comparisonsForTriangle >= maxOverlapComparisons) break;
      }
    });
    const conflictKey = bucketKey(centroidX, centroidY, centroidZ, conflictBucketSize);
    const conflictGroups = conflictBuckets.get(conflictKey);
    if (conflictGroups) {
      const sequenceGroup = conflictGroups.get(rawTriangleFrameSequences[triangle]);
      if (sequenceGroup) sequenceGroup.push(triangle);
      else conflictGroups.set(rawTriangleFrameSequences[triangle], [triangle]);
    } else conflictBuckets.set(conflictKey, new Map([[rawTriangleFrameSequences[triangle], [triangle]]]));
  }

  let rawAreaSquareMeters = 0;
  for (let triangle = 0; triangle < rawTriangleCount; triangle += 1) rawAreaSquareMeters += triangleArea(m89.vertices.positions, m89.triangles, triangle);
  let retainedTriangleCount = 0;
  let retainedAreaSquareMeters = 0;
  for (let triangle = 0; triangle < rawTriangleCount; triangle += 1) {
    if (!kept[triangle]) continue;
    retainedTriangleCount += 1;
    retainedAreaSquareMeters += triangleArea(m89.vertices.positions, m89.triangles, triangle);
  }
  const redundancyMs = performance.now() - redundancyStart;

  const packingStart = performance.now();
  const sourceVertexToCompact = new Int32Array(rawVertexCount);
  sourceVertexToCompact.fill(-1);
  const compactPositions = new Float32Array(rawVertexCount * 3);
  const compactNormals = new Float32Array(rawVertexCount * 3);
  const compactColors = new Uint8Array(rawVertexCount * 3);
  const compactColorValid = new Uint8Array(rawVertexCount);
  const compactSourceGridUvs = new Float32Array(rawVertexCount * 2);
  const compactFrameSequences = new Int32Array(rawVertexCount);
  const compactSampleIndices = new Int32Array(rawVertexCount);
  const compactIndices = new Uint32Array(retainedTriangleCount * 3);
  let compactVertexCount = 0;
  let compactIndexCount = 0;
  let sourceOwnershipViolations = 0;
  for (let triangle = 0; triangle < rawTriangleCount; triangle += 1) {
    if (!kept[triangle]) continue;
    for (let corner = 0; corner < 3; corner += 1) {
      const rawVertex = m89.triangles[triangle * 3 + corner];
      let compactVertex = sourceVertexToCompact[rawVertex];
      if (compactVertex < 0) {
        compactVertex = compactVertexCount;
        sourceVertexToCompact[rawVertex] = compactVertex;
        compactPositions.set(m89.vertices.positions.subarray(rawVertex * 3, rawVertex * 3 + 3), compactVertex * 3);
        compactNormals.set(m89.vertices.normals.subarray(rawVertex * 3, rawVertex * 3 + 3), compactVertex * 3);
        compactColors.set(rawColors.subarray(rawVertex * 3, rawVertex * 3 + 3), compactVertex * 3);
        compactColorValid[compactVertex] = rawColorValid[rawVertex];
        compactSourceGridUvs.set(rawSourceGridUvs.subarray(rawVertex * 2, rawVertex * 2 + 2), compactVertex * 2);
        compactFrameSequences[compactVertex] = rawFrameSequences[rawVertex];
        compactSampleIndices[compactVertex] = rawSampleIndices[rawVertex];
        compactVertexCount += 1;
      }
      compactIndices[compactIndexCount] = compactVertex;
      compactIndexCount += 1;
    }
  }
  const compactIndexOutput = compactIndices.slice(0, compactIndexCount);
  const compactPositionOutput = compactPositions.slice(0, compactVertexCount * 3);
  const compactNormalOutput = compactNormals.slice(0, compactVertexCount * 3);
  const compactColorOutput = compactColors.slice(0, compactVertexCount * 3);
  const compactColorValidOutput = compactColorValid.slice(0, compactVertexCount);
  const compactUvOutput = compactSourceGridUvs.slice(0, compactVertexCount * 2);
  const compactFrameOutput = compactFrameSequences.slice(0, compactVertexCount);
  const compactSampleOutput = compactSampleIndices.slice(0, compactVertexCount);
  let retainedRegisteredColorVertexCount = 0;
  let retainedNormalizedUvVertexCount = 0;
  for (let vertex = 0; vertex < compactVertexCount; vertex += 1) {
    if (compactColorValidOutput[vertex]) retainedRegisteredColorVertexCount += 1;
    const uvOffset = vertex * 2;
    if (Number.isFinite(compactUvOutput[uvOffset]) && Number.isFinite(compactUvOutput[uvOffset + 1])) retainedNormalizedUvVertexCount += 1;
  }

  const unionParent = new Int32Array(compactVertexCount);
  const unionRank = new Uint8Array(compactVertexCount);
  for (let vertex = 0; vertex < compactVertexCount; vertex += 1) unionParent[vertex] = vertex;
  const find = (vertex: number): number => {
    let root = vertex;
    while (unionParent[root] !== root) root = unionParent[root];
    while (unionParent[vertex] !== vertex) {
      const next = unionParent[vertex];
      unionParent[vertex] = root;
      vertex = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (unionRank[leftRoot] < unionRank[rightRoot]) unionParent[leftRoot] = rightRoot;
    else if (unionRank[leftRoot] > unionRank[rightRoot]) unionParent[rightRoot] = leftRoot;
    else {
      unionParent[rightRoot] = leftRoot;
      unionRank[leftRoot] += 1;
    }
  };
  for (let index = 0; index < compactIndexOutput.length; index += 3) {
    union(compactIndexOutput[index], compactIndexOutput[index + 1]);
    union(compactIndexOutput[index + 1], compactIndexOutput[index + 2]);
  }
  const componentRoots = new Uint8Array(compactVertexCount);
  let componentCount = 0;
  for (let vertex = 0; vertex < compactVertexCount; vertex += 1) {
    const root = find(vertex);
    if (!componentRoots[root]) {
      componentRoots[root] = 1;
      componentCount += 1;
    }
  }

  const edgeBase = rawVertexCount + 1;
  const edgeKeys = new Float64Array(retainedTriangleCount * 3);
  let edgeCursor = 0;
  for (let index = 0; index < compactIndexOutput.length; index += 3) {
    const a = compactIndexOutput[index];
    const b = compactIndexOutput[index + 1];
    const c = compactIndexOutput[index + 2];
    edgeKeys[edgeCursor++] = Math.min(a, b) * edgeBase + Math.max(a, b);
    edgeKeys[edgeCursor++] = Math.min(b, c) * edgeBase + Math.max(b, c);
    edgeKeys[edgeCursor++] = Math.min(c, a) * edgeBase + Math.max(c, a);
  }
  edgeKeys.sort();
  let boundaryEdgeCount = 0;
  for (let edge = 0; edge < edgeKeys.length;) {
    let next = edge + 1;
    while (next < edgeKeys.length && edgeKeys[next] === edgeKeys[edge]) next += 1;
    if (next - edge === 1) boundaryEdgeCount += 1;
    edge = next;
  }

  const patches: M810DepthKeyframePatch[] = m89.patches.map((patch) => {
    let retainedForPatch = 0;
    for (let triangle = patch.triangleStart; triangle < patch.triangleStart + patch.triangleCount; triangle += 1) {
      if (kept[triangle]) retainedForPatch += 1;
    }
    return {
      frameSequence: patch.frameSequence,
      trackingQuality: frameQuality(frameLookup.get(patch.frameSequence)),
      rawTriangleStart: patch.triangleStart,
      rawTriangleCount: patch.triangleCount,
      retainedTriangleCount: retainedForPatch,
    };
  });
  for (let vertex = 0; vertex < compactVertexCount; vertex += 1) {
    const frame = frameLookup.get(compactFrameOutput[vertex]);
    const sample = compactSampleOutput[vertex];
    if (!frame || sample < 0 || sample >= frame.denseFrame.points.length / 3) {
      sourceOwnershipViolations += 1;
      continue;
    }
    const source = sample * 3;
    const output = vertex * 3;
    if (Math.abs(compactPositionOutput[output] - frame.denseFrame.points[source]) > 1e-6
      || Math.abs(compactPositionOutput[output + 1] - frame.denseFrame.points[source + 1]) > 1e-6
      || Math.abs(compactPositionOutput[output + 2] - frame.denseFrame.points[source + 2]) > 1e-6) {
      sourceOwnershipViolations += 1;
    }
  }
  const rawPackedBytes = sumByteLengths(
    m89.vertices.positions,
    m89.vertices.normals,
    m89.vertices.sourceFrameSequences,
    m89.vertices.sourceSampleIndices,
    m89.triangles,
    rawColors,
    rawColorValid,
    rawSourceGridUvs,
  );
  const packedBytes = sumByteLengths(
    compactPositionOutput,
    compactNormalOutput,
    compactColorOutput,
    compactColorValidOutput,
    compactUvOutput,
    compactFrameOutput,
    compactSampleOutput,
    compactIndexOutput,
  );
  const workingTypedBytes = sumByteLengths(
    kept,
    rawTriangleFrameSequences,
    rawTriangleTrackingQualities,
    centroids,
    normals,
    triangleExtents,
    sourceVertexToCompact,
    compactPositions,
    compactNormals,
    compactColors,
    compactColorValid,
    compactSourceGridUvs,
    compactFrameSequences,
    compactSampleIndices,
    compactIndices,
    unionParent,
    unionRank,
    componentRoots,
    edgeKeys,
  );
  const peakCpuTypedBytesEstimate = snapshot.diagnostics.memoryBytes + rawPackedBytes + workingTypedBytes + packedBytes;
  const gpuBytesEstimate = compactPositionOutput.byteLength
    + compactNormalOutput.byteLength
    + compactIndexOutput.byteLength;
  const registeredColorGpuBytesEstimate = gpuBytesEstimate + compactColorOutput.byteLength;
  const packingMs = performance.now() - packingStart;
  const totalMs = performance.now() - totalStart;

  return {
    vertices: {
      positions: compactPositionOutput,
      normals: compactNormalOutput,
      colors: compactColorOutput,
      colorValid: compactColorValidOutput,
      sourceGridUvs: compactUvOutput,
      sourceFrameSequences: compactFrameOutput,
      sourceSampleIndices: compactSampleOutput,
    },
    indices: compactIndexOutput,
    patches,
    diagnostics: {
      inputFrameCount: snapshot.frames.length,
      inputValidSourceSampleCount,
      usableSourceSampleCount: m89.diagnostics.usableSourceSampleCount,
      rawVertexCount,
      retainedVertexCount: compactVertexCount,
      rawTriangleCount,
      retainedTriangleCount,
      duplicateTrianglesCulled,
      duplicateCandidateComparisons,
      duplicateProbeCapHits,
      overlapConflictCandidatesOver22mm,
      overlapConflictCandidatesOver50mm,
      overlapConflictLateralRejects,
      overlapConflictComparisons,
      overlapProbeCapHits,
      sourceOwnershipViolations,
      inventedVertexCount: m89.diagnostics.inventedVertexCount,
      registeredColorVertexCount: retainedRegisteredColorVertexCount,
      normalizedUvVertexCount: retainedNormalizedUvVertexCount,
      rawAreaSquareMeters,
      retainedAreaSquareMeters,
      culledDuplicateAreaSquareMeters: rawAreaSquareMeters - retainedAreaSquareMeters,
      componentCount,
      boundaryEdgeCount,
      timings: {
        inputPreparationMs: preparationMs,
        m89PatchTopologyMs,
        redundancyMs,
        packingMs,
        totalMs,
      },
      rawPackedBytes,
      packedBytes,
      workingTypedBytes,
      peakCpuTypedBytesEstimate,
      gpuBytesEstimate,
      registeredColorGpuBytesEstimate,
      drawCalls: 1,
      inputSnapshotSignature,
      screenSpaceCoverageAvailable: false,
    },
  };
}

# M8.8 scalability blocker report

Status: software boundary fixed and regression-covered; M8.8 remains blocked
pending a physical large scan on the POCO F5. This report records the bounded
investigation and the evidence needed for the lead review. It is not a product
approval or a request to unfreeze M7/customization.

## A–O evidence

**A — Warning and owner.** `ScannerDomOverlay.tsx` reports “Measured map nearly
full” when `debug.denseReality.capacityUtilizationPercentage > 95`. The value
comes from `DenseRealityReconstructionService`, not the retained or canonical
maps.

**B — Structure and units.** The live map stores fixed-slot typed arrays for
positions, normals, color/geometry evidence, view diagnostics and timestamps,
plus linked-list hash heads. Its measured surfel cell is 0.025 m (2.5 cm),
`sampleRadiusMeters` is 0.0125 m, and `maxMergeDistanceMeters` is 0.034 m.

**C — Capacity.** The live-only guardrail is now 180,000 active slots. Numeric
typed storage is `180000 * 104 = 18,720,000` bytes (17.85 MiB), before the
variable source-color index array. At 95% the UI warning remains unchanged.
Retained `maxFrames`/input budgets and canonical/final caps were not changed.

**D — Insert, recycle and reject semantics.** A valid point first searches
nearby match buckets, then either fuses through the existing distance, normal,
point-to-plane and same-frame gates or inserts one live slot. At capacity, only
a stale unconfirmed slot (`geometryObservationCount < 2`, older than 8 s) is
recycled from a fixed 16-slot probe; otherwise the point is rejected. Confirmed
geometry is never evicted to hide pressure.

**E — Occupancy meaning.** `activeSampleCount` counts live slot hypotheses;
`capacityUtilizationPercentage` is active slots divided by 180,000. It is not
whole-room area, canonical output count, retained-frame count, or renderer
occupancy. `createSnapshot` separately emits fused/raw and stable live views.

**F — Spatial semantics.** The warning is a visual-only, live, bounded RGB-D
preview map. Structural live geometry remains owned by
`PersistentLiveSurfaceService`; retained measurements and canonical Final
Reality are separate stores. The map is therefore neither the canonical room
model nor a retained-history budget.

**G — Finish path.** `XRSessionService.finish()` stops XR, flushes the latest
measurement queue, snapshots live/spatial/baseline/dense/RGB/appearance and
retained data, then calls `reconstructCanonicalReality()` in the worker. The
worker runs baseline canonical replay and then the isolated M8.8 layered arm on
the same retained snapshot; the production baseline remains authoritative.

**H — Proven pre-fix failure.** The deterministic fixture previously reached
the candidate `cleaning-surfaces` stage and threw `RangeError: Maximum call
stack size exceeded` from `Math.max(0, ...array)` over all per-cell layers.
Isolated probes passed at 124,800 and failed at 124,900 in one V8 run; exact
boundary varied with call-stack/JIT state. Baseline completed, while candidate
and A/B failed only when candidate reconstruction was entered.

**I — Fix and post-fix result.** The two unbounded diagnostic spreads are now
iterative maxima with identical values. The permanent fixture executes
SMALL=1,600, MEDIUM=12,800, PREVIOUS_STACK_BOUNDARY=124,800 and
FULL_ROOM=130,000,
then baseline-only, candidate-only and A/B on the identical 130,000-sample
snapshot. All complete with no exception; the full candidate took 6,892 ms,
baseline 1,342 ms and A/B 8,160 ms in the measured run. The full candidate's
last stage is `applying-room-appearance`.

**J — Match-grid correction.** Measured surfels remain 2.5 cm and all existing
merge/depth/normal/same-frame gates remain. A separate linked match grid uses
bucket width exactly 0.034 m, so floor-based complete search is ±1 in each axis:
27 buckets instead of the former 125. Boundary tests cross a negative-coordinate
bucket boundary and fuse within 0.034 m; a 0.03 m normal-aligned depth offset
still remains a separate layer through the point-to-plane gate.

**K — Live-map proof.** A deterministic 130,000-unique-surfel frame is accepted
with zero rejected/capacity-rejected points, active occupancy 130,000/180,000,
and exactly 27 match-bucket probes per input point. Existing depth-layer,
negative-coordinate, quality, rendering and capacity-recycle tests remain
covered.

**L — A/B ownership and copies.** The browser-worker path transfers the retained
snapshot's typed-array buffers once. The worker computes baseline and candidate
sequentially from the same snapshot; the fallback path also passes the same
object sequentially. The result nests `baseline` and `experimental`; only
baseline consolidated/expiry buffers are transferred back. The quality preview
clones live arrays and sends candidate surfels only when experimental mode is
selected, so A/B does not silently duplicate the input snapshot before worker
transfer, though candidate result/diagnostic allocations coexist with baseline
while the worker finishes.

**M — Live lag evidence.** The queue retains at most one processing packet and
one newest pending packet, replacing stale pending work. Dense capture cadence
is 180 ms; diagnostics are 250 ms and pressure backs off display/diagnostic
cadence. Historical physical traces recorded Dense p50/p95/max about
155/214 ms, deferred 197/264 ms and stable ratio about 31.5%; another latest
trace measured live-map p50/p95/max 39.4/47.2/62.1 ms while worker/replay work
was seconds. These are prior-build physical metrics, not proof of current
POCO behavior after this bounded change.

**N — Scale estimate.** A 2.5 cm single layer is 1,600 cells/m²: the old 60k
guardrail represented 37.5 m², while 180k represents 112.5 m². A 4 m × 4 m ×
2.5 m envelope with two walls plus floor and ceiling is approximately 52 m² /
83,200 cells. If all four walls plus floor and ceiling are represented, it is
approximately 72 m² / 115,200 cells. Both leave headroom in 180k for objects
and depth layers. The 130k regression is ~81.25 m² of unique 2.5 cm cells.
This is a capacity estimate, not measured physical coverage.

**O — Release gate.** Software-only evidence is sufficient to remove the
specific stack-overflow and 125-bucket scalability blockers, but M8.8 stays
blocked until a physical large scan verifies XR frame cadence, memory/GC,
queue pressure, map occupancy, layer preservation, Finish completion and
quality on the target POCO F5. No retained/final caps or input budgets were
raised.

## Reproduction and validation commands

```text
node --test tests/finishScalabilityInvestigation.test.mjs
node --test tests/realityQuality.test.mjs
npm run test:reality
npm run build
npm run lint
```

The permanent deterministic fixture is
`tests/finishScalabilityInvestigation.test.mjs`; it is included by
`npm run test:reality` and does not require a physical device.

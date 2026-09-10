# M8.8 — Layered Measured Surface Field Feasibility

Status: PERFORMANCE FAIL / QUALITY BENEFIT UNDER INVESTIGATION; **Path C — stop
M8.8 before another POCO scan**.
The bounded software regression now completes the representative synthetic
room envelope, but this does not advance the scanner build marker, unfreeze
M7/customization, or replace the M8.7.1.6 production baseline.

The previously observed synthetic Finish stack-overflow blocker is documented
in `docs/M8_8_SCALABILITY_BLOCKER_REPORT.md`. The current branch removes the
unbounded diagnostic spread, separates the live match grid from the 2.5 cm
measured grid, and raises only the live typed-array guardrail to 180,000. A
physical large scan would ultimately be required to validate XR cadence, memory
pressure, surface-layer quality and end-to-end Finish on target hardware, but
the current desktop ratio does not justify requesting that scan yet.

The completed worker-only feasibility question was whether a bounded measured-surface field can recover coherent
room coverage while preserving real depth layers, without inventing geometry
or making browser WebXR on the POCO F5 unacceptable. This milestone completed
the offline, worker-only A/B on deterministic retained fixtures. It is
not a production rewrite and it must stop if the resource or layer-safety
gates below fail.

The current bounded optimization is still investigation-only. Desktop
fixtures show materially less duplicate coherence work, but the representative
large-arm worker remains above the provisional relative performance envelope.
No physical quality benefit is claimed. Because the end-to-end representation
redesign still misses that gate, an identical POCO replay is not requested in
this milestone.

## A. First bad stage and exact domains

The physical M8.7.1.6 trace was 57 s, with 236/249 accepted frames, 96/236
retained frames, 345,600 retained samples, 153,600 consolidated observations,
110,818 consolidated 2.5 cm cells, 17,961 canonical surfels, 16,639 canonical
2.5 cm cells, 17,160 confidence samples and 17,160 underlays. Holes were
already visible at Stage 4 (Post-Scan Canonical Fusion) and persisted later.

These counters are different domains:

- realityMeasurementStabilityService.ts:7-18,81-149,153-156 increments
  accepted once per accepted packet. Its raw audit samples are separately
  stride-capped, so 236/249 is not a percentage of surface points.
- realityQualityPolicy.ts:3-4,64-73 defines the 80x45 tier as 3,600 depth
  samples and four phases. The physical 345,600 is exactly 96 x 3,600; it is
  not 236 accepted frames times a full scan.
- retainedRealityMeasurementService.ts:5-18,147-224,227-266 bounds replay to
  96 frames and selects with a 0.25 m proxy. This is the first irreversible
  frame-history reduction, but the physical split between compaction,
  redundancy rejection and exact coverage loss was not supplied.
- canonicalRealityFusionService.ts:282-338,496-513 consolidates each frame
  into 1.8 cm representatives and then hard-caps the frame at 1,600. When all
  3,600 samples are valid, 192,000 observations are discarded before matching
  over the 96 retained frames. This is the first irreversible per-frame
  spatial sampling reduction.

The first stage correlated with visible holes is therefore canonical support
and promotion, not confidence filtering or the renderer. Retention and the
1,600 cap may have already removed useful evidence, but Stage 4 is where the
remaining evidence becomes visibly sparse.

## B. Comparable physical coverage

canonicalRealityFusionService.ts:395-404,496-513,818-829,877-891 uses the
same 2.5 cm pointKey for consolidated and final coverage. The comparable
global spatial proxy is therefore:

    16,639 final canonical cells / 110,818 consolidated cells = 15.0147%

The 17,961/110,818 ratio (16.2077%) is a surfel-count/cell-count comparison,
not area survival, because multiple final surfels can share a 2.5 cm cell.
Confidence retained 17,160/17,961 = 95.54%; the 801 removed display
candidates cannot explain holes that were already present at Stage 4. The
underlay count equaling confidence count confirms that surviving colored
surfel identities are not being silently suppressed by the hybrid renderer.

For a meaningful per-surface result, the feasibility harness must use the
complete consolidated observations, identify coherent depth layers using the
existing gates (canonicalRealityFusionService.ts:452-471: <=65 mm, normal
dot >=.90, plane residual <=18 mm and observed-neighbor support), and report
for each surface:

    unique final 2.5 cm tangent-plane cells /
    unique consolidated 2.5 cm tangent-plane cells

The tangent projection prevents 20-36 mm depth noise from making one physical
wall look like several areas. Layer ownership must remain a separate metric.
The current consolidated map is deliberately sampled
(canonicalRealityFusionService.ts:830-847) and coverageLossRegions is only the top 24 coarse 0.25 m
regions (:849-852), so exact physical per-surface percentages are still
unknown.

## C. Proven loss mechanism and unknowns

Canonical promotion requires temporal and coherent support:
canonicalRealityFusionService.ts:452-485,696-724 requires a 220 ms span and
either three observations plus view/coherent support, or two observations
with three established coherent neighbors. Unsupported hypotheses expire;
capacity and layer recycling are separate at :615-667.

An offline exact-aggregate synthetic replay used 153,600 observations and
110,818 unique consolidated cells, with 17,961 cells repeated three times,
6,860 twice and 85,997 once. It produced 110,818 provisional admissions,
17,961 promotions, 92,857 expiries (all insufficientTemporalSupport),
42,782 matched events, and zero capacity/layer/outlier rejects. This proves
that lifecycle support loss alone is sufficient to produce the observed
surfel scale. It does not prove that the physical run had 92,857 temporal
expiries, and its final cell dedupe was not identical to the physical 16,639.

The physical trace reported 4,147,200 match probes and 4,539,809 candidate
visits. Probes equal 153,600 observations x 27 (canonicalRealityFusionService
:518-520), so matching budget exhaustion is not established as the cause. The
physical values still needed are expiryReasons, promotion audit,
capacity/layer rejects, parallel collapses, region outcomes and complete
per-surface ownership.

## D. Appearance bottleneck

realityRgbKeyframeService.ts:10-17,107-180 retains at most eight appearance
frames, with a 1.5 s interval and motion gates. xrRawCameraService.ts:17-24,
201-213,591-664 copies the 864x1920 source to 432x960, or 1,244,160 RGB bytes
per frame and about 9.49 MiB for eight frames before GPU and clone overhead.
The copy uses the full source UV rectangle (:627-648).

realityDisplayRefinement.ts:38-164 processes at most eight frames and uses
measured splat occlusion, 25 mm depth visibility, 40 mm mixed-edge rejection
and incidence gates. The physical p50/p90 density was 407/543 texels per
meter: approximately 10.2/13.6 source texels across a 2.5 cm cell. That is
enough to improve appearance but cannot overcome sparse canonical geometry.
The renderer uses RGB sRGB DataTextures, clamp-to-edge, linear filtering and
no mipmaps (realitySurfaceRenderingService.ts:895-908).

The trace had 12,602 textured triangles and 17,284 fallback triangles: only
42.16% image-textured and 57.84% measured vertex-RGB fallback. Appearance is a
real bottleneck, but it is downstream of the Stage-4 coverage ceiling.

## E. Rank 4-8 interpretation

realitySurfaceRenderingService.ts:921-1008 intersects all three triangle
vertices' visibility-approved candidate IDs (:954-957), scores common IDs
(:958-961) and records the selected rank (:963-984). Candidate lists are not
truncated after the first three in the current code; the input frame set is
bounded to eight by realityDisplayRefinement.ts:104.

The physical rank counts 10,915/1,510/177/0 sum exactly to the 12,602
textured triangles. Rank-later zero means no selected common view was fourth
or later in the first vertex candidate list. It does not mean only three
keyframes existed. The current aggregate cannot distinguish no-common-view
triangles from lower-scoring common candidates; the feasibility trace must
add candidate-availability and no-common rejection histograms.

## F. Finish scheduling and instrumentation gap

xrSessionService.ts:367-518 cancels frame processing, waits the latest-only
measurement queue (:393-402), synchronously snapshots seven services
(:414-446), dispatches canonical replay (:448-452), assembles the result
(:455-485) and awaits XR shutdown (:487-489). The physical trace was 8.22 s
total, 0.98 s retained finalization, 6.30 s worker and 3.53 s matching.

postScanCanonicalFusionService.ts:20-43 transfers typed arrays to the worker;
postScanCanonicalFusion.worker.ts:5-14 emits stage strings and the final
result but no cross-thread timestamps. The field experiment must add marks
around queue flush, each snapshot, actual postMessage, worker receive and
start, stage/result receipt, worker result post, result assembly and XR end.
clickToWorkerMessagePostedMs at xrSessionService.ts:448-451 is taken before
the coordinator call and is not an actual post timestamp.

The same run must use a 16 ms rAF heartbeat and PerformanceObserver long-task
marks through Finish. The immersive overlay remains the source of truth
(useScannerSession.ts:69-85,319-368; ScannerDomOverlay.tsx:272-279,385-408).

## G. Architecture ceiling verdict

The current surfel + safe-triangle + per-triangle-keyframe design is measured
and layer-safe, but it cannot create missing cells. Display refinement only
adjusts existing points (realityDisplayRefinement.ts:38-89), and the underlay
renders existing colored surfels. If the physical 15% Stage-4 cell survival
persists, renderer changes cannot produce coherent room coverage.

The evidence does not justify a broad production M8.7.1.7 rewrite or a global
loosening of correspondence gates. It does justify a narrow, offline,
worker-only M8.8 feasibility milestone. M8.8 must answer whether a layered
measured surface field can materially improve per-surface projected coverage
under the same retained capture while preserving real-depth ownership. No
production-success claim is made until the stop/go gates in section L pass.

## H. Architecture alternatives

| Representation | Strength | Main risk under this capture | Feasibility stance |
| --- | --- | --- | --- |
| Current surfels | Small, measured, preserves explicit layers and existing worker path | 1,600/frame, 96-frame and support gates leave sparse final cells | Keep as baseline and fallback |
| Single TSDF/voxel field | Continuous surface estimate; weighted integration can reject isolated noise | Collapses front/back or recess layers unless augmented; may fill unobserved space | Measure only as a control, not a production proposal |
| Layered/discontinuity-aware measured field | Keeps depth ownership, uncertainty and multiple surfaces; can bridge only bounded measured gaps | More memory and classification complexity; still cannot recover absent observations | Recommended M8.8 candidate |
| Image-backed / hybrid atlas | Improves source detail and common-view continuity | Cannot repair Stage-4 geometry; texture memory/seams and fallback remain | Run appearance-only control with existing eight frames |

At 2.5 cm, a dense volume has 64,000 voxels/m3. A 50 m3 room would contain
about 3.2 million voxels; an 8-byte distance/weight pair is already about
25.6 MiB before hashing, normals, color, layer ownership and mesh output.
This is why a sparse, layered field is a feasibility question rather than an
immediate replacement.

## I. M8.8 milestone protocol

The milestone is named **M8.8 — Layered Measured Surface Field Feasibility**.
It runs offline in a dedicated worker alongside the unchanged M8.7.1.6 path:

1. Serialize one retained physical snapshot once. Feed the exact same frames,
   timestamps, poses, normals, RGB evidence and keyframes to every A/B arm.
2. Run current canonical surfels as the baseline; run a single-field control,
   a layered/discontinuity-aware field candidate and an image-backed/hybrid
   appearance control. Candidate output must retain source frame/sample IDs,
   normal/depth uncertainty and layer ownership.
3. Permit interpolation only inside measured, coherent support. No candidate
   may fill an unobserved room region, borrow M7/customization geometry, or
   flatten a defended recess/object/second wall.
4. Compute exact per-surface projected coverage, 2.5 cm cell survival,
   layer recall/false-merge counts, real-depth ownership, fallback and texture
   rank histograms, and the Finish/long-task marks described in section F.
5. Keep the current render path available so the A/B compares representation
   quality rather than a changed presentation stack.

The baseline and candidate must also be run on deterministic fixtures for a
flat wall, 20/36 mm depth noise, an exact 28 mm near-parallel layer, an 8 cm
protrusion, a measured recess with side face, a doorway/disconnected gap and
perpendicular wall/ceiling. These fixtures exist in
tests/realityQuality.test.mjs:308-314,517-618 and must remain passing.

## J. Expected physical change

The offline A/B must report both absolute final cells and tangent-plane
coverage. A candidate that merely increases 3D cell count by splitting a noisy
wall is not a coverage improvement. It must show more owned projected surface
while retaining the separate depth layers.

Existing one-off results set expectations, not promises:

- An in-memory phase-stratified 1,600-of-N selector kept the same count and
  improved synthetic projected coverage by 1.72 percentage points clean and
  4.69 points at 20 mm noise, but only 0.5 points at 36 mm noise.
- Uncapping to 3,600/frame roughly doubled synthetic final cells at 20 mm
  noise, but increases per-frame observations 2.25x and remains layer/gate
  limited at 36 mm noise.
- Retaining 144 instead of 96 repeated noisy-wall frames changed final cells
  only about 2-3%; novel physical viewpoints may differ, but the current
  capture does not prove that more repeated frames solve the deficit.
- Widening the 22 mm plane gate to 32/36 mm worsened the 36 mm noisy-wall
  result and merged a real 28 mm layer (72 surfaces became 36). The 22 mm
  correspondence gate therefore remains the baseline safety boundary.

The expected M8.8 result is a measured decision: either materially higher
projected coverage with preserved layers, or evidence that the capture itself
must change before a field representation can help.

## K. Resource and performance gates

These are provisional feasibility gates to be measured against an unchanged
M8.7.1.6 run on the same POCO F5, not claims that the device already meets
them:

- all candidate computation remains in the worker; no new synchronous field
  build may occur after the Finish paint boundary;
- worker wall time is <=8.0 s and <=1.25x the measured M8.7.1.6 worker time;
- no new post-paint main-thread long task exceeds 50 ms, and the measured
  queue/snapshot/result-assembly/XR-end marks do not regress the baseline;
- peak worker/transfer memory is measured explicitly and must remain <=1.5x
  the baseline peak and <=256 MiB total for the candidate process;
- output layer ownership is bounded (no more than four hypotheses per local
  cell unless a separate budget is approved), and candidate operation counts
  are reported against 4,147,200 probes / 4,539,809 visits;
- appearance controls remain within the existing eight-frame, 432x960 cap
  (~9.49 MiB RGB) unless a separate memory result justifies a change;
- live XR cadence, accepted packets and retained evidence are identical across
  A/B arms. A faster result that silently drops capture evidence is invalid.

Any gate failure is a stop, not an invitation to hide cost in Finish or reduce
the retained physical input.

## L. Stop/go criteria and validation

Go to a separately reviewed production architecture only if the layered field,
on the identical POCO capture and fixtures:

- reaches at least 2x the current 15.0147% global projected-cell proxy and at
  least 60% projected coverage on coherent planar regions, without claiming
  unobserved space;
- preserves >=95% of supported protrusion, recess, perpendicular-surface and
  28-50 mm layer ownership, with <=5% false layer merges;
- does not worsen real-RGB fallback/common-view diagnostics or Finish stage
  visibility;
- passes every resource gate in section K and remains deterministic across
  repeated offline runs.

Stop and do not start a production rewrite if coverage remains near the surfel
baseline, gains come only from duplicated noisy layers, any unobserved space
is filled, real layers are merged, or worker/memory/main-thread limits fail.
In that case the next decision is capture/quality policy feasibility, not a
larger renderer.

Validation commands for the current repository are:

    npm run test:reality   # 204 passed, 0 failed
    npm run build          # passed; existing large-chunk advisory only
    npm run lint           # passed with no findings
    git diff --check       # passed

The commands above validate the current repository and the isolated
experimental path. They do not establish physical success. M7 structural
extraction, customization and the scanner build marker remain frozen until
the M8.8 stop/go review is complete.

Physical unknowns that require a capture remain explicit: the expiry-reason
mix and exact 2.5 cm coverage lost by retention, complete no-common/rank
availability, camera-orientation correctness and readback mapping, browser
GPU/heap peaks, and whether every visible Stage-4 opening is an absent
measured cell rather than spacing, depth-layer occlusion or a display-footprint
effect. These cannot be resolved by desktop tests or aggregate surfel counts.

## M8.8 implementation evidence (experimental only)

The bounded worker A/B is now implemented without changing the live XR loop,
the M8.7.1.6 build marker, M7 structural extraction, customization, or the
baseline `FinalizedDenseRealityReconstruction.surfels` field. The worker receives
one transferred `RetainedRealityMeasurementSnapshot`, runs the unchanged
`CanonicalRealityFusionService` first, and then runs
`LayeredMeasuredSurfaceFieldService` against that same object. A content
signature covers frame order, timestamps, poses, dense validity/points,
normals, and registered RGB arrays; the result carries baseline and candidate
signatures and an equality flag.

The candidate is a sparse measured-cell field, not a TSDF. Each retained frame
is consolidated at the existing 1.8 cm spatial scale without the baseline's
1,600-sample cap. The representative is a deterministic medoid (an actual
source point); registered RGB is retained from measured source evidence. World
2.5 cm cells own at most four measured layers. A layer is promoted directly
when the same measured cell has multi-frame support; coherent-neighbor
promotion additionally requires valid full-frame source-grid continuity and
independent cross-frame neighbors. Compatibility uses an explicitly averaged,
normalized surface normal for plane/tangent distance and keeps the existing
22 mm plane-safety boundary. No unobserved cell is created. A 240,000-entry
field budget bounds pathological measured-cell input, with deterministic
capacity-rejection counters. Per-layer medoid candidates are capped at 64
source samples, while observation counts, timestamps, support frames, RGB
evidence, and Welford-style measured position/depth/normal variance remain
accumulated.

Each promoted surfel has a bounded immutable ownership record containing its
surfel id, deterministic layer id, world-cell key, exact source frame/sample
identity, and exact measured XYZ. Candidate invented/unowned validation uses
that source identity/XYZ, not merely the 2.5 cm cell. Candidate diagnostics
also report same-domain baseline intersection (including baseline cells outside
the observed domain), integration/coherence lookup and candidate-visit counts,
split input/representation/working/output memory estimates with a lower-bound
peak caveat, component tangent projections, and A/B hole classes A–E.

Component orientation labels are evidence-based: `main-wall` is reserved for
the largest coherent vertical component, `side-wall` for a sufficiently large
approximately perpendicular vertical component, `ceiling` for a gravity-aligned
upper horizontal component, and all other components retain `generic-N` labels.

Deterministic desktop fixtures now cover repeated clean and noisy planes,
an exact 36 mm noisy-planar comparison, a realistic 2-D source-grid continuity
fixture, genuinely unobserved gaps, 28 mm close parallel layers, an 8 cm
protrusion, recess front/side/back ownership, and false forward/noise
observations. They verify exact source XYZ ownership, deterministic
replay/signatures, measured variance fields, zero invented points, four-layer
bounding, same-domain baseline accounting, and baseline authority. In the
sparse synthetic cross-frame fixture, the complete observed domain was 121
world cells; baseline represented 36 while the experimental field represented
77, with 0 unowned/invented outputs. A repeated clean plane was 81/81 cells in
both arms. These are representation-safety and A/B-preparation results only;
they are not physical POCO coverage evidence and do not establish GO.

Finish now records the actual main-thread worker postMessage begin/end epochs,
worker result-receive epoch, worker receive/start/stage/result epochs, rAF
heartbeat count and maximum gap, and PerformanceObserver long-task
count/maximum where supported. Queue drain, snapshot stages, result assembly,
and XR session end remain separately timed. The preview records local
component/effect mount and first restored-surface paint epochs in UI state only
(without mutating the frozen scan result), and displays mount-to-paint and
Finish-completion-to-mount/paint intervals. M8.8 surfels are delivered lazily
to the existing preview worker only when its mode is selected, so the default
baseline mount does not serialize the experimental graph.
Preview modes explicitly expose **M8.7.1.6 Baseline Canonical** and
**M8.8 Experimental Reconstruction** on one renderer/camera/OrbitControls
instance; final/default output remains baseline.

## M8.8 optimization evidence (current verdict remains STOP)

The coherence pass now builds one collision-safe numeric cell index and one
indexed undirected compatibility adjacency from the existing 27 neighboring
measured cells. It reuses that adjacency for component BFS and coherent
support/promotion. Same-cell pairs and one deterministic half of the 26
neighbor offsets cover every undirected pair exactly once; offset and layer
order are preserved so component IDs, representatives, ownership and
floating-point reductions remain deterministic. The diagnostic still reports
the legacy 27-cell lookup and candidate-visit definitions, plus actual numeric
index lookups, hash-collision buckets/probes, relation checks and accepted
undirected-edge counts.

Capacity diagnostics now distinguish local four-layer saturation/rejects from
global 240,000-layer field saturation/rejects. The legacy aggregate fields are
retained. Reaching four layers in one cell no longer implies global capacity;
the supplied physical `166` rejects are explained by the local branch because
the measured `220,484` candidate layers remain below `240,000`.

The current bounded Path-A implementation also keeps exact source semantics
while removing avoidable worker churn. Per-frame consolidation uses a
collision-safe numeric coordinate record and a source-indexed grid array with
bounds-checked eight-neighbor probes. Integration creates the world-cell
records once and passes the same collision-safe index into adjacency; public
world-cell strings are formatted only for ownership/diagnostic output. The
former repeated medoid rescans are replaced by incremental pair scores for the
first 64 samples, with the original candidate order and tie-break preserved.
Retained-frame and deduplicated-viewpoint support use exact three-word masks
(96-frame bound), and cross-frame neighbor sets are not retained after the
support decision. These are representation changes only: the 22 mm safety
gate, layer limits, promotion/evidence thresholds, ownership checks and
capacity semantics are unchanged.

The semantic-lock suite now covers 13 deterministic cases (clean, sparse,
noisy, close-layer, recess, false-forward, unobserved-gap, empty, single,
local-saturation, perpendicular, disconnected-offset and color-fallback).
The seven historical hashes match the pre-redesign fixture values; the six
additional cases are now locked as redesign regression fixtures. Diagnostics
expose consolidation index lookups/collisions,
source-grid neighbor hits, legacy-vs-incremental medoid work, and the
adjacency/component/support timing split. Singleton hash buckets avoid one
array per occupied cell, source-grid cell IDs use an Int32Array, and raw
observed world records allocate layer arrays lazily. The observed-domain Set
was removed after an exact valid+normal-domain test proved world-cell records
equivalent; coherence collision probes are adjacency-phase only. The numeric
index and masks are ordinary JavaScript records/numbers; the existing
conservative formula still reports modeled bytes only. Engine-dependent
Map/array/object overhead is not priced, no exact typed-array byte count exists
for these structures, and a memory reduction is therefore not claimed.

The experimental and baseline A/B preview modes use the same renderer/camera
and flat diagnostic colors, but now use the existing measured normal/radius
oriented rounded-square splat path rather than fixed 8 mm point centers. A
bounded deterministic screen-space audit reports frustum rejects, visible and
depth-hidden primitives, useful pixels, hole fraction and overlap tests. It is
diagnostic only and does not invent physical major-surface counts.

Finish snapshots retain their contents and worker input but yield after four
major synchronous groups (live, spatial/base, dense, and RGB/diagnostic work)
before dispatch. `FinishPipelineDiagnostics` records group timings, summed
synchronous snapshot CPU, yield epochs/count and maximum uninterrupted snapshot
group duration; the existing rAF/long-task and actual postMessage timestamps
remain available.

Three isolated idle iterations of the final representation measured candidate,
baseline and combined A/B wall medians (ranges) as follows; the 180k arm uses
exactly 96 frames to stay inside the retained evidence bound:

| Input | Candidate | Baseline | Candidate/Baseline | Combined A/B |
| --- | ---: | ---: | ---: | ---: |
| 1,600 / 1 frame | 30.8 ms (29.7–31.7) | 28.0 ms (26.7–28.0) | 1.10× | 39.2 ms (38.2–49.7) |
| 130,000 / 82 frames | 1,177.1 ms (1,173.8–1,236.2) | 717.7 ms (712.8–722.8) | 1.64× | 2,986.8 ms (2,794.9–3,166.7) |
| 150,000 / 94 frames | 1,316.4 ms (1,294.7–1,392.9) | 838.5 ms (830.3–842.1) | 1.57× | 3,999.7 ms (3,867.7–4,212.3) |
| 180,000 / 96 frames | 1,687.8 ms (1,679.6–1,704.9) | 1,061.4 ms (977.0–1,126.9) | 1.59× | 4,835.2 ms (4,553.6–5,135.9) |

Candidate stage medians at 130k/150k/180k were respectively
consolidation `308/400/505 ms`, integration `198/239/252 ms`,
coherence/promotion `522/471/703 ms` (adjacency/index `326/275/393 ms`,
components `75/66/97 ms`, support/promotion `123/130/213 ms`) and component
metrics `39/49/57 ms`. These separated-room fixtures have one sample per
world cell, so medoid counters are zero; repeated coherent fixtures exercise
incremental scoring and report the corresponding before/actual candidate and
distance work directly. These are not POCO measurements. The candidate remains
above the provisional `<=1.25x` relative gate, so the current verdict is
**PERFORMANCE FAIL / QUALITY BENEFIT UNDER INVESTIGATION** and **Path C — stop
M8.8**. The remaining object/Map indirection would require replacing the
candidate architecture with a full structure-of-arrays field while its physical
quality benefit is still unproven. No production promotion, M7/customization
change, capacity increase or physical scan request follows.

For historical comparison, the earlier post-index/pre-representation validation
on the same deterministic fixture remained semantically equivalent to the clean
`b6483f2` source: the permanent clean, sparse, noisy,
close-layer, recess, false-forward and unobserved-gap fixtures retain their
captured 16-hex semantic hashes. In the latest full-suite desktop process,
130,000 layers took `2,053.9 ms` candidate-only versus `804.2 ms` baseline-only
(`2.554x`); adjacency/index was `525.6 ms`, connected components `82.6 ms`,
and support/promotion `47.4 ms`. The safe 150,000 arm took `2,472.2 ms`
candidate versus `911.7 ms` baseline (`2.711x`), with `564.2 ms` adjacency.
The 130k/150k operation counts were respectively 3.51m/4.05m legacy cell
lookups, 347,120/392,720 derived legacy candidate visits, 108,560/121,360
undirected relation checks, and 1.69m/1.95m numeric half-neighborhood lookups;
the numeric index reported 13 exact-coordinate collision probes and no
multi-cell collision buckets in these fixtures. The diagnostic's modeled peak
estimates were 59.93 MB and 69.15 MB, using the existing input,
representation, working and output formulas (including
`allLayers * 224 + observedCells * 48 + ownership * 96`). They do not price
engine-dependent `Map`/record/array overhead or explicitly account for the new
numeric-index records and cell-coordinate fields. No precise typed-array byte
count is available for those objects, so memory reduction is not proven;
operation counts are the reliable index-cost evidence. Run-to-run JIT/GC
variation is material. Those predecessor ratios motivated the final
representation redesign above; they are not current measurements.

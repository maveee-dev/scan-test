# M8.10 — Depth-Keyframe Patch Atlas Integration Feasibility

Status: **PATH C — PATCH ATLAS NOT VIABLE for the current browser/mobile feasibility gate; M8.7.1.6 remains production**  
Verdict: **PATCH ATLAS NOT VIABLE / PERFORMANCE FAIL / QUALITY BENEFIT UNDER INVESTIGATION**

This is a bounded same-input worker/preview report. It is not a POCO result,
mobile-performance claim, physical-quality claim, or promotion recommendation.
M8.8 is closed historical evidence. No scan was requested.

## A. INTEGRATION ARCHITECTURE

The canonical baseline and M8.10 consume the same
`RetainedRealityMeasurementSnapshot`. The baseline still owns production
`surfels`, appearance, Final Reality, live capture, XR cadence, M7,
customization, and the build marker. M8.10 is a worker-produced, source-owned,
indexed flat-triangle debug arm selected lazily by `RealityQualityPreview`.

## B. EXACT INPUT OWNERSHIP

The retained contract is capped at 96 frames and carries source-grid validity,
normalized coordinates, measured XYZ, normals, sequence/pose metadata and
registered per-sample RGB indices when available. The worker records one input
signature for both arms. Every candidate vertex retains exact frame sequence and
source sample index; no high-resolution image association is guessed.

The controlled same-snapshot fixture signature was
`m88-7fc6485e-b55286ef`; baseline and candidate used that identical input.

## C. PATCH / TRIANGLE GENERATION RULES

M8.9 emits conservative per-frame source-grid quads and splits accepted quads
into two triangles after missing-vertex, normal, edge, depth-span, plane-
residual and degeneracy gates. M8.10 copies only measured XYZ/normals/RGB/UV
and never interpolates across a source-grid gap or invents an interior vertex.

## D. OVERLAP / DUPLICATE HANDLING

Near-duplicate culling uses deterministic spatial buckets and six point-set
permutations at a maximum 1.5 mm vertex tolerance with same-facing normals.
Priority is tracking quality, frame sequence, then source triangle order.
Opposing normals, close parallel layers, recess/protrusion bands and gaps are
protected.

The conflict diagnostic is now a bounded lateral-overlap proxy, not polygon
intersection. For same-facing triangles it decomposes centroid delta into
normal separation and tangent distance; a candidate counts as overlapping only
when tangent distance is no greater than half the two local longest-edge
extents plus the duplicate tolerance. Exact same-XY 28 mm layers therefore
remain eligible. Lateral-proxy rejects, comparisons and probe-cap hits are
reported separately from >22 mm/>50 mm overlap counts.

## E. WORLD-SPACE COVERAGE

The controlled synthetic A/B uses four 12×8 source grids: a complete frame
with a genuine invalid column, two coherent frames containing only the left
six columns, and a measured 28 mm close layer. Canonical Stage 4 returns 48
surfels after expiring the one-frame right-side extension; M8.10 retains 184
source-owned vertices and 280 indexed triangles. This demonstrates measured
extension, gap and close-layer preservation on a synthetic same-input fixture
only; it is not a physical-room coverage result.

The fixture contains 280 valid measured input samples. Its shared accepted
source-grid triangle-area proxy is 0.131250 m² (a sum of triangle areas, not a
union area). The actual baseline geometry represents 48 samples/vertices and
has 0.021875 m² summed triangle area, leaving a 0.109375 m² missing-area proxy.
The candidate represents 184 source-owned samples/vertices and has 0.087500 m²
summed triangle area, leaving a 0.043750 m² missing-area proxy. Each missing
area value is `max(accepted source-grid area proxy − represented summed area, 0)`;
neither value is an estimate of physically uncovered wall area.

Welded actual-geometry topology reports one baseline component with 24 boundary
edges and three candidate components with 82 boundary edges. The geometry-level
duplicate-triangle proxy is zero for both arms; the candidate separately reports
140 source duplicate triangles culled by its bounded redundancy pass. A semantic
duplicate-surface count and a unique world-space union area are unavailable from
this fixture and are not inferred.

The semantic suite also covers a genuine source gap, 28 mm parallel layers,
8 cm protrusion, recess front/side/back, perpendicular and opposing normals,
noise and partial occlusion. Ownership and invention violations remain zero.

## F. SCREEN-SPACE COVERAGE

Both A/B arms use their actual flat triangle geometry, one fixed 60° camera and
the deterministic 256×256 audit. The synthetic baseline had 70 in-frustum and
70 final-visible triangles, 280 useful pixels and 0.9957275 hole fraction. The
candidate had 280 in-frustum triangles, 154 final owner winners, 126
depth-hidden triangles, 600 useful pixels and 0.9908447 hole fraction. It
recorded 504 >22 mm depth competitions and 96 boundary pixels versus 64. This
is a camera/raster proxy, not physical wall/ceiling truth.

## G. HOLE REDUCTION

The same-input fixture reduced the raster hole fraction by 0.0048828 and more
than doubled useful pixels (280 → 600). This is a controlled synthetic result
from a coherent one-frame measured extension, not evidence that a POCO room
will receive proportional pixel coverage.

## H. CLOSE-LAYER / RECESS / PROTRUSION RESULTS

Fixtures preserve source ownership for 28 mm layers, an 8 cm protrusion,
recess front/side/back and opposing/perpendicular surfaces. Same-XY 28 mm
layers count as >22 mm overlap conflicts; laterally separated same-facing
triangles are rejected by the lateral proxy. No gap-bridging or invented vertex
was observed. The candidate's source-owned front/close depth means differ by
0.0280001 m (28.0001 mm); its actual geometry depth range is the same. The
baseline actual geometry has zero depth range because this fixture's canonical
output represents one depth band. Physical surface thickness and semantic layer
thickness are unavailable; the 28 mm result is an exact measured-source depth
separation only. These are deterministic synthetic safety results.

## I. TRIANGLE COUNT BEFORE / AFTER BOUNDED REDUNDANCY HANDLING

The controlled A/B candidate emitted 280 retained triangles from 420 raw
triangles (140 duplicate culls) and compacted to 184 vertices. The canonical
flat control emitted 70 triangles from 48 baseline surfels. The actual geometry
continuity metrics are baseline/candidate components 1/3 and boundary edges
24/82; summed triangle area is 0.021875/0.087500 m² (not union area), and the
duplicate-triangle proxy is 0/0. Desktop envelope
logs from the isolated Node fixture were:

| fixture | input samples | raw triangles | retained triangles | duplicate culls | total ms | packed bytes | working typed bytes | peak typed lower bound |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| small (4×20×20) | 1,600 | 2,888 | 722 | 2,166 | 18.2 | 26,264 | 212,048 | 362,568 |
| 130k (36×60×60) | 129,600 | 250,632 | 6,962 | 243,670 | 788.3 | 241,944 | 15,766,416 | 26,273,544 |
| 150k (42×60×60) | 151,200 | 292,404 | 6,962 | 285,442 | 834.8 | 241,944 | 18,348,780 | 30,566,772 |
| full retained (96×80×45) | 345,600 | 667,392 | 6,952 | 660,440 | 3,495.7 | 241,824 | 41,554,176 | 69,158,304 |

The full fixture respects the 96-frame evidence-mask bound.

## J. WORKER TIME

On the controlled same-input desktop run, canonical baseline worker time was
19.63 ms and M8.10 worker time was 8.81 ms. Isolated full-retained runs
observed 2,024.3–3,495.7 ms total; 3,495.7 ms (3.50 s) is retained as the
conservative decision reference. The earlier 3.50 s run was dominated by
bounded redundancy comparisons (about 3.00 s versus about 0.43 s M8.9
topology). These are desktop Node timings, not mobile or POCO timings.

## K. TRANSFER TIME

The candidate buffers are transferred once at the worker/preview seam. Exact
browser transfer time was not available in the offline Node fixture. Packed
candidate bytes are reported as a typed-buffer lower bound; transfer and clone
overhead require an interactive browser run.

## L. RENDER-UPLOAD TIME

`RealityQualityPreview` now records resource restore/setup time, the first
`renderer.render` after each prepared resource, and a rolling steady render-call
mean. These are explicitly labeled browser proxies for setup/compile/draw;
they do not measure exact GPU upload. No interactive browser measurement is
claimed here.

## M. CPU MEMORY

The service reports exact typed-array lower bounds for raw, packed, working and
peak candidate storage. JavaScript `Map`, arrays, closures and engine object
headers are not assigned invented byte sizes; browser heap peak remains
unmeasured. The full synthetic fixture reported 41,554,176 working typed bytes
and a 69,158,304-byte peak typed lower bound.

## N. GPU MEMORY ESTIMATE

The default indexed flat path uploads position, normal and index buffers in one
draw call; its estimate excludes the CPU-packed RGB evidence because the
default prepared surface uses flat diagnostic color. The controlled candidate
estimate is 7,776 B (optional registered-color estimate 8,328 B), versus 5,040
B for the canonical flat control. The full 96×80×45 candidate estimates
169,824 B without color or 180,624 B with optional registered color. The
candidate's 11,456 B packed CPU evidence is a separate value and is not a GPU
upload claim. These are estimates, not driver allocation measurements.

## O. RENDER COST

The debug A/B modes use one indexed flat draw with depth test/write and the
same persistent Three camera/orbit/viewport. Controlled synthetic audit cost
was 70 baseline versus 280 candidate input triangles; default flat upload
estimates were 5,040 B versus 7,776 B. Registered RGB is optional evidence
plumbing, not the default debug appearance path. Draw-call and steady FPS
measurements remain browser-proxy outputs. Production Final remains unchanged.

## P. APPEARANCE COMPATIBILITY

The comparison uses a flat diagnostic color so geometry is not confused with
appearance. Exact retained per-vertex RGB and normalized source-grid UVs are
packed for evidence, but there is no high-resolution texture association,
registered-RGB proof mode, texture rewrite, or appearance architecture change
in this milestone.

## Q. FILES CHANGED

Actual modified/new paths are:

`docs/SPATIAL_SCANNER_VISION.md`,
`docs/M8_10_DEPTH_KEYFRAME_PATCH_ATLAS_INTEGRATION_FEASIBILITY.md`,
`package.json`,
`src/features/scanner/components/RealityQualityPreview.tsx`,
`src/features/scanner/services/m810DepthKeyframePatchAtlasService.ts`,
`src/features/scanner/services/m810DepthKeyframePatchRenderingService.ts`,
`src/features/scanner/services/postScanCanonicalFusion.worker.ts`,
`src/features/scanner/services/postScanCanonicalFusionService.ts`,
`src/features/scanner/services/realityQuality.worker.ts`,
`src/features/scanner/services/realitySurfaceRenderingService.ts`,
`src/features/scanner/services/xrSessionService.ts`,
`src/features/scanner/types.ts`,
`tests/m88LayeredField.test.mjs`, and
`tests/m810DepthKeyframePatchAtlas.test.mjs`.

No XR/live/M7/customization code or production Final representation is changed.

## R. VALIDATION

Validation completed: `npm run test:reality` passed 224/224; the targeted
M8.10 suite passed 11/11; `npm run build` passed with the existing large-chunk
warning; `npm run lint` passed; and `git diff --check` passed with existing
CRLF conversion warnings only. The M8.10 suite includes semantic ownership,
gap/layer/protrusion/recess/noise, deterministic flat audit, overlap-proxy,
same-input A/B and 1,600/129,600/151,200/345,600-sample benchmark fixtures.
Browser GPU and POCO validation remain unavailable in this report.

## S. PATH A / B / C

The decision-gate label is **PATCH ATLAS NOT VIABLE** for the current
browser/mobile feasibility evidence: keep M8.10 experimental and do not
promote. The controlled fixture shows a useful-pixel/hole proxy improvement,
but isolated full-retained desktop runs measured 2,024.3–3,495.7 ms; the
conservative decision reference remains 3,495.7 ms (3.50 s), and no browser or
physical quality gate has passed. This is not a rejection of
all future patch-atlas research; a later bounded experiment may revisit it with
new browser/device evidence. M8.8 remains closed; M8.7.1.6 remains the
production baseline.

## T. WHETHER A POCO SCAN IS NOW JUSTIFIED

No. The synthetic A/B result is useful for debugging and establishes exact
same-input ownership/coverage instrumentation, but it does not justify a POCO
scan or a promotion claim. A future device run must measure worker time,
transfer, browser-proxy restore/first-render/steady-call timings and quality
with the same ownership/layer/gap protections.

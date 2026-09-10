# M8.9 — Next Reconstruction Architecture Feasibility

Status: **PATH A — PROTOTYPE CANDIDATE FOUND**

Decision: advance a **Measured Depth-Keyframe Patch Atlas** to one bounded
offline implementation milestone. Do not route production through it, do not
request a POCO scan, and do not change the M8.7.1.6 scanner build marker.

This report is an architecture decision, not a production-quality claim. It
combines repository evidence, published reconstruction work, browser/device
constraints, and a small source-owned topology prototype. The prototype has no
worker, renderer, UI, WebXR, or production integration.

## A. Product quality requirements

Reality must reconstruct the observed room rather than merely make it
recognizable. A credible production path needs coherent measured walls and
ceiling; preservation of approximately 28 mm close parallel layers, an 8 cm
protrusion, a 25 cm recess and its front/side/back surfaces; real openings and
unobserved gaps; sharp registered real RGB; bounded Finish time and memory; and
no invented geometry, M7 planes, synthetic texture, inferred furniture, or
automatic room closure.

Quality must be evaluated in two domains. World-space coverage and ownership
show whether measured geometry survived. Screen-space useful pixels, hole
fraction, depth competition and continuity show whether the user can actually
see a coherent reconstruction. Neither domain is a substitute for the other.

## B. Lessons carried from M8.7 / M8.8

M8.7.1.6 remains the production baseline. Its physical trace retained 345,600
measurements but represented 16,639 of 110,818 comparable 2.5 cm consolidated
cells (15.01%). Holes were already present at canonical Stage 4, while later
confidence/rendering stages displayed the surviving samples. The current
surfel path is therefore measured and layer-safe, but its global promotion and
independent-sample representation are a visible-continuity ceiling.

M8.8 proved that broader measured evidence can improve represented coverage
without inventing points or flattening close layers, recesses and protrusions.
It also proved that more world cells are not automatically a proportionate
user-visible improvement. After substantial redesign, its candidate remained
1.57–1.64× the baseline at 130k–180k input, above the preferred 1.25× envelope.
M8.8 is closed; another object-field/SoA rewrite is not justified without
screen-space benefit.

The retained contract is nevertheless valuable. Up to 96 frames preserve the
source grid dimensions, validity, normalized coordinates, measured depth,
world-space XYZ, normals, sequence, pose position/orientation and registered
per-sample RGB. The missing items are exact per-frame projection/view/depth
matrices and a stable association to the separate high-resolution RGB
keyframes. That gap matters for a real image-backed atlas and for faithful
projective TSDF/free-space integration.

## C. Candidate architectures

| Family | World-space behavior | Screen/appearance behavior | Browser/POCO outlook | Decision |
| --- | --- | --- | --- | --- |
| Existing canonical surfels | Explicit measured layers and compact output; current promotion loses coherent measured cells | Rounded splats cannot restore missing topology; texture ownership is fragmented per triangle | Proven current baseline | Retain as baseline/fallback |
| Sparse TSDF/SDF | Smooth connected zero surface and noise averaging; ordinary TSDF couples resolution and truncation to minimum separable thickness | Coherent mesh and texture atlas are natural | Sparse hashing reduces empty volume, but classic systems depend on highly parallel GPU fusion and extraction [1][2] | Reject as primary candidate; analytical control only |
| Directional/layer-aware sparse volume | Directional TSDF separates orientation sectors and supports opposing/thin surfaces [3]; because its partition key is surface direction, we infer that it does not by itself distinguish two close, same-direction parallel sheets | Can extract a coherent mesh, but seams and layer ownership remain difficult | Up to six directional fields, narrow-band updates and modified extraction materially increase state/work | Reject for the next milestone |
| Depth-keyframe/local mesh fusion | Retains the source depth grid and creates triangles only from coherent measured neighbors; independent patches naturally preserve topology and parallel layers | Direct grid continuity removes splat-footprint holes; stable patch UVs are compatible with real keyframe imagery | Linear grid traversal, typed arrays, worker execution and Three.js `BufferGeometry` fit the current stack [8] | **Top candidate** |
| Image-backed measured geometry | Does not repair missing geometry by itself | Strongest path to sharp real RGB if geometry owns stable UVs; keyframe fusion/texture mapping is known to improve appearance over vertex color [5] | Existing eight-keyframe budget is usable; exact matrices/association must be retained | Use as the appearance half of the top candidate, not a standalone geometry solution |
| Surfel remeshing | Can reconstruct thin objects without a volume and can adapt topology [4] | Produces a connected mesh and camera-resolution colors | Requires dense surfel fusion plus asynchronous remeshing; it inherits the current surfel evidence problem and adds a complex topology engine | Defer |

Sparse hashing is a credible way to scale a volume because storage can be
allocated only near observed surfaces [2]. It does not remove the TSDF
resolution/truncation tradeoff or make a CPU/JavaScript implementation
equivalent to the GPU systems in the literature.

## D. Candidates rejected early and why

- **Dense or ordinary sparse TSDF:** a room-scale 25 mm grid cannot reliably
  resolve a 28 mm same-direction layer when the truncation band spans multiple
  voxels. The directional-TSDF study explicitly identifies voxel resolution
  and truncation as the minimum-thickness constraint, and uses a four-voxel
  truncation band in its experiments [3]. Reducing the voxel size enough to
  defend 28 mm layers moves memory and extraction cost outside the comfortable
  browser envelope.
- **Directional TSDF as the answer:** its six orientation sectors solve
  opposing/orthogonal thin surfaces, not two nearby surfaces with the same
  normal direction. Adding multiple same-direction zero crossings recreates a
  layered field plus volumetric-band cost.
- **Another M8.8-style layered point field:** it is measured and semantically
  safe, but the closed experiment missed the performance gate and did not prove
  proportional screen-space improvement.
- **Global Poisson/Delaunay/hole filling:** these can span genuinely unobserved
  regions and cannot meet the ownership rule without reducing themselves to
  conservative local measured triangles.
- **Neural reconstruction, NeRF or Gaussian splatting:** training/inference,
  geometric trust, deterministic ownership and mobile WebXR cost do not match
  this milestone. Photorealistic novel-view rendering is not evidence of a
  measured, customization-safe room surface.
- **Bundle/global optimization systems:** they can improve alignment, but their
  GPU/native global optimization and reintegration scope is much larger than
  the current browser finish path. Mobile volumetric research demonstrates
  what native hybrid GPU/CPU code can do, not what this WebGL/Web Worker stack
  can assume [6].
- **WebGPU-first reconstruction:** WebGPU is available on qualifying modern
  Android Chrome devices, but WebGPU/WebXR integration is still described as
  experimental, and Three.js still describes `WebGPURenderer` as experimental
  with migration constraints [10][11]. M8.9 must not depend on it.

## E. Top candidate(s)

The top candidate is a **Measured Depth-Keyframe Patch Atlas (MDKPA)**:

1. Keep each retained depth grid as a local measured topology domain.
2. Robustly fuse only registered, small-baseline observations into selected
   depth keyframes; never complete an unsupported pixel or extrapolate an edge.
3. Triangulate coherent source-grid quads with exact measured/fused-depth
   ownership, depth-discontinuity, edge-length, normal and degeneracy gates.
4. Select bounded spatial/view patches rather than merging all observations
   into one global point hypothesis per cell.
5. Keep defended close-layer, recess and protrusion patches separate.
6. Attach stable real-image UV/keyframe ownership to each selected patch.
7. Pack selected vertices, indices, ownership and UVs into transferable typed
   arrays for the existing worker/Three.js boundary.

The current prototype implements steps 1 and 3 plus deterministic source
ownership and bounded packing. It intentionally does not implement local
multi-view depth fusion, patch selection, screen-space competition or texture
binding.

## F. Measured-layer preservation model

Layer safety moves from a global per-cell decision to patch ownership:

- Every prototype vertex stores its retained frame sequence and source sample
  index and is byte-for-byte equal to the retained XYZ.
- A triangle is emitted only inside one source depth grid; it cannot connect
  unrelated frames or distant cells.
- A 22 mm local depth-discontinuity gate prevents a quad from joining the 28 mm
  layer boundary. The layers themselves remain available as independent
  patches.
- An 8 cm protrusion and 25 cm recess remain separate because patch selection
  must compare depth order without averaging them into the backing wall.
- Recess front, side and back keep their own source topology and normals.
- A wide invalid band has no quads across it, preserving genuine unobserved
  space and real openings.

The next experiment must add **multi-view patch confidence**, not global
flattening. A one-frame false sheet may be rejected as an unsupported patch,
while a curtain or object patch survives through repeated support, viewpoint
diversity, boundary continuity and consistent depth order. No rule may equate
“frontmost” or “planar” with “correct.”

## G. World-space coverage expectation

The patch representation does not require three temporally repeated samples to
create one global surface point. Any coherent observed quad can survive as a
measured patch, so Stage-4 promotion loss is avoided. It should therefore
retain substantially more of the observed source topology than the 15.01%
canonical-cell result.

This is not permission to claim all triangle interiors as independently
measured area. World metrics for the next experiment must separately report:

- source-owned vertices and coherent measured quads;
- tangent-plane area inside accepted measured quads;
- unique versus overlapping patch area;
- depth/layer recall and error;
- genuinely unobserved area left open;
- candidate area rejected by noise, inconsistency or patch selection.

## H. Screen-space quality expectation

A coherent source quad renders as two connected triangles rather than four
independent splat footprints. This directly targets class-E footprint holes and
class-D loss caused by global promotion. It also provides a stable surface for
image projection.

The unresolved problem is overlap: dozens of nearby frame patches can create
z-fighting, duplicate sheets, high overdraw and blurred multi-view color. The
next experiment must raster-audit fixed cameras and report in-frustum
triangles, useful pixels, hole fraction, per-pixel depth winner changes,
overdraw, depth conflicts and unique/duplicate projected area. A candidate is
not successful merely because it emits many triangles.

Hole handling must remain explicit:

| Class | Required MDKPA behavior |
| --- | --- |
| A — genuinely unobserved | Keep open |
| B — measured but noisy | Robust local keyframe fusion; otherwise reject and report |
| C — repeated but inconsistent | Select/retain competing supported patches; do not average layers |
| D — coherent measured evidence lost by reconstruction | Preserve source-grid patch |
| E — renderer-footprint gap | Replace isolated splats with accepted measured triangles |
| F — physical opening/recess | Preserve discontinuity and depth ownership |

## I. Appearance compatibility

MDKPA has a better long-term appearance contract than independent canonical
surfels. Each patch originates in an image/depth grid, so it can carry stable
UV coordinates and one or more visibility-approved real keyframe IDs. Three.js
`BufferGeometry` natively carries positions, normals, colors, UVs, indices and
custom ownership attributes in GPU buffers [8]. Published RGB-D work also
shows why texture maps from fused/sharpened keyframes can outperform per-vertex
color [5].

No texture rewrite is part of M8.9. The next offline input contract must retain
exact projection/view/depth matrices and a keyframe association. It may reuse
the existing bounded eight-frame, 432×960 appearance budget. All samples remain
real RGB; no synthetic texture or image inpainting is allowed.

## J. Browser / POCO feasibility

- The prototype is TypeScript over retained typed arrays and has no native API
  dependency.
- `ArrayBuffer` ownership can be transferred to/from a worker without a data
  copy, although the sender loses access after transfer [7]. Outputs should
  therefore be packed once and transferred once.
- WebGL 2 and Three.js already support indexed `BufferGeometry`; 3D textures
  also exist in WebGL 2, but MDKPA does not require them [8][9].
- The POCO F5 uses Snapdragon 7+ Gen 2 with 8/12 GB LPDDR5 configurations [12].
  Device RAM is not a browser heap guarantee, so the milestone retains a much
  smaller explicit peak target.
- Reconstruction remains post-scan and worker-only. Live XR cadence and the
  M8.7.1.6 path stay unchanged.

## K. Compute estimate

For `F` frames of `W×H` depth samples, topology evaluation is
`O(F×W×H)`. The 80×45, 96-frame physical envelope contains 345,600 grid
samples and at most 333,696 quads / 667,392 triangles. The current desktop
prototype built that full clean envelope in 636.99 ms in an isolated targeted
run and 1,648.89 ms while the complete suite was under load. This range excludes
worker transfer, local multi-view fusion, patch selection, screen audit,
texture selection and GPU upload, and is not comparable to a POCO or the
M8.7.1.6 worker time.

At the current high tier, 96×120×68 contains 783,360 samples and at most
765,312 quads / 1,530,624 triangles. A production candidate must avoid
per-quad `Map`, object and temporary-array churn, use pre-sized/compacted
structure-of-arrays buffers, and select redundant patches before transfer.

The next same-input A/B target remains candidate reconstruction at <=1.25×
M8.7.1.6. Up to 1.5× may be reviewed only if useful screen coverage at least
doubles with preserved depth semantics. Multiple-times-baseline cost is a
failure.

## L. Memory estimate

The prototype packs 32 bytes per emitted vertex (position, normal, frame and
sample ownership) and 12 bytes per triangle. At 96×80×45 clean input it emitted
19,067,904 bytes (18.19 MiB). Adding the physical retained input (~13.65 MiB)
and the existing eight appearance keyframes (~9.49 MiB) yields ~41.3 MiB of
known numeric/RGB data before worker/main overlap, patch indexes, selection
work, UVs, texture GPU storage and `BufferGeometry` upload.

The all-valid 120×68 upper bound is ~41.42 MiB packed patch output. Together
with up to ~33.6 MiB retained typed input and ~9.49 MiB RGB, it is ~84.5 MiB
before duplicates and working/GPU copies. A practical implementation should
target <=128 MiB peak at the 80×45 tier and <=192 MiB at the high tier, with a
hard 256 MiB stop. Heap, GPU and simultaneous worker/main peaks must be
measured; raw array totals alone are insufficient.

## M. Prototype results

The isolated `m89DepthKeyframePatchService` and its deterministic test harness
produced:

| Fixture | Result |
| --- | --- |
| Clean planes | Every fully observed coherent quad accepted; exact source ownership |
| Genuine grid gap | Missing-vertex quads rejected; no triangle crosses the invalid band |
| 28 mm parallel layers + 8 cm protrusion | All depth bands retained as separate source-owned patches |
| 25 cm recess + side + wall/ceiling | Front/back and X/Y/Z normal families retained |
| Isolated false-forward sample | Surrounding joins rejected by the 22 mm depth gate; no replacement invented |
| 36 mm noisy surface | Unsafe joins rejected; demonstrates need for bounded local depth fusion rather than a looser gate |
| Determinism | Positions, normals, indices, ownership, patches and diagnostics repeat exactly |
| 96×80×45 scale | 345,600 vertices; 667,392 triangles; 18.19 MiB packed; 636.99–1,648.89 ms desktop depending on process load; zero capacity/ownership violations |

The prototype reports screen-space coverage as unavailable because the current
retained snapshot omits the exact matrices required for a faithful projection.
That is an evidence result, not a metric to approximate from guessed camera
parameters.

## N. Risks

1. Overlapping patches can cause duplicate geometry, z-fighting and overdraw.
2. Pose/depth noise can make two valid views disagree; patch-level robust
   selection/fusion is required.
3. The 22 mm gate protects close layers but rejects 36 mm noisy joins. Local
   multi-view denoising must improve class B/C without filling class A.
4. Full-grid output is bounded but still large; patch selection must lower
   transfer and GPU load without returning to global cell loss.
5. The current retained contract lacks exact projection/view/depth matrices and
   RGB-keyframe association.
6. A whole false patch can be internally coherent. It needs independent
   multi-view confidence and depth competition; the prototype only rejects
   local discontinuous joins.
7. Texture seams/exposure changes remain possible even with stable UVs.
8. Desktop synthetic time and packed bytes do not establish mobile heap, GC,
   upload, WebGL or WebXR behavior.

## O. Recommended architecture

Advance MDKPA as an experimental post-scan branch beside the unchanged
M8.7.1.6 baseline. The architecture should use selected, locally fused depth
keyframes as topology-bearing patches; exact measured depth/RGB ownership;
bounded patch-level multi-view confidence; explicit competing depth layers;
source-grid conservative triangulation; and a packed indexed mesh with stable
real-image UV ownership.

Do not globally weld vertices, flatten patches, fill invalid regions, infer a
room envelope, or loosen the 22 mm boundary merely to improve triangle count.
Keep the canonical surfel output available as the control/fallback until the
new branch passes the complete gate.

## P. Path A / B / C

**PATH A — PROTOTYPE CANDIDATE FOUND.** MDKPA has the strongest combined
evidence for measured topology, same-direction layer preservation, visual
continuity, image compatibility and browser-feasible linear work. Sparse and
directional volumes remain useful analytical comparisons but are not close
enough to justify a second implementation now.

## Q. Whether a new implementation milestone is justified

Yes: one bounded **M8.9.1 offline A/B** is justified. It must:

1. Extend only the experimental snapshot/harness with exact matrices and stable
   RGB-keyframe associations.
2. Fuse small-baseline measurements into selected depth keyframes without
   completing unsupported pixels.
3. Add deterministic spatial/view patch scoring, overlap/depth-conflict
   accounting and defended secondary-layer retention.
4. Render/raster-audit the baseline and MDKPA from identical fixed views.
5. Report unique measured area, useful screen pixels, hole fraction, depth
   error/competition, overdraw, layer/recess/protrusion/gap recall, time, peak
   heap/GPU estimates and transfer bytes.

Success gates:

- zero invented/unowned vertices and no triangle across a genuine gap;
- >=95% recall for 28 mm layers, protrusion, recess front/side/back,
  perpendicular surfaces and true openings;
- at least 2× baseline useful screen-pixel coverage on coherent observed
  surfaces, or at least 50% lower screen-space hole fraction;
- no material increase in wrong-depth winning pixels (report >22 mm and >50 mm
  error bands separately);
- deterministic packed output;
- <=1.25× same-input baseline worker time, subject only to the exceptional
  quality tradeoff in section K;
- <=128 MiB measured peak at the current 80×45 tier and no >50 ms
  post-paint main-thread task.

Failure is any invented area, close-layer merge, recess/protrusion loss,
screen-space gain dominated by overlap/wrong depth, multiple-times-baseline
cost, or uncontrolled memory/GC.

## R. Whether POCO testing is justified yet

**No.** The topology prototype is strong enough to select a candidate, but it
has not measured screen-space improvement, patch competition, local fusion,
texture UV behavior, real worker transfer, peak browser/GPU memory or mobile
runtime. A POCO test is justified only after M8.9.1 passes the synthetic/replay
gates above. M8.7.1.6 remains production; M8.8 remains closed; M7 and
customization remain frozen.

## Sources

1. [KinectFusion: Real-Time Dense Surface Mapping and Tracking](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/ismar_2011.pdf) — weighted global TSDF fusion, depth-boundary handling and GPU execution.
2. [Real-time 3D Reconstruction at Scale using Voxel Hashing](https://graphics.stanford.edu/~niessner/papers/2013/4hashing/niessner2013hashing.pdf) — sparse observed-surface allocation and GPU voxel-block integration.
3. [Directional TSDF: Modeling Surface Orientation for Coherent Meshes](https://www.ais.uni-bonn.de/papers/IROS_2019_Splietker.pdf) — thin-surface failure of ordinary TSDF, six directional fields and modified extraction.
4. [SurfelMeshing: Online Surfel-Based Mesh Reconstruction](https://arxiv.org/abs/1810.00729) — non-volumetric surfel remeshing, thin objects and camera-resolution color.
5. [Super-resolution Keyframe Fusion for 3D Modeling with High-Quality Textures](https://www.cs.princeton.edu/courses/archive/fall16/cos526/papers/maier15.pdf) — fused RGB-D keyframes and texture mapping versus vertex color.
6. [MobileFusion: Real-time Volumetric Surface Reconstruction and Dense Tracking on Mobile Phones](https://www.microsoft.com/en-us/research/publication/mobilefusion-real-time-volumetric-surface-reconstruction-dense-tracking-mobile-phones/) — native hybrid GPU/CPU mobile volumetric precedent and its scope.
7. [MDN: Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) — `ArrayBuffer` ownership transfer semantics.
8. [Three.js: BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html) — indexed positions, normals, colors, UVs and custom buffer attributes.
9. [MDN: WebGL2 `texImage3D`](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/texImage3D) — browser 3D texture availability.
10. [Chrome for Developers: WebGPU on Android](https://developer.chrome.com/blog/new-in-webgpu-121) and [WebGPU/WebXR experiment](https://developer.chrome.com/blog/new-in-webgpu-135) — Android availability and experimental XR integration status.
11. [Three.js: WebGPURenderer](https://threejs.org/manual/en/webgpurenderer) — experimental renderer and migration constraints.
12. [POCO F5 specifications](https://www.mi.com/global/product/poco-f5/) — Snapdragon 7+ Gen 2 and LPDDR5 target-device facts.

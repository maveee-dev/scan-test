# M8.11 — Reality Delivery Architecture Decision

Status: **PATH B — HYBRID VISUAL/DESIGN ARCHITECTURE FOUND**

Verdict: **M8.7.1.6 remains production; M8.8 and M8.10 remain closed; no
POCO scan is justified.**

This is an architecture decision report, not a production implementation or a
physical-quality claim. It keeps measured Reality separate from the structural
and interaction representation needed for later design work.

## A. WHY M8.8 STOPPED

**PROVEN IN THIS REPOSITORY.** M8.8 increased measured representation while
preserving source ownership, close layers, recesses and protrusions, but it
did not meet the runtime envelope. The final large-input medians in
[`M8_8_LAYERED_MEASURED_SURFACE_FIELD_FEASIBILITY.md`](M8_8_LAYERED_MEASURED_SURFACE_FIELD_FEASIBILITY.md)
were 1.57–1.64× the M8.7.1.6 baseline at 130k–180k samples. The candidate
also carried the cost of consolidation, integration, adjacency, components,
support/promotion and diagnostics. The measured physical envelope is
96 × 3,600 = 345,600 retained samples, while the retained-frame consolidation
cap is 1,600 samples per frame (`src/features/scanner/services/retainedRealityMeasurementService.ts:5-12`).

**ARCHITECTURAL INFERENCE.** More global field work is not a safe product
strategy when proportional screen-space benefit has not been demonstrated.
M8.8 is useful evidence about layer-aware semantics, not a candidate to
restart or promote.

## B. WHY M8.10 STOPPED

**PROVEN IN THIS REPOSITORY.** M8.10 preserved exact measured source ownership
and improved a controlled camera/raster proxy, but full-room construction was
2,024.3–3,495.7 ms on isolated desktop runs for 345,600 input samples. Its
full run emitted 667,392 raw and 6,952 retained triangles, with
41,554,176 working typed bytes and a 69,158,304-byte typed lower-bound peak.
The conservative decision reference is 3,495.7 ms; no mobile browser worker,
GPU upload, or POCO result exists. See
[`M8_10_DEPTH_KEYFRAME_PATCH_ATLAS_INTEGRATION_FEASIBILITY.md`](M8_10_DEPTH_KEYFRAME_PATCH_ATLAS_INTEGRATION_FEASIBILITY.md).

The same report's synthetic same-input audit improved useful pixels 280 → 600
and reduced its raster hole fraction 0.9957 → 0.9908, but those are fixed
camera proxies, not physical room coverage. Exact RGB/depth image association
and browser GPU upload were not available.

**ARCHITECTURAL INFERENCE.** M8.10 established useful instrumentation and
ownership rules, not a browser-feasible global patch atlas. It remains closed
on **Path C — PATCH ATLAS NOT VIABLE** for the current browser/mobile gate;
future patch-atlas research is not prohibited, but it requires a new contract
and new device evidence.

## C. CORE PRODUCT REQUIREMENTS

**PROVEN IN THIS REPOSITORY.** The product goal and scanner scope in
`frontend/AGENTS.md` require browser-based Android WebXR/ARCore scanning,
measured depth, real spatial samples and feature detection. The visual result
must correspond to actual observations. The requested product requirements
are: recognizable real walls/floor/ceiling and objects, real protrusions,
recesses and openings, useful appearance, few distracting holes, sufficient
sharpness, practical mobile/browser runtime and later customization without
inventing geometry.

The safety requirements used by M8.8/M8.10 remain mandatory: preserve measured
28 mm nearby layers, 8 cm protrusions, recess front/side/back, object surfaces,
openings and genuinely unobserved gaps. Smoothing is not allowed to erase
these distinctions.

**ARCHITECTURAL INFERENCE.** The acceptance metric must combine screen-space
continuity and appearance with depth correctness, layer/gap safety,
interaction usefulness, CPU/GPU cost and memory. Point count, cell count,
triangle count and world-space coverage are insufficient on their own.

## D. DOES ONE GLOBAL DENSE 3D REPRESENTATION REMAIN NECESSARY?

No. The repository shows two responsibilities with different loss functions:

* visual Reality should retain measured RGB/depth ownership, invalid-depth
  gaps and view-dependent appearance;
* structural/design/picking geometry can be simplified only where its measured
  semantics remain safe for interaction and material placement.

**PROVEN IN THIS REPOSITORY.** Structural association and design compositing
  already have separate seams. `realityStructuralAssociationService.ts:147-179`
  creates a compact association table, while
  `realityDesignCompositingService.ts:8-32,207-314` keeps design masks
  render-time and preserves Reality cells. Picking in
  `FinalizedSpatialScanPreview.tsx:1326-1482` distinguishes room surfaces
  from frontmost Reality triangles. These seams do not prove a new visual
  renderer, but they demonstrate that one representation is not required for
  every responsibility.

**ARCHITECTURAL INFERENCE.** A hybrid is the smallest credible way to improve
  visual usefulness without making a simplified M7/design surface impersonate
  missing Reality evidence. Visual Reality must remain measured; design
  geometry must not fill or hide unobserved visual gaps.

## E. CANDIDATE ARCHITECTURES

The six families below are the serious candidates requested for comparison.
The labels are also used in the ranking below and the resource envelope in
section K.

1. **A — Current global surfel baseline.** M8.7.1.6 remains the production
   reference. It is measured and browser-compatible, but global fusion loses
   screen-space photographic detail and can expose holes.
2. **B — View-dependent measured RGB-D/layered-depth rendering.** Keep selected
   source RGB-D views, their projection/pose and validity, and render measured
   image-space patches or layered depth from the best source views. Blend or
   switch views only where ownership and depth gates pass; keep invalid pixels
   invalid.
3. **C — Compact measured oriented splats.** Use measured points with oriented
   footprints to improve screen continuity without a dense global triangle
   field. Splat footprints must come from measured support; they must not bridge
   a defended layer or an invalid-depth gap.
4. **D — Hybrid visual Reality plus separate design geometry.** Use B (with C
   only as a measured disocclusion fallback) for visual Reality, and retain a
   separate measured structural/canonical representation for picking,
   interaction and later customization.
5. **E — Off-device/server post-processing.** Upload a bounded measured packet,
   process it away from the phone and return a renderable result. This could
   reduce local CPU pressure but adds privacy, latency, backend and transfer
   requirements that are not present in the current browser product.
6. **F — Native-mobile processing.** A boundary case using native AR/depth
   APIs. It can expose capabilities unavailable to the web target, but would
   abandon the current browser architecture and is not justified by the
   repository evidence.

### 12-criteria ranking

The following is a decision matrix, not a benchmark. Scores are 1 (weak) to 5
(strong); for **implementation complexity** and **risk**, 5 means simplest or
lowest risk. A/B/C/D/E/F refer to the six families above. Repository-measured
results anchor A, M8.8 and M8.10; the remaining scores are architectural
inference and are intentionally conservative.

| Criterion | A global surfels | B view-dependent RGB-D | C measured splats | D hybrid visual/design | E off-device | F native boundary |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| measured fidelity | 4 | 5 | 4 | 5 | 5 | 5 |
| screen-space quality | 2 | 5 | 4 | 5 | 5 | 5 |
| photographic sharpness potential | 2 | 5 | 3 | 5 | 5 | 5 |
| layer preservation | 5 | 5 | 5 | 5 | 5 | 5 |
| full-room scalability | 3 | 4 | 4 | 4 | 5 | 5 |
| CPU cost | 3 | 4 | 4 | 4 | 5 | 5 |
| GPU cost | 3 | 3 | 4 | 3 | 5 | 5 |
| memory | 3 | 3 | 4 | 3 | 5 | 5 |
| implementation simplicity | 5 | 2 | 3 | 3 | 1 | 1 |
| browser compatibility | 4 | 2 | 4 | 3 | 4 | 1 |
| later customization suitability | 3 | 2 | 2 | 5 | 4 | 4 |
| risk (5 = lowest) | 4 | 2 | 3 | 4 | 2 | 1 |

The decision ordering after applying the browser/product scope gate is **D,
B, C, A, E, F**. E and F can score well for local compute only by moving the
problem outside the current browser architecture; their transfer, privacy,
operational and product risks prevent them from outranking D. B supplies the
visual technique, while D supplies the required separation of visual Reality
from design responsibilities.

## F. VISUAL REALITY VS DESIGN-GEOMETRY SEPARATION ANALYSIS

**PROVEN IN THIS REPOSITORY.** The retained snapshot stores measured world
   `DenseSpatialPointFrame` columns, rows, normalized coordinates, depth,
   points, normals and counts (`src/features/scanner/types.ts:176-188`).
`FinalizedDenseRealityReconstruction` keeps the canonical surfels and the
experimental M8.10 result separately (`types.ts:819-850`). Structural
association is a typed table rather than an instruction to replace Reality.

The source contract is not yet sufficient for true view-dependent RGB-D:
`RetainedRealityMeasurementFrame` retains pose, dense arrays, normals and
optional RGB (`retainedRealityMeasurementService.ts:20-35`), but not the exact
per-frame view/projection/depth transforms needed to reprojection-match a
photographic keyframe. Those matrices exist transiently in
`RealityMeasurementPacket` (`realityMeasurementStabilityService.ts:7-78`) and
are dropped when the retained dense frame is created. RGB keyframes retain RGB,
camera transforms, projection and mapping (`types.ts:855-920`), but no matched
depth image/validity contract.

**ARCHITECTURAL INFERENCE.** The delivery shape should be:

```text
exact captured RGB + depth + pose
             ├── measured visual Reality (view-dependent, gaps retained)
             └── measured structural/design geometry (separate, simplified only where safe)
```

M7 or a simplified design surface must never be used as visual Reality merely
to conceal missing measurements. This is why D is the decision path even
though B supplies the visual rendering technique.

## G. SCREEN-SPACE QUALITY POTENTIAL

**PROVEN IN THIS REPOSITORY.** M8.10's deterministic audit showed that extra
measured source triangles can increase useful pixels in a fixed camera, but
the improvement was only a synthetic proxy. M8.7.1.6's current rendering
uses measured-oriented splats: `realitySurfaceRenderingService.ts:788-866`
builds six vertices per surfel and `realityQuality.worker.ts:83-137` selects
baseline modes. M8.10's one indexed flat draw is debug-only.

**EXTERNAL TECHNICAL EVIDENCE.** Layered image representations preserve
view-dependent samples and visibility ordering in image space; see Shade et
al., [Layered Depth Images](https://doi.org/10.1145/280814.280882). Surface
splatting describes screen-space footprints for point samples; see Zwicker et
al., [Surface Splatting](https://doi.org/10.1145/383259.383300). These papers
support the mechanism, not a mobile-browser performance guarantee.

**ARCHITECTURAL INFERENCE.** B/D should be judged by useful pixels, hole rate,
depth competition and sharpness proxy from the same camera, not by added world
triangles. A compact measured splat fallback is appropriate only for measured
disocclusion support that no selected RGB-D view covers.

## H. PHOTOGRAPHIC QUALITY POTENTIAL

**PROVEN IN THIS REPOSITORY.** The current RGB path captures bounded camera
images. `xrRawCameraService.ts:17-24,586-655` caps generic copies at 320×180,
appearance copies at 432×960, and `realityRgbKeyframeService.ts:10-17,145-203`
retains at most 12 generic or 8 appearance keyframes with camera metadata.
The historical appearance cap is 9.49 MiB of RGB source bytes for eight
432×960 frames. Current final rendering can use image batches, but no exact
matched depth image is retained alongside each photographic keyframe.

**EXTERNAL TECHNICAL EVIDENCE.** WebXR Raw Camera Access describes a
pose-aligned opaque camera texture with frame lifetime and privacy/consent
constraints; see the [Raw Camera Access specification](https://immersive-web.github.io/raw-camera-access/).
The [WebXR Depth Sensing specification](https://www.w3.org/TR/webxr-depth-sensing-1/)
defines depth buffers and the view/projection relationship exposed by a
supported XR session. Neither specification promises that every browser
exposes a persistent, matched RGB-D archive at the application’s desired
resolution.

**ARCHITECTURAL INFERENCE.** Preserve camera-space photographic evidence until
display time. Reconstructing a large global geometry first and trying to
reassociate imagery afterward repeats the exact ownership problem that blocks
M8.12. B/D offers the best route to sharper walls, posters, curtains and
object edges while leaving depth gaps visible when no measured pixel exists.

## I. LAYER / RECESS / OBJECT SAFETY

**PROVEN IN THIS REPOSITORY.** M8.8 and M8.10 semantic fixtures preserve
28 mm parallel layers, 8 cm protrusions, recess front/side/back, opposing and
perpendicular normals, noise and genuine source gaps. M8.10 explicitly reports
same-XY 28 mm depth conflicts and does not bridge invalid source-grid cells.
These are deterministic synthetic safety results, not physical-room recall.

**EXTERNAL TECHNICAL EVIDENCE.** Google’s [ARCore Raw Depth documentation](https://developers.google.com/ar/develop/java/depth/raw-depth)
describes raw depth as sparse with confidence/accuracy and compute tradeoffs.
It is useful context for why validity/confidence must travel with a measured
view, but it is a native API reference and not evidence that the browser
contract exposes the same payload.

**ARCHITECTURAL INFERENCE.** B/D must use strict per-source depth,
discontinuity, normal and confidence gates; no global merge may flatten close
layers, recess sides, furniture, curtains or openings. Invalid depth remains a
hole. A measured oriented splat may support a visible measured disocclusion,
but may not invent a surface between samples.

## J. FULL-ROOM SCALABILITY

**PROVEN IN THIS REPOSITORY.** The physical learned envelope is 96 retained
frames × 3,600 sampled depth values = 345,600 samples. The retained service
caps frames at 96 and per-frame consolidation at 1,600 samples. M8.10's full
fixture used that 96-frame mask and measured 2.02–3.50 s desktop construction;
M8.8's 130k–180k runs were already 1.57–1.64× the baseline. The current
post-scan service sends the retained typed buffers to a worker once and returns
baseline/M8.10 typed results (`postScanCanonicalFusionService.ts:9-149`,
`postScanCanonicalFusion.worker.ts:10-49`).

**ARCHITECTURAL INFERENCE.** A full-room architecture should select a small
number of source views at display time instead of globally joining every
sample. Four walls, floor, ceiling, furniture and overlapping depth surfaces
still require enough view diversity; selecting 2–4 best measured views per
display region is a bounded design, not a promise that four images cover every
room. The M8.12 proof must use a full-room envelope and preserve the 96-frame
evidence bound.

## K. CPU / GPU / MEMORY ESTIMATES

The following numbers distinguish measured repository values from planning
estimates. `MB` means decimal bytes where shown; `MiB` means 2²⁰ bytes.

**PROVEN IN THIS REPOSITORY.**

| Item | Evidence at full learned envelope |
| --- | ---: |
| Retained depth samples | 345,600 (96 × 80 × 45) |
| M8.7 dense numeric lower-bound formula | 180,000 × 104 = 18,720,000 B (17.85 MiB) before color; scaling that formula to 345,600 is 35,942,400 B (34.27 MiB), not a measured heap peak |
| M8.10 candidate | 667,392 raw / 6,952 retained triangles; 241,824 packed B; 41,554,176 working typed B; 69,158,304 typed lower-bound peak |
| M8.10 construction time | 2,024.3–3,495.7 ms isolated desktop runs; 3,495.7 ms remains the conservative reference |
| M8.10 default flat GPU estimate | 169,824 B (positions + normals + indices); optional registered RGB 180,624 B |
| Current appearance RGB | 8 × 432 × 960 capped source RGB = 9,953,280 B (9.49 MiB) |
| Current global canonical result | 17,961 canonical surfels and 16,639 cells in the documented physical result |
| Current retained frame buffers | 345,600 samples require about 12.52 MiB without registered color, or 14.83 MiB if every sample has the existing index + RGB payload; object/hash metadata is additional |

### Per-family operational envelope

This table answers the requested capture, post-scan, display, GPU, memory and
transfer comparison for every serious family. Entries marked **measured** come
from this repository. Entries marked **estimate** are planning envelopes, not
device results. For E, low device CPU/GPU cost would merely move computation to
an unmeasured server; it is not low total-system cost.

| Family | Capture CPU | Post-scan CPU | Display CPU/GPU | Memory | Worker / network transfer |
| --- | --- | --- | --- | --- | --- |
| A — global surfels | Current bounded depth/RGB capture; no added work | Current global replay remains required; the documented preceding physical pipeline was 6,915.4 ms worker compute, with 4,178.5 ms in replay matching (**measured**, M8.7.1.5 input to the M8.7.1.6 change) | Existing triangle skin plus splat passes; 6 expanded vertices per rendered surfel, fragment cost depends on splat overlap (**measured layout**, device cost unknown) | Retained frame buffers 12.52–14.83 MiB plus global fusion state; 17,961-surfels splat attribute arithmetic is ~3.29 MiB before triangle/image resources | Nine typed-buffer families per retained frame are transferred once to the worker; their numeric payload is included in the retained-buffer bound (**measured contract**) |
| B — view-dependent RGB-D | Must retain exact synchronized camera/depth ownership; copying 8 current-size RGB frames is 9.49 MiB and depth/validity adds 0.14 MiB at 80×45 or 15.82 MiB at 432×960 (**estimate**) | Bounded view indexing/selection and source-grid preparation rather than all-view fusion; time is unknown and is an M8.12 gate | 2–4 source-view patch draws plus depth competition; roughly 2–4 layers of relevant-screen fragments, texture samples and possible overdraw (**estimate**); vertices depend on valid source-grid topology | 2–4 RGB + full-resolution depth/validity views are ~12.7 MiB, or eight are ~25.3 MiB, before working buffers (**estimate**) | One bounded RGB-D contract to a worker/GPU; no network. Exact copied bytes and ownership lifetime must be measured in M8.12 |
| C — measured oriented splats | Current capture can be reused | If fed by current canonical surfels, current replay cost and its holes remain; a direct measured compaction/index would be new and unmeasured | One or a few batched/instanced draws are plausible; fragment overdraw grows with footprint and view overlap (**estimate**) | ~3.29 MiB attributes for 17,961 expanded splats, but ~63.3 MiB for all 345,600 samples using the current six-vertex layout (**arithmetic lower bounds**) | Existing retained typed transfer if canonical; a direct path still transfers a 12.52–14.83 MiB numeric/color envelope before compact output (**estimate**) |
| D — hybrid visual/design | Same exact RGB-D capture requirement as B; structural capture remains unchanged | Bounded B preparation plus the existing measured structural/design build. Avoiding duplicate XYZ and image copies is a required gate | B visual draws plus separate, selectively visible picking/design geometry; more resources than B alone but visual quality is not limited by design simplification (**estimate**) | B's ~12.7–25.3 MiB visual envelope plus existing structural state; shared source buffers and lazy design resources are required to stay bounded (**estimate**) | B visual contract plus existing structural worker transfer; no network and no second full capture copy by design |
| E — off-device | Same local capture and serialization as B/D | Low device post-scan CPU is possible, but server time, queueing and result conversion are wholly unmeasured | Returned-result cost depends on an unspecified format; no credible vertex/fragment/draw bound exists yet | Local upload staging plus returned result; server working memory unknown | Four raw full RGB-D views are ~12.7 MiB: link-only lower bound ~10.2 s at 10 Mb/s or ~1.0 s at 100 Mb/s; eight views double it (**estimate**) |
| F — native boundary | Native APIs could change capture access and synchronization, but no repository implementation or benchmark exists | Unknown; native compute is not evidence of meeting the current web product | Unknown; native GPU capability is outside the present WebGL renderer | Unknown | No worker/network requirement is implied, but app installation/distribution replaces the browser delivery model |

**ARCHITECTURAL INFERENCE / ASSUMPTIONS.** For an M8.12 view-dependent proof,
assume 2–4 selected 432×960 RGB views and 80×45 measured depth grids:

* 2–4 RGB sources are about 2.37–4.75 MiB as packed RGB. If a browser GPU
  expands them to RGBA, the texture lower bound is about 3.17–6.33 MiB;
  driver allocation, mipmaps and color conversion remain unknown.
* One 80×45 float32 depth grid plus one byte of validity is 18,000 B; 8 views
  are 144,000 B. A full 432×960 float32 depth plus one validity byte would be
  2,073,600 B per view, or 7.91 MiB for four views and 15.82 MiB for eight.
  The current retained contract does not provide that full image, so these are
  explicit planning bounds rather than repository measurements.
* Four views with RGB plus full-resolution float depth/validity are about
  12.7 MiB before matrices, confidence, compression or working buffers. Eight
  views are about 25.3 MiB. The existing retained world samples may still be
  present for structural/design use; avoiding a second XYZ copy is an M8.12
  design requirement, not a current measurement.
* The current six-vertex, 3-position/3-color/2-local-float splat layout is
  32 B/vertex before indices/materials. The documented 17,961 canonical
  surfels therefore imply about 3.29 MiB of attribute bytes if all use six
  vertices; making every 345,600 measured sample a splat would be about
  63.3 MiB of attributes. These are arithmetic lower bounds, not current
  allocations.
* The M8.10 desktop measurement is the only large candidate CPU timing. A
  2–4× mobile-browser planning multiplier gives roughly 4.0–14.0 s for that
  global construction, but no mobile benchmark supports the multiplier. A
  view-dependent proof must measure capture, worker, display preparation and
  steady render separately rather than infer success from desktop time.
* Worker accounting is likewise bounded by the existing seam: the same
  retained typed buffers are sent once to `postScanCanonicalFusion.worker.ts`
  and candidate buffers return once. The current 2.02–3.50 s M8.10 number is
  an offline construction/worker proxy, not a browser worker measurement;
  capture-loop CPU, browser clone/transfer time and view-dependent display
  preparation are unknown and must be measured in M8.12.

**OFF-DEVICE NETWORK ASSUMPTION.** If four full RGB-D views (about 12.7 MiB
before metadata) were uploaded, the raw link-time lower bound is roughly
10.2 s at 10 Mb/s or 1.0 s at 100 Mb/s, before TLS, upload latency, service
queueing, processing and download. Eight views double those values. This is a
planning estimate only; it is not a recommendation to add a backend.

## L. BROWSER FEASIBILITY

**PROVEN IN THIS REPOSITORY.** The app already uses WebXR depth sensing with
`cpu-optimized` usage, selected depth formats and `matchDepthView: true`
(`xrSessionService.ts:706-714`), but `xrDepthService.ts:367-465` samples a
bounded 16×9 diagnostic grid and the retained product grid is 80×45. Worker
transfer is typed-buffer based. `realitySurfaceRenderingService.ts:1131-1159`
has an indexed flat debug path, while the production path also carries splat
and image resources.

**EXTERNAL TECHNICAL EVIDENCE.** [WebGL 2](https://registry.khronos.org/webgl/specs/latest/2.0/)
provides the buffer, texture and shader primitives needed by all local
candidates; it does not guarantee mobile shader throughput, texture residency,
upload time, or fragment cost. WebXR depth and camera specifications likewise
define interfaces and privacy/availability conditions, not this app’s full-room
performance.

**ARCHITECTURAL INFERENCE.** B/D is browser-feasible enough to justify one
bounded contract-and-browser proof because it can cap selected views and
avoid another global all-sample fusion. It is not yet production-feasible:
matched RGB-D ownership, browser upload and mobile timing are unmeasured.

## M. OFF-DEVICE OPTION ANALYSIS

Off-device processing could move global fusion or view selection off the phone,
but the repository currently has no backend, cloud-processing scope or secure
upload contract. It would have to transmit RGB/depth/pose ownership, preserve
privacy and consent, tolerate 10–100 Mb/s variability, wait for service
latency, download a result and still render it in mobile WebGL. The rough
12.7–25.3 MiB four/eight-view payload estimate in section K makes the latency
trade-off material.

**ARCHITECTURAL INFERENCE.** E is not the next step: it changes product
scope, privacy and operational architecture before local measured evidence is
complete. It becomes a bounded experiment only if a local M8.12 proof shows
that the exact contract is good but local CPU is the sole failing gate. No
server or network path is added in M8.11.

## N. SMALL PROTOTYPE RESULTS, IF ANY

No M8.11 prototype was added.

**PROVEN IN THIS REPOSITORY.** M8.9/M8.10 already provide isolated topology,
ownership and deterministic screen-audit fixtures. They do not contain an
exact synchronized RGB-D keyframe contract. A synthetic view-dependent demo
would therefore reuse invented or unmatched associations and could not answer
the product risk.

**ARCHITECTURAL INFERENCE.** Stop at the contract decision. The next proof
must be offline and same-input, but it must retain the exact matrices,
timestamps, depth validity/confidence and RGB ownership needed to make its
result representative. This avoids another large integration whose central
input relationship is still unproven.

## O. RECOMMENDED ARCHITECTURE

Choose **Path B — Hybrid Visual/Design Architecture**:

1. Keep M8.7.1.6 as the production baseline until a measured browser/device
   gate passes.
2. Add a bounded visual Reality contract for 8–12 exact synchronized,
   application-owned RGB-D keyframes: RGB, depth validity/confidence when
   exposed, complete view/projection/camera transforms, timestamps/sequence,
   source-grid coordinates and ownership.
3. Render 2–4 best measured source views with source-grid topology/UV and
   strict depth, discontinuity, normal and confidence gates. Keep invalid
   pixels as holes. Use an optional compact measured oriented-splat fallback
   only for genuinely measured disocclusion support.
4. Keep structural/design/picking geometry separate and measured. It may be
   simplified for interaction/material placement, but it may not replace the
   visual Reality layer or hide missing measurements.
5. Do not globally merge all selected views in the first proof. Measure view
   selection, overlap, depth competition and fallback ownership explicitly.

The [Layered Depth Images](https://doi.org/10.1145/280814.280882),
[Surface Splatting](https://doi.org/10.1145/383259.383300) and
[QSplat](https://www.cs.princeton.edu/~smr/papers/qsplat/) papers are useful
technical precedents for view-dependent layers, measured footprints and
hierarchical point display; none is evidence of this browser implementation.

## P. PATH A / B / C / D

**PATH A — NEW LOCAL-WEB ARCHITECTURE FOUND:** not selected. A new single
global local representation has not beaten the measured cost/quality trade-off;
M8.8 and M8.10 both stopped before that gate.

**PATH B — HYBRID VISUAL/DESIGN ARCHITECTURE FOUND:** selected. It directly
addresses the repository’s split responsibilities: measured source-owned
visual Reality for appearance and gaps, separate measured structural/design
geometry for interaction and customization.

**PATH C — OFF-DEVICE PROCESSING SHOULD BE TESTED:** deferred. No evidence
shows that local CPU is the only blocker, and the current repository has no
network/backend/privacy contract.

**PATH D — WEB TARGET ITSELF NEEDS REASSESSMENT:** not selected. WebXR,
WebGL2, typed worker transfer, source-owned samples and bounded keyframes
remain credible foundations. Native would be reconsidered only after a fair
M8.12 browser proof fails despite a valid exact contract.

## Q. NEXT IMPLEMENTATION MILESTONE

This M8.11 documentation change touched only:
`docs/M8_11_REALITY_DELIVERY_ARCHITECTURE_DECISION.md` and
`docs/SPATIAL_SCANNER_VISION.md`. No source, test, package, XR, M7 or
customization files were changed.

M8.12 should be a bounded contract plus offline same-input browser proof, not
production integration:

1. Retain 8–12 exact synchronized application-owned RGB-D keyframes with
   depth validity/confidence when exposed, complete view/projection/camera
   transforms, timestamps, frame sequence and source-grid ownership.
2. Use the same retained snapshot for M8.7.1.6 baseline and the experimental
   candidate. Render 2–4 best measured source views with source-grid topology,
   UV ownership and strict depth/discontinuity gates; optionally render only
   measured splat disocclusion support.
3. Compare one fixed camera/viewport and persistent controls. Record valid
   input samples, represented samples, summed triangle/patch area proxies,
   unique-union availability, topology/boundary continuity, depth conflicts,
   28 mm layer separation, recess/protrusion/gap safety and ownership.
4. Record capture cost, worker CPU, transfer time, resource restore/setup,
   first render, steady render/FPS/draw calls, typed CPU memory, browser heap
   where available, GPU buffer/texture estimates and mobile-browser timing.
5. Keep visual Reality and design geometry separate. No global cross-view
   merge, inferred fill, high-resolution image association guesses or M7
   visual substitution.

## R. WHETHER POCO TESTING IS JUSTIFIED

No. POCO testing is not justified until the M8.12 proof passes a real browser
and mobile feasibility gate with the exact RGB-D ownership contract. Minimum
gates are:

* zero invented vertices/pixels and exact source ownership;
* at least 95% recall of measured 28 mm layers, recess fronts/sides/backs,
  protrusions, openings and genuine gaps in deterministic fixtures;
* materially better screen-space useful pixels or at least 50% hole reduction
  without wrong-depth increase;
* worker plus preparation at no more than 1.25× the M8.7.1.6 baseline on the
  same input, no single added main-thread task slice above 50 ms after the
  processing paint, and measured mobile memory within the agreed envelope
  (target ≤128 MiB typed/working peak);
* browser upload/first/steady render and draw-call evidence on the target
  class, not desktop inference.

Until those gates are met, M8.7.1.6 remains production, M8.8/M8.10 remain
closed, and no scan or promotion is requested.

# M8.7.1 implementation and validation report

Scanner Build: **M8.7.1**. Desktop/synthetic validation is reported below.
Physical POCO F5 repeatability acceptance is **pending and is not claimed**.
M8.6.7.2 customization, 2.5 cm cells and 60,000 capacity remain frozen.

## 1. Root causes and first corruptible stage

The frame audit did **not** find an XR depth N / pose N+1 mismatch. Depth,
`XRView` and viewer pose are requested synchronously inside the same XR
animation-frame callback. `XRDepthService.inspectDenseFrame` also requires the
same cached XRFrame/XRView identity. There was no asynchronous live worker
reading a later mutable pose.

The first demonstrated corruptible stage was Dense Reality confidence:
multiple depth-grid points from one XR frame could merge into one 2.5 cm surfel
and each increment its observation count. “Stable” effectively meant two
nearby observations, not two/three independent frames, and had no temporal
span, tracking quality or variance requirement. One bad frame sequence could
therefore establish a displaced sheet. The live path also had no explicit
pose/depth/local-world acceptance gate, so a relocalization jump or corrupt
depth distribution could enter persistent coverage and fusion.

The M8.7 spatial hash was otherwise structurally sound in this audit: it uses
floor quantization for negative coordinates, bounded linked buckets, supports
multiple incompatible layers, and relinks a moved fused sample. Tests cover
negative cells, incompatible layers and relinking. RGB is not an authority for
geometry. No stale-frame bug or hash collision corruption was reproduced.

Display refinement was already local and bounded, and triangulation already
used measured vertices. Their missing protection was observability: excessive
refinement requests and triangle rejection categories were not explicitly
reported. Final display also lacked a confidence/component stage, so tiny
unsupported raw fragments could remain visually prominent.

## 2. Immutable measurement packet

`RealityMeasurementStabilityService` creates an application-owned packet before
any persistent update. It contains:

- XR frame sequence and timestamp;
- reference-space type and physical device pose;
- view, inverse-view and projection matrices;
- depth projection/transform matrices and runtime dimensions/scale;
- deterministic phase and quality tier;
- copied normalized UV/depth arrays and copied world points;
- frame-local normal estimates and depth sanity statistics.

Typed arrays and matrices are copied; later source mutation cannot alter the
packet. Accepted processing consumes the packet's Dense frame. A motion-policy
skip omits depth, RGB, pose, phase/fusion sequence and map updates together.
Rejected measurements are sampled into a bounded raw diagnostic reservoir but
do not update coverage, persistent normals, RGB registration or Dense Reality.

## 3. Tracking, pose and depth gating

The bounded live gate derives translation, rotation, velocity and angular
velocity between candidate packets. A sub-700 ms discontinuity beyond 0.75 m
with implausible velocity, or a similarly extreme rotation, enters a tracking
quarantine instead of fusing a second room. Recovery requires three locally
stable frames plus either return near the last accepted pose or agreement with
established world geometry. Less severe excessive motion is skipped with
“Move slower.” Missing viewer pose produces “Tracking unstable — hold phone
steady.”

Depth sanity rejects fewer than 96 valid samples, below 18% valid ratio,
non-finite median, over 28% isolated outliers, or over 72% local discontinuity.
The exact thresholds are intentionally permissive of real edges and incomplete
ARCore depth; they target grossly corrupt frames, not ordinary objects.
Diagnostics expose accepted/rejected totals, p50/p90/p95/max motion, largest
velocity, relocalization events, depth validity, outlier ratio and median/p95
depth.

WebXR does not expose a portable numeric ARCore tracking-confidence API here.
The implementation therefore uses viewer-pose presence, temporal motion,
recovery behavior, depth sanity and world agreement. Physical POCO testing is
required to calibrate the gate without rejecting legitimate fast walking.

## 4. Fusion consistency, stability and duplicate sheets

Each fused sample now stores the last contributing XR frame sequence. Additional
grid pixels that hit that surfel during the same frame are counted diagnostically
but cannot advance observation count, variance or stability.

Stability combines:

- at least three distinct accepted frame observations;
- at least 250 ms observation span;
- mean tracking-quality support of at least 0.55;
- RMS position residual at most 18 mm;
- RMS point-to-plane/depth residual at most 12 mm;
- bounded normal residual;
- for a suspicious parallel offset, at least two view bins and 600 ms span.

Position, depth and normal residual sums, tracking support, first/last time and
16 angular view bins remain bounded typed-array state. Twenty repeated ticks at
the same camera direction do not fake view diversity.

Before insertion, up to a bounded sample set is compared with stable nearby
Reality. Compatible samples reinforce an existing surface. A same-orientation
sample 2.8–12 cm off an overlapping established neighborhood is a duplicate-
sheet candidate and needs temporal/view diversity before becoming high
confidence. A whole frame dominated by such offsets with little established
agreement is rejected. Unknown samples are neutral, so a new extension, a
15–40 cm recess back, side faces and supported real parallel surfaces can grow.
This is not plane snapping and does not collapse depth layers.

## 5. Confidence-filtered Reality and components

Raw measurements and every active fused sample are preserved. A post-scan
worker derives confidence-filtered Reality using conservative 7 cm adjacency,
normal agreement and a 35 mm local point-to-plane envelope. Per component it
reports sample count, area proxy, bounds, stable/view-diverse/single-view ratios,
tracking support, duplicate ratio, confidence and decision.

The derived Final display excludes:

- tiny one-frame low-confidence islands;
- detached unstable low-confidence fragments;
- weak mostly single-view duplicate-sheet components.

It retains supported small physical objects, non-planar curtains, separate room
components and recess faces when they have temporal or viewpoint support. It
does not delete everything outside one “primary room” component. No sample is
moved or deleted from Raw/Fused Raw data, and no new sample is synthesized.

Development repeatability metrics are X/Y/Z extent, ceiling-height proxy, major
component count, stable and low-confidence ratios, floating-component count and
largest unsupported component. These support Scan A/B/C comparison but do not
automatically compare browser sessions or prove device repeatability.

## 6. Refinement and triangulation safeguards

Display refinement remains local: 6 cm neighbor search, 12 mm tangent envelope,
strong normal agreement, balanced support and no M7 input. If the local estimate
requests over 4 mm displacement, the raw point is now retained; it is not
clamped to a potentially new sheet. Mean/p90/p95/max displacement and the raw-
retained count are reported. Disconnected surfaces are never smoothing
neighbors.

Triangulation still emits only measured vertices. It rejects excessive local
edge distance, normal disagreement, depth-layer/point-to-plane disagreement,
degenerate/unsupported neighborhoods and empty-circle conflicts. Diagnostics
now report each reject class plus accepted p95/max edge. There is no explicit
hole filler. Doorways, recess openings and large unsupported gaps remain open.

## 7. Product guidance and diagnostic stages

The live normal-user guidance is one of:

- Scan quality good;
- Move slower;
- Tracking unstable — hold phone steady;
- Scan this area again;
- Move around the object for another angle;
- More coverage needed — move sideways or scan around corners.

The finalized comparison preserves six independently derived stages:

1. Raw Measured Reality (green accepted, red rejected);
2. Fused Raw Reality (high/low/provisional confidence colors);
3. Confidence Filtered Reality;
4. Refined Geometry;
5. Triangulated Reality;
6. Final M8.7.1 Reality.

A clearly poor acceptance/stability/component summary produces a non-blocking
rescan warning. Raw stages remain inspectable. Geometry with missing RGB remains
visible in M8.7.1 diagnostics/final using a neutral fallback; color failure does
not delete valid geometry.

## 8. Performance and memory

Live validation is bounded to frame-local grid statistics and at most roughly
256 established-world probes. It does not run global components, refinement or
triangulation in XR. Those remain worker/post-scan tasks.

Dense typed arrays are approximately **5,580,000 bytes / 5.32 MiB** at 60,000
capacity, plus a reusable per-input RGB lookup (normally tens of KiB). This adds
frame sequence, tracking sum, three variance accumulators, duplicate/stability
flags to M8.7. The raw diagnostic reservoir is capped at 30,000 decimated
samples; packed numeric payload is roughly 1.1 MiB, while JavaScript object
overhead is larger. Confidence filter fixed arrays are about six bytes/source
plus retained indices; neighbor/component arrays are JS heap and device-
dependent. Appearance memory remains the M8.7 cap.

Synthetic desktop timings are not POCO results. Small confidence fixtures take
roughly 8–28 ms. The existing near-capacity refinement/color/mesh benchmark
remains several seconds and allocation-sensitive in Node. A complete browser
peak, XR validation time, thermal behavior and worker heap require physical
profiling before any resolution/capacity increase.

## 9. Synthetic evidence and validation

The focused suite covers immutable packet ownership, pose discontinuity,
atomic skip/depth rejection, one-frame observation inflation, duplicate-sheet
filtering, true recess retention, doorway/depth-layer separation, supported
small-object retention, negative hash cells, bounded refinement and triangle
safety diagnostics. Existing M8.7 tests continue to cover phased sampling,
walking, capacity, recess front/side/back, curtain/corner preservation, RGB
visibility, Live Map/joystick independence and raw immutability. Existing M7 and
customization suites remain in `test:reality`.

Final command results are recorded after implementation validation:

```text
npm run test:reality  130/130 passed
npm run build         passed (existing large-chunk warning only)
npm run lint          passed, no warnings
git diff --check      passed
```

No desktop/synthetic result can satisfy the requested three-scan physical POCO
acceptance.

## 10. Limitations and physical validation checklist

- ARCore tracking/relocalization behavior and native depth quality remain device
  inputs. The app can reject suspicious packets but cannot correct a drifting
  world origin.
- Duplicate protection deliberately requires support; it may temporarily omit
  a real shallow parallel feature until another view confirms it.
- Connected-component adjacency is local and conservative. Sparse real geometry
  can remain separated, which is preferable to bridging an opening.
- The ceiling-height metric is a normal/height proxy, not a structural M7
  measurement.
- The quality score/warning is deterministic guidance, not a certification.

On POCO F5: scan the same scene three times with similar path/duration; compare
extent, ceiling, major components and stability. Verify one ceiling sheet, one
anchored wall, no stationary drift, aligned walking map, preserved recess
front/side/back, fast-motion warning/rejection, and absence of tiny corrupt
fragments in Final while they remain visible in Raw. Do not proceed to higher
resolution, capacity, customization or semantic objects until those tests pass.

## 11. Changed files

Relative to `frontend/`:

- `src/config/buildInfo.ts`
- `src/features/scanner/types.ts`
- `src/features/scanner/services/realityMeasurementStabilityService.ts` (new)
- `src/features/scanner/services/denseRealityReconstructionService.ts`
- `src/features/scanner/services/realityConfidenceFiltering.ts` (new)
- `src/features/scanner/services/realityDisplayRefinement.ts`
- `src/features/scanner/services/realitySurfaceRenderingService.ts`
- `src/features/scanner/services/realityQuality.worker.ts`
- `src/features/scanner/services/xrSessionService.ts`
- `src/features/scanner/components/ScannerDomOverlay.tsx`
- `src/features/scanner/components/RealityQualityPreview.tsx`
- `src/features/scanner/components/ScannerFinishedView.tsx`
- `tests/realityQuality.test.mjs`
- `docs/SPATIAL_SCANNER_VISION.md`
- `docs/M8_7_1_IMPLEMENTATION_REPORT.md` (new)

No M7 extraction, M8.6.7.2 wall-domain/mask/envelope/paintability code, Dense
cell size/capacity, WebXR feature request, raw camera acquisition, RGB-D
registration, Reality Original color source or paint-color logic was changed.

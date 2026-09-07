# M8.7.1.2 Implementation Report

## Scope and physical regression evidence

M8.7.1.2 addresses the supplied POCO F5 screenshots and diagnostics from build
M8.7.1.1. The malformed wall/ceiling sheets are visibly present in **Fused Raw
Reality**, remain in **Confidence Filtered Reality**, and are then followed by
triangulation. Triangulation is therefore not the primary root cause.

The physical trace also showed the live reconstruction doing production-scale
work during scanning: Dense fusion p50/p95 was about 155/214 ms, total deferred
processing was about 197/264 ms, and the smoothed XR interval was about 106 ms.
The 60,000-sample live map created 117,347 surfels, reclaimed 57,347 provisional
slots and rejected 77,985 observations at capacity. Stable geometry was only
31.5%. These values are physical regression evidence, not results claimed for
this patch.

Cell size remains 2.5 cm, live capacity remains 60,000, and the existing base
depth sampling budget remains unchanged. No M7, wall mask, object envelope,
paintability, customization, WebXR acquisition, RGB-D registration or Reality
Original implementation was changed.

## Root causes found

The exact-frame packet and pose/depth ownership introduced in M8.7.1 was still
correct; no stale XR depth using a newer pose was found. Negative-coordinate
hashing and bucket relinking tests also remain correct.

The earliest systematic failure was architectural: the arrival-order-sensitive
live Dense map was also the source of Final Reality. Every accepted 40×90 frame
entered a production-like spatial search. Aggregate distance, depth-layer,
empty-bucket and candidate-budget misses created provisional surfels. Temporal
phases and noisy observations could therefore form coherent displaced sheets,
especially while the map churned at capacity. A running update could then move
each online representative according to the sequence in which observations
arrived.

M8.7.1.1 duplicate filtering ran after those hypotheses had already become
large connected components. Once a false forward sheet had repeated support,
component confidence could not reliably distinguish it from a physical
surface. The filter removed isolated clutter but was not capable of restoring a
correct wall from a systematically split persistent map.

## Live and production representations

The pipeline is now explicitly split:

```text
accepted immutable packet
  ├─ lightweight live Dense fusion → guidance / Live Map
  └─ bounded retained measurements → post-scan worker → canonical Final Reality
```

Live Dense fusion processes at most 900 samples from a normal accepted frame,
680 when the XR interval exceeds 34 ms, and 520 above 45 ms. Decimation is
deterministic over valid source samples and affects only the live preview map.
The full accepted packet remains available to post-scan reconstruction. Live
diagnostics report processed frames, current input budget and samples omitted
from live fusion.

This removes the 3,600-sample production fusion requirement from every live
tick without lowering the captured depth packet, changing temporal phases or
making the final result depend on the lightweight map.

## Retained measurement design

`RetainedRealityMeasurementService` retains at most 96 application-owned,
immutable accepted frames. A retained frame owns the accepted world positions,
normals, validity arrays, frame sequence/time/phase, tracking quality, physical
camera pose and any registered sRGB bytes. It never stores browser-owned
`XRDepthInformation` or a browser texture.

Selection rejects a near-identical frame only when time, translation, rotation
and temporal phase are all redundant. At capacity, deterministic temporal
decimation keeps the first/end and distributed interior history so a longer
walk does not preserve only its opening seconds. Retention itself stores
references to packet arrays already copied at capture, making it O(1) on the XR
path. The arrays are transferred to the final worker only after the live queue
has flushed and XR frame processing has stopped.

Diagnostics include considered/retained frames, duplicate rejects, temporal
compactions, source sample count, viewpoint bins, time range and exact retained
typed-array bytes.

## Per-frame consolidation and canonical matching

The dedicated `postScanCanonicalFusion.worker.ts` replays frames sorted by XR
sequence, making small legal task-order differences irrelevant. Each frame is
first consolidated in 18 mm spatial cells, with a deterministic cap of 1,600
representatives. Different XYZ/depth cells remain separate, so the step does
not flatten discontinuities or average a recess into its front wall.

Canonical matching uses a 2.5 cm spatial index and scores:

- point-to-plane residual (maximum 22 mm);
- tangent-plane distance (maximum 46 mm);
- normal compatibility (within 43 degrees, orientation-sign invariant);
- established residual variance and frame identity.

Euclidean nearest distance is not authoritative. Tangentially shifted temporal
samples can reinforce one wall surfel while point-to-plane separation protects
different depth layers and perpendicular corners.

## Robust surfel updates and lifecycle

Every new hypothesis starts provisional. A canonical update receives at most
3 mm positional movement, uses a bounded observation weight, aligns normal
orientation before averaging and rejects a residual beyond an established
surface's robust depth envelope. One corrupt frame therefore cannot drag a
supported wall five centimetres forward.

Each hypothesis tracks distinct frame support, first/last time, physical camera
baseline/view angle, tracking support, position/depth/normal residuals, color
support and side-face topology. Promotion requires at least three accepted
frames over at least 220 ms plus coherent local support or a diverse viewpoint.
Unsupported one/two-frame hypotheses expire before Final Reality. A local cell
has a fixed maximum of four hypotheses and the complete canonical map remains
bounded to 60,000 surfels.

Transition diagnostics distinguish existing canonical reinforcement, existing
provisional support, newly coherent hypotheses, possible parallel duplicates,
true separated layers and rejected outliers.

## False layers and true topology

After all frames contribute, canonical fusion compares overlapping near-parallel
hypotheses separated by 2.8–10.5 cm. A weaker layer is collapsed when it has no
measured side support, no defensible multi-view/separation evidence, and is
dominated by a stronger overlapping layer. This specifically targets the
physical false wall several centimetres in front of the real wall.

A real second layer survives when it has its own repeated, diverse support and
meaningful separation or measured side-face evidence. A 15–40 cm recess is
outside the false-layer band and is additionally defended by front/side/back
topology. Perpendicular wall/ceiling and object side faces fail the parallel
normal test. No surface is snapped to M7, no opening is filled and no geometry
is invented.

## Final pipeline, confidence and color

`XRSessionService.finish()` now:

1. stops XR frame processing;
2. flushes the bounded live queue;
3. freezes the lightweight live diagnostic snapshot and appearance keyframes;
4. transfers retained accepted arrays to the canonical worker;
5. waits for canonical reconstruction while the UI shows “Building clean 3D
   room…”;
6. exposes canonical surfels as Final Reality;
7. retains the lightweight live map only for stage comparison.

The confidence filter now consumes canonical surfels and acts as a final safety
layer. Refinement, safe triangulation and existing visibility-aware high-res RGB
reprojection also consume canonical geometry. Rejected/provisional geometry is
not colored or triangulated. High-res capture remains disabled under pressure
and automatically becomes eligible again only with an empty queue, healthy XR
interval and cheap capture-side tick.

The developer comparison order is Raw Accepted Measurements, Live Lightweight
Fusion, Post-Scan Canonical Fusion, Confidence Filtered Canonical, Canonical
Triangulated, High-Res Color Refined and Final M8.7.1.2 Reality.

## Synthetic results

The focused tests establish the following deterministic behavior:

- repeated phased flat-wall frames converge to one canonical distribution;
- a one/two-frame surface cannot enter Final;
- a brief wall displaced 5 cm forward expires after correct observations
  resume;
- an 8 cm forward object with repeated diverse support remains distinct;
- recess front, side and 25 cm deeper back surfaces remain distinct;
- a perpendicular wall/ceiling corner remains two orientations;
- a single corrupt frame cannot pull the established wall;
- unsupported disconnected junk expires while a repeated small object remains;
- normal and legally reordered retained-frame input produces the same first
  canonical positions/count;
- low-noise synthetic wall point-to-plane thickness p95 is below 20 mm.

The 18-frame/28,800-observation desktop benchmark produced 1,600 canonical
surfels, a 5.1 mm p95 point-to-plane thickness proxy and approximately 1.16 s
canonical algorithm time. For a 1,600-sample live input on the final validation
run, full live fusion was about 39.1 ms and the bounded 900-sample path about
18.8 ms.
These are Node/desktop synthetic measurements, not POCO results; device timing,
thermal behavior and a fuller room topology can differ.

## Churn, performance and memory

Live churn should fall because no more than 520–900 samples enter the live Dense
map per accepted tick. Final churn is independently reported as input and
consolidated observations, provisional creation/promotion/expiration,
canonical reinforcement, false-layer collapse, true-layer retention and final
surfel count. This patch does not increase live capacity to conceal misses.

At the worst retained bound, packet memory is measured from its actual typed
arrays and displayed in the result. A typical 40×90 packet is roughly 0.1 MiB,
so 96 frames are expected to remain in the low tens of MiB including colors;
the exact device value is reported. Canonical diagnostics estimate retained
numeric arrays plus bounded hypothesis state. Worker-side JS hash/object
overhead remains engine-dependent. Input arrays are transferred rather than
cloned at Finish; no final-map clone occurs per XR tick.

## Tests and validation

The suite contains the requested M8.7.1.2 cases for per-frame consolidation,
canonical reinforcement, robust corrupt-frame resistance, provisional expiry,
false 5 cm layer removal, real 8 cm object retention, recess topology, bounded
layers, order invariance, temporal convergence, wall thickness, wall/ceiling
corner isolation, floating junk, small objects, lightweight live fusion,
dedicated worker dispatch, non-blocking XR architecture, appearance recovery,
final immutability and absence of M7/customization inputs. Existing M8.7.1.1,
M8.7, M7 and M8.6.7.2 regression suites remain active.

Final validation results are recorded after the implementation audit:

```text
npm run test:reality  161/161 passed
npm run build         passed (existing large-chunk advisory only)
npm run lint          passed
git diff --check      passed (line-ending notices only)
```

Desktop tests do not establish product readiness.

## Limitations and physical checklist

- Browser WebXR/ARCore tracking and depth quality remain physical inputs.
- Canonical replay is bounded but may take several seconds on POCO; the exact
  worker time is now visible.
- A real shallow parallel feature needs repeated diverse support; insufficiently
  observed detail may be omitted because correct missing geometry is preferable
  to a fake wall.
- High-resolution appearance remains unavailable if physical XR timing stays
  unhealthy even after live fusion is reduced.
- Component filtering and safe triangulation remain conservative and can leave
  holes; they do not invent room geometry.

On POCO F5, perform a 20–30 second scan and inspect Live Lightweight Fusion
against Post-Scan Canonical Fusion. View a flat wall edge-on, verify one ceiling,
repeat the scene three times, preserve a real protrusion, and preserve recess
front/side/back geometry. Confirm live camera responsiveness and capture the
reported live fusion p50/p95/max, canonical worker time, retained memory,
canonical lifecycle and high-res appearance count. Stop here until those tests
pass.

## Changed files

- `src/config/buildInfo.ts`
- `src/features/scanner/types.ts`
- `src/features/scanner/services/retainedRealityMeasurementService.ts` (new)
- `src/features/scanner/services/canonicalRealityFusionService.ts` (new)
- `src/features/scanner/services/postScanCanonicalFusion.worker.ts` (new)
- `src/features/scanner/services/postScanCanonicalFusionService.ts` (new)
- `src/features/scanner/services/denseRealityReconstructionService.ts`
- `src/features/scanner/services/xrSessionService.ts`
- `src/features/scanner/services/realityQuality.worker.ts`
- `src/features/scanner/components/RealityQualityPreview.tsx`
- `src/features/scanner/components/ScannerPage.tsx`
- `src/features/scanner/components/ScannerDomOverlay.tsx`
- `src/features/scanner/components/ScannerFinishedView.tsx`
- `tests/realityQuality.test.mjs`
- `docs/SPATIAL_SCANNER_VISION.md`
- `docs/M8_7_1_2_IMPLEMENTATION_REPORT.md` (new)

# M8.7.1.1 Implementation Report

## Scope and physical evidence

This patch addresses the supplied POCO F5 trace and screenshots. The important
physical values were 81 considered / 59 accepted frames over 41 seconds, a
51.8 ms XR interval, 502.2 ms reported processing, 87,834 created versus 102,304
matched observations, a full 60,000-sample map with 27,834 provisional
reclaims, 1,705 view-diverse samples, 6,802 duplicate candidates with zero
rejections, and 740,476 “unsupported” triangle rejections. The screenshots show
folded/overlapping sheets in Fused Raw Reality. Confidence filtering removes
small islands but retains some coherent wrong sheets; triangulation makes those
input errors more visually obvious. Refinement displacement (maximum 3.99 mm)
is not large enough to be the source.

Cell size stays 2.5 cm, capacity stays 60,000, and M8.6.7.2 customization is
unchanged.

## Root causes found

The 502.2 ms label was misleading: `XRSessionService` measured from depth start
until the end of the accepted tick, including dense depth sampling, world-point
and normal preparation, packet validation/world consistency, RGB work,
coverage, persistent-surface fusion, Dense Reality matching/fusion and live
render preparation. Those operations ran synchronously from the XR animation
callback. It was not a 502 ms depth API call in isolation.

Dense Reality used a 2.1 cm merge radius despite the physical scan reporting a
2.2 cm median spacing. Temporal phase offsets therefore often missed existing
surfels. The old neighbor traversal was lexical rather than nearest-cell-first
and had a 48-candidate global budget. During churn, the budget could be spent on
less useful buckets. Every newly created sample then performed up to 729
fine-grid string/map bucket probes to classify its relation to stable Reality.
Together these explain the capacity churn and a major part of the long tick.

View diversity used fixed 45-degree world azimuth sectors. A normal lateral
wall sweep could remain in one sector, so nearly three metres of walking did not
necessarily reinforce `viewObservationCount`. Duplicate filtering had a second
logic error: samples explicitly marked low/provisional by Dense fusion could be
declared stable again by the legacy observation-count fallback. That made the
6,802-candidate / zero-rejection outcome possible.

## Capture and queue architecture

Browser-owned XR depth and camera textures are still accessed synchronously in
their producing XR frame. Accepted data is copied into one immutable packet,
including frame sequence, timestamp, phase, quality tier, pose, matrices, depth
metadata, world points, normals and optional application-owned RGB registration.
The registration arrays are cloned because their producer reuses scratch
buffers.

Coverage, persistent-surface work, color fusion, Dense fusion and live render
preparation are handed to `RealityMeasurementQueueService`. It is a latest-only
main-thread asynchronous task: one packet may process and at most one may wait.
A newer useful packet atomically replaces the waiting packet; no stale backlog
is possible. Finish flushes accepted queued work before snapshots are created.
This is deliberately not described as a worker: WebXR acquisition remains in
the XR callback and the stateful live services currently execute in a scheduled
main-thread task. The algorithmic lookup reductions are therefore essential;
physical device timing must verify that the scheduled task no longer causes
long main-thread stalls.

Timing instrumentation now records p50/p95/max for depth capture, world
reconstruction, packet validation, RGB registration, appearance copy, coverage,
persistent-surface processing, Dense fusion and render preparation, plus queue
latency and total processing. Candidate, cadence-skipped, stationary-skipped,
backpressure-skipped, rejection, accepted and successfully fused counters are
reported separately.

## Reliable Dense fusion

`DenseRealityReconstructionService` now uses a center-first bounded ±2-cell
search, a 3.4 cm temporal Euclidean merge radius, a 1.4 cm point-to-plane gate,
normal compatibility and a 96-candidate ceiling. Same-frame points farther than
1 cm cannot merge through the wider temporal radius. Failed matches report
distance, normal, depth-layer, empty-bucket and candidate-budget reasons.

Stable Reality has a separate 10 cm coarse lookup for established-surface
checks. This replaces the per-new-point 9×9×9 fine-bucket scan while remaining
local and bounded. Multiple incompatible surfaces remain supported. A true
recess remains separate through point-to-plane/depth-layer incompatibility and
can earn stability through temporal, viewpoint and side-face evidence.

Synthetic results:

- A 20-sample wall shifted tangentially by 25 mm on the next frame stays at 20
  surfels and records 20/20 matches.
- Twelve phased observations of a 120-sample wall end at exactly 120 created
  surfels and 1,320 matches instead of continued growth.
- Separate depth layers, 15–40 cm recesses, side faces and a supported real
  near-parallel second surface remain covered by existing regressions.

View diversity now stores a quantized first camera position/direction per
surfel and tracks maximum camera baseline and angular separation. Six
centimetres plus 2.5 degrees establishes a second view; a 15 cm baseline is
independently sufficient. A stronger third support bit needs 30 cm plus five
degrees. Same-pose repeats remain one view.

## Duplicate-sheet confidence

An explicit low `stabilityClass` can no longer be overridden by the fallback
count rule. A duplicate candidate must be stable in Dense fusion, observed from
at least two views over at least 600 ms, and have either stable local same-layer
support or measured nearby orthogonal side-face topology. Component-level weak
duplicate sheets and unsupported individual candidates are counted separately.
Tests cover unsupported rejection, a supported physical second layer, and true
recess retention.

## Depth and appearance pressure

Depth rejection now distinguishes missing depth, sample count, valid ratio,
range, isolated outliers and excessive discontinuity. The next POCO run is
required to explain the prior 16 rejected frames using these counters.

The 288×640 appearance path remains bounded to eight application-owned frames.
It now runs only when the queue is empty, the smoothed XR interval is below
34 ms and the previous capture-side tick is below 32 ms. Allocation, shader
copy and synchronous readback timing are separate, and pressure skips are
counted. The M8.6 mask-keyframe path is unchanged.

When pressure is present, Live Map rendering slows from 33 ms to 100 ms and
full point copies slow from 350 ms to 900 ms. React diagnostics slow from
250 ms to 750 ms. Live Map remains unsubscribed while closed. The normal UI
shows only actionable guidance; the numerical performance line remains behind
Debug.

## Triangle audit and fallback

The old unsupported total combined rejected degenerate pairs, angular-gap pairs
and occupied-circumcircle alternatives generated by local Delaunay-like search.
It was a candidate-pair count, not a missing-sample count. Diagnostics now show
candidate pairs, each rejection class, actual participating/non-participating
samples and fallback splats. A valid measured colored surfel not safely used by
triangles remains visible as a fallback splat. No thresholds were loosened from
the screenshots alone because malformed geometry already exists in Fused Raw.

## Performance and memory

Desktop synthetic validation is not a substitute for POCO timing. The new
instrumentation will provide device p50/p95/max rather than one opaque last-tick
number. Dense numeric storage reports about 5.95 MiB at 60,000 samples. The
new quantized first-view/baseline/angle and stable-index state adds roughly
0.69 MiB of bounded typed-array storage within that estimate plus bounded JS
bucket overhead. At the 80×45 tier, one queued immutable packet with optional
RGB registration is roughly 0.16 MiB of numeric data; processing plus newest
pending is therefore roughly 0.32 MiB, excluding JS object overhead. The eight
appearance frames remain approximately 4.22 MiB in the physical configuration.

## User guidance

Finish now warns when accepted measurement count, stable geometry and
viewpoint/trajectory support are insufficient. The user can continue the same
scan without reset or explicitly choose Finish anyway. Existing Move slower,
Tracking unstable and coverage guidance remains automatic.

## Tests and validation

New focused tests cover latest-only queue replacement, bounded backlog,
packet-local phase progression, temporal-phase wall reinforcement, repeated
wall convergence, modest lateral view diversity, appearance backoff, Live Map
backoff, explicit depth-rejection categories, unsupported duplicate rejection,
and triangle candidate/participation accounting. Existing tests continue to
cover true recesses, real second surfaces, high-motion recovery, raw
immutability, M7 separation, customization isolation and safe fallback splats.

Final local validation: `npm run test:reality` passed 144/144 tests;
`npm run build` passed (with only the existing large-chunk advisory);
`npm run lint` passed; and `git diff --check` passed (with line-ending notices
only).
Physical acceptance remains pending. Required POCO evidence is capture/fusion
p50/p95/max, queue latency/depth/drops, created-versus-matched rates,
view-diverse ratio, capacity churn, duplicate rejection reasons, and repeatable
Raw/Fused/Confidence/Triangulated/Final screenshots.

## Changed files

- `src/config/buildInfo.ts`
- `src/features/scanner/components/LiveRealityMapView.tsx`
- `src/features/scanner/components/RealityQualityPreview.tsx`
- `src/features/scanner/components/ScannerFinishedView.tsx`
- `src/features/scanner/components/ScannerDomOverlay.tsx`
- `src/features/scanner/services/denseRealityReconstructionService.ts`
- `src/features/scanner/services/liveRealityMap.ts`
- `src/features/scanner/services/realityConfidenceFiltering.ts`
- `src/features/scanner/services/realityMeasurementQueueService.ts`
- `src/features/scanner/services/realityMeasurementStabilityService.ts`
- `src/features/scanner/services/realityQualityPolicy.ts`
- `src/features/scanner/services/realityRgbKeyframeService.ts`
- `src/features/scanner/services/realitySurfaceRenderingService.ts`
- `src/features/scanner/services/xrRawCameraService.ts`
- `src/features/scanner/services/xrSessionService.ts`
- `src/features/scanner/types.ts`
- `tests/realityQuality.test.mjs`
- `docs/SPATIAL_SCANNER_VISION.md`
- `docs/M8_7_1_1_IMPLEMENTATION_REPORT.md`

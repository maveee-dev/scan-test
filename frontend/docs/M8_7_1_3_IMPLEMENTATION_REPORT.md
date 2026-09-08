# M8.7.1.3 Implementation Report

## Scope and physical evidence

M8.7.1.3 responds to two POCO F5 M8.7.1.2 scans. Those scans retained the
important M8.7.1.2 gains—responsive bounded live fusion, thinner walls and far
less false forward-sheet behavior—but Final remained visually incomplete,
mostly gray when high-resolution appearance capture was starved, and appeared
frozen for 8.32–9.38 seconds after Finish.

This milestone does not increase raw depth resolution, retained-frame capacity,
canonical cell density, surfel capacity or local layer capacity. It does not
use M7 surfaces, fill unknown space, bridge depth discontinuities, synthesize
vertices or resume customization.

## Root causes

The zero `canonical reinforcements` and zero `existing canonical` transitions
were a real lifecycle defect, not only an accounting label. All observations
were replayed while every hypothesis remained provisional; promotion happened
only after replay. Repeated observations correctly accumulated, explaining the
4.6–4.7 observations per final surfel, but no later frame could ever encounter
an already-promoted canonical surfel.

Geometry retention was incorrectly conditional on optional camera capture.
When raw-camera access became unavailable, accepted depth packets could stop
entering retained reconstruction and Final could fall back to the lightweight
live representation. Separately, 18 mm consolidation kept the first geometric
representative and could discard real registered RGB found on another sample in
the same cell. High-resolution keyframes were then too pressure-starved to hide
that baseline loss.

The measured mesh+splat path already existed, but comparison stages and
diagnostics did not clearly separate triangle-only gaps from measured canonical
samples displayed by fallback surfels. Finish exposed only one generic message
and one worker number, so a correct long task still looked hung.

## Implementation

- Canonical hypotheses promote during replay after the existing temporal and
  coherent-neighbor/view criteria pass. Subsequent frames increment canonical
  reinforcement and update position/depth/normal variance, support, timestamps,
  viewpoint state and real RGB without recreating a provisional surfel.
- Accepted geometry is retained whether or not optional RGB capture is active.
  A bounded 384-probe/96-cell selection signature balances spatial contribution,
  viewpoint novelty and temporal distribution within the unchanged 96-frame cap.
- Consolidation accumulates registered real RGB inside each measured voxel.
  Canonical diagnostics report retained, consolidated and final base-color
  coverage; high-resolution appearance remains an optional refinement.
- The unchanged safe triangulator is paired explicitly with oriented canonical
  fallback splats. It reports mesh-covered, splat-covered, represented and truly
  undisplayed samples. Triangle-only remains available for diagnosis.
- A 12,000-point packed Provisional Expiry Map records actual measured positions
  and reason codes. Counts include all expiries beyond the visualization bound.
- Completeness stages report count, percentage of prior stage, spatial coverage
  cells and an area proxy. Retention reports per-frame coverage contribution,
  replacement loss and RGB evidence. Locally planar thickness and defended
  second-layer reasons are separate from global mixed-surface diagnostics.
- Appearance scheduling keeps eight 640-pixel keyframes, queue/low-motion/
  interval/viewpoint gates and real camera pixels. Timing gates now reflect the
  cheaper live pipeline, while outcomes are attributable rather than all being
  labeled pressure skips.
- Finish progress is driven by real main/worker stages. Physical-style timing
  fields cover queue drain, retained finalization, canonical worker round trip
  and compute, result assembly, XR end and total time.

## Diagnostics and quality stages

The production comparison order is:

1. Raw Accepted Measurements
2. Live Lightweight Fusion
3. Retained Measurement Reconstruction
4. Post-Scan Canonical Fusion
5. Confidence Filtered Canonical
6. Canonical Hybrid Mesh + Surfels
7. Base Real RGB Canonical
8. High-Res Color Refined
9. Final M8.7.1.3 Reality

Additional diagnostics include triangle-only geometry, provisional expiry,
depth layers, discontinuities, observation time, viewpoint support, reveal and
trajectory. All geometry positions in Final and expiry views originate from
accepted measured samples.

## Deterministic validation

The suite now proves that a provisional surfel promotes during replay, later
frames reinforce canonical state, variance/support/viewpoint fields update, and
no redundant provisional is created. It also covers real-RGB preservation during
consolidation, camera-independent geometry retention, bounded coverage-aware
selection, hybrid representation accounting, packed expiry bounds/reasons,
appearance outcome attribution and real Finish worker-stage wiring.

Final command results:

```text
npm run test:reality  167/167 passed
npm run build         passed (existing large-chunk advisory only)
npm run lint          passed
git diff --check      passed (line-ending notices only)
```

The desktop 18-frame/28,800-observation synthetic canonical benchmark remained
about 0.6 seconds in the final run with a 5.08 mm global p95 thickness proxy.
This is not a POCO timing claim. Desktop tests remain synthetic and cannot
establish device visual readiness or physical timing.

## Changed files

- `src/config/buildInfo.ts`
- `src/features/scanner/types.ts`
- `src/features/scanner/services/retainedRealityMeasurementService.ts`
- `src/features/scanner/services/canonicalRealityFusionService.ts`
- `src/features/scanner/services/postScanCanonicalFusionService.ts`
- `src/features/scanner/services/postScanCanonicalFusion.worker.ts`
- `src/features/scanner/services/realityQualityPolicy.ts`
- `src/features/scanner/services/realityRgbKeyframeService.ts`
- `src/features/scanner/services/realitySurfaceRenderingService.ts`
- `src/features/scanner/services/realityQuality.worker.ts`
- `src/features/scanner/services/xrSessionService.ts`
- `src/features/scanner/hooks/useScannerSession.ts`
- `src/features/scanner/components/ScannerPage.tsx`
- `src/features/scanner/components/ScannerDomOverlay.tsx`
- `src/features/scanner/components/RealityQualityPreview.tsx`
- `src/features/scanner/components/ScannerFinishedView.tsx`
- `tests/realityQuality.test.mjs`
- `docs/SPATIAL_SCANNER_VISION.md`
- `docs/M8_7_1_3_IMPLEMENTATION_REPORT.md`

## Physical POCO acceptance

Perform one 20–30 second scan of the same wall, curtain, painting, shelf and
ceiling. Report perceived live lag; stage labels, responsiveness and total Finish
time; canonical and dominant-planar thickness; ceiling/protrusion/recess
coherence; completeness funnel plus mesh/splat/undisplayed counts; base RGB
coverage; high-resolution candidate outcomes; and whether recognizable real
color remains when zero high-resolution keyframes are retained.

Do not perform three repeatability scans and do not resume customization until
this first M8.7.1.3 physical result is visually acceptable.

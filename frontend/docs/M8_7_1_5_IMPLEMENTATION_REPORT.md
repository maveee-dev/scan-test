# M8.7.1.5 Implementation Report

M8.7.1.5 responds to the 41-second POCO F5 M8.7.1.4 scan at commit
`bb3d798`. The physical baseline was recognizable but fragmented: many
triangular/cell-like holes remained, texture looked only marginally different
from vertex RGB, and Finish took 9.19 seconds despite a 42.4 ms first processing
paint. This report distinguishes proven code defects from questions that still
require the next physical scan.

## A. Confirmed physical problems

- Final Reality was not suitable for ordinary room customization.
- Stage 6 and every appearance stage retained conspicuous triangular and
  cell-like holes.
- Wall, painting, curtain, shelf and ceiling detail remained soft.
- Textured Canonical Reality was only marginally different from Base RGB and
  High-Res Color Refined.
- Finish visibly appeared inactive for several seconds.
- The ceiling/top region contained geometry whose physical validity could not
  be determined from the aggregate counters alone.

The current live experience was acceptable with slight lag. M8.7.1.5 does not
change live sampling, retention, depth resolution, live capacity, or cadence.

## B. Root causes proven from code and evidence

### Measured footprint was removed by partial triangle participation

The dense renderer marked a canonical surfel as mesh-covered after it appeared
in any one triangle. It then suppressed that surfel's whole measured disc. A
partially triangulated neighborhood could therefore leave empty angular sectors
while still reporting every source sample as visually represented. The physical
Stage-6 holes persisted unchanged through Stages 7–10, which is consistent with
this geometry-path defect.

M8.7.1.5 keeps every surviving canonical surfel's real measured disc as a
depth-biased underlay. Safe triangles remain an optional skin. No vertex,
surface, or unobserved position is generated.

### Texture ownership discarded safe common views

Each surfel previously retained only its independently best keyframe. A triangle
was textured only if all three vertices happened to choose that same frame.
With 44.0% refined vertices, the physical result textured only 5,408 of 26,357
triangles. The full image buffers did reach the GPU, but most triangles were not
eligible to sample them.

M8.7.1.5 retains at most three ranked, visibility/depth/incidence-approved real
keyframe bindings per surfel. A triangle chooses the highest-scoring keyframe
present in all three safe candidate sets. Conflict-rejected vertices still lose
all texture ownership, and a triangle with no common safe view keeps measured
vertex RGB.

### The completeness funnel mixed different domains

The reported 96,129 consolidated cells and 16,194 "provisional-created" cells
were not equivalent stages. `provisionalCreated` was a cumulative admission
event count, including recycled slots, while its old spatial coverage was
computed after expiry and parallel cleanup from final live hypotheses. That is
why provisional and promoted coverage were identical.

M8.7.1.5 reports unique cells admitted as new at creation time, separately from
cumulative creation events and matched observation events. Stage 3 now renders
a bounded one-real-measurement-per-cell map from the actual per-frame-
consolidated replay input. The former Stage 3 was only the bounded raw acceptance
audit and could not trace a physical hole into canonical replay.

### Finish feedback was technically painted but visually static

The processing state painted in 42.4 ms, but approximately 694 ms of synchronous
snapshots followed before worker post. The worker then spent 4.51 seconds in
replay matching and emitted only coarse stage changes. The finishing indicator
was static. M8.7.1.5 makes that real busy state continuously animated without
inventing a percentage. Successful-match hot-path temporary objects were also
reduced without changing matching thresholds or ordering.

## C. Hypotheses that were disproven

- `trulyUndisplayed = 0` did not prove surface completeness; it counted source
  identities, not filled screen/surface area.
- The 96,129-to-16,194 display did not identify the provisional-creation stage
  as the loss point because its inputs were not equivalent.
- Confidence filtering was not the primary hole source: it retained 16,609 of
  17,367 canonical samples.
- Local-layer capacity was not the room-wide cause: only 28 local rejects were
  recorded.
- Temporal expiry was not proven to align with the visible holes. Most temporal
  entries were weak one-/two-frame hypotheses.
- Missing image upload was not the texture problem. Full bounded keyframe RGB
  buffers were transferred for used texture batches.
- First processing paint was not late; the perceived freeze occurred after it.
- Thickness alone did not explain the holes, and no flattening is justified.

## D. Implementation chosen and why

1. Preserve every measured canonical disc beneath safe triangles. This repairs
   lost measured footprint without loosening topology or filling unknown space.
2. Retain three safe image candidates and select texture ownership per triangle.
   This uses more existing real image evidence without relaxing visibility.
3. Replace the false Stage-3 source with a bounded map of actual consolidated
   measurement cells and correct the creation-cell accounting.
4. Animate the genuine Finish busy state and scalarize safe replay hot-path
   temporaries.

These are localized changes to final reconstruction, final rendering,
diagnostics and Finish presentation. Live capture is unchanged.

## E. Alternatives considered

- Globally loosening triangulation was rejected because it can bridge doorways,
  depth layers and unobserved gaps.
- Increasing splat size globally was rejected. The chosen underlay uses the
  existing measured/adaptive footprint only.
- Tightening the 46 mm canonical match envelope was rejected for this build;
  doing so could increase one-view hypotheses and capacity pressure without a
  physical correspondence trace.
- Increasing the 60,000 capacity, reducing cell size, and increasing depth or
  camera resolution were rejected as unproven and costly.
- Globally tightening second-layer retention was rejected because aggregate
  pair counts cannot distinguish a false ceiling sheet from a real curtain,
  frame, shelf, recess or furniture surface.
- Exact per-observation bucket-AABB pruning was prototyped and removed because
  its arithmetic made the cold synthetic worker slower.
- A global texture atlas was deferred. Bounded common-view selection addresses
  the proven eligibility bottleneck with less memory and seam risk.

## F. Coverage before/after

Physical before: 16,609 confidence-filtered samples; 16,165 participated in at
least one triangle; only 444 retained their measured splat; all identities were
reported represented despite visible holes.

M8.7.1.5 deterministic after: every confidence-filtered sample retains its
measured disc in dense/hybrid output while the same safe triangles remain. A
missing-cell regression verifies that partial triangulation cannot erase the
measured footprint. Canonical sample positions and promotion policy are
unchanged. Physical after values are pending one POCO scan.

## G. Appearance before/after

Physical before: 7,311/16,609 surfels refined and 5,408/26,357 triangles
textured; 20,949 triangles used vertex RGB.

M8.7.1.5 deterministic after: a triangle whose vertices have different best
views but share a safe second-choice view is textured from that common real
image. Candidate lists are capped at three and conflict/depth-edge regressions
remain untextured. Physical texture count and perceptual sharpness are pending.

## H. Finish performance before/after

Physical before: 9,190.2 ms total, including 738.5 ms to worker post and
7,708.4 ms worker compute. Replay matching was 4,510.8 ms.

M8.7.1.5 provides continuous visible activity after the already-fast first
paint and removes several per-match temporary allocations. No trustworthy POCO
after-time exists yet. The exact bucket-pruning experiment was removed after a
synthetic regression, so this report does not claim a material runtime win.

## I. Regression safeguards

- No M7 or customization geometry enters Reality.
- No positions are invented and no triangle gate is loosened.
- Doorway, recess, protrusion, parallel-layer and thickness tests remain.
- Every texture candidate passes existing projection, measured-depth,
  discontinuity, incidence, edge and quality gates.
- Conflicting appearance clears all candidate ownership.
- Consolidated Stage 3 is bounded to 60,000 actual measured cell
  representatives and transferred, not regenerated as geometry.
- Live sampling and responsiveness paths are unchanged.

## J. Tests

New regressions cover:

- every measured disc surviving partial safe triangulation;
- depth bias on the measured underlay;
- bounded ranked keyframe candidates;
- common safe second-choice triangle texture ownership;
- conflicting/depth-edge texture rejection;
- equivalent consolidated/admitted/final cell accounting;
- bounded actual consolidated-measurement Stage-3 data.

Final command results:

- `npm run test:reality`: 182 passed, 0 failed.
- `npm run build`: passed (`tsc -b` and Vite production build). Vite retained
  the existing large-chunk advisory; it is not a build failure.
- `npm run lint`: passed with no findings.
- `git diff --check`: passed; Git emitted line-ending conversion notices only.

## K. Files changed

- `src/App.css`
- `src/config/buildInfo.ts`
- `src/features/scanner/components/FinalizedSpatialScanPreview.tsx`
- `src/features/scanner/components/RealityQualityPreview.tsx`
- `src/features/scanner/components/ScannerFinishedView.tsx`
- `src/features/scanner/services/canonicalRealityFusionService.ts`
- `src/features/scanner/services/postScanCanonicalFusion.worker.ts`
- `src/features/scanner/services/realityDisplayRefinement.ts`
- `src/features/scanner/services/realityQuality.worker.ts`
- `src/features/scanner/services/realitySurfaceRenderingService.ts`
- `src/features/scanner/services/xrSessionService.ts`
- `src/features/scanner/types.ts`
- `tests/realityQuality.test.mjs`
- `docs/M8_7_1_5_IMPLEMENTATION_REPORT.md`
- `docs/SPATIAL_SCANNER_VISION.md`

## L. Build marker

Scanner Build: **M8.7.1.5**.

Automated validation does not establish production success. Stop after this
build for one POCO F5 physical validation scan; keep M7 and customization
frozen.

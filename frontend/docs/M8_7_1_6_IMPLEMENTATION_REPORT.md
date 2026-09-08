# M8.7.1.6 Implementation Report

M8.7.1.6 responds to the 50-second POCO F5 M8.7.1.5 scan at commit
`14e951a`. The physical model improved substantially over older builds but
remained visibly perforated and soft, while Finish still looked frozen for most
of its 8.08-second duration. This build makes targeted display, real-image
appearance, Finish UX, and exact-match lookup changes. It does not change live
capture, canonical quality gates, second-layer policy, triangulation, M7, or
customization.

## A. Confirmed physical problems

- Final Reality remained unsuitable for normal room customization despite the
  room being recognizable.
- Small circular/cell-like gaps were visible throughout measured wall regions.
  Larger irregular openings and a messy ceiling/top region also remained.
- Base RGB, High-Res Color Refined, Final, and Textured Reality still looked too
  similar and too blurry.
- Only 8,860 triangles used a keyframe texture while 19,974 retained lower-detail
  measured vertex RGB.
- Finish painted its processing state in 27.0 ms but looked inactive during an
  8,077.4 ms pipeline, including 6,915.4 ms of worker compute.
- Replay matching remained the largest worker stage at 4,178.5 ms.

The physical live scan was generally acceptable with slight lag (39.4 ms p50,
47.2 ms p95, 62.1 ms maximum). M8.7.1.6 leaves the live path unchanged.

## B. Root causes proven from code/evidence

### Regular measured cells were cut back into circles

M8.7.1.5 successfully restored an underlay for every confidence-filtered
canonical surfel: 16,587 underlays for 16,587 retained samples. The old
triangle-participant suppression defect is therefore fixed.

The remaining small regular holes had a separate raster-footprint cause. For a
regular 25 mm sample grid, the dense adaptive quad has approximately 13.684 mm
major and 13.0 mm minor radii. The old circular fragment cutoff provided only
about 12.06 mm of usable minor reach at its alpha threshold, while a cell corner
is 17.68 mm from its center. Even a perfect measured grid consequently exposed
background at interstitial corners. This is a Stage-6 display defect; Stages
7–10 reuse the same geometry and preserve it.

### Texture eligibility stopped at three candidates

M8.7.1.5's common-view selection worked: physical textured triangles increased
from 5,408 to 8,860. However, each vertex discarded safe candidates ranked
fourth through eighth even though the retained appearance set is already
bounded to eight frames. A triangle could therefore have a visibility-approved
real common view that was absent from its truncated per-vertex lists.

The source images were also deliberately copied at 640 pixels on the long edge;
the physical device reported 288 × 640. Full copied buffers reached the GPU, so
missing upload or an additional renderer downscale was disproven. The main
remaining source-detail limit was the intentional copy resolution, combined
with a majority vertex-RGB fallback.

### Finish feedback was not present in the immersive HUD

The 27.0 ms first paint was real. The continuously animated M8.7.1.5 indicator,
however, targeted a normal-page status element rather than the full immersive
DOM overlay shown during XR shutdown and worker reconstruction. The user saw a
frozen camera/static transition even while worker stages progressed.

### Replay matching paid for 125 hash probes per observation

The old exact matcher searched a 5 × 5 × 5 neighborhood of 25 mm buckets. Its
unchanged 46 mm tangent and 22 mm point-to-plane gates imply a maximum Euclidean
envelope of `hypot(0.046, 0.022)`, approximately 50.99 mm. A separate grid with
that exact bucket width needs only the adjacent 3 × 3 × 3 neighborhood. The
fine 25 mm grid remains authoritative for coherence and local-layer capacity.

## C. Hypotheses that were disproven

- The M8.7.1.5 measured-underlay repair did not fail; every surviving sample had
  an underlay. The newly proven small-gap defect was inside that footprint.
- `visuallyRepresented = 16,587` did not prove surface-area coverage. It counted
  source identities, not continuous raster coverage.
- Confidence filtering was not the primary physical hole source; it retained
  16,587 of 17,142 canonical surfels.
- Capacity/layer rejection was not a room-wide cause; no consolidated cell was
  attributed to capacity/layer policy in the physical scan.
- The 104,116-to-16,039 cell comparison still does not identify a single loss
  stage. It compares repeated fine measurement cells with fused canonical
  support and includes matched observations; it is not an equivalent-domain
  retention percentage.
- Temporal expiry was not shown to align with the visible holes. No lifecycle
  threshold is loosened in this build.
- Missing texture upload and a second GPU image downscale were disproven. Used
  full copied RGB buffers are transferred and sampled directly.
- Late first paint was disproven. The remaining problem was the presentation
  after first paint plus real worker duration.
- Global flattening, looser triangulation, and more permissive second-layer
  removal are not justified by the evidence.

Large irregular openings and the physical validity of messy ceiling layers
cannot be assigned to lifecycle or second-layer classes from aggregate counters
and screenshots alone. M8.7.1.6 deliberately does not invent or flatten those
regions.

## D. Implementation chosen and why

1. Replace the circular measured-cell fragment mask with a bounded feathered
   rounded-square norm inside the existing adaptive quad. It covers ideal 25 mm
   measured-grid corners without extending the quad or bridging a missing cell.
2. Retain every safe candidate from the existing maximum-eight-frame appearance
   set and choose the best common frame per existing triangle. Conflict,
   visibility, depth, incidence, and edge gates remain unchanged.
3. Raise only appearance keyframe copies from 640 to 960 pixels on the long edge,
   capped at 432 × 960 pixels. Live/base RGB remains unchanged and the existing
   motion/pressure/novelty scheduler still decides whether a copy is captured.
4. Add a full-screen animated immersive Finish overlay with real worker stage
   names and no fabricated percentage.
5. Add a separate 50.99 mm exact-match index, reducing fixed hash probes from
   125 to 27 while applying the same match score and gates. Keep the 25 mm index
   for all lifecycle, coherence, and capacity decisions.
6. Report common-view rank, no-common triangles, projected source density,
   incidence, distance, 0.5 m regional texture coverage, source/copy dimensions,
   exact-match probes, and candidate visits for the next physical trace.

## E. Alternatives considered

- Enlarging all splat quads was rejected because it could hide truly unmeasured
  regions. Only the discard mask inside the measured adaptive quad changed.
- Globally loosening triangulation was rejected because it could bridge
  doorways, depth layers, and unobserved gaps.
- Changing canonical promotion, temporal expiry, local-layer limits, or
  second-surface policy was rejected because no spatial physical evidence tied
  those stages to the visible small holes.
- Increasing depth resolution, decreasing cell size, or increasing the 60,000
  live capacity was rejected as unproven and likely to regress responsiveness.
- A global atlas, photogrammetry rewrite, or generated texture was deferred.
  The bounded common-view and source-detail limits can be measured first.
- Reducing retained measurements was rejected as a Finish optimization because
  it trades away physical evidence.
- Replacing the canonical representation with a larger architecture was not
  justified before validating the corrected measured footprint and texture
  eligibility.

## F. Coverage before/after

Physical M8.7.1.5 before: 16,587 confidence-filtered samples, 16,341
mesh-covered samples, 16,587 measured underlays, and visible regular gaps despite
zero undisplayed identities.

M8.7.1.6 deterministic after: the measured-cell kernel has nonzero visible
coverage at the exact interstitial corner of an ideal 25 mm grid and zero alpha
at the adaptive quad corner. Missing-cell and large-gap topology remains
unfilled. Canonical counts and positions are unchanged by the renderer. Physical
coverage after-values remain pending one POCO scan.

## G. Appearance before/after

Physical M8.7.1.5 before: six 288 × 640 appearance frames, 6,685/16,587 refined
surfels, 8,860 textured triangles, and 19,974 vertex-RGB fallback triangles.

M8.7.1.6 deterministic after: a common safe view at rank four through eight is
eligible; the copied long edge is 960 with a 432 × 960 pixel cap. Eight maximum-
size RGB frames occupy approximately 9.49 MiB, versus approximately 4.22 MiB at
the former 288 × 640 size. New diagnostics expose whether important physical
regions still lack a common view or have poor angle/density. Perceptual sharpness
and physical triangle counts remain pending.

## H. Finish performance before/after

Physical M8.7.1.5 before: 27.0 ms to processing paint, 829.2 ms to worker post,
6,915.4 ms worker compute, 4,178.5 ms replay matching, and 8,077.4 ms total.

M8.7.1.6 always covers the immersive scanner with an animated busy card and the
real Preparing, Reconstructing, Cleaning, Appearance, and Final-model stages.
The exact matcher performs 27 bucket probes per consolidated observation instead
of 125. Synthetic tests confirm bounded probes and unchanged reconstruction
behavior, but no mobile timing reduction is claimed before POCO measurement.

## I. Regression safeguards

- No generated vertices, planes, textures, or hole geometry are introduced.
- The measured quad extent, missing-cell behavior, large-gap limit, triangle
  gates, and depth-layer separation remain bounded.
- M7 and customization remain frozen and do not feed Final Reality.
- Live sampling, depth resolution, cadence, map capacity, and live RGB are
  unchanged.
- Appearance candidates still require measured projection, visibility, depth,
  incidence, edge, quality, and conflict approval.
- Appearance memory remains bounded to eight frames and 432 × 960 pixels each.
- Fine 25 mm buckets still control coherence and local-layer capacity; only the
  behaviorally equivalent exact-match lookup uses the coarser index.
- No fake Finish percentage or time estimate is displayed.

## J. Tests

New regressions prove:

- ideal 25 mm measured-grid corners have visible footprint while the adaptive
  quad boundary remains bounded;
- common safe rank-four ownership works within the real eight-frame cap;
- no-common texture ownership cannot create a bleeding triangle and remains
  measurable;
- regional texture coverage includes both textured and total triangles;
- 1080 × 2400 appearance input is bounded to 432 × 960;
- exact matching probes at most 27 buckets per consolidated observation;
- the immersive Finish overlay is animated, busy, and driven by real stages.

Final command results:

- `npm run test:reality`: 184 passed, 0 failed.
- `npm run build`: passed (`tsc -b` and Vite production build). The existing
  large-chunk advisory remains non-fatal.
- `npm run lint`: passed with no findings.
- `git diff --check`: passed; Git emitted line-ending notices only.

## K. Files changed

- `src/App.css`
- `src/config/buildInfo.ts`
- `src/features/scanner/components/RealityQualityPreview.tsx`
- `src/features/scanner/components/ScannerDomOverlay.tsx`
- `src/features/scanner/components/ScannerFinishedView.tsx`
- `src/features/scanner/services/canonicalRealityFusionService.ts`
- `src/features/scanner/services/realityDisplayRefinement.ts`
- `src/features/scanner/services/realityRgbKeyframeService.ts`
- `src/features/scanner/services/realitySurfaceRenderingService.ts`
- `src/features/scanner/services/xrRawCameraService.ts`
- `src/features/scanner/types.ts`
- `tests/realityQuality.test.mjs`
- `docs/M8_7_1_6_IMPLEMENTATION_REPORT.md`
- `docs/SPATIAL_SCANNER_VISION.md`

Repository orchestration files already changed independently during this work
are preserved and are not part of the scanner milestone above.

## L. Build marker

Scanner Build: **M8.7.1.6**.

Automated validation does not establish production success. Stop after this
build for one POCO F5 physical validation scan; keep M7 and customization
frozen.

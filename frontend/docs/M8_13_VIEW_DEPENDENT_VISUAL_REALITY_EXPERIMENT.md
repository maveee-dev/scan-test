# M8.13 — View-Dependent Visual Reality Experiment

Status: **implemented as an opt-in experiment; physical result not yet claimed**.
M8.7.1.6 remains the unchanged production Reality path and build marker. M8.13
does not modify M7, customization, WebXR capture cadence, canonical fusion, or
production Final Reality.

## A. Coverage-overlay root cause

Code tracing and new deterministic tests separate two systems that previously
looked like one blue progress surface:

- `SpatialCoverageService` owns the measured 5 cm coverage cells. During an
  active scan, cells are added and their observation state advances from
  observed to partial to captured. No ordinary update deletes a cell or lowers
  its state. The only clear is the explicit session reset/dispose boundary,
  after `getFinalizationCells()` has made the finalized copy.
- `DenseSurfaceMaskService` owns a current-frame presentation. It is rebuilt
  from current depth and its presentation-only cache expires after 220 ms.
  Missing depth or a rejected/currently unavailable packet can therefore make
  this dense blue layer disappear while the measured coverage map remains.
- `PersistentLiveSurfaceService` is another presentation/fusion layer. A weak
  one-observation live surfel can expire after 10 seconds, but this does not
  remove the corresponding coverage cell.
- Captured coverage was intentionally rendered with zero opacity. Correctly
  completed cells therefore appeared to vanish, which made durable progress
  look unstable.

The underlying measured coverage state is therefore **not disappearing in the
traced path**. The reported non-sticking squares are a presentation/anchoring
interpretation problem caused by the transient current-frame mesh, weak live
surfel lifetime, and invisible completed cells. The deterministic regression
holds stored cell count/state across subsequent missing-depth input and across
the finalized-copy/reset boundary.

After proving the state is stable, captured cells now keep a faint 0.055
opacity cue (below partial's 0.14) so completed measured progress remains
legible without becoming an opaque screen. No cell is fabricated or kept alive
by the renderer. Finished results persist cell counts by state, zero expected
pre-finalization removals/downgrades, captured opacity, and cache lifetime.

The previous physical run's individual cell history was not serialized and
cannot be reconstructed after the fact. Its summary remains useful, but no new
scan was requested merely to recover that history; the next result carries the
new persistence audit.

## B. Measurement versus visualization verdict

**Verdict: visualization/presentation instability, not measured-state loss.**

The current-frame blue geometry is allowed to change with current valid depth;
the persistent measurement map is not. A future regression that actually
deletes or downgrades cells will fail the new monotonicity test rather than
being hidden by a visual workaround.

## C. Finish scaling root cause and timings

The production post-scan worker was doing two serial reconstructions for every
Finish:

1. the authoritative M8.7.1.6 canonical baseline; then
2. the closed M8.10 depth-keyframe patch atlas, including its expensive
   redundancy pass.

The M8.10 result was experimental and not the production `surfels`, but it was
still built and transferred before Finish could complete. The finished quality
preview also copied the full M8.12 synchronized RGB-D snapshot into a worker
that did not consume it.

Same-input desktop synthetic evidence, shown as isolated run / concurrent
full-suite run to expose host-load sensitivity:

| Retained input | Baseline-only after | Closed atlas formerly added | Former eager total | Avoided |
| --- | ---: | ---: | ---: | ---: |
| 12,800 samples / 8 frames / 0.55 MiB | 100.9 / 167.2 ms | 241.7 / 791.0 ms | 342.6 / 958.2 ms | 241.7 / 791.0 ms |
| 130,000 samples / 82 frames / 5.58 MiB | 753.1 / 1,810.2 ms | 3,850.8 / 6,996.4 ms | 4,603.9 / 8,806.6 ms | 3,850.8 / 6,996.4 ms |

In the isolated run at 12,800 samples, baseline replay matching was 56.0 ms and the closed atlas
spent 55.5 ms in patch topology, 163.2 ms in redundancy, and 19.7 ms packing.
At 130,000 samples, baseline replay matching was 602.4 ms while the closed
atlas spent 183.7 ms in topology, **3,432.5 ms in redundancy**, and 225.5 ms
packing. Thus canonical replay still scales with retained evidence, but the
largest avoidable superlinear-looking cost was the closed atlas redundancy
work, not production Reality.

Historical POCO M8.7.1.4 evidence remains relevant for the unavoidable
baseline: 345,600 retained measurements produced 7,708.4 ms worker compute,
dominated by 4,510.8 ms replay matching, followed by 1,555.9 ms
promotion/cleaning and 861.7 ms parallel collapse. This milestone does not
reduce samples or loosen quality to hide that remaining scaling.

The post-scan worker and its no-Worker fallback now run only the authoritative
baseline. M8.10 stays available as closed source/test evidence but is no longer
created on Finish. The quality worker excludes synchronized RGB-D data it does
not use. M8.13 is built only after the user explicitly presses its comparison
button. Exact retained frames, samples, bytes, production timings, and skipped
experimental work are stored in `finishPipelineDiagnostics`.

These are desktop code-path measurements, not POCO timing promises. Runtime
varies with JIT and host load; the stage ownership and removal are deterministic.

## D. M8.13 implementation status

M8.13 is a real, lazy WebGL renderer, not a canvas proof or a replacement for
Final Reality. It consumes at most eight M8.12 synchronized RGB-D keyframes,
builds conservative source-grid geometry in a dedicated worker, and renders
the best 2–4 source-owned view layers for the current virtual camera.

Each triangle requires:

- three valid, finite, positive measured depth samples;
- at most 22 mm depth spread;
- every world-space edge at most 10 cm;
- non-degenerate measured area; and
- successful world-to-owning-camera projection through the retained crop,
  orientation, and resize mapping.

Positions are copied from the owning depth grid. UVs are computed through the
owning keyframe's retained view/projection and camera-copy mapping; depth-grid
UV is deliberately not treated as RGB UV. RGB comes directly from that owning
image. All bounded keyframe geometries are built once; orbiting re-ranks and
shows up to four existing layers without rebuilding or cross-keyframe merging.
Invalid gaps stay empty. There is no hole fill, M7 plane, global flattening,
cross-view geometry merge, or invented vertex.

The UI keeps M8.7.1.6 Final Reality above and offers an explicit
`Build M8.13 same-scan comparison` action below it. It records worker,
postMessage, GPU-setup, first-paint, FPS, draw-call, view-selection, rejection,
ownership, memory, and same-camera screen-audit diagnostics.

## E. Automated comparison versus M8.7.1.6

The controlled same-scene fixture supplies four synchronized measured views to
M8.13 and the corresponding retained measurements to M8.7.1.6 canonical replay.
In the final isolated run:

- retained measured samples: 192;
- M8.7.1.6 canonical surfels: 48;
- M8.7.1.6 worker: 36.56 ms;
- M8.13 measured triangles: 260 across four active views;
- M8.13 build: 2.97 ms;
- M8.7.1.6 / M8.13 useful screen pixels: 380 / 1,520;
- M8.7.1.6 / M8.13 whole-viewport hole proxy: 0.9942 / 0.9768;
- M8.13 invented vertices: 0.

This proves the candidate is executable, source-owned, separately visible,
and capable of retaining more measured screen evidence in the controlled
fixture. It does **not** prove physical sharpness, occlusion quality, wall
coherence, or production readiness. Additional tests preserve invalid gaps,
28 mm and 80 mm depth bands, projection-derived UV ownership, deterministic
camera-dependent selection, and the eight-built/four-active bound.

## F. Is another POCO test justified?

**Yes—one short, controlled A/B is now justified, but only after this build is
deployed.** It should capture enough motion for two or more synchronized RGB-D
keyframes, Finish once, then compare the default M8.7.1.6 result with the lazy
M8.13 result from that exact scan. Record the persisted Finish/coverage data and
M8.13 browser diagnostics. It is not a full-room acceptance scan and cannot
promote M8.13 by itself.

The test should stop immediately if synchronized RGB-D is unavailable. It
should check whether photographic detail changes visibly while orbiting,
whether view switches flicker or expose false layers, whether real gaps remain
gaps, and whether Finish time no longer includes closed experimental work.

## G. Files and validation

Implementation files:

- `src/features/scanner/services/m813ViewDependentVisualRealityService.ts`
- `src/features/scanner/services/m813ViewDependentVisualReality.worker.ts`
- `src/features/scanner/components/M813ViewDependentVisualRealityPreview.tsx`
- `src/features/scanner/services/postScanCanonicalFusionService.ts`
- `src/features/scanner/services/postScanCanonicalFusion.worker.ts`
- `src/features/scanner/services/realityQuality.worker.ts`
- `src/features/scanner/services/spatialCoverageVisualConfig.ts`
- `src/features/scanner/services/xrSessionService.ts`
- `src/features/scanner/components/RealityQualityPreview.tsx`
- `tests/m813ViewDependentVisualReality.test.mjs`
- `tests/spatialCoveragePersistence.test.mjs`
- `tests/finishScalabilityInvestigation.test.mjs`
- `package.json`
- this report and `docs/SPATIAL_SCANNER_VISION.md`

Final integration gate:

- `npm run test:reality`: 261/261 tests passed after the screenshot follow-up;
- `npm run build`: passed, including the separately emitted lazy M8.13 worker
  chunk (the pre-existing large application-chunk warning remains);
- `npm run lint`: passed;
- `git diff --check`: passed.

No production-success claim is made from synthetic tests.

## H. Screenshot follow-up: dark texture mapping and build progress

The M8.13 screenshot showed the measured geometry rendering nearly black and no
visible build progress. The RGB keyframe copy is stored top-left-first, while
the preview uses a `DataTexture` with `flipY=false`. M8.13 had inverted the
projected top-left pixel row when writing UV `v`, so the texture sampled the
opposite row from the synchronized camera image. UVs now preserve the copied
row coordinate. The optional preview also reports mean source RGB luma from
those same retained buffers and mean luma at the pixels sampled by measured
vertices. That distinguishes a dark source image from a mismatch between the
source image and projected geometry without capturing new data.

The worker previously emitted only its final result or an error. It now reports
measured per-keyframe progress for ranking, geometry construction, and source
ownership checks; the UI exposes these updates through an accessible live
status and progress element. Progress reflects completed work rather than time.

These changes remain inside the opt-in M8.13 experiment and consume the existing
M8.12 snapshot. They do not alter M8.7.1.6 production, M7/customization, scan
capture cadence, or the Finish critical path. The source-luma diagnostic and
projection-row regression are covered by the M8.13 test suite.

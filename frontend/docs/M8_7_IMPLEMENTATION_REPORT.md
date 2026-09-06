# M8.7 implementation and validation report

Scanner Build: **M8.7**. Physical POCO acceptance is **pending**, not claimed.
Customization development stops at the frozen M8.6.7.2 baseline.

## 1. Audit: where quality was lost

| Stage | Observed implementation bottleneck | M8.7 decision |
| --- | --- | --- |
| Depth | Repeated central 80×45 normalized lattice; fixed landscape-shaped distribution | Four deterministic subgrids; aspect-adjusted bounded timing tiers |
| Reconstruction | Dense Reality received only RGB-copy ticks, every second processing tick | Geometry-only ticks contribute without stale RGB |
| Fusion | RGB outlier rejection also prevented geometry confidence updates | Separate geometry and color acceptance/weights |
| Spatial indexing | Fused positions could cross a cell without relinking their bucket | Unlink/relink measured sample; preserve world-space matching |
| Normals | Matching accepted opposite normal signs but averaging did not align them | Align compatible signs before averaging |
| Capacity | Full map rejected every new surface | Bounded stale-unconfirmed reclamation; stable geometry retained; visible pressure warning |
| RGB | 160 px live long edge and temporal averaging limited fine appearance | Separate 640 px appearance frames and best-view worker reprojection |
| Display | Raw jitter remained visible; dense triangulation already measured-neighbor based | Local derived refinement; retain existing conservative triangulation |
| Walking/map | Stable world reference existed, but no independent live inspection camera | One-way physical pose feed to bounded live point map and virtual camera |

There was **no M7 snapping in Dense Reality**, no screen-pixel ownership of the
world map, and no one-surface-per-cell restriction. Those were audited rather
than replaced with a new speculative reconstruction architecture.

## 2. Depth source and sampling

The source is runtime-selected WebXR CPU depth (`getDepthInMeters`), not a new
sensor/API. Actual width, height and `rawValueToMeters` are saved in finalized
diagnostics. They cannot be measured on this desktop as a substitute for POCO.
The reconstruction path retains the existing 0.05–20 m validity range and
depth-projection/depth-transform preference with XR view fallback. Float32
world positions are not quantized to cell centers. Sensor accuracy, invalid
regions, ARCore temporal behavior and scale are runtime characteristics; the
application does not claim to increase native depth precision.

Attempt budgets: 3,600 / 5,184 / 8,160 per tick (80×45 / 96×54 / 120×68 nominal).
The grid is redistributed using `abs(projection[5]/projection[0])`, the view
aspect: approximately 40×90 at 0.45 portrait aspect in the low tier. Depth-buffer
texture orientation is not used as a separate registration convention.

Four phases use quarter/three-quarter cell offsets. Each is held for two ticks,
avoiding aliasing with every-second-tick RGB copies. The synthetic sampler
produced **14,400 unique normalized samples versus 3,600** over four phases at
the low nominal tier. This is not a claim of four times as many unique physical
surfaces or greater native sensor resolution.

The 180 ms minimum processing interval remains. Sustained <12 ms processing
headroom permits upgrades; >26 ms processing or poor smoothed XR frame intervals
causes fallback. Moving observations resume immediately; nearly stationary
observations throttle to roughly 700 ms after the initial phase cycle. Live
camera-copy resolution is unchanged. This is automatic timing feedback, not a
thermally validated POCO operating point or exposed end-user quality slider.

## 3. Walking, layers, recesses and capacity

`local-floor` is still preferred, with `local` fallback. No map recenter/reset
is introduced during translation. ARCore drift/relocalization remains a device
limitation requiring the several-meter walking test; no software claim of
drift-free tracking is made.

World-space fusion retains 21 mm Euclidean, 12 mm point-to-plane and 40-degree
normal compatibility bounds. A hash bucket can retain incompatible layers;
queries still inspect a bounded 48 candidates. Geometry weights are now based
on geometry observations rather than RGB weights. No M7 plane, Manhattan prior,
screen ownership, or synthetic depth is introduced.

Tests reveal front, side and deeper back surfaces from different camera poses;
15–40 cm depth separation survives display refinement. Doorway/recess gaps stay
open and no vertices are invented. The normal/tangent constraints keep sharp
corners and cloth folds separate.

Cells remain **2.5 cm**, capacity **60,000**. There is no device evidence yet to
choose 2.0/1.5 cm or 80k/100k. At full capacity a maximum 16-slot search per new
sample may reclaim a >8 s old sample with fewer than two observations. Stable
geometry is not evicted. **An all-stable full map still cannot accept an
unlimited extension**; the scanner warns above 95% utilization and reports
capacity rejects. This limitation is explicit, not hidden through deletion.

## 4. High-resolution RGB and visibility

Live fusion stays 160 px long edge (typically 72×160). Mask keyframes retain the
M8.6 settings. The new independent appearance set is capped at eight frames,
640 px long edge, 230,400 pixels maximum. At the reported POCO portrait aspect:
288×640, 552,960 RGB bytes/frame, 4,423,680 RGB bytes for eight (4.219 MiB), plus
192 bytes/frame for matrices. A 1.5 s minimum interval, pose diversity,
all-retained-frame duplicate checks, valid-depth support and fast-motion proxy
rejection bound capture. More novel views may replace a redundant retained
view rather than permanently keeping only the start of a walking scan.

The post-scan worker reuses `projectWorldPointToKeyframePixel` unchanged.
Measured surfel footprints form a one-frame-at-a-time visibility raster.
Occluded points, mixed-depth boundaries, poor incidence and weak local scores
are rejected. The best valid captured pixel supplies color; no many-view blur
average is added. Similarly strong contradictory colors retain original fused
RGB. Asymmetric-image and overlapping-depth tests verify projection direction
and foreground rejection.

No keyframe depth snapshot was added. The raster uses finalized measured
geometry and cannot fully recover historical occlusion from moving objects.
This remains a limitation, especially with dynamic scenes or insufficient
measured occluder support. Keyframes are not magically a texture atlas: final
detail is still limited by the measured surfel/triangle sampling.

## 5. Derived geometry, triangles, holes and rendering

Raw finalized Reality stays immutable. Worker-local derived samples retain
source identities. A 6 cm local search, normal agreement >0.94, 12 mm tangent
compatibility and balanced neighbors permit at most 4 mm normal displacement.
One-sided silhouettes remain unchanged. Normals use only compatible neighbors;
no wall-wide plane fit or structural alignment exists in this path.

Existing local measured-neighbor triangulation is reused without changing the
customization renderer. It rejects unsupported spans and incompatible layers.
There is **no new explicit hole-filling stage**: small supported gaps may receive
existing measured-vertex triangles, but unobserved openings remain absent.

Quality preview is sRGB, antialiased, near/far 0.04/80 m, with DPR capped at 2 and
reduced toward 1 after sustained low FPS. The legacy and quality previews are
mutually exclusive to avoid two heavy meshes/workers. Raw and legacy Original
remain available. Comparison changes reuse refinement; mesh preparation stays
in the worker. A new scan/preview teardown terminates workers and disposes GL.

## 6. Live 3D map, joystick and coverage

The active DOM overlay can open a separate live-map GL canvas. XR rAF publishes
a **one-way copy** of physical pose and a bounded point-copy function. It never
accepts a virtual pose back. The map copies at most 12k stable colored samples
every 350 ms, renders at most about 30 FPS, and does not triangulate in XR.

Follow Scanner follows physical position/quaternion. Free Look enables a left
movement joystick and right-side touch look. Reset View selects Follow Scanner.
The gold scanner marker is independent of the free-look camera. Coarse 10 cm
measured-point occupancy blocks some known obstacles; this is not a complete
body collision system. Unknown openings remain traversable, not filled with
invisible M7 walls. Controls capture only their map touches and keyboard focus.

Fusion continues while the map is open. DOM-overlay/second-context support is
browser-dependent; rendering failure gives a visible return-to-AR message and
does not reset/end capture. No DOM overlay means no live-map controls. Actual
POCO simultaneous XR/map compositing has **not** been validated here.

Trajectory is capped at 1,024 timestamp/position/quaternion records with uniform
decimation. Directional per-sample bitmasks distinguish repeat ticks from
angularly diverse support; they are a coarse coverage proxy, not proof of
complete observation. First/last observation times aid new-region/reveal
diagnostics. Trajectory distance is tracked pose path length, not ground truth.

## 7. Diagnostics

- Raw Reality; measured density; refined geometry; high-resolution color;
  combined; Final M8.7.
- Depth range bands from the first scanner pose (not semantic layers).
- Local depth discontinuities; latest creation tick; view-direction support;
  first-observed-time reveal; scan trajectory.
- Source depth dimensions/scale; actual view-aspect grid; tier/phase; attempts,
  valid counts, processing/frame timing; per-tick created/fused and ratios.
- Cell/capacity pressure, reclaimed/rejected counts, multi-sample bucket count.
- Appearance dimensions/count/memory/copy time; refined-color count, visibility
  and cross-view conflict rejects; single/multi-view accepted coverage.
- Raw/refined local noise proxy, moved/edge-retained samples, mesh count,
  fallback splats, spacing, preparation times, canvas pixels/DPR/FPS/draw calls.
- Bounded numeric storage versus estimated packed display storage; JS/GPU and
  snapshot/worker-copy overhead explicitly separate.

## 8. Desktop evidence, performance and memory

These are synthetic Node results, not POCO measurements:

| Fixture | Result |
| --- | --- |
| Four 80×45 phases | 14,400 distinct normalized sample coordinates |
| Noisy 900-sample wall | RMS to known plane 2.121 → 1.165 mm; local proxy 2.158 → 1.079 mm |
| Recess front/side/back | All measured face types retained; 15/25/40 cm back offsets preserved |
| Near-capacity 59,536 samples + 8 appearance frames | 43,697 color-refined; 118,098 triangles |
| Near-capacity geometry refinement | Approximately 1.22–1.55 s across desktop runs |
| Appearance reprojection | Approximately 0.24–0.35 s |
| Existing mesh preparation | Approximately 3.43–4.30 s |
| Combined worker-equivalent preparation | Approximately 4.89–6.20 s |
| Incremental Node heap during benchmark | Approximately 86–107 MiB; allocation/GC-sensitive, not browser peak |

Live Dense numeric arrays: **4,260,000 bytes / 4.063 MiB**, including 0.229 MiB
linked-bucket indices, view bitmasks and observation timestamps. Hash strings,
Maps and JS metadata add implementation-dependent heap. Appearance RGB is up
to 4.219 MiB at the POCO aspect (absolute pixel-budget cap is 5.273 MiB for eight).
The live map point arrays are 288,000 bytes; trail vertices 12,288 bytes.
Trajectory packed-equivalent storage is ~64 KiB; actual JS objects are larger.

For the 59,536 sample fixture, derived position/normal packed-equivalent is
1.363 MiB, derived colors 0.681 MiB, peak tracked numeric scratch 1.555 MiB and
mesh attributes 8.109 MiB. Actual derived objects and neighbor search allocate
more, reflected in the measured Node heap delta. Raw snapshot/worker cloning,
structural data, mask keyframes, GL backing buffers and GPU allocations are
additional. **A reliable complete POCO peak MB is not available from desktop**;
use device profiling before increasing density/capacity. No GPU/thermal safety
claim is inferred from these timings.

## 9. Tests and validation

`tests/realityQuality.test.mjs` adds reconstruction, phase/tier, portrait aspect,
walking pose, normal/hash, capacity, depth layers/recess/corner/cloth, holes,
appearance cap/duplicates/motion/projection/visibility/conflicts, source
immutability, view diversity, trajectory, virtual-camera separation and
near-capacity cases. Existing M7/customization tests remain in `test:reality`.

Required final commands:

```text
npm run test:reality
npm run build
npm run lint
git diff --check
```

Final validation: **118/118 tests passed** (37 new quality tests plus 81 existing
tests); `npm run build`, `npm run lint`, and `git diff --check` passed. Lint has
no warnings. Production build retains the existing large-main-chunk warning;
no new remote dependency was added. Git reports the repository's usual
LF-to-CRLF conversion notices, not whitespace errors.
Browser/GPU/XR tests and thermal profiling cannot be replaced by the Node suite.

## 10. Changed files

Paths below are relative to `frontend/`:

- `src/config/buildInfo.ts`
- `src/features/scanner/services/realityQualityPolicy.ts` (new)
- `src/features/scanner/services/xrDepthService.ts`
- `src/features/scanner/services/xrSessionService.ts`
- `src/features/scanner/services/denseRealityReconstructionService.ts`
- `src/features/scanner/services/xrRawCameraService.ts`
- `src/features/scanner/services/realityRgbKeyframeService.ts`
- `src/features/scanner/services/realityDisplayRefinement.ts` (new)
- `src/features/scanner/services/realityQuality.worker.ts` (new)
- `src/features/scanner/services/liveRealityMap.ts` (new)
- `src/features/scanner/types.ts`
- `src/features/scanner/components/LiveRealityMapView.tsx` (new)
- `src/features/scanner/components/RealityQualityPreview.tsx` (new)
- `src/features/scanner/components/ScannerDomOverlay.tsx`
- `src/features/scanner/components/ScannerFinishedView.tsx`
- `src/features/scanner/components/ScannerPage.tsx`
- `src/features/scanner/containers/ScannerPageContainer.tsx`
- `src/features/scanner/hooks/useScannerSession.ts`
- `tests/realityQuality.test.mjs` (new)
- `package.json`
- `docs/SPATIAL_SCANNER_VISION.md`
- `docs/M8_7_IMPLEMENTATION_REPORT.md` (new)

No M7 extraction, wall-domain, segmentation, foreground gate, envelope/ranking,
customization-color or existing mesh-renderer implementation file was changed.

## 11. POCO acceptance — next action

1. Scan a detailed room while walking slowly. Compare Raw, Refined Geometry,
   High-Resolution Color and Final; inspect runtime timing/capacity diagnostics.
2. Walk around an actual 15–40 cm recess/doorway: expose front, side and back.
   Orbit the finalized view and verify depth is real and the opening stays open.
3. Walk several meters: check anchoring, no map reset or scale jump. Capture
   trajectory/frame timing and note any tracking loss/drift.
4. Open Live 3D Map during capture; verify physical motion still adds geometry.
5. Enable controls, use Free Look, then Follow Scanner. Virtual movement must
   not move/recolor/reposition captured samples or the physical scanner marker.
6. Partially observe an extension: unknown geometry must remain absent.
7. Verify Original and New Scan/Discard cleanup. Do not resume customization
   tuning until these physical checks have been evaluated.

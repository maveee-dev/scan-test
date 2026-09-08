# M8.7.1.4 Implementation Report

## Scope and physical baseline

M8.7.1.4 responds to the 55-second POCO F5 M8.7.1.3 scan. That scan retained
345,600 measured samples, consolidated them to 153,600 observations, filled all
60,000 canonical hypothesis slots and finished with 12,586 surfels. Its measured
spatial funnel fell from 100,887 consolidated cells to 11,870 final cells
(11.77%). It reported 44,214 temporal expiries, 18,931 combined capacity/layer
rejects and 12,119.2 ms of canonical worker compute.

The fixed operating bounds remain unchanged: 2.5 cm live/canonical cells, the
40 × 90 normalized base depth grid, 60,000 live/canonical slots, four local
layers, 96 retained reconstruction frames, and eight 640-long-edge appearance
keyframes. M7 and customization remain frozen and are not reconstruction inputs.

## Canonical expiry and capacity root cause

The temporal rule already used capture timestamps and distinct source frame
sequences; it did not require adjacent retained-array entries. The diagnostic was
overloaded, however: fewer than three matched source frames and a capture span
below 220 ms were both called temporal failure. Coverage-aware retention exposes
many new regions only once or twice, so unmatched cells legitimately accumulated
as weak hypotheses while neighboring cells on the same measured wall promoted.

The larger defect was lifecycle capacity. Weak provisional entries remained in
the 60,000-element array until replay ended. Once the array filled, later
unmatched evidence was rejected even though tens of thousands of old entries
would subsequently expire. Global exhaustion and the four-layer local bound also
shared one counter.

M8.7.1.4 separates global and local rejection counters. At a full local bucket,
compatible evidence still matches first. Otherwise a sufficiently stale,
one-observation provisional can be deterministically replaced; canonical or
multi-observation evidence is never recycled. At global capacity the same
bounded FIFO policy reuses only stale one-frame provisional slots. A synthetic
60,000-slot regression that previously starved a later supported wall now
retains 100% of that late measured region. This is a targeted before/after result,
not a claim that the physical room is now complete.

## Surface-coherent promotion and coverage

The standard promotion gate remains three distinct source frames, at least
220 ms of capture time, and either viewpoint or coherent-neighbor support.
M8.7.1.4 adds a conservative path for a measured two-frame hypothesis: it must
span at least 220 ms and have at least three already-canonical neighbors within
6.5 cm, with normal agreement of at least 0.90 and point-to-plane residual no
greater than 18 mm. The promoted position remains the observed hypothesis; no
point is synthesized and unobserved space is not filled.

Diagnostics now expose standard versus surface-coherent promotions; failures
below three frames, short capture span and absent neighbors; retained-index and
original-frame spans; maximum camera baseline; canonical/consolidated spatial
coverage; and the highest-loss 25 cm spatial regions. The bounded outcomes map
adds successful promotion to temporal, capacity/layer, parallel and noise
outcomes, so physical holes can be compared directly with neighboring success.

## Second layers and thickness

Multi-view support alone no longer protects an ambiguous parallel sheet.
Measured side topology requires multiple side-support samples and coherent
neighbors. A compact 3.5–9 cm protruding/occluding surface requires repeated
support and coherent extent; a separate wall at 9 cm or more requires three view
levels, five observations and coherent extent. Equal-strength unsupported pairs
keep the earlier deterministic primary and remove the later uncertain duplicate.

Detailed counters separate primary surfaces, protrusions, occluders, recess
backs/sides, genuine second walls, uncertain layers and false duplicates. Real
protrusion and recess fixtures remain; sparse weak multi-view sheets are removed.
The physical M8.7.1.3 dominant-planar p50/p90/p95 of 21.0/30.3/32.6 mm remains the
baseline. No flattening was added: residual spread may still contain sensor/pose
error, local-normal variation and genuine layers and must be remeasured.

## Photographic appearance

The prior high-resolution mode was per-surfel coloring: each surfel selected one
projected RGB pixel. M8.7.1.4 retains that comparison and adds a real image-backed
triangle path. Each safely triangulated face may select one common keyframe only
when all three measured vertices passed the existing measured-depth occlusion,
25 mm depth-consistency, discontinuity, image-border and incidence gates.

The representation is a bounded set of per-keyframe texture batches—an
equivalent atlas—rather than a stitched global atlas. This avoids cross-frame UV
seams and prevents interpolation across keyframe ownership. Selection considers
camera incidence, distance, captured-frame quality, bounded image-gradient
sharpness and exposure. Clamp-to-edge sampling and a two-pixel admission border
avoid texture bleed. Triangles without one safe shared image retain their real
per-surfel RGB, as do all fallback splats. No texture or geometry is generated.

The capture choice remains eight 288 × 640-class RGB frames. Their RGB payload is
about 4.22 MiB. Twelve frames at the same size would be about 6.33 MiB; a
384 × 854 eight-frame set would be about 7.50 MiB before readback/GPU duplication.
Because the physical problem was image use rather than keyframe absence (8/8),
the current lowest-cost setting is retained. Texture diagnostics report used
batches, textured/fallback triangles and transferred RGB bytes.

## Finish and worker performance

The Finish hook now commits `finishing` state, waits for `requestAnimationFrame`,
then crosses a task boundary before invoking finalization. This gives the browser
an actual opportunity to paint “Building your 3D room…” and its real stage before
heavy snapshot work. Diagnostics record click-to-first-paint,
click-to-finalization and click-to-worker-post.

Snapshot timing is split by live surface, spatial scan, base Reality, dense
Reality, RGB keyframes, appearance keyframes and retained measurements.
Retention snapshot coverage is now one occurrence-count pass instead of one
all-other-frame set rebuild per frame.

The canonical worker reports input, consolidation, replay matching,
promotion/cleaning, topology hash, parallel collapse and final packing. The main
matching grid now uses nested numeric maps instead of allocating interpolated
string keys for every one of 125 probes. The bounded 18-frame/28,800-observation
desktop fixture dropped from the earlier roughly 1.4 s observed during the audit
to roughly 0.36–0.55 s in post-change runs. These figures are development
machine evidence, not a POCO prediction; the physical 12.1 s baseline must be
remeasured.

## Quality stages

1. Raw Accepted Measurements
2. Live Lightweight Fusion
3. Retained Measurement Reconstruction
4. Post-Scan Canonical Fusion
5. Confidence Filtered Canonical
6. Canonical Hybrid Mesh + Surfels
7. Base Real RGB Canonical
8. High-Res Color Refined
9. Final M8.7.1.4 Reality
10. Textured Canonical Reality

The provisional outcomes, triangulation, layers, discontinuities, observation
time, views, reveal and trajectory modes remain diagnostic stages.

## Validation and physical stop

Deterministic coverage includes sparse retained sequences, coherent wall
recovery, isolated noise expiry, compatible full-bucket reinforcement, safe weak
slot replacement, 60k recycling, protrusion/recess preservation, weak parallel
rejection, coverage accounting, measured representation, base RGB without
keyframes, visibility/depth-edge texture ownership, Finish paint ordering,
determinism and frozen M7/customization boundaries.

After automated validation, stop for one POCO F5 scan. Record the new physical
coverage funnel, outcomes map alignment, second-layer classes, dominant-planar
thickness, textured versus vertex-color appearance, click-to-first-paint,
snapshot stages and canonical worker stages. Do not resume customization.

Final automated results:

```text
npm run test:reality  178/178 passed
npm run build         passed (existing large-chunk advisory only)
npm run lint          passed
git diff --check      passed (line-ending notices only)
```

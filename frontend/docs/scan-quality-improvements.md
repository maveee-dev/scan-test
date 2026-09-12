# Scan coverage and measured-detail improvements — 2026-09-12

The reported phone result has large holes and poor appearance. This change fixes identifiable capture and replay losses; the screenshot alone cannot establish physical accuracy or recover the original room measurements.

## Capture and presentation

- Enable the persistent world-space coverage overlay when XR starts, including sessions without a DOM overlay. New observations are orange, partial observations blue, and reinforced observations green. Completed surfaces keep a visible tint. Debug visibility is independent.
- Show reinforced coverage as a fraction of **observed** cells, with a color legend and guidance for missing depth, tracking loss and motion. Unknown room extent is never counted as complete.
- Replace the small-sample “ready to finish” claim with a review of remaining observed regions and reminders to scan floors, ceilings, object sides and recesses. Tracking validity continues to gate reconstruction.
- Mount controls per active scan so visibility and finish review reset for the next scan.
- Show the captured model first. Experimental comparison viewers mount only when requested.

## Geometry and appearance

- Keep up to 3,600 consolidated observations per retained frame instead of 1,600. Higher-resolution input uses a rotating stratified subset. The retained-frame limit remains 96 and the canonical surface limit remains 60,000.
- Narrow tangential correspondence to 18 mm from 46 mm, below the 25 mm canonical cell width. Adjacent measured detail should reinforce its own location rather than blend into neighboring samples. Plane matching and surface-layer safeguards remain in place.
- Estimate normals with compatible one-sided neighbors at image borders and missing samples. Reject depth jumps and invalid coordinates. No new positions are synthesized, and missing depth pixels stay missing.
- Retain up to sixteen camera appearance views at the existing 432 × 960 maximum pixel budget, about 19 MiB of RGB before snapshot copies and GPU resources. Use all sixteen during appearance preparation. The optional synchronized RGB-D experiment keeps its independent eight-frame cap.
- Reject appearance capture above 0.45 m/s translation or 25 degrees/s rotation, and preserve subpixel texture coordinates. These motion limits are blur proxies, not proof of image sharpness.

## Verification

The full Node suite passed 270 tests. Build and lint pass. Browser verification used a temporary 390 × 844 control fixture, checking the legend, toggle, finish review and Debug closing without disabling coverage. This was a UI fixture, not a physical XR session.

Deterministic same-input desktop replay comparison (one run; timings are approximate):

| Synthetic input | Previous retained samples | Updated retained samples | Previous / updated replay time |
| --- | ---: | ---: | ---: |
| 80 × 45 flat wall, four observations | 1,600 / 3,600 | 3,600 / 3,600 | 158 / 260 ms |
| 80 × 80 flat wall, twelve observations | 1,600 / 6,400 | 6,400 / 6,400 | 230 / 500 ms |

Regression checks cover missing depth pixels, depth discontinuities, wall noise, separate object layers, recess front/side/back geometry, unsupported gaps, outliers, and memory/capacity limits. Sparse/noisy experimental fixture hashes changed because their diagnostics include the modified canonical baseline; the other eleven hashes remained unchanged.

## Required phone acceptance

Re-scan the same room in a supported Android browser after deployment. Check that coverage colors remain anchored when revisiting a surface, green is visible on a bright wall, and closing Debug leaves coverage enabled. Scan both directions, the floor/ceiling, and the sides and interior of the small-room extension. Pause briefly during overlapping views of detailed objects.

Inspect the rebuilt result from several directions. Compare known wall and object dimensions against physical measurements; check planar thickness, object side faces, recess depth, false parallel sheets, remaining holes and texture legibility. Record XR frame rate, rejected-motion rate, capture count, map saturation, reconstruction time and phone memory behavior.

More retained detail increases post-scan work and can reach the existing map limit sooner. Android thermal behavior, browser memory peaks, XR overlay performance, and physical 1:1 accuracy are not yet verified. Unobserved surfaces cannot be recovered by this change. The previous screenshot cannot be repaired into a faithful room model without the source measurements.

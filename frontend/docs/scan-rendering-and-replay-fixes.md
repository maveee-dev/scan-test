# Repeat room-scan failure: rendering and replay fixes

The second phone trial still shows fragmented surfaces, holes and poor detail from both front and side views. Screenshots establish the visible failure; they cannot identify the original depth errors or demonstrate metric accuracy.

## Confirmed rendering defects

The production texture path had two independent errors:

1. Stored camera RGB and texture bindings both use top-left rows, but the mesh reversed the vertical texture coordinate again. The final upload uses `flipY=false`, so the binding must be used directly.
2. `restoreRealitySurface` uploaded three-channel `RGBFormat` pixels with `SRGBColorSpace`. The installed Three.js renderer requires `RGBAFormat` with unsigned bytes for sRGB. The browser emitted `sRGB encoded textures have to use RGBAFormat and UnsignedByteType` and rendered textured interiors black in the asymmetric fixture. RGB is now expanded to opaque RGBA once during GPU preparation. Capture and worker transport remain packed RGB.

The source is the installed `three/src/renderers/webgl/WebGLTextures.js`; the public [DataTexture documentation](https://threejs.org/docs/pages/DataTexture.html) describes its unflipped typed-array upload convention.

The browser regression uses the production refinement, triangulation, packing and restoration functions with a red upper half and blue lower half. Before the RGBA correction, interior probes were black `(0,0,0)`. After both corrections, the linear render-target probes were `(222,2,1)` above and `(1,2,222)` below. The visible surface was filled and correctly oriented. This verifies the rendering defect, not the completeness of a physical room scan.

## Conservative measured-geometry rejection

Retained depth frames now include the owning view projection and inverse pose. After canonical fusion, a bounded check compares each surviving sample against up to 24 retained views.

- Camera/depth calibration must agree with the frame's original measured positions. Different tracking epochs are excluded.
- Deletion requires at least three clear-space contradictions, at least three times as many contradictions as supporting views, a 6 cm camera baseline, and 220 ms separation.
- All four enclosing depth samples must be valid and locally continuous. Mixed foreground/background blocks, grazing views and unseen pixels are ambiguous.
- A nearer object is an occlusion, never evidence for removing the surface behind it.
- Remaining positions are unchanged. No unseen wall, object side, opening or recess is filled or extruded.

These rules target persistent stray sheets. They cannot recover missing depth and can remove erroneous fragments without closing the resulting gaps. Phone-scale quality still requires actual input replay.

## Local scan capture and replay

After Finish, **Download scan capture** saves the retained depth grids, normals, camera calibration, room photos and diagnostics in a binary `.scan` file. Nothing is uploaded automatically. A direct save link remains available if the browser does not start the initial download. Raw buffers return from the existing reconstruction worker by ownership transfer, avoiding an extra full depth clone; preview workers exclude them. Starting another scan releases the previous capture and download URL.

The current caps remain 96 retained measurement frames and 16 appearance frames. Export is capped at 128 MiB with 2 MiB metadata. The decoder validates array types and lengths, frame dimensions, calibration, finite measured coordinates, color indices and tracking epochs. A saved file preserves measured input; it does not contain live XR objects. Existing completed scans from older builds cannot be recovered from a screenshot.

From `frontend`:

```powershell
npm run replay:scan -- "C:\path\room.scan"
```

The tool runs canonical reconstruction, confidence filtering, appearance refinement and final texture preparation. It writes `replay-output/<scan-id>/report.json`, `canonical.ply` and `prepared.surface`. The last file contains packed render geometry and original camera RGB for local browser review. An optional second path selects the output directory. The report includes an input signature, recorded and replayed canonical counts, visibility rejections, rendering statistics and texture coverage. Captures and default replay output are git-ignored. Input files are parsed as bounded data; only repository source modules execute.

## Findings from the supplied phone capture

The actual 28,308,763-byte capture from build `M8.7.1.6/db6c399/texture-visibility-v1` has measurement signature `m88-1be85fca-171c4c1d`. Replaying the unchanged code reproduced its recorded 22,980 canonical samples. This establishes an exact-input baseline rather than another synthetic room approximation.

- Measurement acceptance was 469/488 ticks (96.1%), with no motion rejection or tracking-epoch discontinuity. All 96 retained measurement frames have 3,600 valid samples. The native depth source was 160 × 90; valid depth is not proof of accurate depth.
- Only 11 camera photos were retained, each 432 × 960. Their timestamps cover the first 30.1 seconds of the 99.2-second retained measurement interval. Diagnostics record 186 pressure skips out of 235 appearance candidates. The photos contain clearer detail than the resulting mesh, but views from the remaining interval were never captured as photos.
- The global 60,000-slot fusion pool discarded young provisional entries from its recycling queue before they were old enough to recycle. Those slots could no longer be reclaimed through that queue later, rejecting 33,374 subsequent observations even when stale one-frame hypotheses were available.
- The intended continuous texture mapping still used the integer pixel lookup. In addition, texture UVs referred to positions before the bounded geometry refinement, rather than the final displayed positions.

The recycling queue now keeps a still-young entry until its observation window expires. Only the existing eligible stale, one-observation provisional hypotheses are reclaimed; the pool cap, promotion thresholds, depth-layer rules and geometric displacement limits are unchanged. Texture projection now uses continuous pixel-centre coordinates, and final mesh UVs are projected from the positions actually rendered. Integer RGB lookup, crop/orientation mapping and visibility selection remain intact.

For future scans, appearance capture gets a reserved opportunity after four seconds without a successful photo when the measurement queue is empty, the smoothed XR interval is below 80 ms and processing is below 65 ms. Normal capture retains the existing 48/42 ms gates. Camera availability, valid depth, motion blur proxies and viewpoint novelty must still pass. This addresses sustained moderate pressure; it cannot guarantee a photo during severe overload, nor restore images absent from this file. The new capture revision is `capture-persistence-v2`.

### Exact-input before/after results

Both arms used the same retained measurements and 11 original photos. Both rendered uncolored measured samples with the same gray fallback as the production worker; the replay CLI previously omitted that fallback.

| Metric | Baseline `db6c399` | Updated |
| --- | ---: | ---: |
| Canonical samples | 22,980 | 25,673 |
| Final displayed samples | 22,092 | 24,487 |
| Global capacity rejections | 33,374 | 1,680 |
| Rendered triangles | 40,233 | 44,792 |
| Photo-textured triangles | 15,170 | 15,914 |
| Geometry numeric bytes | 7,138,440 | 7,926,528 |

This recovers 2,395 displayed samples (+10.8%) and reduces global capacity rejection by 95.0%. Counts are not a physical hole-area or accuracy metric. Front and side browser inspection still shows substantial gaps, fragmentation and blurry regions; the supplied capture does not meet the requested faithful-room result. Missing views cannot supply hidden object sides, and a 160 × 90 depth source does not establish fine surface shape or dimensions. No learned completion, planar filling, thickening or synthetic image detail is introduced.

The local comparison fixture `/tests/browser/scan-replay-review.html` loads `replay-output/before.surface` and `after.surface` with linked front/side controls. These can be copied from two CLI output directories. It contains no room photos or geometry itself; the private generated artifacts stay local and ignored. It is a development review page, not a deployed scan import feature.

## Verification and remaining acceptance

The full Node regression suite passes 285 tests. Production build and lint pass. Vite continues to report the existing large-bundle advisory. New regressions exercise a full pool of still-young provisionals, continuous texture motion, UVs after geometry movement, and reserved appearance opportunities with queue/severe-overload protection.

Automated regression tests cover asymmetric image orientation and RGBA uploads, actual protrusions/recesses, occluded backgrounds, contradictory layers, invalid pixels, depth edges, camera baseline, capture timing, calibration, binary corruption, exact array round trips, ownership transfer and CLI replay. The browser fixture at `/tests/browser/scan-replay-smoke.html` also exercises the real reconstruction worker: it returned 239 canonical samples with all three retained depth frames intact, and binary decoding preserved the image and depth arrays. The capture button prepared a 0.1 MiB file and exposed its direct save link. The in-app browser's download event was unavailable; Android Chrome file saving remains a phone check.

The new GPU allocation is four bytes per retained image pixel (up to about 25.3 MiB across sixteen maximum-size images), plus existing RGB capture and transport allocations. The finalized result now retains the bounded raw input until the next scan or page closure. Phone memory, temperature and Finish latency require verification.

The supplied capture has now been replayed and compared directly. After deploying this revision, the remaining phone check is whether photos continue across the full scan without harmful XR stalls, and whether newly covered viewpoints improve texture and side-face coverage. Compare measured wall/object dimensions, side faces and recesses to the room. No claim of a faithful 1:1 room copy or elimination of every hole is justified yet.

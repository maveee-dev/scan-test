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

The tool runs canonical reconstruction, confidence filtering, appearance refinement and final texture preparation. It writes `replay-output/<scan-id>/report.json` and `canonical.ply`. An optional second path selects the output directory. The report includes an input signature, recorded and replayed canonical counts, visibility rejections and texture coverage. Captures and default replay output are git-ignored. Input files are parsed as bounded data; only repository source modules execute.

## Verification and remaining acceptance

The full Node regression suite passes 281 tests. Production build and lint pass. Vite continues to report the existing large-bundle advisory.

Automated regression tests cover asymmetric image orientation and RGBA uploads, actual protrusions/recesses, occluded backgrounds, contradictory layers, invalid pixels, depth edges, camera baseline, capture timing, calibration, binary corruption, exact array round trips, ownership transfer and CLI replay. The browser fixture at `/tests/browser/scan-replay-smoke.html` also exercises the real reconstruction worker: it returned 239 canonical samples with all three retained depth frames intact, and binary decoding preserved the image and depth arrays. The capture button prepared a 0.1 MiB file and exposed its direct save link. The in-app browser's download event was unavailable; Android Chrome file saving remains a phone check.

The new GPU allocation is four bytes per retained image pixel (up to about 25.3 MiB across sixteen maximum-size images), plus existing RGB capture and transport allocations. The finalized result now retains the bounded raw input until the next scan or page closure. Phone memory, temperature and Finish latency require verification.

After deploying, capture the failing area once, download the `.scan` file and inspect the model from the same front/side angles. Replay that exact file before changing more reconstruction thresholds. Compare measured wall/object dimensions, side faces and recesses to the room. No claim of a faithful 1:1 room copy or elimination of every hole is justified yet.

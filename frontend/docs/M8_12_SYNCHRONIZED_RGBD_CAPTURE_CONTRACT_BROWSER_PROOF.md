# M8.12 — Synchronized RGB-D Capture Contract + Same-Input Browser Proof

Status: **Path A — contract + bounded proof success**. This is an experimental
enabling result, not a production renderer or a physical quality result.
M8.7.1.6 remains the production scanner; its build marker and final Reality
path are unchanged. M8.8 and M8.10 remain closed.

Evidence labels used below:

- **PROVEN BY CURRENT CODE / API CONTRACT** means the repository call graph or
  a normative WebXR contract establishes the statement.
- **PROVEN BY EXISTING/NEW TEST** means a deterministic repository test
  establishes the statement for its fixture.
- **INFERRED BUT NOT PROVEN** means the design is reasonable but has not been
  established on the target browser/device.
- **MISSING** identifies evidence intentionally deferred beyond M8.12.

## A. CURRENT RGB CAPTURE PATH

**PROVEN BY CURRENT CODE / API CONTRACT**

1. `XRSessionService.processFrame(time, frame)` obtains the current viewer pose
   and selects `pose.views[0]` as `primaryView`.
2. Only after the dense packet is accepted and the existing appearance cadence,
   motion, pressure, novelty and capacity policy allows it,
   `RealityRgbKeyframeService.considerCapture` is called with that exact
   `frame`, `primaryView` and `time`.
3. `XRRawCameraService.copyKeyframe` reads `view.camera`, calls
   `XRWebGLBinding.getCameraImage(camera)` inside the active XR animation-frame
   callback, copies through the existing orientation/crop shader, downsizes to
   the existing bounded appearance dimensions, and reads application-owned
   RGBA bytes.
4. `RealityRgbKeyframeService` converts the WebGL bottom-origin buffer to a
   top-left tightly packed RGB buffer and retains the view transform, inverse
   view transform, projection matrix, camera/copy dimensions, crop,
   orientation, timestamp and keyframe id.
5. Appearance retention remains bounded to eight keyframes. M8.12 exposes the
   exact accepted keyframe and replacement id to the pairing service; it does
   not change selection, cadence, image resolution or camera readback.

The Raw Camera Access specification associates `XRCamera` with an `XRView`,
requires camera-image access during the active XR frame, and defines the image
as aligned to that view, while allowing user-agent cropping. See the
[WebXR Raw Camera Access Module](https://immersive-web.github.io/raw-camera-access/).

**PROVEN BY EXISTING/NEW TEST**

The existing RGB registration and camera-copy tests remain in the 235-test
Reality suite. New M8.12 tests prove that the exact copied keyframe and its
mapping survive contract retention and deterministic transfer.

**MISSING**

No M8.12 POCO capture was requested, so target-browser source dimensions,
readback timing and retained image content have not yet been observed through
this new diagnostic contract.

## B. CURRENT DEPTH CAPTURE PATH

**PROVEN BY CURRENT CODE / API CONTRACT**

1. The same `processFrame(time, frame)` callback calls
   `XRDepthService.inspectFrame(frame, primaryView)`, which invokes
   `frame.getDepthInformation(primaryView)`.
2. `inspectDenseFrame` accepts data only when its `frame` and `view` are the
   identical objects cached by `inspectFrame`. It samples the existing bounded
   normalized-view grid through `getDepthInMeters`.
3. `SpatialPointService.processDenseFrame` uses the depth projection/transform
   when available, otherwise the matching view projection/transform, to create
   measured world points while preserving invalid sample slots.
4. `RealityMeasurementStabilityService.createPacket` makes frame-local copies
   of validity, normalized sample coordinates, metric depth, measured world
   points, view/inverse/projection matrices, depth projection/transform,
   dimensions and raw-to-metre scale before acceptance.

The session requests CPU depth with `matchDepthView: true`. The
[WebXR Depth Sensing Module](https://www.w3.org/TR/webxr-depth-sensing-1/)
defines depth information for an associated view, its dimensions,
`rawValueToMeters`, projection and normalized-view/depth transform. The same
specification says the user agent *should* return depth reflecting the current
frame; that is deliberately not reported here as a hardware-level MUST.

## C. SAME-XR-FRAME / SYNCHRONIZATION FINDING

**PROVEN BY CURRENT CODE / API CONTRACT**

- Depth sampling, viewer pose, raw-camera keyframe copying and M8.12 pairing
  occur in one invocation of `processFrame(time, frame)`, using the same
  `XRFrame`, the same `primaryView` and the same rAF timestamp.
- The pairing boundary rejects a timestamp mismatch, a view/inverse/projection
  mismatch or an invalid depth-grid layout. It assigns an explicit application
  identity `xr-frame-{sequence}:rgb-keyframe-{id}`.
- The [WebXR Device API](https://immersive-web.github.io/webxr/) defines an
  `XRFrame` as the tracked state for a point in time and supplies the viewer
  pose for that frame. Raw-camera data is associated with its `XRView`.

The strongest honest contract is therefore
**same-XR-frame, same-XR-view aligned**, not “simultaneous sensor exposures.”

**INFERRED BUT NOT PROVEN**

The POCO browser is expected to implement the requested current-depth and
view-alignment behavior correctly, but M8.12 has not measured physical RGB vs
depth exposure skew.

**MISSING**

WebXR exposes no common hardware sensor-exposure id in this path. Exact camera
shutter/depth-sensor simultaneity cannot be claimed and is explicitly stored as
`not-guaranteed-by-webxr`.

## D. WHERE OWNERSHIP WAS PREVIOUSLY LOST

**PROVEN BY CURRENT CODE**

- The accepted packet temporarily owned view/projection/depth transforms, but
  `RetainedRealityMeasurementFrame` retained points, normals and optional
  sparse RGB only; it dropped the exact frame matrices.
- Appearance keyframes separately retained image matrices and timestamps, but
  had no owned depth grid, validity mask, packet sequence or replacement-aware
  link to retained measurements.
- The older base RGB path permits a bounded timestamp-age check for color
  fusion. That is suitable for its existing purpose but is insufficient to
  prove source ownership for future view-dependent reprojection.
- Consequently, post-scan code could not answer “keyframe X, depth sample Y,
  RGB pixel Z” without reconstructing an association from separate stores.

M8.12 closes the loss at capture time, before either store is finalized or any
retained arrays are transferred/detached.

## E. NEW SYNCHRONIZED CONTRACT

Each retained `M812SynchronizedRgbdKeyframe` contains:

- application capture identity, packet frame sequence and rAF timestamp;
- explicit synchronization strength and sensor-exposure caveat;
- the exact existing application-owned RGB keyframe;
- RGB source/copy dimensions, crop rectangle and orientation;
- camera transform, inverse transform and projection;
- depth grid columns/rows and row-major sample ownership;
- validity, normalized view coordinates, metric depth and measured world point
  for every retained grid slot;
- available depth-buffer dimensions, raw-to-metre scale, depth projection and
  depth transform.

No redundant ownership-index buffer is needed: depth sample Y is the row-major
typed-array index. A rendered proof pixel records keyframe id, RGB pixel index
and measured-triangle id; the triangle table records its three source depth
indices. The contract rejects rather than pairs ambiguous data.

Retention reuses the existing eight-keyframe appearance policy and removes the
paired depth owner when that policy replaces an RGB keyframe.

## F. RGB CROP / RESIZE / ORIENTATION MAPPING

**PROVEN BY CURRENT CODE / API CONTRACT**

The retained `RawCameraCopyMapping` makes this chain explicit:

`camera UV -> orientation -> sourceUvRect -> bounded copy dimensions -> top-left RGB pixel`.

The proof projects each measured world point through the retained inverse
camera transform and projection, then calls the same
`mapCameraUvToCopyPixelInto` used by the locked M8.2 registration path. It does
not assume that a depth-grid UV is already an RGB pixel. The shader currently
uses a full-frame crop, but the contract and tests preserve non-default crops
instead of relying on that implementation detail.

**PROVEN BY NEW TEST**

Tests cover full/cropped images, resizing, upright, horizontal-mirror,
vertical-flip mappings, and a fixture whose depth UVs are deliberately
uninformative so only the retained world-to-camera projection can recover
distinct source pixels.

## G. POSE / PROJECTION OWNERSHIP

**PROVEN BY CURRENT CODE / NEW TEST**

The packet and RGB keyframe both copy transforms from the same `primaryView`.
Pairing compares packet view, inverse and projection matrices with the active
view and RGB copies, allowing only Float32-copy rounding. The contract also
retains the depth projection/transform that produced the measured world
points. A mismatch is a contract reject, never a guessed association.

## H. MEMORY PER KEYFRAME / TOTAL

For the current maximum observed contract shape used by the deterministic
benchmark (432 x 960 RGB and 80 x 45 depth):

| Owned typed data | Per keyframe | Eight-keyframe bound |
| --- | ---: | ---: |
| RGB, 3 bytes/pixel | 1,244,160 B | 9,953,280 B |
| normalized X/Y + metric depth | 43,200 B | 345,600 B |
| validity mask | 3,600 B | 28,800 B |
| measured world points | 43,200 B | 345,600 B |
| RGB + depth matrices | 320 B | 2,560 B |
| ownership index | 0 B | 0 B |
| **raw typed lower bound** | **1,334,480 B (1.273 MiB)** | **10,675,840 B (10.181 MiB)** |

The M8.12 **increment beyond the existing RGB keyframe** is 90,128 B
(0.086 MiB) per retained keyframe, 721,024 B (0.688 MiB) at capacity.
Snapshot finalization temporarily clones that depth-owned portion; it reuses
the already-created appearance-snapshot RGB rather than cloning it again.

The proof explicitly clones/transfers at most two contract keyframes:
2,668,960 B (2.545 MiB) for the benchmark input. Transferable buffers avoid a
second structured-clone byte copy. The 108 x 240 benchmark proof output and
provenance arrays have an approximately 1.893 MiB typed lower bound, including
about 0.212 MiB for triangle ownership tables. Temporary measured-triangle JS
objects, object/string metadata, ArrayBuffer headers, worker/browser/GPU
storage and allocator overhead are additional and were not claimed as heap
measurements. Normals are not duplicated into this contract.

## I. ONE-KEYFRAME REPROJECTION RESULT

**PROVEN BY NEW TEST**

The worker-side software proof constructs triangles only from adjacent valid
measured samples, reprojects them through a virtual camera displaced 4 cm, and
samples RGB directly from the owning image. Every visible output pixel retains
its source keyframe, RGB pixel and source-depth triangle.

In the bounded 2 x (432 x 960 RGB, 80 x 45 depth) benchmark, the first
keyframe's same-view measured projection produced 19,065 source-owned pixels at
108 x 240. The displaced view produced 18,245 visible pixels and 7,675 empty
pixels. The empty pixels remain genuine proof holes; no completion is run.

The poster-edge fixture produces only the source image's hard red values
(0/255), demonstrating direct image sampling rather than sparse vertex-color
interpolation. This is deterministic image-quality evidence, not a claim about
final POCO sharpness.

## J. MULTI-KEYFRAME DISOCCLUSION RESULT

**PROVEN BY NEW TEST**

The smallest visibility rule that passed the proof is target-view z-buffer
depth first; effectively equal-depth ties use keyframe quality then stable
keyframe id. There is no cross-view blending or surface inference.

In the measured-disocclusion fixture:

- source-owned first-view pixels: 3,066;
- combined reprojected pixels: 5,329;
- one-keyframe holes: 6,150;
- two-keyframe holes: 3,887;
- final ownership: 3,066 pixels from keyframe 1 and 2,263 from keyframe 2;
- overdraw attempts: 3,471;
- conflicting-depth samples: 0;
- invalid depth samples rejected: 16;
- invented pixels: 0.

A companion fixture gives both keyframes the same real gap; keyframe 2 then
contributes zero pixels and the hole count does not change.

## K. INVENTED PIXELS / GEOMETRY

**PROVEN BY NEW TEST**

Invented pixels are zero. A proof triangle exists only when all three adjacent
source-grid samples are valid, finite and positive, every world-space edge is
at most 10 cm, depth span is at most 22 mm, area is non-degenerate and every
vertex maps into the retained RGB copy. No new vertex, interpolation across an
invalid slot, global surface, hole fill, M7 surface or anonymous color is
created. Perspective interpolation selects a real source pixel; z-buffering
selects one real measured contributor.

## L. CLOSE-LAYER / RECESS / GAP SAFETY

**PROVEN BY NEW/EXISTING TEST**

- A three-band fixture at 1.000 m, 1.028 m and 1.108 m preserves all bands and
  rejects triangles crossing the 22 mm discontinuity gate. Thus the 28 mm
  close layer, an additional 8 cm step/protrusion and recess-like front/back
  evidence remain separate.
- Invalid-depth columns remain gaps. A second keyframe can fill them only when
  it owns valid measured samples there.
- The complete Reality suite still passes the existing discontinuity,
  close-layer, protrusion, recess, partial-occlusion and historical M8.8/M8.10
  fixtures.

**INFERRED BUT NOT PROVEN**

These conservative source-grid triangles are sufficient for the bounded proof;
they are not yet evidence that a future renderer has the best screen-space
primitive or layer-selection policy for physical captures.

## M. CAPTURE PERFORMANCE IMPACT

**PROVEN BY CURRENT CODE**

- No extra `getCameraImage`, shader copy or `readPixels` call was added.
- No new work occurs on every XR frame. Pairing runs only when the existing
  appearance policy has already accepted and copied a keyframe.
- Incremental work is strict matrix/layout validation and approximately 90 KB
  of depth/validity/world/metadata typed-array copies per accepted keyframe.
- Existing RGB allocation/shader/readback diagnostics are preserved and the
  M8.12 retention time is separately exposed.

**PROVEN BY NEW TEST**

Desktop synthetic runs observed maximum retention of 0.059–0.091 ms for the
80 x 45 contract fixture. This is a code-path proxy, not target-device timing.

**MISSING**

Physical POCO incremental capture timing and any browser long-task effect have
not been measured. The representation was deliberately designed so those are
not prerequisites for starting the next bounded experiment.

## N. POST-SCAN PROOF PERFORMANCE

**PROVEN BY NEW TEST**

Across final review runs, the 2-keyframe desktop Node proof completed in
28.75–52.00 ms. The final isolated run was 28.75 ms: geometry 13.96 ms,
same-view source 2.94 ms, one-keyframe displaced reprojection 3.35 ms and
two-keyframe reprojection 5.77 ms. Transferable structured-clone proxy time was
0.172 ms. It built 13,904 measured triangles and a 108 x 240 raster.

**MISSING**

The experimental UI records actual browser post/round-trip, canvas setup and
first-paint proxies when a user explicitly opens and runs it. No target-mobile
worker, canvas or GPU timing is claimed here.

## O. FILES CHANGED

M8.12 changes are limited to:

- `src/features/scanner/services/m812SynchronizedRgbdCaptureService.ts` — bounded contract, pairing, memory and transfer ownership;
- `src/features/scanner/services/m812SynchronizedRgbdProofService.ts` — conservative measured reprojection and provenance;
- `src/features/scanner/services/m812SynchronizedRgbdProof.worker.ts` — lazy dedicated proof worker;
- `src/features/scanner/components/M812SynchronizedRgbdProofPreview.tsx` — isolated opt-in five-view proof and timing UI;
- `src/features/scanner/services/realityRgbKeyframeService.ts` — exposes the exact accepted/replaced existing keyframe;
- `src/features/scanner/services/rgbDepthRegistrationService.ts` — exports and reuses the unchanged M8.2 world-to-camera projection primitive;
- `src/features/scanner/services/xrSessionService.ts` — same-callback pairing, lifecycle and finish snapshot timing;
- `src/features/scanner/components/RealityQualityPreview.tsx` — mounts the experimental proof without changing production modes;
- `src/features/scanner/types.ts` — optional isolated result field;
- `tests/m812SynchronizedRgbd.test.mjs` and `package.json` — 13 contract/proof tests in the Reality suite;
- this report and `docs/SPATIAL_SCANNER_VISION.md`.

No scanner build marker, live depth/tracking gate, Dense/canonical fusion,
production Reality mode, M7 or customization code was changed.

## P. VALIDATION

- `node --test tests/m812SynchronizedRgbd.test.mjs` — 13/13 passed.
- `npm run test:reality` — 237/237 passed in the final integration gate.
- `npm run build` — passed; Vite emitted the proof as a separate lazy worker
  chunk. The pre-existing large-main-chunk warning remains non-fatal.
- `npm run lint` — passed.
- `git diff --check` — passed.

Synthetic tests prove contract invariants and deterministic proof behavior.
They do not prove physical room quality or production readiness.

## Q. PATH A / B / C

**PATH A — CONTRACT + PROOF SUCCESS.**

Same-XR-frame/view ownership is explicit; crop/orientation/resize and
pose/projection ownership survive transfer; one- and two-keyframe measured
reprojection work; real gaps remain empty; every visible pixel has exact source
ownership; capture work is bounded. The conclusion does not strengthen WebXR
into a hardware-exposure synchronization guarantee.

## R. WHETHER M8.13 IS JUSTIFIED

Yes, as a **bounded experimental View-Dependent Visual Reality renderer** only.
M8.13 may consume this contract to evaluate measured view selection,
screen-space disocclusion and image-backed detail against M8.7.1.6. It must
remain separate from structural/design geometry, preserve source ownership and
gaps, and must not become production merely because M8.12 tests pass.

## S. WHETHER ANY POCO TEST IS REQUIRED BEFORE M8.13

No POCO test is required **before beginning bounded M8.13 implementation**.
The repository and WebXR contracts are sufficient for this enabling gate, and
the milestone explicitly avoids another full-room quality scan.

A minimal Raw Camera Access + Depth Sensing device capture will be required
before claiming that target-browser runtime alignment, memory, timing or visual
quality are physically validated, and certainly before any production
promotion. If M8.13 reaches that gate, request only a short contract-validation
scan first—not a production-quality room verdict.

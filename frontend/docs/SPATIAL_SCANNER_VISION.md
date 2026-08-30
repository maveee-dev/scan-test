# Spatial Scanner Vision

## Product vision

The goal is to build a browser-based spatial room scanner for a hardware-store room customization system.

The scanner should eventually allow a user to:

1. Open the application on a supported smartphone.
2. Scan a real physical room through the phone camera.
3. Receive spatially anchored feedback while surfaces are being scanned.
4. Review the captured spatial data.
5. Process that data into a simplified 3D room representation.
6. Customize identified room surfaces with hardware-store products such as paint, tiles, cabinets, shelves, and fixtures.
7. Estimate material quantities and project cost.

The system does not require LiDAR. The primary target is an ordinary supported Android smartphone with camera-based tracking and WebXR depth sensing.

The current phase is the browser-side spatial scanning foundation. Room understanding, persistence, product customization, and cost estimation are later capabilities.

## Scanner experience

The scanner should feel like a professional spatial scanning tool in the important UX sense: the user sees clear feedback about physical areas that still need scanning, and that feedback belongs to the room rather than to the phone display.

This is a UX reference concept only. The application does not copy any proprietary implementation or interface.

During a normal scan:

- the live camera remains dominant;
- a compact HUD shows scanning, tracking, depth, current-view coverage, and essential actions;
- Finish Scan and Cancel remain accessible inside the immersive AR DOM overlay;
- development diagnostics stay behind Debug mode;
- the user receives guidance based on real tracking and coverage state.

The normal scanning experience does not require scrolling.

## Current scanner pipeline

The current architectural direction is:

```text
Phone camera
+
WebXR / ARCore tracking
+
depth
        ↓
dense live spatial geometry
        ↓
world-anchored progressive scan mask
        ↓
fused persistent surface observations
        ↓
Finish Scan
        ↓
FinalizedSpatialScan
        ↓
room-structure processing
        ↓
walls / floor / ceiling / dimensions
        ↓
simplified editable 3D room
        ↓
paint / tiles / store products
        ↓
material quantity + cost estimation
```

The proven browser-side pipeline is:

```text
immersive-ar
→ camera passthrough
→ XR reference space
→ viewer pose tracking
→ CPU depth sensing where granted
→ metric depth samples
→ world-space SpatialPoints
→ dense world-space surface geometry
→ persistent fused spatial observations
```

During an active scan, measured depth also feeds a persistent live surface
reconstruction:

```text
current WebXR depth measurements
        ↓
persistent fused live surface
        ↓
coverage/confidence
        ↓
world-anchored progressive visualization
```

## Persistent scan representation

Persistent scan data is a fused world-space surface representation. Conceptually:

```text
real measured depth observations
        ↓
world-space points
        ↓
surface-normal estimation
        ↓
spatial lookup / fusion
        ↓
stable persistent surface elements
```

A persistent surface element may contain:

- representative world position;
- representative surface normal;
- observation count and coverage state;
- first and most recent observation time;
- lightweight distinct-viewpoint information used to prevent stationary-frame completion.

The domain states are:

```text
unknown
→ observed
→ partial
→ captured
```

The internal spatial grid or hash is implementation and data infrastructure. It supports spatial indexing, persistent lookup, confidence, fusion, revisit memory, bounded storage, and finalized scan data. It is not the primary user-facing visualization.

The internal index must not be presented as large visible squares, checkerboards, horizontal rows, a fixed display grid, or a screen-space progress meter. Repeated measurements of the same physical surface should be fused into stable nearby surface elements instead of becoming unrelated layers of XYZ cells.

## Live visualization, persistent surface, and scan data are separate

Raw current-frame depth geometry is sensor input, not the intended long-lived
visible surface. Live visualization intentionally has a different resolution
and lifetime from persistent mapping:

```text
CURRENT WebXR depth
        ├── immediate unknown/new candidate visualization
        │
        └── persistent surfel fusion
                 ↓
           stable live surface
                 ↓
           coverage-driven reveal
```

At the same time:

```text
persistent fused spatial surfaces
        ↓
coverage confidence and spatial memory
```

Current depth is still needed to show a newly visible, valid physical surface
immediately. That candidate geometry is world-anchored, short-lived, and
rendered as a strong unknown/new mask only when no compatible persistent
surfel is available. Once a compatible persistent surfel exists, the
candidate is suppressed and the persistent surface controls the appearance.
The persistent live surfel surface provides geometric continuity while
current depth refines it. Coverage confidence remains separate from geometry
stability: a geometrically stable surfel can still be blue when it has only
been observed from one useful viewpoint. The mask is not rendered directly
from large persistent coverage cells and is not a fixed HTML, CSS, or
screen-space effect.

For visual continuity, live mask opacity may use local geometrically compatible persistent coverage confidence without changing persistent capture state. This interpolation is visualization-only and does not affect coverage statistics or `FinalizedSpatialScan`.

Temporary visual geometry, interpolation, and short-lived stabilization may be
rebuilt or discarded as the current XR frame changes. They must not create
persistent scan data, increase confidence, or become part of
`FinalizedSpatialScan`. Only real measured spatial observations may update the
persistent live surface or finalized scan data.

## Progressive reveal behavior

The intended feedback model is:

```text
new / insufficiently scanned surface
→ strongest blue

observed
→ medium blue

partial
→ faint blue

captured
→ transparent
→ true camera color revealed
```

Blue means:

> This physical surface still needs additional scanning.

Transparent means:

> This physical area has been sufficiently captured.

The underlying captured surface remains stored after its blue mask disappears. Returning to that physical area therefore reveals the camera image again without resetting its scan state.

New valid geometry must be eligible for a temporary blue candidate mask even before a persistent element exists. A missing persistent lookup means the physical sample is new or insufficiently known; it does not mean that the sample should be transparent.

The live mask uses a fine, dense surface representation. It should appear mostly continuous, preserve a subtle pixelated or surfel-like frontier, and follow actual physical geometry. It should not look like separated large squares, obvious rows, or a regular screen grid.

The visual treatment is a subtle light blue/cyan translucent mask. Captured areas have no meaningful blue mask, while observed and partial areas retain progressively lower-intensity feedback. Exact opacity, color, resolution, and patch-size tuning belong in implementation configuration rather than this vision document.

## World anchoring

World anchoring is a core scanner requirement.

The live mask is rendered through the same immersive XR presentation as the scan data:

```text
XRSession
→ session.requestAnimationFrame()
→ XRFrame
→ XRViewerPose
→ XRView
→ XRWebGLLayer
```

Dense surface vertices are reconstructed in the active XR reference-space coordinate system. Rendering uses the actual XR view projection, view transform, and viewport for each view. The mask therefore participates in the same spatial coordinate system as the measured points and remains stationary in the room while the camera moves.

If a physical wall is scanned:

1. its mask exists at that real-world location;
2. moving the phone changes where the wall appears on the display;
3. the mask stays attached to the wall;
4. turning away moves the wall and mask out of view naturally;
5. returning to the wall restores the appropriate captured, partial, or observed state.

The phone screen is only a view into the spatial environment. Coverage does not belong to screen coordinates.

## Dense physical-surface mask

The live mask is built from current depth-derived world points. Neighboring valid points may form local triangles or another bounded batched surface representation when their geometry is spatially compatible.

Each visual element is positioned from measured world-space geometry and may carry the coverage state resolved from the persistent fused representation. A new or unresolved sample receives the strongest temporary scan mask; a captured sample is transparent.

The surface representation must:

- follow real depth geometry;
- remain attached to the active XR reference space;
- follow corners and depth changes without semantic wall or ceiling recognition;
- preserve natural object silhouettes and physical boundaries;
- reject connections across unrelated depth surfaces;
- avoid stretching geometry between near furniture and a distant wall;
- remain readable and translucent over camera passthrough.

The application does not yet identify whether a surface is a wall, floor, ceiling, furniture, or another object. It only represents measured spatial surfaces.

## Surface confidence and distinct observations

Coverage confidence represents meaningful observation of a physical surface, not elapsed time and not the number of consecutive frames.

Conceptually:

```text
unknown
→ observed
→ partial
→ captured
```

Repeated observations may consider:

- camera translation;
- viewing-direction change;
- spatial proximity to the prior surface element;
- surface-normal compatibility;
- distance from the representative surface plane.

Holding the phone still must not complete a scan. A useful new observation requires a meaningful viewpoint change, while realistic depth noise should not prevent the same physical surface neighborhood from progressing.

The exact translation, rotation, fusion, and discontinuity thresholds are implementation configuration. They may be tuned using physical-device testing without changing the product meaning of the states.

## Surface fusion

Depth measurements contain noise. When new observations are spatially close and approximately coplanar with a previously observed surface, they should be fused into the same persistent surface neighborhood.

Fusion must remain conservative around real geometry boundaries. It must avoid incorrectly combining:

- a wall and ceiling;
- near furniture and a far wall;
- different sides of a corner;
- unrelated nearby surfaces.

Surface-normal directions must be made consistent before smoothing or averaging. The persistent representation should retain representative position and normal information without storing every historical depth point.

This fused spatial representation is the future input for room-structure processing.

## Temporal visual stabilization

The live scan mask may use short-lived visual stabilization to make the feedback readable, including:

- temporary world-space visual caching;
- conservative small-hole interpolation;
- modest temporal smoothing;
- short-lived visual hysteresis.

These techniques affect presentation only. They must not:

- create persistent scan data;
- increase coverage confidence;
- mark a surface captured;
- enter `FinalizedSpatialScan`.

Only real measured spatial observations can affect persistent scan state.

## Current View Coverage

The scanner may show:

```text
Current View Coverage: XX%
```

This means:

```text
captured valid spatial samples currently visible
/
all valid current spatial samples
```

It is a current-view scanning indicator only. It does not mean:

- overall room progress;
- percentage of the room reconstructed;
- room completion;
- percentage of the entire room captured.

When no valid current samples exist, the value is `N/A`. Overall completion requires later understanding of the room boundary and expected surfaces.

## Finish Scan and FinalizedSpatialScan

`Finish Scan` stops accepting new observations, copies the persistent fused spatial representation into an independent `FinalizedSpatialScan`, ends the XR session, and clears live scanner resources.

The finalized representation contains application data only, such as:

- scan identifier and timestamps;
- duration;
- reference-space type;
- independent serializable surface positions and normals;
- coverage states and observation counts;
- final stored-surface statistics.

It does not contain `XRSession`, `XRFrame`, `XRView`, `XRReferenceSpace`, WebGL resources, Three.js objects, DOM elements, or service references.

The lifecycle distinction is:

```text
LIVE SCANNING

real depth
├── persistent fused surfaces ──────► FinalizedSpatialScan
│
└── temporary dense visual mask ────► discarded on finish
```

Cancel Scan ends the session and discards active scan data without creating a finalized snapshot. Starting a new scan begins with an empty active coverage representation.

## Finished scan preview

The finished state may show an interactive `Spatial Scan Preview` based only on `FinalizedSpatialScan` data. It can support review controls such as orbit, zoom, and reset view and can frame itself from the finalized spatial bounds.

The preview represents:

> Captured Spatial Data

It is not yet:

- a reconstructed room;
- a clean wall model;
- a digital twin;
- a final architectural model.

An empty finalized scan should show an explanatory empty state instead of an empty 3D scene.

Later processing will use the finalized spatial representation to identify major planes, walls, floor, ceiling, room boundaries, and dimensions, then generate a simplified editable room.

## Post-scan plane extraction foundation

The first room-understanding stage runs only after XR cleanup, against the
serializable `FinalizedSpatialScan`:

```text
FinalizedSpatialScan
        ↓
quality filtering and spatial downsampling
        ↓
connected, approximately coplanar support groups
        ↓
PlaneCandidates
        ↓
room-structure interpretation
```

Plane candidates contain measured world-space geometry such as a fitted normal,
centroid, plane equation, projected local bounds, support count, area estimate,
and fitting error. They are geometric candidates rather than semantic labels:
an orientation diagnostic such as horizontal-like or vertical-like does not
yet claim that a candidate is a floor, wall, or ceiling.

Extraction uses persistent finalized spatial data, not active XR sessions,
temporary live-mask candidates, visual caches, or rendering resources. The
analysis keeps disconnected parallel surfaces separate through local spatial
connectivity and rejects unsupported or noisy points instead of fabricating a
room shape.

## Technical direction

The current browser technology direction is:

- React;
- TypeScript;
- Vite;
- Three.js for non-XR preview and appropriate visualization;
- WebXR immersive AR;
- ARCore-backed Android WebXR implementations;
- WebXR Depth Sensing when granted by the runtime.

The application must feature-detect WebXR, `immersive-ar`, DOM Overlay, reference spaces, and depth sensing. Capabilities are separate: immersive AR may work without depth sensing, and depth sensing may be unavailable or temporarily missing during an otherwise valid session.

Raw XR session, depth acquisition, spatial conversion, coverage fusion, and XR rendering logic remain outside presentation components. The intended flow is:

```text
ScannerPage
→ ScannerPageContainer
→ scanner hooks
→ XR/session services
→ depth/spatial/coverage services
→ WebXR
```

The active XR renderer uses the session's XR-compatible WebGL presentation context and `XRWebGLLayer`. It must not introduce a disconnected rendering context or a second XR frame loop.

## Performance and resilience principles

XR processing stays outside React's high-frequency state path. React receives throttled diagnostics and compact application state, not every XR frame, every depth sample, or the persistent coverage map.

Live depth geometry and persistent surface storage remain bounded and mobile-safe. The implementation should use batched geometry, reusable typed data where practical, bounded spatial storage, and throttled mapping updates.

Missing depth, lost tracking, invalid geometry, failed fusion, capacity limits, and temporary lookup misses must not terminate a healthy XR session. The scanner should preserve pose tracking where possible and expose useful diagnostics in Debug mode.

When a scan ends, frame callbacks, listeners, depth state, spatial points, coverage data, live geometry, WebGL resources, and preview resources are cleaned up. A finished snapshot survives because it is an independent application representation, not a reference to live XR or scanner service state.

## Future room understanding

Later processing may determine:

- major planes;
- walls;
- floor and ceiling;
- room boundaries and dimensions;
- doors and windows;
- permanent structures.

The scanner should not claim this understanding before it exists. In particular, current guidance must not say `Wall complete`, and current coverage must not be described as an overall room percentage.

Once a simplified room is available, later product experiences may apply paint, floor or wall tiles, cabinets, shelves, fixtures, and selected furniture. Material quantities and cost estimates will depend on measured room geometry and the hardware-store product catalog.

Those capabilities are intentionally outside the current spatial scanning foundation.

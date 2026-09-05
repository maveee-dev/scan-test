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

After capture, the fused live surface becomes a finalized fused spatial
surface before room analysis. The post-scan path is therefore:

```text
current depth
        ↓
persistent fused live surface
        ↓
FinalizedSpatialScan (fused geometry + coverage metadata)
        ↓
plane extraction
        ↓
structural room-surface interpretation
        â†“
later room interpretation and reconstruction
```

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

When a scan is finished, the finalized scan keeps this fused measured geometry
alongside the separate coverage/confidence observations. The fused surface is
the preferred geometric input for post-scan plane analysis because it represents
the live surfel fusion result rather than the more granular coverage index.
Coverage remains available for scan statistics, confidence history, and later
quality decisions.

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

It may contain both independent coverage cells and a finalized fused surface
collection. The fused collection contains only confirmed real measured surfels:
positions, normals, geometry observation quality, and associated coverage state.
It does not contain temporary current-frame candidates, hole-filled or
interpolated visualization fragments, visual caches, spatial indexes, or GPU
resources.

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
bounded robust dominant-plane fitting and support ownership
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
analysis prefers the finalized fused surface collection; coverage cells remain
separate scan metadata and are only a compatibility fallback for older
snapshots. Major planes are extracted directly from finalized fused geometry
using bounded deterministic dominant-plane fitting. A position-first plane
hypothesis collects real point inliers, then robust refinement and exclusive
support ownership produce the final candidates. Surface normals provide
secondary quality evidence rather than forcing noisy local fragments during
hypothesis discovery. Unsupported or noisy points remain unassigned instead
of fabricating a room shape; parallel surfaces with different offsets and
surfaces with different full normal directions remain separate.

After dominant-plane fitting, a bounded surface-family consolidation pass may
group nearby depth layers that have compatible full normals, canonical plane
offsets, and overlapping projected support. This suppresses duplicate
measurements of one physical surface without merging arbitrary parallel
surfaces such as opposite walls or separate object faces. The representative
plane remains a real fitted layer; duplicate-layer support is tracked
separately for ownership and diagnostics.

The resulting surface families then pass through a small final physical-surface
consensus stage. It compares sign-aligned full normals, canonical plane
separation, occupied projected support overlap, spatial extent, and bounded
depth span to suppress alternate nearby measurements of the same surface. A
consensus surface retains a real representative layer and tracks absorbed
duplicate-layer support separately; it does not average arbitrary parallel
geometry or merge disconnected physical surfaces without supporting evidence.

Structural room-surface interpretation is the next post-scan stage. It reads
the final geometric candidates and their bounded relationship graph to assign
careful likely structural roles such as wall, floor, ceiling, other, or
unknown. Orientation, size, support, height, and nearby perpendicular geometry
are evidence rather than guarantees. A role candidate is not automatically a
selected room-envelope surface: compatible same-direction candidates compete
for a primary representative, while alternate candidates and uncertain
geometry remain available for later processing. Wall candidates are first
grouped by sign-invariant full-normal orientation; plane offset and support
position are evaluated afterward as parallel-surface competition, so those
concepts are not conflated. A separate room-envelope evidence gate favors
well-supported structural candidates and protects against promoting furniture,
noise, or weak parallel alternatives. Selected surfaces are real geometric
planes, while alternates preserve useful evidence. The interpretation preserves
uncertainty and does not yet create plane intersections, a room boundary, or a
final room mesh.

Structural selection also builds a bounded relationship graph over viable
surface candidates. Strong wall-wall corner relationships and wall-horizontal
envelope relationships support a coherent selected subset, while disconnected
wall-like candidates remain alternate or uncertain unless they have compelling
independent boundary evidence. This graph is a selection aid only: it does not
construct exact intersection lines or merge geometric planes.

Relationship support has one shared geometric meaning across interpretation and
intersection analysis. A mathematical plane intersection is calculated first;
"support near the theoretical intersection" then means that each involved
surface has actual exclusive finalized fused support within the bounded distance
of that exact line. A generic support-bounds gap is reported separately and is
not enough to claim an observed corner. M7.1 uses this lightweight two-sided
test for graph evidence, while M7.2 remains responsible for finite interval,
continuity, and supported/partial/rejected segment validation.

Final room-envelope selection is seeded from the strongest coherent structural
edges rather than promoting every node in a connected graph component. Candidate
growth checks the whole selected set for redundant wall directions, admits a
parallel surface only with independent boundary evidence, and retains weaker
transitive or disconnected candidates as alternates. A credible standalone
surface remains valid when no strong relationship graph is available.

When several strong corner edges compete, the structural core is chosen by joint
node-and-edge quality. Corner strength remains mandatory, while normalized
surface support, occupied extent, orientation, fit quality, and room-envelope
evidence prevent a tiny high-angle fragment from displacing a dominant measured
surface. The selected core continues to reference the original geometric planes
for later intersection processing.

For a two-wall-plus-horizontal observation, structural interpretation can also
evaluate a bounded multi-surface coherence hypothesis. A candidate wall may be
admitted when its wall-wall relationship, wall-ceiling or wall-floor relationship,
node quality, and orientation novelty jointly support one coherent triad. This
does not lower the global strong-edge rule and does not average or rewrite any
plane. A candidate without actual near-line support remains alternate or
uncertain, even when its fitted planes are mathematically perpendicular.

Triad discovery is intentionally broader than graph-edge acceptance. When two
meaningfully different wall directions both have actual near-theoretical-line
support against the same selected ceiling or floor, they can form a provisional
three-surface candidate even if noisy wall normals prevented a qualifying
wall-wall graph edge. Candidate discovery remains broad, but acceptance has
mandatory evidence gates before the continuous coherence score is considered:
the three-plane geometry must be stable, both wall-horizontal relationships
must have observed support, the wall-wall theoretical intersection must have
actual two-sided support, and each of the three surfaces must contribute
meaningful support near the common triple point. A high aggregate coherence
score cannot compensate for an essential relationship with no observed
support. This prevents mobile-depth angle noise from blocking a real
wall-plus-wall-plus-horizontal structure without promoting surfaces that merely
touch a horizontal plane in unrelated locations.

Locally accepted triads may still compete after their mandatory gates pass.
Triads sharing an anchor wall and horizontal surface are compared as structural
hypotheses using full-normal similarity, bidirectional support agreement,
projected occupied-support overlap, spatial extent, and candidate triple-point
separation. A bounded competition group selects the strongest real
representative; losing triads remain visible as locally accepted but suppressed
diagnostics. Distinct spatial corners are preserved, so this is not a fixed wall
count or a rule that reduces every room to two walls.

Whole-corner competition extends this comparison to accepted wall-wall-horizontal
triads that share a ceiling or floor but do not share a wall ID. Both possible
wall-pair correspondences are compared using support distance, projected support
and extent compatibility, plane offsets, and the exact three-plane corner-point
separation. When those spatial and topological signals indicate duplicate
representations of one physical corner, one triad is retained as the structural
representative and the losing wall pair is suppressed only when it has no
independent room-envelope evidence. Locally valid triads remain visible in
diagnostics, and spatially distinct corners or independently supported walls are
preserved; this is not a fixed wall-count rule.

Selected structural surfaces then feed the M7.2 intersection stage:

```text
selected structural surfaces
        |
exact infinite plane intersection
        |
observed finalized-support validation
        |
finite supported structural segment
        |
future corner and room-boundary reconstruction
```

Intersection candidates use only selected surfaces and the real finalized
fused-surface support. Infinite mathematical lines are not treated as room
edges until both surfaces provide nearby measured support. Supported and
partial finite segments are retained with their uncertainty and continuity;
missing support is not completed or extended into a room mesh in M7.2. Raw
support points validate the theoretical line but do not become its endpoints:
near-line points are projected to scalar parameters on the line, robust
supported intervals are trimmed, and finite segment endpoints are rebuilt as
`origin + direction * t`. The canonical plane convention is
`normal dot position = planeConstant`, equivalent to
`normal dot position + d = 0` with `d = -planeConstant`. M7.2 audits the line
origin, direction, and segment endpoints against both source planes so a
support-validated segment cannot drift into a parallel offset line.

M7.3 consumes those finite intersections as a structural boundary graph. It
clusters nearby segment endpoints, keeps selected surface IDs attached to each
edge and node, and may validate a multi-surface corner with a real
three-plane solution. Boundary edges and corners preserve supported or
partial status, endpoint extension, segment gap, and plane residuals. An
incomplete scan remains an open boundary; M7.3 does not close a room, invent
missing corners, or construct wall, floor, ceiling, or mesh polygons.

For a selected wall-wall-horizontal triad, M7.3.1 also creates a separate
triad-backed corner candidate from the exact three-plane point. It evaluates
that point on each M7.2 theoretical line, compares its parameter with the
robust finite observed interval, and records any bounded extension required to
reach the corner. The M7.2 interval is never changed: raw support validates
the measured interval, while the M7.3 corner candidate preserves the exact
structural point. Triple-point support, source intersection status, numerical
line/plane consistency, and the bounded extension are all required before a
corner is supported. Rejected candidates remain in diagnostics, so a missing
endpoint cluster, weak support, unstable solve, or excessive extension is
visible rather than silently treated as an absent corner.

M7.3.2 performs canonical corner deduplication after all endpoint-cluster and
triad-backed candidates have been generated and validated. Candidate identity
requires bounded spatial proximity plus an unordered compatible structural
surface set; partial surface matches also require compatible source-edge
topology. An exact triad-backed corner is preferred over an endpoint-cluster
approximation, while the final node merges discovery sources and provenance.
Boundary edges are rewired through the canonical node so multiple discovery
paths produce one room-topology corner. Rejected candidates remain diagnostics,
and spatially distinct corners or corners with unrelated structural topology
remain separate.

M7.4 derives clean bounded room-surface patches from the selected structural
surfaces, supported or partial M7.2 boundaries, canonical M7.3 corners, and
the finalized fused support. Each selected plane receives a stable local
two-dimensional basis. Finalized support is projected into that basis, robust
support extents are bounded, and topology-backed intersection/corner
constraints take precedence over noisy support limits. The result is a new
immutable patch representation with 3D vertices, local vertices, indexed
triangles, plane data, confidence, completion status, and per-edge provenance.

Patch construction is intentionally open-ended. It can produce a bounded wall
patch from a single selected surface, partial ceiling or floor patches, and
adjacent patches that share canonical corner coordinates. It does not connect
disconnected surfaces, invent missing boundaries, close a room, assume a
rectangle, or snap measured planes to a Manhattan layout. A bounded support
hull is triangulated with a deterministic ear-clipping pass rather than an
arbitrary triangle fan, and all generated vertices are reconstructed on the
source plane. M7.4 is therefore a clean filled-surface review stage, not the
final room mesh or room-completion stage.

M7.4.1 makes the robust projected finalized-support hull the baseline for every
selected surface. Structural intersection lines are classified against that
support before they can clip it: predominantly one-sided support may define an
exterior boundary, while support on both sides is retained as an
internal/ambiguous diagnostic rather than destroying the patch. Accepted clips
are checked for finite vertices, meaningful area, and retained support; when
structural constraints disagree, a valid measured support hull is preserved as
an observed or partial patch. Canonical corners and supported structural edges
remain higher-quality provenance when they are consistent with the support.
The M7.2 intersection itself is therefore not automatically an exterior M7.4
polygon boundary. Construction diagnostics retain support counts, sided areas,
clip sequence, retained-support fraction, ignored internal lines, and a precise
skip reason for each selected surface.

M7.5 presents the constructed patches in a dedicated first-person review
viewer. The viewer consumes only the immutable M7.4 patch vertices and triangle
indices; it does not regenerate, complete, or mutate room geometry. A
deterministic camera placement is derived from the observed patch bounds and
uses an explicit 1.6 metre eye height when floor or local-floor reference
information supports that choice. Touch drag controls look direction, a small
on-screen control moves forward/back and laterally, and W/A/S/D plus pointer
drag support desktop review. Movement is delta-time based, pitch is bounded,
and generated wall patches provide conservative collision checks only where
actual wall geometry exists. Missing floor, walls, and other room surfaces
remain missing; entering the viewer does not imply that the room is closed or
automatically completed. The viewer uses simple deterministic role materials,
basic lighting, reusable meshes, and explicit disposal when the mode ends.

M8.0 adds a presentation-only customization layer after room-surface
construction:

```text
bounded M7.4 room-surface patches
        |
stable surface-ID selection by mesh raycast
        |
in-memory surface customization state
        |
paint color presentation in Room Surfaces and First-Person Room
        |
future wallpaper / tile / product material selection
```

Customization state is separate from the immutable M7.4 geometry and is keyed
by the generated patch ID. A tap or click on an actual patch selects one
surface; a drag remains a camera/orbit gesture. The selected patch exposes its
role, area, confidence, and current paint color, while a small preset/custom
color control updates only that patch's render material. Room Surfaces and the
first-person viewer receive the same in-memory state, so a color remains
consistent while navigating the current finalized scan. Reset controls clear
customization state only; they do not rebuild geometry, alter collision
surfaces, or change scan/evaluation data. Only generated M7.4 patches are
selectable, so missing room surfaces remain missing. M8.0 does not add a
product catalog, material estimation, persistence, or pricing.

M8.0.1 refines the customization panel workflow without changing that state
or the reconstructed geometry. The selected surface ID remains separate from
`customizationPanelOpen`: closing the panel hides the controls while
preserving the selected surface and every applied paint color. A visible close
button is available in both Room Surfaces and First-Person Room, Escape closes
the panel on desktop, and selecting a patch again reopens the controls on
mobile or desktop. The panel is a bounded editing sheet rather than a blocking
modal, so the room remains usable and no backdrop or browser-history
interception is needed. Small-screen color controls can scroll inside the
panel, and leaving First-Person closes the editing sheet before returning to
Room Surfaces.

The post-scan geometry direction is now:

```text
finalized fused geometry
        |
geometric plane extraction
        |
structural room-surface interpretation
        |
finite structural intersections
        |
canonical structural corners
        |
bounded structural surface patches
        |
future clean room mesh and first-person viewer
```

The longer-term post-scan direction is:

```text
FinalizedSpatialScan
        â†“
geometric plane extraction
        â†“
depth-layer surface-family consolidation
        â†“
final physical-surface consensus
        â†“
structural room-surface interpretation
        â†“
supported structural intersections
        |
structural boundary graph and corner nodes
        |
plane relationships and room envelope
        â†“
continuous editable 3D room
        â†“
first-person viewer
```

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

Live scan performance is measured in the XR service rather than inferred from
post-scan analysis. The XR render callback remains responsible for pose and
presentation every frame, while depth sampling, dense point reconstruction,
persistent surfel fusion, coverage processing, and transient candidate-mask
updates run on their bounded processing cadence. The current-point preview and
React/HUD diagnostics are also throttled because they are review telemetry, not
scan-state inputs. A fixed-size rolling performance tracker records observed XR
frame interval and processing time, p95 frame time, slow-frame budgets, stage
timings, active/rendered geometry counts, and elapsed-session windows. This
allows Android physical tests to distinguish an immediate hot path from
long-session load or thermal degradation without changing coverage meaning or
fused geometry quality.

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

## M8.1 experimental Reality Reconstruction capture probe

The scanner now contains an optional, client-only Reality Reconstruction
capture branch. It is deliberately separate from the validated structural
pipeline:

```text
WebXR immersive-ar
        |
        +--> depth + pose -> persistent structural scan -> M7.0–M7.5
        |
        +--> optional camera-access -> XRView.camera
                                -> XRWebGLBinding.getCameraImage()
                                -> small application-owned RGBA copy
```

M8.1 is only a capability and copy proof. On an active XR frame, the raw
camera service samples the browser-owned camera texture into a bounded,
application-owned framebuffer, then optionally performs a bounded CPU
readback for the development-only `RAW CAMERA COPY DEBUG` preview. The
browser-owned texture is never retained, uploaded, persisted, or used after
the frame/session lifecycle. The copy uses a centralized orientation setting
and exposes source/copy dimensions and mapping diagnostics so physical
Android testing can verify orientation, frame changes, and real camera
content.

Camera access is requested as an optional session feature and is sampled on
the existing bounded dense-depth cadence, not from a second XR loop. If the
feature, view camera, binding, texture, or copy path is unavailable, the
structural scanner continues unchanged and reports the raw-camera reason in
Debug. No RGB is fused into surfels yet and no Reality View is created by
this milestone. Future Reality Reconstruction may retain selected local
camera evidence beside the same world-space structural model, while the
structural surfaces remain the semantic editing layer.

## M8.2 RGB-D registration proof

M8.2 adds a transient `REAL RGB-D POINTS` debug branch to prove spatial color
registration without changing the scanner's structural data:

```text
current dense depth/world points
        + current XRView transform and projection
        -> camera normalized UV
        + M8.1 copy orientation/mapping
        -> pixel in the application-owned RGBA copy
        -> current world point with sampled camera RGB
```

World-space depth points are projected through the active view's inverse
transform and projection matrix. They are not matched by assuming equal RGB
and depth resolutions. The registration service reuses the raw-camera
service's authoritative full-frame mapping and orientation transform, and
samples the same application-owned readback buffer. A colored point is
accepted only when its camera copy belongs to the same eligible dense
processing tick; stale or unavailable copies are rejected and never silently
reused.

The debug renderer draws bounded current world points with their sampled
camera RGB values and reports projection, crop/buffer misses, stale pairing,
sample success, validation coordinates, and registration timing. This is a
physical alignment proof, not persistent color fusion: M8.2 does not modify
`FinalizedSpatialScan`, persistent surfels, structural surfaces, or saved
camera data. Persistent colored Reality Reconstruction is a future M8.3
stage.

## M8.2.2 full-frame RGB-D camera copy

M8.2.2 removes the destructive center crop that previously forced portrait
camera imagery into a landscape 160 × 90 buffer. The raw-camera service now
derives reusable copy dimensions from the actual `XRCamera.width` and
`XRCamera.height`, preserving the complete source aspect ratio under a
maximum dimension of 160 pixels and the previous 14,400-pixel budget. For
example, an 864 × 1920 portrait source becomes approximately 72 × 160;
the mapping reports the full source UV rectangle from 0..1 in both axes.

RGB-D registration therefore maps every valid projected camera UV through
the centralized orientation transform into the full copied image without
rejecting the top or bottom of a portrait frame because of an artificial
crop. The debug preview uses the copied dimensions, so portrait source
imagery remains visibly portrait. This changes only camera-copy coverage;
world-to-camera projection, depth semantics, structural results, and color
persistence remain unchanged.

## M8.3 persistent colored Reality Reconstruction

M8.3 adds the first persistent Reality Reconstruction output while keeping
the validated Structural / Design reconstruction independent:

```text
current accepted RGB-D observation
        + geometry-fusion surfel ID
        -> compact per-surfel linear-RGB sidecar
        -> immutable FinalizedRealityReconstruction on Finish
        -> Reality Preview

the same scan
        -> FinalizedSpatialScan -> M7 structural/design workflow
```

The color sidecar consumes the exact persistent-surfel identity selected by
geometry fusion; it does not perform a second spatial match and does not
change position, normal, coverage, or geometry weights. Camera bytes are
treated as sRGB, converted to linear RGB for a bounded weighted running mean,
then converted back to sRGB in the finalized companion snapshot. The first
color fusion path uses only the current depth observation that produced the
match, which keeps the RGB/depth association and occlusion behavior
conservative. Reused surfel slots carry generations so a new surfel cannot
inherit an old color.

`FinalizedRealityReconstruction` contains application-owned colored surfel
geometry and summary data only. It retains no browser-owned camera texture,
raw frame sequence, or camera image. When raw camera access is unavailable,
structural scanning and `FinalizedSpatialScan` remain fully usable and the
Reality companion reports `unavailable`; when no color was fused it reports
`empty` rather than inventing appearance.

Reality Preview renders all sufficiently stable finalized persistent surfels
that have real fused RGB, including non-structural observed geometry where
the existing surfel fusion preserved it. It uses direct, unlit vertex colors
for the original captured appearance. Room Surfaces, First-Person Room, and
M8 paint customization continue to use the separate structural/design data;
paint never changes Reality Preview. This is a colored-surfel proof, not a
textured mesh or photogrammetry-quality reconstruction.

## M8.4 dense continuous Reality surface visualization

M8.4 keeps the M8.3 persistent colored surfels and adds a post-scan
visualization layer for continuity. The development comparison modes are:

- `Raw Reality Points`: the original one-point-per-colored-surfel renderer.
- `Reality Splats`: oriented camera-visible patches built from each surfel's
  measured normal and stored footprint/radius, with a small bounded visual
  expansion to reduce holes.
- `Dense Reality Surface`: the default continuous mode. It combines the
  oriented splats with bounded local triangles between nearby, normal-compatible
  and locally coplanar Reality surfels.

The triangle pass is deliberately local and deterministic. It rejects long
edges, incompatible normals, excessive point-to-plane residuals, and tiny
triangles, so it does not fill unscanned regions or bridge obvious
wall/object and foreground/background discontinuities. All rendered colors
remain the actual M8.3 fused camera colors, and depth testing preserves the
occlusion ordering of the measured 3D scene. No M7.4 structural polygon is
textured or used to fill Reality geometry.

The Reality branch still uses the existing bounded persistent surfel capacity
(approximately 20,000 slots). M8.4 reports colored count, average nearest
neighbor spacing, estimated uncovered gaps, and whether capacity was reached;
it does not silently increase structural fusion capacity or introduce a
separate Reality-only store. If future scans show that measured density,
rather than splat/triangle coverage, is the limiting factor, that can be
addressed by a separate Reality-density milestone.

This remains a dense surface visualization, not a textured mesh or
photogrammetry-quality reconstruction. Future work may retain selected RGB
keyframes and build a post-scan mesh/texture projection pipeline, while the
structural/design reconstruction remains a separate semantic model.

## M8.4.1 Reality Capture lifecycle

Reality Reconstruction capture is a normal scan pipeline feature when the
active session has depth and optional raw-camera access. The product capture
state is independent from the development-only visualizations:

```text
session + depth + camera-access
        -> realityCaptureEnabled
        -> bounded camera copy cadence
        -> RGB-D registration
        -> persistent color fusion
```

`RAW CAMERA COPY DEBUG` only controls the diagnostic preview, and `REAL
RGB-D POINTS` only controls the diagnostic point mesh. Closing Debug or
turning either visualization off does not stop camera copies, registration,
color fusion, or the capture counters. The normal scanner HUD reports whether
Reality capture is starting, active, or unavailable; the Debug panel reports
capture status separately from both visualization states.

Reality capture continues on the existing bounded dense-processing cadence,
with no additional XR loop, resolution increase, or readback path. Eligible
RGB-D ticks, camera captures, fused observations, colored-surfel coverage, and
the last capture timestamp remain in application-owned diagnostics and are
finalized across the entire scan. If raw-camera access fails, only the Reality
branch becomes unavailable/partial; depth scanning, structural analysis,
Finish, and the M7 design workflow continue normally.

## M8.4.2 adaptive Reality surface refinement

M8.4.2 refines the post-scan Reality renderer without changing capture,
RGB-D registration, color fusion, or structural geometry. The original
colored Reality points remain available as `Raw Reality Points`; `Reality
Splats` now use oriented, unlit elliptical footprints with a soft bounded
edge instead of visibly hard square cards. The footprint is based on the
fused surfel radius and a bounded compatible-neighbor spacing estimate:
dense neighborhoods stay compact, while sparse but locally coherent samples
receive only a modest expansion.

The `Dense Reality Surface` mode adds only local, post-scan triangles. A
uniform spatial neighbor index bounds the work and supplies spacing
diagnostics. A candidate link must be spatially close, have compatible
normals, satisfy both local point-to-plane residual checks, and stay within
an adaptive edge limit. Tiny-area, long-edge, wall/object, foreground/
background, and other depth-discontinuous links are rejected. Triangles use
the actual fused vertex colors and normal depth testing, so this pass reduces
small sampling gaps without inventing a watertight room or bridging large
unobserved regions.

Refinement runs after Finish while the live scanner remains unchanged. The
Reality summary reports colored count, median and p90 compatible-neighbor
spacing, estimated small-gap and large-unsupported-gap regions, and capacity
utilization. No additional camera frames, image keyframes, or Reality-only
capacity are retained in this milestone. These measurements distinguish
renderer coverage limitations from a future need for higher-density Reality
geometry. Future work may add denser capture, retained RGB keyframes, or
post-scan mesh and texture projection; M8.4.2 is not photogrammetry-quality
reconstruction.

## M8.4.2.1 Reality splat compositing correction

M8.4.2.1 corrects a post-scan rendering artifact introduced by the soft
elliptical splat footprint. The captured RGB remains unchanged. Reality
splats use normal straight-alpha blending only for a narrow feather outside
an opaque, depth-writing measured-color core. The feather discards fragments
below a small alpha threshold and does not write depth; this prevents
near-transparent fragments from becoming invisible occluders. The shader
keeps the captured RGB unchanged while alpha controls only edge coverage.

Splat overlap is increased only from the compatible world-space neighbor
spacing already built for M8.4. The expansion is bounded and uses the
measured radius, compatible normals, and local plane residuals; it does not
bridge large gaps or add unsupported geometry. Dense Reality Surface uses
opaque local triangles for the same reason, followed by the explicit core
and feather layers. Raw Reality Points, Reality Splats, and Dense Reality
Surface remain available for comparison, while true unscanned regions remain
empty. No camera capture, RGB-D registration, color fusion, surfel capacity,
or structural model behavior changes in this correction.

## M8.4.2.2 Dense Reality layer composition

M8.4.2.2 makes Dense Reality Surface triangle-primary. Accepted local
triangles use the actual fused RGB at each vertex and represent every
surfel participating in a valid triangle. The corresponding full splat is
suppressed, leaving core/feather splats only for supported surfels that are
not covered by the local triangle graph. This prevents the normal view from
advertising every measured surfel as an overlapping circular stamp while
preserving Raw Reality Points and Reality Splats as diagnostic comparisons.

The rendering audit also found that Reality has no dark-gray fallback
population: normal geometry is built only from colored finalized surfels,
and triangles use unlit vertex colors. The remaining pattern came from the
triangle-plus-full-splat composition and the splat footprint showing the
dark review background through its discarded regions. M8.4.2.2 keeps the
opaque measured-color core, narrow depth-non-writing feather, alpha
threshold, and bounded compatible-neighbor overlap. It changes no camera,
RGB-D, fusion, capacity, or structural data and does not fill unsupported
space.

## M8.4.3 higher-density Reality-only reconstruction

The structural persistent surfel store remains the coarse, stable geometry
used for room understanding, M7 analysis, measurements, collision, and the
editable Design view. M8.4.3 adds a separate visual-only Reality store fed by
the same accepted, same-frame RGB-D observations after normal estimation.
It does not change structural matching, structural capacity, coverage, or any
M7 output:

```text
one accepted RGB-D measurement
        + measured world point/normal + fused RGB
        |\
        | \-> structural persistent surfel (existing bounded store)
        |\
        \----> finer Reality spatial hash (2.5 cm cells, 60,000 max samples)
                         -> immutable dense Reality snapshot on Finish
                         -> existing Reality Points/Splats/Dense Surface renderer
```

The dense store uses a packed typed-array representation and bounded local
neighbor checks. A measurement is merged only when its world-space distance,
point-to-plane residual, and sign-invariant normal agreement are compatible;
this prevents nearby foreground objects and background walls from becoming a
single visual surface. Each new visual sample is confirmed by a second
observation before finalization, while non-structural measured geometry is
kept because the branch does not filter by wall, floor, or ceiling role.
Actual camera RGB follows the existing M8.3 path (sRGB bytes, linear fusion,
sRGB finalized output); no second readback, camera loop, or image frame store
is introduced.

Reality Preview prefers the dense snapshot and falls back to the M8.3
structural Reality surfels if dense data is unavailable. The render modes,
adaptive splats, triangle safeguards, depth ordering, and orbit controls are
reused unchanged. Debug comparison reports structural versus dense counts,
stable samples, spacing, capacity, created/fused/rejected measurements, and
triangle/fallback participation so physical testing can determine whether
denser measured geometry reduces visible sample footprints. The 60,000-sample
bound is a visual-only capacity (about 3.9 MiB for the primary live numeric
arrays before the compact hash and finalized objects); it does not increase
the structural 20,000-surfel limit. Unscanned regions remain absent, and
this is still not a watertight mesh or photogrammetry-quality result.

## M8.4.3.1 dense Reality color propagation

M8.4.3.1 keeps the dense Reality geometry and fusion path unchanged while
validating its color handoff into the renderer. Dense finalized colors use the
same normalized sRGB `0..1` representation as M8.3. The renderer converts
those channels once to the linear `0..1` vertex-color buffer expected by
Three.js materials and the Reality splat shader; values are never treated as
`0..255` at that boundary.

Finished-review diagnostics expose bounded dense sRGB min/max/mean values,
non-white and approximate-unique color counts, sample records, and the
linear values immediately present in the uploaded render attributes. A
development-only source switch compares the unchanged structural Reality
snapshot with the dense snapshot. If dense numeric color validation fails,
the review safely uses Structural Reality rather than displaying a white
fallback scene. This milestone changes no camera capture, RGB-D registration,
color weighting, geometry matching, capacity, or structural output.

## M8.4.3.2 sampling-lattice / surface-continuity audit

The physical M8.4.3.1 baseline is 28,814 stable / 32,637 active dense samples,
0.025 m median / 0.031 m p90 spacing, and 100% color coverage. Those summary
numbers do **not** establish whether the photographed stripes exist in the
finalized positions. The physical snapshot was not available to this code
audit; another device comparison is required before blaming live sampling.

The live audit found a cached, fixed 80 x 45 normalized view/depth sampling
grid: `(column + 0.5) / 80`, `(row + 0.5) / 45`. At the reported 160 x 90
depth size the nominal steps span two pixels, subject to the runtime depth
transform. There is no depth-grid temporal offset. The four-phase coverage
schedule acts downstream, not on the dense RGB-D input; the every-second-tick
camera schedule also does not change sample positions. No new sampling phase,
camera copy, readback, or live work is introduced without physical evidence
that the input lattice itself is the remaining cause.

Dense hash keys index 2.5 cm cells, but stored/finalized positions are measured
positions with bounded running position fusion, **not cell centers**. The
snapshot does not retain per-sample source depth pixels or capture phase.
This milestone neither invents that provenance nor changes the dense store,
60,000 capacity, geometry matching, real RGB, or sRGB/linear fusion.

Two renderer connectivity defects were reproduced on a synthetic uniformly
sampled plane:

- The former 96-entry query budget was consumed in lexicographic hash-cell
  order, including entries skipped because of earlier IDs. It could miss
  closer points and prefer one direction. Reversing IDs changed the triangles.
- The `1e-6` squared-cross-product area gate rejected a valid 2.5 cm right
  triangle (`3.90625e-7`). Selecting the first four nearest-neighbor pairs also
  produced duplicate/overlapping, directionally biased triangles.

Post-scan neighbor lookup now uses a balanced, near-first spatial tree, keeping
the existing eight-neighbor budget. Queries have a 512-node safety bound and
report any exhaustion. Tangent-plane empty-circumcircle tests choose local
triangles geometrically; cocircular ties use measured-position ordering, not
IDs, and duplicate triples are suppressed. A scale-relative degeneracy test
accepts small well-shaped measured triangles. Existing distance, normal,
bidirectional plane-residual, and adaptive maximum-edge gates remain, with an
additional rejection of unsupported angular spans over 120 degrees. No new
vertices, room sheets, or measured positions are generated.

A separate confirmed display mismatch affected dark splats: the custom shader
received linear RGB but omitted Three.js's output-color conversion used by
the triangle material. Both core and feather now use the same
`colorspace_fragment` conversion as MeshBasicMaterial. Source RGB and alpha
are unchanged; the opaque core still writes depth, the feather does not, and
both test depth. There is still no uncolored gray fallback population.

Reality development diagnostics are collapsed but available in deployed phone
builds. Using the **same selected snapshot**, compare Raw Points (8 mm diagnostic
points), Splats, Triangles only, and Final. Rows in Raw Points are data evidence;
additional patterns in triangles implicate connectivity; spots added by Final
implicate splat composition. Truly dark captured RGB, unsupported space, and
missing triangle connectivity remain separate possibilities, not an automatic
classification of every dark screen pixel.

Bounded diagnostics include folded tangent-direction and 5 mm spacing
histograms, tangent U/V median link spacing and anisotropy, missing directional
links, query exhaustion, genuinely dark source-RGB count, triangle participants,
fallback/suppressed counts and percentages, preparation timings, geometry memory,
and existing throttled preview FPS. Directional-link gaps are not exact hole
areas; triangle participation is a vertex count, **not** surface-area coverage.
Earlier snapshot gap estimates remain visible but are not proof of watertight
coverage. The eight existing sample RGB/position records remain available.

Controlled desktop Node checks (not POCO measurements), same 28,900-point
2.5 cm plane:

| Renderer audit | Before | After |
| --- | ---: | ---: |
| Reported compatible-neighbor median / p90 | .0354 / .0791 m | .025 / .025 m |
| Triangle participants | 99.875% | 100% |
| Fallback vertices | .125% | 0% |
| Triangles | 105,550, including overlaps | 57,122 |
| Index + triangle preparation | ~346 ms | ~933 ms |

These are renderer diagnostics on identical data, **not a physical density
increase**. A 59,536-point grid took about 1.87 s and produced 118,098 triangles
(8.11 MiB of position/color buffers); the 28,900-point grid used 3.92 MiB.
Neither query exhausted its bound. Timing varies by hardware/JIT and does not
predict phone FPS. Processing runs in a cancellable post-scan worker with
`Preparing Reality Preview...`; transferred numeric geometry is uploaded once,
and leaving/changing modes terminates obsolete jobs. Eight bounded neighbor
records per sample and temporary worker data are released after preparation.
No camera frames are retained, and suppressed splats do not reserve full
capacity buffers. Phone preparation, orbit performance, actual triangle/fallback
rates, and stripe reduction must be measured in the next physical test.

Run `npm run test:reality` for planar coverage, ID/rotation invariance,
small/degenerate triangles, separated planes/open gaps, anisotropic data,
empty/uncolored inputs, RGB preservation, and worker-transfer composition tests.
This remains measured local Reality surface visualization, not photogrammetry,
texture mapping, or M8.5.

## M8.5 Reality / Design integration

M8.5 connects the two already world-aligned post-scan outputs without changing
either reconstruction:

```text
scan RGB-D
        |
        +--> Dense Reality Reconstruction
        |      measured scene geometry + immutable captured RGB
        |
        +--> Structural Reconstruction
               M7.4 bounded semantic wall / ceiling / floor patches
        |
        +--> post-analysis Reality / Structural association
               -> Original Reality Preview
               -> Design Reality Preview
```

The association is a separate, bounded post-analysis worker result. A Reality
world-space hit is tested against real M7.4 patch geometry: plane distance,
projection into the patch's stored local basis, polygon containment with a
bounded edge tolerance, and sign-invariant normal agreement. It returns a
strong, partial, or no match with the stable M7.4 patch ID, role, distance,
containment, normal compatibility, and confidence. Screen position, centroids,
mesh indices, and invented room extents are not identity evidence. A weak or
no match is intentionally left uneditable.

For Design Preview, every finalized dense Reality sample receives a derived
association index only when it is strongly inside an actual structural patch,
normal-compatible, and within a narrow wall-plane band. Samples projected
inside a patch but sufficiently in front of its plane are preserved as
foreground Reality (for example curtains, cabinets, chairs, and tables).
Samples outside a partial M7.4 polygon remain original. This avoids a large
wall overlay and preserves the existing Reality geometry/depth ordering: no
painted wall is drawn over foreground objects, and no z-fighting structural
sheet is introduced.

Paint is a display-time sidecar. It reads the existing M8 stable surface-ID
customization state, derives a linear paint color for associated samples, and
retains bounded captured luminance variation so room lighting/shadows remain
legible. It does not alter final Reality RGB, Dense Reality geometry, M7.4
patches, or structural/customization IDs. Switching to **Original** supplies
no derived colors and restores the same captured Reality source immediately;
multiple structural walls can hold independent colors through the one shared
customization map used by Room Surfaces and First-Person Room.

Reality Original remains available immediately after Finish. Design is
disabled until the existing Analyze Surfaces workflow has produced M7.4
patches; analysis is never triggered implicitly. Once ready, the compact
Original / Design control and Reality tap selection open the existing
closeable Surface Customization panel. A selected patch gets a depth-tested
world-aligned outline. The normal UI uses product language, while collapsed
development diagnostics expose last hit evidence plus associated, preserved
foreground, rejected, and preparation counts.

Association and changed Design colors run after scan completion in workers;
there is no new XR loop, RGB readback, depth sampling, live fusion, or React
frame work. The existing renderer worker creates the immutable Original or
derived Design display buffers once per requested state and the preview uploads
them once. This is a paint-color integration boundary for later wallpaper,
tile, and material display work, not texture projection, product catalog,
quantity, or pricing.

### M8.5.1 — Logical Wall Grouping + Reality Wall-Membership Mask

Physical POCO F5 field testing revealed two critical failure modes in M8.5:
1. **One physical wall is not one structural patch:** Due to real-world
   obstructions (curtains, bookshelves, doorways, window gaps) and capture
   pauses (>0.3 m), M7.0 plane consolidation does not merge separated patches
   because they lack projected 2D IoU overlap. M7.4 produces separate patches
   (e.g. Patches 17, 23, 31). Customizing one patch left neighboring portions
   of the same real wall unpainted.
2. **Foreground objects in front of walls (e.g. curtains, cabinets) were recolored:**
   Geometric polygon containment combined with an unconstrained plane band
   classified foreground objects near walls as wall material. Tapping a curtain
   falsely selected the wall behind it and painted the curtain.

M8.5.1 introduces a two-tier structural association architecture:

#### 1. Logical Structural Surfaces (`LogicalStructuralSurface`)
- Groups observed compatible M7.4 patches into canonical user-facing logical
  surfaces without altering underlying clean M7.4 geometry or plane extraction.
- **Grouping criteria:**
  - Role match (walls group only with walls; floors with floors; ceilings with ceilings).
  - Normal parallelism (angle ≤ 18° for walls, ≤ 12° for floor/ceiling).
  - Plane constant offset ≤ 0.16 m.
  - Centroid coplanarity ≤ 0.18 m.
  - Spatial boundary proximity ≤ 1.2 m (allowing for doors, windows, and scan gaps).
  - Disjoint-set union guarantees opposite/parallel walls (>0.5 m apart) and
    perpendicular walls never merge.
- **Customization synchronization:** Setting paint color on a logical wall
  atomically synchronizes all member patch IDs in `surfaceCustomizations`. Room
  Surfaces preview, Reality Design preview, and First-Person Room Viewer remain
  100% synchronized. Selecting any member patch highlights all member patches
  together.

#### 2. Reality Wall-Membership Mask
- Rather than a coarse distance band, each dense Reality sample is strictly
  classified: `WALL_MEMBER` (1), `NON_WALL` (0), or `UNCERTAIN` (2).
- **Trusted structural seeds:** Seeded exclusively from dense samples with low
  plane residual (≤ 1.8 cm), high normal agreement (dot ≥ 0.85), polygon
  containment, and proximity (≤ 0.12 m) to trusted `structuralSurfels` from the
  finalized scan.
- **Bounded local region growth:** Propagates outward from seeds through a 3D
  spatial grid. Neighbors must satisfy step distance ≤ 0.045 m, out-of-plane
  depth discontinuity step ≤ 0.015 m, plane normal dot ≥ 0.78, and neighbor
  normal dot ≥ 0.82.
- **Foreground object preservation:** Objects in front of the wall (residual
  > 0.035 m or depth step > 15 mm, such as curtains, cabinets, and chairs) are
  strictly classified as `NON_WALL`. Unreached candidate samples are marked
  `UNCERTAIN`.
- **Shading isolation:** Only `WALL_MEMBER` samples receive paint shading
  with natural luminance preservation; original camera RGB remains 100% immutable.

#### 3. Tap Hit Classification & Triangle Voting
- Reality raycasting evaluates dense triangle vertices when tapping the mesh.
- Requires majority agreement (≥ 2 of 3 vertices classified as `WALL_MEMBER`)
  and the hit point itself to be a wall member.
- Tapping curtains, furniture, or uncertain boundary areas rejects selection with
  an explicit explanation (e.g. "Tap rejected: foreground object detected").
- Tapping any member region of a logical wall resolves to the parent logical wall.

#### 4. Diagnostic Color Modes & Group Diagnostics
- Visual debugging color modes in Reality Preview:
  - **Default Colors**: Normal Reality / Design mode.
  - **Color by M7.4 Patch**: Pseudo-color per M7.4 structural patch to inspect fragmentation.
  - **Color by Logical Wall**: Shared pseudo-color across all member patches of each logical wall.
  - **Reality Wall Mask**: Green/cyan for `WALL_MEMBER`, amber for `UNCERTAIN`, dark red for `NON_WALL`.
- Diagnostics panel displays logical wall group composition, total areas,
  coplanar residuals, and detailed evidence for the last Reality tap.

### M8.5.2 — Robust Structural Surface Membership Expansion

M8.5.2 preserves M8.5.1's strict trusted structural seeds, but separates
high-precision seed membership from a bounded surface-aware expansion pass.
This improves visible wall/ceiling recall without restoring the unsafe rule
that every Reality sample inside a structural polygon is paintable:

```text
Logical structural surface (member M7.4 patch union)
        ↓
candidate Reality domain
        ↓
strict trusted core
        ↓
bounded local normal / plane / connected-neighbor expansion
        ↓
CORE / EXPANDED / UNCERTAIN / NON_WALL
        ↓
Design paint mask
```

- `CORE_WALL_MEMBER` is a strict M8.5.1-style anchor: low plane residual,
  strong individual normal, polygon containment, and structural-support
  proximity.
- `EXPANDED_WALL_MEMBER` is reached only through measured dense-Reality
  connectivity with multi-neighbor support, local normal consensus,
  representative-plane agreement, and a bounded local depth step.
- Expansion thresholds are calibrated from strict-core residual and local
  spacing distributions, then clamped to conservative meter-scale bounds.
  This remains orientation independent for walls, ceilings, and floors.
- A structural polygon is a valid **candidate domain**, not the paint mask.
  Samples that lack enough proof are `UNCERTAIN` and retain original RGB;
  `NON_WALL` requires positive foreground/conflicting evidence.
- Foreground components remain barriers. A curtain/cabinet depth offset,
  discontinuity, conflicting logical surface, or disconnected component cannot
  be crossed merely because it is close to the same plane.
- All member M7.4 patch extents of a logical surface are evaluated as a union;
  this preserves shared customization across fragmented observed portions while
  never fabricating unobserved wall geometry.

The worker exposes per-logical-surface candidate/core/expanded/uncertain
counts, rejection reasons, residual/normal/depth-step distributions, selected
expansion bounds, and seed/index/growth/finalization timings. Reality Wall Mask
uses cyan for core, green for expanded, amber for uncertain, and dark red for
non-wall. Only core and expanded samples receive Design paint; Original Reality
remains immutable.

### M8.5.3 — Structural Surface Recall + Reality Membership Calibration

M8.5.3 improves Design coverage without changing M7.0 plane extraction, M7.4
patch construction, or any live Reality capture/reconstruction path. It treats
two distinct post-scan limitations independently:

```text
Geometric plane
        ↓
structural interpretation
        ↓
selected wall OR strong standalone wall
        ↓
M7.4 observed patch
        ↓
LogicalStructuralSurface
        ↓
derived Reality membership calibration
        ↓
CORE / EXPANDED / UNCERTAIN / NON_WALL
        ↓
Design paint
```

- A **strong standalone wall** is a high-confidence vertical plane with
  sufficient observed area, support, span, fit quality, and wall envelope
  evidence. It can survive even without a closed-room triad or corner graph.
  The path still rejects weak/tiny planar objects, poor fits, duplicates, and
  unsupported same-direction layers; it does not complete a missing room.
- Membership exposes signed M7-plane residual distributions. When locally
  connected, high-confidence Reality support establishes a bounded, robust
  systematic offset, a separate **Reality membership reference plane** is used
  for masking only. M7 positions, dimensions, area, collision, and patch
  polygons are never moved.
- Each logical surface gets an adaptive, tightly clamped residual envelope from
  its robust calibrated distribution. Strict original-plane seeds remain the
  precision anchor; calibration anchors and multi-neighbor connected growth
  improve measured-surface recall without turning a broad plane band into paint.
- An M7.4 polygon remains the observed structural support boundary, but the
  paint-mask domain may grow a small distance beyond it only along a measured,
  connected, plane-compatible dense-Reality chain. Empty space, disconnected
  coplanar components, and missing wall extents remain unpainted.
- Foreground offsets, depth discontinuities, conflicting logical surfaces, and
  disconnected components remain propagation barriers. Ambiguous samples are
  `UNCERTAIN` and preserve original RGB; `NON_WALL` is reserved for positive
  contradictory/foreground evidence.

Diagnostics now report structural standalone-wall promotions; raw and signed
residual distributions; reference offset and calibrated envelope; inside/outside
patch candidates; connected observed extension; core/expanded coverage; and
mutually exclusive terminal non-paintable reasons. These are post-analysis
worker measurements only: no new XR work, camera reads, or scan-time fusion is
introduced.

# Spatial Scanner Vision

Current implementation: **Scanner Build M8.7.1.3**. Live scanning uses a
bounded lightweight map while production Reality is rebuilt after Finish from
coverage-aware retained accepted measurements. Canonical lifecycle, measured
hybrid display, real-RGB fallback and Finish progress are now separately
observable. M8.6.7.2 customization remains frozen pending physical
reconstruction validation; see the M8.7/M8.7.1 sections below and the
[M8.7.1.3 implementation report](M8_7_1_3_IMPLEMENTATION_REPORT.md).

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

### M8.5.4 — Depth-Aware Structural Design Compositing

M8.5.4 keeps the two post-scan representations separate and uses each for the
job it can support reliably:

```text
REALITY ORIGINAL
  = complete Dense Reality geometry with immutable captured RGB

DESIGN
  = clean observed M7.4 structural paint surfaces
    + depth-tested preserved Reality foreground
```

The prior Design display recolored only dense samples proven to be wall members.
That made paint coverage dependent on near-perfect Reality wall-mask recall:
uncertain samples and a second Reality layer could retain original wall RGB and
visually cover the intended paint. M8.5.4 reverses the render-time question.
Inside a customized observed structural patch, the compositor asks whether a
Reality sample has **positive foreground evidence**, rather than requiring it
to prove wall membership. Samples with existing foreground evidence, a bounded
offset from the calibrated structural reference, or a depth/discontinuity
barrier remain visible as captured Reality. Same-wall and ambiguous Reality
samples are suppressed from the derived Design render, allowing the continuous
M7.4 polygon to show through.

Structural Design polygons stay at their measured M7.4 world positions with
normal depth testing/writing. The filtered Reality foreground then draws over
them, so a curtain, cabinet, chair, or other observed foreground geometry can
occlude the selected paint naturally. Reality behind the structural patch fails
depth testing; same-wall Reality no longer z-fights because it is not rendered
in the Design pass. No structural geometry is added to **Original**, and no
Reality sample or camera color is mutated.

Each customized logical surface independently contributes its member M7.4
patches, so multiple walls and ceilings can carry different paint colors while
their real foreground geometry remains visible. The paint domain is still only
the bounded observed structural geometry: no missing wall, room closure, or
unobserved extension is invented.

Development comparison modes provide **Structural Design Only**, **Foreground
Reality Only**, **Design Composite**, and **Compositor Classification**. The
worker reports structural patch count, selected-domain samples, foreground
samples preserved, same-wall samples suppressed, ambiguous samples, preparation
time, and bounded memory. This remains entirely post-scan; it adds no XR work,
camera capture, RGB-D processing, or live scanning cost.

### M8.5.5 — Visible Paintable Surface Mask

M8.5.5 keeps the continuous M8.5.4 structural Design background, but no longer
treats an entire M7.4 polygon as automatically visible wall material. For every
customized patch, a post-scan wall-local grid is derived from its measured U/V
basis at approximately 3 cm cells (bounded to 160 cells on either axis):

```text
M7.4 structural patch
  + Dense Reality samples in patch-local (u, v, signed offset)
  + existing foreground evidence / local normal and depth evidence
  + connected-component support (RGB only secondary)
      -> exposed paintable cells | preserved Reality cells | unsupported cells
```

The structural patch remains the editable Design surface, but only its
**exposed paintable** cells render the selected paint. Confirmed foreground,
connected shallow attached/near-wall content, and uncertain geometry retain
their original dense-Reality RGB and depth. This lets a painted wall read as a
continuous material surface while a picture, mirror, frame, thin shelf,
curtain, or furniture with sufficient measured evidence remains visible over
it. Empty/unsupported cells remain empty; the mask never invents wall coverage.

RGB discontinuity can strengthen a connected geometric component, but it never
by itself classifies a differently coloured wall region as an object. Extremely
thin, fully coplanar content (for example a poster flush against a wall) may not
be distinguishable reliably using browser RGB-D geometry alone, and is an
explicit limitation rather than fabricated semantic certainty. Original Reality
remains an immutable unmasked capture; all mask and Design geometry are derived
presentation data and are discarded/rebuilt with the post-scan preview.

Development views expose the **Exposed Wall Mask**, **Preserved Object Mask**,
full **Structural Design Only**, and the final **Design Composite**, along with
per-patch mask area, resolution, component count, and preparation timing.

### M8.5.6 — Reality-Aligned Wall Surface Painting

M8.5.6 corrects the final visual primitive in Design mode. M7.4 remains the
semantic/measurement model, but its clean patch polygon is no longer rendered
as the normal visible paint surface:

```text
Logical structural surface ID
  -> strict measured Reality-triangle seeds
  -> shared-edge adjacency and bounded compatible growth
  -> one or more connected Dense Reality wall components
  -> derived paint colors on the original Reality triangle vertices
```

Each Dense Reality triangle retains its original world positions and source
surfel IDs. Growth requires a calibrated plane relationship, compatible triangle
and structural normals, shared-edge connectivity, and no existing foreground or
attached/uncertain M8.5.5 barrier evidence. This preserves curtains, furniture,
and separately supported wall-mounted content while permitting multiple
disconnected observed components of one logical wall. Missing scan regions are
not filled.

**Original** remains the untouched captured Dense Reality scene. **Final
Design** is that same geometry with derived colors only on confirmed triangle
components; a selected M7.4 patch is available solely as a structural debug
reference/outline. M7 area and boundaries remain authoritative for future
measurement and costing, not noisy visible-triangle area.

### M8.5.7 — Hit-Seeded Visible Reality Surface Ownership

M8.5.7 keeps M8.5.6's Reality-triangle Design renderer, but corrects the
ownership direction when automatic structural seeds cannot reach the frontmost
surface that a person is actually viewing. The selection path is now:

```text
USER TAP
  -> frontmost raycast Dense Reality triangle
  -> shared-edge connected visible Reality component
  -> broad M7 logical-surface validation
  -> retained user-hit ownership for this finalized scan
  -> derived Design color on those original Reality triangles
```

The raycast triangle is authoritative for **which visible layer** was selected.
M7.4 and its logical surface IDs remain the semantic validator: they check role,
calibrated plane relationship, normal agreement, and bounded observed patch
extent, but they cannot replace the hit component with a different hidden layer
that happens to be closer to the clean M7 plane. Component growth uses only
shared edges, local triangle-normal continuity, a bounded structural envelope,
and the existing foreground/attached-object barriers. It stops at real corners,
objects, unsupported gaps, and incompatible geometry.

The accepted `VisibleRealitySurfaceOwnership` is derived, scan-local UI state.
It records the hit triangle, component triangles, measured area, representative
normal, offset, confidence, and logical ID. It is retained through Original /
Design switching and paint swatch changes, then discarded with the finalized
scan. A user-hit component overrides automatic ownership only for that same
logical surface, preventing a hidden automatic component from being painted
instead. Dense Reality geometry, captured RGB, M7 geometry, collision, and
measurements remain immutable.

Development views distinguish automatic components from **All Reality
Components**, **Hit Component**, **Logical Wall Owned Components**, and
**Rejected Nearby Components**. Tap diagnostics report hit/component identity,
triangle count, area, calibrated offset, structural candidates, confidence, and
post-scan adjacency/growth timing. This is still measured triangle recoloring,
not an opaque M7 paint polygon, image texture projection, semantic object
recognition, or fabricated wall filling.

### M8.6 — RGB-Guided Visible Wall Segmentation + 3D Projection

M8.6 adds a bounded, local-only visual-analysis branch without changing the
validated M8.1/M8.2 camera copy used by live RGB-D registration, Dense Reality
fusion, M7 geometry, or Reality Original rendering.

```text
SCAN: RGB + depth + pose
       |
       +--> Dense Reality ------------------+--> final visible triangle geometry
       |                                    |
       +--> bounded application-owned RGB keyframes
                    |                       |
M7 logical wall ---+--> projected wall ROI -> local visible-wall mask
                                            |
                                            +--> world-to-keyframe projection
                                                     |
                                                     +--> Design triangle colors
```

The raw-camera service still maintains its validated small full-frame RGB copy
for same-frame fusion. Separately, only a pose-diverse, depth-supported frame
may receive one modest full-frame keyframe copy (currently up to 320 pixels on
the long edge and 57,600 pixels). A maximum of 12 application-owned RGB frames
is retained. For the POCO F5 portrait source this is approximately 144 × 320,
or about 138 KiB RGB per keyframe and about 1.6 MiB for all RGB payloads,
plus a negligible set of matrices and mapping descriptors. Keyframes retain
RGB bytes, camera/inverse-camera transforms, projection matrix, mapping and
quality metadata; no browser-owned texture, video sequence, or remote upload
is retained.

During scanning, generic keyframe selection uses a minimum interval together
with translation or rotation diversity and valid depth support, so it rejects
near-duplicate poses instead of saving frames at arbitrary time intervals.
After M7 analysis, a logical surface projects its observed structural support
into each retained keyframe. Projected area and capture quality select at most
three keyframes for that surface; the M7 projection is a **search ROI and
semantic prior**, not the visible paint geometry.

The initial replaceable `VisibleWallMaskProvider` is a deterministic local
geometric/RGB implementation. High-confidence M8.5 structural/Reality samples
project into a selected keyframe as trusted visual-wall seeds. Within the ROI,
bounded connected growth compares normalized chroma separately from luminance,
so moderate lighting variation can remain wall while strong, enclosed colour
or texture changes stop growth. Structural seed support and ROI containment
remain required; RGB alone never declares a different-coloured wall an object.
The current keyframe representation deliberately does not retain a second
depth image: existing M7-supported 3D seeds and Dense Reality are the geometry
evidence for this first local provider. A later provider may add bounded depth
snapshots or semantic segmentation behind the same interface.

Each Dense Reality sample is reprojected with the same M8.2 convention used for
registration: world position -> saved inverse camera transform -> projection
matrix -> NDC/UV -> authoritative camera-copy mapping -> keyframe mask pixel.
Votes from selected keyframes are fused conservatively. A wall vote must beat
non-wall votes, and overlapping M7 ROIs cannot overwrite a stronger logical
surface vote. A Dense Reality triangle receives a wall logical ID only when at
least two of its three source samples agree. Thus normal **Design** continues
to use original Dense Reality triangle positions and derives paint colour only
where visible RGB-guided evidence confirms wall material. `NON_WALL` and
`UNCERTAIN` remain original captured RGB. **Original** never reads or mutates
the mask and remains the exact captured Reality appearance.

If no retained keyframe adequately observes a selected wall, the renderer does
not fall back to an opaque M7 rectangle. It leaves Reality original and reports
that visual coverage is insufficient. Keyframes and derived masks are
scan-session-only data: they are reset on a new scan, cancel, session stop, or
dispose. No cloud API, SAM, TensorFlow, ONNX model, or other remote semantic
inference is used in M8.6. Thin fully coplanar content, such as a poster flush
to a wall, remains an honest limitation until a later replaceable mask provider
adds stronger visual semantics.

Development diagnostics expose retained keyframe count/resolution/memory,
best keyframe, projected structural ROI, trusted seed and RGB mask statistics,
non-wall/uncertain view, projected 3D mask evidence, and per-wall selected
keyframes. Mask preparation runs in a cancellable post-scan worker; paint
swatch changes reuse the completed sample-to-logical-wall map rather than
rerunning segmentation or adding XR-loop work.

### M8.6.1 — Preserved Attached-Object Exclusion

Physical M8.6 validation showed that the first RGB grow rule could still
absorb a visually distinct wall-mounted decoration when its depth offset was
too small to be a reliable foreground barrier. This is treated as a
preserved-object exclusion failure, not as a successful wall mask.

M8.6.1 therefore separates high-confidence paintable wall continuation from
ambiguous appearance. RGB growth now accepts only tighter chroma/luminance
agreement with trusted exposed-wall seeds **and** bounded local pixel-to-pixel
edge continuity. Pixels outside that confidence do not become wall merely
because they lie in the projected M7 ROI: they remain original Reality unless
they have positive preserved-object evidence.

After strict wall growth, the provider examines remaining local RGB regions.
An enclosed, bounded, visually divergent component with enough border evidence
against confirmed wall is classified as a preserved attached object. This
captures frames, pictures, mirrors, and shallow decoration without semantic
object labels or an unreliable plane-distance threshold. Strongly divergent
pixels receive the same preserved treatment directly. Regions touching the
ROI boundary, weakly supported components, shadows, or otherwise uncertain
appearance remain `UNCERTAIN` and preserve original RGB rather than being
painted. This deliberately favors a small original-content island over
painting a real decoration.

Per keyframe, the mask retains compact evidence codes for structural seed,
consistent wall growth, strong visual object, enclosed visual object, and
uncertain. Development views now include **Paintability Evidence** and
**Preserved Object Evidence**. Selected-wall diagnostics report ROI pixels,
paintable pixels, preserved-object pixels/coverage, preserved-uncertain pixels,
and per-keyframe seed/grown/strong-object/enclosed-object/uncertain counts.
The work remains bounded and post-scan; no XR capture rate, RGB-D registration,
Dense Reality geometry, or Reality Original data changes.

### M8.6.2 — Confident Wall Expansion Around Preserved Visual Islands

M8.6.1 deliberately tightened the primary RGB wall-growth pass to protect
attached visual content. Physical validation showed the intended precision
gain, but too many normal wall pixels then remained `UNCERTAIN`. M8.6.2 keeps
the strict seed definition and primary growth thresholds unchanged, and adds a
separate bounded post-scan reconsideration pass:

```
strict wall seeds
       ↓
primary RGB growth
       ↓
visual-edge-separated uncertain regions
       ↓
preserved visual islands + secondary wall expansion
       ↓
multi-keyframe sample evidence
       ↓
WALL / OBJECT / UNCERTAIN
       ↓
Dense Reality triangle paint
```

Uncertain pixels are grouped only through locally smooth image appearance;
strong RGB/luminance edges split components. A region can become secondary
wall only when it touches confirmed wall in multiple places, has no preserved
object contact, remains broadly compatible with the trusted wall appearance,
and has no high-gradient boundary. This recovers smooth shadows and lighting
variation without allowing the expansion to cross a decoration boundary.

A bounded, visually distinct, sufficiently enclosed region surrounded by
confirmed wall becomes a preserved visual island. It remains original Reality
and acts as a hole around which the wall can continue. A colour difference by
itself is still not enough: gradual connected variation remains wall, while a
bounded high-contrast interior with strong surrounding support is preserved.
The provider preserves any region that cannot meet either proof; `UNCERTAIN`
is a safety state, not a substitute for object detection.

Selected keyframes still fuse evidence by reprojection onto the same Dense
Reality samples. M8.6.2 uses conservative multi-view sample voting (two wall
votes, or a single high-quality uncontested wall vote) and reports mutually
exclusive 3D unresolved reasons. It intentionally does not introduce a new
wall-local UV raster in this release: M7 remains the semantic ROI prior and
multi-view world-to-keyframe projection remains the final evidence path.

Development diagnostics add secondary-wall expansion, preserved visual-island,
and uncertain-terminal-reason views. Per keyframe they report strict seed,
primary-grown, secondary-expanded, strong-object, enclosed-object, uncertain,
and island counts. Per selected logical surface they report 3D unresolved
reasons (`not observed enough`, `conflicting keyframes`, `2D mask uncertain`,
`object evidence`, `UV outside`, or `insufficient wall votes`) plus bounded
analysis/projection timings and memory. The refinement remains post-scan and
does not alter keyframe cadence, camera capture, RGB-D registration, Dense
Reality data, M7, or Reality Original.

### M8.6.3 — Visibility-Aware RGB Mask to Dense Reality Fusion

M8.6.2 established a useful visible-wall mask, but physical diagnostics found
that a strong 2D wall result could collapse into a mostly `UNCERTAIN` Dense
Reality assignment. The cause was in the 3D evidence bridge, not RGB
segmentation: the former fusion pass counted projected pixels outside a
selected wall ROI as uncertain observations and required either two wall
votes or a whole-keyframe quality score of 0.90 for a single vote.

```
NO OBSERVATION
  != UNCERTAIN OBSERVATION
  != NON-WALL / OBJECT EVIDENCE

RGB mask
  ↓
visibility-aware keyframe observation
  ↓
multi-view evidence fusion
  ↓
Dense Reality sample assignment
  ↓
triangle paint assignment
```

Only a world point that projects into the selected keyframe image and its wall
ROI reads a mask pixel. Projections outside that ROI are not observations and
cannot suppress wall paint. `UNCERTAIN` mask pixels are neutral evidence;
they do not equal an object vote. Explicit preserved-object pixels remain
strong negative evidence and override competing wall votes.

A single in-ROI wall observation can now confirm a sample when its local
confidence is strong and it has no object evidence. Local confidence combines
mask provenance (seed/primary/secondary), ROI-edge distance, camera-facing
quality, camera distance, and global keyframe quality as a small modifier.
It does not reject a clean local wall observation solely because the full
keyframe has a moderate quality score. Multiple wall observations still
increase confidence. The same saved pose/projection/copy mapping remains
authoritative; no second projection convention was introduced.

No keyframe depth snapshot was added: the diagnosed loss was ROI accounting
and vote policy, not proof of a depth-visibility failure. Wall-local UV raster
fusion was also deferred; direct multi-view world-to-keyframe evidence is now
visibility-aware and remains the bounded source of truth.

Post-scan diagnostics expose Dense Reality candidate and observation counts
(0/1/2/3 selected keyframes), wall/object/uncertain mask observations, single
and multi-view wall evidence, mutually exclusive unresolved 3D reasons, and
3D observation-count, wall-confidence, terminal-reason, object-vote, and
final-assignment views. Triangle diagnostics report 3/3, 2/3, 1/3, and 0/3
sample support. Added data is compact typed arrays transferred from the
existing worker; capture cadence, RGB-D registration, Dense Reality, M7,
renderer geometry, and Reality Original remain unchanged.

### M8.6.4 — Multi-View Preserved Object Region Consolidation

M8.6.3 correctly transfers broad wall evidence to Dense Reality, but a real
mounted painting can still arrive as scattered strong-object pixels, enclosed
pieces, and neutral gaps. M8.6.4 adds a derived preserved-object branch:

```
RGB evidence
  ↓
raw object fragments
  ↓
image-space region consolidation
  ↓
multi-keyframe wall-local fusion
  ↓
preserved visual object region
  ↓
3D protected Reality samples
  ↓
Design
```

Raw `NON_WALL` fragments are connected through a small, resolution-bounded
gap only when their merged bounding region is enclosed, visibly distinct,
small relative to the ROI, and surrounded by confirmed wall. The accepted
region protects its interior and a one-pixel boundary band; it becomes a hole
in the paintable wall rather than a collection of preserved dots. Gradual
shadows, stains, and general wall texture do not pass these combined tests.

Per-keyframe protected evidence is then fused in a bounded wall-local grid at
approximately 3 cm cells. A large expanded protected region requires object
support from at least two selected keyframes plus local wall surround. M7 is
only the aligned U/V reference domain; it is never rendered as a paint plane.
Existing foreground handling remains responsible for shelves and curtains.

Any Dense Reality sample in a fused protected cell remains original RGB, and
explicit object evidence still overrides wall evidence. Mixed wall/object
render triangles are now preserved as original instead of allowing a 2/3 wall
majority to tint their object vertex. Debug views expose raw fragments, merged
regions, protected interiors, the wall-local fusion grid, boundary protection,
and 3D protected assignment. All work remains bounded, local, post-scan, and
reused for paint-swatch changes.

### M8.6.5 — Preserved Object Outer-Boundary Completion

M8.6.4 can establish several valid preserved regions on one framed painting,
but its individual interiors intentionally stop at texture-dependent gaps. A
black/gold artwork, reflection, or glare is internal appearance, not evidence
of multiple physical objects. M8.6.5 therefore adds a conservative layer above
`PreservedVisualRegion`:

```text
raw object evidence
       ↓
PreservedVisualRegion
       ↓
aligned object-region cluster
       ↓
outer-boundary / surrounding-wall validation
       ↓
completed protected object envelope
       ↓
full interior protection
       ↓
wall-local multi-view fusion
       ↓
3D protected Dense Reality samples
       ↓
Design
```

Only two or more already accepted regions can form a `PreservedVisualObjectCluster`.
They must be horizontally aligned, separated by a bounded gap, remain inside
the projected ROI, have bounded combined area, and have credible surrounding
wall support. The completed image-space envelope records top/right/bottom/left
outside-edge support, closure score, largest bridged gap, inferred weak sides,
and its member region IDs. Its outer contour follows the extreme member-region
edges as a bounded quadrilateral, so modest camera perspective does not force a
strict axis-aligned fill. At least three supported outer sides and sufficient
wall surround are required. This prevents arbitrary dark wall texture from
becoming a large protected rectangle and keeps distinct, sufficiently separated
paintings separate.

Once accepted, the outer envelope owns its entire interior: internal black,
gold, bright glare, and small missing fragment holes remain preserved rather
than being reconsidered as paintable wall. A small resolution-aware boundary
band remains around the envelope to prevent triangle paint bleed. The completed
pixels participate in the existing M8.6.3 visibility-aware observation path
and M8.6.4 bounded 3 cm wall-local fusion; no new camera/depth input or M7
visible polygon is created. Explicit or completed object evidence continues to
override ordinary wall evidence, and any Dense Reality triangle touching a
protected sample remains fully original.

Development views expose **Object Clusters**, **Outer Boundary Candidates**,
**Completed Object Envelope**, **Filled Object Interior**, and the
**Wall-Local Object Envelope** in addition to the prior region and 3D views.
Per-cluster diagnostics report members, extent, boundary-side scores, closure,
surround, inferred sides, filled pixels, confidence, and rejection reasons.
Cluster formation, boundary analysis, gap completion, and interior-fill timings
run only in the cancellable post-scan worker. Source RGB, Dense Reality
geometry, M7 structural geometry, Original mode, and swatch-change reuse remain
immutable. This is deterministic geometric/RGB evidence, not semantic AI;
unframed or extremely weakly bounded near-coplanar content remains an honest
limitation for a future replaceable mask provider.

### M8.6.6 — Dominant Wall-Mounted Object Selection and Envelope Ranking

M8.6.5 can form a technically valid completed envelope from several preserved
regions, but not every valid envelope is a wall-mounted object. A shelf or
lower furniture cluster can also contain object evidence and be correctly
preserved, while being the wrong candidate to complete as a painting-sized
wall mask hole. M8.6.6 therefore ranks completed-envelope candidates before
they are allowed to add high-confidence object protection:

```text
PreservedVisualRegion
       ↓
completed-envelope candidate
       ↓
wall-mounted ranking and rejection
       ↓
dominant protected object envelope(s)
       ↓
existing wall-local fusion and 3D protection
```

The deterministic score combines outer-boundary closure, surrounding-wall
support, bounded area, aspect, structural-wall-local placement, ROI edge
margin, normalized cross-keyframe extent consistency, and sampled Dense
Reality plane-offset/variance evidence. A candidate receives a substantial
foreground penalty only when it is both materially farther from the structural
wall and variable enough to resemble shelf or furniture geometry. This avoids
penalizing the small, calibrated M7/Dense-Reality offset that a mounted frame
can legitimately have.

Candidates marked `dominant-wall-mounted` complete and protect their full
envelope interior. `preserved-non-dominant` candidates retain their existing
M8.6.4 object/foreground protection but cannot create a large completed
painting envelope; rejected candidates remain diagnostic only. Multiple
distinct strong wall-mounted candidates may be accepted independently, while
separated paintings remain separate and a shelf below a painting is not merged
into it. The M7 basis is used only to compare placement on the aligned wall,
not to render an M7 polygon.

Development views now show all candidates, their ranking, dominant wall-mounted
objects, rejected major candidates, and final protected envelopes. Per-candidate
diagnostics include area, aspect, wall-local height, edge proximity, closure,
surround, depth offset/variance, cross-view support, foreground penalty, final
score, and decision. Ranking and completed-envelope application remain local,
bounded post-scan work; capture, original RGB, Dense Reality geometry, M7, and
the Design renderer remain unchanged.

### M8.6.7 — Geometry-First Foreground Exclusion

RGB wall likelihood cannot establish that a visible Dense Reality sample is
physically the wall. A hanging towel or folded curtain can share the wall's
colour and be broadly accepted by the M8.6 RGB mask, while its measured
geometry is clearly offset, folded, and non-planar. M8.6.7 adds a separate
post-scan Dense Reality foreground gate after the locked M8.6.3 RGB fusion:

```text
M7 logical wall
       ↓
RGB visible-wall evidence
       +-- visual preserved-object envelopes (near-coplanar artwork)
       +-- Dense Reality foreground geometry (towel / curtain / furniture)
       ↓
final triangle paintability
```

For each selected logical wall, trusted M7-associated Reality samples establish
a calibrated residual distribution and a tightly bounded wall-like envelope.
Every visually observed Dense Reality sample then records signed calibrated
plane residual, wall-normal deviation, neighborhood residual roughness, and
local depth-step evidence. Clear offset or folded samples form
`FOREGROUND_CORE`; bounded shared-neighbor growth can retain their flatter,
near-wall folds as `FOREGROUND_CONNECTED`. Stable planar samples are
`WALL_GEOMETRY`; unresolved geometric evidence is conservative and preserves
the original RGB rather than being painted.

Foreground geometry has higher precedence than RGB wall votes. Completed
visual-object envelopes retain their existing precedence for near-coplanar
paintings, mirrors, and posters. Thus neither geometry nor RGB alone is the
paint authority: RGB determines visible wall likelihood, object envelopes
protect shallow mounted content, and measured geometry rejects foreground
surfaces. A triangle touching protected foreground/object evidence remains
original to avoid paint bleed at the boundary. M7 continues only as semantic
identity and the calibrated geometric reference; no M7 polygon is rendered.

Development views expose wall-plane residual, foreground core, connected
foreground components, normal deviation, roughness, depth discontinuity,
geometry wall/foreground classification, and final paintability. Diagnostics
report residual distribution and envelope, geometry states, rejection reasons,
RGB wall samples vetoed by geometry, and bounded component statistics. The
analysis runs only in the existing post-scan mask worker and is reused for all
paint swatches; capture cadence, Raw RGB, Dense Reality geometry, M7, Original
mode, and rendering geometry remain unchanged.

### M8.6.7.1 — Geometry Foreground False-Positive and Flood-Growth Fix

M8.6.7 established the correct foreground veto concept, but a physical wall
regression showed that an RGB ROI is broader than a logical wall's measured 3D
domain. Unsigned residual seeds and marginal adjacency growth could then join
ordinary noisy wall samples into an implausibly large foreground component.
M8.6.7.1 corrects the evidence, without changing RGB segmentation or disabling
foreground protection:

```text
selected logical patch union
       ↓
trusted wall calibration
       ↓
WALL SAFE ZONE -> WALL_GEOMETRY barrier
AMBIGUOUS BAND -> conservative, no foreground seed
FOREGROUND SEED ZONE + local support -> FOREGROUND_CORE
       ↓
anchored, bounded foreground-connected growth
```

Geometry analysis now admits only samples that both have a valid selected RGB
observation and lie in the selected logical wall's observed patch union (with
a small edge tolerance). Trusted M7-associated wall members establish the
calibration distribution; RGB wall samples are only a bounded fallback when
that support is sparse. The diagnostics retain signed offsets and infer a
foreground side only from sufficiently supported existing foreground evidence.
Without that evidence, offset alone cannot seed foreground growth.

The calibrated wall envelope is a safe zone. A separate ambiguous band absorbs
normal reconstruction spread but remains unable to seed a component. A core
requires either supported existing foreground evidence, a signed foreground-
side offset well beyond the seed zone with neighboring offset support, or a
locally normal-coherent folded surface with offset/depth/roughness support.
An isolated bad normal is never enough.

Growth stops at strong wall barriers: multiple local wall-like neighbors with
low residual, wall-compatible normals, and low roughness cannot be converted
to foreground. Every connected sample needs multiple same-component neighbors,
compatible local normal and offset steps, continuing foreground shape/offset
evidence or two nearby core anchors, and a bounded geodesic path from a core.
Large mostly-connected, near-plane, wall-contact-heavy components are returned
to conservative uncertainty rather than becoming a wall-wide foreground veto.

Diagnostics now make final geometry counts mutually exclusive and expose the
selected-wall domain count, calibration count, signed-offset distribution,
safe/ambiguous/seed thresholds, foreground side, RGB wall entry/veto counts,
component core/connected fractions, wall-contact ratio, and strong-wall-
barrier/growth-frontier/core-reason views. This remains local bounded worker
work. It does not change captured RGB, Dense Reality geometry, M7 geometry,
Original mode, or the visual-object envelope path used by near-coplanar art.

### M8.6.7.2 — Logical-Wall Dense Reality Domain Alignment

M8.6.7.1 correctly made foreground geometry a veto, but a physical regression
showed that using the exact clean M7.4 patch union as its 3D admission gate was
too restrictive. A patch is a conservative structural support shape, not a
pixel-perfect copy of every observed Dense Reality sample on the same wall.
M8.6.7.2 separates that concern from foreground classification:

```text
M7 logical wall
       ↓
M7_PATCH_CORE anchors
       ↓
connected OBSERVED_WALL_EXTENSION
       ↓
bounded logical-wall Reality domain
       ↓
existing geometry wall / foreground gate
       ↓
RGB + preserved-object evidence
       ↓
final Dense Reality triangle paint
```

The member-patch union remains the trusted anchor. It is projected into the
logical wall's stable U/V basis along with Dense Reality samples. Only samples
with an already-valid RGB wall observation, calibrated plane compatibility,
wall-compatible normals, no explicit foreground/object conflict, and a bounded
U/V continuation can enter the derived domain. Breadth is earned through
actual spatial connectivity to an M7 patch core; no empty space is filled and
no structural polygon is rendered.

The continuation stops at a normal/plane break, adjacency limit, conflicting
logical surface, explicit foreground evidence, or the bounded U/V expansion
envelope. This prevents propagation around a corner into an adjacent wall or
ceiling, and prevents towels, curtains, furniture, and other known foreground
from entering merely because RGB is wall-like. The existing M8.6.7.1 WALL SAFE
ZONE, AMBIGUOUS BAND, FOREGROUND SEED ZONE, and strong-wall barriers are
unchanged; they now operate on a correctly aligned Reality wall domain.

Development views expose **M7 Patch Core Domain**, **Observed Wall Extension**,
**Final Logical Wall Reality Domain**, and **Domain Rejection Reasons**. Per
wall diagnostics report RGB-projected candidates, patch core and extension
counts, near-patch candidates, bounds/plane/normal/foreground rejections, U/V
bounds, expansion distance, domain components, and post-domain geometry state
counts. Domain construction remains compact, local, and post-scan; it changes
neither XR capture nor RGB-D registration, Dense Reality geometry, M7
measurements, Original mode, or paint renderer geometry.

### M8.7 — High-Quality Walkable RGB-D Reality Reconstruction

The physical scan pipeline is:

```text
real device translation + rotation
              |
XR pose + measured depth + current captured RGB
              |
persistent multi-view WORLD-SPACE reconstruction
              |
immutable raw finalized measured Reality
              |
worker: local display refinement + captured appearance reprojection
              |
derived Reality Quality Preview
```

M7 remains a separate structural/semantic representation. It is not an input to
M8.7 display refinement or appearance selection. Reality must not be snapped to
M7, made rectangular, closed across an unobserved opening, or filled using AI.
Customization masks, domains, object envelopes and paint shaders are unchanged.
The frozen preview receives raw Reality, never the derived quality surface.

#### Depth and world-space fusion

Depth still comes from the current XR CPU depth sampler, with the validated
projection/transform preference and meter conversion. There is no cached old
depth substituted into a new pose. Four deterministic quarter-cell sampling
phases replace the repeated central lattice. Each phase lasts two processing
ticks, so every phase reaches the every-second-tick live RGB copy too.

Timing tiers use 80×45, 96×54 and 120×68 attempt budgets per processing tick,
redistributed to the XR view projection's aspect
(for example approximately 40×90 for a portrait 0.45 aspect at the lowest tier).
Raw camera/depth texture orientation is not used to invent another mapping.
They start low, upgrade after sustained measured headroom and downgrade on slow processing
or poor XR frame intervals. These are testable operating bounds, not a claim
that POCO can sustain the highest tier. Stationary observation is throttled after
an initial phase cycle; meaningful physical translation/rotation resumes work.
Live RGB remains 160 px long edge (typically 72×160), with no stale color reuse.
Geometry-only ticks now contribute measurements even without a camera copy.
Uncolored measurements stay uncolored until actual captured RGB is available.

The existing 3D spatial hash already permits multiple incompatible samples in
one bucket. Euclidean, point-to-plane and normal checks retain separate depth
layers; no screen pixel owns a persistent sample. Fusion now relinks a sample
when its measured position crosses a cell boundary, aligns opposite compatible
normal signs before averaging, and separates geometry confidence from RGB
outlier acceptance. The 2.5 cm cells and 60,000 slots remain: neither a 1.5 cm
cell nor a larger capacity is justified by desktop timing alone.

At pressure, a bounded search can reclaim only stale, never-confirmed samples.
Stable measured geometry is not silently evicted. If all slots are stable, new
geometry can still be rejected; the UI warns about this limit rather than
pretending a newly entered extension was captured. This is not unlimited room
mapping. A bounded trajectory and angular view-support bins distinguish repeated
ticks from differing physical viewpoints. `local-floor` remains preferred, with
the existing `local` fallback; virtual controls never recenter either space.

#### Appearance and derived display geometry

A separate local-only appearance reservoir retains at most eight application-
owned RGB frames, with a 640 px long edge and a 230,400-pixel ceiling per frame.
POCO's demonstrated portrait aspect would produce 288×640: 0.527 MiB RGB/frame,
4.219 MiB for eight. The existing 320 px mask-keyframe branch is unchanged.
Appearance captures are sparse, pose-diverse, reject fast-motion proxies and
near-duplicates, and can replace the most redundant retained viewpoint when a
more novel area is observed. No browser-owned texture or video is retained.

Worker color refinement calls the existing world→keyframe projection helper.
It uses a bounded, one-keyframe-at-a-time measured-surfel visibility raster,
view angle, range, edge safety and keyframe quality. The best valid captured
observation supplies color; similarly strong conflicting views retain original
fused RGB rather than averaging incompatible appearances. No measured keyframe
depth snapshots were added. The derived raster cannot prove visibility of
dynamic objects at a historical instant: uncertain/edge observations keep their
existing color. Resolution remains limited by actual surfel spacing and capture
quality, not magically by the larger RGB image alone.

Display smoothing is local and edge-preserving: compatible measured neighbors,
a 12 mm local tangent envelope, strong normal agreement, balanced support, and
at most 4 mm displacement. Silhouettes and one-sided neighborhoods are retained.
There is no wall-wide plane fit, no added samples, and no explicit hole filler.
Existing measured-neighbor triangulation can cover supported small gaps but
rejects unsupported spans, discontinuities and incompatible surfaces. Recess
front, side and back remain different geometry. Raw finalized positions/RGB
remain immutable; derived geometry/colors are cached separately in the worker.

Quality preview uses sRGB output, antialiasing, a 0.04 m near plane, and capped
adaptive DPR (initially at most 2, reducing under sustained low FPS). Only one
of the quality and legacy/customization previews is mounted at a time.

#### Live map and independent controls

```text
PHONE physical movement -> XR pose -> depth/RGB registration -> measured map
                             |
                      one-way pose copy
                             v
                     physical scanner marker

joystick + touch look -> VIRTUAL inspection pose -> separate map camera ONLY
```

Live 3D Map is an optional DOM-overlay canvas with its own WebGL context and
Three camera. Its update is driven by XR rAF (not a second window rAF that may
be suspended in immersive mode). Fusion continues while the map is open. The
map copies at most 12,000 confirmed colored samples every 350 ms and renders
at most about 30 FPS, independently of XR capture. It does not reconstruct a
second mesh in the XR callback. Follow Scanner copies the physical camera pose;
Free Look uses only the virtual joystick/drag pose. A gold physical scanner
marker remains distinct from the inspection camera. The optional trajectory
line is disabled by default. Reset View returns to Follow Scanner, not to a
new XR origin.

Free-look movement has a coarse measured-point occupancy check, not a complete
human-body collision solver. Unknown space remains empty/traversable; no M7 or
unobserved walls are inserted. Controls capture touch only inside the map.
Finish/Cancel and Return to AR remain outside the map control area. Users must
watch their physical surroundings while walking; the virtual map is not a
physical obstacle-warning system.

This requires a browser that composites an independent canvas in WebXR DOM
overlay. If the extra GL context/render fails, a visible message directs the
user back to AR; the XR session and measured map are not reset. Devices without
DOM overlay cannot use the live-map UI. Simultaneous rendering, walking drift,
thermal performance and follow/free-look behavior require physical POCO tests.

#### Diagnostics and acceptance

Comparison modes: Raw Reality, measured sample density, Refined Geometry,
High-Resolution Color, combined refinement, and Final M8.7. Depth diagnostics
include range bands from the first scanner pose, local discontinuities, latest
sample-creation tick, angular view-support count, first-observed-time reveal,
and trajectory. Range bands are not semantic depth-layer labels; reveal time
is not semantic recess detection. No unsupported geometry is shown.

Telemetry reports runtime depth dimensions/scale, attempted/valid samples,
phase/tier, created/fused counts, capacity pressure, shared multi-sample buckets,
keyframe dimensions/memory, refinement/mesh times, local noise proxy, spacing,
triangle/fallback counts, canvas/DPR/FPS, and distance/trajectory. Numeric buffer
budgets are separate from JS heap/GPU overhead; see the implementation report
for desktop measurements and limitations.

All keyframes, trajectories and derived worker state are scan-session-only,
local data. New Scan/Discard clears them; workers, GL resources and listeners
are disposed. No upload, backend persistence, semantic AI, hole inpainting or
M7 visible paint surface is introduced. Stop customization development here
and physically evaluate detail, recess depth, walking, live map, joystick,
follow/free-look and unknown-space preservation before any further milestone.

### M8.7.1 — Production Scan Stability and Clean Reality

M8.7.1 prioritizes correctness, repeatability and cleanliness ahead of coverage
or detail. The cell size remains 2.5 cm, capacity remains 60,000, and M8.6.7.2
customization is unchanged. Missing measured geometry is preferable to a
confident-looking displaced wall or ceiling.

```text
MEASURE depth + pose from one XRFrame
              |
COPY IMMUTABLE FRAME PACKET
              |
VALIDATE pose motion + tracking recovery + depth sanity + local world agreement
              |
WORLD FUSE distinct accepted frames
              |
CONFIDENCE + temporal span + viewpoint diversity + variance
              |
FILTER unsupported points / weak duplicate sheets / floating components
              |
EDGE-PRESERVING bounded display refinement
              |
SAFE measured-vertex triangulation
              |
CLEAN FINAL REALITY
```

#### Frame ownership and acceptance

Depth and pose were audited as synchronous in the existing XR animation-frame
callback. `XRDepthService` already rejects a different XRFrame/XRView identity;
no demonstrated N/N+1 stale-pose read was found. M8.7.1 nevertheless makes the
contract explicit: every candidate tick copies timestamp/sequence, reference
space, physical pose, view/inverse-view/projection matrices, depth transforms
and metadata, phase/tier, world points and depths into one application-owned
packet. Fusion never consults mutable “latest XR state.” A skipped sampling tick
skips depth, RGB, pose, phase and sequence bookkeeping together.

Before fusion, bounded checks reject implausible pose discontinuities, excessive
motion, unusable depth distributions and frames dominated by a suspicious
near-parallel offset against established Reality. A relocalization-like jump
enters quarantine; several locally stable frames plus return to the accepted
map or established-world agreement are required before fusion resumes. Rejected
raw measurements remain available in diagnostic mode but never update coverage,
color, persistent surfaces or Dense Reality. Live guidance translates the gate
state into Good, Move slower, Tracking unstable, Scan this area again, Move
around object and More coverage needed.

#### Fusion stability and duplicate sheets

The concrete M8.7 stability flaw was observation inflation within one depth
frame: several phase-grid pixels could merge into the same 2.5 cm surfel and
increment its geometry observation count repeatedly. One bad sheet could thus
look confirmed without independent time support. M8.7.1 records the last XR
frame sequence per surfel and permits at most one geometry-confidence update per
surfel per frame.

High stability now combines at least three distinct frames, observation time
span, tracking-quality support, position/depth/normal variance and, for a
suspicious parallel offset, multi-view support. Angular bins distinguish a
different camera direction from repeated ticks at one pose. A bounded preflight
compares new measurements to established samples as compatible existing
surface, suspicious parallel duplicate, or unknown. Unknown is not rejection:
new rooms, recess backs and side faces can accumulate normally. A shallow
parallel sheet without boundary/view/time support remains provisional; a true
recess or real second surface survives when it has depth separation and
repeated or viewpoint-diverse support.

The spatial hash continues to use floor quantization for positive and negative
coordinates, explicit bucket unlink/relink when a fused position moves, bounded
linked entries and multiple incompatible layers. RGB remains independent:
missing/rejected color cannot remove valid geometry, and valid color cannot make
questionable geometry stable.

#### Immutable stages and final cleanup

Final diagnostics preserve separate products:

1. Raw Measured Reality — accepted and rejected packet samples.
2. Fused Raw Reality — every active world-space fused sample.
3. Confidence Filtered Reality — supported observed samples only.
4. Refined Geometry — local bounded display positions/normals.
5. Triangulated Reality — safe measured-vertex connectivity.
6. Final M8.7.1 Reality — filtered/refined geometry with captured appearance.

Post-scan component analysis uses conservative local distance, normal and
point-to-plane adjacency. Tiny one-frame islands, unstable detached fragments
and weak duplicate-sheet components are excluded only from the derived final
display. Repeated/view-diverse small objects, curtains and recess faces remain.
No “primary room only” deletion, structural plane, rectangle, new vertex or
large-hole fill is introduced. Component sample count, estimated area, bounds,
stable/view-diverse ratios, tracking support, duplicate ratio and decision stay
available for diagnosis.

Display refinement retains its 12 mm layer envelope and now records mean,
p90, p95 and maximum displacement. If a local estimate asks to move a sample
more than 4 mm, the raw position is retained instead of clamping it onto a new
surface. Triangulation reports and rejects excessive distance, normal mismatch,
depth-layer disagreement and unsupported neighborhoods; accepted p95/maximum
edge length is reported. Hole completion remains absent, so doorways and recess
openings stay unknown/open.

#### Repeatability, quality and privacy

Per-scan comparison metrics include X/Y/Z extent, ceiling-height proxy, major
component count, stable/low-confidence ratios, floating-component count and
largest unsupported component. Frame diagnostics include acceptance/rejection
reasons, largest pose change, relocalization-like events, depth validity/outlier
statistics, same-frame duplicate observations, duplicate-surface candidates,
view diversity and capacity. These metrics make Scan A/B/C comparable without
pretending desktop tests establish physical repeatability.

The finish view warns rather than blocks when stability or component quality is
clearly low. All raw packets, filtered stages and diagnostics remain local and
scan-session-only. New Scan/Discard clears them. No semantic AI, cloud upload,
M7 projection, quality-setting increase, customization change or invented
geometry is part of M8.7.1. Physical three-scan POCO F5 repeatability, ceiling,
stationary, walking, recess and fast-motion tests remain mandatory before this
milestone can be called physically accepted.

### M8.7.1.1 — Real-Time Capture Throughput and Reliable Fusion

M8.7.1.1 responds to the physical 41-second POCO trace: a 51.8 ms XR interval,
502.2 ms accepted-tick time, 87,834 created surfels, 27,834 provisional
reclaims, only 1,705 view-diverse samples, and 6,802 duplicate candidates with
zero reported rejection. Resolution remains 2.5 cm, capacity remains 60,000,
and customization remains frozen.

The former “Last processing” value covered almost the entire accepted capture
path, not depth lookup alone. Timing is now split into depth capture, world
reconstruction, packet validation/world consistency, RGB registration,
appearance copy, coverage, persistent-surface processing, Dense fusion and
render preparation. Each stage records bounded p50/p95/max samples. The XR
callback still owns synchronous browser depth and camera access; application
fusion work is handed to a latest-only main-thread task with one processing and
at most one pending immutable packet. A newer packet replaces stale pending
work atomically. No packet may borrow another frame's pose, phase, depth or RGB.

Presentation, measurement cadence, fusion handoff, Live Map, high-resolution
appearance and React diagnostics now have independent pressure behavior.
High-resolution appearance captures only with a healthy XR interval and an
empty fusion queue. Under pressure, Live Map geometry copies slow from 350 ms
to 900 ms, its render cadence slows from about 30 Hz to 10 Hz, and React
diagnostic publication slows from 4 Hz to roughly 1.3 Hz. Core packet capture
is not reduced merely to refresh UI.

#### Repeat-observation fusion

The physical median nearest-neighbor spacing was 2.2 cm while the former merge
radius was 2.1 cm. Deterministic temporal sub-grid phases could therefore place
the same measured surface just outside the match radius and create a new surfel.
Matching now searches center-first through a bounded two-cell neighborhood with
a 3.4 cm Euclidean radius and a much tighter 1.4 cm point-to-plane compatibility
gate. The wider tangential radius reinforces a 2.5 cm surface lattice; the
point-to-plane and normal gates continue to preserve recesses and separate
depth layers. Samples from one frame cannot use this wider radius to collapse
adjacent lattice points.

The prior lexical neighbor traversal could consume its candidate budget before
reaching the nearest cell. Center-first traversal and explicit distance,
normal, depth-layer, empty-bucket and budget failure counters make matching
order-independent and inspectable. Established-surface consistency no longer
runs a 9×9×9 string-hash search for every new point; confirmed surfels also live
in a coarse bounded lookup used only for duplicate-sheet evidence.

View diversity is based on each surfel's first camera position and direction,
maximum baseline, and angular separation. A modest lateral sweep can therefore
count even when both poses fall in the same old 45-degree world-azimuth bin.
Repeated ticks at one pose still cannot create diversity or stability.

#### Duplicate sheets and final mesh

An explicit Dense `stabilityClass` is now authoritative in confidence filtering.
Previously, a duplicate candidate marked provisional by Dense fusion could fall
through to an observation-count fallback and be called stable, which explains
why thousands of candidates could yield zero rejection. A suspicious parallel
sample now needs its own time-separated multi-view support plus locally stable
same-layer support, or independently measured nearby side-face/recess topology.
It cannot borrow confidence from the established front wall.

The former “unsupported triangle” count mixed degenerate pairs, large angular
gaps and occupied-circumcircle alternatives. It counted combinatorial candidate
pairs, not omitted samples, so 740,476 did not mean 740,476 missing triangles.
Those reasons are now separate, alongside candidate-pair count, actual triangle
participants, non-participants and fallback splats. Every valid colored sample
that cannot safely participate in a triangle remains visible as a measured
fallback splat; no hole or structural geometry is invented.

The developer HUD reports XR FPS, capture/fusion/acceptance rates, fusion p95,
queue depth and latency, new/matched rates, match percentage, stable and
view-diverse percentages, capacity and quality tier. Finish warns when the scan
lacks minimum accepted-frame/stability/viewpoint support and lets the user
continue the same scan or explicitly finish anyway.

M8.7.1.1 is not physically accepted by desktop tests. The next POCO run must
verify capture smoothness, stage p95 values, low queue latency, substantially
higher match/view-diverse ratios, reduced churn and repeatable Raw/Fused/Final
geometry before any resolution or customization work resumes.

### M8.7.1.2 — Production Reconstruction Core

Physical M8.7.1.1 screenshots isolate malformed wall and ceiling sheets in
Fused Raw Reality. Confidence filtering retains coherent malformed sheets, and
triangulation follows their shape. The production correction therefore
separates the responsive live representation from final reconstruction instead
of asking one arrival-order-sensitive map to satisfy both jobs.

```text
accepted immutable XR measurement packet
        ├── bounded/decimated live fusion
        │       ↓
        │   scan guidance + Live Map
        │
        └── bounded retained measurement frames
                ↓ Finish
          dedicated reconstruction worker
                ↓
          deterministic frame replay
                ↓
          per-frame spatial consolidation
                ↓
          provisional surface hypotheses
                ↓
          robust canonical surfel fusion
                ↓
          false parallel-layer resolution
                ↓
          confidence safety filter
                ↓
          safe mesh + high-resolution RGB
                ↓
          Final M8.7.1.2 Reality
```

#### Live scan representation

The live Dense map remains measured world-space geometry, but it is explicitly
a lightweight preview. Each accepted frame has a bounded 520/680/900-sample
fusion budget selected from measured XR pressure. Coverage and rough map
inspection continue while the full accepted packet remains coherent and
available for final replay. Lower-priority work still yields in this order:
appearance capture, Live Map refresh, diagnostics, live preview density, then
reconstruction cadence. Frame pose/depth ownership is never degraded.

#### Retained accepted measurements

At most 96 application-owned accepted packets are retained. Selection uses
time, physical translation, rotation and temporal phase. At the bound,
deterministic temporal decimation preserves the complete scan path rather than
only its beginning. Browser-owned `XRDepthInformation` and camera textures are
never retained. Packet arrays already belong to the application, so retention
adds no expensive copy to the XR callback. Per-frame consolidation and
canonical fusion occur after Finish in the worker. Diagnostics report frame and
sample counts, viewpoint bins, temporal compactions and typed-array bytes.

#### Canonical post-scan reconstruction

Replay order is normalized by accepted XR frame sequence. Within each frame,
near-identical spatial measurements are consolidated while distinct depth bins
and discontinuities remain separate. Matching scores point-to-plane residual,
tangent-plane distance and normal compatibility; Euclidean distance alone is
not authoritative. A surfel update uses robust weighting, established-surface
outlier rejection and a maximum 3 mm movement per accepted update, preventing
one bad frame from dragging a stable wall forward.

Every new hypothesis begins `PROVISIONAL`. Promotion requires support from at
least three accepted frames over time plus local coherent support or a diverse
viewpoint. Unsupported one/two-frame surfaces expire before Final. Spatial
buckets have a fixed small hypothesis bound. After all views contribute,
overlapping near-parallel hypotheses 2.8–10.5 cm apart are compared: a weaker
same-view layer without coherent boundary or side-face evidence is removed. A
measured second surface is retained when its own multi-view support and
separation or measured side topology defend it.

True topology remains authoritative. A 15–40 cm recess is represented by its
front, side and back measurements; the deeper surface is not snapped to the
front. Perpendicular wall/ceiling and corner normals do not match. Openings and
unknown space are not filled. M7 is not an input to canonical fusion and no
structural polygon is rendered as Reality.

#### Product and diagnostic stages

Finish may briefly show **Building clean 3D room…** while the dedicated worker
replays retained measurements. The comparison sequence is:

1. Raw Accepted Measurements
2. Live Lightweight Fusion
3. Post-Scan Canonical Fusion
4. Confidence Filtered Canonical
5. Canonical Triangulated
6. High-Res Color Refined
7. Final M8.7.1.2 Reality

The existing confidence filter is now a final safety layer, not the mechanism
expected to repair systematic live-map corruption. Triangulation and high-res
visibility-aware RGB reprojection consume canonical geometry only. Appearance
capture remains pressure-gated and resumes only when the queue, XR timing and
tracking are healthy.

Cell size remains 2.5 cm, live capacity remains 60,000, and the base depth
budget remains 40×90-equivalent. M7 structural extraction and all M8.6.7.2
wall, object-envelope and customization behavior remain frozen. Desktop
synthetic tests cannot establish physical success; flat-wall edge-on thickness,
a single ceiling, real protrusions, recess topology, responsive live scanning
and three-scan repeatability must be verified on POCO F5 before further work.

### M8.7.1.3 — Canonical Completeness, Appearance & Finish UX

The two M8.7.1.2 POCO scans preserve the live/final split and confirm thinner
walls and substantially cheaper live fusion, but show large visual holes,
missing base color and an 8–9 second Finish pause. M8.7.1.3 stabilizes those
boundaries without increasing depth resolution, the 96-frame bound, 2.5 cm
canonical cells, 60,000-surface capacity or layer count.

Canonical hypotheses can now promote during deterministic replay once their
temporal and local/view support is established. Later compatible frames
therefore reinforce an actual canonical surfel and update support, variance,
viewpoint and real-color state. The prior zero canonical-reinforcement report
was caused by deferring every promotion until replay had ended, even though
provisional hypotheses had already accumulated multiple observations.

Accepted geometry retention no longer depends on optional raw-camera access.
A bounded selection proxy considers both viewpoint novelty and newly measured
coarse spatial coverage; at capacity it replaces the least useful interior
frame rather than blindly halving temporal history. Diagnostics expose rejected
redundancy, replacements, per-frame contribution, proxy coverage lost and real
RGB evidence retained. Per-frame consolidation keeps a measured position but
merges available registered RGB within its 18 mm voxel, so an uncolored first
sample cannot discard later real-camera evidence.

Final display is explicitly hybrid and measured-only: safe triangles are drawn
where local topology supports them, while canonical oriented splats represent
measured samples that cannot safely enter a triangle. Triangle-only and hybrid
stages remain separate. Counters distinguish mesh-covered, splat-covered,
visually represented and truly undisplayed canonical samples; true unobserved
space is never filled.

The quality preview now exposes nine production stages from accepted
measurements through baseline real RGB, optional high-resolution refinement and
Final M8.7.1.3. A bounded Provisional Expiry Map shows measured omitted
hypotheses by attributable reason. The canonical funnel reports count,
prior-stage percentage, spatial-cell coverage and area proxy. Dominant locally
planar thickness is separated from the global mixed-surface proxy, and defended
second-layer reasons are counted without semantic fabrication.

High-resolution appearance remains optional and bounded to eight 640-pixel
keyframes. Stable opportunities require an empty queue, bounded XR/processing
timing, low motion, interval and view novelty. Candidate outcomes are counted
as captured, pressure, motion, duplicate-view, camera-unavailable or other.
These keyframes refine the registered real-RGB baseline; they no longer define
whether Final has any color.

Finish immediately enters an actual staged processing state: Preparing scan,
Reconstructing geometry, Cleaning surfaces, Applying room appearance and
Building final model. Worker stage messages drive the labels. Diagnostics time
capture drain, retained finalization, worker round trip/compute, result
assembly, XR end and total Finish. Confidence, refinement, color and rendering
timings remain visible when the preview worker mounts.

Physical acceptance remains one 20–30 second POCO F5 scan of the familiar
wall/curtain/painting/shelf/ceiling scene. Continue to repeatability only after
that first result has no giant hole where measured canonical samples exist,
recognizable base color with zero high-resolution keyframes, responsive Finish
stages, coherent ceiling and preserved protrusions/recesses.

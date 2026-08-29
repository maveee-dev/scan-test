# Spatial Scanner Vision

## Product Vision

The goal is to build a browser-based spatial room scanner for a hardware-store room customization system.

The scanner should eventually allow a user to:

1. Open the web application on a supported smartphone.
2. Scan a real physical room using the normal phone camera.
3. Receive real-time visual feedback showing which physical areas have already been scanned.
4. Generate a spatial representation of the room.
5. Convert that scan into a usable 3D room model.
6. Customize the room using actual hardware-store products such as:

   * wall paint
   * floor tiles
   * wall tiles
   * cabinets
   * fixtures
   * shelves
   * selected furniture/products
7. Estimate material quantities.
8. Estimate project cost.

The system must not require LiDAR.

The primary target is ordinary supported smartphones using camera-based spatial tracking and depth estimation.

---

# Scanner Experience

The scanner should feel similar in concept to professional spatial scanning applications such as Polycam.

This does NOT mean copying Polycam's proprietary implementation or interface.

The important interaction concept is:

> As the user scans the environment, already-captured physical surfaces become visually marked in the AR camera view.

The scan visualization must be attached to the physical environment.

It must NOT behave like a fixed progress grid drawn on top of the phone screen.

---

# Desired Coverage Behavior

Example:

The user points the phone at a wall.

As the user moves the phone around and sufficiently observes the surface:

* parts of the physical wall become marked as captured
* uncaptured regions remain visually different
* the boundary between captured and uncaptured regions progressively moves as scanning continues

If the user moves the phone:

* the captured visualization stays attached to the wall
* it does not remain fixed to the display

If the user turns away:

* the captured wall leaves the camera view naturally

If the user returns to the same wall:

* the previously scanned areas should appear captured again

This behavior is essential.

---

# World-Space, Not Screen-Space

The application should distinguish between:

## Screen-space visualization

A fixed grid or overlay that stays at the same location on the display.

This is NOT the desired final scanning experience.

## World-space visualization

Coverage information stored using real XR spatial coordinates and rendered back into the AR environment.

This IS the desired behavior.

Conceptually:

camera depth sample
→ 3D SpatialPoint
→ world-space coverage cell
→ coverage confidence
→ world-anchored visualization

The user's screen is only a window into the environment.

Coverage belongs to the environment itself.

---

# Coverage Appearance

The desired effect is similar to a surface mask progressively covering scanned geometry.

Conceptually:

Unscanned:

░░░░░░░░░░░░

Partially scanned:

██████░░░░░░

Mostly scanned:

██████████░░

Captured:

████████████

The exact rendering does not need to match these characters or any specific application's colors.

The key requirement is that captured areas are visually distinguishable and remain spatially anchored.

---

# Coverage Confidence

An area must not become fully captured simply because it was visible for several consecutive frames.

Coverage confidence should represent meaningful observations.

Current concept:

1 accepted observation:
observed

2 accepted observations:
partial

3 or more distinct observations:
captured

A repeated observation should preferably require meaningful camera displacement and eventually may also consider viewing direction.

This exists so simply holding the phone still does not complete a scan.

---

# Current View Coverage

The scanner may show:

Current View Coverage: XX%

This percentage means:

captured valid spatial samples currently visible
/
all valid spatial samples currently visible

It does NOT mean:

* room completion
* overall scan completion
* percentage of the entire room captured

Until the system understands the complete room boundary, it must not claim an overall room percentage.

---

# Future Room Completion

A future milestone may determine:

* walls
* floor
* ceiling
* room boundaries
* room dimensions
* doors
* windows

Once the room's expected surfaces are known, the system may calculate overall room scan completion.

Do not introduce this prematurely.

---

# Spatial Reconstruction Goal

The scanner should eventually produce a simplified, editable 3D representation of the room.

The goal is NOT necessarily to create a photorealistic scan containing every object.

For the hardware-store system, the most important geometry is:

* walls
* floor
* ceiling
* room dimensions
* doors
* windows
* major permanent structures

Temporary objects such as:

* clothes
* bags
* movable chairs
* clutter

do not need to become permanent editable room geometry.

---

# Why a Simplified Room Model Is Preferred

The room will eventually be customized.

A clean room model makes it easier to:

* apply paint to a specific wall
* apply tiles to a floor or wall
* calculate wall area
* calculate floor area
* place hardware-store products
* calculate material quantity
* estimate cost

A raw photogrammetry mesh alone is not sufficient for this use case.

---

# Long-Term Customization Experience

After scanning:

User selects a wall.

Example:

Wall 1
→ Paint
→ Choose hardware-store paint product
→ Apply color/material

User selects floor:

Floor
→ Tiles
→ Choose tile product
→ Apply texture

User may place selected products such as:

* cabinets
* shelves
* sinks
* toilets
* lighting
* fixtures
* other supported store products

The products should eventually come from the hardware store's real product catalog.

---

# Material Estimation Vision

Room measurements and selected products should eventually support calculations such as:

Floor area:
16 m²

Tile:
60 × 60 cm

Required tiles:
approximately 45

Allowance:
10%

Recommended quantity:
50 tiles

Estimated cost:
quantity × current store price

Similarly for paint:

Wall area
→ product coverage rate
→ number of cans/gallons required
→ estimated cost

These calculations belong to later phases.

---

# Technical Direction

Current scanner technology:

* React
* TypeScript
* Vite
* Three.js
* WebXR
* ARCore-backed WebXR on supported Android devices
* WebXR Depth Sensing

The scanner must not require LiDAR.

Current physical test device:

* ARCore/WebXR-compatible Android device
* CPU depth sensing has been demonstrated successfully

Do not hard-code application behavior to one particular phone model.

Always feature-detect runtime capabilities.

---

# Current Proven Pipeline

The project has already demonstrated:

immersive AR
→ camera passthrough
→ local-floor spatial tracking
→ viewer pose
→ CPU depth sensing
→ metric depth
→ SpatialPoints
→ world-space coverage cells

The next important visualization goal is:

world-space coverage cells
→ world-anchored captured-surface visualization

---

# Scanner UX Principles

The live camera must remain the main interface.

During normal scanning:

* do not cover most of the camera with diagnostics
* do not require scrolling
* keep Stop Scan accessible
* provide concise guidance
* provide coverage feedback
* keep development diagnostics behind Debug mode

The user should be able to focus on moving around the physical room.

---

# Scan Guidance

Useful guidance may eventually include:

* Move slowly
* Continue scanning this area
* Move to an unscanned area
* Capture from another angle
* Area captured
* Tracking lost
* Move back to the previous area
* Depth unavailable

Guidance must reflect real scanner state.

Do not fabricate room understanding.

For example, do not say:

`Wall complete`

until the system can actually identify and track a specific wall.

---

# Saving

A Save Scan or Finish Scan feature should only be introduced when there is meaningful scan data to save.

Eventually a saved scan may contain:

* room metadata
* spatial coverage
* simplified room geometry
* dimensions
* generated model file
* customization state

Persistence will later require backend/storage.

Do not add Save purely to save temporary debug coordinates.

---

# Future Architecture

Long-term system may contain:

Frontend:

* React
* Three.js
* WebXR scanner
* room customization interface

Backend:

* NestJS

Database:

* PostgreSQL

Heavy spatial processing, if later required:

* dedicated processing service
* potentially Python
* Open3D
* COLMAP or other reconstruction tools

These should only be introduced when browser-side capabilities are insufficient.

---

# Development Philosophy

Build incrementally.

Do not attempt to clone an entire professional scanning product in one milestone.

Each capability should be proven on a real device before building the next layer.

Current development sequence:

1. WebXR capability detection
2. immersive AR and pose tracking
3. depth sensing
4. world-space SpatialPoints
5. spatial coverage accumulation
6. world-anchored coverage visualization
7. scan finalization/persistence representation
8. surface/room understanding
9. simplified 3D room generation
10. room customization
11. material estimation
12. cost estimation

The exact later sequence may evolve as technical findings emerge.

---

# Core Product Rule

Whenever implementation decisions are unclear, prioritize this outcome:

> The user should be able to scan a real room with a normal supported smartphone, visually understand which physical surfaces have already been captured, and eventually use that scanned space as an editable 3D environment for hardware-store product visualization and cost estimation.

Do not optimize around development demos that do not contribute to that product experience.

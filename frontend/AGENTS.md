# Hardware Store Spatial Scanner

## Project Purpose

This project is a web-based spatial room scanner that will eventually be part of a hardware-store room customization system.

The long-term system will allow a customer to:

1. Scan a physical room using a smartphone.
2. Generate a simplified 3D representation of the room.
3. Detect and identify major room surfaces such as walls and floors.
4. Apply hardware-store products such as paint and tiles to those surfaces.
5. Place supported products or fixtures inside the room.
6. Estimate required material quantities.
7. Estimate project cost using products from the hardware store.

The current development phase is ONLY the spatial scanning foundation.

---

# Current Phase

## Spatial Scanner V1

The goal of the current phase is:

> Use a supported Android smartphone browser to obtain spatial tracking and depth information and visualize captured real-world geometry in 3D.

Do not implement:

* authentication
* users
* products
* shopping cart
* hardware-store inventory
* cost estimation
* room customization
* database
* NestJS backend
* cloud processing
* COLMAP
* Open3D

These belong to later phases.

---

# Technology Stack

Use:

* React
* TypeScript
* Vite
* Three.js
* WebXR
* ARCore through supported Android WebXR implementations
* WebXR Depth Sensing when available

The application must remain browser-based.

Do not convert the project into:

* React Native
* Flutter
* native Android
* native iOS

unless explicitly instructed.

---

# Target Devices

Initial development should prioritize:

* Android smartphones
* Google Chrome
* ARCore-compatible devices
* devices supporting the required WebXR functionality

The scanner must NOT require LiDAR.

Always feature-detect WebXR and depth capabilities.

Never assume every device supports them.

Unsupported devices must receive a clear message rather than causing the application to crash.

---

# Core Architecture

Use feature-oriented architecture.

Suggested structure:

src/
app/
features/
scanner/
components/
hooks/
services/
types/
utils/
coverage/
components/
services/
types/
utils/
lib/
three/
webxr/
types/

Responsibilities must remain separated.

---

# Scanner Module

The scanner module is responsible for:

* checking WebXR support
* starting and stopping immersive AR sessions
* requesting appropriate XR reference spaces
* accessing XR frame information
* obtaining viewer/device poses
* accessing depth information when supported
* converting captured depth samples into spatial information
* exposing scanner state to the UI

Scanner state may include:

* idle
* checking-support
* ready
* scanning
* unsupported
* error
* finished

React components should NOT contain large amounts of raw WebXR logic.

WebXR-specific logic should live in dedicated hooks/services/modules.

---

# Three.js Module

Three.js is responsible for visualization.

It may be used for:

* rendering the AR/3D scene
* displaying captured points
* displaying reconstructed geometry
* rendering scan coverage
* displaying debugging geometry

Three.js must NOT contain business logic.

Keep scene creation, camera setup, renderer handling, geometry creation, and disposal logic organized.

Always dispose of Three.js resources when they are no longer required.

---

# Depth Processing

When depth sensing is supported:

XR depth data
+
camera pose
+
camera projection information
=============================

3D spatial samples

Depth information should eventually be converted into world-space 3D points.

Do not attempt full room reconstruction immediately.

The first successful milestone is simply:

> Obtain real depth/spatial information and visualize points representing the physical environment.

---

# Spatial Coverage Visualization

The scanner will include a real-time spatial coverage visualization similar in concept to professional scanning applications.

Terminology:

Use:

* Spatial Coverage Visualization
* Scan Coverage Overlay
* Coverage Grid

Avoid referring to it in technical code as "pixel progress."

The coverage visualization must represent actual observations.

Do NOT create a fake progress animation.

Conceptually:

unobserved
→ weak observation
→ partially observed
→ sufficiently scanned

A spatial region should become more complete as valid observations are collected.

Possible information for determining coverage includes:

* number of observations
* valid depth observations
* camera position
* viewing angle
* distance from surface
* repeated observations from different viewpoints

The first version may use a simpler algorithm.

Architecture must allow the algorithm to become more sophisticated later.

---

# Coverage Grid

Do not tightly couple coverage calculation to the UI.

Maintain coverage as data.

Example conceptual structure:

CoverageCell {
observationCount
confidence
state
}

Possible states:

* unscanned
* partial
* scanned

React/Three.js should visualize this state.

The coverage service should calculate it.

---

# User Experience

The scanner is mobile-first.

During scanning, the user should eventually receive feedback such as:

* Move slowly
* Continue scanning
* Scan this area
* Area captured
* Tracking lost
* Move back to the previous position
* Depth unavailable

Do not create guidance that claims knowledge the scanner does not actually possess.

---

# Error Handling

WebXR APIs may be unavailable or partially supported.

Handle failures explicitly.

Examples:

* WebXR unavailable
* immersive-ar unavailable
* depth sensing unavailable
* permission denied
* XR session creation failure
* tracking lost

Never silently fail.

Never allow an unsupported API to produce an unhandled runtime exception.

---

# React Guidelines

Use functional components.

Use hooks where appropriate.

Keep components focused.

Avoid extremely large components.

Do not put WebXR initialization directly inside presentation components when it can be separated.

Prefer:

Component
→ hook/service
→ WebXR API

instead of:

Component
→ hundreds of lines of WebXR code

---

# TypeScript Guidelines

Use strict typing.

Avoid `any`.

If an external browser API lacks a convenient type, create a narrow project-specific type rather than spreading `any` throughout the application.

Add explicit return types to important functions.

Use descriptive domain names.

Examples:

* SpatialScanner
* ScanSession
* CoverageGrid
* CoverageCell
* DepthSample
* SpatialPoint

Avoid vague names such as:

* Manager
* Helper
* Data
* Stuff

unless the responsibility is genuinely clear.

---

# Performance

Spatial scanning can process many frames and depth samples.

Do not create React state updates for every depth pixel or every XR frame.

Real-time XR processing should generally occur outside React rendering.

React should represent application/UI state.

Three.js and scanner services should handle high-frequency rendering and spatial processing.

Avoid unnecessary object allocation inside XR frame loops.

Sampling depth data is acceptable for early versions instead of processing every pixel.

---

# Resource Cleanup

When scanning stops:

* stop XR processing
* end the XR session when appropriate
* remove event listeners
* cancel animation loops
* dispose Three.js geometries
* dispose Three.js materials
* dispose textures
* clear temporary scan data when required

Resource cleanup is mandatory.

---

# Security and Browser Requirements

Camera/XR functionality generally requires a secure context.

Development may use localhost.

Real-device deployments should use HTTPS.

Do not introduce insecure workarounds to bypass browser security requirements.

---

# Development Strategy

Implement the scanner incrementally.

Do not attempt the entire room scanning system in one task.

Development order:

## Milestone 1

Create the React/Vite application and verify:

* application runs
* mobile layout works
* WebXR capability detection works

## Milestone 2

Start an immersive AR session on a supported Android device.

Verify:

* session starts
* session stops
* device pose can be obtained

## Milestone 3

Request and inspect depth information.

Verify:

* depth API availability
* valid depth frames are received

## Milestone 4

Convert sampled depth information into 3D points.

Display those points using Three.js.

## Milestone 5

Accumulate spatial observations while the user moves.

## Milestone 6

Implement the Spatial Coverage Visualization.

Coverage must be based on observations rather than elapsed time.

## Milestone 7

Begin detecting larger surfaces and room geometry.

Only proceed to the next milestone after the previous milestone has been demonstrated successfully.

---

# Scope Control

Do not prematurely implement:

* complete photogrammetry
* AI room recognition
* furniture recognition
* wall segmentation ML
* automatic floor-plan generation
* texture reconstruction
* server-side reconstruction

These may be evaluated later.

Prefer the simplest technically correct implementation that proves each scanner capability.

---

# Coding Quality

Before completing a task:

1. Run TypeScript/build checks.
2. Run linting if configured.
3. Fix introduced errors.
4. Remove unused code.
5. Remove debugging code unless it is intentionally part of a scanner debug mode.
6. Verify resource cleanup.
7. Explain important architectural decisions.

Do not change the architecture or technology stack without explicit instruction.

---

# Current Definition of Success

The current project is successful when:

1. The user opens the web application on a supported Android phone.
2. The application determines whether spatial scanning is supported.
3. The user starts an AR scanning session.
4. The phone tracks movement through the physical environment.
5. Depth/spatial information is obtained where supported.
6. Real-world spatial samples can be visualized using Three.js.
7. The application can progressively record which spatial regions have been observed.

Do not optimize for a finished hardware-store application yet.

Optimize for proving this spatial scanning pipeline first.

---

# Automatic Codex Orchestration

The main model currently selected in the Codex UI or CLI is always the lead/boss. Do not hard-code or override the lead model in project configuration. Changing the selected main model changes the lead only; it does not change the project worker. The user does not need to switch models, request a worker, or name Luna during normal work.

The lead owns understanding the request, planning, architecture, difficult root-cause reasoning, security-sensitive decisions, product and scope decisions, interpretation of ambiguity, task decomposition, implementation direction, integration, final code review, final validation, final approval, and the final response.

`luna-worker` is the only project worker. Do not spawn Codex's built-in `default`, `worker`, or `explorer` roles or any other custom agent for project work; delegate all worker tasks to `luna-worker`. It is fixed to `gpt-5.6-luna` at `max` reasoning effort (Luna Max). The lead automatically delegates bounded work to Luna when delegation materially reduces lead usage or improves speed or context quality. Luna may handle substantial and routine implementation, debugging, refactoring, repository exploration, searches, execution tracing, targeted tests, test runs, documentation, repetitive work, mechanical edits, bounded investigation, and fixes requested after lead review.

Use this routing policy:

* For a trivial task, the lead may work directly when delegation overhead exceeds the work.
* For normal implementation, the lead establishes scope, architecture, direction, constraints, and acceptance criteria; Luna implements and validates; the lead reviews the actual changes and results.
* For debugging, the lead may diagnose directly or ask Luna to gather evidence. Once the implementation direction is established, Luna performs the bounded fix and the lead reviews it.
* For hard root-cause work, the lead owns the conclusion. Luna may inspect files, trace paths, collect diagnostics, create targeted tests, and verify explicit hypotheses.
* For architecture-heavy work, the lead decides the architecture and delegates bounded implementation pieces to Luna afterward.
* Final review, validation, approval, and the user response always belong to the lead.

Before delegation, the lead must form the high-level plan and give Luna one coherent bounded assignment with an explicit task, applicable repository instructions, relevant files or areas, constraints, acceptance criteria, required validation, expected report, and stop condition. Start Luna with fresh/bounded context when the client supports it; do not copy or fork the full lead conversation unless the assignment genuinely requires that context. Avoid duplicate work and avoid fragmenting one coherent task into repeated tiny delegations.

Luna must follow the lead's established architecture and implementation direction, preserve unrelated changes, stay inside the assigned scope, and return control after the assignment. Luna must not independently change architecture, expand project scope, make consequential security or product decisions, or spawn any subagents/workers. Luna must report findings or changes, every changed file, validation commands and results, warnings, and unresolved issues.

The lead must wait for required Luna results, inspect Luna's actual output and repository diff rather than accepting its summary blindly, and run or verify final validation. If review finds a defect, the lead should return one bounded correction to Luna when useful, then review again. Only one worker thread may be open at a time.

Optimize for low lead-model usage without sacrificing correctness. Prefer Luna for safely delegated exploration, implementation, testing, refactoring, documentation, and repetitive work after the lead establishes direction. Keep lead effort focused on planning, difficult diagnosis, architecture, consequential decisions, security and scope, review, integration, final validation, approval, and the final response.

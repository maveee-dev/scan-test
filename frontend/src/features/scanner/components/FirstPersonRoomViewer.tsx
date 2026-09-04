import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { SpatialPoint } from '../types'
import type { RoomSurfaceConstructionResult, RoomSurfacePatch } from '../../room-analysis/types'
import {
  calculateHorizontalDistance,
  calculateMovementDelta,
  isFiniteNavigationPoint,
  resolveWallCollision,
} from '../services/firstPersonNavigationService'
import SurfaceCustomizationPanel from './SurfaceCustomizationPanel'
import {
  getSurfacePaintColor,
  type SurfaceCustomizationMap,
} from '../services/surfaceCustomizationService'

interface FirstPersonRoomViewerProps {
  construction: RoomSurfaceConstructionResult
  customizations: SurfaceCustomizationMap
  onPaintColorChange: (surfaceId: string, color: string) => void
  onResetAllColors: () => void
  onResetSelectedSurface: () => void
  onSelectSurface: (surfaceId: string | null) => void
  selectedSurfaceId: string | null
  referenceSpaceType?: 'local-floor' | 'local'
  onExit: () => void
}

interface ViewerCameraState {
  position: SpatialPoint
  yaw: number
  pitch: number
}

interface ViewerBounds {
  minimum: SpatialPoint
  maximum: SpatialPoint
  center: SpatialPoint
}

interface ViewerHudState {
  position: SpatialPoint
  yaw: number
  pitch: number
  fps: number
  elapsedSeconds: number
  collisionCount: number
  lastCollisionSurfaceId: string | null
}

interface MovementButtons {
  forward: number
  strafe: number
}

interface PatchMeshResource {
  surfaceId: string
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
}

const MAX_PIXEL_RATIO = 2
const EYE_HEIGHT_METERS = 1.6
const MOVE_SPEED_METERS_PER_SECOND = 0.9
const LOOK_SENSITIVITY_RADIANS_PER_PIXEL = 0.0045
const MAX_PITCH_RADIANS = Math.PI * 0.47
const COLLISION_RADIUS_METERS = 0.16
const CAMERA_NEAR_METERS = 0.04
const CAMERA_FAR_METERS = 45
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function add(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z }
}

function subtract(first: SpatialPoint, second: SpatialPoint): SpatialPoint {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }
}

function scale(point: SpatialPoint, scalar: number): SpatialPoint {
  return { x: point.x * scalar, y: point.y * scalar, z: point.z * scalar }
}

function dot(first: SpatialPoint, second: SpatialPoint): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

function normalizeHorizontal(point: SpatialPoint): SpatialPoint | null {
  const length = Math.hypot(point.x, point.z)
  return length > Number.EPSILON ? { x: point.x / length, y: 0, z: point.z / length } : null
}

function averagePoints(points: readonly SpatialPoint[]): SpatialPoint {
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }
  const total = points.reduce(
    (sum, point) => add(sum, point),
    { x: 0, y: 0, z: 0 },
  )
  return scale(total, 1 / points.length)
}

function calculateBounds(patches: readonly RoomSurfacePatch[]): ViewerBounds | null {
  const points = patches.flatMap((patch) => patch.vertices3D).filter(isFiniteNavigationPoint)
  if (points.length === 0) {
    return null
  }
  const minimum = { x: Infinity, y: Infinity, z: Infinity }
  const maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const point of points) {
    minimum.x = Math.min(minimum.x, point.x)
    minimum.y = Math.min(minimum.y, point.y)
    minimum.z = Math.min(minimum.z, point.z)
    maximum.x = Math.max(maximum.x, point.x)
    maximum.y = Math.max(maximum.y, point.y)
    maximum.z = Math.max(maximum.z, point.z)
  }
  return {
    minimum,
    maximum,
    center: {
      x: (minimum.x + maximum.x) * 0.5,
      y: (minimum.y + maximum.y) * 0.5,
      z: (minimum.z + maximum.z) * 0.5,
    },
  }
}

function calculateInitialCamera(
  patches: readonly RoomSurfacePatch[],
  referenceSpaceType: 'local-floor' | 'local',
): ViewerCameraState {
  const bounds = calculateBounds(patches) ?? {
    minimum: { x: -1, y: 0, z: -1 },
    maximum: { x: 1, y: 2.5, z: 1 },
    center: { x: 0, y: 1.25, z: 0 },
  }
  const wallPatches = patches.filter((patch) => patch.role === 'wall')
  const floorPatches = patches.filter((patch) => patch.role === 'floor')
  const ceilingPatches = patches.filter((patch) => patch.role === 'ceiling')
  const largestWall = [...wallPatches].sort((first, second) => second.areaMetersSquared - first.areaMetersSquared)[0]
  let position = { ...bounds.center }

  if (largestWall && wallPatches.length === 1) {
    const wallCenter = averagePoints(largestWall.vertices3D)
    const wallNormal = normalizeHorizontal(largestWall.normal) ?? { x: 0, y: 0, z: 1 }
    const towardObservedCenter = normalizeHorizontal(subtract(bounds.center, wallCenter))
    const facingDirection = towardObservedCenter && dot(wallNormal, towardObservedCenter) < 0
      ? scale(wallNormal, -1)
      : wallNormal
    const wallSpan = Math.max(
      calculateHorizontalDistance(bounds.minimum, bounds.maximum),
      1,
    )
    position = add(wallCenter, scale(facingDirection, clamp(wallSpan * 0.35, 0.7, 1.4)))
  }

  const floorHeight = floorPatches.length > 0
    ? averagePoints(floorPatches.flatMap((patch) => patch.vertices3D)).y
    : null
  const ceilingHeight = ceilingPatches.length > 0
    ? averagePoints(ceilingPatches.flatMap((patch) => patch.vertices3D)).y
    : null
  const unclampedEyeHeight = floorHeight !== null
    ? floorHeight + EYE_HEIGHT_METERS
    : referenceSpaceType === 'local-floor'
      ? EYE_HEIGHT_METERS
      : ceilingHeight !== null
        ? ceilingHeight - EYE_HEIGHT_METERS
        : bounds.minimum.y + EYE_HEIGHT_METERS
  const minimumEyeHeight = bounds.minimum.y + 0.12
  const maximumEyeHeight = bounds.maximum.y - 0.12
  position.y = maximumEyeHeight > minimumEyeHeight
    ? clamp(unclampedEyeHeight, minimumEyeHeight, maximumEyeHeight)
    : unclampedEyeHeight

  const horizontalTarget = { x: bounds.center.x, y: position.y, z: bounds.center.z }
  const targetDirection = subtract(horizontalTarget, position)
  const horizontalDistance = Math.hypot(targetDirection.x, targetDirection.z)
  const yaw = horizontalDistance > Number.EPSILON
    ? Math.atan2(targetDirection.x, -targetDirection.z)
    : 0
  const pitch = clamp(
    Math.atan2(targetDirection.y, Math.max(horizontalDistance, 0.01)),
    -MAX_PITCH_RADIANS,
    MAX_PITCH_RADIANS,
  )
  return { position, yaw, pitch }
}

function createPatchMesh(patch: RoomSurfacePatch): PatchMeshResource {
  const positions = new Float32Array(patch.vertices3D.length * 3)
  patch.vertices3D.forEach((point, index) => {
    const offset = index * 3
    positions[offset] = point.x
    positions[offset + 1] = point.y
    positions[offset + 2] = point.z
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex([...patch.triangleIndices])
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({
    color: getSurfacePaintColor(patch, {}),
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  return { surfaceId: patch.id, mesh: new THREE.Mesh(geometry, material), geometry, material }
}

function formatPosition(point: SpatialPoint): string {
  return `${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`
}

function FirstPersonRoomViewer({
  construction,
  customizations,
  onExit,
  onPaintColorChange,
  onResetAllColors,
  onResetSelectedSurface,
  onSelectSurface,
  referenceSpaceType = 'local',
  selectedSurfaceId,
}: FirstPersonRoomViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resetRef = useRef<(() => void) | null>(null)
  const patchResourcesRef = useRef<Map<string, PatchMeshResource>>(new Map())
  const movementButtonsRef = useRef<MovementButtons>({ forward: 0, strafe: 0 })
  const keyboardRef = useRef<Set<string>>(new Set())
  const [showDebug, setShowDebug] = useState(false)
  const [hud, setHud] = useState<ViewerHudState | null>(null)
  const [initialCamera] = useState(() => calculateInitialCamera(construction.surfaces, referenceSpaceType))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || construction.surfaces.length === 0) {
      return undefined
    }
    const bounds = calculateBounds(construction.surfaces)
    if (!bounds) {
      return undefined
    }

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio, MAX_PIXEL_RATIO))
    renderer.setClearColor(0x111719, 1)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xf2f8ff, 0x34434a, 1.65))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25)
    keyLight.position.set(bounds.center.x - 2, bounds.maximum.y + 4, bounds.center.z + 3)
    scene.add(keyLight)

    const camera = new THREE.PerspectiveCamera(68, 1, CAMERA_NEAR_METERS, CAMERA_FAR_METERS)
    camera.rotation.order = 'YXZ'
    const navigation: ViewerCameraState = {
      position: { ...initialCamera.position },
      yaw: initialCamera.yaw,
      pitch: initialCamera.pitch,
    }
    const initialNavigation: ViewerCameraState = {
      position: { ...initialCamera.position },
      yaw: initialCamera.yaw,
      pitch: initialCamera.pitch,
    }
    const wallPatches = construction.surfaces.filter((patch) => patch.role === 'wall')
    const patchResources = construction.surfaces.map((patch) => {
      const resource = createPatchMesh(patch)
      scene.add(resource.mesh)
      return resource
    })
    patchResourcesRef.current = new Map(patchResources.map((resource) => [resource.surfaceId, resource]))
    let collisionCount = 0
    let lastCollisionSurfaceId: string | null = null
    let lastFrameTime = performance.now()
    let elapsedSeconds = 0
    let frameCount = 0
    let fpsWindowStartedAt = lastFrameTime
    let fps = 0
    let animationFrameId = 0
    let pointerId: number | null = null
    let pointerStartX = 0
    let pointerStartY = 0
    let previousPointerX = 0
    let previousPointerY = 0
    let pointerMoved = false
    const selectionRaycaster = new THREE.Raycaster()
    const selectionPointer = new THREE.Vector2()

    const applyCamera = (): void => {
      camera.position.set(navigation.position.x, navigation.position.y, navigation.position.z)
      camera.rotation.set(navigation.pitch, navigation.yaw, 0)
    }
    const resetNavigation = (): void => {
      navigation.position = { ...initialNavigation.position }
      navigation.yaw = initialNavigation.yaw
      navigation.pitch = initialNavigation.pitch
      applyCamera()
    }
    resetRef.current = resetNavigation
    resetNavigation()

    const getMovementInput = (): MovementButtons => {
      const keys = keyboardRef.current
      return {
        forward: (keys.has('KeyW') ? 1 : 0) + (keys.has('KeyS') ? -1 : 0) + movementButtonsRef.current.forward,
        strafe: (keys.has('KeyD') ? 1 : 0) + (keys.has('KeyA') ? -1 : 0) + movementButtonsRef.current.strafe,
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
        return
      }
      event.preventDefault()
      keyboardRef.current.add(event.code)
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      keyboardRef.current.delete(event.code)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      pointerId = event.pointerId
      pointerStartX = event.clientX
      pointerStartY = event.clientY
      previousPointerX = event.clientX
      previousPointerY = event.clientY
      pointerMoved = false
      canvas.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) {
        return
      }
      event.preventDefault()
      const deltaX = event.clientX - previousPointerX
      const deltaY = event.clientY - previousPointerY
      previousPointerX = event.clientX
      previousPointerY = event.clientY
      if (Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 7) {
        pointerMoved = true
      }
      navigation.yaw -= deltaX * LOOK_SENSITIVITY_RADIANS_PER_PIXEL
      navigation.pitch = clamp(
        navigation.pitch - deltaY * LOOK_SENSITIVITY_RADIANS_PER_PIXEL,
        -MAX_PITCH_RADIANS,
        MAX_PITCH_RADIANS,
      )
      applyCamera()
    }
    const onPointerUp = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) {
        return
      }
      pointerId = null
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
      if (!pointerMoved) {
        const bounds = canvas.getBoundingClientRect()
        if (bounds.width > 0 && bounds.height > 0) {
          selectionPointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
          selectionPointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
          selectionRaycaster.setFromCamera(selectionPointer, camera)
          const hit = selectionRaycaster.intersectObjects(patchResources.map((resource) => resource.mesh), false)[0]
          const selectedResource = hit
            ? patchResources.find((resource) => resource.mesh === hit.object)
            : undefined
          onSelectSurface(selectedResource?.surfaceId ?? null)
        }
      }
    }
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
    }
    const resize = (): void => {
      const width = canvas.clientWidth || 320
      const height = canvas.clientHeight || 260
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    resizeObserver?.observe(canvas)
    resize()

    const render = (timestamp: number): void => {
      const deltaSeconds = Math.min(0.1, Math.max(0, (timestamp - lastFrameTime) / 1000))
      lastFrameTime = timestamp
      elapsedSeconds += deltaSeconds
      frameCount += 1
      const movementInput = getMovementInput()
      const delta = calculateMovementDelta(navigation.yaw, movementInput, MOVE_SPEED_METERS_PER_SECOND, deltaSeconds)
      const proposed = add(navigation.position, delta)
      const collision = resolveWallCollision(navigation.position, proposed, wallPatches, COLLISION_RADIUS_METERS)
      navigation.position = collision.position
      if (collision.collided) {
        collisionCount += 1
        lastCollisionSurfaceId = collision.surfaceId
      }
      applyCamera()
      renderer.render(scene, camera)
      if (timestamp - fpsWindowStartedAt >= 500) {
        fps = frameCount / ((timestamp - fpsWindowStartedAt) / 1000)
        frameCount = 0
        fpsWindowStartedAt = timestamp
      }
      animationFrameId = window.requestAnimationFrame(render)
    }
    const hudTimer = window.setInterval(() => {
      setHud({
        position: { ...navigation.position },
        yaw: navigation.yaw,
        pitch: navigation.pitch,
        fps,
        elapsedSeconds,
        collisionCount,
        lastCollisionSurfaceId,
      })
    }, 250)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false })
    canvas.addEventListener('pointermove', onPointerMove, { passive: false })
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('contextmenu', onContextMenu)
    animationFrameId = window.requestAnimationFrame(render)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.clearInterval(hudTimer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('contextmenu', onContextMenu)
      resizeObserver?.disconnect()
      resetRef.current = null
      patchResources.forEach(({ geometry, material }) => {
        geometry.dispose()
        material.dispose()
      })
      patchResourcesRef.current.clear()
      renderer.dispose()
    }
  }, [construction, initialCamera, onSelectSurface])

  useEffect(() => {
    for (const [surfaceId, resource] of patchResourcesRef.current) {
      const patch = construction.surfaces.find((surface) => surface.id === surfaceId)
      if (!patch) {
        continue
      }
      const isSelected = surfaceId === selectedSurfaceId
      resource.material.color.set(getSurfacePaintColor(patch, customizations))
      resource.material.emissive.set(isSelected ? '#ffffff' : '#000000')
      resource.material.setValues({ emissiveIntensity: isSelected ? 0.24 : 0 })
    }
  }, [construction, customizations, selectedSurfaceId])

  if (construction.surfaces.length === 0) {
    return (
      <div className="first-person-room-empty">
        <strong>No room surfaces available for first-person viewing.</strong>
        <span>Run post-scan analysis after capturing structural room surfaces.</span>
        <button type="button" className="scan-button scan-button-secondary" onClick={onExit}>
          Back to Room Surfaces
        </button>
      </div>
    )
  }

  const wallCount = construction.surfaces.filter((patch) => patch.role === 'wall').length
  const ceilingCount = construction.surfaces.filter((patch) => patch.role === 'ceiling').length
  const floorCount = construction.surfaces.filter((patch) => patch.role === 'floor').length
  const bounds = calculateBounds(construction.surfaces)
  const selectedSurface = construction.surfaces.find((surface) => surface.id === selectedSurfaceId) ?? null
  return (
    <div className="first-person-room-viewer">
      <canvas ref={canvasRef} className="first-person-room-canvas" aria-label="First-person reconstructed room viewer" />
      <div className="first-person-room-toolbar">
        <button type="button" className="scan-button scan-button-secondary" onClick={onExit}>
          Back to Room Surfaces
        </button>
        <button type="button" className="scan-button scan-button-secondary" onClick={() => resetRef.current?.()}>
          Reset Position
        </button>
        <button
          type="button"
          className="scan-button scan-button-secondary"
          aria-pressed={showDebug}
          onClick={() => setShowDebug((visible) => !visible)}
        >
          {showDebug ? 'Hide Details' : 'Details'}
        </button>
      </div>
      {selectedSurface ? (
        <div className="first-person-room-customization">
          <SurfaceCustomizationPanel
            surface={selectedSurface}
            customizations={customizations}
            onPaintColorChange={(color) => onPaintColorChange(selectedSurface.id, color)}
            onResetSelected={onResetSelectedSurface}
            onResetAll={onResetAllColors}
          />
        </div>
      ) : null}
      <div className="first-person-room-joystick" aria-label="Room movement controls">
        <button type="button" aria-label="Move forward" onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); movementButtonsRef.current.forward = 1 }} onPointerUp={() => { movementButtonsRef.current.forward = 0 }} onPointerCancel={() => { movementButtonsRef.current.forward = 0 }}>↑</button>
        <button type="button" aria-label="Move left" onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); movementButtonsRef.current.strafe = -1 }} onPointerUp={() => { movementButtonsRef.current.strafe = 0 }} onPointerCancel={() => { movementButtonsRef.current.strafe = 0 }}>←</button>
        <button type="button" aria-label="Move backward" onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); movementButtonsRef.current.forward = -1 }} onPointerUp={() => { movementButtonsRef.current.forward = 0 }} onPointerCancel={() => { movementButtonsRef.current.forward = 0 }}>↓</button>
        <button type="button" aria-label="Move right" onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); movementButtonsRef.current.strafe = 1 }} onPointerUp={() => { movementButtonsRef.current.strafe = 0 }} onPointerCancel={() => { movementButtonsRef.current.strafe = 0 }}>→</button>
      </div>
      <p className="first-person-room-help">Drag the room to look. Use the controls or W A S D to move.</p>
      {showDebug && hud ? (
        <div className="first-person-room-debug" aria-live="polite">
          <span>Camera {formatPosition(hud.position)} | yaw {(hud.yaw * 180 / Math.PI).toFixed(1)}° | pitch {(hud.pitch * 180 / Math.PI).toFixed(1)}°</span>
          <span>Initial {formatPosition(initialCamera.position)} | eye height {EYE_HEIGHT_METERS.toFixed(2)} m | speed {MOVE_SPEED_METERS_PER_SECOND.toFixed(2)} m/s</span>
          <span>Bounds {bounds ? `${formatPosition(bounds.minimum)} → ${formatPosition(bounds.maximum)}` : 'n/a'} | walls {wallCount} | ceiling {ceilingCount} | floor {floorCount}</span>
          <span>Collision {wallCount > 0 ? 'enabled' : 'disabled'} | wall patches {wallCount} | events {hud.collisionCount} | last {hud.lastCollisionSurfaceId ?? 'none'} | FPS {hud.fps.toFixed(0)} | elapsed {hud.elapsedSeconds.toFixed(1)} s</span>
          <span>Selected {selectedSurface?.id ?? 'none'} | paint {selectedSurface ? getSurfacePaintColor(selectedSurface, customizations) : 'n/a'} | customizations {Object.keys(customizations).length}</span>
        </div>
      ) : null}
    </div>
  )
}

export default FirstPersonRoomViewer

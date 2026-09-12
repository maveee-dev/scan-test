import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { getLiveMapCadenceMs, InspectionPose, type LiveRealityMap } from '../services/liveRealityMap'

/** Separate DOM-overlay GL context; never shares the XR framebuffer/camera. */
export default function LiveRealityMapView({ bridge }: { bridge: LiveRealityMap }) {
  const [open, setOpen] = useState(false), [controls, setControls] = useState(false), [follow, setFollow] = useState(true)
  const [trail, setTrail] = useState(false), [error, setError] = useState('')
  const host = useRef<HTMLDivElement>(null), virtual = useRef(new InspectionPose())
  const input = useRef({ x: 0, y: 0 }), trailEnabled = useRef(false)
  useEffect(() => { virtual.current.follow = follow; input.current = { x: 0, y: 0 } }, [follow, controls])
  useEffect(() => { trailEnabled.current = trail }, [trail])
  useEffect(() => {
    if (!open || !host.current) return
    const container = host.current
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }) }
    catch {
      let cancelled = false
      queueMicrotask(() => { if (!cancelled) setError('This browser could not create an independent live-map canvas. Return to AR Scan View; capture is unchanged.') })
      return () => { cancelled = true }
    }
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace
    container.prepend(renderer.domElement)
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#101b23')
    const camera = new THREE.PerspectiveCamera(65, 1, 0.04, 50)
    const positions = new Float32Array(12000 * 3), colors = new Float32Array(positions.length)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setDrawRange(0, 0)
    const material = new THREE.PointsMaterial({ size: 0.025, vertexColors: true, sizeAttenuation: true })
    const points = new THREE.Points(geometry, material); points.frustumCulled = false; scene.add(points)
    const scanner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), new THREE.MeshBasicMaterial({ color: '#ffcc33', wireframe: true }))
    scene.add(scanner)
    const trailArray = new Float32Array(1024 * 3), trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailArray, 3)); trailGeometry.setDrawRange(0, 0)
    const line = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: '#ffcc33' })); line.frustumCulled = false; scene.add(line)
    let lastCopy = -Infinity, lastFrame = 0, lastRender = 0, count = 0, trailCount = 0
    const obstacles = new Set<string>(), key = (x: number, y: number, z: number) => `${Math.floor(x / .1)},${Math.floor(y / .1)},${Math.floor(z / .1)}`
    const resize = new ResizeObserver(() => { const width = container.clientWidth, height = container.clientHeight; renderer.setSize(width, height); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix() }); resize.observe(container)
    const listener: NonNullable<LiveRealityMap['listener']> = ({ pose, copy, underPressure = false }) => {
      const cadence=getLiveMapCadenceMs(underPressure)
      if (pose.timestamp - lastRender < cadence.render) return
      lastRender = pose.timestamp
      if (pose.timestamp - lastCopy >= cadence.geometryCopy) {
        count = copy(positions, colors); geometry.setDrawRange(0, count)
        geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true
        obstacles.clear()
        for (let i = 0; i < count; i++) obstacles.add(key(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]))
        if (trailCount === 1024) { trailArray.copyWithin(0, 3); trailCount-- }
        trailArray.set([pose.position.x, pose.position.y, pose.position.z], trailCount++ * 3)
        trailGeometry.setDrawRange(0, trailCount); trailGeometry.attributes.position.needsUpdate = true
        lastCopy = pose.timestamp
      }
      virtual.current.updateScanner(pose)
      // Coarse measured-point collision only. No M7/unknown-space walls.
      virtual.current.move(input.current.x, input.current.y, (pose.timestamp - lastFrame) / 1000, (x, y, z) => obstacles.has(key(x, y, z)) || obstacles.has(key(x, y - .25, z)))
      lastFrame = pose.timestamp
      const p = virtual.current.position; camera.position.set(p.x, p.y, p.z)
      if (virtual.current.follow) camera.quaternion.set(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w)
      else camera.rotation.set(virtual.current.pitch, virtual.current.yaw, 0, 'YXZ')
      scanner.position.set(pose.position.x, pose.position.y, pose.position.z); scanner.quaternion.set(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w)
      scanner.visible = !virtual.current.follow; line.visible = trailEnabled.current
      renderer.render(scene, camera)
    }
    const unsubscribe = bridge.subscribe(listener, setError)
    const lost = (event: Event) => { event.preventDefault(); setError('Live map graphics unavailable. AR capture remains active; close the map.') }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    return () => {
      unsubscribe()
      resize.disconnect(); geometry.dispose(); material.dispose(); scanner.geometry.dispose(); scanner.material.dispose(); trailGeometry.dispose(); line.material.dispose()
      renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
      input.current = { x: 0, y: 0 }
    }
  }, [bridge, open])
  return <div style={{ pointerEvents: 'auto' }}>
    <button type="button" className="xr-scanner-hud-debug" onClick={() => { setOpen(!open); setError('') }}>{open ? 'AR Scan View' : 'Live 3D Map'}</button>
    {open && <div style={{ position: 'fixed', inset: '110px 12px 125px', zIndex: 5, background: '#101b23', color: 'white', borderRadius: 12, padding: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button onClick={() => setFollow(!follow)}>{follow ? 'Follow Scanner' : 'Free Look'}</button>
        <button onClick={() => setFollow(true)}>Reset View</button>
        <label><input type="checkbox" checked={controls} onChange={(e) => { setControls(e.target.checked); if (e.target.checked) setFollow(false) }} /> Live Map Controls</label>
        <label><input type="checkbox" checked={trail} onChange={(e) => setTrail(e.target.checked)} /> Scan trail</label>
      </div>
      <p style={{ fontSize: 12 }}>Gold marker = physical scanner. Move carefully; look at your surroundings, not the map. Unknown space stays empty.</p>
      {error && <p role="alert">{error}</p>}
      <div ref={host} style={{ position: 'relative', height: 'calc(100% - 100px)', touchAction: 'none', overflow: 'hidden' }}>
        {controls && !follow && <>
          <div aria-label="Drag to look" style={{ position: 'absolute', inset: '0 0 0 40%', touchAction: 'none' }} onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) virtual.current.look(e.movementX, e.movementY) }} />
          <div role="slider" aria-label="Movement joystick" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={0} tabIndex={0}
            style={{ position: 'absolute', bottom: 20, left: 12, width: 110, height: 110, border: '2px solid white', borderRadius: '50%', background: '#ffffff33', touchAction: 'none', display: 'grid', placeItems: 'center' }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const b = e.currentTarget.getBoundingClientRect(); input.current = { x: Math.max(-1, Math.min(1, (e.clientX - b.left - 55) / 45)), y: Math.max(-1, Math.min(1, (55 - e.clientY + b.top) / 45)) } }}
            onPointerMove={(e) => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const b = e.currentTarget.getBoundingClientRect(); input.current = { x: Math.max(-1, Math.min(1, (e.clientX - b.left - 55) / 45)), y: Math.max(-1, Math.min(1, (55 - e.clientY + b.top) / 45)) } }}
            onPointerUp={() => { input.current = { x: 0, y: 0 } }} onPointerCancel={() => { input.current = { x: 0, y: 0 } }} onLostPointerCapture={() => { input.current = { x: 0, y: 0 } }}
            onKeyDown={(e) => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); input.current = { x: e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, y: e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0 } } }} onKeyUp={() => { input.current = { x: 0, y: 0 } }} onBlur={() => { input.current = { x: 0, y: 0 } }}>↔ ↕</div>
        </>}
      </div>
    </div>}
  </div>
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
const cache = new Map()
function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href)
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from ['"]([^'"]+)['"]/g, (_m, s) => `from '${s.startsWith('.') ? moduleUrl(new URL(`${s}.ts`, url)) : import.meta.resolve(s)}'`)
  const result = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`; cache.set(url.href, result); return result
}
const load = (name) => import(moduleUrl(new URL(`../src/features/scanner/services/${name}.ts`, import.meta.url)))
const { RealityQualityPolicy, DEPTH_PHASES } = await load('realityQualityPolicy')
const { DenseRealityReconstructionService, DENSE_REALITY_CONFIG } = await load('denseRealityReconstructionService')
const { refineRealityDisplay } = await load('realityDisplayRefinement')
const { InspectionPose, LiveRealityMap } = await load('liveRealityMap')
const { RealityRgbKeyframeService } = await load('realityRgbKeyframeService')
const { createRealitySurfaceRenderResources } = await load('realitySurfaceRenderingService')
const { XRDepthService } = await load('xrDepthService')
const { SpatialPointService } = await load('spatialPointService')
const { RealityMeasurementStabilityService } = await load('realityMeasurementStabilityService')
const { filterRealityConfidence } = await load('realityConfidenceFiltering')
const identity = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
const perspective = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,-1,-1, 0,0,-.1,0])
const pose = (x = 0, timestamp = 0) => ({ position: { x, y: 1, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, timestamp })
function sample(id, x, y, z, normal = { x: 0, y: 0, z: 1 }) { return { id, position: { x,y,z }, normal, radius: .0125, colorRgb: { r: .5,g: .5,b: .5 }, colorSpace: 'srgb', geometryConfidence: .9, colorConfidence: .9, colorObservationCount: 4 } }
function plane(size = 18, z = -2, noise = false) { return Array.from({ length: size * size }, (_, i) => sample(i, (i % size - size / 2) * .025, (Math.floor(i / size) - size / 2) * .025, z + (noise ? Math.sin(i * 2.34) * .003 : 0))) }
function feed(service, surfels, sequence, color = true, camera = { x: 0, y: 0, z: 0 }, context) {
  const frame = { validPointCount: surfels.length, valid: new Uint8Array(surfels.length).fill(1), points: new Float32Array(surfels.flatMap((s) => Object.values(s.position))) }
  const registration = color ? { coloredSampleCount: surfels.length, cameraCopySequence: sequence, sourceSampleIndices: new Int32Array(surfels.map((_s, i) => i)), srgbColors: new Uint8Array(surfels.length * 3).fill(128) } : null
  service.process(registration, frame, { copySampleNormal: (i, out) => { Object.assign(out, surfels[i].normal); return true } }, camera, sequence * 500, context)
}
function measurementInput(sequence, x=0, timestamp=sequence*100, validCount=400) {
  const columns=20,rows=20,total=columns*rows,valid=new Uint8Array(total),distancesMeters=new Float32Array(total).fill(2),points=new Float32Array(total*3),nx=new Float32Array(total),ny=new Float32Array(total)
  for(let i=0;i<total;i++){valid[i]=i<validCount?1:0;const gx=i%columns,gy=Math.floor(i/columns);nx[i]=(gx+.5)/columns;ny[i]=(gy+.5)/rows;points[i*3]=(gx-columns/2)*.025+x;points[i*3+1]=(gy-rows/2)*.025;points[i*3+2]=-2}
  const spatial={columns,rows,valid,normalizedX:nx,normalizedY:ny,distancesMeters,points,attemptedSampleCount:total,validPointCount:validCount,rejectedPointCount:total-validCount}
  const depth={columns,rows,attemptedSampleCount:total,validSampleCount:validCount,rejectedSampleCount:total-validCount,valid,normalizedX:nx,normalizedY:ny,distancesMeters,depthProjectionMatrix:identity(),depthTransformMatrix:identity(),viewProjectionMatrix:perspective(),viewTransformMatrix:identity()}
  const matrix=identity();matrix[12]=x
  return {sequence,timestamp,referenceSpaceType:'local-floor',samplingPhase:sequence%4,qualityTier:0,pose:pose(x,timestamp),view:{transform:{matrix,inverse:{matrix:identity()}},projectionMatrix:perspective()},depth,spatial,depthWidth:160,depthHeight:90,depthScale:1}
}
function supported(s, overrides={}) { return {...s,geometryObservationCount:5,viewObservationCount:2,firstObservedAt:0,lastObservedAt:1200,trackingQuality:.95,positionVarianceMetersSquared:.00001,depthVarianceMetersSquared:.000004,normalVariance:.01,stabilityClass:'high',...overrides} }
function keyframe(size = 64) { return { id: 1, timestamp: 1, width: size, height: size, rgb: new Uint8Array(size * size * 3).fill(210), cameraTransform: identity(), inverseCameraTransform: identity(), projectionMatrix: perspective(), qualityScore: 1, mapping: { sourceCameraWidth: size, sourceCameraHeight: size, copyWidth: size, copyHeight: size, sourceUvRect: { x:0,y:0,width:1,height:1 }, orientation: 'upright' } } }

test('temporal phases deterministic, four distinct subgrids reach every-second RGB tick', () => {
  const a = new RealityQualityPolicy(), b = new RealityQualityPolicy(), phases = []
  for (let i = 0; i < 8; i++) { assert.deepEqual(a.sampling(), b.sampling()); if (i % 2 === 1) phases.push(a.sampling().phase); a.recordTick(18,3600,3000); b.recordTick(18,3600,3000) }
  assert.deepEqual(phases, [0,1,2,3]); assert.equal(new Set(DEPTH_PHASES.map(String)).size, 4)
})
test('actual CPU depth sampler produces 4x unique normalized observations, bounded work', () => {
  const service = new XRDepthService(), session = { depthUsage: 'cpu-optimized', depthDataFormat: 'float32', depthActive: true }
  const view = { projectionMatrix: perspective(), transform: { matrix: identity() } }
  const frame = { session, getDepthInformation: () => ({ width: 160, height: 90, rawValueToMeters: 1, getDepthInMeters: () => 2 }) }
  service.initialize(session); service.inspectFrame(frame, view)
  const seen = new Set()
  for (let phase = 0; phase < 4; phase++) { const result = service.inspectDenseFrame(frame, view, 80,45,phase); assert.ok(result); assert.equal(result.validSampleCount,3600); for (let i = 0; i < 3600; i++) seen.add(`${result.normalizedX[i]},${result.normalizedY[i]}`) }
  assert.equal(seen.size,14400)
})
test('depth reconstruction translates with physical world pose, not screen ownership', () => {
  const s = new SpatialPointService(), m = identity(); m[12] = 3
  const frame = { columns: 2, rows: 2, attemptedSampleCount: 4, validSampleCount:4, rejectedSampleCount:0, valid: new Uint8Array(4).fill(1), normalizedX:new Float32Array([.25,.75,.25,.75]), normalizedY:new Float32Array([.25,.25,.75,.75]), distancesMeters:new Float32Array(4).fill(2), depthProjectionMatrix:null, depthTransformMatrix:null, viewProjectionMatrix:perspective(), viewTransformMatrix:m }
  const world = s.processDenseFrame(frame); assert.ok(world.points[0] > 1.9); assert.ok(Math.abs(world.points[2] + 2) < .001)
})
test('quality tiers increase only with sustained headroom and fall back under load', () => {
  const policy = new RealityQualityPolicy(); for(let i=0;i<100;i++) policy.recordTick(8,3600,3400)
  assert.deepEqual(policy.sampling(), { columns:120,rows:68,phase:2 })
  for(let i=0;i<4;i++) policy.recordTick(40,8160,7000)
  assert.equal(policy.sampling().columns,80)
})
test('portrait view redistributes sample budget without exceeding tier capacity',()=>{const p=new RealityQualityPolicy(),g=p.sampling(.45);assert.ok(g.rows>g.columns);assert.ok(g.rows*g.columns<=3600);assert.ok(Math.abs(g.columns/g.rows-.45)<.02)})
test('stationary sampling throttles but physical translation resumes immediately', () => {
  const p = new RealityQualityPolicy(); for(let i=0;i<8;i++) { p.shouldProcess(pose(0,i*200)); p.recordTick(18,3600,3600) }
  assert.equal(p.shouldProcess(pose(0,1500)),false); assert.equal(p.shouldProcess(pose(.2,1550)),true)
})
test('2.5cm/60k decision and numeric storage remain bounded', () => { assert.equal(DENSE_REALITY_CONFIG.cellSizeMeters,.025); assert.equal(DENSE_REALITY_CONFIG.maxSamples,60000); const s = new DenseRealityReconstructionService(); feed(s,plane(3),1); assert.ok(s.getDiagnostics().numericMemoryBytes<6*1048576) })
test('world-space fusion preserves two depth layers and repeated observations', () => {
  const s = new DenseRealityReconstructionService(), a=plane(8,-2), b=plane(8,-2.2); feed(s,a,1); feed(s,b,2); feed(s,a,3); feed(s,b,4)
  const result=s.createSnapshot('layers','local-floor',true); assert.equal(result.surfels.length,128); assert.equal(result.surfels.filter((v)=>v.position.z < -2.1).length,64)
})
test('incompatible surfaces in same hash cell remain separate', () => {
  const s = new DenseRealityReconstructionService(), layers=[sample(0,.001,.001,-2.001),sample(1,.001,.001,-2.02)]; feed(s,layers,1);feed(s,layers,2);assert.equal(s.createSnapshot('layers','local',true).surfels.length,2)
})
test('multi-view recess observations retain front, side and deeper back', () => {
  const s=new DenseRealityReconstructionService(), front=plane(8,-2).filter((v)=>v.position.x < -.025), back=plane(8,-2.3).filter((v)=>v.position.x >=0)
  const side=Array.from({length:40},(_,i)=>sample(1000+i,0,(i%4)*.025,-2-Math.floor(i/4)*.025,{x:1,y:0,z:0}))
  for(let i=0;i<2;i++) { feed(s,front,i*3+1,true,{x:-.3,y:0,z:0});feed(s,side,i*3+2,true,{x:.3,y:0,z:-1});feed(s,back,i*3+3,true,{x:.5,y:0,z:-1}) }
  const result=s.createSnapshot('recess','local-floor',true)
  assert.ok(result.surfels.some((v)=>v.position.z < -2.29));assert.ok(result.surfels.some((v)=>v.normal.x > .99));assert.ok(result.surfels.some((v)=>Math.abs(v.position.z+2)<.001))
})
test('geometry-only ticks confirm measurements without creating fake RGB', () => {
  const s=new DenseRealityReconstructionService();feed(s,plane(4),1,false);feed(s,plane(4),2,false);let r=s.createSnapshot('g','local',true);assert.equal(r.surfels.length,16);assert.ok(r.surfels.every((v)=>v.colorRgb===null));feed(s,plane(4),3);r=s.createSnapshot('g','local',true);assert.ok(r.surfels.every((v)=>v.colorRgb!==null))
})
test('flipped compatible normals do not average to zero and moved cells remain discoverable', () => {
  const s=new DenseRealityReconstructionService();for(let i=0;i<20;i++)feed(s,[sample(i,.024+(i%2)*.004,0,-2,{x:0,y:0,z:i%2?-1:1})],i+1)
  const result=s.createSnapshot('n','local',true);assert.equal(result.surfels.length,1);assert.ok(Math.abs(result.surfels[0].normal.z)>.99)
})
test('capacity reclaims stale unconfirmed samples, never stable geometry', () => {
  const s=new DenseRealityReconstructionService(); const points=Array.from({length:60000},(_,i)=>sample(i,(i%300)*.03,Math.floor(i/300)*.03,-2));feed(s,points,1)
  feed(s,[sample(60001,20,0,-2)],30);assert.equal(s.getDiagnostics().activeSampleCount,60000);assert.equal(s.getDiagnostics().reclaimedSampleCount,1)
  feed(s,[sample(60001,20,0,-2)],31);feed(s,[sample(60001,20,0,-2)],32);assert.equal(s.getDiagnostics().stableSampleCount,1)
})
test('display smoothing reduces noise without mutating source', () => {
  const wall=plane(30,-2,true), before=JSON.stringify(wall), result=refineRealityDisplay(wall,[])
  assert.equal(JSON.stringify(wall),before);assert.ok(result.stats.movedSamples>0);assert.ok(result.stats.refinedNoiseMeters<result.stats.rawNoiseMeters)
  const rms=(samples)=>Math.sqrt(samples.reduce((sum,s)=>sum+(s.position.z+2)**2,0)/samples.length)
  assert.ok(rms(result.geometry)<rms(wall))
  console.log('M8.7 noisy wall',JSON.stringify({...result.stats,rawRmsMeters:rms(wall),refinedRmsMeters:rms(result.geometry)}))
})
test('display smoothing preserves 15–40cm recess depth and original sample identities', () => {
  for(const depth of [.15,.25,.4]) { const front=plane(12,-2), back=plane(12,-2-depth).map((s)=>({...s,id:s.id+1000}));const result=refineRealityDisplay([...front,...back],[]);assert.equal(result.geometry.length,288);assert.ok(result.geometry.slice(144).every((s)=>Math.abs(s.position.z+2+depth)<.0001)) }
})
test('sharp corner and folded curtain are not flattened by local refinement', () => {
  const cloth=plane(20).map((s)=>({...s,position:{...s.position,z:-2+Math.sin(s.position.x*50)*.05},normal:{x:Math.cos(s.position.x*50)*.8,y:0,z:.6}}))
  const result=refineRealityDisplay(cloth,[]);result.geometry.forEach((s,i)=>assert.ok(Math.abs(s.position.z-cloth[i].position.z)<.0041))
})
test('triangulation retains doorway/unsupported gap and never synthesizes vertices', () => {
  const wall=plane(30).filter((s)=>Math.abs(s.position.x)>.1), result=refineRealityDisplay(wall,[]), resources=createRealitySurfaceRenderResources({surfels:result.geometry},'dense')
  const topology=resources.triangleTopology, byId=new Map(wall.map((s)=>[s.id,s]))
  for(let i=0;i<topology.vertexSurfelIds.length;i+=3) {const points=[0,1,2].map((j)=>byId.get(topology.vertexSurfelIds[i+j]));assert.ok(points.every(Boolean));assert.ok(points.every((p)=>p.position.x<0)||points.every((p)=>p.position.x>0))}
  resources.geometries.forEach((g)=>g.dispose());resources.materials.forEach((m)=>m.dispose())
})
test('supported small gaps use existing measured triangulation without hole vertices', () => {
  const wall=plane(12).filter((s)=>s.id!==78), r=createRealitySurfaceRenderResources({surfels:wall},'dense');assert.ok(r.stats.renderedTriangleCount>0);assert.ok([...r.triangleTopology.vertexSurfelIds].every((id)=>id!==78));r.geometries.forEach((g)=>g.dispose());r.materials.forEach((m)=>m.dispose())
})
test('high-resolution appearance uses actual RGB and proven reprojection', () => { const source=plane(8), frame=keyframe(128), before=JSON.stringify(source);const r=refineRealityDisplay(source,[frame]);assert.ok(r.stats.refinedColors>0);assert.equal(r.appearance[30].colorRgb.r,210/255);assert.equal(JSON.stringify(source),before) })
test('occluded back layer rejects foreground keyframe color', () => {const front=[sample(0,0,0,-1)],back=[sample(1,0,0,-2)];const r=refineRealityDisplay([...front,...back],[keyframe()]);assert.equal(r.appearance[1].colorRgb.r,.5);assert.ok(r.stats.visibilityRejects>0)})
test('no useful keyframe keeps original color and no fake appearance',()=>{const source=plane(8),r=refineRealityDisplay(source,[]);assert.equal(r.stats.refinedColors,0);assert.deepEqual(r.appearance,source)})
test('best captured view is selected, not averaged with lower quality views',()=>{const a=keyframe(),b={...keyframe(),id:2,qualityScore:.1,rgb:new Uint8Array(64*64*3).fill(20)};const r=refineRealityDisplay(plane(8),[a,b]);assert.equal(r.appearance[30].colorRgb.r,210/255)})
test('appearance keyframe cap, long edge, duplicate rejection and session reset',()=>{
  const service=new RealityRgbKeyframeService(true);let sequence=0,longEdge=0;const f=keyframe(8),view={transform:{matrix:identity(),inverse:{matrix:identity()}},projectionMatrix:perspective()}
  const raw={copyKeyframe:(_f,_v,_t,edge)=>{longEdge=edge;return {sequence:++sequence,mapping:f.mapping,pixels:new Uint8Array(8*8*4).fill(128)}}}
  for(let i=0;i<15;i++){view.transform.matrix[12]=i*.3;service.considerCapture({},view,i*2000,{x:i*.3,y:0,z:0},{x:0,y:0,z:-1},3600,raw)}
  let r=service.createSnapshot('a',true);assert.equal(r.keyframes.length,8);assert.equal(longEdge,640);const before=sequence
  service.considerCapture({},view,30001,{x:4.2,y:0,z:0},{x:0,y:0,z:-1},3600,raw);assert.equal(sequence,before);service.reset();assert.equal(service.createSnapshot('b',true).keyframes.length,0)
})
test('joystick moves only virtual pose and follow mode cannot be driven',()=>{const physical=pose(2),before=JSON.stringify(physical),v=new InspectionPose();v.updateScanner(physical);v.move(1,1,.05);assert.equal(v.position.x,2);v.follow=false;v.move(1,1,.05);assert.notEqual(v.position.x,2);assert.equal(JSON.stringify(physical),before)})
test('free look ignores subsequent scanner poses; follow returns to current XR pose',()=>{const v=new InspectionPose();v.updateScanner(pose(1));v.follow=false;v.updateScanner(pose(5));assert.equal(v.position.x,1);v.look(50,20);assert.notEqual(v.yaw,0);v.follow=true;v.updateScanner(pose(5));assert.equal(v.position.x,5)})
test('measured collision blocks only known space; unknown remains traversable',()=>{const v=new InspectionPose();v.follow=false;v.move(1,0,.05,()=>true);assert.equal(v.position.x,0);v.move(1,0,.05);assert.ok(v.position.x>0)})
test('live map switching never resets capture and listener teardown is bounded',()=>{const bridge=new LiveRealityMap();let updates=0;bridge.listener=()=>updates++;const frame={pose:pose(),copy:()=>0};bridge.publish(frame);bridge.listener=null;bridge.publish(frame);bridge.listener=()=>updates++;bridge.publish(frame);assert.equal(updates,2);bridge.reset();assert.equal(bridge.listener,null)})
test('trajectory stays world aligned, decimates within cap, reset clears',()=>{const p=new RealityQualityPolicy();for(let i=0;i<2200;i++)p.observePose(pose(i*.05,i*300));const q=p.snapshot();assert.ok(q.trajectory.length<=1024);assert.equal(q.trajectory[0].position.x,0);assert.ok(q.distanceWalkedMeters>100);p.reset();assert.equal(p.snapshot().trajectory.length,0)})
test('finalized raw Reality stays frozen after live fusion and display preparation',()=>{const s=new DenseRealityReconstructionService();feed(s,plane(8),1);feed(s,plane(8),2);const snapshot=s.createSnapshot('raw','local-floor',true),before=JSON.stringify(snapshot);feed(s,plane(8,-2.3),3);refineRealityDisplay(snapshot.surfels,[keyframe()]);assert.ok(Object.isFrozen(snapshot.surfels[0].position));assert.equal(JSON.stringify(snapshot),before)})
test('quality worker caches refinement for mode changes, no M7/customization input',()=>{
  const worker=readFileSync(new URL('../src/features/scanner/services/realityQuality.worker.ts',import.meta.url),'utf8');assert.match(worker,/if \(source\)/);assert.doesNotMatch(worker,/logicalSurface|structuralPatch|paintability/)
  const page=readFileSync(new URL('../src/features/scanner/components/ScannerFinishedView.tsx',import.meta.url),'utf8');assert.match(page,/denseRealityReconstruction=\{denseRealityReconstruction\}/)
})
test('similarly strong conflicting appearance views retain fused original',()=>{
  const first=keyframe(),second={...keyframe(),id:2,rgb:new Uint8Array(64*64*3).fill(10)}
  const result=refineRealityDisplay(plane(8),[first,second]);assert.ok(result.stats.colorConflictRejects>0);assert.equal(result.appearance[30].colorRgb.r,.5)
})
test('appearance projection preserves top-left RGB convention on asymmetric image',()=>{
  const frame=keyframe();for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*3;frame.rgb[i]=y<32?255:0;frame.rgb[i+1]=0;frame.rgb[i+2]=y>=32?255:0}
  const result=refineRealityDisplay([sample(0,0,.5,-2),sample(1,0,-.5,-2)],[frame]);assert.equal(result.appearance[0].colorRgb.r,1);assert.equal(result.appearance[1].colorRgb.b,1)
})
test('XR frame pressure prevents depth-tier upgrade despite cheap processing ticks',()=>{
  const p=new RealityQualityPolicy();for(let i=1;i<60;i++){p.recordFrame(i*50);p.recordTick(8,3600,3000)}assert.equal(p.sampling().columns,80)
})
test('fast motion defers appearance copy without stopping physical geometry capture',()=>{
  const service=new RealityRgbKeyframeService(true);let copies=0
  service.considerCapture({}, {},2000,{x:0,y:0,z:0},{x:0,y:0,z:-1},3600,{copyKeyframe:()=>{copies++;return null}},{translationMetersPerSecond:2,rotationDegreesPerSecond:80})
  assert.equal(copies,0);assert.equal(service.createSnapshot('empty',true).diagnostics.capacity,8)
})
test('immutable measurement packet owns exact frame pose, depth, phase and matrices',()=>{
  const gate=new RealityMeasurementStabilityService(),input=measurementInput(7,.25,700),packet=gate.createPacket(input)
  input.spatial.points[0]=99;input.view.transform.matrix[12]=99;input.pose.position.x=99
  assert.equal(packet.sequence,7);assert.equal(packet.samplingPhase,3);assert.notEqual(packet.denseFrame.points[0],99);assert.equal(packet.viewTransform[12],.25);assert.equal(packet.pose.position.x,.25);assert.ok(Object.isFrozen(packet))
})
test('pose discontinuity is rejected and cannot immediately duplicate the room',()=>{
  const gate=new RealityMeasurementStabilityService(),consistent={consistentRatio:.8,duplicateRatio:0,unknownRatio:.2,establishedSamples:100}
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(1,0,100)),consistent).accepted,true)
  const jump=gate.evaluate(gate.createPacket(measurementInput(2,1.3,200)),consistent);assert.equal(jump.reason,'pose-discontinuity');assert.equal(jump.accepted,false)
  assert.equal(gate.getDiagnostics().relocalizationLikeEvents,1)
})
test('bad or skipped frame updates no partial measurement state',()=>{
  const gate=new RealityMeasurementStabilityService(),bad=gate.createPacket(measurementInput(1,0,100,40))
  assert.equal(gate.evaluate(bad,{consistentRatio:0,duplicateRatio:0,unknownRatio:1,establishedSamples:0}).reason,'depth')
  gate.recordSkippedTogether();const d=gate.getDiagnostics();assert.equal(d.accepted,0);assert.equal(d.depthRejected,1);assert.equal(d.skippedTogether,1)
})
test('same XR frame cannot fake stability through duplicate samples',()=>{
  const service=new DenseRealityReconstructionService(),wall=plane(3)
  feed(service,wall,1,true,{x:0,y:0,z:0},{frameSequence:10,trackingQuality:1});feed(service,wall,2,true,{x:0,y:0,z:0},{frameSequence:10,trackingQuality:1})
  assert.equal(service.getDiagnostics().stableSampleCount,0);assert.ok(service.getDiagnostics().sameFrameDuplicateCount>0)
  feed(service,wall,3,true,{x:0,y:0,z:0},{frameSequence:11,trackingQuality:1});feed(service,wall,4,true,{x:.3,y:0,z:0},{frameSequence:12,trackingQuality:1});assert.equal(service.getDiagnostics().stableSampleCount,wall.length)
})
test('fast but non-relocalizing motion is rejected with move-slower guidance',()=>{
  const gate=new RealityMeasurementStabilityService(),world={consistentRatio:.5,duplicateRatio:0,unknownRatio:.5,establishedSamples:100}
  gate.evaluate(gate.createPacket(measurementInput(1,0,100)),world)
  const result=gate.evaluate(gate.createPacket(measurementInput(2,.4,200)),world);assert.equal(result.reason,'motion');assert.equal(gate.getDiagnostics().guidance,'move-slower')
})
test('real near-parallel second surface survives after temporal and viewpoint support',()=>{
  const service=new DenseRealityReconstructionService(),front=plane(6,-2),second=plane(6,-2.06)
  for(let i=1;i<=3;i++)feed(service,front,i,true,{x:0,y:0,z:0})
  feed(service,second,4,true,{x:0,y:0,z:0});feed(service,second,5,true,{x:0,y:0,z:0});feed(service,second,6,true,{x:2,y:0,z:-2})
  const raw=service.createSnapshot('parallel','local',true).fusedRawSurfels,back=raw.filter(s=>s.position.z<-2.03)
  assert.equal(back.length,second.length);assert.ok(back.every(s=>s.duplicateSurfaceCandidate&&s.stabilityClass==='high'))
})
test('confidence filter excludes tiny one-frame float and retains supported small object',()=>{
  const room=plane(14).map(s=>supported(s)),floating=Array.from({length:5},(_,i)=>sample(1000+i,2+i*.02,2,-1)),object=Array.from({length:12},(_,i)=>supported(sample(2000+i,.8+(i%4)*.025,(i>>2)*.025,-1.6,{x:1,y:0,z:0})))
  const result=filterRealityConfidence([...room,...floating,...object]);assert.ok(result.stats.floatingComponentsRejected>=1);assert.ok(result.surfels.some(s=>s.id===2000));assert.ok(!result.surfels.some(s=>s.id===1000))
})
test('unsupported duplicate sheet is filtered but multi-view real recess remains',()=>{
  const main=plane(12,-2).map(s=>supported(s)),duplicate=plane(8,-2.06).map(s=>supported({...s,id:s.id+1000},{stabilityClass:'low',geometryObservationCount:2,viewObservationCount:1,lastObservedAt:100,duplicateSurfaceCandidate:true})),recess=plane(8,-2.3).map(s=>supported({...s,id:s.id+2000}))
  const result=filterRealityConfidence([...main,...duplicate,...recess]);assert.ok(!result.surfels.some(s=>s.id===1000));assert.ok(result.surfels.some(s=>s.id===2000));assert.ok(result.surfels.some(s=>Math.abs(s.position.z+2)<.001))
})
test('confidence components do not connect across a doorway or depth layer',()=>{
  const left=plane(12).filter(s=>s.position.x<-.05).map(s=>supported(s)),right=plane(12).filter(s=>s.position.x>.05).map(s=>supported({...s,id:s.id+1000})),back=plane(12,-2.3).map(s=>supported({...s,id:s.id+2000}))
  const result=filterRealityConfidence([...left,...right,...back]);assert.ok(result.stats.connectedComponentCount>=3);assert.equal(result.stats.samplesRemoved,0)
})
test('negative-coordinate spatial fusion and hash relinking remain correct',()=>{
  const service=new DenseRealityReconstructionService(),points=[sample(1,-.026,-.026,-2),sample(2,-.051,-.051,-2)]
  feed(service,points,1);feed(service,points,2);feed(service,points,3);const result=service.createSnapshot('negative','local',true);assert.equal(result.surfels.length,2)
})
test('refinement displacement is bounded and disconnected recess remains separate',()=>{
  const source=[...plane(16,-2,true),...plane(16,-2.25,true).map(s=>({...s,id:s.id+1000}))],result=refineRealityDisplay(source,[])
  assert.ok(result.stats.maxDisplacementMeters<=.004);result.geometry.slice(256).forEach(s=>assert.ok(s.position.z<-2.24))
})
test('safe mesh reports rejection classes and accepted edge bounds',()=>{
  const source=plane(16).filter(s=>Math.abs(s.position.x)>.06).map(s=>supported(s)),resources=createRealitySurfaceRenderResources({surfels:source},'dense')
  assert.ok(resources.stats.largestAcceptedTriangleEdgeMeters<=.1);assert.ok(resources.stats.trianglesRejectedByUnsupportedNeighborhood>=0);assert.ok(resources.stats.trianglesRejectedByDepthLayer>=0);resources.geometries.forEach(g=>g.dispose());resources.materials.forEach(m=>m.dispose())
})
test('confirmed full-capacity map never evicts stable surfaces to hide pressure',()=>{
  const service=new DenseRealityReconstructionService(),points=Array.from({length:60000},(_,i)=>sample(i,(i%300)*.03,Math.floor(i/300)*.03,-2))
  feed(service,points,1);feed(service,points,2);feed(service,points,3);feed(service,[sample(60001,20,0,-2)],40)
  assert.equal(service.getDiagnostics().stableSampleCount,60000);assert.equal(service.getDiagnostics().reclaimedSampleCount,0);assert.equal(service.getDiagnostics().capacityRejectedSampleCount,1)
})
test('view diversity counts directions rather than identical camera ticks',()=>{
  const service=new DenseRealityReconstructionService(),points=plane(4)
  feed(service,points,1,true,{x:0,y:0,z:0});feed(service,points,2,true,{x:0,y:0,z:0});const first=service.createSnapshot('v','local-floor',true)
  assert.ok(first.surfels.every((s)=>s.viewObservationCount===1))
  feed(service,points,3,true,{x:3,y:0,z:-2});const next=service.createSnapshot('v','local-floor',true)
  assert.ok(next.surfels.some((s)=>s.viewObservationCount>=2));assert.equal(first.surfels[0].firstObservedAt,500);assert.equal(next.surfels[0].firstObservedAt,500)
})
test('near-capacity display refinement and appearance memory remain bounded',()=>{
  const source=plane(244,-4,true),frames=Array.from({length:8},(_,i)=>{
    const f=keyframe();f.id=i;f.width=288;f.height=640;f.rgb=new Uint8Array(288*640*3).fill(160+i)
    f.mapping={...f.mapping,copyWidth:288,copyHeight:640};f.cameraTransform[12]=i*.1;f.inverseCameraTransform[12]=-i*.1;return f
  })
  const heapBefore=process.memoryUsage().heapUsed,started=performance.now(),r=refineRealityDisplay(source,frames)
  const resources=createRealitySurfaceRenderResources({surfels:r.combined},'dense')
  assert.equal(r.combined.length,59536);assert.ok(r.stats.numericTemporaryBytes<4*1048576);assert.ok(r.stats.refinedColors>0)
  console.log('M8.7 59,536 sample / 8 appearance-frame desktop benchmark',JSON.stringify({totalMs:performance.now()-started,stats:r.stats,meshMs:resources.stats.renderPreparationMs,triangles:resources.stats.renderedTriangleCount,meshBytes:resources.stats.memoryBytes,heapDeltaMiB:(process.memoryUsage().heapUsed-heapBefore)/1048576}))
  resources.geometries.forEach((g)=>g.dispose());resources.materials.forEach((m)=>m.dispose())
})

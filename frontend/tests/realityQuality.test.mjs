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
const { DenseRealityReconstructionService, DENSE_REALITY_CONFIG, DENSE_REALITY_MATCH_BUCKET_OFFSETS, getDenseRealityMatchBucketKey } = await load('denseRealityReconstructionService')
const { refineRealityDisplay } = await load('realityDisplayRefinement')
const { InspectionPose, LiveRealityMap, getLiveMapCadenceMs } = await load('liveRealityMap')
const { RealityRgbKeyframeService } = await load('realityRgbKeyframeService')
const { appendRealityTextureBatches, createRealitySurfaceRenderResources, getMeasuredCellFootprintAlpha, packRealitySurface } = await load('realitySurfaceRenderingService')
const { getFullFrameCopyDimensions } = await load('xrRawCameraService')
const { XRDepthService } = await load('xrDepthService')
const { SpatialPointService } = await load('spatialPointService')
const { RealityMeasurementStabilityService, REALITY_SPATIAL_VALIDITY_CONFIG } = await load('realityMeasurementStabilityService')
const { filterRealityConfidence } = await load('realityConfidenceFiltering')
const { RealityMeasurementQueueService } = await load('realityMeasurementQueueService')
const { CanonicalRealityFusionService, CANONICAL_REALITY_CONFIG, CONSOLIDATED_MEASUREMENT_MAP_CAPACITY, PROVISIONAL_EXPIRY_MAP_CAPACITY, PROVISIONAL_EXPIRY_REASON } = await load('canonicalRealityFusionService')
const { RetainedRealityMeasurementService, RETAINED_REALITY_CONFIG } = await load('retainedRealityMeasurementService')
const { waitForFinishPaintBoundary } = await import(moduleUrl(new URL('../src/features/scanner/hooks/useScannerSession.ts', import.meta.url)))
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
function uniqueDenseFrame(count, xOffset = 0, z = -2) {
  const columns = 500, valid = new Uint8Array(count).fill(1), points = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    points[index * 3] = xOffset + (index % columns) * .08
    points[index * 3 + 1] = Math.floor(index / columns) * .08
    points[index * 3 + 2] = z
  }
  return { validPointCount: count, valid, points }
}
function feedUniqueDense(service, count, sequence, xOffset = 0, z = -2) {
  const frame = uniqueDenseFrame(count, xOffset, z)
  service.process(null, frame, { copySampleNormal: (_index, out) => { out.x = 0; out.y = 0; out.z = 1; return true } }, null, sequence * 500, { frameSequence: sequence, trackingQuality: 1, maxInputSamples: count })
}
function yawOrientation(degrees) { const radians=degrees*Math.PI/180; return {x:0,y:Math.sin(radians/2),z:0,w:Math.cos(radians/2)} }
function measurementInput(sequence, x=0, timestamp=sequence*100, validCount=400, orientation={x:0,y:0,z:0,w:1}) {
  const columns=20,rows=20,total=columns*rows,valid=new Uint8Array(total),distancesMeters=new Float32Array(total).fill(2),points=new Float32Array(total*3),nx=new Float32Array(total),ny=new Float32Array(total)
  for(let i=0;i<total;i++){valid[i]=i<validCount?1:0;const gx=i%columns,gy=Math.floor(i/columns);nx[i]=(gx+.5)/columns;ny[i]=(gy+.5)/rows;points[i*3]=(gx-columns/2)*.025+x;points[i*3+1]=(gy-rows/2)*.025;points[i*3+2]=-2}
  const spatial={columns,rows,valid,normalizedX:nx,normalizedY:ny,distancesMeters,points,attemptedSampleCount:total,validPointCount:validCount,rejectedPointCount:total-validCount}
  const depth={columns,rows,attemptedSampleCount:total,validSampleCount:validCount,rejectedSampleCount:total-validCount,valid,normalizedX:nx,normalizedY:ny,distancesMeters,depthProjectionMatrix:identity(),depthTransformMatrix:identity(),viewProjectionMatrix:perspective(),viewTransformMatrix:identity()}
  const matrix=identity();matrix[12]=x
  return {sequence,timestamp,referenceSpaceType:'local-floor',samplingPhase:sequence%4,qualityTier:0,pose:{...pose(x,timestamp),orientation:{...orientation}},view:{transform:{matrix,inverse:{matrix:identity()}},projectionMatrix:perspective()},depth,spatial,depthWidth:160,depthHeight:90,depthScale:1}
}
function supported(s, overrides={}) { return {...s,geometryObservationCount:5,viewObservationCount:2,firstObservedAt:0,lastObservedAt:1200,trackingQuality:.95,positionVarianceMetersSquared:.00001,depthVarianceMetersSquared:.000004,normalVariance:.01,stabilityClass:'high',...overrides} }
function keyframe(size = 64) { return { id: 1, timestamp: 1, width: size, height: size, rgb: new Uint8Array(size * size * 3).fill(210), cameraTransform: identity(), inverseCameraTransform: identity(), projectionMatrix: perspective(), qualityScore: 1, mapping: { sourceCameraWidth: size, sourceCameraHeight: size, copyWidth: size, copyHeight: size, sourceUvRect: { x:0,y:0,width:1,height:1 }, orientation: 'upright' } } }
function retainedFrame(surfels, sequence, cameraX=sequence*.04, phase=sequence%4) {
  const count=surfels.length,valid=new Uint8Array(count).fill(1),normalValid=new Uint8Array(count).fill(1)
  const points=new Float32Array(count*3),normals=new Float32Array(count*3),colors=new Uint8Array(count*3).fill(128)
  surfels.forEach((s,i)=>{points.set([s.position.x,s.position.y,s.position.z],i*3);normals.set([s.normal.x,s.normal.y,s.normal.z],i*3)})
  return {sequence,timestamp:sequence*250,samplingPhase:phase,trackingQuality:.95,cameraPosition:{x:cameraX,y:0,z:0},cameraOrientation:{x:0,y:0,z:0,w:1},denseFrame:{columns:count,rows:1,valid,normalizedX:new Float32Array(count),normalizedY:new Float32Array(count),distancesMeters:new Float32Array(count).fill(2),points,attemptedSampleCount:count,validPointCount:count,rejectedPointCount:0},normals,normalValid,colorSourceIndices:new Int32Array(surfels.map((_s,i)=>i)),srgbColors:colors}
}
function retainedSnapshot(frames){return {frames,diagnostics:{framesConsidered:frames.length,framesRetained:frames.length,duplicateFramesRejected:0,temporalCompactions:0,samplesRetained:frames.reduce((n,f)=>n+f.denseFrame.validPointCount,0),memoryBytes:frames.reduce((n,f)=>n+f.denseFrame.points.byteLength+f.normals.byteLength+f.denseFrame.valid.byteLength+f.normalValid.byteLength+f.srgbColors.byteLength+f.colorSourceIndices.byteLength,0),viewpointBinCount:frames.length,earliestTimestamp:frames[0]?.timestamp??null,latestTimestamp:frames.at(-1)?.timestamp??null}}
}
const canonical = (frames) => new CanonicalRealityFusionService().reconstruct(retainedSnapshot(frames))

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
test('2.5cm/180k live guardrail and numeric storage remain bounded', () => { assert.equal(DENSE_REALITY_CONFIG.cellSizeMeters,.025); assert.equal(DENSE_REALITY_CONFIG.maxSamples,180000); assert.equal(DENSE_REALITY_CONFIG.matchBucketSizeMeters,DENSE_REALITY_CONFIG.maxMergeDistanceMeters); const s = new DenseRealityReconstructionService(); feed(s,plane(3),1); assert.ok(s.getDiagnostics().numericMemoryBytes<19*1048576) })
test('world-space fusion preserves two depth layers and repeated observations', () => {
  const s = new DenseRealityReconstructionService(), a=plane(8,-2), b=plane(8,-2.2); feed(s,a,1); feed(s,b,2); feed(s,a,3); feed(s,b,4)
  const result=s.createSnapshot('layers','local-floor',true); assert.equal(result.surfels.length,128); assert.equal(result.surfels.filter((v)=>v.position.z < -2.1).length,64)
})
test('live map accepts a unique 130k measured-surfel room envelope with bounded occupancy', () => {
  const count = 130000, service = new DenseRealityReconstructionService()
  feedUniqueDense(service, count, 1)
  const diagnostics = service.getDiagnostics()
  assert.equal(diagnostics.activeSampleCount, count)
  assert.equal(diagnostics.rejectedSampleCount, 0)
  assert.equal(diagnostics.capacityRejectedSampleCount, 0)
  assert.equal(diagnostics.capacity, 180000)
  assert.ok(diagnostics.activeSampleCount <= diagnostics.capacity)
  assert.ok((diagnostics.numericMemoryBytes ?? 0) >= 180000 * 104)
  assert.equal(DENSE_REALITY_MATCH_BUCKET_OFFSETS.length, 27)
  assert.equal((diagnostics.matchBucketProbeCount ?? 0) / count, 27)
})
test('27-bucket matching crosses negative boundaries while retaining depth layers', () => {
  assert.notEqual(getDenseRealityMatchBucketKey({ x: -.0005, y: 0, z: -2 }), getDenseRealityMatchBucketKey({ x: .0325, y: 0, z: -2 }))
  const matching = new DenseRealityReconstructionService()
  feed(matching, [sample(1, -.0005, 0, -2)], 1)
  feed(matching, [sample(2, .0325, 0, -2)], 2)
  assert.equal(matching.getDiagnostics().activeSampleCount, 1)
  assert.equal(matching.getDiagnostics().fusedSampleCount, 1)
  assert.ok((matching.getDiagnostics().matchBucketProbeCount ?? 0) <= 2 * DENSE_REALITY_MATCH_BUCKET_OFFSETS.length)
  const layered = new DenseRealityReconstructionService()
  feed(layered, [sample(3, 0, 0, -2)], 1)
  feed(layered, [sample(4, 0, 0, -1.97)], 2)
  assert.equal(layered.getDiagnostics().activeSampleCount, 2)
  assert.equal(layered.getDiagnostics().fusedSampleCount, 0)
  assert.equal(layered.getDiagnostics().matchDepthLayerRejectCount, 1)
  assert.ok((layered.getDiagnostics().matchBucketProbeCount ?? 0) <= 2 * DENSE_REALITY_MATCH_BUCKET_OFFSETS.length)
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
  const s=new DenseRealityReconstructionService(), capacity=DENSE_REALITY_CONFIG.maxSamples; const points=Array.from({length:capacity},(_,i)=>sample(i,(i%300)*.03,Math.floor(i/300)*.03,-2));feed(s,points,1)
  feed(s,[sample(capacity+1,20,0,-2)],30);assert.equal(s.getDiagnostics().activeSampleCount,capacity);assert.equal(s.getDiagnostics().reclaimedSampleCount,1)
  feed(s,[sample(capacity+1,20,0,-2)],31);feed(s,[sample(capacity+1,20,0,-2)],32);assert.equal(s.getDiagnostics().stableSampleCount,1)
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
test('dense hybrid keeps every measured disc beneath partial safe triangles',()=>{
  const wall=plane(12).filter((s)=>s.id!==78), r=createRealitySurfaceRenderResources({surfels:wall},'dense')
  assert.ok(r.stats.renderedTriangleCount>0);assert.equal(r.stats.renderedSplatCount,wall.length);assert.equal(r.stats.visuallyRepresentedSamples,wall.length)
  assert.ok(r.materials.filter((material)=>material.isShaderMaterial).every((material)=>material.polygonOffset&&material.polygonOffsetFactor===1))
  r.geometries.forEach((g)=>g.dispose());r.materials.forEach((m)=>m.dispose())
})
test('high-resolution appearance uses actual RGB and proven reprojection', () => { const source=plane(8), frame=keyframe(128), before=JSON.stringify(source);const r=refineRealityDisplay(source,[frame]);assert.ok(r.stats.refinedColors>0);assert.equal(r.appearance[30].colorRgb.r,210/255);assert.equal(r.textureBindings[30]?.keyframeId,1);assert.ok(r.textureBindings[30]?.u>0&&r.textureBindings[30]?.u<1);assert.equal(JSON.stringify(source),before) })
test('occluded back layer rejects foreground keyframe color and texture ownership', () => {const front=[sample(0,0,0,-1)],back=[sample(1,0,0,-2)];const r=refineRealityDisplay([...front,...back],[keyframe()]);assert.equal(r.appearance[1].colorRgb.r,.5);assert.equal(r.textureBindings[1],null);assert.ok(r.stats.visibilityRejects>0)})
test('textured stage is bounded real-keyframe triangles with base RGB fallback',()=>{
  const worker=readFileSync(new URL('../src/features/scanner/services/realityQuality.worker.ts',import.meta.url),'utf8')
  const renderer=readFileSync(new URL('../src/features/scanner/services/realitySurfaceRenderingService.ts',import.meta.url),'utf8')
  const page=readFileSync(new URL('../src/features/scanner/components/RealityQualityPreview.tsx',import.meta.url),'utf8')
  assert.match(worker,/mode === 'textured'.*appendRealityTextureBatches/)
  assert.match(renderer,/vertices\.every\(\(vertex\) => vertex!\.bindings\.some/)
  assert.match(renderer,/texture\.wrapS = THREE\.ClampToEdgeWrapping/)
  assert.match(page,/10\. Textured Canonical Reality/)
})
test('texture batches contain only same-keyframe visible triangles and bounded real RGB',()=>{
  const source=plane(8).map(s=>supported(s)),frames=[keyframe()],refined=refineRealityDisplay(source,frames)
  const resources=createRealitySurfaceRenderResources({surfels:refined.appearance},'dense')
  appendRealityTextureBatches(resources,refined.appearance,refined.textureBindings,frames)
  const prepared=packRealitySurface(resources),textured=prepared.layers.filter(layer=>layer.kind==='textured')
  assert.ok(textured.length<=frames.length);assert.ok((prepared.textureBatches?.length??0)<=8)
  for(const batch of prepared.textureBatches??[]){assert.equal(batch.rgb.length,batch.width*batch.height*3);assert.deepEqual(batch.rgb,frames[0].rgb)}
  for(const layer of textured)assert.ok(prepared.geometries[layer.geometry].attributes.some(attribute=>attribute.name==='uv'))
  resources.geometries.forEach(g=>g.dispose());resources.materials.forEach(m=>m.dispose())
})
test('triangle texture uses a common safe second-choice view when vertex-best views differ',()=>{
  const source=[supported(sample(0,-.02,0,-1)),supported(sample(1,.02,0,-1)),supported(sample(2,0,.035,-1))]
  const resources=createRealitySurfaceRenderResources({surfels:source},'dense')
  const bindings=[
    [{keyframeId:1,u:.4,v:.4,score:1},{keyframeId:2,u:.4,v:.4,score:.8}],
    [{keyframeId:3,u:.5,v:.4,score:1},{keyframeId:2,u:.5,v:.4,score:.8}],
    [{keyframeId:1,u:.45,v:.5,score:.9},{keyframeId:2,u:.45,v:.5,score:.8}],
  ]
  appendRealityTextureBatches(resources,source,bindings,[keyframe(),{...keyframe(),id:2},{...keyframe(),id:3}])
  const prepared=packRealitySurface(resources)
  assert.ok((prepared.textureStats?.texturedTriangleCount??0)>0);assert.deepEqual(prepared.textureBatches?.map((batch)=>batch.keyframeId),[2])
  resources.geometries.forEach(g=>g.dispose());resources.materials.forEach(m=>m.dispose())
})
test('triangle texture selects a rank-four common safe view and reports source-view diagnostics',()=>{
  const source=[supported(sample(0,-.02,0,-1)),supported(sample(1,.02,0,-1)),supported(sample(2,0,.035,-1))]
  const resources=createRealitySurfaceRenderResources({surfels:source},'dense')
  const candidateIds=[[1,2,3,8],[4,5,6,8],[7,1,4,8]]
  const bindings=candidateIds.map((ids)=>ids.map((keyframeId,index)=>({
    keyframeId,u:.4,v:.4,score:1-index*.1,incidence:.9-index*.1,distanceMeters:1+index*.2,projectedTexelsPerMeter:400-index*100,
  })))
  const frames=Array.from({length:8},(_unused,index)=>({...keyframe(),id:index+1}))
  appendRealityTextureBatches(resources,source,bindings,frames)
  const stats=packRealitySurface(resources).textureStats
  assert.ok((stats?.commonLaterTriangleCount??0)>0);assert.equal(stats?.commonPrimaryTriangleCount,0);assert.ok((stats?.texelsPerMeter.mean??0)>0)
  assert.ok((stats?.spatialRegionCoverage.length??0)>0);assert.ok(stats.spatialRegionCoverage[0].texturedTriangles>0);assert.ok(stats.spatialRegionCoverage[0].percentage>0)
  resources.geometries.forEach(g=>g.dispose());resources.materials.forEach(m=>m.dispose())
})
test('measured rounded-square splat kernel covers ideal grid corners without extending the adaptive quad',()=>{
  const resources=createRealitySurfaceRenderResources({surfels:plane(4)},'dense')
  const core=resources.materials.find(material=>material.isShaderMaterial&&material.uniforms.uCorePass.value)
  assert.equal(resources.stats.visualFootprintKernel,'measured-cell-rounded-square');assert.match(core.fragmentShader,/max\(absLocal\.x, absLocal\.y\)/);assert.match(core.fragmentShader,/SPLAT_CORNER_ROUNDING|0\.100/)
  const radiusU=(.025/(2*.95))*1.04,radiusV=radiusU*.95
  assert.ok(getMeasuredCellFootprintAlpha(.0125/radiusU,.0125/radiusV)>.1,'an ideal 2.5 cm grid corner must remain visibly represented')
  assert.equal(getMeasuredCellFootprintAlpha(1,1),0,'the kernel must not invent coverage beyond its measured quad')
  resources.geometries.forEach(g=>g.dispose());resources.materials.forEach(m=>m.dispose())
})
test('conflicting keyframe ownership cannot form a bleeding texture triangle',()=>{
  const source=[supported(sample(0,-.01,0,-1)),supported(sample(1,.01,0,-1)),supported(sample(2,0,.02,-1))]
  const resources=createRealitySurfaceRenderResources({surfels:source},'dense')
  const bindings=[{keyframeId:1,u:.4,v:.4},{keyframeId:1,u:.5,v:.4},{keyframeId:2,u:.45,v:.5}]
  appendRealityTextureBatches(resources,source,bindings,[keyframe(),{...keyframe(),id:2}])
  const prepared=packRealitySurface(resources)
  assert.equal(prepared.textureBatches?.length??0,0);assert.ok((prepared.textureStats?.noCommonViewTriangleCount??0)>0)
  resources.geometries.forEach(g=>g.dispose());resources.materials.forEach(m=>m.dispose())
})
test('no useful keyframe keeps original color and no fake appearance',()=>{const source=plane(8),r=refineRealityDisplay(source,[]);assert.equal(r.stats.refinedColors,0);assert.deepEqual(r.appearance,source)})
test('best captured view is selected, not averaged with lower quality views',()=>{const a=keyframe(),b={...keyframe(),id:2,qualityScore:.1,rgb:new Uint8Array(64*64*3).fill(20)};const r=refineRealityDisplay(plane(8),[a,b]);assert.equal(r.appearance[30].colorRgb.r,210/255)})
test('appearance retains every safe ranked candidate from the bounded keyframe set',()=>{
  const frames=Array.from({length:4},(_unused,index)=>({...keyframe(),id:index+1,qualityScore:1-index*.05}))
  const r=refineRealityDisplay(plane(8),frames);assert.equal(r.textureBindingCandidates[30].length,4);assert.ok(r.textureBindingCandidates[30].every((binding)=>binding.keyframeId>=1&&binding.keyframeId<=4))
})
test('appearance keyframe cap, long edge, duplicate rejection and session reset',()=>{
  const service=new RealityRgbKeyframeService(true);let sequence=0,longEdge=0;const f=keyframe(8),view={transform:{matrix:identity(),inverse:{matrix:identity()}},projectionMatrix:perspective()}
  const raw={copyKeyframe:(_f,_v,_t,edge)=>{longEdge=edge;return {sequence:++sequence,mapping:f.mapping,pixels:new Uint8Array(8*8*4).fill(128)}}}
  for(let i=0;i<15;i++){view.transform.matrix[12]=i*.3;service.considerCapture({},view,i*2000,{x:i*.3,y:0,z:0},{x:0,y:0,z:-1},3600,raw)}
  let r=service.createSnapshot('a',true);assert.equal(r.keyframes.length,8);assert.equal(longEdge,960);assert.ok(r.diagnostics.totalBytes<9.6*1024*1024);const before=sequence
  assert.deepEqual(getFullFrameCopyDimensions(1080,2400,960,432*960),[432,960])
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

test('appearance candidates have mutually attributable bounded scheduling outcomes',()=>{
  const service=new RealityRgbKeyframeService(true),view={transform:{matrix:identity(),inverse:{matrix:identity()}},projectionMatrix:perspective()},frame=keyframe(8)
  const available={isAvailable:()=>true,copyKeyframe:()=>({sequence:1,mapping:frame.mapping,pixels:new Uint8Array(8*8*4).fill(128)})}
  service.recordCandidateOutcome('pressure-skipped')
  service.considerCapture({},view,2000,{x:0,y:0,z:0},{x:0,y:0,z:-1},3600,available,{translationMetersPerSecond:2,rotationDegreesPerSecond:0})
  service.considerCapture({},view,4000,{x:0,y:0,z:0},{x:0,y:0,z:-1},3600,{isAvailable:()=>false,copyKeyframe:()=>null})
  service.considerCapture({},view,6000,{x:0,y:0,z:0},{x:0,y:0,z:-1},3600,available,{translationMetersPerSecond:0,rotationDegreesPerSecond:0})
  service.considerCapture({},view,8000,{x:0,y:0,z:0},{x:0,y:0,z:-1},3600,available,{translationMetersPerSecond:0,rotationDegreesPerSecond:0})
  const d=service.getDiagnostics(),sum=Object.values(d.candidateOutcomes).reduce((total,value)=>total+value,0)
  assert.equal(sum,d.candidateCount);assert.equal(d.candidateOutcomes.pressureSkipped,1);assert.equal(d.candidateOutcomes.motionSkipped,1);assert.equal(d.candidateOutcomes.cameraUnavailable,1);assert.equal(d.candidateOutcomes.captured,1);assert.equal(d.candidateOutcomes.duplicateViewSkipped,1)
})

test('Finish reports actual worker stages and retains physical-style timing fields',()=>{
  const session=readFileSync(new URL('../src/features/scanner/services/xrSessionService.ts',import.meta.url),'utf8')
  const worker=readFileSync(new URL('../src/features/scanner/services/postScanCanonicalFusion.worker.ts',import.meta.url),'utf8')
  const overlay=readFileSync(new URL('../src/features/scanner/components/ScannerDomOverlay.tsx',import.meta.url),'utf8')
  const styles=readFileSync(new URL('../src/App.css',import.meta.url),'utf8')
  assert.match(session,/onFinishStage\('preparing-scan'\)/);assert.match(session,/onFinishStage\('building-final-model'\)/);assert.match(session,/canonicalWorkerRoundTripMs/)
  assert.match(worker,/self\.postMessage\(\{ id: event\.data\.id, stage \}\)/)
  assert.match(overlay,/className="xr-finish-processing"/);assert.match(overlay,/aria-busy="true"/);assert.match(overlay,/FINISH_STAGE_STEPS\.map/)
  assert.match(styles,/\.xr-finish-spinner[\s\S]*animation: xr-finish-spin/);assert.match(styles,/\.xr-finish-activity > span[\s\S]*animation: xr-finish-sweep/)
})
test('Finish snapshot group yields use an XR-safe event-loop task',()=>{
  const session=readFileSync(new URL('../src/features/scanner/services/xrSessionService.ts',import.meta.url),'utf8')
  const helper=session.slice(session.indexOf('function waitForFinishSnapshotYield'),session.indexOf('interface FinishHeartbeatDiagnostics'))
  assert.match(helper,/setTimeout\(resolve, 0\)/)
  assert.doesNotMatch(helper,/requestAnimationFrame/)
  assert.match(session,/await waitForFinishSnapshotYield\(\)/)
})
test('finish click publishes processing state before the paint/task boundary',async()=>{
  const source=readFileSync(new URL('../src/features/scanner/hooks/useScannerSession.ts',import.meta.url),'utf8'),finish=source.slice(source.indexOf('const finishScan'))
  assert.ok(finish.indexOf("status: 'finishing'")<finish.indexOf('waitForFinishPaintBoundary()'))
  assert.ok(finish.indexOf('waitForFinishPaintBoundary()')<finish.indexOf('service.finish({'))
  const previousWindow=globalThis.window,events=[]
  globalThis.window={requestAnimationFrame(callback){events.push('raf');callback();return 1},setTimeout(callback){events.push('task');return setTimeout(callback,0)}}
  try { await waitForFinishPaintBoundary();assert.deepEqual(events,['raf','task']) }
  finally { if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow }
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
test('moderate origin jump is quarantined and shifted frames never enter the accepted world',()=>{
  const gate=new RealityMeasurementStabilityService(),unknown={consistentRatio:0,duplicateRatio:0,unknownRatio:1,establishedSamples:100}
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(1,0,100)),unknown).accepted,true)
  const jump=gate.evaluate(gate.createPacket(measurementInput(2,.52,350)),unknown)
  assert.equal(jump.reason,'pose-discontinuity');assert.equal(jump.accepted,false)
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(3,.52,600)),unknown).accepted,false)
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(4,.52,850)),unknown).accepted,false)
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(5,.52,1100)),unknown).accepted,false)
  assert.equal(gate.getScanHealth().status,'recovering')
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(6,0,1350)),unknown).accepted,false)
  assert.equal(gate.getScanHealth().status,'invalid')
  assert.equal(gate.getDiagnostics().accepted,1)
})
test('reference-space reset invalidates the scan without attempting transform migration',()=>{
  const gate=new RealityMeasurementStabilityService(),unknown={consistentRatio:0,duplicateRatio:0,unknownRatio:1,establishedSamples:0}
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(1,0,100)),unknown).accepted,true)
  gate.recordReferenceSpaceReset()
  assert.equal(gate.getScanHealth().status,'invalid');assert.equal(gate.getScanHealth().finishAllowed,false)
  const result=gate.evaluate(gate.createPacket(measurementInput(2,.02,350)),unknown)
  assert.equal(result.reason,'reference-space-reset');assert.equal(result.accepted,false)
  assert.equal(gate.getDiagnostics().referenceSpaceResetCount,1)
})
test('calibration accepts normal handheld translation and quick coherent motion',()=>{
  const gate=new RealityMeasurementStabilityService(),world={consistentRatio:.5,duplicateRatio:0,unknownRatio:.5,establishedSamples:100}
  assert.ok(.4 < REALITY_SPATIAL_VALIDITY_CONFIG.suspiciousTranslationMeters)
  assert.ok(.52 > REALITY_SPATIAL_VALIDITY_CONFIG.suspiciousTranslationMeters)
  assert.equal(REALITY_SPATIAL_VALIDITY_CONFIG.suspiciousRotationDegrees,75)
  for(let i=0;i<12;i++) assert.equal(gate.evaluate(gate.createPacket(measurementInput(i+1,i*.08,100+i*250)),world).accepted,true)
  const quick=new RealityMeasurementStabilityService()
  assert.equal(quick.evaluate(quick.createPacket(measurementInput(1,0,100)),world).accepted,true)
  assert.equal(quick.evaluate(quick.createPacket(measurementInput(2,.4,350)),world).accepted,true)
  assert.equal(gate.getScanHealth().status,'healthy');assert.equal(gate.getDiagnostics().relocalizationLikeEvents,0)
  assert.equal(quick.getScanHealth().status,'healthy');assert.equal(quick.getDiagnostics().relocalizationLikeEvents,0)
})
test('calibration keeps coherent room turns usable but rejects an abrupt angular reset',()=>{
  const world={consistentRatio:.5,duplicateRatio:0,unknownRatio:.5,establishedSamples:100}
  const turning=new RealityMeasurementStabilityService()
  assert.equal(turning.evaluate(turning.createPacket(measurementInput(1,0,100,400,yawOrientation(0))),world).accepted,true)
  assert.equal(turning.evaluate(turning.createPacket(measurementInput(2,0,350,400,yawOrientation(45))),world).accepted,true)
  assert.equal(turning.evaluate(turning.createPacket(measurementInput(3,0,600,400,yawOrientation(90))),world).accepted,true)
  assert.equal(turning.evaluate(turning.createPacket(measurementInput(4,0,850,400,yawOrientation(135))),world).accepted,true)
  assert.equal(turning.evaluate(turning.createPacket(measurementInput(5,0,1100,400,yawOrientation(180))),world).accepted,true)
  assert.equal(turning.getScanHealth().status,'healthy');assert.equal(turning.getDiagnostics().relocalizationLikeEvents,0)
  const resetLike=new RealityMeasurementStabilityService()
  resetLike.evaluate(resetLike.createPacket(measurementInput(1,0,100,400,yawOrientation(0))),world)
  const result=resetLike.evaluate(resetLike.createPacket(measurementInput(2,0,250,400,yawOrientation(90))),world)
  assert.equal(result.reason,'pose-discontinuity');assert.equal(result.accepted,false);assert.equal(resetLike.getScanHealth().status,'recovering')
})
test('short tracking or depth occlusion does not create a new pose epoch',()=>{
  const gate=new RealityMeasurementStabilityService(),world={consistentRatio:.5,duplicateRatio:0,unknownRatio:.5,establishedSamples:100}
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(1,0,100)),world).accepted,true)
  gate.recordTrackingMissing();gate.recordDepthMissing()
  assert.equal(gate.getScanHealth().status,'healthy');assert.equal(gate.getDiagnostics().poseEpochCount,1)
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(2,.03,600)),world).accepted,true)
  assert.equal(gate.getDiagnostics().poseEpochCount,1);assert.equal(gate.getScanHealth().finishAllowed,true)
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
  const service=new DenseRealityReconstructionService(),capacity=DENSE_REALITY_CONFIG.maxSamples,points=Array.from({length:capacity},(_,i)=>sample(i,(i%300)*.03,Math.floor(i/300)*.03,-2))
  feed(service,points,1);feed(service,points,2);feed(service,points,3);feed(service,[sample(capacity+1,20,0,-2)],40)
  assert.equal(service.getDiagnostics().stableSampleCount,capacity);assert.equal(service.getDiagnostics().reclaimedSampleCount,0);assert.equal(service.getDiagnostics().capacityRejectedSampleCount,1)
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

test('latest-only measurement queue replaces stale pending work without backlog',async()=>{
  const scheduled=[],processed=[]
  const queue=new RealityMeasurementQueueService((value)=>{processed.push(value)},(callback)=>scheduled.push(callback),(()=>{let t=0;return()=>++t})())
  assert.equal(queue.enqueue(1),'queued');assert.equal(queue.enqueue(2),'replaced');assert.equal(queue.enqueue(3),'replaced')
  assert.equal(scheduled.length,1);scheduled.shift()();await queue.flush()
  assert.deepEqual(processed,[3]);const d=queue.getDiagnostics();assert.equal(d.completedPackets,1);assert.equal(d.packetsDropped,2);assert.ok(d.maximumQueueDepth<=2)
})
test('measurement queue retains processing packet plus only newest pending packet',async()=>{
  let releaseFirst,startFirst
  const firstStarted=new Promise(resolve=>{startFirst=resolve}),firstGate=new Promise(resolve=>{releaseFirst=resolve}),processed=[]
  const queue=new RealityMeasurementQueueService(async(value)=>{processed.push(value);if(value===1){startFirst();await firstGate}})
  queue.enqueue(1);await firstStarted;queue.enqueue(2);assert.equal(queue.enqueue(3),'replaced');assert.ok(queue.getDiagnostics().queueDepth<=2)
  releaseFirst();await queue.flush();assert.deepEqual(processed,[1,3]);assert.equal(queue.getDiagnostics().packetsDropped,1)
})

test('packet-local sampling phases stay deterministic when queued packets are dropped',()=>{
  const policy=new RealityQualityPolicy(),claimed=[]
  for(let i=0;i<8;i++)claimed.push(policy.claimSampling().phase)
  assert.deepEqual(claimed,[0,0,1,1,2,2,3,3])
  assert.equal(policy.claimSampling().phase,0)
})

test('temporal sub-grid shifts match established wall surfels instead of churning',()=>{
  const service=new DenseRealityReconstructionService()
  const first=Array.from({length:20},(_,i)=>sample(i,i*.1,0,-2))
  const shifted=first.map((s,i)=>sample(i,s.position.x+.025,0,-2))
  feed(service,first,1);feed(service,shifted,2)
  const d=service.getDiagnostics();assert.equal(d.activeSampleCount,20);assert.equal(d.createdThisTick,0);assert.equal(d.fusedThisTick,20);assert.equal(d.matchRatioPercentage,100)
})

test('repeated temporal phases converge rather than saturating the Dense map',()=>{
  const service=new DenseRealityReconstructionService(),base=Array.from({length:120},(_,i)=>sample(i,(i%20)*.1,Math.floor(i/20)*.1,-2))
  for(let frame=1;frame<=12;frame++){const shift=[0,.012,.024,.008][frame%4];feed(service,base.map((s,i)=>sample(i,s.position.x+shift,s.position.y,-2)),frame)}
  const d=service.getDiagnostics();assert.equal(d.activeSampleCount,120);assert.equal(d.createdSampleCount,120);assert.equal(d.fusedSampleCount,1320);assert.ok(d.matchRatioPercentage>90)
})

test('modest lateral camera sweep establishes viewpoint diversity',()=>{
  const service=new DenseRealityReconstructionService(),wall=plane(6)
  feed(service,wall,1,true,{x:0,y:0,z:0});feed(service,wall,2,true,{x:0,y:0,z:0});feed(service,wall,3,true,{x:.12,y:0,z:0})
  const d=service.getDiagnostics();assert.ok(d.viewDiverseSampleCount>0);assert.ok((d.viewBaselineP50Meters??0)>=.06)
})

test('appearance capture yields under queue or XR timing pressure',()=>{
  const policy=new RealityQualityPolicy();assert.equal(policy.shouldCaptureAppearance(1),false)
  for(let i=1;i<20;i++)policy.recordFrame(i*52)
  policy.recordTick(40,3600,3000)
  assert.equal(policy.shouldCaptureAppearance(0),false)
})
test('Live Map throttles display work before core measurement capture',()=>{
  assert.deepEqual(getLiveMapCadenceMs(false),{render:33,geometryCopy:350});assert.deepEqual(getLiveMapCadenceMs(true),{render:100,geometryCopy:900})
})
test('React diagnostics cadence backs off under scanner pressure',()=>{
  const session=readFileSync(new URL('../src/features/scanner/services/xrSessionService.ts',import.meta.url),'utf8')
  assert.match(session,/scannerUnderPressure\?DEBUG_SAMPLE_INTERVAL_MS\*3:DEBUG_SAMPLE_INTERVAL_MS/)
})
test('normal scan HUD uses plain guidance while coverage percentages stay diagnostic-only',()=>{
  const overlay=readFileSync(new URL('../src/features/scanner/components/ScannerDomOverlay.tsx',import.meta.url),'utf8')
  const renderer=readFileSync(new URL('../src/features/scanner/services/spatialCoverageRenderService.ts',import.meta.url),'utf8')
  assert.match(overlay,/function formatScanGuidance\(/)
  assert.match(overlay,/Enough good data — ready to finish/)
  assert.match(overlay,/Move to another area/)
  assert.match(overlay,/Show Coverage Overlay/)
  assert.doesNotMatch(overlay,/span>Coverage completeness<\/span>/)
  assert.doesNotMatch(overlay,/span>Coverage persistence<\/span>/)
  assert.match(renderer,/private coverageOverlayVisible = false/)
  assert.match(renderer,/this\.coverageOverlayVisible && this\.candidateSurfaceVisible/)
  assert.match(renderer,/this\.coverageOverlayVisible && this\.persistentSurfaceVertexCount/)
  assert.match(renderer,/this\.diagnostics\.renderSkipCount \+= 1/)
  assert.match(renderer,/this\.diagnostics\.drawCallCount \+= 1/)
  assert.match(overlay,/Render calls \/ skips/)
  assert.match(overlay,/WebGL draw calls/)
})
test('reference-space reset handling invalidates the same world instead of migrating it',()=>{
  const session=readFileSync(new URL('../src/features/scanner/services/xrSessionService.ts',import.meta.url),'utf8')
  assert.match(session,/referenceSpace\.addEventListener\('reset', this\.referenceSpaceResetListener\)/)
  assert.match(session,/measurementStabilityService\.recordReferenceSpaceReset\(\)/)
  assert.match(session,/removeReferenceSpaceResetListener\(\)/)
  assert.match(session,/retainedMeasurementService\.consider\(packet, acceptance\.trackingQuality, queuedRegistration, acceptance\.trackingEpoch\)/)
  assert.match(session,/retainSameXrFrameCapture\([\s\S]*trackingEpoch: acceptance\.trackingEpoch/)
})

test('depth rejection categories remain explicit and mutually attributable',()=>{
  const gate=new RealityMeasurementStabilityService()
  gate.recordDepthMissing();gate.evaluate(gate.createPacket(measurementInput(2,0,200,40)),{consistentRatio:0,duplicateRatio:0,unknownRatio:1,establishedSamples:0})
  const d=gate.getDiagnostics();assert.equal(d.depthRejected,2);assert.equal(d.depthRejectedMissing,1);assert.equal(d.depthRejectedSampleCount,1)
})
test('fast-motion rejection recovers when the next interval is slow and coherent',()=>{
  const gate=new RealityMeasurementStabilityService(),world={consistentRatio:.7,duplicateRatio:0,unknownRatio:.3,establishedSamples:100}
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(1,0,100)),world).accepted,true)
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(2,.4,200)),world).reason,'motion')
  assert.equal(gate.evaluate(gate.createPacket(measurementInput(3,.41,700)),world).accepted,true)
})
test('short valid phased scan accumulates one coherent wall component',()=>{
  const service=new DenseRealityReconstructionService(),wall=plane(10)
  for(let frame=1;frame<=5;frame++)feed(service,wall.map((s,i)=>sample(i,s.position.x+(frame%2)*.008,s.position.y,s.position.z)),frame,true,{x:frame*.04,y:0,z:0})
  const raw=service.createSnapshot('short','local-floor',true),filtered=filterRealityConfidence(raw.surfels)
  assert.equal(raw.surfels.length,100);assert.equal(filtered.stats.connectedComponentCount,1);assert.equal(filtered.stats.samplesRemoved,0)
})

test('unsupported explicit duplicate cannot become stable by repeated same-view count',()=>{
  const main=plane(10,-2).map(s=>supported(s)),duplicate=plane(10,-2.06).map(s=>supported({...s,id:s.id+1000},{geometryObservationCount:8,viewObservationCount:1,lastObservedAt:3000,duplicateSurfaceCandidate:true,stabilityClass:'low'}))
  const result=filterRealityConfidence([...main,...duplicate]);assert.equal(result.surfels.filter(s=>s.id>=1000).length,0);assert.ok(result.stats.duplicateCandidatesRejected>=100)
})

test('triangle rejection diagnostics distinguish combinatorial candidates from missing surfels',()=>{
  const resources=createRealitySurfaceRenderResources({surfels:plane(12).map(s=>supported(s))},'dense'),s=resources.stats
  assert.ok(s.triangleCandidatePairCount>=s.renderedTriangleCount);assert.equal(s.trianglesRejectedByUnsupportedNeighborhood,s.trianglesRejectedDegenerate+s.trianglesRejectedAngularGap+s.trianglesRejectedOccupiedCircumcircle);assert.equal(s.triangleNonParticipantCount,s.coloredSurfelCount-s.triangleParticipantCount);assert.equal(s.measuredUnderlaySplatCount,s.coloredSurfelCount);assert.equal(s.fallbackSplatCount,s.triangleNonParticipantCount)
  assert.equal(s.meshCoveredCanonicalSamples,s.triangleParticipantCount);assert.equal(s.splatCoveredCanonicalSamples,s.measuredUnderlaySplatCount);assert.equal(s.visuallyRepresentedSamples,s.sourceSurfelCount);assert.equal(s.trulyUndisplayedSamples,0)
  resources.geometries.forEach(g=>g.dispose());resources.materials.forEach(m=>m.dispose())
})

test('M8.7.1.2 same-frame spatial consolidation is bounded and preserves measured ownership',()=>{
  const patch=Array.from({length:80},(_,i)=>sample(i,(i%10)*.001,Math.floor(i/10)*.001,-2))
  const result=canonical([retainedFrame(patch,1),retainedFrame(patch,2),retainedFrame(patch,3)])
  assert.ok(result.diagnostics.sameFrameConsolidated>0);assert.ok(result.diagnostics.consolidatedObservations<result.diagnostics.inputObservations)
})

test('canonical flat wall reinforces one surface instead of temporal-phase churn',()=>{
  const wall=plane(10),frames=[]
  for(let sequence=1;sequence<=6;sequence++){const shift=[0,.006,.012,.003][sequence%4];frames.push(retainedFrame(wall.map((s,i)=>sample(i,s.position.x+shift,s.position.y,s.position.z)),sequence))}
  frames[0].cameraPosition={x:0,y:0,z:0};frames[1].cameraPosition={x:.2,y:0,z:0};frames[2].cameraPosition={x:.4,y:0,z:0};frames[3].cameraPosition={x:.5,y:0,z:0};frames[4].cameraPosition={x:.55,y:0,z:0}
  const result=canonical(frames)
  assert.ok(result.surfels.length>=80&&result.surfels.length<=130);assert.ok(result.diagnostics.matchedExisting>result.diagnostics.provisionalCreated);assert.ok(result.diagnostics.observationsPerCanonicalSurfel>=3)
  assert.ok(result.diagnostics.matchingBucketProbes<=result.diagnostics.consolidatedObservations*27);assert.ok(result.diagnostics.matchingCandidateVisits>0)
  assert.ok(result.diagnostics.provisionalPromoted>0);assert.ok(result.diagnostics.canonicalMerges>0);assert.ok(result.diagnostics.transitionExistingCanonical>0)
  const reinforced=result.surfels.find(s=>s.geometryObservationCount>=5);assert.ok(reinforced);assert.ok((reinforced.lastObservedAt??0)>(reinforced.firstObservedAt??0));assert.ok((reinforced.viewObservationCount??0)>=2);assert.ok((reinforced.positionVarianceMetersSquared??0)>0)
})

test('canonical replay reports equivalent measured-cell transitions and a real consolidated stage map',()=>{
  const frames=Array.from({length:4},(_,index)=>retainedFrame(plane(8).map((s)=>sample(s.id,s.position.x+(index%2)*.003,s.position.y,s.position.z)),index+1))
  const result=canonical(frames),map=result.consolidatedMeasurementMap,transition=result.diagnostics.coverageTransition
  const consolidatedStage=result.diagnostics.completenessStages.find((stage)=>stage.name==='per-frame-consolidated')
  const createdStage=result.diagnostics.completenessStages.find((stage)=>stage.name==='provisional-created')
  assert.equal(transition.consolidatedCells,consolidatedStage.spatialCoverageCells)
  assert.equal(transition.cellsAdmittedAsNew,createdStage.spatialCoverageCells)
  assert.equal(map.total,transition.consolidatedCells);assert.equal(map.sampled,Math.min(map.total,CONSOLIDATED_MEASUREMENT_MAP_CAPACITY));assert.equal(map.omitted,map.total-map.sampled)
  assert.equal(map.positions.length,map.sampled*3);assert.ok([...map.positions].every(Number.isFinite))
})

test('temporally sparse retained frames reinforce without adjacent retained indices',()=>{
  const measured=[sample(1,0,0,-2)],frames=[retainedFrame(measured,1),retainedFrame(measured,20),retainedFrame(measured,100)]
  const result=canonical(frames)
  assert.equal(result.surfels.length,1);assert.equal(result.surfels[0].geometryObservationCount,3)
  assert.equal(result.diagnostics.promotionAudit.maximumRetainedSequenceSpan,2)
  assert.equal(result.diagnostics.promotionAudit.maximumOriginalFrameSpan,99)
})

test('established coherent wall neighbors promote two-frame measured coverage without inventing positions',()=>{
  const anchors=[sample(1,-.055,0,-2),sample(2,.0275,.0476,-2),sample(3,.0275,-.0476,-2)]
  const center=[sample(4,0,0,-2)],frames=[retainedFrame(anchors,1),retainedFrame(anchors,2),retainedFrame(anchors,3),retainedFrame(center,4),retainedFrame(center,5)]
  frames[0].cameraPosition={x:0,y:0,z:0};frames[1].cameraPosition={x:.2,y:0,z:0};frames[2].cameraPosition={x:.4,y:0,z:0};frames[3].cameraPosition={x:.5,y:0,z:0};frames[4].cameraPosition={x:.55,y:0,z:0}
  const result=canonical(frames)
  assert.equal(result.surfels.length,4);assert.ok(result.diagnostics.surfaceCoherentPromotions>=1)
  assert.ok(result.surfels.some(s=>Math.hypot(s.position.x,s.position.y)<.005))
  assert.ok(result.diagnostics.canonicalCoverageOfConsolidatedPercentage>0)
  assert.ok(result.diagnostics.coverageLossRegions.some(region=>region.promoted>0))
})

test('later frames reinforce promoted canonical state without recreating provisional surfels',()=>{
  const measured=[sample(1,0,0,-2)]
  const frames=Array.from({length:7},(_,index)=>retainedFrame(measured.map(s=>sample(1,s.position.x+(index%2)*.002,0,-2+(index%3)*.001)),index+1,index*.1))
  const result=canonical(frames),surfel=result.surfels[0]
  assert.equal(result.surfels.length,1);assert.equal(result.diagnostics.provisionalCreated,1);assert.equal(result.diagnostics.provisionalPromoted,1)
  assert.ok(result.diagnostics.canonicalMerges>=3);assert.equal(result.diagnostics.canonicalMerges,result.diagnostics.transitionExistingCanonical)
  assert.equal(surfel.geometryObservationCount,7);assert.ok((surfel.positionVarianceMetersSquared??0)>0);assert.ok((surfel.depthVarianceMetersSquared??0)>0);assert.ok((surfel.viewObservationCount??0)>=2)
})

test('per-frame consolidation preserves real RGB when the first measured voxel representative is uncolored',()=>{
  const patch=[sample(0,0,0,-2),sample(1,.001,.001,-2)]
  const frames=Array.from({length:4},(_,index)=>{
    const frame=retainedFrame(patch,index+1,index*.1)
    frame.colorSourceIndices=new Int32Array([1]);frame.srgbColors=new Uint8Array([220,40,20])
    return frame
  })
  const result=canonical(frames)
  assert.equal(result.surfels.length,1);assert.ok(result.surfels[0].colorRgb);assert.ok(result.surfels[0].colorRgb.r>.8)
  assert.equal(result.diagnostics.baseColorCanonicalSurfels,1);assert.equal(result.diagnostics.baseColorCoveragePercentage,100)
})

test('robust canonical update resists one corrupt frame and provisional surface does not become Final',()=>{
  const wall=plane(8),frames=[retainedFrame(wall,1),retainedFrame(wall,2),retainedFrame(plane(8,-1.95),3),retainedFrame(wall,4),retainedFrame(wall,5)]
  const result=canonical(frames),z=result.surfels.map(s=>s.position.z)
  assert.ok(z.length>0);assert.ok(z.every(value=>Math.abs(value+2)<.018));assert.ok(result.diagnostics.provisionalExpired>0)
})

test('provisional expiry map is bounded packed measured positions with deterministic reason accounting',()=>{
  const perFrame=1600,frameCount=8,total=perFrame*frameCount
  const frames=Array.from({length:frameCount},(_unused,frameIndex)=>retainedFrame(Array.from({length:perFrame},(_ignored,index)=>sample(index,(frameIndex*perFrame+index)*.09,0,-2)),frameIndex+1))
  const result=canonical(frames)
  const map=result.diagnostics.provisionalExpiryMap,reasons=result.diagnostics.expiryReasons
  const reasonTotal=Object.values(reasons).reduce((total,value)=>total+value,0)
  assert.equal(map.total,reasonTotal);assert.equal(map.total,total);assert.equal(map.sampled,PROVISIONAL_EXPIRY_MAP_CAPACITY);assert.equal(map.omitted,total-PROVISIONAL_EXPIRY_MAP_CAPACITY)
  assert.ok(map.sampled<=map.capacity);assert.equal(map.capacity,PROVISIONAL_EXPIRY_MAP_CAPACITY)
  assert.equal(map.positions.length,map.sampled*3);assert.equal(map.reasonCodes.length,map.sampled)
  assert.ok([...map.positions].every(Number.isFinite));assert.ok([...map.reasonCodes].every(code=>code===PROVISIONAL_EXPIRY_REASON.insufficientTemporalSupport))
  assert.equal(reasons.insufficientTemporalSupport,total);assert.equal(reasons.replacedByCanonical,0)
})

test('false forward five-centimeter wall disappears after correct support resumes',()=>{
  const wall=plane(9),bad=plane(9,-1.95),frames=[retainedFrame(wall,1),retainedFrame(wall,2),retainedFrame(wall,3),retainedFrame(bad,4),retainedFrame(bad,5),retainedFrame(wall,6),retainedFrame(wall,7)]
  const result=canonical(frames)
  assert.equal(result.surfels.filter(s=>s.position.z>-1.97).length,0);assert.ok(result.diagnostics.provisionalExpired>0||result.diagnostics.falseParallelLayersCollapsed>0)
})

test('real eight-centimeter protrusion remains with repeated diverse observations',()=>{
  const wall=plane(10),object=plane(4,-1.92).map((s,i)=>sample(1000+i,s.position.x,s.position.y,s.position.z))
  const frames=[retainedFrame(wall,1,0),retainedFrame(wall,2,.1),retainedFrame(wall,3,.2),retainedFrame(object,4,0),retainedFrame(object,5,.12),retainedFrame(object,6,.24)]
  const result=canonical(frames)
  assert.ok(result.surfels.some(s=>s.position.z>-1.95));assert.ok(result.surfels.some(s=>s.position.z<-1.98));assert.ok(result.diagnostics.trueSeparateLayersRetained>0)
})

test('front, side and back surfaces of a measured recess remain distinct',()=>{
  const front=plane(10).filter(s=>Math.abs(s.position.x)>.055),back=plane(5,-2.25).map((s,i)=>sample(2000+i,s.position.x,s.position.y,s.position.z))
  const side=Array.from({length:25},(_,i)=>sample(3000+i,-.06,(Math.floor(i/5)-2)*.025,-2.05-(i%5)*.04,{x:1,y:0,z:0}))
  const scene=[...front,...back,...side],result=canonical([retainedFrame(scene,1,0),retainedFrame(scene,2,.12),retainedFrame(scene,3,.24)])
  assert.ok(result.surfels.some(s=>s.position.z<-2.2));assert.ok(result.surfels.some(s=>Math.abs(s.normal.x)>.8));assert.ok(result.surfels.some(s=>Math.abs(s.position.z+2)<.03))
})

test('canonical local layer storage is fixed and bounded',()=>{
  const layers=Array.from({length:8},(_,layer)=>sample(layer,0,0,-2-layer*.003))
  const result=canonical([retainedFrame(layers,1),retainedFrame(layers,2),retainedFrame(layers,3)])
  assert.equal(CANONICAL_REALITY_CONFIG.maxLayersPerCell,4);assert.ok(result.diagnostics.layerCapacityRejected>=0);assert.ok(result.surfels.length<=4)
})

test('full local layer bucket still reinforces a compatible hypothesis',()=>{
  const initial=[sample(1,.001,.001,.001),sample(2,.019,.001,.001),sample(3,.001,.019,.001),sample(4,.019,.019,.001)]
  const repeated=[sample(1,.001,.001,.001)]
  const frames=[retainedFrame(initial,1),retainedFrame(repeated,2),retainedFrame(repeated,3)]
  frames[0].cameraPosition={x:0,y:0,z:0};frames[1].cameraPosition={x:.2,y:0,z:0};frames[2].cameraPosition={x:.4,y:0,z:0}
  const result=canonical(frames)
  assert.equal(result.diagnostics.localLayerCapacityRejected,0);assert.equal(result.surfels.length,1);assert.equal(result.surfels[0].geometryObservationCount,3)
})

test('stale weakest provisional in a full local bucket is deterministically recycled',()=>{
  const initial=[sample(1,.001,.001,.001),sample(2,.019,.001,.001),sample(3,.001,.019,.001),sample(4,.019,.019,.001)]
  const replacement=[sample(5,.012,.012,.024,{x:0,y:1,z:0})]
  const result=canonical([retainedFrame(initial,1),retainedFrame(replacement,10)])
  assert.equal(result.diagnostics.weakProvisionalsRecycled,1);assert.equal(result.diagnostics.localLayerCapacityRejected,0)
})

test('global provisional capacity recycles stale one-frame noise so a later wall can promote',()=>{
  const frames=[]
  for(let frame=0;frame<38;frame++)frames.push(retainedFrame(Array.from({length:1600},(_,i)=>sample(i,(frame*1600+i)*.09,0,-2)),frame+1))
  const wall=[sample(90000,0,2,-2)]
  frames.push(retainedFrame(wall,100),retainedFrame(wall,101),retainedFrame(wall,102))
  const result=canonical(frames)
  assert.ok(result.diagnostics.weakProvisionalsRecycled>0);assert.ok(result.surfels.some(s=>Math.abs(s.position.y-2)<.001))
  assert.ok(result.diagnostics.provisionalCreated>CANONICAL_REALITY_CONFIG.maxSurfels)
})

test('sparse weak multi-view parallel sheet is rejected without topology evidence',()=>{
  const wall=plane(8),sheet=Array.from({length:9},(_,i)=>sample(2000+i,(i%3-1)*.075,(Math.floor(i/3)-1)*.075,-1.94))
  const result=canonical([retainedFrame([...wall,...sheet],1),retainedFrame([...wall,...sheet],2),retainedFrame([...wall,...sheet],3)])
  assert.equal(result.surfels.filter(s=>s.position.z>-1.97).length,0)
  assert.ok(result.diagnostics.falseParallelLayersCollapsed>0);assert.ok(result.diagnostics.secondLayerClassification.falseDuplicate+result.diagnostics.secondLayerClassification.uncertainParallelLayer>0)
})

test('canonical replay is approximately invariant to legal retained-frame order',()=>{
  const wall=plane(8),frames=[1,2,3,4,5].map(i=>retainedFrame(wall.map((s,j)=>sample(j,s.position.x+(i%2)*.005,s.position.y,s.position.z)),i))
  const normal=canonical(frames),reordered=canonical([frames[2],frames[0],frames[4],frames[1],frames[3]])
  assert.equal(reordered.surfels.length,normal.surfels.length)
  assert.deepEqual(reordered.surfels.slice(0,10).map(s=>[s.position.x,s.position.y,s.position.z]),normal.surfels.slice(0,10).map(s=>[s.position.x,s.position.y,s.position.z]))
})

test('canonical wall thickness stays bounded under low depth and pose noise',()=>{
  const wall=plane(10),frames=Array.from({length:7},(_,i)=>retainedFrame(wall.map((s,j)=>sample(j,s.position.x+Math.sin(j+i)*.003,s.position.y,s.position.z+Math.cos(j*2+i)*.004)),i+1))
  const result=canonical(frames)
  assert.ok(result.diagnostics.wallThicknessP95Meters<.02)
})

test('perpendicular wall and ceiling stay separate canonical surfaces',()=>{
  const wall=plane(8),ceiling=Array.from({length:64},(_,i)=>sample(1000+i,(i%8-4)*.025,.4,(Math.floor(i/8)-4)*.025-2,{x:0,y:-1,z:0})),scene=[...wall,...ceiling]
  const result=canonical([retainedFrame(scene,1),retainedFrame(scene,2),retainedFrame(scene,3)])
  assert.ok(result.surfels.some(s=>Math.abs(s.normal.z)>.8));assert.ok(result.surfels.some(s=>Math.abs(s.normal.y)>.8))
})

test('unsupported disconnected junk expires while repeated small object survives',()=>{
  const wall=plane(8),object=plane(3,-1.8).map((s,i)=>sample(1000+i,s.position.x+.5,s.position.y,s.position.z)),junk=[sample(5000,3,3,-1)]
  const result=canonical([retainedFrame([...wall,...object,...junk],1),retainedFrame([...wall,...object],2,.1),retainedFrame([...wall,...object],3,.2)])
  assert.ok(!result.surfels.some(s=>s.position.x>2));assert.ok(result.surfels.some(s=>s.position.x>.45&&s.position.z>-1.85))
})

test('retained accepted geometry frames are bounded and preserve the full temporal walk',()=>{
  const store=new RetainedRealityMeasurementService(),gate=new RealityMeasurementStabilityService()
  for(let i=1;i<=140;i++){const packet=gate.createPacket(measurementInput(i,i*.03,i*200));store.consider(packet,.9,null)}
  const snapshot=store.createSnapshot();assert.ok(snapshot.frames.length<=RETAINED_REALITY_CONFIG.maxFrames);assert.ok(snapshot.diagnostics.temporalCompactions>0);assert.ok(snapshot.frames.at(-1).sequence>120);assert.ok(snapshot.diagnostics.memoryBytes>0)
  assert.equal(snapshot.diagnostics.retainedColorEvidenceCount,0);assert.equal(snapshot.diagnostics.retainedFrameCoverage.length,snapshot.frames.length);assert.ok(snapshot.diagnostics.compactionReplacements>0)
})
test('retained replay refuses a second tracking epoch instead of spanning incompatible worlds',()=>{
  const store=new RetainedRealityMeasurementService(),gate=new RealityMeasurementStabilityService()
  const first=gate.createPacket(measurementInput(1,0,200)),second=gate.createPacket(measurementInput(2,4,400))
  assert.equal(store.consider(first,.9,null,0),true)
  assert.equal(store.consider(second,.9,null,1),false)
  const snapshot=store.createSnapshot()
  assert.deepEqual(snapshot.diagnostics.trackingEpochIds,[0]);assert.equal(snapshot.diagnostics.trackingEpochCount,1)
  assert.equal(snapshot.diagnostics.incompatibleTrackingStateRejects,1);assert.equal(snapshot.diagnostics.incompatibleTrackingStateSpan,false)
})
test('retained snapshot coverage contributions match unique proxy-cell semantics',()=>{
  const store=new RetainedRealityMeasurementService(),gate=new RealityMeasurementStabilityService()
  for(let i=1;i<=8;i++)store.consider(gate.createPacket(measurementInput(i,i*.03,i*200)),.9,null)
  const snapshot=store.createSnapshot(),expected=snapshot.frames.map((frame)=>frame.coverageProxyKeys.filter((key)=>snapshot.frames.every((other)=>other===frame||!other.coverageProxyKeys.includes(key))).length)
  assert.deepEqual(snapshot.diagnostics.retainedFrameCoverage.map((frame)=>frame.uniqueProxyCellContribution),expected)
})

test('accepted geometry retention is camera-independent and the XR path does not gate it on RGB availability',()=>{
  const store=new RetainedRealityMeasurementService(),gate=new RealityMeasurementStabilityService(),packet=gate.createPacket(measurementInput(1,0,250))
  assert.equal(store.consider(packet,.9,null),true);const snapshot=store.createSnapshot();assert.equal(snapshot.frames.length,1);assert.equal(snapshot.frames[0].srgbColors.length,0);assert.equal(snapshot.diagnostics.samplesRetained,400)
  const xr=readFileSync(new URL('../src/features/scanner/services/xrSessionService.ts',import.meta.url),'utf8')
  assert.match(xr,/Final geometry must not depend on optional raw-camera access/);assert.doesNotMatch(xr,/if \(this\.realityCaptureEnabled\) \{\s*this\.retainedMeasurementService\.consider/)
})

test('live Dense fusion uses a bounded preview budget while canonical retains full input',()=>{
  const service=new DenseRealityReconstructionService(),wall=plane(40)
  feed(service,wall,1,true,{x:0,y:0,z:0},{frameSequence:1,trackingQuality:1,maxInputSamples:200})
  const diagnostics=service.getDiagnostics();assert.equal(diagnostics.liveMaximumSamplesPerFrame,200);assert.ok(diagnostics.liveInputDecimatedSampleCount>=1200);assert.ok(diagnostics.activeSampleCount<=210)
})

test('final reconstruction is dispatched to a dedicated worker and XR never runs canonical replay',()=>{
  const coordinator=readFileSync(new URL('../src/features/scanner/services/postScanCanonicalFusionService.ts',import.meta.url),'utf8')
  const worker=readFileSync(new URL('../src/features/scanner/services/postScanCanonicalFusion.worker.ts',import.meta.url),'utf8')
  const xr=readFileSync(new URL('../src/features/scanner/services/xrSessionService.ts',import.meta.url),'utf8')
  assert.match(coordinator,/new Worker/);assert.match(worker,/CanonicalRealityFusionService/);assert.match(coordinator,/errorName\?: string/);assert.match(coordinator,/errorStack\?: string/);assert.match(worker,/errorName: workerError\?\.name/);assert.match(worker,/errorStack: workerError\?\.stack/);assert.match(xr,/await reconstructCanonicalReality/);assert.doesNotMatch(xr,/new CanonicalRealityFusionService/)
})

test('appearance remains pressure-gated but can resume when XR and queue are healthy',()=>{
  const policy=new RealityQualityPolicy();for(let i=1;i<40;i++){policy.recordFrame(i*20);policy.recordTick(8,3600,3000)}
  assert.equal(policy.shouldCaptureAppearance(0),true);assert.equal(policy.shouldCaptureAppearance(1),false)
})

test('canonical final geometry is immutable and M7/customization are not fusion inputs',()=>{
  const wall=plane(5),result=canonical([retainedFrame(wall,1),retainedFrame(wall,2),retainedFrame(wall,3)])
  assert.ok(Object.isFrozen(result.surfels));assert.ok(Object.isFrozen(result.surfels[0]));assert.ok(Object.isFrozen(result.surfels[0].position))
  const source=readFileSync(new URL('../src/features/scanner/services/canonicalRealityFusionService.ts',import.meta.url),'utf8')
  assert.doesNotMatch(source,/logicalSurface|structuralPatch|paintability|visibleWallMask/)
})

test('M8.7.1.2 bounded live and canonical replay synthetic performance report',()=>{
  const wall=plane(40),full=new DenseRealityReconstructionService(),light=new DenseRealityReconstructionService()
  feed(full,wall,1,true,{x:0,y:0,z:0},{frameSequence:1,trackingQuality:1})
  feed(light,wall,1,true,{x:0,y:0,z:0},{frameSequence:1,trackingQuality:1,maxInputSamples:900})
  const frames=Array.from({length:18},(_,i)=>retainedFrame(wall.map((s,j)=>sample(j,s.position.x+Math.sin(j+i)*.003,s.position.y,s.position.z+Math.cos(j*2+i)*.003)),i+1,i*.04))
  const result=canonical(frames)
  console.log('M8.7.1.6 synthetic reconstruction benchmark',JSON.stringify({fullLiveMs:full.getDiagnostics().fusionMs,lightLiveMs:light.getDiagnostics().fusionMs,liveSamples:light.getDiagnostics().activeSampleCount,retainedFrames:frames.length,input:result.diagnostics.inputObservations,consolidated:result.diagnostics.consolidatedObservations,canonical:result.surfels.length,canonicalWorkerMs:result.diagnostics.workerTimeMs,workerStages:result.diagnostics.workerStageTimingsMs,thicknessP95Mm:result.diagnostics.wallThicknessP95Meters*1000}))
  assert.ok(light.getDiagnostics().fusionMs<full.getDiagnostics().fusionMs);assert.ok(result.surfels.length>1000);assert.ok(result.diagnostics.wallThicknessP95Meters<.02)
})

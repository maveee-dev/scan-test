import type { FinalizedRealitySurfel, SpatialBounds, SpatialPoint } from '../types'
import { findRealityNeighbors } from './realityNeighborSearchService'

export interface RealityConfidenceComponent {
  readonly id: number
  readonly sampleCount: number
  readonly areaEstimateSquareMeters: number
  readonly bounds: SpatialBounds
  readonly stableRatio: number
  readonly viewDiverseRatio: number
  readonly singleViewRatio: number
  readonly trackingQuality: number
  readonly duplicateCandidateRatio: number
  readonly meanConfidence: number
  readonly retained: boolean
  readonly rejectionReason: 'none' | 'tiny-low-confidence' | 'unsupported-duplicate-sheet' | 'unstable-island'
}

export interface RealityRepeatabilityMetrics {
  readonly extentMeters: SpatialPoint
  readonly ceilingHeightEstimateMeters: number | null
  readonly majorComponentCount: number
  readonly stableSampleRatio: number
  readonly lowConfidenceSampleRatio: number
  readonly floatingComponentCount: number
  readonly largestUnsupportedComponentSamples: number
}

export interface RealityConfidenceFilterStats {
  readonly sourceSamples: number
  readonly retainedSamples: number
  readonly stableSamples: number
  readonly lowConfidenceSamples: number
  readonly viewDiverseSamples: number
  readonly singleViewSamples: number
  readonly duplicateCandidates: number
  readonly duplicateCandidatesRejected: number
  readonly connectedComponentCount: number
  readonly floatingComponentsRejected: number
  readonly samplesRemoved: number
  readonly meanPositionStdMeters: number
  readonly meanDepthStdMeters: number
  readonly meanNormalStd: number
  readonly componentAnalysisMs: number
  readonly filterMs: number
  readonly temporaryMemoryBytes: number
  readonly components: readonly RealityConfidenceComponent[]
  readonly repeatability: RealityRepeatabilityMetrics
}

export interface RealityConfidenceFilterResult {
  readonly surfels: readonly FinalizedRealitySurfel[]
  readonly retainedSourceIndices: Uint32Array
  readonly stats: RealityConfidenceFilterStats
}

const dot = (a: SpatialPoint, b: SpatialPoint) => a.x*b.x+a.y*b.y+a.z*b.z
const emptyBounds = (): SpatialBounds => ({ min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } })
const addToBounds = (bounds: SpatialBounds, point: SpatialPoint): void => {
  bounds.min.x=Math.min(bounds.min.x,point.x);bounds.min.y=Math.min(bounds.min.y,point.y);bounds.min.z=Math.min(bounds.min.z,point.z)
  bounds.max.x=Math.max(bounds.max.x,point.x);bounds.max.y=Math.max(bounds.max.y,point.y);bounds.max.z=Math.max(bounds.max.z,point.z)
}
const observedFrames = (s: FinalizedRealitySurfel) => s.geometryObservationCount ?? Math.max(1, s.colorObservationCount)
const timeSpan = (s: FinalizedRealitySurfel) => Math.max(0,(s.lastObservedAt ?? 0)-(s.firstObservedAt ?? s.lastObservedAt ?? 0))
const isStable = (s: FinalizedRealitySurfel) => s.stabilityClass === 'high' || (
  observedFrames(s)>=3 && timeSpan(s)>=250 && (s.trackingQuality ?? 1)>=.55 &&
  Math.sqrt(s.positionVarianceMetersSquared ?? 0)<=.02 && Math.sqrt(s.depthVarianceMetersSquared ?? 0)<=.016
)

/**
 * Post-scan confidence filtering. It never mutates measured Reality, adds
 * geometry, closes holes, or references M7. Components only decide whether an
 * observed sample is sufficiently supported for the production display.
 */
export function filterRealityConfidence(source: readonly FinalizedRealitySurfel[]): RealityConfidenceFilterResult {
  const started=performance.now(), n=source.length
  if(!n)return {surfels:[],retainedSourceIndices:new Uint32Array(),stats:{sourceSamples:0,retainedSamples:0,stableSamples:0,lowConfidenceSamples:0,viewDiverseSamples:0,singleViewSamples:0,duplicateCandidates:0,duplicateCandidatesRejected:0,connectedComponentCount:0,floatingComponentsRejected:0,samplesRemoved:0,meanPositionStdMeters:0,meanDepthStdMeters:0,meanNormalStd:0,componentAnalysisMs:0,filterMs:performance.now()-started,temporaryMemoryBytes:0,components:[],repeatability:{extentMeters:{x:0,y:0,z:0},ceilingHeightEstimateMeters:null,majorComponentCount:0,stableSampleRatio:0,lowConfidenceSampleRatio:0,floatingComponentCount:0,largestUnsupportedComponentSamples:0}}}
  const stable=new Uint8Array(n), componentId=new Int32Array(n);componentId.fill(-1)
  let stableSamples=0,viewDiverse=0,singleView=0,duplicates=0
  source.forEach((s,i)=>{if(isStable(s)){stable[i]=1;stableSamples++}if((s.viewObservationCount??1)>=2)viewDiverse++;else singleView++;if(s.duplicateSurfaceCandidate)duplicates++})
  const componentStarted=performance.now()
  const search=findRealityNeighbors(source,.07,14,(a,b)=>{
    if(Math.abs(dot(a.normal,b.normal))<.72)return false
    const delta={x:b.position.x-a.position.x,y:b.position.y-a.position.y,z:b.position.z-a.position.z}
    return Math.abs(dot(delta,a.normal))<.035&&Math.abs(dot(delta,b.normal))<.035
  })
  const members:number[][]=[]
  for(let seed=0;seed<n;seed++)if(componentId[seed]<0){const id=members.length,list:number[]=[],queue=[seed];componentId[seed]=id
    for(let head=0;head<queue.length;head++){const current=queue[head];list.push(current);for(const neighbor of search.neighbors[current])if(componentId[neighbor.index]<0){componentId[neighbor.index]=id;queue.push(neighbor.index)}}members.push(list)}
  const largestSize=Math.max(...members.map((m)=>m.length)), components:RealityConfidenceComponent[]=[], keep=new Uint8Array(n)
  let duplicateRejected=0,floatingRejected=0,largestUnsupported=0
  members.forEach((list,id)=>{let stableCount=0,diverseCount=0,tracking=0,duplicateCount=0,confidence=0;const bounds=emptyBounds()
    for(const index of list){const s=source[index];stableCount+=stable[index];diverseCount+=(s.viewObservationCount??1)>=2?1:0;tracking+=s.trackingQuality??1;duplicateCount+=s.duplicateSurfaceCandidate?1:0;confidence+=s.geometryConfidence;addToBounds(bounds,s.position)}
    const count=list.length,stableRatio=stableCount/count,diverseRatio=diverseCount/count,duplicateRatio=duplicateCount/count,meanTracking=tracking/count,meanConfidence=confidence/count
    const span={x:bounds.max.x-bounds.min.x,y:bounds.max.y-bounds.min.y,z:bounds.max.z-bounds.min.z}
    const area=Math.max(.000625,count*.000625*.72)
    const tiny=count<10&&stableCount<3&&diverseCount===0
    const duplicateSheet=duplicateRatio>.55&&stableRatio<.35&&diverseRatio<.25
    const detached=count<Math.max(20,largestSize*.0025)&&stableRatio<.2&&diverseRatio<.1&&meanConfidence<.72
    const rejected=tiny||duplicateSheet||detached
    const reason:RealityConfidenceComponent['rejectionReason']=tiny?'tiny-low-confidence':duplicateSheet?'unsupported-duplicate-sheet':detached?'unstable-island':'none'
    if(rejected){floatingRejected++;largestUnsupported=Math.max(largestUnsupported,count);if(duplicateSheet)duplicateRejected+=duplicateCount}else for(const index of list){
      const s=source[index]
      // A component can be real while an individual one-frame point is not.
      // Retain provisional points only next to supported geometry and never a
      // sample explicitly marked as an unsupported duplicate layer.
      const locallySupported=search.neighbors[index].filter((v)=>stable[v.index]).length>=2
      if(stable[index]||((observedFrames(s)>=2||locallySupported)&&(!s.duplicateSurfaceCandidate||stableRatio>=.35||diverseRatio>=.25)))keep[index]=1
    }
    components.push({id,sampleCount:count,areaEstimateSquareMeters:area,bounds,stableRatio,viewDiverseRatio:diverseRatio,singleViewRatio:1-diverseRatio,trackingQuality:meanTracking,duplicateCandidateRatio:duplicateRatio,meanConfidence,retained:!rejected,rejectionReason:reason})
    void span
  })
  const retained:number[]=[],indices:number[]=[]
  for(let i=0;i<n;i++)if(keep[i]){retained.push(i);indices.push(i)}
  const retainedSurfels=retained.map((i)=>source[i]), bounds=emptyBounds();retainedSurfels.forEach((s)=>addToBounds(bounds,s.position))
  const extent=retainedSurfels.length?{x:bounds.max.x-bounds.min.x,y:bounds.max.y-bounds.min.y,z:bounds.max.z-bounds.min.z}:{x:0,y:0,z:0}
  const horizontal=retainedSurfels.filter((s)=>Math.abs(s.normal.y)>.86).map((s)=>s.position.y).sort((a,b)=>a-b)
  const ceiling=horizontal.length>20?horizontal[Math.floor(horizontal.length*.9)]-horizontal[Math.floor(horizontal.length*.1)]:null
  const low=n-stableSamples, componentAnalysisMs=performance.now()-componentStarted
  const meanPositionStd=source.reduce((sum,s)=>sum+Math.sqrt(s.positionVarianceMetersSquared??0),0)/n,meanDepthStd=source.reduce((sum,s)=>sum+Math.sqrt(s.depthVarianceMetersSquared??0),0)/n,meanNormalStd=source.reduce((sum,s)=>sum+Math.sqrt(s.normalVariance??0),0)/n
  const stats:RealityConfidenceFilterStats={sourceSamples:n,retainedSamples:retainedSurfels.length,stableSamples,lowConfidenceSamples:low,viewDiverseSamples:viewDiverse,singleViewSamples:singleView,duplicateCandidates:duplicates,duplicateCandidatesRejected:duplicateRejected,connectedComponentCount:members.length,floatingComponentsRejected:floatingRejected,samplesRemoved:n-retainedSurfels.length,meanPositionStdMeters:meanPositionStd,meanDepthStdMeters:meanDepthStd,meanNormalStd,componentAnalysisMs,filterMs:performance.now()-started,temporaryMemoryBytes:stable.byteLength+componentId.byteLength+keep.byteLength+indices.length*4,components,repeatability:{extentMeters:extent,ceilingHeightEstimateMeters:ceiling,majorComponentCount:components.filter((c)=>c.retained&&c.sampleCount>=Math.max(50,largestSize*.02)).length,stableSampleRatio:stableSamples/n,lowConfidenceSampleRatio:low/n,floatingComponentCount:floatingRejected,largestUnsupportedComponentSamples:largestUnsupported}}
  return {surfels:retainedSurfels,retainedSourceIndices:Uint32Array.from(indices),stats}
}

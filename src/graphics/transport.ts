import { Vector3 } from 'three/webgpu';
import type { PerspectiveCamera } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import type { RefractiveLightField } from './refractive-light.js';

/** Compact cage snapshots feed an optical proxy; one request in flight, no backlog. */
export class OpticalTransport {
  private worker:Worker;
  private pending:{resolve:()=>void;reject:(e:Error)=>void}|null=null;
  private tracedCenter:number[]|null=null;
  private tracedOrigin=[0,0];
  private disposed=false;
  private lastRevision=-1;
  private nextRequestAt=0;
  private lastCamera=new Vector3(Infinity,Infinity,Infinity);
  readonly optics:RefractiveLightField;
  readonly body:SoftBody;
  readonly camera:PerspectiveCamera;
  constructor(optics:RefractiveLightField,body:SoftBody,camera:PerspectiveCamera,direction:Vector3,sigma:number[],fail:(error:Error)=>void) {
    this.optics=optics;this.body=body;this.camera=camera;
    this.worker=new Worker(new URL('./transport.worker.ts',import.meta.url),{type:'module'});
    const surface=body.cage.opticalSurface;
    this.worker.postMessage({type:'init',indices:surface.indices,positions:surface.positions,
      restNormals:surface.restNormals,bindingIds:surface.bindingIds,bindingWeights:surface.bindingWeights,direction:direction.toArray(),sigma});
    this.worker.onmessage=({data})=>{
      if(this.disposed)return;
      if(data.error){const error=new Error(`Light transport: ${data.error}`);this.pending?.reject(error);this.pending=null;fail(error);return;}
      if(data.light) {
        optics.lightBytes.set(data.light);optics.shadowBytes.set(data.shadow);
        optics.lightTexture.needsUpdate=true;optics.shadowTexture.needsUpdate=true;
        optics.span=data.span;optics.spanNode.value=data.span;
        this.tracedCenter=data.center;this.tracedOrigin=data.origin;this.follow();
        return; // Publish light immediately; thickness arrives separately.
      }
      const out=body.surface.geometry.attributes.opticalThickness.array,ids=body.cage.thicknessIds,weights=body.cage.thicknessWeights;
      for(let i=0,j=0;i<out.length;i++,j+=3)out[i]=data.thickness[ids[j]]*weights[j]+data.thickness[ids[j+1]]*weights[j+1]+data.thickness[ids[j+2]]*weights[j+2];
      body.surface.geometry.attributes.opticalThickness.needsUpdate=true;
      this.pending?.resolve();this.pending=null;
    };
    this.worker.onerror=event=>{
      const error=new Error(`Light transport worker: ${event.message}`);
      this.pending?.reject(error);this.pending=null;fail(error);
    };
  }
  update():Promise<void> {
    if(this.pending||this.disposed)return Promise.resolve();
    if(this.lastRevision===this.body.surfaceRevision&&this.lastCamera.distanceToSquared(this.camera.position)<1e-10)return Promise.resolve();
    const now=performance.now();if(now<this.nextRequestAt)return Promise.resolve();
    this.nextRequestAt=now+1000/30;
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject};
      const shapeChanged=this.lastRevision!==this.body.surfaceRevision;
      this.lastRevision=this.body.surfaceRevision;this.lastCamera.copy(this.camera.position);
      const particles=shapeChanged?this.body.x.slice():null,nodalF=shapeChanged?this.body.nodalF.slice():null;
      this.worker.postMessage({type:'frame',particles,nodalF,center:this.body.center.toArray(),camera:this.camera.position.toArray()},
        particles?[particles.buffer,nodalF!.buffer]:[]);
    });
  }
  follow() {
    if(!this.tracedCenter)return;
    // Remove translation latency without animating or inventing a caustic pattern.
    this.optics.origin.set(this.tracedOrigin[0]+this.body.center.x-this.tracedCenter[0],
      this.tracedOrigin[1]+this.body.center.z-this.tracedCenter[2]);
    // A vertical translation moves a directional shadow by -dy * D.xz / D.y.
    // Contact/caustic lookup retains its own origin; don't slide contact with the shadow.
    const dy=this.body.center.y-this.tracedCenter[1],d=this.optics.lightDirection;
    this.optics.shadowOrigin.copy(this.optics.origin).sub({x:dy*d.x/d.y,y:dy*d.z/d.y});
  }
  dispose(){this.disposed=true;this.pending?.resolve();this.pending=null;this.worker.terminate();}
}

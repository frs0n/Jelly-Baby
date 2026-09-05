import type { PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import type { RefractiveLightField } from './refractive-light.js';

/** Same reference transport, on a dedicated worker; one in-flight snapshot, no backlog. */
export class OpticalTransport {
  private worker:Worker;
  private pending:{resolve:()=>void;reject:(e:Error)=>void}|null=null;
  private tracedCenter:number[]|null=null;
  private tracedOrigin=[0,0];
  private disposed=false;
  readonly optics:RefractiveLightField;
  readonly body:SoftBody;
  readonly camera:PerspectiveCamera;
  constructor(optics:RefractiveLightField,body:SoftBody,camera:PerspectiveCamera,direction:Vector3,sigma:number[],fail:(error:Error)=>void) {
    this.optics=optics;this.body=body;this.camera=camera;
    this.worker=new Worker(new URL('./transport.worker.ts',import.meta.url),{type:'module'});
    this.worker.postMessage({type:'init',vertexCount:body.surface.positions.length/3,
      indices:body.surface.indices,positions:body.surface.positions,direction:direction.toArray(),sigma});
    this.worker.onmessage=({data})=>{
      if(this.disposed)return;
      if(data.error){const error=new Error(`Light transport: ${data.error}`);this.pending?.reject(error);this.pending=null;fail(error);return;}
      optics.lightBytes.set(data.light);optics.shadowBytes.set(data.shadow);
      optics.lightTexture.needsUpdate=true;optics.shadowTexture.needsUpdate=true;
      optics.span=data.span;optics.spanNode.value=data.span;
      this.tracedCenter=data.center;this.tracedOrigin=data.origin;this.follow();
      body.surface.geometry.attributes.opticalThickness.array.set(data.thickness);
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
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject};
      const positions=this.body.surface.positions.slice();
      const normals=new Float32Array(this.body.surface.geometry.attributes.normal.array);
      this.worker.postMessage({type:'frame',positions,normals,center:this.body.center.toArray(),camera:this.camera.position.toArray()},
        [positions.buffer,normals.buffer]);
    });
  }
  follow() {
    if(!this.tracedCenter)return;
    // Remove translation latency without animating or inventing a caustic pattern.
    this.optics.origin.set(this.tracedOrigin[0]+this.body.center.x-this.tracedCenter[0],
      this.tracedOrigin[1]+this.body.center.z-this.tracedCenter[2]);
  }
  dispose(){this.disposed=true;this.pending?.resolve();this.pending=null;this.worker.terminate();}
}

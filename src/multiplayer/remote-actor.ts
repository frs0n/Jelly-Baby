import { ImpactResponse } from './impact-response.ts';
import * as THREE from 'three/webgpu';
import { parseBabyCage, type BabyModel } from '../physics/baby-cage.ts';
import { SoftBody } from '../physics/soft-body.js';
import { Baby } from '../graphics/baby.ts';
import { Locomotion } from '../game/locomotion.ts';
import { FixedStepper } from '../game/fixed-step.ts';
import { PHYS } from '../physics/constants.js';
import { advanceGrabTarget } from '../physics/grab.ts';
import { bindSkin, removeGrip, type SkinGrip } from './skin-grip.ts';
import { ReachingHand, type Reach } from './reaching-hand.ts';
import { reconcile } from './reconcile.ts';
import type { Player } from './simulation.ts';
import type { Point } from './grabs.ts';

export type ActorFrame={buffer:ArrayBuffer;lengths:number[];bounds:number[][];root:Point;center:Point;gripPoint:Point|null;handPoint:Point|null;physicsSteps:number};
export class RemoteActor {
  readonly body:SoftBody;
  readonly rig:Locomotion;
  readonly baby:Baby;
  readonly hand:ReachingHand;
  private clock=new FixedStepper(1/120);
  private meshes:THREE.Mesh[]=[];
  private grip:SkinGrip|null=null;
  private by='';
  private restY:number;
  private previousY=0;
  private impacts=new ImpactResponse();
  private initialized=false;
  constructor(model:BabyModel) {
    this.body=new SoftBody(parseBabyCage(model.buffer,model.manifest,true));
    this.rig=new Locomotion(this.body);this.baby=new Baby(this.body);this.hand=new ReachingHand(this.body);
    for(let i=0;i<80;i++){this.rig.step(PHYS.step);this.body.step(PHYS.step);}
    this.body.updateSurface();this.baby.update();this.restY=this.body.center.y;
    this.baby.group.traverse(object=>{if(object instanceof THREE.Mesh)this.meshes.push(object);});
  }
  advance(dt:number,state:Player,reach:Reach|null,buffer?:ArrayBuffer):ActorFrame {
    const b=this.body;
    if(!this.initialized) {
      const dx=state.x-b.center.x,dz=state.z-b.center.z;
      for(let i=0;i<b.x.length;i+=3){b.x[i]+=dx;b.x[i+1]+=state.y;b.x[i+2]+=dz;b.previous[i]+=dx;b.previous[i+1]+=state.y;b.previous[i+2]+=dz;}
      b.updateSurface();this.rig.yaw=state.yaw;b.wake();this.initialized=true;
    }
    const g=state.grab;
    if(g) {
      if(!this.grip||this.by!==g.by) {
        if(this.grip)removeGrip(b,this.grip);this.hand.clear();
        this.grip=bindSkin(b,new THREE.Vector3(state.x+g.anchor.x,state.y+g.anchor.y,state.z+g.anchor.z));
        b.grabs.push(this.grip);this.by=g.by;b.wake();
      }
    }else if(this.grip){removeGrip(b,this.grip);this.grip=null;this.by='';}
    this.rig.move.set(state.vx/.145,0,state.vz/.145).clampLength(0,1);
    if(Math.hypot(state.vx,state.vz)<.003)this.rig.move.set(0,0,0);
    if(state.y>0&&this.previousY===0&&state.vy>0&&!g)this.rig.jump();
    this.impacts.update(b,this.rig,state);this.previousY=state.y;
    const h=this.clock.step;
    const steps=this.clock.advance(dt,()=>{
      if(this.grip&&g)advanceGrabTarget(this.grip.target,new THREE.Vector3(g.target.x,g.target.y,g.target.z),h,this.grip.point);
      this.hand.update(reach,this.rig.yaw,h);
      this.rig.step(h);b.step(h);this.rig.afterStep();
    });
    reconcile(b,state,this.restY,0,dt);
    if(b.surfaceDirty)b.updateSurface();
    if(!b.isFinite())throw new Error('Remote soft-body simulation is not finite');
    this.baby.update(dt);
    const lengths=this.meshes.map(mesh=>mesh.geometry.attributes.position.array.length);
    const bytes=lengths.reduce((sum,length)=>sum+length*8,0);
    const packed=buffer&&buffer.byteLength===bytes?buffer:new ArrayBuffer(bytes);
    let offset=0;const bounds:number[][]=[];
    for(const mesh of this.meshes) {
      const geometry=mesh.geometry,p=geometry.attributes.position.array,n=geometry.attributes.normal.array;
      new Float32Array(packed,offset,p.length).set(p);offset+=p.length*4;
      new Float32Array(packed,offset,n.length).set(n);offset+=n.length*4;
      // Surface embedding already computes the large skin bounds in one pass.
      if(mesh!==this.baby.mesh){geometry.computeBoundingBox();geometry.computeBoundingSphere();}
      const box=geometry.boundingBox!,sphere=geometry.boundingSphere!;
      bounds.push([...box.min.toArray(),...box.max.toArray(),...sphere.center.toArray(),sphere.radius]);
    }
    const point=(v:THREE.Vector3):Point=>({x:v.x,y:v.y,z:v.z});
    return {buffer:packed,lengths,bounds,root:{x:state.x,y:state.y,z:state.z},center:point(b.center),gripPoint:this.grip?point(this.grip.point):null,handPoint:this.hand.tip?point(this.hand.tip):null,physicsSteps:steps};
  }
  dispose(){this.hand.clear();this.baby.dispose();this.body.cage.opticalSurface.geometry.dispose();}
}

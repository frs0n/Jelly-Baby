import { Vector3 } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { bindSkin, removeGrip, type SkinGrip } from './skin-grip.ts';
import { advanceGrabTarget } from '../physics/grab.ts';
import type { Point } from './grabs.ts';
export type Reach={hand:-1|1;target:Point};

/** Stretch the existing hand through FEM constraints, with the feet supporting the body. */
export class ReachingHand {
  private body:SoftBody;
  private grips:SkinGrip[]=[];
  private side=0;
  constructor(body:SoftBody){this.body=body;}
  update(reach:Reach|null,yaw:number,dt:number) {
    const b=this.body;
    if(!reach||b.grabs.some((g:SkinGrip)=>!g.cosmetic)){this.clear();return;}
    if(this.side!==reach.hand||this.grips.some(g=>!b.grabs.includes(g))||!this.grips.length) {
      this.clear();this.side=reach.hand;
      const co=Math.cos(yaw),si=Math.sin(yaw);
      const world=(x:number,y:number,z:number)=>new Vector3(b.center.x+x*co+z*si,y,b.center.z+z*co-x*si);
      const hand=bindSkin(b,world(reach.hand*.046,b.center.y+.004,0));
      // Repeated compliant bindings distribute enough force to extend the hand,
      // while two planted feet keep the puller's torso at its own location.
      this.grips=[hand,{...hand,point:hand.point.clone(),target:hand.target.clone(),lambda:new Float64Array(3)},
        bindSkin(b,world(-.012,.005,0)),bindSkin(b,world(.012,.005,0))];
      for(const grip of this.grips){grip.cosmetic=true;b.grabs.push(grip);}b.wake();
    }
    const target=new Vector3(reach.target.x,reach.target.y,reach.target.z);
    for(const grip of this.grips.slice(0,2))advanceGrabTarget(grip.target,target,dt,grip.point);
  }
  get tip(){return this.grips[0]?.point??null;}
  clear(){for(const grip of this.grips)removeGrip(this.body,grip);this.grips=[];this.side=0;}
}

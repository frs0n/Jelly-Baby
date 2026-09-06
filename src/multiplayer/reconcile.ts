import type { SoftBody } from '../physics/soft-body.js';
import type { Player } from './simulation.ts';

/** Correct meaningful authority drift without waking the FEM solver for resting noise. */
export function reconcile(body:SoftBody,p:Player,restY:number,age:number,dt:number) {
  if(body.grab)return false;
  const ahead=Math.min(.15,Math.max(0,age));
  const dx=p.x+p.vx*ahead-body.center.x,dz=p.z+p.vz*ahead-body.center.z;
  // Local ground contact and the local jump already solve Y. Never pin a settled
  // jelly to an estimated rest height or pull an early local hop back to the floor.
  const dy=p.y>0?Math.max(0,p.y+p.vy*ahead-1.2*ahead*ahead)+restY-body.center.y:0;
  const horizontal=Math.hypot(dx,dz),vertical=Math.abs(dy);
  if(horizontal<.008&&vertical<.012)return false;
  const blend=horizontal>.18||vertical>.18?1:1-Math.exp(-5*dt);
  const x=horizontal>=.008?dx*blend:0,z=horizontal>=.008?dz*blend:0,y=vertical>=.012?dy*blend:0;
  for(let i=0;i<body.x.length;i+=3){body.x[i]+=x;body.x[i+1]+=y;body.x[i+2]+=z;body.previous[i]+=x;body.previous[i+1]+=y;body.previous[i+2]+=z;}
  body.updateCenter();body.surfaceDirty=true;body.wake();return true;
}

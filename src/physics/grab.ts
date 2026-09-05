import { Plane, Triangle, Vector3 } from 'three/webgpu';
import type { Ray } from 'three/webgpu';
import type { SoftBody } from './soft-body.js';

export function surfaceGrab(body:SoftBody,face:{a:number;b:number;c:number},point:Vector3) {
  const p=body.surface.positions,{a,b,c}=face;
  const tri=new Triangle(new Vector3().fromArray(p,a*3),new Vector3().fromArray(p,b*3),new Vector3().fromArray(p,c*3));
  const bary=tri.getBarycoord(point,new Vector3());
  if(!bary)return null;
  const weights=new Map<number,number>();
  for(const [surfaceId,w] of [[a,bary.x],[b,bary.y],[c,bary.z]])
    for(const [id,value] of body.surface.stencils[surfaceId])weights.set(id,(weights.get(id)||0)+w*value);
  const list=[...weights].filter(([,w])=>w>1e-12),sum=list.reduce((total,[,w])=>total+w,0);
  if(!Number.isFinite(sum)||sum<=0)return null;
  list.forEach(pair=>pair[1]/=sum);
  const anchor=new Vector3();
  for(const [id,w] of list){anchor.x+=body.x[id*3]*w;anchor.y+=body.x[id*3+1]*w;anchor.z+=body.x[id*3+2]*w;}
  // Float32 render positions vs Float64 mechanics may differ by micrometres,
  // but a visible mismatch means the hit/stencils refer to different geometry.
  if(anchor.distanceTo(point)>.00002)throw new Error('Grab surface and physics binding disagree');
  return {weights:list,target:anchor.clone(),point:anchor.clone(),lambda:new Float64Array(3)};
}

const floorPlane=new Plane(new Vector3(0,1,0),-.0003);
/** Keep the target on the pointer ray even when dragging into the table. */
export function projectGrabTarget(ray:Ray,dragPlane:Plane,out:Vector3) {
  if(!ray.intersectPlane(dragPlane,out))return false;
  if(out.y<.0003)return ray.intersectPlane(floorPlane,out)!==null;
  return true;
}

// The pointer itself may jump arbitrarily far in one browser event. Keep that
// command, but never let the XPBD servo accumulate enough lead to sit at its
// force clamp indefinitely. Normal/local dragging stays on the original fast
// 85 s^-1 / 1.8 m/s response; only pathological lead is bounded.
export const MAX_RAW_GRAB_LEAD=.14;
export const MAX_SOLVER_GRAB_LEAD=.022;

export function advanceGrabTarget(target:Vector3,desired:Vector3,h:number,actual?:Vector3) {
  let desiredX=desired.x,desiredY=desired.y,desiredZ=desired.z;
  if(actual) {
    const ax=desiredX-actual.x,ay=desiredY-actual.y,az=desiredZ-actual.z;
    const ad=Math.hypot(ax,ay,az);
    if(ad>MAX_RAW_GRAB_LEAD) {
      const s=MAX_RAW_GRAB_LEAD/ad;
      desiredX=actual.x+ax*s;desiredY=actual.y+ay*s;desiredZ=actual.z+az*s;
    }
  }
  const dx=desiredX-target.x,dy=desiredY-target.y,dz=desiredZ-target.z;
  const distance=Math.hypot(dx,dy,dz);
  if(distance>0) {
    // The force-limited XPBD grip supplies compliance; don't hide it behind a slow pointer.
    const fraction=Math.min(1-Math.exp(-85*h),1.8*h/distance);
    target.x+=dx*fraction;target.y+=dy*fraction;target.z+=dz*fraction;
  }
  if(actual) {
    const lx=target.x-actual.x,ly=target.y-actual.y,lz=target.z-actual.z;
    const lead=Math.hypot(lx,ly,lz);
    if(lead>MAX_SOLVER_GRAB_LEAD) {
      const s=MAX_SOLVER_GRAB_LEAD/lead;
      target.x=actual.x+lx*s;target.y=actual.y+ly*s;target.z=actual.z+lz*s;
    }
  }
}

/**
 * A heavily backtracked orientation step means the requested servo force was
 * not feasible for this configuration. Rewind only the servo lead; never touch
 * the pointer command or the jelly state. The next 240 Hz step can then recover
 * and immediately resume chasing the same pointer position.
 */
export function recoverGrabTarget(target:Vector3,actual:Vector3,acceptedFraction:number) {
  if(acceptedFraction>=.5)return;
  const keep=Math.max(0,Math.min(1,acceptedFraction*2));
  target.x=actual.x+(target.x-actual.x)*keep;
  target.y=actual.y+(target.y-actual.y)*keep;
  target.z=actual.z+(target.z-actual.z)*keep;
}

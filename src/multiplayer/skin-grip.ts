import { Vector3 } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import type { surfaceGrab } from '../physics/grab.ts';
export type SkinGrip=NonNullable<ReturnType<typeof surfaceGrab>>&{cosmetic?:boolean};
/** Bind the actual visible surface to its original FEM stencil. */
export function bindSkin(body:SoftBody,desired:Vector3):SkinGrip {
  let nearest=0,distance=Infinity;
  const positions=body.surface.positions;
  for(let i=0;i<positions.length;i+=3){const d=(positions[i]-desired.x)**2+(positions[i+1]-desired.y)**2+(positions[i+2]-desired.z)**2;if(d<distance){distance=d;nearest=i/3;}}
  const weights=body.surface.stencils[nearest].map(([id,w]:[number,number])=>[id,w] as [number,number]);
  const point=new Vector3();for(const [id,w] of weights)point.addScaledVector(new Vector3().fromArray(body.x,id*3),w);
  return {weights,point,target:point.clone(),lambda:new Float64Array(3)};
}
export function removeGrip(body:SoftBody,grip:SkinGrip){const index=body.grabs.indexOf(grip);if(index>=0)body.grabs.splice(index,1);}

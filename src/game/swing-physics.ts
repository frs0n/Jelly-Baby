import { Vector3 } from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { PHYS } from '../physics/constants.js';

// Metres, matching the 7 cm confection and the existing simulation's gravity.
export const SWING={x:-.155,z:-.035,height:.172,length:.128,width:.108,maxAngle:.85};

/** Nonlinear driven pendulum; a compliant rider remains in the FEM solver. */
export class SwingPhysics {
  angle=0;
  speed=0;
  riding=false;
  private elapsed=0;
  private readonly target=new Vector3();
  readonly body:SoftBody;
  constructor(body:SoftBody) {this.body=body;}
  get nearby() {
    return !this.body.grab&&this.body.grounded&&Math.hypot(this.body.center.x-SWING.x,this.body.center.z-SWING.z)<.105;
  }
  toggle() {
    if(this.riding){this.leave();return true;}
    if(!this.nearby)return false;
    this.riding=true;this.elapsed=0;
    // Board at the current seat position, including an empty swing still coasting.
    for(let i=0;i<this.body.mass.length;i++) {
      this.riderTarget(i,this.target);
      this.body.x.set(this.target.toArray(),i*3);
      this.body.velocity[i*3]=0;
      this.body.velocity[i*3+1]=this.speed*(this.target.z-SWING.z);
      this.body.velocity[i*3+2]=-this.speed*(this.target.y-SWING.height);
    }
    this.body.previous.set(this.body.x);this.body.wake();this.body.updateCenter();this.body.surfaceDirty=true;
    return true;
  }
  leave() {
    // A deliberate step off onto the clear approach side, outside the swept arc.
    // Undo the seat frame while retaining the jelly's current elastic deformation.
    const b=this.body,c=Math.cos(this.angle),s=Math.sin(this.angle);
    let low=Infinity;
    for(let i=0;i<b.mass.length;i++) {
      const j=i*3,y=b.x[j+1]-SWING.height,z=b.x[j+2]-SWING.z;
      b.x[j]+=.13;b.x[j+1]=c*y-s*z+SWING.length;
      b.x[j+2]=SWING.z+s*y+c*z;
      low=Math.min(low,b.x[j+1]);
    }
    for(let j=1;j<b.x.length;j+=3)b.x[j]+=PHYS.floor+.003-low;
    b.previous.set(b.x);b.velocity.fill(0);b.wake();b.updateCenter();b.surfaceDirty=true;
    this.riding=false;
  }
  reset() {this.riding=false;this.angle=0;this.speed=0;this.elapsed=0;}
  private riderTarget(i:number,out:Vector3) {
    const r=this.body.rest,j=i*3;
    const y=r[j+1]+.004-SWING.length,z=r[j+2];
    const c=Math.cos(this.angle),s=Math.sin(this.angle);
    out.set(SWING.x+r[j],SWING.height+c*y+s*z,SWING.z-s*y+c*z);
  }
  step(h:number) {
    this.elapsed+=h;
    const frequency=PHYS.gravity/SWING.length;
    const energy=.5*this.speed*this.speed+frequency*(1-Math.cos(this.angle));
    const amplitude=SWING.maxAngle*(1-Math.exp(-this.elapsed/7));
    const targetEnergy=frequency*(1-Math.cos(amplitude));
    // Pump in phase with motion; remove energy smoothly above the target.
    const drive=this.riding?Math.max(-2,Math.min(2,(targetEnergy-energy)*.9)):0;
    const kick=this.riding&&this.elapsed<.6?.35:0;
    this.speed+=(-frequency*Math.sin(this.angle)-.18*this.speed+drive*this.speed+kick)*h;
    this.angle+=this.speed*h;
    // Conservative energy ceiling prevents overshoot without clipping turning points.
    const ceiling=frequency*(1-Math.cos(SWING.maxAngle));
    const kinetic=ceiling-frequency*(1-Math.cos(this.angle));
    if(.5*this.speed*this.speed>kinetic)this.speed=Math.sign(this.speed)*Math.sqrt(Math.max(0,2*kinetic));
    if(!this.riding)return;
    const b=this.body;b.canSleep=false;b.wake();
    for(let i=0;i<b.mass.length;i++) {
      const j=i*3;this.riderTarget(i,this.target);
      const y=this.target.y-SWING.height,z=this.target.z-SWING.z;
      // Strong support at feet, progressively freer torso and crown. Inertia and
      // the volume-preserving solver produce the wobble, rather than mesh scaling.
      const support=Math.max(0,1-b.rest[j+1]/.027);
      const stiffness=650+support*6500,damping=22+support*65;
      b.velocity[j]+=(stiffness*(this.target.x-b.x[j])-damping*b.velocity[j])*h;
      b.velocity[j+1]+=(stiffness*(this.target.y-b.x[j+1])-damping*(b.velocity[j+1]-this.speed*z))*h;
      b.velocity[j+2]+=(stiffness*(this.target.z-b.x[j+2])-damping*(b.velocity[j+2]+this.speed*y))*h;
    }
  }
}

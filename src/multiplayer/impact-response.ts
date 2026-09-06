import type { SoftBody } from '../physics/soft-body.js';
import type { Locomotion } from '../game/locomotion.ts';
import type { Player, Impact } from './simulation.ts';

/** Numbered contacts survive snapshot throttling and are applied exactly once. */
export class ImpactResponse {
  private sequence=0;
  private player='';
  update(body:SoftBody,rig:Locomotion,player:Player) {
    if(this.player!==player.id){this.player=player.id;this.sequence=0;}
    for(const impact of player.impacts) {
      if(impact.seq<=this.sequence)continue;
      this.sequence=impact.seq;this.apply(body,rig,impact);
    }
  }
  private apply(body:SoftBody,rig:Locomotion,hit:Impact) {
    const {nx,nz,speed}=hit;
    let bottom=Infinity;
    for(let j=1;j<body.x.length;j+=3)bottom=Math.min(bottom,body.x[j]);
    const cx=body.center.x-nx*.022,cz=body.center.z-nz*.022,cy=bottom+hit.height;
    const weights=new Float64Array(body.mass.length);let mass=0,nearest=Infinity;
    for(let i=0;i<weights.length;i++) {
      const j=i*3,d2=(body.x[j]-cx)**2+(body.x[j+1]-cy)**2+(body.x[j+2]-cz)**2;
      weights[i]=d2;nearest=Math.min(nearest,d2);
    }
    for(let i=0;i<weights.length;i++){weights[i]=Math.exp(-(weights[i]-nearest)/(2*.017**2));mass+=weights[i]*body.mass[i];}
    // Localized contact compression excites the existing volume/shear solver.
    // The upper-body contact also delivers angular momentum, allowing a real fall.
    const impulse=Math.min(.30,speed*.5),spin=Math.max(0,speed-.10)*48;
    for(let i=0;i<weights.length;i++) {
      const j=i*3,weight=Math.min(8,weights[i]*body.totalMass/mass);
      const rx=body.x[j]-body.center.x,ry=body.x[j+1]-body.center.y,rz=body.x[j+2]-body.center.z;
      body.velocity[j]+=nx*(impulse*weight+spin*ry);
      body.velocity[j+1]-=spin*(nx*rx+nz*rz);
      body.velocity[j+2]+=nz*(impulse*weight+spin*ry);
    }
    rig.stumble(speed);rig.onContact(speed,false);body.wake();
  }
}

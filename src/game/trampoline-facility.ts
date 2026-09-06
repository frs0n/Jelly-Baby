import { Box3, Vector3, type Scene } from 'three/webgpu';
import type { FacilityShadows } from '../graphics/facility-shadows.ts';
import type { SoftBody } from '../physics/soft-body.js';
import { Trampoline } from '../graphics/trampoline.ts';
import { TRAMPOLINE, TrampolinePhysics } from './trampoline-physics.ts';
import type { Facility } from './facilities.ts';
import { FACILITY_TRAMPOLINE } from '../multiplayer/facility-state.ts';
import { FacilityMotionSound, type FacilitySoundSink } from './facility-sound.ts';

export class TrampolineFacility implements Facility {
  readonly id='spawn-trampoline';
  readonly facility=FACILITY_TRAMPOLINE;
  readonly label='Trampoline';
  readonly cameraDistance=.30;
  readonly physics:TrampolinePhysics;
  private readonly visual=new Trampoline();
  private laughStarted=false;
  private readonly audio:FacilityMotionSound;
  constructor(scene:Scene,body:SoftBody,shadows:FacilityShadows,sound:FacilitySoundSink=()=>{}) {
    this.audio=new FacilityMotionSound(sound,{x:TRAMPOLINE.x,y:TRAMPOLINE.height,z:TRAMPOLINE.z});
    this.physics=new TrampolinePhysics(body);scene.add(this.visual.group);
    shadows.add(this.visual.group,new Box3(
      new Vector3(TRAMPOLINE.x-.105,0,TRAMPOLINE.z-.105),
      new Vector3(TRAMPOLINE.x+.105,TRAMPOLINE.height+.015,TRAMPOLINE.z+.105),
    ));
  }
  get active() {return this.physics.active;}
  get phase() {return this.physics.phase;}
  setRemote(phase?:number) {this.physics.setRemotePhase(phase);}
  get laughing() {return this.active&&this.laughStarted;}
  get interactionDistance() {
    return this.physics.nearby?Math.hypot(this.physics.body.center.x-TRAMPOLINE.x,this.physics.body.center.z-TRAMPOLINE.z):Infinity;
  }
  interact() {const changed=this.physics.toggle();if(changed){this.laughStarted=false;this.audio.reset();}return changed;}
  step(h:number) {
    this.physics.step(h);
    this.audio.trampoline(h,this.physics.supported,this.physics.speed,this.physics.compression,this.active||this.physics.remotePhase!==null);
  }
  afterStep() {
    if(this.active) {
      if(this.physics.bounceHeight>=TRAMPOLINE.laughHeight)this.laughStarted=true;
      return;
    }
    // Padded rim contact stops a walking baby from passing through the frame.
    const b=this.physics.body;
    if(Math.hypot(b.center.x-TRAMPOLINE.x,b.center.z-TRAMPOLINE.z)>.15)return;
    let changed=false;
    for(let j=0;j<b.x.length;j+=3) {
      const x=b.x[j]-TRAMPOLINE.x,z=b.x[j+2]-TRAMPOLINE.z,r=Math.hypot(x,z);
      if(r<.001)continue;
      const dx=x*(1-.091/r),dy=b.x[j+1]-TRAMPOLINE.height-.001,dz=z*(1-.091/r),distance=Math.hypot(dx,dy,dz);
      if(distance>=.012||distance<1e-9)continue;
      const scale=(.012-distance)/distance;
      b.x[j]+=dx*scale;b.x[j+1]+=dy*scale;b.x[j+2]+=dz*scale;
      const inward=(b.velocity[j]*dx+b.velocity[j+1]*dy+b.velocity[j+2]*dz)/(distance*distance);
      if(inward<0){b.velocity[j]-=inward*dx;b.velocity[j+1]-=inward*dy;b.velocity[j+2]-=inward*dz;}
      changed=true;
    }
    if(changed){b.updateCenter();b.wake();b.surfaceDirty=true;}
  }
  update() {this.visual.update(this.physics.compression);}
  reset() {this.audio.reset();this.physics.reset();this.laughStarted=false;this.update();}
  dispose() {this.visual.group.removeFromParent();this.visual.dispose();}
}

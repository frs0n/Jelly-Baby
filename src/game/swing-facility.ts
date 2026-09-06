import type { Scene } from 'three/webgpu';
import { Box3, Vector3 } from 'three/webgpu';
import type { FacilityShadows } from '../graphics/facility-shadows.ts';
import type { SoftBody } from '../physics/soft-body.js';
import { Swing } from '../graphics/swing.ts';
import { SwingPhysics, SWING } from './swing-physics.ts';
import type { Facility } from './facilities.ts';

const LAUGH_ANGLE=15*Math.PI/180;

export class SwingFacility implements Facility {
  readonly id='spawn-swing';
  readonly label='Swing';
  readonly cameraDistance=.29;
  readonly physics:SwingPhysics;
  private readonly visual=new Swing();
  private readonly point=new Vector3();
  private readonly delta=new Vector3();
  private readonly axis=new Vector3();
  private laughStarted=false;
  constructor(scene:Scene,body:SoftBody,shadows:FacilityShadows) {
    this.physics=new SwingPhysics(body);scene.add(this.visual.group);
    shadows.add(this.visual.group,new Box3(
      new Vector3(SWING.x-.10,0,SWING.z-.15),
      new Vector3(SWING.x+.10,SWING.height+.02,SWING.z+.15),
    ));
  }
  get active() {return this.physics.riding;}
  get laughing() {return this.active&&this.laughStarted;}
  get interactionDistance() {
    return this.physics.nearby?Math.hypot(this.physics.body.center.x-SWING.x,this.physics.body.center.z-SWING.z):Infinity;
  }
  interact() {
    const changed=this.physics.toggle();
    if(changed)this.laughStarted=false;
    return changed;
  }
  step(h:number) {
    this.physics.step(h);
    // Remember the first substantial arc so the face stays joyful through
    // subsequent bottom crossings. Each new ride starts with the resting face.
    if(this.active&&Math.abs(this.physics.angle)>=LAUGH_ANGLE)this.laughStarted=true;
  }
  afterStep() {
    if(this.active)return;
    const b=this.physics.body;
    if(Math.abs(b.center.x-SWING.x)>.16||Math.abs(b.center.z-SWING.z)>.17)return;
    // Rounded frame contact keeps a walking jelly from passing through the legs.
    let changed=false;
    for(let i=0;i<b.mass.length;i++)for(const leg of this.visual.legs) {
      const j=i*3;this.point.fromArray(b.x,j);this.axis.copy(leg.b).sub(leg.a);
      const t=Math.max(0,Math.min(1,this.delta.copy(this.point).sub(leg.a).dot(this.axis)/this.axis.lengthSq()));
      this.delta.copy(this.point).sub(leg.a).addScaledVector(this.axis,-t);
      const distance=this.delta.length(),radius=leg.radius+.003;
      if(distance>=radius)continue;
      if(distance<1e-9)this.delta.set(1,0,0);else this.delta.divideScalar(distance);
      this.point.addScaledVector(this.delta,radius-distance);b.x.set(this.point.toArray(),j);
      const inward=b.velocity[j]*this.delta.x+b.velocity[j+1]*this.delta.y+b.velocity[j+2]*this.delta.z;
      if(inward<0)for(let axis=0;axis<3;axis++)b.velocity[j+axis]-=inward*this.delta.getComponent(axis);
      changed=true;
    }
    if(changed){b.wake();b.surfaceDirty=true;b.updateCenter();}
  }
  update() {this.visual.update(this.physics.angle);}
  reset() {this.laughStarted=false;this.physics.reset();this.update();}
  dispose() {this.visual.group.removeFromParent();this.visual.dispose();}
}

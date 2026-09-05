import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SoftBody } from '../physics/soft-body.js';
import type { Locomotion } from './locomotion.ts';
import type { JellySound } from './sound.ts';
import { surfaceGrab, projectGrabTarget, advanceGrabTarget } from '../physics/grab.ts';
import { SurfaceBVH } from '../graphics/refractive-light.js';

export class Input {
  readonly controls:OrbitControls;
  private keys=new Set<string>();
  private touchKeys=new Map<number,string>();
  private activePointer:number|null=null;
  private releasePending=false;
  private releaseStepsRemaining=0;
  private grabPhysicsSteps=0;
  private commandVersion=0;
  private consumedVersion=0;
  private raycaster=new THREE.Raycaster();
  private grabBVH:SurfaceBVH;
  private pointer=new THREE.Vector2();
  private plane=new THREE.Plane();
  private rawTarget=new THREE.Vector3();
  private temp=new THREE.Vector3();
  private follow=new THREE.Vector3();
  private abort=new AbortController();
  private canvas:HTMLCanvasElement;
  readonly camera:THREE.PerspectiveCamera;
  readonly body:SoftBody;
  readonly mesh:THREE.Mesh;
  readonly rig:Locomotion;
  readonly sound:JellySound;
  readonly reset:()=>void;
  constructor(camera:THREE.PerspectiveCamera,canvas:HTMLCanvasElement,
    body:SoftBody,mesh:THREE.Mesh,rig:Locomotion,sound:JellySound,
    reset:()=>void) {
    this.camera=camera;this.body=body;this.mesh=mesh;this.rig=rig;this.sound=sound;this.reset=reset;
    this.canvas=canvas;this.grabBVH=new SurfaceBVH(body.surface);
    this.controls=new OrbitControls(camera,canvas);
    const c=this.controls;
    c.target.copy(body.center);this.follow.copy(c.target);
    c.enablePan=false;c.enableDamping=true;c.dampingFactor=.07;
    c.minDistance=.135;c.maxDistance=.42;c.minPolarAngle=.22;c.maxPolarAngle=1.10;
    c.rotateSpeed=.65;c.zoomSpeed=.65;c.update();
    const signal=this.abort.signal;
    canvas.addEventListener('pointerdown',this.begin,{capture:true,signal});
    canvas.addEventListener('pointermove',this.pointerMove,{capture:true,passive:false,signal});
    // Window-level release is deliberate. Pointer capture should deliver these
    // through the canvas, but this closes the failure mode where a browser/OS
    // transition loses that path and leaves activePointer wedged forever.
    window.addEventListener('pointerup',this.end,{capture:true,signal});
    window.addEventListener('pointercancel',this.end,{capture:true,signal});
    canvas.addEventListener('lostpointercapture',this.end,{signal});
    window.addEventListener('keydown',this.keyDown,{signal});
    window.addEventListener('keyup',e=>this.keys.delete(e.code),{signal});
    window.addEventListener('blur',this.clear,{signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden) this.clear();},{signal});
    document.addEventListener('pointerdown',()=>{void sound.unlock().catch(()=>{});},{signal});
    for(const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')) {
      button.addEventListener('pointerdown',e=>{
        e.preventDefault();button.setPointerCapture(e.pointerId);
        const code=button.dataset.control!;
        this.touchKeys.set(e.pointerId,code);button.classList.add('held');
        if(code==='Space')rig.jump();
      },{signal});
      const release=(e:PointerEvent)=>{
        this.touchKeys.delete(e.pointerId);button.classList.remove('held');
      };
      button.addEventListener('pointerup',release,{signal});
      button.addEventListener('pointercancel',release,{signal});
      button.addEventListener('lostpointercapture',release,{signal});
    }
  }
  private eventRay(e:PointerEvent) {
    const rect=this.canvas.getBoundingClientRect();
    this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    this.camera.updateMatrixWorld();this.raycaster.setFromCamera(this.pointer,this.camera);
  }
  private captureDragTarget(e:PointerEvent) {
    // The final coalesced sample is the newest physical pointer position. Using
    // it also makes very fast high-polling-rate mouse motion deterministic.
    const samples=e.getCoalescedEvents?.()??[];
    const sample=samples.length?samples[samples.length-1]:e;
    this.eventRay(sample);
    if(projectGrabTarget(this.raycaster.ray,this.plane,this.temp)) {
      this.rawTarget.copy(this.temp);this.commandVersion++;return true;
    }
    return false;
  }
  private begin=(e:PointerEvent)=>{
    if(e.button!==0||this.activePointer!==null||this.body.grab||this.releasePending)return;
    this.eventRay(e);
    // Exact picking against the same full-resolution deformed surface that is
    // rendered, but through its refittable BVH instead of Three's O(144k)
    // triangle scan. This changes no grip position or binding semantics.
    this.grabBVH.refit();
    const ray=this.raycaster.ray,o=[ray.origin.x,ray.origin.y,ray.origin.z],d=[ray.direction.x,ray.direction.y,ray.direction.z];
    const hit=this.grabBVH.hit(o,d);if(!hit)return;
    const ix=this.body.surface.indices,offset=hit.t*3;
    const face={a:ix[offset],b:ix[offset+1],c:ix[offset+2]};
    const point=ray.at(hit.distance,new THREE.Vector3());
    void this.sound.unlock().catch(()=>{});
    e.preventDefault();e.stopImmediatePropagation();
    const grab=surfaceGrab(this.body,face,point);if(!grab)return;
    this.body.grab=grab;this.body.wake();
    this.activePointer=e.pointerId;this.releasePending=false;this.releaseStepsRemaining=0;
    this.grabPhysicsSteps=0;this.commandVersion=0;this.consumedVersion=0;
    this.controls.enabled=false;
    this.canvas.setPointerCapture(e.pointerId);this.canvas.classList.add('grabbing');
    this.camera.getWorldDirection(this.temp);this.plane.setFromNormalAndCoplanarPoint(this.temp,point);
    this.rawTarget.copy(point);
  };
  private pointerMove=(e:PointerEvent)=>{
    if(this.activePointer!==null&&e.pointerId!==this.activePointer)return;
    if(this.activePointer!==null&&e.pointerType==='mouse'&&(e.buttons&1)===0) {
      // Recover even if pointerup/lostpointercapture was swallowed externally.
      this.end(e);return;
    }
    if(this.activePointer!==null&&this.body.grab) {
      e.preventDefault();e.stopImmediatePropagation();this.captureDragTarget(e);
    } else if(!this.body.grab&&e.pointerType==='mouse') {
      this.eventRay(e);
      // Hover is only a cursor hint. Pointer-down resolves the exact visible
      // triangle through the refittable BVH, not a 144k-triangle linear scan.
      this.canvas.style.cursor=this.mesh.geometry.boundingBox&&this.raycaster.ray.intersectsBox(this.mesh.geometry.boundingBox)?'grab':'default';
    }
  };
  private end=(e?:PointerEvent)=>{
    if(this.activePointer===null||(e&&e.pointerId!==this.activePointer))return;
    // pointerup itself may be the only event carrying an abrupt drag endpoint.
    if(e?.type==='pointerup'&&this.body.grab)this.captureDragTarget(e);
    e?.preventDefault();e?.stopImmediatePropagation();
    const id=this.activePointer;this.activePointer=null;this.canvas.classList.remove('grabbing');
    if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);
    if(!this.body.grab){this.finishRelease();return;}
    // Do not destroy the grab in the DOM event. If down/move/up all happened
    // between render ticks, doing so means the physics solver sees nothing.
    // One normal drag gets one final 240 Hz sample; a zero-step flick gets two.
    this.releasePending=true;
    this.releaseStepsRemaining=Math.max(this.releaseStepsRemaining,this.grabPhysicsSteps===0?2:1);
  };
  private finishRelease=()=>{
    const id=this.activePointer;
    if(id!==null&&this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);
    this.activePointer=null;this.releasePending=false;this.releaseStepsRemaining=0;
    this.grabPhysicsSteps=0;this.body.grab=null;this.body.wake();this.controls.enabled=true;
    this.canvas.classList.remove('grabbing');
  };
  private keyDown=(e:KeyboardEvent)=>{
    if((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(e.code==='Space'&&(e.target as HTMLElement)?.closest('button'))return;
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Space'].includes(e.code)) {
      e.preventDefault();this.keys.add(e.code);void this.sound.unlock().catch(()=>{});
    }
    if(e.code==='Space'&&!e.repeat)this.rig.jump();
    if(e.code==='KeyR'&&!e.repeat)this.reset();
    if(e.code==='Escape')this.finishRelease();
  };
  clear=()=>{
    this.keys.clear();this.touchKeys.clear();
    if(this.activePointer!==null&&this.canvas.hasPointerCapture(this.activePointer))this.canvas.releasePointerCapture(this.activePointer);
    this.finishRelease();this.rig.move.set(0,0,0);
    document.querySelectorAll('.held').forEach(el=>el.classList.remove('held'));
  };
  private pressed(...codes:string[]) {
    for(const code of codes) {
      if(this.keys.has(code))return true;
      for(const touchCode of this.touchKeys.values())if(touchCode===code)return true;
    }
    return false;
  }
  step(h:number) {
    const x=Number(this.pressed('KeyD','ArrowRight'))-Number(this.pressed('KeyA','ArrowLeft'));
    const z=Number(this.pressed('KeyW','ArrowUp'))-Number(this.pressed('KeyS','ArrowDown'));
    if(x||z) {
      this.camera.getWorldDirection(this.temp);this.temp.y=0;this.temp.normalize();
      this.rig.move.set(-this.temp.z*x+this.temp.x*z,0,this.temp.x*x+this.temp.z*z);
      if(this.rig.move.lengthSq()>1)this.rig.move.normalize();
    } else this.rig.move.set(0,0,0);
    const grab=this.body.grab;
    if(grab) {
      advanceGrabTarget(grab.target,this.rawTarget,h,grab.point);
      this.consumedVersion=this.commandVersion;this.grabPhysicsSteps++;
    }
  }
  /** Called immediately after body.step() for the same fixed substep. */
  afterPhysicsStep() {
    const grab=this.body.grab;if(!grab)return;
    if(this.releasePending&&this.consumedVersion===this.commandVersion) {
      this.releaseStepsRemaining--;
      if(this.releaseStepsRemaining<=0)this.finishRelease();
    }
  }
  update(dt:number) {
    // State invariant: a missing grab must never leave pointer/orbit state wedged.
    // This is redundant with pointerup/cancel/lost-capture on purpose.
    if(!this.body.grab&&(this.activePointer!==null||this.releasePending||!this.controls.enabled))this.finishRelease();
    if(this.body.grab)return; // Freeze both orbit and translation for the entire grab.
    const target=this.temp.copy(this.body.center);target.y=Math.max(.025,target.y);
    this.follow.lerp(target,1-Math.exp(-4.5*dt));
    this.temp.copy(this.follow).sub(this.controls.target);
    this.camera.position.add(this.temp);this.controls.target.copy(this.follow);
    this.controls.update();
  }
  recenter() {this.clear();this.rig.reset();}
  dispose() {this.clear();this.abort.abort();this.controls.dispose();}
}

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SoftBody } from '../physics/soft-body.js';
import type { Locomotion } from './locomotion.ts';
import type { JellySound } from './sound.ts';

export class Input {
  readonly controls:OrbitControls;
  private keys=new Set<string>();
  private touchKeys=new Map<number,string>();
  private activePointer:number|null=null;
  private raycaster=new THREE.Raycaster();
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
    this.canvas=canvas;
    this.controls=new OrbitControls(camera,canvas);
    const c=this.controls;
    c.target.copy(body.center);this.follow.copy(c.target);
    c.enablePan=false;c.enableDamping=true;c.dampingFactor=.07;
    c.minDistance=.135;c.maxDistance=.42;c.minPolarAngle=.22;c.maxPolarAngle=1.10;
    c.rotateSpeed=.65;c.zoomSpeed=.65;c.update();
    const signal=this.abort.signal;
    canvas.addEventListener('pointerdown',this.begin,{capture:true,signal});
    canvas.addEventListener('pointermove',this.pointerMove,{capture:true,passive:false,signal});
    canvas.addEventListener('pointerup',this.end,{capture:true,signal});
    canvas.addEventListener('pointercancel',this.end,{capture:true,signal});
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
  private begin=(e:PointerEvent)=>{
    if(e.button!==0||this.activePointer!==null) return;
    this.eventRay(e);this.mesh.updateMatrixWorld();
    const hit=this.raycaster.intersectObject(this.mesh,false)[0];
    if(!hit?.face)return;
    void this.sound.unlock().catch(()=>{});
    e.preventDefault();e.stopImmediatePropagation();
    const {a,b,c}=hit.face,p=this.body.surface.positions;
    const tri=new THREE.Triangle(new THREE.Vector3().fromArray(p,a*3),new THREE.Vector3().fromArray(p,b*3),new THREE.Vector3().fromArray(p,c*3));
    const bary=tri.getBarycoord(hit.point,new THREE.Vector3());if(!bary)return;
    const weights=new Map<number,number>();
    for(const [surfaceId,w] of [[a,bary.x],[b,bary.y],[c,bary.z]])
      for(const [id,value] of this.body.surface.stencils[surfaceId]) weights.set(id,(weights.get(id)||0)+w*value);
    const list=[...weights].filter(([,w])=>w>1e-8),sum=list.reduce((a,[,w])=>a+w,0);
    if(sum<=0)return;
    list.forEach(pair=>pair[1]/=sum);
    this.body.grab={weights:list,target:hit.point.clone(),point:hit.point.clone(),lambda:new Float64Array(3)};
    this.activePointer=e.pointerId;this.controls.enabled=false;
    this.canvas.setPointerCapture(e.pointerId);this.canvas.classList.add('grabbing');
    this.camera.getWorldDirection(this.temp);this.plane.setFromNormalAndCoplanarPoint(this.temp,hit.point);
    this.rawTarget.copy(hit.point);
  };
  private pointerMove=(e:PointerEvent)=>{
    if(this.activePointer!==null && e.pointerId!==this.activePointer)return;
    this.eventRay(e);
    if(this.body.grab) {
      e.preventDefault();e.stopImmediatePropagation();
      if(this.raycaster.ray.intersectPlane(this.plane,this.temp)) {
        this.temp.y=Math.max(.001,this.temp.y);
        // World-relative reach: throwing works anywhere on the infinite table.
        this.rawTarget.copy(this.temp);
      }
    } else if(e.pointerType==='mouse') {
      this.canvas.style.cursor=this.raycaster.intersectObject(this.mesh,false).length?'grab':'default';
    }
  };
  private end=(e?:PointerEvent)=>{
    if(this.activePointer===null || (e && e.pointerId!==this.activePointer))return;
    e?.stopImmediatePropagation();
    const id=this.activePointer;this.activePointer=null;
    this.body.grab=null;this.controls.enabled=true;this.canvas.classList.remove('grabbing');
    if(this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);
  };
  private keyDown=(e:KeyboardEvent)=>{
    if((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(e.code==='Space'&&(e.target as HTMLElement)?.closest('button'))return;
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','Space'].includes(e.code)) {
      e.preventDefault();this.keys.add(e.code);void this.sound.unlock().catch(()=>{});
    }
    if(e.code==='Space'&&!e.repeat)this.rig.jump();
    if(e.code==='KeyR'&&!e.repeat)this.reset();
    if(e.code==='Escape')this.end();
  };
  clear=()=>{
    this.keys.clear();this.touchKeys.clear();this.end();this.rig.move.set(0,0,0);
    document.querySelectorAll('.held').forEach(el=>el.classList.remove('held'));
  };
  step(h:number) {
    const pressed=(...codes:string[])=>codes.some(code=>this.keys.has(code)||[...this.touchKeys.values()].includes(code));
    const x=Number(pressed('KeyD','ArrowRight'))-Number(pressed('KeyA','ArrowLeft'));
    const z=Number(pressed('KeyW','ArrowUp'))-Number(pressed('KeyS','ArrowDown'));
    this.camera.getWorldDirection(this.temp);this.temp.y=0;this.temp.normalize();
    this.rig.move.set(-this.temp.z*x+this.temp.x*z,0,this.temp.x*x+this.temp.z*z);
    if(this.rig.move.lengthSq()>1)this.rig.move.normalize();
    const grab=this.body.grab;
    if(grab) {
      const delta=this.temp.copy(this.rawTarget).sub(grab.target),distance=delta.length();
      if(distance>0)grab.target.addScaledVector(delta,Math.min(1-Math.exp(-32*h),.65*h/distance));
    }
  }
  update(dt:number) {
    if(this.body.grab)return; // Freeze both orbit and translation for the entire grab.
    const target=this.temp.copy(this.body.center);target.y=Math.max(.025,target.y);
    this.follow.lerp(target,1-Math.exp(-4.5*dt));
    this.temp.copy(this.follow).sub(this.controls.target);
    this.camera.position.add(this.temp);this.controls.target.copy(this.follow);
    this.controls.update();
  }
  recenter() { this.clear();this.rig.reset(); }
  dispose() {this.clear();this.abort.abort();this.controls.dispose();}
}

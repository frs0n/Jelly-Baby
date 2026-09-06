import { bindSkin } from './skin-grip.ts';
import * as THREE from 'three/webgpu';
import type { Input } from '../game/input.ts';
import type { SoftBody } from '../physics/soft-body.js';
import { projectGrabTarget, advanceGrabTarget, type surfaceGrab } from '../physics/grab.ts';
import { GRAB_REACH } from './grabs.ts';
import type { RoomClient } from './client.ts';
import type { Visitors } from './visitors.ts';

type SoftGrip=NonNullable<ReturnType<typeof surfaceGrab>>;
type PointerDrag={pointer:number;id:string;plane:THREE.Plane;target:THREE.Vector3;accepted:boolean};
/** Original self-grabs plus proximity-limited grabs of network visitors, with no UI. */
export class OnlineDrag {
  private readonly abort=new AbortController();
  private readonly ray=new THREE.Raycaster();
  private readonly pointer=new THREE.Vector2();
  private drag:PointerDrag|null=null;
  private selfGrip:SoftGrip|null=null;
  private incoming:SoftGrip|null=null;
  private incomingBy='';
  private accepted=false;
  private elapsed=0;
  private input:Input;
  private body:SoftBody;
  private client:RoomClient;
  private visitors:Visitors;
  private canvas:HTMLCanvasElement;
  constructor(input:Input,body:SoftBody,client:RoomClient,visitors:Visitors) {
    this.input=input;this.body=body;this.client=client;this.visitors=visitors;this.canvas=input.controls.domElement as HTMLCanvasElement;
    const signal=this.abort.signal;
    // Window capture runs before the original canvas self-grab and OrbitControls handlers.
    window.addEventListener('pointerdown',this.begin,{capture:true,signal});
    window.addEventListener('pointermove',this.move,{capture:true,passive:false,signal});
    window.addEventListener('pointerup',this.end,{capture:true,signal});
    window.addEventListener('pointercancel',this.end,{capture:true,signal});
    this.canvas.addEventListener('lostpointercapture',this.end,{signal});
    window.addEventListener('blur',this.clear,{signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();},{signal});
    window.addEventListener('keydown',e=>{if(e.code==='Escape')this.clear();},{signal});
    client.onGrabResult=(target,accepted)=>{
      if(this.drag?.id===target&&!accepted)this.clear();
      if(this.selfGrip&&target===client.id&&!accepted){input.clear();this.selfGrip=null;}
    };
  }
  private eventRay(e:PointerEvent) {
    const rect=this.canvas.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    this.input.camera.updateMatrixWorld();this.ray.setFromCamera(this.pointer,this.input.camera);
  }
  private begin=(e:PointerEvent)=>{
    if(e.target!==this.canvas||e.button!==0||!this.client.connected||this.drag||this.body.grab)return;
    this.eventRay(e);
    const hit=this.visitors.pick(this.ray);if(!hit)return;
    // Let the existing exact surface picker handle a nearer self hit.
    const own=this.input.pickSurface(this.ray.ray);if(own&&own.distance<hit.distance)return;
    const self=this.client.players.find(p=>p.id===this.client.id),other=this.client.players.find(p=>p.id===hit.id);
    if(!self||!other||other.grab||Math.hypot(self.x-other.x,self.y-other.y,self.z-other.z)>GRAB_REACH)return;
    e.preventDefault();e.stopImmediatePropagation();void this.input.sound.unlock().catch(()=>{});
    const normal=this.input.camera.getWorldDirection(new THREE.Vector3());
    this.drag={pointer:e.pointerId,id:hit.id,plane:new THREE.Plane().setFromNormalAndCoplanarPoint(normal,hit.point),target:hit.point.clone(),accepted:false};
    this.input.externalGrab=true;this.input.controls.enabled=false;this.canvas.classList.add('grabbing');this.canvas.setPointerCapture(e.pointerId);
    this.visitors.beginPrediction(hit.id,hit.point);
    this.client.beginGrab(hit.id,hit.point);
  };
  private capture(e:PointerEvent) {
    if(!this.drag)return;this.eventRay(e);projectGrabTarget(this.ray.ray,this.drag.plane,this.drag.target);this.visitors.predictGrab(this.drag.id,this.drag.target);
  }
  private move=(e:PointerEvent)=>{
    if(this.drag?.pointer!==e.pointerId)return;
    if(e.pointerType==='mouse'&&(e.buttons&1)===0){this.end(e);return;}
    e.preventDefault();e.stopImmediatePropagation();this.capture(e);
  };
  private end=(e:PointerEvent)=>{
    if(this.drag?.pointer!==e.pointerId)return;
    if(e.type==='pointerup'){this.capture(e);this.client.moveGrab(this.drag.target);}
    e.preventDefault();e.stopImmediatePropagation();this.clear();
  };
  clear=()=>{
    const drag=this.drag;this.drag=null;this.visitors.clearPrediction();
    if(drag||this.selfGrip)this.client.endGrab();
    this.selfGrip=null;this.accepted=false;
    this.input.allowGrab=this.client.connected&&!this.incoming;
    this.input.externalGrab=false;this.input.controls.enabled=this.body.grabs.length===0;
    this.canvas.classList.remove('grabbing');
    if(drag&&this.canvas.hasPointerCapture(drag.pointer))this.canvas.releasePointerCapture(drag.pointer);
  };
  private syncIncoming(dt:number) {
    const self=this.client.players.find(p=>p.id===this.client.id),g=self?.grab;
    const external=g&&g.by!==this.client.id;
    this.input.allowGrab=this.client.connected&&!external&&!this.drag;
    if(!external){if(this.incoming){const i=this.body.grabs.indexOf(this.incoming);if(i!==-1)this.body.grabs.splice(i,1);}this.incoming=null;this.incomingBy='';this.input.controls.enabled=!this.body.grab&&!this.input.externalGrab;return;}
    if(this.incomingBy!==g.by||!this.incoming||!this.body.grabs.includes(this.incoming)) {
      this.input.clear();this.clear();this.incomingBy=g.by;
      const desired=new THREE.Vector3(self.x+g.anchor.x,self.y+g.anchor.y,self.z+g.anchor.z);
      this.incoming=bindSkin(this.body,desired);this.body.grabs.push(this.incoming);this.input.allowGrab=false;this.input.controls.enabled=false;this.body.wake();
    }
    advanceGrabTarget(this.incoming.target,new THREE.Vector3(g.target.x,g.target.y,g.target.z),dt,this.incoming.point);
  }
  update(dt:number) {
    this.syncIncoming(dt);
    if(!this.client.connected){this.clear();return;}
    if(this.drag) {
      const other=this.client.players.find(p=>p.id===this.drag!.id);
      if(other?.grab?.by===this.client.id)this.drag.accepted=true;
      if(!other||(this.drag.accepted&&other.grab?.by!==this.client.id)){this.clear();return;}
      this.input.rig.move.set(0,0,0);
    }
    const local=this.body.grabs.find((g:SoftGrip)=>g!==this.incoming&&!('cosmetic' in g&&g.cosmetic)) as SoftGrip|undefined;
    if(!this.drag&&local!==this.selfGrip) {
      if(this.selfGrip){this.client.moveGrab(this.selfGrip.target);this.client.endGrab();}
      this.selfGrip=local??null;this.accepted=false;
      if(local)this.client.beginGrab(this.client.id,local.point);
    }
    if(this.selfGrip&&this.client.players.find(p=>p.id===this.client.id)?.grab?.by===this.client.id)this.accepted=true;
    if(this.selfGrip&&this.accepted) {
      const self=this.client.players.find(p=>p.id===this.client.id);
      if(self?.grab?.by!==this.client.id){this.input.clear();this.clear();return;}
    }
    this.elapsed+=dt;
    if(this.elapsed>=1/30){this.elapsed=0;if(this.drag)this.client.moveGrab(this.drag.target);else if(this.selfGrip)this.client.moveGrab(this.selfGrip.target);}
  }
  dispose(){this.clear();if(this.incoming){const i=this.body.grabs.indexOf(this.incoming);if(i!==-1)this.body.grabs.splice(i,1);}this.abort.abort();}
}

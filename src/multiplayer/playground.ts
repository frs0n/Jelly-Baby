import { ImpactResponse } from './impact-response.ts';
import { ReachingHand } from './reaching-hand.ts';
import { reconcile } from './reconcile.ts';
import { OnlineDrag } from './drag.ts';
import type { Appearance } from './appearance.ts';
import * as THREE from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import type { Input } from '../game/input.ts';
import type { Baby } from '../graphics/baby.ts';
import { RoomClient } from './client.ts';
import { Visitors } from './visitors.ts';

export class Playground {
  private client=new RoomClient();
  private visitors:Visitors;
  private drag:OnlineDrag;
  private hand:ReachingHand;
  private body:SoftBody;
  private input:Input;
  private floorCenter:number;
  private elapsed=0;
  private jump=false;
  private dash=false;
  private aborted=new AbortController();
  private first=true;
  private impacts=new ImpactResponse();
  private appearanceKey="";
  private changeAppearance:(palette:Appearance)=>void;
  constructor(scene:THREE.Scene,body:SoftBody,baby:Baby,input:Input,changeAppearance:(palette:Appearance)=>void,fail:(error:Error)=>void) {
    this.body=body;this.input=input;this.changeAppearance=changeAppearance;this.floorCenter=body.center.y;
    this.hand=new ReachingHand(body);
    this.visitors=new Visitors(scene,baby.group,body.center,{fail,localGrip:()=>body.grabs.find(g=>!g.cosmetic)?.point??null});
    this.drag=new OnlineDrag(input,body,this.client,this.visitors);
    input.allowGrab=true;input.enabled=false;
    input.onJump=()=>{this.jump=true;};input.onDash=()=>{this.dash=true;};
    const count=document.querySelector<HTMLElement>('#player-count')!;
    this.client.onError=fail;
    this.client.onState=players=>{
      input.enabled=this.client.connected;if(count.textContent!==`${players.length} / 6`)count.textContent=`${players.length} / 6`;
      this.visitors.sync(players,this.client.id,this.client.sampleTime);
      const self=players.find(p=>p.id===this.client.id);
      if(self) {const key=JSON.stringify(self.appearance);if(key!==this.appearanceKey){this.appearanceKey=key;this.changeAppearance(self.appearance);}}
      if(self&&this.first){this.first=false;input.rig.yaw=self.yaw;this.reposition(self.x,self.y,self.z,1);}
    };
    const join=()=>{input.clear();this.first=true;this.jump=this.dash=false;void this.client.join();};
    const neutral=()=>{this.jump=this.dash=false;this.client.input({x:0,z:0,jump:false,dash:false});};
    window.addEventListener('blur',neutral,{signal:this.aborted.signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)neutral();},{signal:this.aborted.signal});
    window.addEventListener('pagehide',()=>this.client.close(),{signal:this.aborted.signal});
    window.addEventListener('pageshow',e=>{if(e.persisted)join();},{signal:this.aborted.signal});
  }
  reset(){this.hand.clear();this.drag.clear();this.client.reset();}
  start(){void this.client.join();}
  private reposition(x:number,y:number,z:number,blend:number) {
    const b=this.body,dx=(x-b.center.x)*blend,dz=(z-b.center.z)*blend,dy=(y+this.floorCenter-b.center.y)*blend;
    if(Math.hypot(dx,dy,dz)<.00005)return;
    // Translate the entire cage equally, preserving strain and local jelly motion.
    for(let i=0;i<b.x.length;i+=3){b.x[i]+=dx;b.x[i+1]+=dy;b.x[i+2]+=dz;b.previous[i]+=dx;b.previous[i+1]+=dy;b.previous[i+2]+=dz;}
    b.updateCenter();b.surfaceDirty=true;b.wake();
  }
  update(dt:number) {
    this.drag.update(dt);
    this.elapsed+=dt;
    if(this.elapsed>=1/30) {
      this.elapsed=0;
      this.client.input({x:this.input.rig.move.x,z:this.input.rig.move.z,jump:this.jump,dash:this.dash});this.jump=this.dash=false;
    }
    const p=this.client.players.find(p=>p.id===this.client.id);
    if(p) {
      // A facility owns the body's motion locally while the server only sees a
      // standing player. Correcting to authority mid-ride would fight the swing
      // or trampoline every frame; drift is blended away once the ride ends.
      if(!this.input.bodyControlled())reconcile(this.body,p,this.floorCenter,this.client.snapshotAge,dt);
      this.impacts.update(this.body,this.input.rig,p);

    }else this.input.rig.move.set(0,0,0);
    this.visitors.update(dt,this.client.serverNow-100);
    this.hand.update(this.visitors.reachFor(this.client.id),this.input.rig.yaw,dt);
  }
  dispose(){this.hand.clear();this.drag.dispose();this.aborted.abort();this.client.close();this.visitors.dispose();}
}

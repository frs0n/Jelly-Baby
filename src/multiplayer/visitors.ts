import { MeshPlayback } from './mesh-playback.ts';
import * as THREE from 'three/webgpu';
import { colorJelly } from './jelly-color.ts';
import { loadBabyModel, parseBabyCage, type BabyModel } from '../physics/baby-cage.ts';
import type { Player } from './simulation.ts';
import type { ActorFrame } from './remote-actor.ts';
import type { Grip } from './grabs.ts';
import type { Reach } from './reaching-hand.ts';

type Options={model?:Promise<BabyModel>;worker?:()=>Worker;fail?:(error:Error)=>void;localGrip?:()=>THREE.Vector3|null};
type Visitor={group:THREE.Group;meshes:THREE.Mesh[];worker:Worker;ready:boolean;busy:boolean;elapsed:number;frame:ActorFrame|null;recycle?:ArrayBuffer;vertices?:ArrayBuffer;center:THREE.Vector3;state:Player;samples:{time:number;state:Player}[];playback?:MeshPlayback};
/** Local FEM and face animation with a lightweight remote skin and bounded updates. */
export class Visitors {
  private template:THREE.Group;
  private visitors=new Map<string,Visitor>();
  private scene:THREE.Scene;
  private options:Options;
  private model:Promise<BabyModel>;
  private players:Player[]=[];
  private self='';
  private predicted:{id:string;grip:Grip}|null=null;
  beginPrediction(id:string,point:THREE.Vector3){
    const p=this.players.find(p=>p.id===id),self=this.players.find(p=>p.id===this.self);if(!p||!self)return;
    const hand=(p.x-self.x)*Math.cos(self.yaw)-(p.z-self.z)*Math.sin(self.yaw)>=0?1:-1;
    this.predicted={id,grip:{by:this.self,hand,anchor:{x:point.x-p.x,y:point.y-p.y,z:point.z-p.z},target:{x:point.x,y:point.y,z:point.z},updated:0}};
  }
  predictGrab(id:string,target:THREE.Vector3){if(this.predicted?.id===id)this.predicted.grip.target={x:target.x,y:target.y,z:target.z};}
  clearPrediction(){this.predicted=null;}
  constructor(scene:THREE.Scene,source:THREE.Group,_center:THREE.Vector3,options:Options={}) {
    this.scene=scene;this.options=options;this.model=options.model??loadBabyModel();this.template=source.clone(true);
    this.template.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry=object.geometry.clone();});
  }
  sync(players:Player[],self:string,time=performance.now()) {
    this.players=players;this.self=self;
    const present=new Set(players.filter(p=>p.id!==self).map(p=>p.id));
    for(const [id,v] of this.visitors)if(!present.has(id)){this.remove(v);this.visitors.delete(id);}
    for(const p of players) {
      if(p.id===self)continue;
      let v=this.visitors.get(p.id);
      if(!v) {
        const group=this.template.clone(true),meshes:THREE.Mesh[]=[];
        group.visible=false;
        group.traverse(object=>{if(object instanceof THREE.Mesh){object.frustumCulled=true;object.geometry=meshes.length===0?new THREE.BufferGeometry():object.geometry.clone();object.material=Array.isArray(object.material)?object.material.map(m=>m.clone()):object.material.clone();meshes.push(object);}});
        const worker=this.options.worker?this.options.worker():new Worker(new URL('./remote-actor.worker.ts',import.meta.url),{type:'module'});
        v={group,meshes,worker,ready:false,busy:false,elapsed:0,frame:null,center:new THREE.Vector3(),state:p,samples:[]};
        const visitor=v;this.visitors.set(p.id,v);this.scene.add(group);
        const fail=(message:string)=>{if(this.visitors.get(p.id)===visitor)this.options.fail?.(new Error(message));};
        worker.onerror=event=>fail(event.message);
        worker.onmessage=event=>{
          if(this.visitors.get(p.id)!==visitor)return;
          const data=event.data;
          if(data.type==='ready'){visitor.ready=true;return;}
          if(data.type==='error'){fail(data.message);return;}
          this.apply(visitor,data as ActorFrame);visitor.busy=false;
        };
        void this.model.then(model=>{if(this.visitors.get(p.id)!==visitor)return;const cage=parseBabyCage(model.buffer,model.manifest,true);visitor.meshes[0].geometry.dispose();visitor.meshes[0].geometry=cage.surface.geometry;cage.opticalSurface.geometry.dispose();worker.postMessage({type:'init',model});}).catch(error=>fail(String(error)));
      }
      if(v.state.appearance.primary!==p.appearance.primary||v.state.appearance.secondary!==p.appearance.secondary||!v.group.userData.colored) {
        for(const object of v.meshes)if(object.material instanceof THREE.MeshPhysicalNodeMaterial&&object.material.transmission>0)colorJelly(object.material,p.appearance,v.center);
        v.group.userData.colored=true;
      }
      // Decoded snapshots are immutable; keep references instead of cloning every player.
      v.state=p;v.samples.push({time,state:p});if(v.samples.length>20)v.samples.shift();
    }
  }
  private apply(v:Visitor,frame:ActorFrame) {
    v.playback??=new MeshPlayback(v.meshes);
    if(frame.buffer){v.playback.accept(frame);v.recycle=v.vertices;v.vertices=frame.buffer;}
    v.frame=frame;v.center.copy(v.playback.center);v.group.visible=true;
  }
  grabPoint(id:string) {
    if(id===this.self)return this.options.localGrip?.()??null;
    const v=this.visitors.get(id);
    return v?.playback?.hasGrip?v.playback.gripPoint.clone().add(v.group.position):null;
  }
  reachFor(id:string):Reach|null {
    if(id===this.self&&this.predicted){const p=this.grabPoint(this.predicted.id);return {hand:this.predicted.grip.hand,target:p?{x:p.x,y:p.y,z:p.z}:this.predicted.grip.target};}
    const victim=this.players.find(p=>p.id!==id&&p.grab?.by===id);
    if(!victim?.grab)return null;
    const point=this.grabPoint(victim.id);
    return point?{hand:victim.grab.hand,target:{x:point.x,y:point.y,z:point.z}}:null;
  }
  pick(ray:THREE.Raycaster) {
    let nearest:{id:string;point:THREE.Vector3;distance:number}|null=null;
    for(const [id,v] of this.visitors) {
      if(!v.group.visible)continue;
      v.group.updateWorldMatrix(true,true);
      const hit=ray.intersectObject(v.group,true)[0];
      if(hit&&(!nearest||hit.distance<nearest.distance))nearest={id,point:hit.point,distance:hit.distance};
    }
    return nearest;
  }
  update(dt:number,renderTime=performance.now()-100) {
    for(const [id,v] of this.visitors) {
      while(v.samples.length>2&&v.samples[1].time<=renderTime)v.samples.shift();
      const from=v.samples[0],to=v.samples[1];
      const t=to?Math.max(0,Math.min(1,(renderTime-from.time)/Math.max(1,to.time-from.time))):0;
      const state={...v.state};
      if(to){
        for(const key of ['x','y','z','vx','vy','vz'] as const)state[key]=THREE.MathUtils.lerp(from.state[key],to.state[key],t);
        const angle=to.state.yaw-from.state.yaw;state.yaw=from.state.yaw+Math.atan2(Math.sin(angle),Math.cos(angle))*t;
        if(state.grab&&from.state.grab?.by===state.grab.by&&to.state.grab?.by===state.grab.by){
          const a=from.state.grab.target,b=to.state.grab.target;
          state.grab={...state.grab,target:{x:THREE.MathUtils.lerp(a.x,b.x,t),y:THREE.MathUtils.lerp(a.y,b.y,t),z:THREE.MathUtils.lerp(a.z,b.z,t)}};
        }
      }
      // The pose and its grip point share one interpolated root-relative space.
      // Advancing the network root must never reset on a worker delivery.
      v.group.position.set(state.x,state.y,state.z);
      v.playback?.update(dt);if(v.playback)v.center.copy(v.playback.center);
      // Pointer feedback is local; ownership/release still come from authority.
      if(this.predicted?.id===id&&(!state.grab||state.grab.by===this.self))state.grab={...(state.grab??this.predicted.grip),target:{...this.predicted.grip.target}};
      v.elapsed=Math.min(.05,v.elapsed+dt);
      // Give the directly manipulated visitor a 60 Hz budget, everyone else 30 Hz.
      // Display playback still advances every render frame, including busy frames.
      const interval=this.predicted?.id===id?1/60:1/30;
      if(!v.ready||v.busy||(v.frame&&v.elapsed+1e-9<interval))continue;
      v.busy=true;const buffer=v.recycle;v.recycle=undefined;
      v.worker.postMessage({type:'frame',dt:v.elapsed,state,reach:this.reachFor(id),buffer},buffer?[buffer]:[]);v.elapsed=0;
    }
  }
  private remove(v:Visitor){v.worker.terminate();this.scene.remove(v.group);v.group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});}
  dispose(){for(const v of this.visitors.values())this.remove(v);this.visitors.clear();this.template.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});}
}

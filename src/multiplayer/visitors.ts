import * as THREE from 'three/webgpu';
import { colorJelly } from './jelly-color.ts';
import { loadBabyModel, type BabyModel } from '../physics/baby-cage.ts';
import type { Player } from './simulation.ts';
import type { ActorFrame } from './remote-actor.ts';
import type { Reach } from './reaching-hand.ts';

type Options={model?:Promise<BabyModel>;worker?:()=>Worker;fail?:(error:Error)=>void;localGrip?:()=>THREE.Vector3|null};
type Visitor={group:THREE.Group;meshes:THREE.Mesh[];worker:Worker;ready:boolean;busy:boolean;elapsed:number;frame:ActorFrame|null;recycle?:ArrayBuffer;center:THREE.Vector3;state:Player;samples:{time:number;state:Player}[]};
/** Full original FEM and face animation run locally, away from the rendering thread. */
export class Visitors {
  private template:THREE.Group;
  private visitors=new Map<string,Visitor>();
  private scene:THREE.Scene;
  private options:Options;
  private model:Promise<BabyModel>;
  private players:Player[]=[];
  private self='';
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
        group.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry=object.geometry.clone();object.material=Array.isArray(object.material)?object.material.map(m=>m.clone()):object.material.clone();meshes.push(object);}});
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
        void this.model.then(model=>{if(this.visitors.get(p.id)===visitor)worker.postMessage({type:'init',model});}).catch(error=>fail(String(error)));
      }
      if(v.state.appearance.primary!==p.appearance.primary||v.state.appearance.secondary!==p.appearance.secondary||!v.group.userData.colored) {
        for(const object of v.meshes)if(object.material instanceof THREE.MeshPhysicalNodeMaterial&&object.material.transmission>0)colorJelly(object.material,p.appearance,v.center);
        v.group.userData.colored=true;
      }
      v.state=p;v.samples.push({time,state:structuredClone(p)});if(v.samples.length>20)v.samples.shift();
    }
  }
  private apply(v:Visitor,frame:ActorFrame) {
    let offset=0;
    v.meshes.forEach((mesh,i)=>{
      const length=frame.lengths[i],geometry=mesh.geometry;
      for(const name of ['position','normal']) {
        const attribute=geometry.getAttribute(name) as THREE.BufferAttribute;
        attribute.array=new Float32Array(frame.buffer,offset,length);attribute.needsUpdate=true;offset+=length*4;
      }
      const b=frame.bounds[i];geometry.boundingBox=new THREE.Box3(new THREE.Vector3(...b.slice(0,3)),new THREE.Vector3(...b.slice(3,6)));
      geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(...b.slice(6,9)),b[9]);
    });
    v.recycle=v.frame?.buffer;v.frame=frame;v.center.set(frame.center.x,frame.center.y,frame.center.z);v.group.visible=true;
  }
  grabPoint(id:string) {
    if(id===this.self)return this.options.localGrip?.()??null;
    const v=this.visitors.get(id),p=v?.frame?.gripPoint;
    return v&&p?new THREE.Vector3(p.x,p.y,p.z).add(v.group.position):null;
  }
  reachFor(id:string):Reach|null {
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
      if(to)for(const key of ['x','y','z','vx','vy','vz'] as const)state[key]=THREE.MathUtils.lerp(from.state[key],to.state[key],t);
      if(v.frame)v.group.position.set(state.x-v.frame.root.x,state.y-v.frame.root.y,state.z-v.frame.root.z);
      v.elapsed=Math.min(.05,v.elapsed+dt);
      if(!v.ready||v.busy)continue;
      v.busy=true;const buffer=v.recycle;v.recycle=undefined;
      v.worker.postMessage({type:'frame',dt:v.elapsed,state,reach:this.reachFor(id),buffer},buffer?[buffer]:[]);v.elapsed=0;
    }
  }
  private remove(v:Visitor){v.worker.terminate();this.scene.remove(v.group);v.group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});}
  dispose(){for(const v of this.visitors.values())this.remove(v);this.visitors.clear();this.template.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});}
}

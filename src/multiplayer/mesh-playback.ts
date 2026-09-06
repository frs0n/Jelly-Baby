import * as THREE from 'three/webgpu';
import type { ActorFrame } from './remote-actor.ts';

/** Worker messages are samples, not display frames. Keep stable GPU attributes
 * and play the deformation between samples in a single root-relative space. */
export class MeshPlayback {
  readonly center=new THREE.Vector3();
  readonly gripPoint=new THREE.Vector3();
  hasGrip=false;
  private initialized=false;
  private age=0;
  private span=1/30;
  private sinceSample=0;
  private centerFrom=new THREE.Vector3();
  private centerTo=new THREE.Vector3();
  private gripFrom=new THREE.Vector3();
  private gripTo=new THREE.Vector3();
  private tracks:{attribute:THREE.BufferAttribute;from:Float32Array;to:Float32Array;normal:boolean}[]=[];
  private bounds:{box:THREE.Box3;sphere:THREE.Sphere;from:number[];to:number[]}[]=[];
  constructor(privateMeshes:THREE.Mesh[]) {
    for(const mesh of privateMeshes) {
      const geometry=mesh.geometry;
      for(const name of ['position','normal']) {
        const attribute=geometry.getAttribute(name) as THREE.BufferAttribute;
        this.tracks.push({attribute,from:new Float32Array(attribute.array.length),to:new Float32Array(0),normal:name==='normal'});
      }
      geometry.boundingBox??=new THREE.Box3();geometry.boundingSphere??=new THREE.Sphere();
      this.bounds.push({box:geometry.boundingBox,sphere:geometry.boundingSphere,from:[],to:[]});
    }
  }
  accept(frame:ActorFrame) {
    if(!frame.buffer)return;
    // The previous target buffer can be transferred back as soon as this returns:
    // 'from' captures what was actually displayed, never another in-flight pose.
    this.span=Math.max(1/120,Math.min(.05,this.sinceSample||1/30));this.sinceSample=0;this.age=0;
    let offset=0;
    for(const track of this.tracks) {
      const length=track.attribute.array.length;
      track.from.set(track.attribute.array);
      track.to=new Float32Array(frame.buffer,offset,length);offset+=length*4;
      if(!track.normal)for(let i=0;i<length;i+=3){track.to[i]-=frame.root.x;track.to[i+1]-=frame.root.y;track.to[i+2]-=frame.root.z;}
    }
    for(let i=0;i<this.bounds.length;i++) {
      const track=this.bounds[i],b=frame.bounds[i];
      track.from=[...track.box.min.toArray(),...track.box.max.toArray(),...track.sphere.center.toArray(),track.sphere.radius];
      track.to=b.map((v,k)=>k===9?v:v-[frame.root.x,frame.root.y,frame.root.z][k%3]);
    }
    this.centerFrom.copy(this.center);this.centerTo.set(frame.center.x-frame.root.x,frame.center.y-frame.root.y,frame.center.z-frame.root.z);
    if(frame.gripPoint){
      this.gripFrom.copy(this.gripPoint);this.gripTo.set(frame.gripPoint.x-frame.root.x,frame.gripPoint.y-frame.root.y,frame.gripPoint.z-frame.root.z);
      if(!this.hasGrip)this.gripFrom.copy(this.gripTo);
    }
    this.hasGrip=frame.gripPoint!==null;
    if(!this.initialized){this.initialized=true;this.age=this.span;this.draw(1);}
  }
  update(dt:number) {
    this.sinceSample+=dt;
    if(!this.initialized||this.age>=this.span)return;
    this.age=Math.min(this.span,this.age+dt);this.draw(this.age/this.span);
  }
  private draw(t:number) {
    for(const track of this.tracks) {
      const a=track.from,b=track.to,out=track.attribute.array;
      for(let i=0;i<out.length;i++)out[i]=a[i]+(b[i]-a[i])*t;
      if(track.normal)for(let i=0;i<out.length;i+=3){const n=Math.hypot(out[i],out[i+1],out[i+2]);if(n>1e-10){out[i]/=n;out[i+1]/=n;out[i+2]/=n;}}
      track.attribute.needsUpdate=true;
    }
    for(const track of this.bounds) {
      const a=track.from,b=track.to,lerp=(i:number)=>t===1?b[i]:a[i]+(b[i]-a[i])*t;
      track.box.min.set(lerp(0),lerp(1),lerp(2));track.box.max.set(lerp(3),lerp(4),lerp(5));
      track.sphere.center.set(lerp(6),lerp(7),lerp(8));track.sphere.radius=lerp(9);
    }
    this.center.lerpVectors(this.centerFrom,this.centerTo,t);if(this.hasGrip)this.gripPoint.lerpVectors(this.gripFrom,this.gripTo,t);
  }
}

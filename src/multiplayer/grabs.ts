import type { Player } from './simulation.ts';
export const GRAB_REACH=.22;
export const GRAB_TETHER=.34;
export type Point={x:number;y:number;z:number};
export type Grip={by:string;hand:-1|1;anchor:Point;target:Point;updated:number};
export function point(value:unknown):Point|null {
  if(!value||typeof value!=='object')return null;
  const p=value as Record<string,unknown>;
  if(typeof p.x!=='number'||typeof p.y!=='number'||typeof p.z!=='number'||![p.x,p.y,p.z].every(v=>Number.isFinite(v)&&Math.abs(v)<1e6))return null;
  return {x:p.x,y:p.y,z:p.z};
}
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function releaseGrabs(players:Player[],id:string) {
  for(const p of players)if(p.id===id||p.grab?.by===id)p.grab=null;
}
export function beginGrab(players:Player[],by:string,id:string,hit:Point,now:number) {
  const owner=players.find(p=>p.id===by),p=players.find(p=>p.id===id);
  if(!owner||!p||(owner.grab&&owner.grab.by!==by)||p.grab||players.some(p=>p.grab?.by===by))return false;
  // A rider is held by the facility; nobody grabs them and they grab nobody.
  if(owner.facility||p.facility)return false;
  if(by!==id&&distance(owner,p)>GRAB_REACH)return false;
  const center={x:p.x,y:p.y+.035,z:p.z};
  if(distance(center,hit)>.08)return false;
  const hand=(p.x-owner.x)*Math.cos(owner.yaw)-(p.z-owner.z)*Math.sin(owner.yaw)>=0?1:-1;
  p.grab={by,hand,anchor:{x:hit.x-p.x,y:hit.y-p.y,z:hit.z-p.z},target:{...hit},updated:now};
  return true;
}
export function moveGrab(players:Player[],by:string,target:Point,now:number) {
  const owner=players.find(p=>p.id===by),p=players.find(p=>p.grab?.by===by);
  if(!owner||!p||!p.grab)return false;
  if(p.id!==by&&distance(owner,p)>GRAB_TETHER){p.grab=null;return false;}
  // Limit pointer lead and reach in world space, not screen pixels.
  const anchor={x:p.x+p.grab.anchor.x,y:p.y+p.grab.anchor.y,z:p.z+p.grab.anchor.z};
  const d=distance(anchor,target),s=d>.14?.14/d:1;
  let x=anchor.x+(target.x-anchor.x)*s,y=Math.max(.0003,anchor.y+(target.y-anchor.y)*s),z=anchor.z+(target.z-anchor.z)*s;
  if(p.id!==by) {
    const center={x:owner.x,y:owner.y+.035,z:owner.z},reach=distance(center,{x,y,z}),scale=reach>GRAB_TETHER?GRAB_TETHER/reach:1;
    x=center.x+(x-center.x)*scale;y=Math.max(.0003,center.y+(y-center.y)*scale);z=center.z+(z-center.z)*scale;
  }
  p.grab.target={x,y,z};p.grab.updated=now;return true;
}
export function expireGrabs(players:Player[],now:number) {
  for(const p of players)if(p.grab){const owner=players.find(o=>o.id===p.grab!.by);if(!owner||now-p.grab.updated>700||(owner!==p&&distance(owner,p)>GRAB_TETHER))p.grab=null;}
}
/** Bounded spring on the authority's collision body. Surface deformation stays client-side. */
export function pull(p:Player,dt:number) {
  const g=p.grab;if(!g)return;
  const dx=g.target.x-p.x-g.anchor.x,dy=g.target.y-p.y-g.anchor.y,dz=g.target.z-p.z-g.anchor.z;
  const ax=dx*160-p.vx*12,ay=dy*160-p.vy*12+2.4,az=dz*160-p.vz*12;
  const magnitude=Math.hypot(ax,ay,az),scale=magnitude>12?12/magnitude:1;
  p.vx+=ax*scale*dt;p.vy+=ay*scale*dt;p.vz+=az*scale*dt;
  const speed=Math.hypot(p.vx,p.vy,p.vz),limit=speed>1.2?1.2/speed:1;p.vx*=limit;p.vy*=limit;p.vz*=limit;
}

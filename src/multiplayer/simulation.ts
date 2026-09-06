import { pull, type Grip } from './grabs.ts';
import type { Appearance } from './appearance.ts';
/** Small server-authoritative collision bodies, in metres. Skin physics stays local. */
export const CAPACITY=6;
export const RADIUS=.026;
export const STEP=1/30;
export type Controls={x:number;z:number;jump:boolean;dash:boolean};
export type Impact={seq:number;nx:number;nz:number;speed:number;height:number;age:number};
export type Player={id:string;x:number;y:number;z:number;vx:number;vy:number;vz:number;yaw:number;appearance:Appearance;cooldown:number;dashTime:number;hit:number;impacts:Impact[];grab:Grip|null};
let impactSequence=0;
export type Snapshot={type:'state';tick:number;time:number;players:Player[]};
export function spawn(id:string,others:Player[],appearance:Appearance={primary:'#b6e778',secondary:'#b6e778',angle:0}):Player {
  let x=0,z=0,best=-1;
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6,px=Math.sin(a)*.17,pz=Math.cos(a)*.17;
    const distance=others.length?Math.min(...others.map(p=>Math.hypot(p.x-px,p.z-pz))):1;
    if(distance>best){best=distance;x=px;z=pz;}
  }
  return {id,x,y:0,z,vx:0,vy:0,vz:0,yaw:Math.atan2(-x,-z),appearance,cooldown:0,dashTime:0,hit:0,impacts:[],grab:null};
}
export function controls(value:unknown):Controls|null {
  if(!value||typeof value!=='object')return null;
  const v=value as Record<string,unknown>;
  if(typeof v.x!=='number'||typeof v.z!=='number'||!Number.isFinite(v.x)||!Number.isFinite(v.z)||typeof v.jump!=='boolean'||typeof v.dash!=='boolean')return null;
  const n=Math.max(1,Math.hypot(v.x,v.z));
  return {x:v.x/n,z:v.z/n,jump:v.jump,dash:v.dash};
}
export function simulate(players:Player[],inputs:Map<string,Controls>,dt=STEP) {
  for(let substep=0;substep<3;substep++)step(players,inputs,dt/3);
}
function step(players:Player[],inputs:Map<string,Controls>,dt:number) {
  for(const p of players) {
    const c=inputs.get(p.id)??{x:0,z:0,jump:false,dash:false};
    for(const impact of p.impacts)impact.age+=dt;
    p.impacts=p.impacts.filter(impact=>impact.age<.35);
    p.cooldown=Math.max(0,p.cooldown-dt);p.dashTime=Math.max(0,p.dashTime-dt);p.hit=Math.max(0,p.hit-dt*3);
    if(!p.grab&&Math.hypot(c.x,c.z)>.01)p.yaw=Math.atan2(c.x,c.z);
    if(!p.grab&&c.dash&&p.cooldown===0){p.vx+=Math.sin(p.yaw)*.48;p.vz+=Math.cos(p.yaw)*.48;p.cooldown=1.4;p.dashTime=.2;}
    if(!p.grab&&c.jump&&p.y===0)p.vy=.46;
    c.jump=false;c.dash=false;
    const drive=p.grab?0:1-Math.exp(-(p.y>0?.8:p.dashTime>0?2:9)*dt);
    p.vx+=(c.x*.145-p.vx)*drive;p.vz+=(c.z*.145-p.vz)*drive;
    pull(p,dt);
    p.vy-=2.4*dt;
    p.x+=p.vx*dt;p.z+=p.vz*dt;p.y=Math.max(0,p.y+p.vy*dt);
    if(p.y===0)p.vy=0;
  }
  // Two bounded contact passes resolve small clusters without unbounded solver work.
  for(let pass=0;pass<2;pass++)for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++) {
    const a=players[i],b=players[j];
    if(Math.abs(a.y-b.y)>.055)continue;
    const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
    if(d>=RADIUS*2)continue;
    const nx=d>1e-8?dx/d:1,nz=d>1e-8?dz/d:0,penetration=(RADIUS*2-d)/2;
    a.x-=nx*penetration;a.z-=nz*penetration;b.x+=nx*penetration;b.z+=nz*penetration;
    const closing=(b.vx-a.vx)*nx+(b.vz-a.vz)*nz;
    if(closing<0){const impulse=-closing*.9;a.vx-=nx*impulse;a.vz-=nz*impulse;b.vx+=nx*impulse;b.vz+=nz*impulse;
      a.hit=b.hit=Math.min(1,-closing*2);
      if(-closing>.035) {
        recordImpact(a,-nx,-nz,-closing,Math.max(.015,Math.min(.065,b.y-a.y+.045)));
        recordImpact(b,nx,nz,-closing,Math.max(.015,Math.min(.065,a.y-b.y+.045)));
      }}
  }
}

function recordImpact(p:Player,nx:number,nz:number,speed:number,height:number) {
  const seq=++impactSequence;
  p.impacts.push({seq,nx,nz,speed:Math.min(.8,speed),height,age:0});
  if(p.impacts.length>4)p.impacts.shift();
}

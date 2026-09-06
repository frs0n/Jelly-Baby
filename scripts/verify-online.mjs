import { beginGrab, moveGrab, releaseGrabs, expireGrabs, point } from '../src/multiplayer/grabs.ts';
import assert from 'node:assert/strict';
import { simulate,spawn,controls,RADIUS,STEP } from '../src/multiplayer/simulation.ts';
import { paletteFromDigest } from '../src/multiplayer/appearance.ts';
const input=(x=0,z=0,jump=false,dash=false)=>({x,z,jump,dash});
assert.equal(controls({x:Infinity,z:0,jump:false,dash:false}),null);
assert.equal(controls({x:0,z:NaN,jump:false,dash:false}),null);
assert.equal(controls({x:1,z:1,jump:'yes',dash:false}),null);
assert.ok(Math.abs(Math.hypot(...Object.values(controls(input(100,100))).slice(0,2))-1)<1e-10);
const a=spawn('a',[]),b=spawn('b',[a]);a.x=-.025;b.x=.025;a.z=b.z=0;a.vx=.4;b.vx=-.4;
simulate([a,b],new Map());assert.ok(a.vx<0&&b.vx>0,'head-on collision rebounds both players');assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=2*RADIUS-1e-9);
const jumper=spawn('jump',[]);const ins=new Map([['jump',input(0,0,true)]]);simulate([jumper],ins);assert.ok(jumper.y>0);assert.equal(ins.get('jump').jump,false);
for(let i=0;i<90;i++)simulate([jumper],ins);assert.equal(jumper.y,0);
const dasher=spawn('dash',[]);dasher.x=dasher.z=0;const dc=input(1,0,false,true);simulate([dasher],new Map([['dash',dc]]));assert.ok(dasher.vx>.4);assert.ok(dasher.cooldown>1);const velocity=dasher.vx;dc.dash=true;simulate([dasher],new Map([['dash',dc]]));assert.ok(dasher.vx<velocity,'cooldown prevents repeated impulses');
const cluster=Array.from({length:6},(_,i)=>spawn(String(i),[]));const inputs=new Map(cluster.map(p=>[p.id,input()]));
for(let i=0;i<3600;i++) {
 for(let j=0;j<cluster.length;j++){const p=cluster[j];inputs.set(p.id,input(Math.sin(i*.1+j),Math.cos(i*.15+j),i%60===0,i%50===0));}
 simulate(cluster,inputs,STEP);
 for(const p of cluster){assert.ok([p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite));assert.ok(p.y>=0);}
}
const digest=new Uint8Array(32).map((_,i)=>i*7);assert.deepEqual(paletteFromDigest(digest),paletteFromDigest(digest));
const changed=digest.slice();changed[0]++;assert.notDeepEqual(paletteFromDigest(digest),paletteFromDigest(changed));
assert.match(paletteFromDigest(digest).primary,/^#[0-9a-f]{6}$/);
for(let i=0;i<256;i++){const seed=new Uint8Array(32).fill(i);const p=paletteFromDigest(seed);assert.notEqual(p.primary,p.secondary,'automatic palette must always be a gradient');for(const color of [p.primary,p.secondary])for(const channel of color.slice(1).match(/../g))assert.ok(parseInt(channel,16)>=179,'generated colors stay light across the hue wheel');}
console.log('PASS: validation, rebound, jump, dash cooldown, 6-player 120-second stability, palette determinism');

const owner=spawn('owner',[]),victim=spawn('victim',[]),third=spawn('third',[]);
owner.x=owner.z=0;victim.x=.1;victim.z=0;third.x=.11;third.z=.01;
const group=[owner,victim,third],hit={x:.1,y:.05,z:0};
assert.equal(beginGrab(group,'owner','victim',hit,0),true);
assert.equal(beginGrab(group,'third','victim',hit,0),false,'one owner per target');
assert.equal(beginGrab(group,'victim','third',{x:.11,y:.05,z:.01},0),false,'held victim cannot create grab cycles');
for(let i=0;i<20;i++){moveGrab(group,'owner',{x:.17,y:.14,z:0},i*STEP*1000);simulate(group,new Map());}
assert.ok(victim.x>.12&&victim.y>.025,'drag lifts and pulls the remote player');
assert.ok(victim.grab);const releasedSpeed=Math.hypot(victim.vx,victim.vy,victim.vz);releaseGrabs(group,'owner');
assert.equal(victim.grab,null);assert.equal(Math.hypot(victim.vx,victim.vy,victim.vz),releasedSpeed,'release preserves throw momentum');
releaseGrabs(group,'victim');victim.x=2;
assert.equal(beginGrab(group,'owner','victim',{x:2,y:.04,z:0},1000),false,'remote grabs require proximity');
victim.x=.1;victim.y=0;
assert.equal(beginGrab(group,'owner','victim',hit,1000),true);expireGrabs(group,1701);assert.equal(victim.grab,null,'stale drag expires even if heartbeats continue');
assert.equal(point({x:Infinity,y:0,z:0}),null);assert.equal(point({x:1e300,y:0,z:0}),null);
assert.equal(beginGrab(group,'owner','owner',{x:0,y:.04,z:0},2000),true,'self drag permitted');
releaseGrabs(group,'owner');assert.equal(owner.grab,null);
console.log('PASS: drag range, ownership, spring lift, release momentum, stale cleanup, malformed commands and self-grab');

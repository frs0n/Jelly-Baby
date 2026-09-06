import assert from 'node:assert/strict';
import {SoftBody} from '../src/physics/soft-body.js';
import {Locomotion} from '../src/game/locomotion.ts';
import {ImpactResponse} from '../src/multiplayer/impact-response.ts';
import {spawn,simulate,STEP} from '../src/multiplayer/simulation.ts';
import {loadModel} from './load-model.mjs';
const a=spawn('a',[]),b=spawn('b',[]);a.x=-.029;b.x=.029;a.z=b.z=0;a.vx=.145;b.vx=-.145;
simulate([a,b],new Map());assert.ok(a.impacts.length);assert.ok(a.impacts[0].nx<0);assert.ok(b.impacts[0].nx>0);
const event=a.impacts[0],seq=event.seq;
for(let i=0;i<30;i++)simulate([a,b],new Map());assert.equal(a.impacts.length,0,'old contacts expire instead of replaying on room entry');
a.x=-.029;b.x=.029;a.vx=.145;b.vx=-.145;simulate([a,b],new Map());assert.ok(a.impacts.at(-1).seq>seq);
function axis(body) {
 const top=[0,0,0],feet=[0,0,0];let nt=0,nf=0;
 for(let i=0;i<body.mass.length;i++) {
  if(body.rest[i*3+1]>.05){nt++;for(let k=0;k<3;k++)top[k]+=body.x[i*3+k];}
  if(body.rest[i*3+1]<.014){nf++;for(let k=0;k<3;k++)feet[k]+=body.x[i*3+k];}
 }
 return Math.atan2(Math.hypot(top[0]/nt-feet[0]/nf,top[2]/nt-feet[2]/nf),top[1]/nt-feet[1]/nf)*180/Math.PI;
}
for(const speed of [.07,.28,.65]) {
 const body=new SoftBody(loadModel()),rig=new Locomotion(body),response=new ImpactResponse(),player=spawn('test',[]);
 const step=()=>{rig.step(1/240);body.step(1/240);rig.afterStep();};
 for(let i=0;i<240;i++)step();
 player.impacts=[{seq:1,nx:1,nz:0,speed,height:.045,age:0}];response.update(body,rig,player);
 const velocity=body.velocity.slice();response.update(body,rig,player);assert.deepEqual(body.velocity,velocity,'snapshot repetition does not repeat impulse');
 assert.ok(Math.max(...body.velocity.filter((_,i)=>i%3===0))-Math.min(...body.velocity.filter((_,i)=>i%3===0))>.03,'contact creates internal deformation, not a rigid translation');
 let peak=0;
 for(let i=0;i<960;i++){step();peak=Math.max(peak,axis(body));assert.ok(body.isFinite());assert.ok(body.minimumJacobian()>=.12);}
 if(speed>.16)assert.ok(peak>65,'walking collision topples the original soft body');
 else assert.ok(peak<50,'gentle bumps do not knock the body over');
 assert.ok(axis(body)<10,'gradual muscle recovery stands up again');
 console.log(`PASS: impact ${speed} m/s, peak tilt ${peak.toFixed(1)}°, recovered ${axis(body).toFixed(1)}°`);
 body.surface.geometry.dispose();body.cage.opticalSurface.geometry.dispose();
}
// Fast opposing bodies cannot cross within a server tick.
a.x=-.04;b.x=.04;a.vx=1.2;b.vx=-1.2;a.dashTime=b.dashTime=.2;
simulate([a,b],new Map(),STEP);assert.ok(a.x<b.x);

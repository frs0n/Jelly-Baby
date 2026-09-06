import assert from 'node:assert/strict';
import { RemoteActor } from '../src/multiplayer/remote-actor.ts';
import { spawn } from '../src/multiplayer/simulation.ts';
import { model,worker } from './remote-worker-harness.mjs';
const actor=new RemoteActor(model),state=spawn('remote',[]);state.x=state.z=state.yaw=0;
let frame=actor.advance(1/60,state,null);
assert.equal(frame.physicsSteps,2);
assert.equal(frame.lengths[0],actor.body.surface.positions.length,'remote skin resolution');
assert.equal(frame.lengths[0],model.manifest.layout.opticalPositions.length,'remote skin uses the existing optical surface');
assert.ok(frame.lengths[0]<model.manifest.layout.positions.length/7,'at least 7x fewer body vertices');
assert.ok(frame.lengths.length>5,'all original face meshes included');
const original=new Float32Array(frame.buffer).slice();
for(let i=0;i<90;i++)frame=actor.advance(1/60,state,{hand:1,target:{x:.20,y:.08,z:0}},frame.buffer);
assert.ok(Math.hypot(frame.handPoint.x-.20,frame.handPoint.y-.08,frame.handPoint.z)<.014,'existing hand reaches target');
assert.ok(actor.body.isFinite());assert.ok(actor.body.minimumJacobian()>=.12);
assert.notDeepEqual(new Float32Array(frame.buffer).subarray(0,frame.lengths[0]),original.subarray(0,frame.lengths[0]),'skin deforms through original solver');
actor.advance(1/60,state,null,frame.buffer);assert.equal(actor.body.grabs.length,0,'release removes all hand and foot constraints');
state.grab={by:'other',hand:1,anchor:{x:0,y:.055,z:.02},target:{x:.04,y:.12,z:.02},updated:0};
for(let i=0;i<60;i++)frame=actor.advance(1/60,state,null,frame.buffer);
assert.ok(frame.gripPoint.y>.075);assert.ok(actor.body.minimumJacobian()>=.12);
// Once asleep and between expressions, visitors publish no vertex buffer.
const dragFixture=state.grab;actor.hand.clear();state.grab=null;state.vx=state.vy=state.vz=0;
actor.body.reset();actor.baby.resetFace();
frame=actor.advance(0,state,null,frame.buffer);
assert.ok(frame.buffer);const reusable=frame.buffer;
for(let i=0;i<20;i++){frame=actor.advance(0,state,null,i===0?reusable:undefined);assert.equal(frame.buffer,undefined,'idle frame does not copy or upload vertices');}
actor.body.x[0]+=.00001;actor.body.surfaceDirty=true;
frame=actor.advance(0,state,null);assert.equal(frame.buffer,reusable,'idle worker keeps the spare until it needs vertices again');
actor.dispose();state.grab=dragFixture;
// Exercise real worker threads, reusable transfer buffers, and five concurrent visitors.
const workers=Array.from({length:5},worker);
async function send(w,message,transfer=[]) {
 return new Promise((resolve,reject)=>{
  const timer=globalThis.setTimeout(()=>reject(new Error('Worker timeout')),10000);
  w.onerror=e=>{globalThis.clearTimeout(timer);reject(new Error(e.message));};
  w.onmessage=({data})=>{globalThis.clearTimeout(timer);if(data.type==='error')reject(new Error(data.message));else resolve(data);};
  w.postMessage(message,transfer);
 });
}
try {
 await Promise.all(workers.map(w=>send(w,{type:'init',model})));
 const start=performance.now();let frames=await Promise.all(workers.map(w=>send(w,{type:'frame',dt:1/60,state:{...state,grab:null},reach:null})));
 for(let i=0;i<15;i++)frames=await Promise.all(workers.map((w,j)=>{const buffer=frames[j].buffer;const response=send(w,{type:'frame',dt:1/60,state:{...state,grab:null,vx:.1},reach:null,buffer},[buffer]);assert.equal(buffer.byteLength,0);return response;}));
 // Five simultaneous victims stay bounded at the production 30 Hz cadence.
 for(let i=0;i<30;i++)frames=await Promise.all(workers.map((w,j)=>{
  const buffer=frames[j].buffer;
  return send(w,{type:'frame',dt:1/30,state:{...state,grab:{...state.grab,target:{x:.04+Math.sin(i*.2+j)*.015,y:.12,z:.02}}},reach:null,buffer},[buffer]);
 }));
 assert.ok(frames.every(f=>f.physicsSteps===4&&f.gripPoint&&Number.isFinite(f.gripPoint.y)));
 assert.ok(frames.reduce((sum,f)=>sum+f.buffer.byteLength,0)<2e6,'five deformed skins fit in 2 MB per update');
 frames=await Promise.all(workers.map((w,j)=>send(w,{type:'frame',dt:1/30,state:{...state,grab:null},reach:null,buffer:frames[j].buffer},[frames[j].buffer])));
 assert.ok(frames.every(f=>f.gripPoint===null),'all five victims release constraints');
 console.log(`PASS: 120 Hz FEM, lightweight skin/face meshes, hand reaches within 14 mm, release, victim deformation, five concurrent drags/releases and transfer reuse (${(performance.now()-start).toFixed(0)} ms for worker scenarios)`);
}finally{await Promise.all(workers.map(w=>w.terminate()));}

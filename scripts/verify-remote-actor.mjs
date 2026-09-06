import assert from 'node:assert/strict';
import { RemoteActor } from '../src/multiplayer/remote-actor.ts';
import { spawn } from '../src/multiplayer/simulation.ts';
import { model,worker } from './remote-worker-harness.mjs';
const actor=new RemoteActor(model),state=spawn('remote',[]);state.x=state.z=state.yaw=0;
let frame=actor.advance(1/60,state,null);
assert.equal(frame.physicsSteps,4);
assert.equal(frame.lengths[0],actor.body.surface.positions.length,'full original skin resolution');
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
actor.dispose();
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
 console.log(`PASS: full FEM/face meshes, hand reaches within 14 mm, release, victim deformation, five workers and transfer reuse (${((performance.now()-start)/16).toFixed(1)} ms per five-worker batch including initial frames)`);
}finally{await Promise.all(workers.map(w=>w.terminate()));}

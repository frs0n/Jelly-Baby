import assert from 'node:assert/strict';
import { RoomClient } from '../src/multiplayer/client.ts';
import { Visitors } from '../src/multiplayer/visitors.ts';
import { spawn } from '../src/multiplayer/simulation.ts';
import { Scene,Group,Vector3 } from 'three/webgpu';
const originalPerformance=globalThis.performance;let now=0;
globalThis.performance={now:()=>now};
try {
 const sent=[],client=new RoomClient();client.socket={readyState:globalThis.WebSocket.OPEN,send:p=>sent.push(JSON.parse(p))};
 const input={x:1,z:0,jump:false,dash:false},target={x:.05,y:.1,z:0};
 for(let i=0;i<60;i++){now=i*1000/60;client.input(input);client.moveGrab(target);}
 assert.equal(sent.filter(p=>p.type==='input').length,5,'unchanged input refreshes at 5 Hz');
 assert.equal(sent.filter(p=>p.type==='grab-move').length,5,'stationary drag refreshes at 5 Hz');
 client.input({...input,x:0});assert.equal(sent.at(-1).x,0,'stop is immediate');
 client.input({...input,jump:true});client.input({...input,jump:true});assert.ok(sent.slice(-2).every(p=>p.jump),'never discard action edges');
 client.moveGrab({...target,y:.11});client.endGrab();assert.deepEqual(sent.slice(-2).map(p=>p.type),['grab-move','grab-end'],'final target precedes release');
}finally{globalThis.performance=originalPerformance;}
// A slow worker must never accumulate commands; high refresh screens must not
// multiply deformation/upload work. No GPU or development server is required.
for(const hz of [60,120,144]) {
 const calls=[],worker={postMessage:p=>calls.push(p),terminate(){}};
 const visitors=new Visitors(new Scene(),new Group(),new Vector3(),{worker:()=>worker,model:new Promise(()=>{})});
 const self=spawn('self',[]),remote=spawn('remote',[]);remote.x=.1;remote.z=0;
 visitors.sync([self,remote],self.id,0);
 const v=visitors.visitors.get(remote.id);v.ready=true;v.frame={root:{x:remote.x,y:remote.y,z:remote.z}};
 for(let i=0;i<hz;i++){visitors.update(1/hz,0);v.busy=false;}
 assert.ok(calls.length<=30&&calls.length>=24,`${hz} Hz must stay within 30 worker updates/s`);
 const count=calls.length;v.busy=true;for(let i=0;i<hz;i++)visitors.update(1/hz,0);assert.equal(calls.length,count,'busy worker cannot queue stale frames');
 visitors.beginPrediction(remote.id,new Vector3(.1,.045,0));visitors.predictGrab(remote.id,new Vector3(.13,.09,0));
 v.busy=false;visitors.update(1/30,0);assert.equal(calls.at(-1).state.grab.by,self.id,'drag predicts before server acknowledgement');
 assert.equal(calls.at(-1).state.grab.target.y,.09);
 visitors.clearPrediction();v.busy=false;visitors.update(1/30,0);assert.equal(calls.at(-1).state.grab,null,'release removes speculative constraint');
 visitors.dispose();
}
console.log('PASS: input/drag deduplication, 200 ms leases, stop/jump/release edges, bounded work at 60/120/144 Hz, no busy-worker queue, local pre-ack prediction and release');

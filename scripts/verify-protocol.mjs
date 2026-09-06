import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { StateEncoder, StateDecoder } from '../src/multiplayer/protocol.ts';
import { spawn, simulate } from '../src/multiplayer/simulation.ts';
import { beginGrab,moveGrab,releaseGrabs } from '../src/multiplayer/grabs.ts';
const players=Array.from({length:6},(_,i)=>spawn(`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,[]));
players.forEach((p,i)=>{p.x=i*.065;p.z=0;});
const encoder=new StateEncoder(),decoder=new StateDecoder();
const initial=encoder.encode(players,0,0,true);const first=decoder.decode(initial);
assert.equal(first.players.length,6);
assert.deepEqual(encoder.encode(players,1,1).change,[],'idle room sends no repeated fields');
const inputs=new Map(players.map((p,i)=>[p.id,{x:Math.sin(i),z:Math.cos(i),jump:false,dash:false}]));
let oldBytes=0,newBytes=0;
assert.ok(beginGrab(players,players[0].id,players[1].id,{x:players[1].x,y:.045,z:0},0));
for(let tick=1;tick<=180;tick++) {
 moveGrab(players,players[0].id,{x:.07+Math.sin(tick*.1)*.01,y:.075,z:0},tick*1000/30);
 simulate(players,inputs);
 if(tick%2)continue;
 const packet=encoder.encode(players,tick,tick*1000/30),snapshot=decoder.decode(JSON.parse(JSON.stringify(packet)));
 assert.equal(packet.add.length,0,'appearance and identity only sent on entry');
 for(const p of players){const decoded=snapshot.players.find(q=>q.id===p.id);for(const key of ['x','y','z','vx','vy','vz','yaw'])assert.ok(Math.abs(p[key]-decoded[key])<=.000050001);assert.equal(decoded.grab?.by,p.grab?.by);assert.equal(decoded.impacts.length,p.impacts.length);}
 oldBytes+=Buffer.byteLength(JSON.stringify({type:'state',tick,time:packet.time,players},(_key,v)=>typeof v==='number'?Math.round(v*100000)/100000:v));
 newBytes+=Buffer.byteLength(JSON.stringify(packet));
}
assert.equal(first.players[1].grab,null,'old snapshots must not mutate');
releaseGrabs(players,players[0].id);players.shift();
let snapshot=decoder.decode(encoder.encode(players,181,6000));assert.equal(snapshot.players.length,5);assert.ok(snapshot.players.every(p=>!p.grab));
players.push(spawn('replacement',players));snapshot=decoder.decode(encoder.encode(players,182,6033));assert.ok(snapshot.players.some(p=>p.id==='replacement'));
const newcomer=new StateDecoder(),baseline=encoder.encode(players,183,6066,true);
assert.deepEqual(newcomer.decode(baseline),decoder.decode(baseline),'join baseline works for existing and new clients');
const held=players[0];beginGrab(players,held.id,held.id,{x:held.x,y:held.y+.035,z:held.z},6100);
decoder.decode(encoder.encode(players,184,6100));held.grab.updated=6200;
assert.equal(encoder.encode(players,185,6200).change.length,0,'lease timestamp stays server-side');
assert.ok(newBytes<oldBytes*.4,`motion deltas should reduce bytes >60%: ${newBytes}/${oldBytes}`);
console.log(`PASS: six-player motion/drag delta roundtrip, <=0.05 mm error, immutable snapshots, leave/slot reuse/join, lease exclusion; ${oldBytes} → ${newBytes} bytes (${(100*(1-newBytes/oldBytes)).toFixed(1)}% reduction)`);

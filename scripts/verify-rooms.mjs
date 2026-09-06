import assert from 'node:assert/strict';
import { StateDecoder } from '../src/multiplayer/protocol.ts';
import { FACILITY_NONE, FACILITY_SWING, facilityAnchor } from '../src/multiplayer/facility-state.ts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"jelly-baby-test",modules:true,scriptPath:fileURLToPath(new URL('../work/worker/index.js',import.meta.url)),compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOMS:{className:'JellyRoom',useSQLite:true},MATCHMAKER:{className:'Matchmaker',useSQLite:true}}}]}));
const sockets=[];
async function seat(fingerprint='a'.repeat(64),exclude='',ip='203.0.113.7') {
 const response=await mf.dispatchFetch(`https://example.com/api/join?exclude=${exclude}`,{method:'POST',headers:{'X-Jelly-Fingerprint':fingerprint,'CF-Connecting-IP':ip}});
 assert.equal(response.status,200,await response.clone().text());return response.json();
}
async function connect(ticket) {
 const response=await mf.dispatchFetch(`https://example.com/api/room/${ticket.room}?ticket=${ticket.ticket}`,{headers:{Upgrade:'websocket'}});
 assert.equal(response.status,101);const ws=response.webSocket;const client={ws,id:'',states:[],grabs:[],facilities:[]};const decoder=new StateDecoder();sockets.push(ws);
 ws.addEventListener('message',e=>{const p=JSON.parse(e.data);if(p.type==='welcome')client.id=p.id;else if(p.type==='grab-result')client.grabs.push(p);else if(p.type==='facility-result')client.facilities.push(p);else if(p.type==='state')client.states.push(decoder.decode(p));});ws.accept();
 await until(()=>client.id&&client.states.length);return client;
}
async function until(check,timeout=3000){const start=Date.now();while(!check()){assert.ok(Date.now()-start<timeout,'timed out waiting for room state');await sleep(15);}}
const seen=(client,id)=>client.states.at(-1).players.find(p=>p.id===id);
// Movement input expires after 350 ms, so a walk has to keep steering.
async function walkTo(client,x,z,timeout=15000) {
 const start=Date.now();
 for(;;) {
  const me=seen(client,client.id),d=Math.hypot(x-me.x,z-me.z);
  if(d<=.085)return me;
  assert.ok(Date.now()-start<timeout,`timed out walking to the facility, still ${d.toFixed(3)} m away`);
  client.ws.send(JSON.stringify({type:'input',x:(x-me.x)/d,z:(z-me.z)/d,jump:false,dash:false,phase:0}));
  await sleep(60);
 }
}
try {
 const seats=await Promise.all(Array.from({length:7},(_,i)=>seat(i.toString(16).repeat(64),'',i?'203.0.113.'+(7+i):'203.0.113.7')));
 assert.equal(new Set(seats.slice(0,6).map(s=>s.room)).size,1,'six concurrent arrivals share a table');assert.notEqual(seats[6].room,seats[0].room,'seventh arrival gets another table');
 const clients=await Promise.all(seats.slice(0,6).map(connect));const a=clients[0],b=clients[1];
 await until(()=>a.states.at(-1).players.length===6&&b.states.at(-1).players.length===6);
 assert.ok(a.states.every(s=>s.players.length<=6));
 const replay=await mf.dispatchFetch(`https://example.com/api/room/${seats[0].room}?ticket=${seats[0].ticket}`,{headers:{Upgrade:'websocket'}});assert.equal(replay.status,401,'one-use seat');
 const before=a.states.at(-1).players.find(p=>p.id===a.id);a.ws.send(JSON.stringify({type:'input',x:-1,z:0,jump:true,dash:true}));
 await until(()=>a.states.at(-1).players.find(p=>p.id===a.id).y>0);
 await until(()=>b.states.at(-1).players.some(p=>p.id===a.id&&p.y>0));
 const after=a.states.at(-1).players.find(p=>p.id===a.id);assert.notEqual(after.x,before.x);
 const serialized=JSON.stringify(after);assert.ok(!serialized.includes('203.0.113.7')&&!serialized.includes('fingerprint')&&!serialized.includes('name'));
 a.ws.send(JSON.stringify({type:'input',x:0,z:0,jump:false,dash:false}));

 // A ride is visible to everyone: the authority seats the rider on the anchor
 // and relays the one scalar that describes the ride to every other client.
 const swing=facilityAnchor(FACILITY_SWING),rider=clients[2];
 await walkTo(a,swing.x,swing.z);
 a.ws.send(JSON.stringify({type:'facility-enter',facility:FACILITY_SWING}));
 await until(()=>a.facilities.at(-1)?.accepted===true);
 await until(()=>seen(b,a.id).facility===FACILITY_SWING,5000);
 const seated=seen(b,a.id);
 assert.ok(Math.abs(seated.x-swing.x)<1e-4&&Math.abs(seated.z-swing.z)<1e-4,'observers see the rider parked on the anchor');
 assert.equal(Math.hypot(seated.vx,seated.vy,seated.vz),0);
 a.ws.send(JSON.stringify({type:'input',x:0,z:0,jump:false,dash:false,phase:.62}));
 await until(()=>Math.abs(seen(b,a.id).phase-.62)<1e-3,5000);
 a.ws.send(JSON.stringify({type:'input',x:0,z:0,jump:false,dash:false,phase:-.44}));
 await until(()=>Math.abs(seen(b,a.id).phase+.44)<1e-3,5000);
 assert.equal(seen(b,a.id).facility,FACILITY_SWING,'the ride survives a phase reversal');
 // Standing beside an occupied swing is not enough to board it.
 await walkTo(rider,swing.x,swing.z);
 rider.ws.send(JSON.stringify({type:'facility-enter',facility:FACILITY_SWING}));
 await until(()=>rider.facilities.at(-1)?.accepted===false);
 assert.equal(seen(b,rider.id).facility,FACILITY_NONE,'the seat still belongs to its rider');
 assert.equal(seen(b,a.id).facility,FACILITY_SWING);
 a.ws.send(JSON.stringify({type:'facility-leave'}));
 await until(()=>seen(b,a.id).facility===FACILITY_NONE,5000);
 const stepped=seen(b,a.id);
 assert.ok(Math.abs(stepped.x-(swing.x+swing.exit.x))<1e-3,'observers see the dismount land on the approach side');
 assert.equal(stepped.phase,0);
 rider.ws.send(JSON.stringify({type:'facility-enter',facility:FACILITY_SWING}));
 await until(()=>rider.facilities.at(-1)?.accepted===true,5000);
 await until(()=>seen(b,rider.id).facility===FACILITY_SWING,5000);
 rider.ws.send(JSON.stringify({type:'facility-leave'}));
 await until(()=>seen(b,rider.id).facility===FACILITY_NONE,5000);
 a.ws.send(JSON.stringify({type:'input',x:0,z:0,jump:false,dash:false,phase:0}));

 const local=a.states.at(-1).players.find(p=>p.id===a.id);
 const target=a.states.at(-1).players.filter(p=>p.id!==a.id).sort((p,q)=>Math.hypot(p.x-local.x,p.z-local.z)-Math.hypot(q.x-local.x,q.z-local.z))[0];
 a.ws.send(JSON.stringify({type:'grab-start',target:target.id,point:{x:target.x,y:target.y+.045,z:target.z}}));
 await until(()=>a.grabs.at(-1)?.accepted===true);
 await until(()=>b.states.at(-1).players.find(p=>p.id===target.id)?.grab?.by===a.id);
 a.ws.send(JSON.stringify({type:'grab-move',point:{x:target.x+.03,y:target.y+.12,z:target.z}}));
 await until(()=>b.states.at(-1).players.find(p=>p.id===target.id).y>target.y+.01);
 a.ws.send(JSON.stringify({type:'grab-end'}));
 await until(()=>b.states.at(-1).players.find(p=>p.id===target.id).grab===null);
 const own=a.states.at(-1).players.find(p=>p.id===a.id);
 a.ws.send(JSON.stringify({type:'grab-start',target:a.id,point:{x:own.x,y:own.y+.045,z:own.z}}));
 await until(()=>b.states.at(-1).players.find(p=>p.id===a.id)?.grab?.by===a.id);
 a.ws.close(1000);await until(()=>b.states.at(-1).players.length===5);assert.ok(b.states.at(-1).players.every(p=>p.grab?.by!==a.id),'disconnect releases all grips');
 const replacement=await connect(await seat('0'.repeat(64),seats[6].room));
 assert.deepEqual(replacement.states.at(-1).players.find(p=>p.id===replacement.id).appearance,before.appearance,'same IP/fingerprint yields same palette');
 const other=b.states.at(-1).players.find(p=>p.id===b.id);assert.notDeepEqual(other.appearance,before.appearance);
 const switched=await seat('f'.repeat(64),seats[0].room);assert.notEqual(switched.room,seats[0].room);
 const forged=new Promise(resolve=>clients[3].ws.addEventListener('close',resolve,{once:true}));
 clients[3].ws.send(JSON.stringify({type:'facility-enter',facility:99}));await forged;
 const closed=new Promise(resolve=>b.ws.addEventListener('close',resolve,{once:true}));b.ws.send(JSON.stringify({type:'chat',text:'no chat'}));await closed;
 const cross=await mf.dispatchFetch('https://example.com/api/join',{method:'POST',headers:{Origin:'https://bad.example','X-Jelly-Fingerprint':'f'.repeat(64)}});assert.equal(cross.status,403);
 const invalid=await mf.dispatchFetch('https://example.com/api/join',{method:'POST'});assert.equal(invalid.status,400);
 const flood=await Promise.all(Array.from({length:100},(_,i)=>mf.dispatchFetch('https://example.com/api/join',{method:'POST',headers:{'X-Jelly-Fingerprint':i.toString(16).padStart(2,'0').repeat(32),'CF-Connecting-IP':'198.51.100.42'}})));
 assert.equal(flood.filter(response=>response.status===200).length,8,'one IP can reserve at most eight seats across all rooms');
 assert.ok(flood.every(response=>response.status===200||response.status===429),'flooded joins are rejected without creating more rooms');
 console.log('PASS: concurrent matchmaking, capacity, websocket broadcast, movement/jump/dash, visible facility rides with exclusive occupancy and relayed phase, remote drag/lift/release and self-drag, leave/reuse, room switching, ticket replay, deterministic private palettes, no chat, forged facility rejection, origin validation, per-identity/IP connection caps and join flood protection');
} finally {for(const ws of sockets)try{ws.close();}catch{/* already closed */}await mf.dispose();}

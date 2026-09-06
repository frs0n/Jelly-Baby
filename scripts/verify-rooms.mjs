import assert from 'node:assert/strict';
import { StateDecoder } from '../src/multiplayer/protocol.ts';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"jelly-baby-test",modules:true,scriptPath:fileURLToPath(new URL('../work/worker/index.js',import.meta.url)),compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'],durableObjects:{ROOMS:{className:'JellyRoom',useSQLite:true},MATCHMAKER:{className:'Matchmaker',useSQLite:true}}}]}));
const sockets=[];
async function seat(fingerprint='a'.repeat(64),exclude='') {
 const response=await mf.dispatchFetch(`https://example.com/api/join?exclude=${exclude}`,{method:'POST',headers:{'X-Jelly-Fingerprint':fingerprint,'CF-Connecting-IP':'203.0.113.7'}});
 assert.equal(response.status,200,await response.clone().text());return response.json();
}
async function connect(ticket) {
 const response=await mf.dispatchFetch(`https://example.com/api/room/${ticket.room}?ticket=${ticket.ticket}`,{headers:{Upgrade:'websocket'}});
 assert.equal(response.status,101);const ws=response.webSocket;const client={ws,id:'',states:[],grabs:[]};const decoder=new StateDecoder();sockets.push(ws);
 ws.addEventListener('message',e=>{const p=JSON.parse(e.data);if(p.type==='welcome')client.id=p.id;else if(p.type==='grab-result')client.grabs.push(p);else if(p.type==='state')client.states.push(decoder.decode(p));});ws.accept();
 await until(()=>client.id&&client.states.length);return client;
}
async function until(check,timeout=3000){const start=Date.now();while(!check()){assert.ok(Date.now()-start<timeout,'timed out waiting for room state');await sleep(15);}}
try {
 const seats=await Promise.all(Array.from({length:7},(_,i)=>seat(i.toString(16).repeat(64))));
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
 const closed=new Promise(resolve=>b.ws.addEventListener('close',resolve,{once:true}));b.ws.send(JSON.stringify({type:'chat',text:'no chat'}));await closed;
 const cross=await mf.dispatchFetch('https://example.com/api/join',{method:'POST',headers:{Origin:'https://bad.example','X-Jelly-Fingerprint':'f'.repeat(64)}});assert.equal(cross.status,403);
 const invalid=await mf.dispatchFetch('https://example.com/api/join',{method:'POST'});assert.equal(invalid.status,400);
 console.log('PASS: concurrent matchmaking, capacity, websocket broadcast, movement/jump/dash, remote drag/lift/release and self-drag, leave/reuse, room switching, ticket replay, deterministic private palettes, no chat, origin validation');
} finally {for(const ws of sockets)try{ws.close();}catch{/* already closed */}await mf.dispose();}

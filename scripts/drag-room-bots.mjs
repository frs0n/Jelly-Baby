// Local real-WebSocket load: place five neighbours near the human test client,
// then have each repeatedly stretch its own skin. Never targets a production URL.
import WebSocket from 'ws';
import { StateDecoder } from '../src/multiplayer/protocol.ts';
const base='http://localhost:8787',bots=[];
for(let i=0;i<5;i++) {
 const seat=await (await globalThis.fetch(`${base}/api/join`,{method:'POST',headers:{'X-Jelly-Fingerprint':String(i+1).repeat(64)}})).json();
 const ws=new WebSocket(`ws://localhost:8787/api/room/${seat.room}?ticket=${seat.ticket}`),decoder=new StateDecoder();
 const bot={ws,id:'',players:[],held:false,index:i,ready:false};bots.push(bot);
 ws.on('message',raw=>{const p=JSON.parse(raw);if(p.type==='welcome')bot.id=p.id;else if(p.type==='state')bot.players=decoder.decode(p).players;});
 await new Promise(resolve=>ws.on('open',resolve));
}
let elapsed=0;
const timer=globalThis.setInterval(()=>{
 elapsed+=1/30;
 const ids=new Set(bots.map(b=>b.id));
 for(const b of bots) {
  if(b.ws.readyState!==WebSocket.OPEN)continue;
  const self=b.players.find(p=>p.id===b.id),human=b.players.find(p=>!ids.has(p.id));if(!self||!human)continue;
  const send=p=>b.ws.send(JSON.stringify(p));
  if(!b.ready){
   const angle=Math.PI*2*b.index/5,tx=human.x+Math.cos(angle)*.115,tz=human.z+Math.sin(angle)*.115;
   const dx=tx-self.x,dz=tz-self.z,d=Math.hypot(dx,dz);
   if(d>.014){send({type:'input',x:dx/d*.8,z:dz/d*.8,jump:false,dash:false});continue;}
   b.ready=true;send({type:'input',x:0,z:0,jump:false,dash:false});
  }
  if(!self.grab){send({type:'grab-start',target:b.id,point:{x:self.x,y:self.y+.045,z:self.z}});}
  else send({type:'grab-move',point:{x:self.x+Math.sin(elapsed*2+b.index)*.025,y:.075+Math.sin(elapsed*3+b.index)*.015,z:self.z+Math.cos(elapsed*2+b.index)*.025}});
 }
},1000/30);
console.log('Five local WebSocket players running; Ctrl-C stops and releases seats.');
process.on('SIGINT',()=>{globalThis.clearInterval(timer);for(const b of bots)b.ws.close();});

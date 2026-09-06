import { StateEncoder } from '../src/multiplayer/protocol.ts';
import { beginGrab, moveGrab, releaseGrabs, expireGrabs, point } from '../src/multiplayer/grabs.ts';
import { paletteFromDigest, type Appearance } from '../src/multiplayer/appearance.ts';
import { DurableObject } from 'cloudflare:workers';
import { CAPACITY, STEP, controls, simulate, spawn, type Controls, type Player } from '../src/multiplayer/simulation.ts';

type Session={player:Player;ticket:string;input:Controls;seen:number;budget:number;budgetTime:number;inputTime:number;leaseTime:number};
const TICKET_TTL=20000,LEASE_TTL=30000,LEASE_RENEWAL=10000;
const MAX_SESSIONS_PER_IDENTITY=2,MAX_SESSIONS_PER_IP=8,MAX_JOINS_PER_IP_PER_MINUTE=16;
export class JellyRoom extends DurableObject<Env> {
  private sessions=new Map<WebSocket,Session>();
  private timer:ReturnType<typeof setInterval>|undefined;
  private tick=0;
  private encoder=new StateEncoder();
  private lastBroadcast=0;
  // Reservations persist until consumed so an idle room may safely hibernate.
  reserve(appearance:Appearance) {
    const sql=this.ctx.storage.sql,now=Date.now();
    sql.exec('DELETE FROM seats WHERE expires < ?',now);
    const count=sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM seats').one().n;
    if(this.sessions.size+count>=CAPACITY)return null;
    const ticket=crypto.randomUUID();sql.exec('INSERT INTO seats VALUES (?,?,?)',ticket,now+TICKET_TTL,JSON.stringify(appearance));
    return ticket;
  }
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS seats(ticket TEXT PRIMARY KEY,expires INTEGER,appearance TEXT)');}
  async fetch(request:Request) {
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
    const ticket=new URL(request.url).searchParams.get('ticket');
    if(!ticket)return new Response('Seat expired. Join again.',{status:401});
    const seat=this.ctx.storage.sql.exec('DELETE FROM seats WHERE ticket=? AND expires>=? RETURNING appearance',ticket,Date.now()).toArray();
    if(!seat.length)return new Response('Seat expired. Join again.',{status:401});
    if(!await this.env.MATCHMAKER.getByName('public-v1').claim(ticket))return new Response('Seat expired. Join again.',{status:401});
    if(this.sessions.size>=CAPACITY){await this.env.MATCHMAKER.getByName('public-v1').release(ticket);return new Response('Table full',{status:409});}
    const pair=new WebSocketPair(),client=pair[0],socket=pair[1];socket.accept();
    const player=spawn(crypto.randomUUID(),[...this.sessions.values()].map(s=>s.player),JSON.parse(String(seat[0].appearance)) as Appearance);
    const now=Date.now();
    const s:Session={player,ticket,input:{x:0,z:0,jump:false,dash:false},seen:now,budget:80,budgetTime:now,inputTime:now,leaseTime:now};
    this.sessions.set(socket,s);
    socket.addEventListener('message',e=>{
      const now=Date.now();s.budget=Math.min(80,s.budget+(now-s.budgetTime)*.09);s.budgetTime=now;
      if(--s.budget<0){socket.close(1008,'Too many messages');this.leave(socket);return;}
      if(typeof e.data!=='string'||e.data.length>512){socket.close(1009,'Invalid message');this.leave(socket);return;}
      let data;try{data=JSON.parse(e.data);}catch{socket.close(1008,'Invalid JSON');this.leave(socket);return;}
      if(!data||typeof data!=='object'){socket.close(1008,'Invalid command');this.leave(socket);return;}
      if(data.type==='input') {
        const input=controls(data);if(!input){socket.close(1008,'Invalid input');this.leave(socket);return;}
        s.inputTime=now;input.jump ||= s.input.jump;input.dash ||= s.input.dash;s.input=input;
      }else if(data.type==='grab-start') {
        const hit=point(data.point);
        if(!hit||typeof data.target!=='string'||data.target.length>36){socket.close(1008,'Invalid grab');this.leave(socket);return;}
        const accepted=beginGrab(this.players(),player.id,data.target,hit,now);
        socket.send(JSON.stringify({type:'grab-result',target:data.target,accepted}));
        this.broadcast();
      }else if(data.type==='grab-move') {
        const target=point(data.point);
        if(!target){socket.close(1008,'Invalid target');this.leave(socket);return;}
        moveGrab(this.players(),player.id,target,now);
      }else if(data.type==='grab-end') {
        releaseGrabs(this.players().filter(p=>p.grab?.by===player.id),player.id);this.broadcast();
      }else if(data.type==='reset') {
        releaseGrabs(this.players(),player.id);
        Object.assign(player,spawn(player.id,[...this.sessions.values()].filter(other=>other!==s).map(other=>other.player),player.appearance));
        s.input={x:0,z:0,jump:false,dash:false};
      }else if(data.type==='ping'&&typeof data.t==='number'&&Number.isFinite(data.t)){socket.send(JSON.stringify({type:'pong',t:data.t}));
      }else if(data.type!=='ping'){socket.close(1008,'Unknown command');this.leave(socket);return;}
      s.seen=now;
    });
    socket.addEventListener('close',()=>this.leave(socket));socket.addEventListener('error',()=>this.leave(socket));
    socket.send(JSON.stringify({type:'welcome',id:player.id,capacity:CAPACITY}));
    this.broadcast(true);
    // Real-time physics needs a live timer; stop it as soon as the last player leaves.
    if(!this.timer)this.timer=setInterval(()=>this.advance(),STEP*1000);
    return new Response(null,{status:101,webSocket:client});
  }
  private players(){return [...this.sessions.values()].map(s=>s.player);}
  private leave(socket:WebSocket) {
    const session=this.sessions.get(socket);if(session)releaseGrabs(this.players(),session.player.id);
    this.sessions.delete(socket);
    if(session)void this.env.MATCHMAKER.getByName('public-v1').release(session.ticket);
    if(!this.sessions.size&&this.timer){clearInterval(this.timer);this.timer=undefined;}
    this.broadcast();
  }
  private advance() {
    const now=Date.now();
    for(const [ws,s] of this.sessions) {
      if(now-s.seen>15000){ws.close(1001,'Inactive');this.leave(ws);}
      else {
        if(now-s.inputTime>350)s.input={x:0,z:0,jump:false,dash:false};
        if(now-s.leaseTime>=LEASE_RENEWAL){s.leaseTime=now;void this.env.MATCHMAKER.getByName('public-v1').touch(s.ticket);}
      }
    }
    expireGrabs(this.players(),now);
    simulate([...this.sessions.values()].map(s=>s.player),new Map([...this.sessions.values()].map(s=>[s.player.id,s.input])));
    this.tick++;if(this.tick%2===0)this.broadcast();
  }
  private broadcast(full=false) {
    const now=Date.now();
    const state=this.encoder.encode(this.players(),this.tick,now,full);
    if(!full&&!state.add.length&&!state.remove.length&&!state.change.length&&now-this.lastBroadcast<1000)return;
    this.lastBroadcast=now;
    const packet=JSON.stringify(state);
    for(const ws of this.sessions.keys())try{ws.send(packet);}catch{const s=this.sessions.get(ws);if(s)releaseGrabs(this.players(),s.player.id);this.sessions.delete(ws);}
    if(!this.sessions.size&&this.timer){clearInterval(this.timer);this.timer=undefined;}
  }
}

export class Matchmaker extends DurableObject<Env> {
  private allocation:Promise<void>=Promise.resolve();
  join(exclude:string,identity:string,ip:string) {
    const result=this.allocation.then(()=>this.allocate(exclude,identity,ip));
    // Keep the queue usable after an allocation error; the caller still receives that error.
    this.allocation=result.then(()=>{},()=>{});
    return result;
  }
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,touched INTEGER)');ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT)');ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS claims(ticket TEXT PRIMARY KEY,identity TEXT,ip TEXT,expires INTEGER)');ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS claims_identity ON claims(identity)');ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS claims_ip ON claims(ip)');ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS join_attempts(ip TEXT,time INTEGER)');ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS join_attempts_ip_time ON join_attempts(ip,time)');ctx.storage.sql.exec("INSERT OR IGNORE INTO settings VALUES ('palette-salt',?)",crypto.randomUUID());}
  private async allocate(exclude:string,identity:string,ip:string) {
    const sql=this.ctx.storage.sql;
    const salt=sql.exec<{value:string}>("SELECT value FROM settings WHERE key='palette-salt'").one().value;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(salt),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sign=async(value:string)=>new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)));
    const digest=await sign(identity);
    const identityKey=Array.from(digest,v=>v.toString(16).padStart(2,'0')).join('');
    const ipKey=Array.from(await sign(ip),v=>v.toString(16).padStart(2,'0')).join('');
    const now=Date.now();
    // Only keyed HMACs are stored: raw addresses and browser fingerprints never leave this call.
    sql.exec('DELETE FROM claims WHERE expires < ?',now);
    sql.exec('DELETE FROM join_attempts WHERE time < ?',now-60000);
    const attempts=sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM join_attempts WHERE ip=?',ipKey).one().n;
    const sameIdentity=sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM claims WHERE identity=?',identityKey).one().n;
    const sameIp=sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM claims WHERE ip=?',ipKey).one().n;
    if(attempts>=MAX_JOINS_PER_IP_PER_MINUTE||sameIdentity>=MAX_SESSIONS_PER_IDENTITY||sameIp>=MAX_SESSIONS_PER_IP)return null;
    sql.exec('INSERT INTO join_attempts VALUES (?,?)',ipKey,now);
    const appearance=paletteFromDigest(new Uint8Array(digest));
    // Rooms are coordination atoms; a bounded directory routes newcomers to recent tables.
    sql.exec('DELETE FROM rooms WHERE touched < ?',Date.now()-86400000);
    for(const room of sql.exec<{id:string}>('SELECT id FROM rooms WHERE id != ? ORDER BY touched DESC LIMIT 32',exclude).toArray()) {
      const ticket=await this.env.ROOMS.getByName(room.id).reserve(appearance);
      if(ticket){sql.exec('INSERT INTO claims VALUES (?,?,?,?)',ticket,identityKey,ipKey,now+TICKET_TTL);sql.exec('UPDATE rooms SET touched=? WHERE id=?',now,room.id);return {room:room.id,ticket};}
    }
    const room=crypto.randomUUID();
    // Publish before the RPC await so concurrent joins discover the same new table.
    sql.exec('INSERT INTO rooms VALUES (?,?)',room,Date.now());
    const ticket=await this.env.ROOMS.getByName(room).reserve(appearance);
    if(!ticket)throw new Error('New table filled during allocation');
    sql.exec('INSERT INTO claims VALUES (?,?,?,?)',ticket,identityKey,ipKey,now+TICKET_TTL);
    return {room,ticket};
  }
  claim(ticket:string) {
    const sql=this.ctx.storage.sql,now=Date.now();
    const claimed=sql.exec('UPDATE claims SET expires=? WHERE ticket=? AND expires>=?',now+LEASE_TTL,ticket,now);
    return claimed.rowsWritten===1;
  }
  touch(ticket:string) {this.ctx.storage.sql.exec('UPDATE claims SET expires=? WHERE ticket=?',Date.now()+LEASE_TTL,ticket);}
  release(ticket:string) {this.ctx.storage.sql.exec('DELETE FROM claims WHERE ticket=?',ticket);}
}

export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')) {
      const origin=request.headers.get('Origin');
      if(origin&&origin!==url.origin)return new Response('Origin rejected',{status:403});
      if(url.pathname==='/api/join'&&request.method==='POST') {
        const exclude=url.searchParams.get('exclude')??'';
        if(exclude.length>36)return new Response('Invalid room',{status:400});
        const fingerprint=request.headers.get('X-Jelly-Fingerprint');
        if(!fingerprint||! /^[a-f0-9]{64}$/.test(fingerprint))return new Response('Invalid browser fingerprint',{status:400});
        // Cloudflare supplies the trusted IP; never return, persist or log it.
        const ip=request.headers.get('CF-Connecting-IP')??'';
        const identity=JSON.stringify([ip,fingerprint]);
        const seat=await env.MATCHMAKER.getByName('public-v1').join(exclude,identity,ip);
        if(!seat)return new Response('Too many active connections. Try again later.',{status:429,headers:{'Retry-After':'60'}});
        return Response.json(seat,{headers:{'Cache-Control':'no-store'}});
      }
      const match=url.pathname.match(/^\/api\/room\/([0-9a-f-]{36})$/);
      if(match&&request.method==='GET')return env.ROOMS.getByName(match[1]).fetch(request);
      return new Response('Not found',{status:404});
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

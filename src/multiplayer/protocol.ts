import { spawn, type Player, type Snapshot } from './simulation.ts';
import type { Appearance } from './appearance.ts';

// Ordered, reliable WebSocket stream: one baseline on joining, then changed fields.
// Metres use 0.1 mm precision. Static identity/appearance never ride motion updates.
const fields=['x','y','z','vx','vy','vz','yaw','cooldown','dashTime','hit','impacts','grab'] as const;
type Value=number|unknown[]|null;
type Row=[number,number,...Value[]];
export type StatePacket={type:'state';tick:number;time:number;full:boolean;add:[number,string,Appearance][];remove:number[];change:Row[]};
function values(p:Player,slots:Map<string,number>):Value[] {
  const q=(v:number)=>Math.round(v*10000);
  const g=p.grab;
  return ([p.x,p.y,p.z,p.vx,p.vy,p.vz,p.yaw,p.cooldown,p.dashTime,p.hit].map(q) as Value[])
    // updated is a server-only grab lease; it is deliberately not replicated.
    .concat([p.impacts.map(i=>[i.seq,q(i.nx),q(i.nz),q(i.speed),q(i.height),q(i.age)]),g?[slots.get(g.by)!,g.hand,q(g.anchor.x),q(g.anchor.y),q(g.anchor.z),q(g.target.x),q(g.target.y),q(g.target.z)]:null]);
}
export class StateEncoder {
  private slots=new Map<string,number>();
  private previous=new Map<number,Value[]>();
  encode(players:Player[],tick:number,time:number,full=false):StatePacket {
    const packet:StatePacket={type:'state',tick,time,full,add:[],remove:[],change:[]};
    const present=new Set(players.map(p=>p.id));
    for(const [id,slot] of this.slots)if(!present.has(id)){packet.remove.push(slot);this.slots.delete(id);this.previous.delete(slot);}
    for(const p of players)if(!this.slots.has(p.id)) {
      let slot=0;const used=new Set(this.slots.values());while(used.has(slot))slot++;
      this.slots.set(p.id,slot);packet.add.push([slot,p.id,p.appearance]);
    }
    if(full){packet.add=players.map(p=>[this.slots.get(p.id)!,p.id,p.appearance]);packet.remove=[];this.previous.clear();}
    for(const p of players) {
      const slot=this.slots.get(p.id)!,next=values(p,this.slots),before=this.previous.get(slot),row:Row=[slot,0];
      for(let i=0;i<next.length;i++)if(!before||JSON.stringify(next[i])!==JSON.stringify(before[i])){row[1]|=1<<i;row.push(next[i]);}
      if(row[1])packet.change.push(row);
      this.previous.set(slot,next);
    }
    return packet;
  }
}
export class StateDecoder {
  private players=new Map<number,Player>();
  decode(packet:StatePacket):Snapshot {
    if(packet.full)this.players.clear();
    for(const slot of packet.remove)this.players.delete(slot);
    for(const [slot,id,appearance] of packet.add)this.players.set(slot,spawn(id,[],appearance));
    // Clone only changed players. Previously delivered snapshots stay immutable.
    for(const [slot,mask,...values] of packet.change) {
      const before=this.players.get(slot);if(!before)throw new Error('Unknown player in state delta');
      const p={...before};let cursor=0;
      for(let i=0;i<fields.length;i++)if(mask&(1<<i)) {
        const value=values[cursor++],key=fields[i];
        if(key==='grab') {
          if(value===null)p.grab=null;
          else {
            const g=value as number[],owner=this.players.get(g[0]);if(!owner)throw new Error('Unknown grab owner');
            p.grab={by:owner.id,hand:g[1] as -1|1,anchor:{x:g[2]/10000,y:g[3]/10000,z:g[4]/10000},target:{x:g[5]/10000,y:g[6]/10000,z:g[7]/10000},updated:0};
          }
        }else if(key==='impacts')p.impacts=(value as number[][]).map(v=>({seq:v[0],nx:v[1]/10000,nz:v[2]/10000,speed:v[3]/10000,height:v[4]/10000,age:v[5]/10000}));
        else p[key]=(value as number)/10000;
      }
      this.players.set(slot,p);
    }
    return {type:'state',tick:packet.tick,time:packet.time,players:[...this.players.values()]};
  }
}

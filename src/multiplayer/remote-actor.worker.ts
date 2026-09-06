import { RemoteActor } from './remote-actor.ts';
import type { BabyModel } from '../physics/baby-cage.ts';
import type { Player } from './simulation.ts';
import type { Reach } from './reaching-hand.ts';
type Command={type:'init';model:BabyModel}|{type:'frame';dt:number;state:Player;reach:Reach|null;buffer?:ArrayBuffer};
let actor:RemoteActor|undefined;
self.onmessage=({data}:{data:Command})=>{
  try {
    if(data.type==='init'){actor=new RemoteActor(data.model);self.postMessage({type:'ready'});return;}
    if(!actor)throw new Error('Remote actor was not initialized');
    const frame=actor.advance(data.dt,data.state,data.reach,data.buffer);
    self.postMessage({type:'frame',...frame},{transfer:[frame.buffer]});
  }catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}
};

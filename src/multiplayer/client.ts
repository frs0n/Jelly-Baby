import type { Point } from './grabs.ts';
import { StateDecoder, type StatePacket } from './protocol.ts';
import type { Controls, Player } from './simulation.ts';

/** Anonymous, ephemeral connection. No cookies, account, nickname or local storage. */
export class RoomClient {
  id='';room='';players:Player[]=[];connected=false;
  sampleTime=0;
  private clockOffset:number|null=null;
  private rtt=0;
  private decoder=new StateDecoder();
  private lastInput='';private inputAt=-Infinity;
  private lastGrab='';private grabAt=-Infinity;
  get snapshotAge(){return (performance.now()-this.lastState+this.rtt*.5)/1000;}
  get serverNow(){return this.clockOffset===null?this.sampleTime:performance.now()-this.clockOffset;}
  onState:(players:Player[])=>void=()=>{};
  onError:(error:Error)=>void=()=>{};
  onGrabResult:(target:string,accepted:boolean)=>void=()=>{};
  onFacilityResult:(facility:number,accepted:boolean)=>void=()=>{};
  private socket:WebSocket|undefined;
  private generation=0;
  private heartbeat:ReturnType<typeof setInterval>|undefined;
  private timeout:ReturnType<typeof setTimeout>|undefined;
  private pending:AbortController|undefined;
  private lastState=0;
  async join(change=false) {
    const exclude=change?this.room:'';
    this.close();const generation=this.generation;
    const pending=new AbortController();this.pending=pending;
    this.timeout=setTimeout(()=>{pending.abort();if(generation===this.generation){this.close();this.onError(new Error('Connection timed out'));}},12000);
    try {
      // Ordinary browser properties only: no canvas, font or audio probing.
      const properties=[navigator.userAgent,navigator.language,navigator.languages.join(','),screen.width,screen.height,screen.colorDepth,navigator.hardwareConcurrency,navigator.maxTouchPoints,Intl.DateTimeFormat().resolvedOptions().timeZone];
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(properties)));
      const fingerprint=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
      const response=await fetch(`/api/join?exclude=${encodeURIComponent(exclude)}`,{method:'POST',headers:{'X-Jelly-Fingerprint':fingerprint},signal:pending.signal});
      if(!response.ok)throw new Error(`入场失败 (${response.status})`);
      const seat=await response.json() as {room:string;ticket:string};
      if(generation!==this.generation)return;
      this.room=seat.room;
      const url=new URL(`/api/room/${seat.room}`,location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.searchParams.set('ticket',seat.ticket);
      const socket=new WebSocket(url);this.socket=socket;
      socket.addEventListener('message',event=>{
        if(generation!==this.generation)return;
        const packet=JSON.parse(event.data) as StatePacket|{type:'welcome';id:string}|{type:'grab-result';target:string;accepted:boolean}|{type:'facility-result';facility:number;accepted:boolean}|{type:'pong';t:number};
        if(packet.type==='welcome') {
          this.id=packet.id;this.connected=true;clearTimeout(this.timeout);this.lastState=performance.now();this.send({type:'ping',t:performance.now()});
          this.heartbeat=setInterval(()=>{
            if(performance.now()-this.lastState>8000){this.close();this.onError(new Error('Connection interrupted'));return;}
            this.send({type:'ping',t:performance.now()});
          },3000);
        }else if(packet.type==='pong'){const sample=Math.max(0,performance.now()-packet.t);this.rtt=this.rtt?this.rtt*.8+sample*.2:sample;
        }else if(packet.type==='grab-result') {this.onGrabResult(packet.target,packet.accepted);
        }else if(packet.type==='facility-result') {this.onFacilityResult(packet.facility,packet.accepted);
        }else if(packet.type==='state') {
          this.lastState=performance.now();this.sampleTime=packet.time;const offset=this.lastState-packet.time;this.clockOffset=this.clockOffset===null?offset:Math.min(this.clockOffset+.1,offset);this.players=this.decoder.decode(packet).players;this.onState(this.players);
        }
      });
      socket.addEventListener('close',()=>{
        if(generation!==this.generation)return;
        this.close();this.onError(new Error('Connection closed'));
      });
      socket.addEventListener('error',()=>{
        if(generation!==this.generation)return;
        this.close();this.onError(new Error('Connection failed'));
      });
    }catch(error){if(generation===this.generation){this.close();this.onError(error instanceof Error?error:new Error('Connection failed'));}}
  }
  beginGrab(target:string,point:Point){this.lastGrab='';this.grabAt=-Infinity;this.send({type:'grab-start',target,point});}
  moveGrab(point:Point){
    const p={x:Math.round(point.x*10000)/10000,y:Math.round(point.y*10000)/10000,z:Math.round(point.z*10000)/10000},key=JSON.stringify(p),now=performance.now();
    if(key===this.lastGrab&&now-this.grabAt<200)return;
    if(this.send({type:'grab-move',point:p})){this.lastGrab=key;this.grabAt=now;}
  }
  endGrab(){this.send({type:'grab-end'});}
  enterFacility(facility:number){this.lastInput='';this.inputAt=-Infinity;this.send({type:'facility-enter',facility});}
  leaveFacility(){this.lastInput='';this.inputAt=-Infinity;this.send({type:'facility-leave'});}
  reset(){this.lastInput='';this.inputAt=-Infinity;this.send({type:'reset'});}
  input(value:Controls){
    // Quantise the ride phase to what the wire carries, so a resting facility
    // keeps deduplicating instead of trickling identical rounded samples.
    const packet={...value,phase:Math.round(value.phase*10000)/10000};
    const key=JSON.stringify(packet),now=performance.now();
    if(!value.jump&&!value.dash&&key===this.lastInput&&now-this.inputAt<200)return;
    if(this.send({type:'input',...packet})){this.lastInput=key;this.inputAt=now;}
  }
  private send(packet:unknown){if(this.socket?.readyState!==WebSocket.OPEN)return false;this.socket.send(JSON.stringify(packet));return true;}
  close() {
    this.decoder=new StateDecoder();this.lastInput=this.lastGrab='';this.inputAt=this.grabAt=-Infinity;
    this.generation++;this.pending?.abort();this.pending=undefined;clearTimeout(this.timeout);clearInterval(this.heartbeat);
    this.socket?.close();this.socket=undefined;this.connected=false;this.clockOffset=null;this.rtt=0;this.id='';this.players=[];this.onState([]);
  }
}

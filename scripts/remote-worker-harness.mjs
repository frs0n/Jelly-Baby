import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
const bytes=readFileSync(new globalThis.URL('../src/assets/model/jelly-baby.bin',import.meta.url));
export const model={buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),manifest:JSON.parse(readFileSync(new globalThis.URL('../src/assets/model/jelly-baby.json',import.meta.url),'utf8'))};
export function worker() {
 const entry=new globalThis.URL('../src/multiplayer/remote-actor.worker.ts',import.meta.url).href;
 const w=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:(data,options)=>parentPort.postMessage(data,options?.transfer)};import(${JSON.stringify(entry)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true,execArgv:['--experimental-strip-types']});
 const adapter={onmessage:null,onerror:null,postMessage:(data,transfer)=>w.postMessage(data,transfer),terminate:()=>w.terminate()};
 w.on('message',data=>adapter.onmessage?.({data}));w.on('error',error=>adapter.onerror?.({message:error.message}));return adapter;
}
export async function renderVisitors(visitors) {
 const deadline=Date.now()+10000;
 while(Date.now()<deadline) {
  visitors.update(1/60,Infinity);
  if([...visitors.visitors.values()].every(v=>v.frame))return;
  await new Promise(resolve=>globalThis.setTimeout(resolve,10));
 }
 throw new Error('Remote worker did not produce a frame');
}

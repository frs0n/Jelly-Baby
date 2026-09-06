import assert from 'node:assert/strict';
import { FacilityAudio, FacilityMotionSound, makeFacilitySample } from '../src/game/facility-sound.ts';

const events=[],motion=new FacilityMotionSound(event=>events.push(event),{x:0,y:0,z:0});
for(let i=0;i<240;i++)motion.swing(1/240,0,0,false);
assert.equal(events.length,0,'stationary equipment is silent');
for(let i=0;i<240*6;i++) {
  const t=i/240;
  motion.swing(1/240,.7*Math.sin(4*t),2.8*Math.cos(4*t),true);
  const event=events.at(-1);
  if(event&&events.length!==motion.lastCount) {
    if(event.kind==='swing-creak')assert(Math.abs(Math.cos(4*t))<.025,'hinge sound coincides with a reversal');
    if(event.kind==='swing-air')assert(Math.abs(Math.sin(4*t))<.025,'air sound coincides with the fast bottom crossing');
    motion.lastCount=events.length;
  }
}
assert(events.filter(event=>event.kind==='swing-creak').length>=6);
assert(events.filter(event=>event.kind==='swing-air').length>=6);
assert(events.length<20,'no per-frame sound flood');
motion.reset();events.length=0;
motion.trampoline(.1,false,-.5,0,true);
motion.trampoline(.1,true,-.6,-.001,true);
motion.trampoline(.04,true,-.2,-.020,true);
motion.trampoline(.04,true,.1,-.018,true);
assert.deepEqual(events.map(event=>event.kind),['trampoline-land','trampoline-spring']);
for(let i=0;i<50;i++)motion.trampoline(1/240,true,0,-.01,false);
assert.equal(events.length,2,'empty trampoline does not generate landing sounds');

for(const kind of ['swing-creak','swing-air','trampoline-land','trampoline-spring']) {
  for(const sampleRate of [44100,48000]) {
    const data=makeFacilitySample(kind,0,sampleRate);
    assert(data.every(Number.isFinite));assert.equal(data[0],0);
    assert(Math.abs(data.at(-1))<.001,'tail fades without a click');
    assert.deepEqual(data,makeFacilitySample(kind,0,sampleRate),'samples are reproducible');
    assert.notDeepEqual(data,makeFacilitySample(kind,1,sampleRate),'variants avoid identical repetition');
    const peak=data.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
    const mean=data.reduce((sum,value)=>sum+value,0)/data.length;
    assert(peak>.001&&peak<=.65,'bounded audible sample');assert(Math.abs(mean)<.01,'no significant DC offset');
  }
}

let starts=0,stops=0,buffers=0;
const node=()=>({connect(){return this;},disconnect(){},gain:{value:0},pan:{value:0}});
const ctx={state:'running',currentTime:0,sampleRate:48000,
  createBuffer(_channels,length){buffers++;return {length,copyToChannel(){}};},
  createBufferSource(){return {...node(),start(){starts++;},stop(){stops++;this.onended?.();}};},
  createGain:node,createStereoPanner:node,
};
const audio=new FacilityAudio(ctx,node()),event={kind:'trampoline-land',strength:.8,x:0,y:0,z:0};
audio.play(event,.2,0);audio.play(event,.2,0);assert.equal(starts,1,'catch-up substeps cannot stack the same sound');
audio.play({...event,kind:'swing-creak'},2,0);assert.equal(starts,1,'distant facilities are silent');
ctx.state='suspended';ctx.currentTime+=1;audio.play(event,.2,0);assert.equal(starts,1,'suspended audio does not queue stale sounds');
ctx.state='running';
for(let i=0;i<20;i++){ctx.currentTime+=.2;audio.play(event,.2,0);}
assert.equal(starts,6,'voice count is bounded');assert.equal(buffers,3,'PCM variants are cached');
audio.stop();assert.equal(stops,6,'mute/reset cleanup stops every active voice');
audio.dispose();
console.log('Motion timing, silence at rest, sample bounds, audio caching, voice limits and cleanup passed');

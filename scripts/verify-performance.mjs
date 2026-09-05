import assert from 'node:assert/strict';
import { Vector2, Vector3 } from 'three/webgpu';
import { loadModel } from './load-model.mjs';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { Locomotion } from '../src/game/locomotion.ts';
import { FixedStepper } from '../src/game/fixed-step.ts';
import { deformSurface } from '../src/physics/deform-surface.js';
import { depositBeam } from '../src/graphics/beam-raster.js';
import { RefractiveLightField } from '../src/graphics/refractive-light.js';
import { ABSORPTION } from '../src/graphics/baby.ts';

const clock=new FixedStepper(PHYS.step);let ticks=0,now=0;
assert.equal(clock.advance(1/60,()=>ticks++,()=>0),4,'normal frame retains four 240 Hz steps');
assert.equal(clock.advance(.05,()=>{ticks++;now+=4;},()=>now),2,'overload yields at the CPU budget');
assert.equal(clock.advance(1/60,()=>ticks++,()=>now),4,'backlog cannot cause repeated catch-up spikes');
assert.equal(ticks,10);
clock.reset();assert.equal(clock.advance(.05,()=>{},()=>0),6,'catch-up has an independent step-count limit');

const receiver=new Float32Array(32*32*3),origin=new Vector2();
for(const vertices of [[[.1,.2],[.8,.3],[.4,.9]],[[.3,.3],[.30001,.3],[.3,.30001]],[[.1,.1],[.9,.900001],[.9,.9]]]) {
  for(const triangle of [vertices,[...vertices].reverse()]) {
    receiver.fill(0);depositBeam(receiver,32,origin,1,triangle,0,[.001,.002,.003]);
    const flux=[0,0,0];for(let i=0;i<receiver.length;i++)flux[i%3]+=receiver[i]/1024;
    flux.forEach((v,i)=>assert(Math.abs(v-(i+1)*.001)<1e-7,'RGB flux survives thin, subpixel and folded beams'));
  }
}

const body=new SoftBody(loadModel()),rig=new Locomotion(body);
for(let i=0;i<240;i++){rig.step(PHYS.step);body.step(PHYS.step);}body.updateSurface();
const proxy=body.cage.opticalSurface;deformSurface(proxy,body.x,body.nodalF);
assert.equal(body.surface.positions.length/3,72234,'visible mesh remains at full resolution');
assert(proxy.positions.length<body.surface.positions.length/6,'only the optical calculation uses the proxy');
const direction=new Vector3(.49,-.75,-.44).normalize(),camera={position:body.center.clone().add(new Vector3(.08,.13,.19))};
const reference=new RefractiveLightField(body.surface,direction,ABSORPTION),fast=new RefractiveLightField(proxy,direction,ABSORPTION);
reference.update(body);fast.update(body);reference.updateViewThickness(camera);fast.updateViewThickness(camera);
const integrate=field=>{
  const flux=[0,0,0],area=(field.span/field.size)**2;
  for(let i=0;i<field.photons.length;i++)flux[i%3]+=field.photons[i]*area;return flux;
};
const originalFlux=integrate(reference),proxyFlux=integrate(fast);
proxyFlux.forEach((v,i)=>assert(Math.abs(v/originalFlux[i]-1)<.15,'proxy preserves caustic spectral energy'));
const ids=body.cage.thicknessIds,weights=body.cage.thicknessWeights;
const source=proxy.geometry.attributes.opticalThickness.array,target=body.surface.geometry.attributes.opticalThickness.array;
const p=body.surface.positions,n=body.surface.geometry.attributes.normal.array;
let error=0,count=0;
for(let i=0,j=0;i<target.length;i++,j+=3) {
  const ray=new Vector3(p[j]-camera.position.x,p[j+1]-camera.position.y,p[j+2]-camera.position.z).normalize();
  if(ray.x*n[j]+ray.y*n[j+1]+ray.z*n[j+2]>-.25)continue;
  const thickness=source[ids[j]]*weights[j]+source[ids[j+1]]*weights[j+1]+source[ids[j+2]]*weights[j+2];
  error+=(thickness-target[i])**2;count++;
}
const rms=Math.sqrt(error/count);assert(rms<.003,'interpolated thickness stays close to full-mesh tracing');

// Exercise the actual worker protocol without opening a browser. Structured clone
// with transfers catches detached-buffer mistakes in the two-stage response.
const messages=[],previousSelf=globalThis.self;
globalThis.self={postMessage:(data,options)=>messages.push(globalThis.structuredClone(data,options))};
await import('../src/graphics/transport.worker.ts');
globalThis.self.onmessage({data:globalThis.structuredClone({type:'init',positions:proxy.positions,indices:proxy.indices,
  restNormals:proxy.restNormals,bindingIds:proxy.bindingIds,bindingWeights:proxy.bindingWeights,direction:direction.toArray(),sigma:ABSORPTION})});
globalThis.self.onmessage({data:{type:'frame',particles:body.x.slice(),nodalF:body.nodalF.slice(),center:body.center.toArray(),camera:camera.position.toArray()}});
assert.equal(messages.length,2);assert(messages[0].light&&!messages[0].thickness,'caustics publish before thickness completes');
assert.equal(messages[1].thickness.length,proxy.positions.length/3);
messages.length=0;
globalThis.self.onmessage({data:{type:'frame',particles:null,nodalF:null,center:body.center.toArray(),camera:camera.position.toArray()}});
assert.equal(messages.length,1);assert(messages[0].thickness&&!messages[0].light,'camera-only updates reuse caustics');
globalThis.self=previousSelf;
console.log('PASS — bounded frame work, RGB beam conservation, optical proxy and worker protocol',
  {proxyFluxRatio:proxyFlux.map((v,i)=>v/originalFlux[i]),thicknessRmsMm:rms*1000});

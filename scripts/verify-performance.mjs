import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const inputSource=readFileSync('src/game/input.ts','utf8');
assert(!inputSource.includes('raycaster.intersectObject(this.mesh'), 'grab start must not scan the 144k visible triangles');
assert(inputSource.includes('getCoalescedEvents')&&inputSource.includes("e?.type==='pointerup'"), 'abrupt pointer endpoints are latched before release');
assert(!inputSource.includes('recoverGrabTarget'), 'grab commands must never be rewound after a hard step');

const clock=new FixedStepper(PHYS.step);let ticks=0;
assert.equal(clock.advance(1/60,()=>ticks++),4,'normal frame retains four 240 Hz steps');
assert.equal(clock.advance(.05,()=>ticks++),12,'a 50 ms hitch advances the full 50 ms instead of entering slow motion');
assert.equal(clock.advance(1/30,()=>ticks++),8,'30 Hz rendering still advances physics in real time');
assert.equal(ticks,24);
clock.reset();assert.equal(clock.advance(.05,()=>{}),12,'catch-up covers the complete accepted frame interval');

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
assert(body.kernel,'WebAssembly soft-body accelerator is active');
// Rendering remains byte-for-byte the original full-resolution CPU embedding.
// The accelerator changes execution location only; it does not introduce a second
// visual mesh or shader-only deformation path.
const referenceModel=loadModel();
deformSurface(referenceModel.surface,body.x,body.nodalF);
let maxPositionError=0,maxNormalError=0;
for(let i=0;i<body.surface.positions.length;i++) {
  maxPositionError=Math.max(maxPositionError,Math.abs(body.surface.positions[i]-referenceModel.surface.positions[i]));
  maxNormalError=Math.max(maxNormalError,Math.abs(body.surface.geometry.attributes.normal.array[i]-referenceModel.surface.geometry.attributes.normal.array[i]));
}
assert.equal(maxPositionError,0,'accelerated visible positions exactly match the original CPU embedding');
assert.equal(maxNormalError,0,'accelerated visible normals exactly match the original CPU embedding');
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
console.log('PASS — exact visible embedding, responsive fixed-step work, RGB beam conservation, optical proxy and worker protocol',
  {proxyFluxRatio:proxyFlux.map((v,i)=>v/originalFlux[i]),thicknessRmsMm:rms*1000});

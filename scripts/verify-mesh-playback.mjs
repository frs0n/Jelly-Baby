import assert from 'node:assert/strict';
import { BufferAttribute,BufferGeometry,Mesh } from 'three/webgpu';
import { MeshPlayback } from '../src/multiplayer/mesh-playback.ts';
const geometry=new BufferGeometry();
geometry.setAttribute('position',new BufferAttribute(new Float32Array(3),3));
geometry.setAttribute('normal',new BufferAttribute(new Float32Array([0,1,0]),3));
const playback=new MeshPlayback([new Mesh(geometry)]),attribute=geometry.attributes.position;
function frame(root,offset){return {buffer:new Float32Array([root+offset,.03,0,0,1,0]).buffer,lengths:[3],updated:[true],bounds:[[root+offset,.03,0,root+offset,.03,0,root+offset,.03,0,0]],root:{x:root,y:0,z:0},center:{x:root+offset,y:.03,z:0},gripPoint:{x:root+offset,y:.03,z:0},handPoint:null,physicsSteps:4};}
playback.accept(frame(1,.01));assert.ok(Math.abs(attribute.array[0]-.01)<1e-6);assert.ok(Number.isFinite(geometry.boundingBox.min.x));
playback.update(1/30);const old=attribute.array[0],next=frame(2,.03);playback.accept(next);
assert.equal(attribute.array[0],old,'worker arrival cannot jump the displayed mesh');
playback.update(1/60);assert.ok(Math.abs(attribute.array[0]-.02)<1e-6,'display advances halfway between 30 Hz worker samples');
assert.ok(Math.abs(playback.gripPoint.x-attribute.array[0])<1e-6,'hand target tracks the same displayed skin');
assert.ok(Math.abs(playback.center.x-.02)<1e-6);
playback.update(1/60);assert.ok(Math.abs(attribute.array[0]-.03)<1e-6);
assert.equal(geometry.attributes.position,attribute,'GPU attribute identity is stable');
assert.equal(geometry.attributes.normal.array[1],1,'interpolated normal stays unit length');
// A new sample arriving halfway through playback starts from the visible pose.
playback.accept(frame(3,.05));playback.update(1/120);const visible=attribute.array[0];
playback.accept(frame(4,.02));assert.equal(attribute.array[0],visible);
playback.update(1/120);assert.ok(Number.isFinite(attribute.array[0]));
const version=attribute.version;playback.update(.05);const settled=attribute.version;playback.update(.05);assert.equal(attribute.version,settled,'completed playback does not upload unchanged mesh');assert.ok(settled>=version);
// No new vertices means keep the last sample and the existing GPU buffers.
playback.accept({...frame(4,.02),buffer:undefined});assert.equal(attribute.version,settled);
geometry.dispose();
console.log('PASS: no worker-arrival jumps, 60 Hz deformation playback from 30 Hz samples, root-space isolation, matching grip/center, normalized normals, stable GPU buffers, bounded idle uploads');

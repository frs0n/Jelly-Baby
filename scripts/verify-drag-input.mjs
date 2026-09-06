import assert from 'node:assert/strict';
import {model,worker,renderVisitors} from './remote-worker-harness.mjs';
import { PerspectiveCamera, Vector3, Scene } from 'three/webgpu';
import { Input } from '../src/game/input.ts';
import { OnlineDrag } from '../src/multiplayer/drag.ts';
import { Visitors } from '../src/multiplayer/visitors.ts';
import { Baby } from '../src/graphics/baby.ts';
import { SoftBody } from '../src/physics/soft-body.js';
import { Locomotion } from '../src/game/locomotion.ts';
import { spawn } from '../src/multiplayer/simulation.ts';
import { beginGrab, moveGrab, releaseGrabs } from '../src/multiplayer/grabs.ts';
import { loadModel } from './load-model.mjs';
const document=new globalThis.EventTarget();document.querySelector=()=>null;document.querySelectorAll=()=>[];
globalThis.document=document;globalThis.window=new globalThis.EventTarget();
const body=new SoftBody(loadModel()),baby=new Baby(body),scene=new Scene();scene.add(baby.group);
const canvas=new globalThis.EventTarget(),captures=new Set(),classes=new Set();
canvas.style={};canvas.ownerDocument=document;canvas.getRootNode=()=>document;
canvas.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600});
canvas.classList={add:s=>classes.add(s),remove:s=>classes.delete(s),toggle:(s,on)=>on?classes.add(s):classes.delete(s)};
canvas.setPointerCapture=id=>captures.add(id);canvas.hasPointerCapture=id=>captures.has(id);canvas.releasePointerCapture=id=>captures.delete(id);
const camera=new PerspectiveCamera(40,800/600,.001,10);camera.position.set(0,.2,.4);
const input=new Input(camera,canvas,body,baby.mesh,new Locomotion(body),{unlock:async()=>{}},()=>{});
const self=spawn('self',[]),other=spawn('other',[]);self.x=self.z=0;other.x=.10;other.z=0;other.yaw=0;
const players=[self,other],sent=[];
const client={id:'self',connected:true,players,
 beginGrab(id,point){sent.push('start');this.onGrabResult(id,beginGrab(players,'self',id,point,0));},
 moveGrab(point){sent.push('move');moveGrab(players,'self',point,0);},
 endGrab(){sent.push('end');releaseGrabs(players.filter(p=>p.grab?.by==='self'),'self');}};
const visitors=new Visitors(scene,baby.group,body.center,{model:Promise.resolve(model),worker,fail:error=>{throw error;}});visitors.sync(players,'self');await renderVisitors(visitors);
const drag=new OnlineDrag(input,body,client,visitors);
function event(x=.1,y=.045,z=.01,type='pointerdown') {
 const p=new Vector3(x,y,z).project(camera);
 return {target:canvas,button:0,buttons:1,pointerId:1,pointerType:'mouse',type,clientX:(p.x+1)*400,clientY:(1-p.y)*300,preventDefault(){},stopImmediatePropagation(){}};
}
drag.begin(event());assert.equal(other.grab?.by,'self','nearby full-resolution visitor is pickable');assert.equal(input.externalGrab,true);assert.equal(captures.size,1);
drag.move(event(.13,.08,.01,'pointermove'));drag.update(1/30);assert.ok(sent.includes('move'));assert.ok(other.grab.target.y>.05);
drag.end(event(.15,.1,.01,'pointerup'));assert.equal(other.grab,null);assert.equal(input.externalGrab,false);assert.equal(input.controls.enabled,true);assert.equal(captures.size,0);
// Original self surface grips are forwarded, rather than replaced by a new picker.
input.begin(event(0,.045,.01));assert.ok(body.grab);drag.update(1/30);assert.equal(self.grab?.by,'self');input.clear();drag.update(1/30);assert.equal(self.grab,null);
other.x=.5;visitors.sync(players,'self');visitors.update(1,Infinity);drag.begin(event(.5));assert.equal(input.externalGrab,false,'distant visitor cannot be dragged');
other.x=.1;visitors.sync(players,'self');visitors.update(1,Infinity);drag.begin(event());assert.equal(input.externalGrab,true);
globalThis.window.dispatchEvent(new globalThis.Event('blur'));assert.equal(other.grab,null);assert.equal(captures.size,0);
// A grab received from another player binds to the actual local soft-body skin.
assert.ok(beginGrab(players,'other','self',{x:0,y:.045,z:.01},0));drag.update(1/60);assert.ok(body.grab);assert.equal(input.allowGrab,false);
moveGrab(players,'other',{x:.04,y:.1,z:.02},10);
const before=body.grab.point.clone();
for(let frame=0;frame<30;frame++) {drag.update(1/60);for(let step=0;step<4;step++){input.rig.step(1/240);body.step(1/240);}body.updateSurface();}
assert.ok(body.grab.point.distanceTo(before)>.015,'incoming drag deforms the actual local soft body');
assert.ok(body.isFinite());assert.ok(body.minimumJacobian()>=.12);
releaseGrabs(players,'other');drag.update(1/60);assert.equal(body.grab,null);assert.equal(input.controls.enabled,true);
drag.dispose();visitors.dispose();input.dispose();baby.dispose();
console.log('PASS: original self drag, remote mesh picking, pointer movement/release, proximity, blur cleanup, incoming FEM attachment and restored orbit');

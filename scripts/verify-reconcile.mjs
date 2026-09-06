import assert from 'node:assert/strict';
import { SoftBody } from '../src/physics/soft-body.js';
import { Locomotion } from '../src/game/locomotion.ts';
import { loadModel } from './load-model.mjs';
import { spawn } from '../src/multiplayer/simulation.ts';
import { reconcile } from '../src/multiplayer/reconcile.ts';
const body=new SoftBody(loadModel()),rig=new Locomotion(body);
for(let i=0;i<720;i++){rig.step(1/240);body.step(1/240);}
body.updateSurface();assert.equal(body.sleeping,true);
const p=spawn('self',[]);p.x=body.center.x+.001;p.z=body.center.z-.001;
const revision=body.surfaceRevision;
for(let frame=0;frame<600;frame++)assert.equal(reconcile(body,p,body.center.y+.006,.12,1/60),false);
assert.equal(body.sleeping,true,'idle network snapshots preserve solver sleep');assert.equal(body.surfaceRevision,revision);assert.equal(body.surfaceDirty,false,'resting network noise must not schedule geometry/optical work');
p.vx=.145;p.x=body.center.x-.145*.12;p.z=body.center.z;
assert.equal(reconcile(body,p,body.center.y,.12,1/60),false,'compensate snapshot transit time instead of pulling a moving player backwards');
p.vx=0;p.x=body.center.x+.04;const x=body.center.x;
assert.equal(reconcile(body,p,body.center.y,0,1/60),true);assert.ok(body.center.x>x&&body.center.x<x+.01,'significant drift converges smoothly');
p.y=0;const y=body.center.y;reconcile(body,p,y-.04,0,1/60);assert.equal(body.center.y,y,'grounded authority never clamps local vertical physics');
console.log('PASS: 600 idle frames trigger zero network-induced wakeups or surface rebuilds; latency compensation, smooth drift correction, local vertical physics preserved');

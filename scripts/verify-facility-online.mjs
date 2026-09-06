import assert from 'node:assert/strict';
import { simulate, spawn, controls, enterFacility, leaveFacility, STEP } from '../src/multiplayer/simulation.ts';
import { beginGrab } from '../src/multiplayer/grabs.ts';
import { StateEncoder, StateDecoder } from '../src/multiplayer/protocol.ts';
import { FACILITY_NONE, FACILITY_SWING, FACILITY_TRAMPOLINE, facilityAnchor, isFacility, clampPhase } from '../src/multiplayer/facility-state.ts';
import { RemoteActor } from '../src/multiplayer/remote-actor.ts';
import { model } from './remote-worker-harness.mjs';

const ride=(facility,phase=0)=>({x:0,z:0,jump:false,dash:false,phase});
const swing=facilityAnchor(FACILITY_SWING),bed=facilityAnchor(FACILITY_TRAMPOLINE);

// --- Command validation -----------------------------------------------------
assert.equal(isFacility(FACILITY_NONE),false);
assert.equal(isFacility(3),false);
assert.equal(isFacility('1'),false);
assert.ok(isFacility(FACILITY_SWING)&&isFacility(FACILITY_TRAMPOLINE));
assert.equal(controls({x:0,z:0,jump:false,dash:false,phase:Infinity}),null,'a non-finite phase is rejected');
assert.equal(controls({x:0,z:0,jump:false,dash:false,phase:'1'}),null);
assert.equal(controls({x:0,z:0,jump:false,dash:false}).phase,0,'phase defaults for older senders');
assert.equal(clampPhase(FACILITY_SWING,50),swing.phaseLimit,'a forged phase cannot leave the arc');
assert.equal(clampPhase(FACILITY_SWING,-50),-swing.phaseLimit);
assert.equal(clampPhase(FACILITY_NONE,1),0);

// --- Occupancy is authoritative and exclusive -------------------------------
const near=spawn('near',[]),other=spawn('other',[]),far=spawn('far',[]);
near.x=swing.x+.05;near.z=swing.z;near.y=0;
other.x=swing.x-.04;other.z=swing.z;other.y=0;
far.x=swing.x+1;far.z=swing.z;far.y=0;
const room=[near,other,far];
assert.equal(enterFacility(room,'far',FACILITY_SWING),false,'mounting requires standing beside the facility');
assert.equal(enterFacility(room,'near',FACILITY_SWING),true);
assert.equal(near.facility,FACILITY_SWING);
assert.equal(enterFacility(room,'other',FACILITY_SWING),false,'one rider per facility');
assert.equal(enterFacility(room,'near',FACILITY_TRAMPOLINE),false,'a rider cannot ride two facilities');
assert.equal(enterFacility(room,'near',7),false,'unknown facilities are refused');
assert.equal(near.x,swing.x);assert.equal(near.z,swing.z);
assert.ok(other.facility===FACILITY_NONE&&far.facility===FACILITY_NONE);

// A rider is held by the facility: no grabs reach them and they reach nobody.
other.x=swing.x+.02;other.z=swing.z;
assert.equal(beginGrab(room,'other','near',{x:near.x,y:.035,z:near.z},0),false,'a rider cannot be grabbed');
assert.equal(beginGrab(room,'near','other',{x:other.x,y:.035,z:other.z},0),false,'a rider cannot grab');

// --- The phase is relayed, clamped, and never moves the collision body ------
const inputs=new Map([['near',ride(FACILITY_SWING,.42)]]);
simulate(room,inputs);
assert.ok(Math.abs(near.phase-.42)<1e-12,'the rider drives the ride phase');
assert.equal(near.x,swing.x);assert.equal(near.z,swing.z);assert.equal(near.y,0);
assert.equal(Math.hypot(near.vx,near.vy,near.vz),0,'a seated rider carries no velocity');
inputs.set('near',ride(FACILITY_SWING,99));
simulate(room,inputs);
assert.equal(near.phase,swing.phaseLimit,'the authority clamps a forged phase');

// A rider parked on the anchor never shoves, or is shoved by, a passing walker.
other.x=swing.x;other.z=swing.z;other.y=0;other.vx=0;other.vz=0;
inputs.set('other',{x:0,z:0,jump:false,dash:false,phase:0});
for(let i=0;i<30;i++)simulate(room,inputs);
assert.equal(near.x,swing.x,'a rider is not displaced by the contact solver');
assert.equal(near.z,swing.z);

// Jumping and dashing are swallowed while seated.
inputs.set('near',{x:1,z:1,jump:true,dash:true,phase:.3});
for(let i=0;i<10;i++)simulate(room,inputs);
assert.equal(near.y,0);assert.equal(near.x,swing.x);assert.equal(near.cooldown,0,'a seated rider cannot spend a dash');

// --- Dismount lands on the clear approach side ------------------------------
assert.equal(leaveFacility(room,'near'),true);
assert.equal(near.facility,FACILITY_NONE);assert.equal(near.phase,0);
assert.ok(Math.abs(near.x-(swing.x+swing.exit.x))<1e-12&&Math.abs(near.z-(swing.z+swing.exit.z))<1e-12);
assert.equal(leaveFacility(room,'near'),false,'stepping off twice is refused');
assert.equal(enterFacility(room,'other',FACILITY_SWING),true,'the seat is free once its rider steps off');
leaveFacility(room,'other');

// A player still counts as grounded beside the trampoline before mounting it.
const bouncer=spawn('bouncer',[]);bouncer.x=bed.x+.05;bouncer.z=bed.z;bouncer.y=.05;
assert.equal(enterFacility([bouncer],'bouncer',FACILITY_TRAMPOLINE),false,'mounting mid-air is refused');
bouncer.y=0;
assert.equal(enterFacility([bouncer],'bouncer',FACILITY_TRAMPOLINE),true);
console.log('PASS: command validation, exclusive occupancy, grab exclusion, clamped phase relay, seated collision immunity and dismount placement');

// --- The wire carries a ride ------------------------------------------------
const encoder=new StateEncoder(),decoder=new StateDecoder();
const rider=spawn('rider',[]),watcher=spawn('watcher',[]);
const wire=[rider,watcher];
let decoded=decoder.decode(encoder.encode(wire,0,0,true));
assert.equal(decoded.players[0].facility,FACILITY_NONE);
assert.equal(decoded.players[0].phase,0);
rider.x=swing.x;rider.z=swing.z;
assert.equal(enterFacility(wire,'rider',FACILITY_SWING),true);
let bytes=0,changes=0;
for(let tick=1;tick<=120;tick++) {
  rider.phase=clampPhase(FACILITY_SWING,Math.sin(tick*.09)*.8);
  const packet=encoder.encode(wire,tick,tick*STEP*1000);
  bytes+=JSON.stringify(packet).length;changes+=packet.change.length;
  decoded=decoder.decode(packet);
  const seen=decoded.players.find(p=>p.id==='rider');
  assert.equal(seen.facility,FACILITY_SWING,'the facility rides the delta stream');
  assert.ok(Math.abs(seen.phase-rider.phase)<=5e-5,'the phase survives quantisation to 0.1 mrad');
  const idle=decoded.players.find(p=>p.id==='watcher');
  assert.equal(idle.facility,FACILITY_NONE);
}
assert.ok(changes<=120,'only the moving rider re-encodes; a still watcher stays silent');
assert.ok(bytes/120<160,`a swinging rider costs ${(bytes/120).toFixed(1)} bytes per broadcast`);
// The facility id is delta-suppressed: it is sent on change, not every tick.
const before=JSON.stringify(encoder.encode(wire,121,0)).length;
leaveFacility(wire,'rider');
const after=JSON.stringify(encoder.encode(wire,122,0)).length;
assert.ok(after>before,'stepping off is an explicit change on the wire');
assert.equal(decoder.decode(encoder.encode(wire,123,0,true)).players.find(p=>p.id==='rider').facility,FACILITY_NONE);
console.log('PASS: facility and phase delta encoding, quantisation, idle suppression and dismount transitions');

// --- An observer reproduces the ride from that one scalar --------------------
const actor=new RemoteActor(model),state=spawn('remote',[]);
state.x=state.z=state.yaw=0;
let frame=actor.advance(1/60,state,null);
const walking=actor.body.center.y;
state.facility=FACILITY_SWING;state.x=swing.x;state.z=swing.z;state.y=0;state.phase=0;
frame=actor.advance(1/60,state,null,frame.buffer);
assert.ok(actor.body.center.y>walking+.02,'boarding lifts the observed jelly onto the seat');
assert.ok(actor.body.isFinite()&&actor.body.minimumJacobian()>=.12);
const seated={x:actor.body.center.x,z:actor.body.center.z};
let sweep=0,lowest=Infinity;
for(let i=0;i<180;i++) {
  state.phase=Math.sin(i*.11)*.8;
  frame=actor.advance(1/60,state,null,frame.buffer);
  sweep=Math.max(sweep,Math.abs(actor.body.center.z-swing.z));
  lowest=Math.min(lowest,actor.body.center.y);
  assert.ok(actor.body.isFinite(),'the observed ride stays finite');
}
assert.ok(sweep>.05,`the observed jelly sweeps the arc (${sweep.toFixed(3)} m)`);
assert.ok(lowest>0,'the observed rider never sinks through the table');
assert.ok(actor.body.minimumJacobian()>=.12,'the seat springs never invert an element');
assert.ok(Math.abs(actor.body.center.x-seated.x)<.01,'the arc stays in the swing plane');

// The same scalar drives a bounce, and stepping off hands back to reconciliation.
state.facility=FACILITY_TRAMPOLINE;state.x=bed.x;state.z=bed.z;state.phase=0;
frame=actor.advance(1/60,state,null,frame.buffer);
let high=-Infinity,low=Infinity;
for(let i=0;i<180;i++) {
  state.phase=Math.max(-.02,Math.sin(i*.16)*.09);
  frame=actor.advance(1/60,state,null,frame.buffer);
  high=Math.max(high,actor.body.center.y);low=Math.min(low,actor.body.center.y);
  assert.ok(actor.body.isFinite());
}
assert.ok(high-low>.05,`the observed bounce follows the relayed height (${(high-low).toFixed(3)} m)`);
assert.ok(actor.body.minimumJacobian()>=.12);
state.facility=FACILITY_NONE;state.phase=0;
state.x=bed.x+bed.exit.x;state.z=bed.z+bed.exit.z;state.y=0;
for(let i=0;i<120;i++)frame=actor.advance(1/60,state,null,frame.buffer);
assert.ok(Math.hypot(actor.body.center.x-state.x,actor.body.center.z-state.z)<.02,'reconciliation resumes after a dismount');
assert.ok(actor.body.center.y<walking+.02,'the observed jelly is back on the table');
assert.ok(actor.body.isFinite()&&actor.body.minimumJacobian()>=.12);
actor.dispose();
console.log('PASS: observed boarding, swing arc, trampoline bounce, element validity and handover back to reconciliation');

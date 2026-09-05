import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Vector2, Vector3, PerspectiveCamera, HalfFloatType, Raycaster, Plane, DataUtils } from 'three/webgpu';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { measureWindow } from '../src/graphics/environment.ts';
import { shapeStudioLight, STUDIO_KEY } from '../src/graphics/studio-light.ts';
import { loadModel } from './load-model.mjs';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { Locomotion } from '../src/game/locomotion.ts';
import { Baby, ABSORPTION } from '../src/graphics/baby.ts';
import { RefractiveLightField, SurfaceBVH } from '../src/graphics/refractive-light.js';
import { surfaceGrab, projectGrabTarget, advanceGrabTarget } from '../src/physics/grab.ts';
import { depositBeam } from '../src/graphics/beam-raster.js';

const manifest=JSON.parse(readFileSync('src/assets/model/jelly-baby.json','utf8'));
assert.equal(manifest.sourceHash,createHash('sha256').update(readFileSync('refs/jelly_baby_mesh.html')).digest('hex'),'generated model matches the supplied source');
const receiver=new Float32Array(32*32*3);
// Subpixel and folded beams must preserve flux, independently of footprint area.
for(const triangle of [[[.1,.2],[.8,.3],[.4,.9]],[[.3,.3],[.30001,.3],[.3,.30001]]]) {
  receiver.fill(0);depositBeam(receiver,32,new Vector2(),1,triangle,1,.002);
  assert(Math.abs(receiver.reduce((sum,v)=>sum+v,0)/1024-.002)<1e-8,'beam footprint conserves integrated flux');
}

const passive=new SoftBody(loadModel()),gravity=PHYS.gravity;
PHYS.gravity=0;passive.canSleep=false;
for(let i=1;i<passive.x.length;i+=3)passive.x[i]+=.01;
for(let i=0;i<120;i++)passive.step(PHYS.step);
PHYS.gravity=gravity;
assert(passive.energy()<1e-15,'elastic solver adds no energy to an unloaded rest shape');

const body=new SoftBody(loadModel()),rig=new Locomotion(body);
const baby=new Baby(body);
const step=(n)=>{
  for(let i=0;i<n;i++) {rig.step(PHYS.step);body.step(PHYS.step);rig.afterStep();assert(body.lastMinJacobian>=.12,'every tetrahedron keeps its orientation');}
  body.updateSurface();baby.update();assert(body.isFinite(),'finite FEM state');
};
const started=performance.now();
step(480);
assert(body.sleeping&&body.energy()===0,'idle motion dissipates and sleeps');
const sleepingPositions=body.x.slice();step(120);
assert.deepEqual(body.x,sleepingPositions,'sleeping body remains completely still');
console.log('settled',{massGrams:body.totalMass*1000,volume:body.volumeRatio(),center:body.center.toArray(),height:body.surface.geometry.boundingBox.max.y});
assert(body.volumeRatio()>.80&&body.volumeRatio()<1.20,'volume preserved at rest');
assert(body.surface.geometry.boundingBox.max.y>.055,'baby stands upright at rest');
const bounds=body.surface.geometry.boundingBox;
assert(bounds.max.z-bounds.min.z>.035,'rounded body has substantial front-to-back depth');
// Regress the real framebuffer contamination: all surface details must follow
// the transmissive shell, with ordinary depth occlusion, outside the opaque capture.
for(const object of baby.group.children)if(object!==baby.mesh) {
  assert(object.material.transparent&&object.renderOrder>baby.mesh.renderOrder&&object.material.depthTest,'surface artwork is excluded from the refraction background');
}
const skin=new SurfaceBVH(body.surface);
let minimumClearance=Infinity;
for(const object of baby.group.children)if(object!==baby.mesh) {
  const p=object.geometry.attributes.position.array,index=object.geometry.index.array;
  for(let i=0;i<index.length;i+=3) {
    const ids=[index[i]*3,index[i+1]*3,index[i+2]*3];
    const x=ids.reduce((sum,id)=>sum+p[id],0)/3,y=ids.reduce((sum,id)=>sum+p[id+1],0)/3,z=ids.reduce((sum,id)=>sum+p[id+2],0)/3;
    const hit=skin.hit([x,y,.10],[0,0,-1]);
    if(hit)minimumClearance=Math.min(minimumClearance,z-(.10-hit.distance));
  }
}
console.log('face clearance mm',minimumClearance*1000);
assert(minimumClearance>-.000015,'facial triangles conform outside the rounded skin instead of cutting through it');
function verifyPicks() {
  const camera=new PerspectiveCamera(36,1,.001,2),raycaster=new Raycaster();
  let hits=0,maxError=0;
  for(const angle of [0,.7,1.8,Math.PI,4.8]) {
    camera.position.copy(body.center).add(new Vector3(Math.sin(angle)*.17,.08,Math.cos(angle)*.17));
    camera.lookAt(body.center);camera.updateMatrixWorld();baby.mesh.updateMatrixWorld();
    for(let y=-.3;y<=.3;y+=.15)for(let x=-.3;x<=.3;x+=.15) {
      raycaster.setFromCamera(new Vector2(x,y),camera);
      const hit=raycaster.intersectObject(baby.mesh,false)[0];if(!hit)continue;
      const grab=surfaceGrab(body,hit.face,hit.point);assert(grab,'visible hit binds to simulation');
      const projected=grab.point.clone().project(camera);
      maxError=Math.max(maxError,Math.hypot(projected.x-x,projected.y-y));hits++;
    }
  }
  assert(hits>20&&maxError<1e-5,'grab reconstructs the selected screen point around the deformed body');
  return {hits,maxError};
}
console.log('picks at rest',verifyPicks());
const origin=body.center.clone();rig.move.set(0,0,1);step(360);
console.log('walk',{distance:body.center.distanceTo(origin),center:body.center.toArray(),volume:body.volumeRatio()});
assert(body.center.z-origin.z>.025,'walking advances over the table');
rig.move.set(0,0,-1);step(240);
console.log('turn',{yaw:rig.yaw,volume:body.volumeRatio()});
console.log('picks after turn',verifyPicks());
rig.move.set(0,0,0);step(240);
const floorHeight=body.center.y;rig.jump();let peak=0,airtime=0,flight=null,leftFloor=false;
for(let i=0;i<240;i++){
  step(1);peak=Math.max(peak,body.center.y);
  if(!rig.grounded){leftFloor=true;if(flight===null)airtime+=PHYS.step;}
  else if(leftFloor&&flight===null)flight=airtime;
}
console.log('jump',{rise:peak-floorHeight,airtime,volume:body.volumeRatio()});
assert(peak-floorHeight>.008,'jump lifts the entire body');
assert(airtime>.30&&peak-floorHeight<.09,'low gravity gives a longer, controlled floating hop');
step(360);
const grabBVH=new SurfaceBVH(body.surface),grabOrigin=[body.center.x,body.center.y+.12,body.center.z];
const grabHit=grabBVH.hit(grabOrigin,[0,-1,0]);assert(grabHit,'crown is a real visible surface');
const ids=body.surface.indices.slice(grabHit.t*3,grabHit.t*3+3);
const point=new Vector3(grabOrigin[0],grabOrigin[1]-grabHit.distance,grabOrigin[2]);
const binding=surfaceGrab(body,{a:ids[0],b:ids[1],c:ids[2]},point);assert(binding);
body.grab={...binding,target:point.clone(),lambda:new Float64Array(3)};
for(let i=0;i<100;i++){
  body.grab.target.x+=.0004;body.grab.target.y+=.0006;step(1);
}
const energy=body.energy();body.grab=null;
console.log('release',{energy,volume:body.volumeRatio()});
assert(energy>1e-6,'grab imparts momentum');step(720);
assert(body.volumeRatio()>.7&&body.volumeRatio()<1.3,'volume recovers after throwing');
console.log('picks after throw',verifyPicks());
body.nudge();const nudgeEnergy=body.energy();step(120);const decayingEnergy=body.energy();
assert(decayingEnergy<nudgeEnergy*.1,'physical damping removes most recoil energy');
step(600);assert(body.sleeping&&body.energy()===0,'recoil ends in complete rest');
const pickCamera=new PerspectiveCamera(45,1,.001,2);pickCamera.position.set(0,.14,.18);pickCamera.lookAt(0,.03,0);pickCamera.updateMatrixWorld();
const pickRay=new Raycaster();pickRay.setFromCamera(new Vector2(.3,-.9),pickCamera);
const dragPlane=new Plane().setFromNormalAndCoplanarPoint(pickCamera.getWorldDirection(new Vector3()),new Vector3(0,.03,0));
const projectedTarget=new Vector3();assert(projectGrabTarget(pickRay.ray,dragPlane,projectedTarget));
assert(pickRay.ray.distanceToPoint(projectedTarget)<1e-9&&projectedTarget.y>=.000299,'floor-constrained dragging stays on the cursor ray');
const responsive=new Vector3(),desired=new Vector3(.01,.01,0);
for(let i=0;i<8;i++)advanceGrabTarget(responsive,desired,PHYS.step);
assert(responsive.distanceTo(desired)<.001,'pointer response settles within 34 ms');
const bytes=readFileSync('src/assets/bg_room.exr');
const exr=new EXRLoader().setDataType(HalfFloatType).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const studio=shapeStudioLight(exr,measureWindow(exr).incoming.negate());
const light=measureWindow(studio);
console.log('HDR window',{incoming:light.incoming.toArray(),irradiance:light.irradiance,fraction:light.windowFraction,color:light.color.toArray()});
assert(light.incoming.y<-.45&&light.incoming.clone().negate().dot(STUDIO_KEY)>.9,'reflections and transport use the same elevated HDR key');
assert(light.windowFraction>.35,'window supplies a legible, measured shadow contribution');
const optics=new RefractiveLightField(body.surface,light.incoming,ABSORPTION);
const camera=new PerspectiveCamera();camera.position.set(.08,.13,.19);
let t=performance.now();optics.update(body);console.log('transport ms',performance.now()-t);
t=performance.now();optics.updateViewThickness(camera);console.log('thickness ms',performance.now()-t);
assert(optics.lightBytes.some((v,i)=>i%4!==3&&v>0),'refracted photons reach table');
assert(Math.max(...optics.shadow)>.9,'deformed geometry casts a full directional shadow');
const pixelArea=(optics.span/optics.size)**2,flux=[0,0,0];
for(let i=0;i<optics.size*optics.size;i++)for(let c=0;c<3;c++)flux[c]+=DataUtils.fromHalfFloat(optics.lightBytes[i*4+c])*pixelArea;
assert(flux[1]>flux[0]&&flux[1]>flux[2],'caustic absorption has the same green spectral signature as the jelly');
assert(optics.span<.3,'grounded receiver keeps enough resolution for contact and caustics');
console.log('optical flux',flux);
assert([...body.surface.geometry.attributes.opticalThickness.array].every(Number.isFinite),'finite optical thickness');
console.log('PASS — settle, walk, turn, jump, grab, release, recovery, caustics; seconds:',(performance.now()-started)/1000);

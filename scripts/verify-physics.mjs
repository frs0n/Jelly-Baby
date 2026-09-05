import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, PerspectiveCamera, HalfFloatType } from 'three/webgpu';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { measureWindow } from '../src/graphics/environment.ts';
import { makeBabyCage } from '../src/physics/baby-cage.ts';
import { SoftBody } from '../src/physics/soft-body.js';
import { PHYS } from '../src/physics/constants.js';
import { Locomotion } from '../src/game/locomotion.ts';
import { Baby } from '../src/graphics/baby.ts';
import { RefractiveLightField } from '../src/graphics/refractive-light.js';

const body=new SoftBody(makeBabyCage()),rig=new Locomotion(body);
const baby=new Baby(body);
const step=(n)=>{
  for(let i=0;i<n;i++) {rig.step(PHYS.step);body.step(PHYS.step);rig.afterStep();}
  body.updateSurface();baby.update();assert(body.isFinite(),'finite FEM state');
};
const started=performance.now();
step(480);
console.log('settled',{massGrams:body.totalMass*1000,volume:body.volumeRatio(),center:body.center.toArray(),height:body.surface.geometry.boundingBox.max.y});
assert(body.volumeRatio()>.80&&body.volumeRatio()<1.20,'volume preserved at rest');
assert(body.surface.geometry.boundingBox.max.y>.055,'baby stands upright at rest');
const origin=body.center.clone();rig.move.set(0,0,1);step(360);
console.log('walk',{distance:body.center.distanceTo(origin),center:body.center.toArray(),volume:body.volumeRatio()});
assert(body.center.z-origin.z>.025,'walking advances over the table');
rig.move.set(0,0,-1);step(240);
console.log('turn',{yaw:rig.yaw,volume:body.volumeRatio()});
rig.move.set(0,0,0);step(240);
const floorHeight=body.center.y;rig.jump();let peak=0;
for(let i=0;i<180;i++){step(1);peak=Math.max(peak,body.center.y);}
console.log('jump',{rise:peak-floorHeight,volume:body.volumeRatio()});
assert(peak-floorHeight>.008,'jump lifts the entire body');
step(360);
let top=0;
for(let i=1;i<body.mass.length;i++)if(body.x[i*3+1]>body.x[top*3+1])top=i;
const point=new Vector3().fromArray(body.x,top*3);
body.grab={weights:[[top,1]],target:point.clone(),point:point.clone(),lambda:new Float64Array(3)};
for(let i=0;i<100;i++){
  body.grab.target.x+=.0004;body.grab.target.y+=.0006;step(1);
}
const energy=body.energy();body.grab=null;
console.log('release',{energy,volume:body.volumeRatio()});
assert(energy>1e-6,'grab imparts momentum');step(720);
assert(body.volumeRatio()>.7&&body.volumeRatio()<1.3,'volume recovers after throwing');
const bytes=readFileSync('src/assets/bg_room.exr');
const exr=new EXRLoader().setDataType(HalfFloatType).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const light=measureWindow(exr);
console.log('HDR window',{incoming:light.incoming.toArray(),irradiance:light.irradiance,fraction:light.windowFraction,color:light.color.toArray()});
assert(light.incoming.y<-.05,'HDR window illuminates down onto the table');
const optics=new RefractiveLightField(body.surface,light.incoming,[26,4,72]);
const camera=new PerspectiveCamera();camera.position.set(.08,.13,.19);
let t=performance.now();optics.update(body);console.log('transport ms',performance.now()-t);
t=performance.now();optics.updateViewThickness(camera);console.log('thickness ms',performance.now()-t);
assert(optics.lightBytes.some((v,i)=>i%4!==3&&v>0),'refracted photons reach table');
assert([...body.surface.geometry.attributes.opticalThickness.array].every(Number.isFinite),'finite optical thickness');
console.log('PASS — settle, walk, turn, jump, grab, release, recovery, caustics; seconds:',(performance.now()-started)/1000);

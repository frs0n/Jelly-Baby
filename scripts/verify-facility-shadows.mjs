import assert from 'node:assert/strict';
import { Box3, Vector3, WebGPUCoordinateSystem } from 'three/webgpu';
import { FacilityShadows } from '../src/graphics/facility-shadows.ts';
import { Swing } from '../src/graphics/swing.ts';
import { SWING } from '../src/game/swing-physics.ts';
import { Trampoline } from '../src/graphics/trampoline.ts';
import { TRAMPOLINE } from '../src/game/trampoline-physics.ts';

const incoming=new Vector3(.494,-.748,-.443).normalize();
const shadows=new FacilityShadows(incoming),swing=new Swing();
shadows.add(swing.group,new Box3(new Vector3(SWING.x-.10,0,SWING.z-.15),new Vector3(SWING.x+.10,SWING.height+.02,SWING.z+.15)));
const visible=[];swing.group.traverse(object=>{if(object.isMesh)visible.push(object);});
assert(visible.every(mesh=>!mesh.material.transparent),'no coplanar transparent shadow overlays remain');
let renders=0;
let projectionChecks=0,oldMappingError=0;
function verifyTableLookup(scene,camera,sources) {
  // Match Renderer._updateCamera and WebGPU's top-left framebuffer origin.
  camera.coordinateSystem=WebGPUCoordinateSystem;camera.updateProjectionMatrix();
  scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  assert.equal(scene.children.length,sources.length*2,'every component contributes directional and contact shadows');
  scene.children.forEach((mesh,i)=>{
    const source=sources[Math.floor(i/2)],contact=mesh.name==='facility-contact';
    assert.equal(mesh.geometry,source.geometry,'shadow uses actual visible geometry');
    const positions=mesh.geometry.attributes.position;
    for(let j=0;j<positions.count;j++) {
      const local=new Vector3().fromBufferAttribute(positions,j);
      const world=local.clone().applyMatrix4(source.matrixWorld);
      const projected=local.clone().applyMatrix4(mesh.matrixWorld);
      const t=contact?0:(-.00005-world.y)/incoming.y;
      if(contact)assert(Math.abs(projected.z-world.y)<1e-8,'contact falloff uses real height above the table');
      const tableX=world.x+incoming.x*t,tableZ=world.z+incoming.z*t;
      assert(Math.abs(projected.x-tableX)<1e-8,'X follows measured light direction');
      assert(Math.abs(projected.y-tableZ)<1e-8,'Z follows measured light direction');
      const clip=projected.project(camera);
      assert(Math.abs(clip.x)<1&&Math.abs(clip.y)<1,'full motion envelope fits fixed texture bounds');
      const rasterU=.5+.5*clip.x,rasterV=.5-.5*clip.y;
      // Use the SAME uniform matrix consumed by the table shader. This closes
      // the previous test gap between a correct projection and a mirrored lookup.
      const lookup=new Vector3(tableX,tableZ,1).applyMatrix3(shadows.worldToUVNode.value);
      assert(Math.abs(lookup.x-rasterU)<1e-8&&Math.abs(lookup.y-rasterV)<1e-8,'table lookup reaches the texel written by the shadow rasterizer');
      const oldV=(tableZ-shadows.originNode.value.y)/shadows.spanNode.value.y;
      oldMappingError=Math.max(oldMappingError,Math.abs(oldV-rasterV));projectionChecks++;
    }
  });
}
const originalTarget={},renderer={
  target:originalTarget,autoClear:false,
  getRenderTarget(){return this.target;},setRenderTarget(target){this.target=target;},
  render(scene,camera){
    renders++;verifyTableLookup(scene,camera,visible);
  },
};
shadows.update(renderer);assert.equal(renders,1);
shadows.update(renderer);assert.equal(renders,1,'idle shadow reuses its exact mask');
const origin=shadows.originNode.value.clone(),span=shadows.spanNode.value.clone();
for(const angle of [-SWING.maxAngle,-.4,0,.000001,.4,SWING.maxAngle]) {
  swing.update(angle);shadows.update(renderer);
  assert.deepEqual(shadows.originNode.value,origin);assert.deepEqual(shadows.spanNode.value,span);
}
assert.equal(renders,7,'moving seat invalidates the mask');
assert.equal(renderer.target,originalTarget);assert.equal(renderer.autoClear,false);
swing.update(.1);renderer.render=()=>{throw new Error('simulated GPU failure');};
assert.throws(()=>shadows.update(renderer),/simulated GPU failure/);
assert.equal(renderer.target,originalTarget,'failure restores the render target');assert.equal(renderer.autoClear,false);
const trampoline=new Trampoline();
const cushion=trampoline.group.getObjectByName('trampoline-cushion');
const p=cushion.geometry.attributes.position,ix=cushion.geometry.index.array,edges=new Map();
const vertexKey=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(value=>Math.round(value*1e8)).join(',');
for(let i=0;i<ix.length;i+=3)for(let e=0;e<3;e++) {
  const a=vertexKey(ix[i+e]),b=vertexKey(ix[i+(e+1)%3]),key=[a,b].sort().join('/');
  edges.set(key,(edges.get(key)??0)+1);
}
assert([...edges.values()].every(count=>count===2),'cushion is a closed manifold, including the underside and seam');
for(const foot of trampoline.group.children.filter(part=>part.name==='trampoline-foot')) {
  foot.geometry.computeBoundingBox();
  const low=foot.geometry.boundingBox.min.y+foot.position.y;
  assert(low>=0&&low<.0005,'rubber soles sit flat at the tabletop without sinking');
}
shadows.add(trampoline.group,new Box3(new Vector3(TRAMPOLINE.x-.105,0,TRAMPOLINE.z-.105),new Vector3(TRAMPOLINE.x+.105,.058,TRAMPOLINE.z+.105)));
trampoline.group.traverse(object=>{if(object.isMesh)visible.push(object);});
renderer.render=(scene,camera)=>{
  renders++;verifyTableLookup(scene,camera,visible);
  for(const name of ['trampoline-leg','trampoline-foot']) {
    const parts=trampoline.group.children.filter(part=>part.name===name);
    assert.equal(parts.length,name==='trampoline-leg'?3:6);
    for(const part of parts) {
      assert.equal(scene.children.filter(mesh=>mesh.geometry===part.geometry&&mesh.name!=='facility-contact').length,name==='trampoline-foot'?6:1,'complete legs and rubber feet cast directional shadows');
      assert(scene.children.some(mesh=>mesh.geometry===part.geometry&&mesh.name==='facility-contact'),'supports also contribute ground contact');
    }
  }
};
shadows.update(renderer);const beforeDeformation=renders;
trampoline.update(-.03);shadows.update(renderer);
assert.equal(renders,beforeDeformation+1,'deforming fabric invalidates shadows even with a stationary object matrix');
shadows.update(renderer);assert.equal(renders,beforeDeformation+1,'unchanged deformation reuses the shadow');
assert(oldMappingError>.25,'this regression detects the previous vertically mirrored lookup');
trampoline.dispose();
shadows.dispose();swing.dispose();
console.log('Full facility projection, WebGPU table lookup, swept bounds, idle caching and render-state restoration passed',{projectionChecks,oldMappingError});

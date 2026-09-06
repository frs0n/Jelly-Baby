import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three/webgpu';
import { FacilityShadows } from '../src/graphics/facility-shadows.ts';
import { Swing } from '../src/graphics/swing.ts';
import { SWING } from '../src/game/swing-physics.ts';

const incoming=new Vector3(.494,-.748,-.443).normalize();
const shadows=new FacilityShadows(incoming),swing=new Swing();
shadows.add(swing.group,new Box3(new Vector3(SWING.x-.10,0,SWING.z-.15),new Vector3(SWING.x+.10,SWING.height+.02,SWING.z+.15)));
const visible=[];swing.group.traverse(object=>{if(object.isMesh)visible.push(object);});
assert(visible.every(mesh=>!mesh.material.transparent),'no coplanar transparent shadow overlays remain');
let renders=0;
const originalTarget={},renderer={
  target:originalTarget,autoClear:false,
  getRenderTarget(){return this.target;},setRenderTarget(target){this.target=target;},
  render(scene,camera){
    renders++;scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    assert.equal(scene.children.length,visible.length,'every component contributes to the shadow');
    scene.children.forEach((mesh,i)=>{
      assert.equal(mesh.geometry,visible[i].geometry,'shadow uses actual visible geometry');
      const positions=mesh.geometry.attributes.position;
      for(let j=0;j<positions.count;j++) {
        const local=new Vector3().fromBufferAttribute(positions,j);
        const world=local.clone().applyMatrix4(visible[i].matrixWorld);
        const projected=local.clone().applyMatrix4(mesh.matrixWorld);
        const t=(-.00005-world.y)/incoming.y;
        assert(Math.abs(projected.x-world.x-incoming.x*t)<1e-8,'X follows measured light direction');
        assert(Math.abs(projected.y-world.z-incoming.z*t)<1e-8,'Z follows measured light direction');
        const clip=projected.project(camera);
        assert(Math.abs(clip.x)<1&&Math.abs(clip.y)<1,'full motion envelope fits fixed texture bounds');
      }
    });
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
shadows.dispose();swing.dispose();
console.log('Full facility projection, swept bounds, idle caching and render-state restoration passed');

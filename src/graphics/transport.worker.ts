import * as THREE from 'three/webgpu';
import { RefractiveLightField } from './refractive-light.js';
import { deformSurface } from '../physics/deform-surface.js';

let optics:RefractiveLightField;
let geometry:THREE.BufferGeometry;
let positions:Float32Array;
let surface:{geometry:THREE.BufferGeometry;positions:Float32Array;indices:Uint32Array;restNormals:Float32Array;bindingIds:Uint32Array;bindingWeights:Float64Array};

self.onmessage=({data})=>{
  try {
    if(data.type==='init') {
      positions=data.positions;
      geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      geometry.setAttribute('normal',new THREE.BufferAttribute(data.restNormals.slice(),3));
      geometry.setAttribute('opticalThickness',new THREE.BufferAttribute(new Float32Array(positions.length/3).fill(.04),1));
      geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
      // Initial positions define the BVH partition; subsequent work only refits it.
      geometry.computeBoundingBox();
      surface={geometry,positions,indices:data.indices,restNormals:data.restNormals,bindingIds:data.bindingIds,bindingWeights:data.bindingWeights};
      optics=new RefractiveLightField(surface,new THREE.Vector3().fromArray(data.direction),data.sigma);
      return;
    }
    const center=new THREE.Vector3().fromArray(data.center);
    if(data.particles){
      deformSurface(surface,data.particles,data.nodalF);optics.update({center});
      const light=optics.lightBytes.slice(),shadow=optics.shadowBytes.slice();
      self.postMessage({light,shadow,origin:optics.origin.toArray(),span:optics.span,center:data.center},
        {transfer:[light.buffer,shadow.buffer]});
    }
    optics.updateViewThickness({position:new THREE.Vector3().fromArray(data.camera)});
    const thickness=new Float32Array(geometry.getAttribute('opticalThickness').array);
    self.postMessage({thickness},{transfer:[thickness.buffer]});
  } catch(error) {
    self.postMessage({error:error instanceof Error?error.message:String(error)});
  }
};

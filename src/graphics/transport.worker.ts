import * as THREE from 'three/webgpu';
import { RefractiveLightField } from './refractive-light.js';

let optics:RefractiveLightField;
let geometry:THREE.BufferGeometry;
let positions:Float32Array;

self.onmessage=({data})=>{
  try {
    if(data.type==='init') {
      positions=new Float32Array(data.vertexCount*3);
      geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(positions.length),3));
      geometry.setAttribute('opticalThickness',new THREE.BufferAttribute(new Float32Array(data.vertexCount).fill(.03),1));
      geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
      // Initial positions define the BVH partition; subsequent work only refits it.
      positions.set(data.positions);geometry.computeBoundingBox();geometry.computeVertexNormals();
      const surface={geometry,positions,indices:geometry.index!.array};
      optics=new RefractiveLightField(surface,new THREE.Vector3().fromArray(data.direction),data.sigma);
      return;
    }
    positions.set(data.positions);
    geometry.getAttribute('normal').array.set(data.normals);
    geometry.computeBoundingBox();
    const center=new THREE.Vector3().fromArray(data.center);
    optics.update({center});
    optics.updateViewThickness({position:new THREE.Vector3().fromArray(data.camera)});
    const light=optics.lightBytes.slice(),shadow=optics.shadowBytes.slice();
    const thickness=new Float32Array(geometry.getAttribute('opticalThickness').array);
    self.postMessage({light,shadow,thickness,origin:optics.origin.toArray(),span:optics.span,center:data.center},
      {transfer:[light.buffer,shadow.buffer,thickness.buffer]});
  } catch(error) {
    self.postMessage({error:error instanceof Error?error.message:String(error)});
  }
};

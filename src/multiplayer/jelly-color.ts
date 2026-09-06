import * as THREE from 'three/webgpu';
import { mix, positionLocal, uniform, smoothstep, float } from 'three/tsl';
import { appearanceAbsorption, type Appearance } from './appearance.ts';

export function colorJelly(material:THREE.MeshPhysicalNodeMaterial,p:Appearance,center:THREE.Vector3) {
  const root=uniform(center),point=positionLocal.sub(root);
  const gradient=smoothstep(float(-.025),float(.035),point.y.add(point.x.mul(p.angle)));
  material.colorNode=mix(uniform(new THREE.Color(p.primary)),uniform(new THREE.Color(p.secondary)),gradient);
  material.attenuationColor.setRGB(...appearanceAbsorption(p).map(a=>Math.exp(-a*material.attenuationDistance)) as [number,number,number]);
  material.needsUpdate=true;
}

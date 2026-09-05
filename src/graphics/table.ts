import * as THREE from 'three/webgpu';
import { texture, positionWorld, float, vec2, vec3, normalMap } from 'three/tsl';
import type { RefractiveLightField } from './refractive-light.js';

export async function makeTable(optics:RefractiveLightField,light:{color:THREE.Color;windowFraction:number;irradiance:number}) {
  const loader=new THREE.TextureLoader();
  const urls=[new URL('../assets/wood_texture/wood_base.jpg',import.meta.url).href,
    new URL('../assets/wood_texture/wood_normal.png',import.meta.url).href,
    new URL('../assets/wood_texture/wood_roughness.jpg',import.meta.url).href];
  const [base,normal,roughness]=await Promise.all(urls.map(url=>loader.loadAsync(url)));
  base.colorSpace=THREE.SRGBColorSpace;
  for(const t of [base,normal,roughness]) {t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;}
  const uv=positionWorld.xz.div(2.5).add(.5);
  const opticalUV=positionWorld.xz.sub(optics.originNode).div(optics.spanNode);
  const inside=float(opticalUV.x.greaterThan(0).and(opticalUV.x.lessThan(1)).and(opticalUV.y.greaterThan(0)).and(opticalUV.y.lessThan(1)));
  const mask=texture(optics.shadowTexture,opticalUV).mul(inside);
  const albedo=texture(base,uv).rgb;
  const material=new THREE.MeshPhysicalNodeMaterial({metalness:0,roughness:.26,clearcoat:.45,clearcoatRoughness:.19});
  material.colorNode=albedo.mul(float(1).sub(mask.r.mul(light.windowFraction))).mul(float(1).sub(mask.g.mul(.40)));
  // Plane UV-v points toward -Z; the metre-scaled world UV points toward +Z.
  material.normalNode=normalMap(texture(normal,uv),vec2(.27,-.27));
  material.roughnessNode=texture(roughness,uv).r.mul(.30).add(.12);
  material.emissiveNode=albedo.mul(texture(optics.lightTexture,opticalUV).rgb).mul(5*light.irradiance/Math.PI).mul(vec3(light.color.r,light.color.g,light.color.b)).mul(inside);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(200,200),material);
  mesh.rotation.x=-Math.PI/2;mesh.position.y=-.00005;
  return {mesh,dispose:()=>{mesh.geometry.dispose();material.dispose();[base,normal,roughness].forEach(t=>t.dispose());}};
}

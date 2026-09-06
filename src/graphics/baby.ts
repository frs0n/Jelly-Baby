import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { SurfaceBVH } from './refractive-light.js';
import type { SoftBody } from '../physics/soft-body.js';
import { refinePatch } from './surface-details.ts';
import { DEFAULT_JELLY_FLAVOR, JELLY_FLAVORS, type JellyFlavorName } from './jelly-flavors.ts';

export const ABSORPTION=JELLY_FLAVORS[DEFAULT_JELLY_FLAVOR].absorption;
type Binding={weights:[number,number][]; offset:number; face:number[]; bary:number[]};

export class Baby {
  readonly mesh:THREE.Mesh;
  readonly group=new THREE.Group();
  private details:{mesh:THREE.Mesh; bindings:Binding[]}[]=[];
  private readonly jellyMaterial:THREE.MeshPhysicalNodeMaterial;
  readonly body:SoftBody;
  constructor(body:SoftBody) {
    this.body=body;
    const material=new THREE.MeshPhysicalNodeMaterial({
      color:JELLY_FLAVORS[DEFAULT_JELLY_FLAVOR].surface,roughness:.085,metalness:0,transmission:1,thickness:.035,
      ior:1.35,dispersion:.025,attenuationDistance:.035,
      clearcoat:.42,clearcoatRoughness:.05,envMapIntensity:1.05,
      transparent:false,side:THREE.FrontSide,flatShading:false,
    });
    this.jellyMaterial=material;
    this.setFlavor(DEFAULT_JELLY_FLAVOR);
    material.thicknessNode=attribute('opticalThickness','float');
    this.mesh=new THREE.Mesh(body.surface.geometry,material);
    this.mesh.renderOrder=1;
    this.mesh.frustumCulled=false;this.group.add(this.mesh);
    const bvh=new SurfaceBVH(body.surface);
    const eye=new THREE.MeshPhysicalNodeMaterial({color:'#142905',roughness:.13,clearcoat:1,clearcoatRoughness:.06});
    const mouth=new THREE.MeshPhysicalNodeMaterial({color:'#254508',roughness:.24,clearcoat:.6});
    const tongue=new THREE.MeshPhysicalNodeMaterial({color:'#b5d641',roughness:.24,clearcoat:.5});
    const blush=new THREE.MeshPhysicalNodeMaterial({color:'#edab4f',roughness:.3,transparent:true,opacity:.30,depthWrite:false});
    const add=(geometry:THREE.BufferGeometry,mat:THREE.Material,cx:number,cy:number,depth:number)=>{
      const pos=geometry.getAttribute('position'),bindings:Binding[]=[];
      for(let i=0;i<pos.count;i++) {
        const px=pos.getX(i)+cx,py=pos.getY(i)+cy;
        const hit=bvh.hit([px,py,.08],[0,0,-1]);
        if(!hit) throw new Error('Facial detail outside the jelly surface');
        const ids=Array.from(body.surface.indices.slice(hit.t*3,hit.t*3+3)) as number[];
        const weights=new Map<number,number>();
        [1-hit.u-hit.v,hit.u,hit.v].forEach((bary,k)=>{
          for(const [id,w] of body.surface.stencils[ids[k]]) weights.set(id,(weights.get(id)||0)+bary*w);
        });
        bindings.push({weights:[...weights],offset:Math.max(.00008,pos.getZ(i)+depth),face:ids,bary:[1-hit.u-hit.v,hit.u,hit.v]});
      }
      geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos.count*3),3).setUsage(THREE.DynamicDrawUsage));
      const mesh=new THREE.Mesh(geometry,mat);mesh.frustumCulled=false;
      // Three r185 samples the opaque framebuffer for transmission. Surface ink
      // must enter the transparent queue AFTER jelly, otherwise it is refracted
      // as background and appears a second time. Keep depth testing/writing on.
      mat.transparent=true;mesh.renderOrder=2;
      this.group.add(mesh);this.details.push({mesh,bindings});
    };
    const oval=(x:number,y:number,z:number)=>new THREE.SphereGeometry(1,40,24,0,Math.PI*2,0,Math.PI/2).rotateX(Math.PI/2).scale(x,y,z);
    for(const sign of [-1,1]) {
      add(oval(.00325,.0043,.0015),eye,sign*.0095,.0465,.00010);
      add(oval(.0043,.0024,.00016),blush,sign*.014,.0388,.00010);
      const brow=new THREE.CatmullRomCurve3([
        new THREE.Vector3(-.0021,-.0005,0),new THREE.Vector3(0,.00045,0),new THREE.Vector3(.0021,-.0002,0),
      ]);
      add(new THREE.TubeGeometry(brow,16,.00048,8,false),mouth,sign*.0097,.0542,.00025);
    }
    const smile=new THREE.Shape();
    smile.moveTo(-.0046,.0019);smile.bezierCurveTo(-.002,.0006,.002,.0006,.0046,.002);
    smile.bezierCurveTo(.0055,-.0046,-.0048,-.0052,-.0046,.0019);
    add(refinePatch(new THREE.ShapeGeometry(smile,24)),mouth,0,.0389,.00018);
    const lip=new THREE.Shape();lip.absellipse(0,0,.0024,.00125,0,Math.PI*2,false,0);
    add(refinePatch(new THREE.ShapeGeometry(lip,24)),tongue,0,.0368,.00028);
    this.update();
  }
  setFlavor(flavor:JellyFlavorName) {
    const look=JELLY_FLAVORS[flavor],distance=this.jellyMaterial.attenuationDistance;
    this.jellyMaterial.color.set(look.surface);
    this.jellyMaterial.attenuationColor.setRGB(
      Math.exp(-look.absorption[0]*distance),Math.exp(-look.absorption[1]*distance),Math.exp(-look.absorption[2]*distance),
      THREE.LinearSRGBColorSpace,
    );
  }
  update() {
    const x=this.body.x,n=this.body.surface.geometry.attributes.normal.array;
    const normal=new THREE.Vector3();
    for(const {mesh,bindings} of this.details) {
      const positions=mesh.geometry.getAttribute('position');
      bindings.forEach((binding,i)=>{
        let px=0,py=0,pz=0;
        for(const [id,w] of binding.weights) {px+=x[id*3]*w;py+=x[id*3+1]*w;pz+=x[id*3+2]*w;}
        normal.set(0,0,0);
        binding.face.forEach((id,k)=>{
          const w=binding.bary[k];normal.x+=n[id*3]*w;normal.y+=n[id*3+1]*w;normal.z+=n[id*3+2]*w;
        });
        normal.normalize().multiplyScalar(binding.offset);
        positions.setXYZ(i,px+normal.x,py+normal.y,pz+normal.z);
      });
      positions.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
  }
  dispose() {
    this.group.traverse(object=>{
      if(object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials=Array.isArray(object.material)?object.material:[object.material];
        materials.forEach(m=>m.dispose());
      }
    });
  }
}

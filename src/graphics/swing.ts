import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { positionLocal, vec3 } from 'three/tsl';
import { SWING } from '../game/swing-physics.ts';

/** A miniature joiner's swing: rounded timber, inset pegs and paired rope bridles. */
export class Swing {
  readonly group=new THREE.Group();
  readonly pivot=new THREE.Group();
  readonly legs:{a:THREE.Vector3;b:THREE.Vector3;radius:number}[]=[];
  constructor() {
    this.group.position.set(SWING.x,0,SWING.z);
    const timber=new THREE.MeshPhysicalNodeMaterial({color:'#bd9464',roughness:.48,clearcoat:.18});
    const grain=positionLocal.x.mul(3400).add(positionLocal.y.mul(38).sin().mul(1.8)).sin().mul(.045).add(.955);
    timber.colorNode=vec3(timber.color.r,timber.color.g,timber.color.b).mul(grain);
    const sage=new THREE.MeshPhysicalNodeMaterial({color:'#81915d',roughness:.4,clearcoat:.28});
    const brass=new THREE.MeshStandardNodeMaterial({color:'#ad8950',metalness:.75,roughness:.32});
    const rope=new THREE.MeshStandardNodeMaterial({color:'#ede0bb',roughness:.95});
    const box=(parent:THREE.Group,w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material,r=.0015)=>{
      const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,r),material);
      mesh.position.set(x,y,z);parent.add(mesh);return mesh;
    };
    const rod=(parent:THREE.Group,a:THREE.Vector3,b:THREE.Vector3,r:number,material:THREE.Material)=>{
      const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,a.distanceTo(b),12),material);
      mesh.position.copy(a).add(b).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());parent.add(mesh);
    };
    for(const side of [-1,1]) {
      const x=side*.073;
      for(const end of [-1,1]) {
        const a=new THREE.Vector3(x,.005,end*.066),b=new THREE.Vector3(x,SWING.height,0);
        const beam=box(this.group,.011,a.distanceTo(b),.012,0,0,0,timber);
        beam.position.copy(a).add(b).multiplyScalar(.5);
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());
        this.legs.push({a:a.clone().add(this.group.position),b:b.clone().add(this.group.position),radius:.007});
        box(this.group,.018,.006,.022,x,.003,end*.066,sage);
      }
      box(this.group,.009,.009,.090,x,.055,0,timber);
      for(const y of [.055,SWING.height]) {
        const zs=y===.055?[-.042,.042]:[0];
        for(const z of zs)rod(this.group,new THREE.Vector3(x-.006,y,z),new THREE.Vector3(x+.006,y,z),.0025,brass);
      }
    }
    box(this.group,.174,.014,.015,0,SWING.height+.004,0,timber,.003);
    this.pivot.position.y=SWING.height;this.group.add(this.pivot);
    for(const side of [-1,1]) {
      const x=side*.047;
      const ring=new THREE.Mesh(new THREE.TorusGeometry(.003,.001,8,16),brass);
      ring.position.set(x,SWING.height-.003,0);ring.rotation.y=Math.PI/2;this.group.add(ring);
      rod(this.pivot,new THREE.Vector3(x,0,0),new THREE.Vector3(x,-SWING.length+.027,0),.0013,rope);
      for(const end of [-1,1]) {
        rod(this.pivot,new THREE.Vector3(x,-SWING.length+.027,0),new THREE.Vector3(x,-SWING.length,end*.018),.0011,rope);
        const knot=new THREE.Mesh(new THREE.SphereGeometry(.002,10,8),rope);
        knot.position.set(x,-SWING.length-.004,end*.018);this.pivot.add(knot);
      }
    }
    // Three individual slats with rounded edges and visible brass fixings.
    for(const z of [-.016,0,.016]) {
      box(this.pivot,SWING.width,.006,.015,0,-SWING.length,z,sage,.002);
      for(const x of [-.047,.047])rod(this.pivot,new THREE.Vector3(x,-SWING.length+.003,z),new THREE.Vector3(x,-SWING.length+.0034,z),.0011,brass);
    }
    for(const x of [-.040,.040])box(this.pivot,.008,.006,.047,x,-SWING.length-.006,0,timber);
  }
  update(angle:number) {
    this.pivot.rotation.x=-angle;
  }
  dispose() {
    const materials=new Set<THREE.Material>();
    this.group.traverse(object=>{
      if(object instanceof THREE.Mesh){object.geometry.dispose();materials.add(object.material as THREE.Material);}
    });
    materials.forEach(material=>material.dispose());
  }
}

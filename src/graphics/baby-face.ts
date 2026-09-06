import * as THREE from 'three/webgpu';
import type { SoftBody } from '../physics/soft-body.js';
import { refinePatch } from './surface-details.ts';
import { FaceSkin } from './face-skin.ts';
import { FaceExpression } from './face-expression.ts';

type Feature='eye'|'blush'|'brow'|'mouth'|'tongue';
// Locating a vertex costs a search through the rest triangles under it, while the
// expression usually holds it at the same rest coordinate for many frames. Keep
// the located triangle next to the coordinate it was found for, and re-search only
// the vertices an expression actually moved.
type Detail={mesh:THREE.Mesh;rest:Float32Array;cx:number;cy:number;depth:number;kind:Feature;located:Float64Array;source:Float64Array;placed:boolean};

export class BabyFace {
  private readonly details:Detail[]=[];
  private readonly skin:FaceSkin;
  private readonly expression=new FaceExpression();
  private readonly sample=new Float64Array(6);
  private surfaceVersion=-1;
  private lastBlink=-1;
  private lastSob=-1;
  private lastLaugh=-1;
  private readonly body:SoftBody;
  constructor(body:SoftBody,group:THREE.Group) {
    this.body=body;
    this.skin=new FaceSkin(body);
    const eye=new THREE.MeshPhysicalNodeMaterial({color:'#142905',roughness:.13,clearcoat:1,clearcoatRoughness:.06});
    const mouth=new THREE.MeshPhysicalNodeMaterial({color:'#254508',roughness:.24,clearcoat:.6});
    const tongue=new THREE.MeshPhysicalNodeMaterial({color:'#b5d641',roughness:.24,clearcoat:.5});
    const blush=new THREE.MeshPhysicalNodeMaterial({color:'#edab4f',roughness:.3,transparent:true,opacity:.30,depthWrite:false});
    const add=(geometry:THREE.BufferGeometry,mat:THREE.Material,cx:number,cy:number,depth:number,kind:Feature)=>{
      const rest=new Float32Array(geometry.getAttribute('position').array);
      geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(rest.length),3).setUsage(THREE.DynamicDrawUsage));
      const mesh=new THREE.Mesh(geometry,mat);mesh.frustumCulled=false;
      // Surface ink must render after transmission to avoid a refracted duplicate.
      mat.transparent=true;mesh.renderOrder=2;
      group.add(mesh);
      const count=rest.length/3;
      this.details.push({mesh,rest,cx,cy,depth,kind,located:new Float64Array(count*3),source:new Float64Array(count*2),placed:false});
    };
    const oval=(x:number,y:number,z:number)=>new THREE.SphereGeometry(1,40,24,0,Math.PI*2,0,Math.PI/2).rotateX(Math.PI/2).scale(x,y,z);
    for(const sign of [-1,1]) {
      add(oval(.00325,.0043,.0015),eye,sign*.0095,.0465,.00010,'eye');
      add(oval(.0043,.0024,.00016),blush,sign*.014,.0388,.00010,'blush');
      const brow=new THREE.CatmullRomCurve3([
        new THREE.Vector3(-.0021,-.0005,0),new THREE.Vector3(0,.00045,0),new THREE.Vector3(.0021,-.0002,0),
      ]);
      add(new THREE.TubeGeometry(brow,16,.00048,8,false),mouth,sign*.0097,.0542,.00025,'brow');
    }
    const smile=new THREE.Shape();
    smile.moveTo(-.0046,.0019);smile.bezierCurveTo(-.002,.0006,.002,.0006,.0046,.002);
    smile.bezierCurveTo(.0055,-.0046,-.0048,-.0052,-.0046,.0019);
    add(refinePatch(new THREE.ShapeGeometry(smile,24)),mouth,0,.0389,.00018,'mouth');
    const lip=new THREE.Shape();lip.absellipse(0,0,.0024,.00125,0,Math.PI*2,false,0);
    add(refinePatch(new THREE.ShapeGeometry(lip,24)),tongue,0,.0368,.00028,'tongue');
  }
  reset() { this.expression.reset(); }
  /** Returns whether the detail meshes actually moved this frame. */
  update(dt:number,playing=false) {
    this.expression.update(dt,this.body.grabs.some(grip=>!grip.cosmetic),playing);
    const {sob,laugh,blink,time}=this.expression;
    const version=this.body.surface.geometry.attributes.position.version;
    if(version===this.surfaceVersion&&blink===this.lastBlink&&sob===this.lastSob&&laugh===this.lastLaugh&&sob===0&&laugh===0)return false;
    this.surfaceVersion=version;this.lastBlink=blink;this.lastSob=sob;this.lastLaugh=laugh;
    const quiver=Math.sin(time*33)*.00022*sob;
    const chuckle=(.5+.5*Math.sin(time*19))*laugh;
    for(const detail of this.details) {
      const {mesh,rest,cx,cy,depth,kind,located,source}=detail;
      const positions=mesh.geometry.getAttribute('position');
      const array=positions.array as Float32Array;
      for(let i=0;i<positions.count;i++) {
        let x=rest[i*3],y=rest[i*3+1],z=rest[i*3+2];
        if(kind==='eye') {
          // Fold the original oval into a thin chevron, with its point facing
          // the nose. Keeping the vertical parameter gives two distinct arms.
          // Allow for the diagonal arms so their visible width matches the brows.
          const squeezedX=x*.38+Math.sign(cx)*(.0055*Math.abs(y/.0043)-.0028);
          const squeezedY=y*.67+quiver*.35;
          const squeezedZ=z*.20;
          const close=Math.max(blink,laugh*.90);
          y*=1-close*.94;z*=1-close*.88;
          // Idle blinks and giggles blend into the grabbed > < silhouette.
          y+=(1-Math.min(1,(x/.00325)**2))*laugh*.00125;
          x+=(squeezedX-x)*sob;
          y+=(squeezedY-y)*sob;
          z+=(squeezedZ-z)*sob;
        } else if(kind==='brow') {
          const inner=-Math.sign(cx)*x/.0021;
          y+=sob*(.0006+inner*.0011)+laugh*.00055;
          y+=quiver*.6;
        } else if(kind==='mouth'||kind==='tongue') {
          // Transform mouth and tongue in one shared frame to keep the tongue inside.
          y+=cy-.0389;
          x*=1-sob*.22+laugh*.18;
          y*=1-sob*.48+chuckle*.32;
          y+=sob*(.0011-.0030*(x/.0046)**2)+quiver;
          y-=laugh*.0003;
          y-=cy-.0389;
        } else {
          y+=laugh*.00065+sob*.00025;
        }
        const sx=x+cx,sy=y+cy,at=i*3,pair=i*2;
        if(!detail.placed||source[pair]!==sx||source[pair+1]!==sy) {
          this.skin.locate(sx,sy,located,at);source[pair]=sx;source[pair+1]=sy;
        }
        this.skin.project(located,at,Math.max(.00008,z+depth),this.sample);
        array[at]=this.sample[0];array[at+1]=this.sample[1];array[at+2]=this.sample[2];
      }
      detail.placed=true;
      positions.needsUpdate=true;mesh.geometry.computeVertexNormals();
    }
    return true;
  }
}

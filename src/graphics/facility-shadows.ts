import * as THREE from 'three/webgpu';
import { float, positionWorld, uniform, vec3 } from 'three/tsl';

/** Fixed-world planar occlusion for opaque facilities under the measured window.
 * Geometry is shared with the visible objects; shadows never overlay the table.
 */
export class FacilityShadows {
  readonly target=new THREE.RenderTarget(512,512,{depthBuffer:false,samples:4});
  readonly originNode=uniform(new THREE.Vector2());
  readonly spanNode=uniform(new THREE.Vector2(1,1));
  readonly worldToUVNode=uniform(new THREE.Matrix3());
  private readonly scene=new THREE.Scene();
  private readonly camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,2);
  private readonly material=new THREE.MeshBasicNodeMaterial({color:0xff0000,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
    transparent:true,blending:THREE.CustomBlending,blendEquation:THREE.MaxEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});
  private readonly contactMaterial=this.material.clone();
  private readonly projection=new THREE.Matrix4();
  private readonly contactProjection=new THREE.Matrix4().set(1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1);
  private readonly bounds=new THREE.Box2();
  private readonly casters:{source:THREE.Mesh;shadow:THREE.Mesh;contact:THREE.Mesh;matrix:THREE.Matrix4;positionVersion:number}[]=[];
  private dirty=true;
  constructor(incoming:THREE.Vector3) {
    if(incoming.y>=-.01)throw new Error('Facility shadows require a downward light direction');
    const x=incoming.x/incoming.y,z=incoming.z/incoming.y,floor=-.00005;
    // Project onto the tabletop along incoming light, then put world X/Z in
    // shadow-camera X/Y. Fixed bounds avoid camera-following texel shimmer.
    this.projection.set(1,-x,0,x*floor,0,-z,1,z*floor,0,0,0,0,0,0,0,1);
    // R: directional window occlusion. G: near-floor ambient contact. MAX
    // blending unions each channel so the mat cannot erase leg/foot shadows.
    // Contact projection preserves original height in Z for the falloff shader.
    this.contactMaterial.colorNode=vec3(0,float(1).sub(positionWorld.z.smoothstep(.001,.025)),0);
    this.scene.background=new THREE.Color(0x000000);
    this.camera.position.z=1;this.camera.updateMatrixWorld();
    this.target.texture.colorSpace=THREE.NoColorSpace;
    this.target.texture.generateMipmaps=false;
    this.target.texture.minFilter=this.target.texture.magFilter=THREE.LinearFilter;
  }
  /** Bounds must include the facility's entire motion envelope, in world metres. */
  add(group:THREE.Group,envelope:THREE.Box3) {
    group.updateWorldMatrix(true,true);
    const p=new THREE.Vector3();
    for(const x of [envelope.min.x,envelope.max.x])for(const y of [envelope.min.y,envelope.max.y])for(const z of [envelope.min.z,envelope.max.z]) {
      p.set(x,y,z).applyMatrix4(this.projection);this.bounds.expandByPoint(new THREE.Vector2(p.x,p.y));
      this.bounds.expandByPoint(new THREE.Vector2(x,z));
    }
    const padded=this.bounds.clone().expandByScalar(.012),span=padded.getSize(new THREE.Vector2());
    this.originNode.value.copy(padded.min);this.spanNode.value.copy(span);
    // WebGPU raster rows run downward: UV.v = 1 - normalized world Z.
    // WGSLNodeBuilder.isFlipY() is false in the pinned Three version, so the
    // texture node does NOT supply this conversion. Keep the actual lookup
    // matrix available to the projection regression, not a separate CPU copy.
    this.worldToUVNode.value.set(
      1/span.x,0,-padded.min.x/span.x,
      0,-1/span.y,1+padded.min.y/span.y,
      0,0,1,
    );
    this.camera.left=padded.min.x;this.camera.right=padded.max.x;
    this.camera.bottom=padded.min.y;this.camera.top=padded.max.y;this.camera.updateProjectionMatrix();
    group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const shadow=new THREE.Mesh(object.geometry,this.material);
      shadow.matrixAutoUpdate=false;shadow.frustumCulled=false;this.scene.add(shadow);
      const contact=new THREE.Mesh(object.geometry,this.contactMaterial);
      contact.name='facility-contact';contact.matrixAutoUpdate=false;contact.frustumCulled=false;this.scene.add(contact);
      this.casters.push({source:object,shadow,contact,matrix:new THREE.Matrix4(),positionVersion:-1});
    });
    this.dirty=true;
  }
  update(renderer:THREE.WebGPURenderer) {
    for(const caster of this.casters) {
      caster.source.updateWorldMatrix(true,false);
      const position=caster.source.geometry.attributes.position;
      const positionVersion=position instanceof THREE.InterleavedBufferAttribute?position.data.version:position.version;
      if(positionVersion!==caster.positionVersion){caster.positionVersion=positionVersion;this.dirty=true;}
      if(this.dirty||!caster.matrix.equals(caster.source.matrixWorld)||caster.shadow.visible!==caster.source.visible) {
        caster.matrix.copy(caster.source.matrixWorld);
        caster.shadow.matrix.multiplyMatrices(this.projection,caster.matrix);
        caster.shadow.matrixWorldNeedsUpdate=true;caster.shadow.visible=caster.source.visible;this.dirty=true;
        caster.contact.matrix.multiplyMatrices(this.contactProjection,caster.matrix);
        caster.contact.matrixWorldNeedsUpdate=true;caster.contact.visible=caster.source.visible;
      }
    }
    if(!this.dirty)return;
    const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear;
    try {
      renderer.autoClear=true;renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);
      this.dirty=false;
    } finally {renderer.setRenderTarget(previous);renderer.autoClear=autoClear;}
  }
  dispose() {this.scene.clear();this.casters.length=0;this.material.dispose();this.contactMaterial.dispose();this.target.dispose();}
}

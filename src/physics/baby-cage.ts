import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three/webgpu';

export interface ModelManifest {
  sourceHash:string;
  volume:number;
  layout:Record<string,{offset:number;length:number;type:string}>;
}

export function parseBabyCage(buffer:ArrayBuffer,manifest:ModelManifest) {
  const f32=(name:string)=>new Float32Array(buffer,manifest.layout[name].offset,manifest.layout[name].length);
  const f64=(name:string)=>new Float64Array(buffer,manifest.layout[name].offset,manifest.layout[name].length);
  const u32=(name:string)=>new Uint32Array(buffer,manifest.layout[name].offset,manifest.layout[name].length);
  const positions=f32('positions').slice(),normals=f32('normals'),indices=u32('indices');
  const bindingIds=u32('bindingIds'),bindingWeights=f64('bindingWeights');
  const stencils:[number,number][][]=[];
  for(let i=0;i<positions.length/3;i++) {
    stencils.push(Array.from({length:4},(_,k)=>[bindingIds[i*4+k],bindingWeights[i*4+k]] as [number,number]));
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(positions,3).setUsage(DynamicDrawUsage));
  geometry.setAttribute('normal',new BufferAttribute(normals.slice(),3).setUsage(DynamicDrawUsage));
  geometry.setAttribute('opticalThickness',new BufferAttribute(new Float32Array(positions.length/3).fill(.04),1).setUsage(DynamicDrawUsage));
  geometry.setIndex(new BufferAttribute(indices,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const tetArray=u32('tets'),tets:number[][]=[];
  for(let i=0;i<tetArray.length;i+=4)tets.push(Array.from(tetArray.subarray(i,i+4)));
  const opticalGeometry=new BufferGeometry(),opticalPositions=f32('opticalPositions').slice(),opticalNormals=f32('opticalNormals');
  opticalGeometry.setAttribute('position',new BufferAttribute(opticalPositions,3));
  opticalGeometry.setAttribute('normal',new BufferAttribute(opticalNormals.slice(),3));
  opticalGeometry.setAttribute('opticalThickness',new BufferAttribute(new Float32Array(opticalPositions.length/3).fill(.04),1));
  opticalGeometry.setIndex(new BufferAttribute(u32('opticalIndices'),1));opticalGeometry.computeBoundingBox();
  return {
    pos:f64('particles'),tets,volumes:f64('volumes'),totalVolume:manifest.volume,
    contactBindings:Array.from(u32('contacts'),id=>stencils[id]),
    surface:{geometry,positions,indices,stencils,bindingIds,bindingWeights,restNormals:normals,tetIds:u32('tetIds')},
    opticalSurface:{geometry:opticalGeometry,positions:opticalPositions,indices:u32('opticalIndices'),restNormals:opticalNormals,
      bindingIds:u32('opticalBindingIds'),bindingWeights:f64('opticalBindingWeights')},
    thicknessIds:u32('thicknessIds'),thicknessWeights:f32('thicknessWeights'),
  };
}

export type BabyModel={buffer:ArrayBuffer;manifest:ModelManifest};
let model:Promise<BabyModel>|undefined;
export function loadBabyModel():Promise<BabyModel> {
  if(!model)model=(async()=>{
    const [binary,metadata]=await Promise.all([
      fetch(new URL('../assets/model/jelly-baby.bin',import.meta.url)),
      fetch(new URL('../assets/model/jelly-baby.json',import.meta.url)),
    ]);
    if(!binary.ok||!metadata.ok)throw new Error('Could not load the reference jelly mesh');
    return {buffer:await binary.arrayBuffer(),manifest:await metadata.json() as ModelManifest};
  })();
  return model;
}
export async function loadBabyCage() {
  const {buffer,manifest}=await loadBabyModel();return parseBabyCage(buffer,manifest);
}

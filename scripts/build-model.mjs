import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import * as THREE from 'three/webgpu';
import { buildCage } from './model-cage.mjs';
import { buildOpticalModel } from './optical-model.mjs';

const source=readFileSync('refs/jelly_baby_mesh.html','utf8');
const begin=source.indexOf('const V =');
const end=source.indexOf('// Minimal WebGPU viewer');
// Execute only the inspected model definitions, not the HTML's viewer/startup.
const model=new Function('THREE',source.slice(begin,end)+'\nreturn {buildJellyGeometry,jellySDF};')(THREE);
const raw=model.buildJellyGeometry();
const scale=.07/(raw.boundingBox.max.y-raw.boundingBox.min.y);
const bottom=raw.boundingBox.min.y;
raw.translate(0,-bottom,0);raw.scale(scale,scale,scale);
const p=raw.attributes.position.array,n=raw.attributes.normal.array;
const positions=[],normals=[],indices=[],vertices=new Map();
for(let i=0;i<p.length;i+=3) {
  // Index coincident positions without remeshing, smoothing or changing any face.
  const key=`${p[i]},${p[i+1]},${p[i+2]}`;
  let id=vertices.get(key);
  if(id===undefined){id=positions.length/3;vertices.set(key,id);positions.push(p[i],p[i+1],p[i+2]);normals.push(n[i],n[i+1],n[i+2]);}
  indices.push(id);
}
let signedVolume=0;
for(let i=0;i<indices.length;i+=3){
  const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  signedVolume+=(positions[a]*(positions[b+1]*positions[c+2]-positions[b+2]*positions[c+1])+
    positions[a+1]*(positions[b+2]*positions[c]-positions[b]*positions[c+2])+
    positions[a+2]*(positions[b]*positions[c+1]-positions[b+1]*positions[c]))/6;
}
const edges=new Map();
for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){
  const a=indices[i+k],b=indices[i+(k+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`;
  edges.set(key,(edges.get(key)||0)+1);
}
console.log({vertices:positions.length/3,triangles:indices.length/3,scale,volume:signedVolume,badEdges:[...edges.values()].filter(n=>n!==2).length});
mkdirSync('src/assets/model',{recursive:true});
const arrays={positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices),
  ...buildCage(positions,scale,bottom,model.jellySDF,signedVolume)};
Object.assign(arrays,buildOpticalModel(source.slice(begin,end),scale,bottom,arrays));
const chunks=[],layout={};let offset=0;
for(const [name,array] of Object.entries(arrays)){
  const padding=(8-offset%8)%8;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}
  layout[name]={offset,length:array.length,type:array.constructor.name};chunks.push(Buffer.from(array.buffer));offset+=array.byteLength;
}
writeFileSync('src/assets/model/jelly-baby.bin',Buffer.concat(chunks));
writeFileSync('src/assets/model/jelly-baby.json',JSON.stringify({sourceHash:createHash('sha256').update(source).digest('hex'),scale,bottom,volume:signedVolume,layout},null,2));

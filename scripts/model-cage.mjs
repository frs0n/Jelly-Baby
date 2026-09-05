import { Vector3 } from 'three/webgpu';
import { determinant, inverse3 } from '../src/physics/soft-body.js';

const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const splits=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];

export function buildCage(positions,scale,bottom,sdf,physicalVolume) {
  const h=.0075,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positions.length;i++) {lo[i%3]=Math.min(lo[i%3],positions[i]);hi[i%3]=Math.max(hi[i%3],positions[i]);}
  const origin=lo.map(x=>Math.floor(x/h)*h-h*.25);
  const dims=hi.map((x,a)=>Math.ceil((x-origin[a])/h)+1);
  const p=new Vector3(),sample=(x,y,z)=>sdf(p.set(x/scale,y/scale+bottom,z/scale));
  const cellKey=(x,y,z)=>`${x},${y},${z}`;
  const cells=new Map();
  for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++) {
    if(corners.some(([dx,dy,dz])=>sample(origin[0]+(x+dx)*h,origin[1]+(y+dy)*h,origin[2]+(z+dz)*h)<0))cells.set(cellKey(x,y,z),{x,y,z});
  }
  const vertexCells=[];
  for(let i=0;i<positions.length;i+=3) {
    const xyz=[0,1,2].map(a=>Math.floor((positions[i+a]-origin[a])/h));
    const key=cellKey(...xyz);vertexCells.push(key);
    if(!cells.has(key))cells.set(key,{x:xyz[0],y:xyz[1],z:xyz[2]});
  }
  const particles=[],nodes=new Map(),tets=[],volumes=[],inverse=[];
  const node=(x,y,z)=>{
    const key=cellKey(x,y,z);if(nodes.has(key))return nodes.get(key);
    const id=particles.length/3;particles.push(origin[0]+x*h,origin[1]+y*h,origin[2]+z*h);nodes.set(key,id);return id;
  };
  for(const cell of cells.values()) {
    const ids=corners.map(([x,y,z])=>node(cell.x+x,cell.y+y,cell.z+z));
    cell.tets=[];
    for(const split of splits) {
      const tet=split.map(i=>ids[i]);
      const matrix=()=>{
        const [a,b,c,d]=tet.map(i=>i*3);
        return [particles[b]-particles[a],particles[c]-particles[a],particles[d]-particles[a],
          particles[b+1]-particles[a+1],particles[c+1]-particles[a+1],particles[d+1]-particles[a+1],
          particles[b+2]-particles[a+2],particles[c+2]-particles[a+2],particles[d+2]-particles[a+2]];
      };
      if(determinant(...matrix())<0)[tet[1],tet[2]]=[tet[2],tet[1]];
      const dm=matrix();inverse.push(inverse3(dm));
      // Embedded/cut-cell integration: retain regular element geometry, weight its
      // material volume by the implicit solid. No sliver-shaped boundary tets.
      let occupied=0;
      for(let a=0;a<4;a++)for(const t of [.25,.55,.85]) {
        const q=[0,0,0];
        for(let k=0;k<4;k++)for(let c=0;c<3;c++)q[c]+=particles[tet[k]*3+c]*(a===k?t:(1-t)/3);
        if(sample(...q)<0)occupied++;
      }
      volumes.push(determinant(...dm)/6*Math.max(.08,occupied/12));
      cell.tets.push(tets.length/4);tets.push(...tet);
    }
  }
  // Preserve the mass of the exact reference surface, not the voxel envelope.
  const volumeScale=physicalVolume/volumes.reduce((a,b)=>a+b,0);
  for(let i=0;i<volumes.length;i++)volumes[i]*=volumeScale;
  const bindingIds=[],bindingWeights=[],tetIds=[];
  const contacts=new Set();
  const extrema=new Map();
  for(let i=0;i<positions.length/3;i++) {
    const cell=cells.get(vertexCells[i]);let found=false;
    for(const t of cell.tets) {
      const ids=tets.slice(t*4,t*4+4),a=ids[0]*3,m=inverse[t];
      const dx=positions[i*3]-particles[a],dy=positions[i*3+1]-particles[a+1],dz=positions[i*3+2]-particles[a+2];
      const b=m[0]*dx+m[1]*dy+m[2]*dz,c=m[3]*dx+m[4]*dy+m[5]*dz,d=m[6]*dx+m[7]*dy+m[8]*dz;
      const weights=[1-b-c-d,b,c,d];
      if(weights.some(w=>w< -1e-7||w>1+1e-7))continue;
      bindingIds.push(...ids);bindingWeights.push(...weights);tetIds.push(t);found=true;break;
    }
    if(!found)throw new Error(`Could not embed reference vertex ${i}`);
    if(!extrema.has(vertexCells[i]))extrema.set(vertexCells[i],[i,i,i,i,i,i]);
    const e=extrema.get(vertexCells[i]);
    for(let a=0;a<3;a++) {
      if(positions[i*3+a]<positions[e[a*2]*3+a])e[a*2]=i;
      if(positions[i*3+a]>positions[e[a*2+1]*3+a])e[a*2+1]=i;
    }
  }
  for(const e of extrema.values())for(const id of e)contacts.add(id);
  console.log({particles:particles.length/3,elements:tets.length/4,contacts:contacts.size,spacing:h});
  return {particles:new Float64Array(particles),tets:new Uint32Array(tets),volumes:new Float64Array(volumes),
    bindingIds:new Uint32Array(bindingIds),bindingWeights:new Float64Array(bindingWeights),
    tetIds:new Uint32Array(tetIds),contacts:new Uint32Array([...contacts])};
}

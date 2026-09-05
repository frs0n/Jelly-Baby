import { CatmullRomCurve3, Vector3 } from 'three/webgpu';
import Delaunator from 'delaunator';
import { determinant } from './soft-body.js';

export interface Cage {
  pos: Float64Array;
  tets: number[][];
  boundary: number[][];
  totalVolume: number;
}

/** One continuous solid. Near-equilateral planar cells avoid long, thin radial tets. */
export function makeBabyCage(): Cage {
  // Authored silhouette in millimetres: round crown, little mittens, two soft feet.
  const right = [[0,71],[11,69],[18,63],[21,54],[22,45],
    [25,43],[29,42],[33,40],[33,34],[29,28],[23,27],
    [23,19],[25,10],[23,4],[17,2],[10,2],[6,4],[0,6]];
  const outline = [...right, ...right.slice(1,-1).reverse().map(([x,y])=>[-x,y])];
  const curve = new CatmullRomCurve3(outline.map(([x,y])=>new Vector3(x/1000,y/1000,0)),true,'centripetal');
  const sectors=64,layers=4;
  const contour=curve.getSpacedPoints(sectors).slice(0,sectors);
  const inside=(x:number,y:number)=>{
    let result=false;
    for(let i=0,j=contour.length-1;i<contour.length;j=i++) {
      const a=contour[i],b=contour[j];
      if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)result=!result;
    }
    return result;
  };
  const distance=(x:number,y:number)=>{
    let d=Infinity;
    for(let i=0;i<contour.length;i++) {
      const a=contour[i],b=contour[(i+1)%contour.length],dx=b.x-a.x,dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy)));
      d=Math.min(d,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));
    }
    return d;
  };
  const points=contour.slice(),spacing=.005;
  for(let row=0,y=.004;y<.07;y+=spacing*.866,row++)for(let x=-.033+(row%2)*spacing/2;x<.034;x+=spacing) {
    if(inside(x,y)&&distance(x,y)>spacing*.60)points.push(new Vector3(x,y,0));
  }
  const xyz:number[]=[], triangles:number[][]=[], tets:number[][]=[];
  const triangulated=Delaunator.from(points,p=>p.x,p=>p.y).triangles;
  for(let i=0;i<triangulated.length;i+=3) {
    const ids=Array.from(triangulated.slice(i,i+3));
    const ps=ids.map(j=>points[j]);
    if(!inside((ps[0].x+ps[1].x+ps[2].x)/3,(ps[0].y+ps[1].y+ps[2].y)/3))continue;
    triangles.push(ids);
  }
  const used=[...new Set(triangles.flat())].sort((a,b)=>a-b);
  const local=new Map(used.map((id,i)=>[id,i]));
  const stride=used.length;
  for(let l=0;l<=layers;l++) {
    const depth=(l/layers*2-1), round=1-.12*depth*depth;
    for(const id of used) {
      const p=points[id],d=Math.min(1,distance(p.x,p.y)/.018);
      const thickness=.006+.008*Math.sin(d*Math.PI/2);
      xyz.push(p.x*round,.035+(p.y-.035)*round,depth*thickness);
    }
  }
  for(let l=0;l<layers;l++) for(const tri of triangles) {
    const [a,b,c]=tri.map(v=>local.get(v)!).sort((a,b)=>a-b).map(v=>v+l*stride);
    const A=a+stride,B=b+stride,C=c+stride;
    tets.push([a,b,c,C],[a,b,B,C],[a,A,B,C]);
  }
  const pos=new Float64Array(xyz), faces=new Map<string,number[]>();
  let totalVolume=0;
  for(const tet of tets) {
    const [a,b,c,d]=tet.map(i=>i*3);
    let det=determinant(pos[b]-pos[a],pos[c]-pos[a],pos[d]-pos[a],
      pos[b+1]-pos[a+1],pos[c+1]-pos[a+1],pos[d+1]-pos[a+1],
      pos[b+2]-pos[a+2],pos[c+2]-pos[a+2],pos[d+2]-pos[a+2]);
    if(det<0) { [tet[1],tet[2]]=[tet[2],tet[1]]; det=-det; }
    if(det<1e-13) throw new Error('Degenerate baby element');
    totalVolume+=det/6;
    const [i,j,k,m]=tet;
    for(const face of [[i,k,j],[i,j,m],[i,m,k],[j,k,m]]) {
      const key=face.slice().sort((a,b)=>a-b).join(',');
      if(faces.has(key)) faces.delete(key); else faces.set(key,face);
    }
  }
  const boundary=[...faces.values()], edges=new Map<string,number>();
  for(const f of boundary) for(let k=0;k<3;k++) {
    const key=[f[k],f[(k+1)%3]].sort((a,b)=>a-b).join(',');
    edges.set(key,(edges.get(key)||0)+1);
  }
  if([...edges.values()].some(n=>n!==2)) throw new Error('Baby surface is not watertight');
  return {pos,tets,boundary,totalVolume};
}

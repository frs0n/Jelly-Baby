// Conservative integration of a refracted triangular beam over receiver pixels.
// Flux / footprint area is the ray-map Jacobian; folds add instead of overwriting.
export function depositBeam(buffer,size,origin,span,vertices,channel,flux) {
  const scale=size/span;
  const triangle=vertices.map(v=>[(v[0]-origin.x)*scale,(v[1]-origin.y)*scale]);
  const area=polygonArea(triangle);
  if(area<1e-14||flux<=0)return;
  const density=flux/area/((span/size)**2);
  const minX=Math.max(0,Math.floor(Math.min(...triangle.map(v=>v[0]))));
  const maxX=Math.min(size-1,Math.floor(Math.max(...triangle.map(v=>v[0]))));
  const minY=Math.max(0,Math.floor(Math.min(...triangle.map(v=>v[1]))));
  const maxY=Math.min(size-1,Math.floor(Math.max(...triangle.map(v=>v[1]))));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++) {
    let polygon=clip(triangle,0,x,true);
    polygon=clip(polygon,0,x+1,false);
    polygon=clip(polygon,1,y,true);
    polygon=clip(polygon,1,y+1,false);
    if(polygon.length>=3)buffer[(y*size+x)*3+channel]+=density*polygonArea(polygon);
  }
}

function polygonArea(p) {
  let sum=0;
  for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];sum+=a[0]*b[1]-a[1]*b[0];}
  return Math.abs(sum)*.5;
}

function clip(polygon,axis,edge,greater) {
  const result=[];
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    const insideA=greater?a[axis]>=edge:a[axis]<=edge;
    const insideB=greater?b[axis]>=edge:b[axis]<=edge;
    if(insideA)result.push(a);
    if(insideA!==insideB){const t=(edge-a[axis])/(b[axis]-a[axis]);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  }
  return result;
}

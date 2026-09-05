/**
 * Dense four-node embedding shared by the visible mesh and optical proxy.
 *
 * This is intentionally kept on the CPU. The visible BufferAttributes therefore
 * contain the exact deformed positions/normals used by picking, face attachment,
 * transmission and rendering; there is no second shader-only shape that can drift
 * from the gameplay surface.
 */
export function deformSurface(surface,x,nodalF,center=null) {
  const p=surface.positions,n=surface.geometry.attributes.normal.array;
  const ids=surface.bindingIds,w=surface.bindingWeights,rest=surface.restNormals;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity,maxR2=0;
  const cx=center?.x??0,cy=center?.y??0,cz=center?.z??0;
  for(let i=0,j=0;i<p.length;i+=3,j+=4) {
    const i0=ids[j],i1=ids[j+1],i2=ids[j+2],i3=ids[j+3];
    const w0=w[j],w1=w[j+1],w2=w[j+2],w3=w[j+3];
    const p0=i0*3,p1=i1*3,p2=i2*3,p3=i3*3;
    const px=x[p0]*w0+x[p1]*w1+x[p2]*w2+x[p3]*w3;
    const py=x[p0+1]*w0+x[p1+1]*w1+x[p2+1]*w2+x[p3+1]*w3;
    const pz=x[p0+2]*w0+x[p1+2]*w1+x[p2+2]*w2+x[p3+2]*w3;
    p[i]=px;p[i+1]=py;p[i+2]=pz;

    const m0=i0*9,m1=i1*9,m2=i2*9,m3=i3*9;
    const a=nodalF[m0]*w0+nodalF[m1]*w1+nodalF[m2]*w2+nodalF[m3]*w3;
    const b=nodalF[m0+1]*w0+nodalF[m1+1]*w1+nodalF[m2+1]*w2+nodalF[m3+1]*w3;
    const c=nodalF[m0+2]*w0+nodalF[m1+2]*w1+nodalF[m2+2]*w2+nodalF[m3+2]*w3;
    const d=nodalF[m0+3]*w0+nodalF[m1+3]*w1+nodalF[m2+3]*w2+nodalF[m3+3]*w3;
    const e=nodalF[m0+4]*w0+nodalF[m1+4]*w1+nodalF[m2+4]*w2+nodalF[m3+4]*w3;
    const f=nodalF[m0+5]*w0+nodalF[m1+5]*w1+nodalF[m2+5]*w2+nodalF[m3+5]*w3;
    const g=nodalF[m0+6]*w0+nodalF[m1+6]*w1+nodalF[m2+6]*w2+nodalF[m3+6]*w3;
    const h=nodalF[m0+7]*w0+nodalF[m1+7]*w1+nodalF[m2+7]*w2+nodalF[m3+7]*w3;
    const q=nodalF[m0+8]*w0+nodalF[m1+8]*w1+nodalF[m2+8]*w2+nodalF[m3+8]*w3;
    const nx=rest[i],ny=rest[i+1],nz=rest[i+2];
    const ox=(e*q-f*h)*nx+(f*g-d*q)*ny+(d*h-e*g)*nz;
    const oy=(c*h-b*q)*nx+(a*q-c*g)*ny+(b*g-a*h)*nz;
    const oz=(b*f-c*e)*nx+(c*d-a*f)*ny+(a*e-b*d)*nz;
    const inv=1/(Math.sqrt(ox*ox+oy*oy+oz*oz)||1);
    n[i]=ox*inv;n[i+1]=oy*inv;n[i+2]=oz*inv;

    if(center) {
      if(px<minX)minX=px;if(px>maxX)maxX=px;
      if(py<minY)minY=py;if(py>maxY)maxY=py;
      if(pz<minZ)minZ=pz;if(pz>maxZ)maxZ=pz;
      const dx=px-cx,dy=py-cy,dz=pz-cz,r2=dx*dx+dy*dy+dz*dz;if(r2>maxR2)maxR2=r2;
    }
  }
  const geometry=surface.geometry;
  geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;
  if(center&&geometry.boundingBox&&geometry.boundingSphere) {
    geometry.boundingBox.min.set(minX,minY,minZ);geometry.boundingBox.max.set(maxX,maxY,maxZ);
    geometry.boundingSphere.center.set(cx,cy,cz);geometry.boundingSphere.radius=Math.sqrt(maxR2);
  } else {
    geometry.computeBoundingSphere();geometry.computeBoundingBox();
  }
}

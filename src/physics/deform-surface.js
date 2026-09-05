/** Dense, allocation-free embedding shared by the visible mesh and optical proxy. */
export function deformSurface(surface,x,nodalF) {
  const p=surface.positions,n=surface.geometry.attributes.normal.array;
  const ids=surface.bindingIds,weights=surface.bindingWeights,rest=surface.restNormals;
  for(let i=0,j=0,k=0;i<p.length;i+=3,j+=4,k+=3) {
    let px=0,py=0,pz=0,a=0,b=0,c=0,d=0,e=0,f=0,g=0,h=0,q=0;
    for(let v=0;v<4;v++) {
      const id=ids[j+v],w=weights[j+v],at=id*3,m=id*9;
      px+=x[at]*w;py+=x[at+1]*w;pz+=x[at+2]*w;
      a+=nodalF[m]*w;b+=nodalF[m+1]*w;c+=nodalF[m+2]*w;
      d+=nodalF[m+3]*w;e+=nodalF[m+4]*w;f+=nodalF[m+5]*w;
      g+=nodalF[m+6]*w;h+=nodalF[m+7]*w;q+=nodalF[m+8]*w;
    }
    p[i]=px;p[i+1]=py;p[i+2]=pz;
    const nx=rest[k],ny=rest[k+1],nz=rest[k+2];
    const ox=(e*q-f*h)*nx+(f*g-d*q)*ny+(d*h-e*g)*nz;
    const oy=(c*h-b*q)*nx+(a*q-c*g)*ny+(b*g-a*h)*nz;
    const oz=(b*f-c*e)*nx+(c*d-a*f)*ny+(a*e-b*d)*nz;
    const inv=1/(Math.sqrt(ox*ox+oy*oy+oz*oz)||1);
    n[i]=ox*inv;n[i+1]=oy*inv;n[i+2]=oz*inv;
  }
  surface.geometry.attributes.position.needsUpdate=true;surface.geometry.attributes.normal.needsUpdate=true;
  surface.geometry.computeBoundingSphere();surface.geometry.computeBoundingBox();
}

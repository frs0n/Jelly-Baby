// SI-unit neo-Hookean XPBD, derived from refs/jelly-webgpu.html.
// Coupled elastic projection removes the reference split's artificial rest stress.
import { BufferAttribute, DynamicDrawUsage, Vector3 } from 'three/webgpu';
import { createSoftBodyKernel } from './soft-body-kernel.js';
import { deformSurface } from './deform-surface.js';
import { PHYS, clamp } from './constants.js';

export function determinant(a,b,c,d,e,f,g,h,i) {
  return a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
}
export function inverse3(m) {
  const [a,b,c,d,e,f,g,h,i]=m,det=determinant(...m);
  if(Math.abs(det)<1e-24)throw new Error('Degenerate rest element');
  const s=1/det;
  return [(e*i-f*h)*s,(c*h-b*i)*s,(b*f-c*e)*s,
    (f*g-d*i)*s,(a*i-c*g)*s,(c*d-a*f)*s,
    (d*h-e*g)*s,(b*g-a*h)*s,(a*e-b*d)*s];
}

export class SoftBody {
  constructor(cage) {
    this.cage=cage;this.x=cage.pos.slice();this.rest=cage.pos.slice();
    this.previous=this.x.slice();this.candidate=this.x.slice();this.velocity=new Float64Array(this.x.length);
    this.mass=new Float64Array(this.x.length/3);this.inverseMass=new Float64Array(this.mass.length);
    this.contact=new Float64Array(this.mass.length);this.grab=null;
    this.elements=[];this.edges=[];this.gradient=new Float64Array(12);this.hydroGradient=new Float64Array(12);this.F=new Float64Array(9);this.cofactors=new Float64Array(9);
    this.nodalF=new Float64Array(this.mass.length*9);this.nodalVolume=new Float64Array(this.mass.length);
    this.center=new Vector3();this.surface=cage.surface;
    this.sleeping=false;this.canSleep=true;this.quietTime=0;this.grounded=false;
    this.surfaceDirty=true;this.surfaceRevision=0;this.limitedSteps=0;this.lastMinJacobian=1;this.stepFraction=1;
    const uniqueEdges=new Set();
    for(let t=0;t<cage.tets.length;t++) {
      const ids=cage.tets[t],offsets=ids.map(v=>v*3),[a,b,c,d]=offsets,p=this.rest;
      const dm=[p[b]-p[a],p[c]-p[a],p[d]-p[a],p[b+1]-p[a+1],p[c+1]-p[a+1],p[d+1]-p[a+1],p[b+2]-p[a+2],p[c+2]-p[a+2],p[d+2]-p[a+2]];
      const volume=cage.volumes[t],inv=inverse3(dm),gradients=new Float64Array(12);
      for(let k=0;k<3;k++) {
        gradients[3+k]=inv[k];gradients[6+k]=inv[3+k];gradients[9+k]=inv[6+k];
        gradients[k]=-inv[k]-inv[3+k]-inv[6+k];
      }
      this.elements.push({ids,offsets,volume,gradients,inverseRestDet:1/determinant(...dm),lambdaD:0,lambdaH:0,lambdaB:0});
      for(const id of ids){this.mass[id]+=PHYS.density*volume/4;this.nodalVolume[id]+=volume;}
      for(let i=0;i<4;i++)for(let j=i+1;j<4;j++) {
        const a=Math.min(ids[i],ids[j]),b=Math.max(ids[i],ids[j]),key=`${a},${b}`;
        if(!uniqueEdges.has(key)){uniqueEdges.add(key);this.edges.push([a,b]);}
      }
    }
    for(let i=0;i<this.mass.length;i++)this.inverseMass[i]=1/this.mass[i];
    this.totalMass=this.mass.reduce((a,b)=>a+b,0);
    this.contacts=cage.contactBindings.map(weights=>({weights,normal:0,incoming:0,
      denominator:weights.reduce((sum,[id,w])=>sum+this.inverseMass[id]*w*w,0)}));
    this.kernel=createSoftBodyKernel(this);
    if(this.kernel) {
      this.x=this.kernel.x;this.previous=this.kernel.previous;this.candidate=this.kernel.candidate;
      this.velocity=this.kernel.velocity;this.contact=this.kernel.contact;this.nodalF=this.kernel.nodalF;
      this.surface.positions=this.kernel.surfacePositions;
      this.surface.geometry.setAttribute('position',new BufferAttribute(this.surface.positions,3).setUsage(DynamicDrawUsage));
      this.surface.geometry.setAttribute('normal',new BufferAttribute(this.kernel.surfaceNormals,3).setUsage(DynamicDrawUsage));
    }
    this.updateSurface();
  }
  deformation(e) {
    const x=this.x,g=e.gradients,f=this.F,a=e.offsets[0],b=e.offsets[1],c=e.offsets[2],d=e.offsets[3];
    const bx=x[b]-x[a],by=x[b+1]-x[a+1],bz=x[b+2]-x[a+2];
    const cx=x[c]-x[a],cy=x[c+1]-x[a+1],cz=x[c+2]-x[a+2];
    const dx=x[d]-x[a],dy=x[d+1]-x[a+1],dz=x[d+2]-x[a+2];
    f[0]=bx*g[3]+cx*g[6]+dx*g[9];f[1]=bx*g[4]+cx*g[7]+dx*g[10];f[2]=bx*g[5]+cx*g[8]+dx*g[11];
    f[3]=by*g[3]+cy*g[6]+dy*g[9];f[4]=by*g[4]+cy*g[7]+dy*g[10];f[5]=by*g[5]+cy*g[8]+dy*g[11];
    f[6]=bz*g[3]+cz*g[6]+dz*g[9];f[7]=bz*g[4]+cz*g[7]+dz*g[10];f[8]=bz*g[5]+cz*g[8]+dz*g[11];
    return f;
  }
  solveElastic(e,h) {
    const f=this.deformation(e),g=e.gradients,dg=this.gradient,hg=this.hydroGradient;
    let norm=0;for(let k=0;k<9;k++)norm+=f[k]*f[k];norm=Math.sqrt(norm);
    if(norm<1e-12)return;
    const a=f[0],b=f[1],c=f[2],d=f[3],ee=f[4],ff=f[5],gg=f[6],hh=f[7],ii=f[8];
    const c0=ee*ii-ff*hh,c1=ff*gg-d*ii,c2=d*hh-ee*gg;
    const c3=c*hh-b*ii,c4=a*ii-c*gg,c5=b*gg-a*hh;
    const c6=b*ff-c*ee,c7=c*d-a*ff,c8=a*ee-b*d,J=a*c0+b*c1+c*c2;
    const alphaD=1/(PHYS.shear*e.volume*h*h),alphaH=1/(PHYS.bulk*e.volume*h*h);
    let dd=alphaD,hhMass=alphaH,dh=0;
    for(let v=0;v<4;v++) {
      const j=v*3,x=g[j],y=g[j+1],z=g[j+2],w=this.inverseMass[e.ids[v]];
      dg[j]=(a*x+b*y+c*z)/norm;dg[j+1]=(d*x+ee*y+ff*z)/norm;dg[j+2]=(gg*x+hh*y+ii*z)/norm;
      hg[j]=c0*x+c1*y+c2*z;hg[j+1]=c3*x+c4*y+c5*z;hg[j+2]=c6*x+c7*y+c8*z;
      for(let k=0;k<3;k++){dd+=w*dg[j+k]**2;hhMass+=w*hg[j+k]**2;dh+=w*dg[j+k]*hg[j+k];}
    }
    // Same energy as the reference:
    // W=mu/2*(||F||²-3)+K/2*(J-1-mu/K)².
    // Solve its two constraints together. At F=I their forces cancel exactly.
    const rd=-norm-alphaD*e.lambdaD,rh=-(J-1-PHYS.shear/PHYS.bulk)-alphaH*e.lambdaH;
    const denominator=dd*hhMass-dh*dh;
    const dlD=(rd*hhMass-rh*dh)/denominator,dlH=(rh*dd-rd*dh)/denominator;
    e.lambdaD+=dlD;e.lambdaH+=dlH;
    for(let v=0;v<4;v++) {
      const i=e.offsets[v],j=v*3,w=this.inverseMass[e.ids[v]];
      for(let k=0;k<3;k++)this.x[i+k]+=w*(dlD*dg[j+k]+dlH*hg[j+k]);
    }
  }
  solveBarrier(e) {
    const f=this.deformation(e),g=e.gradients,out=this.gradient;
    const a=f[0],b=f[1],c=f[2],d=f[3],ee=f[4],ff=f[5],gg=f[6],hh=f[7],ii=f[8];
    const J=a*(ee*ii-ff*hh)+b*(ff*gg-d*ii)+c*(d*hh-ee*gg);
    if(J>=.25&&e.lambdaB===0)return;
    const co=this.cofactors;
    co[0]=ee*ii-ff*hh;co[1]=ff*gg-d*ii;co[2]=d*hh-ee*gg;
    co[3]=c*hh-b*ii;co[4]=a*ii-c*gg;co[5]=b*gg-a*hh;
    co[6]=b*ff-c*ee;co[7]=c*d-a*ff;co[8]=a*ee-b*d;
    let denominator=0;
    for(let v=0;v<4;v++) {
      const j=v*3,w=this.inverseMass[e.ids[v]];
      for(let k=0;k<3;k++) {
        out[j+k]=co[k*3]*g[j]+co[k*3+1]*g[j+1]+co[k*3+2]*g[j+2];
        denominator+=w*out[j+k]**2;
      }
    }
    if(denominator<1e-15)return;
    const next=Math.max(0,e.lambdaB-(J-.25)/denominator),delta=next-e.lambdaB;e.lambdaB=next;
    for(let v=0;v<4;v++)for(let k=0;k<3;k++)this.x[e.offsets[v]+k]+=this.inverseMass[e.ids[v]]*delta*out[v*3+k];
  }
  solveGrab(h) {
    const grab=this.grab;if(!grab)return;
    const p=grab.point;p.set(0,0,0);let denominator=0;
    for(const [id,w] of grab.weights){p.x+=this.x[id*3]*w;p.y+=this.x[id*3+1]*w;p.z+=this.x[id*3+2]*w;denominator+=this.inverseMass[id]*w*w;}
    const alpha=1/(90*h*h);denominator+=alpha;
    for(let axis=0;axis<3;axis++) {
      const C=p.getComponent(axis)-grab.target.getComponent(axis),dl=(-C-alpha*grab.lambda[axis])/denominator;
      const next=clamp(grab.lambda[axis]+dl,-PHYS.maxGrabForce*h*h,PHYS.maxGrabForce*h*h);
      const change=next-grab.lambda[axis];grab.lambda[axis]=next;
      for(const [id,w] of grab.weights)this.x[id*3+axis]+=this.inverseMass[id]*w*change;
    }
  }
  solveContacts() {
    for(const c of this.contacts) {
      let y=0;for(const [id,w] of c.weights)y+=this.x[id*3+1]*w;
      if(y>=PHYS.floor)continue;
      const depth=PHYS.floor-y;c.normal+=depth;
      for(const [id,w] of c.weights){this.x[id*3+1]+=this.inverseMass[id]*w*depth/c.denominator;this.contact[id]+=depth*w;}
    }
  }
  projectOrientation(e,target=.15) {
    const x=this.x,[ia,ib,ic,id]=e.ids,a=ia*3,b=ib*3,c=ic*3,d=id*3,inv=e.inverseRestDet;
    const bax=x[b]-x[a],bay=x[b+1]-x[a+1],baz=x[b+2]-x[a+2];
    const cax=x[c]-x[a],cay=x[c+1]-x[a+1],caz=x[c+2]-x[a+2];
    const dax=x[d]-x[a],day=x[d+1]-x[a+1],daz=x[d+2]-x[a+2];
    const J=(bax*(cay*daz-caz*day)-cax*(bay*daz-baz*day)+dax*(bay*caz-baz*cay))*inv;
    if(J>=target)return J;
    const gbx=(cay*daz-caz*day)*inv,gby=(caz*dax-cax*daz)*inv,gbz=(cax*day-cay*dax)*inv;
    const gcx=(day*baz-daz*bay)*inv,gcy=(daz*bax-dax*baz)*inv,gcz=(dax*bay-day*bax)*inv;
    const gdx=(bay*caz-baz*cay)*inv,gdy=(baz*cax-bax*caz)*inv,gdz=(bax*cay-bay*cax)*inv;
    const gax=-(gbx+gcx+gdx),gay=-(gby+gcy+gdy),gaz=-(gbz+gcz+gdz);
    const w=this.inverseMass;
    const denom=w[ia]*(gax*gax+gay*gay+gaz*gaz)+w[ib]*(gbx*gbx+gby*gby+gbz*gbz)+
      w[ic]*(gcx*gcx+gcy*gcy+gcz*gcz)+w[id]*(gdx*gdx+gdy*gdy+gdz*gdz);
    if(denom<1e-15)return J;
    const dl=(target-J)/denom;let scale=w[ia]*dl;x[a]+=scale*gax;x[a+1]+=scale*gay;x[a+2]+=scale*gaz;
    scale=w[ib]*dl;x[b]+=scale*gbx;x[b+1]+=scale*gby;x[b+2]+=scale*gbz;
    scale=w[ic]*dl;x[c]+=scale*gcx;x[c+1]+=scale*gcy;x[c+2]+=scale*gcz;
    scale=w[id]*dl;x[d]+=scale*gdx;x[d+1]+=scale*gdy;x[d+2]+=scale*gdz;
    return J;
  }
  repairOrientation() {
    for(let pass=0;pass<32;pass++) {
      let minimum=Infinity,worst=null;
      for(const e of this.elements) {
        const a=e.offsets[0],b=e.offsets[1],c=e.offsets[2],d=e.offsets[3],x=this.x;
        const J=determinant(x[b]-x[a],x[c]-x[a],x[d]-x[a],x[b+1]-x[a+1],x[c+1]-x[a+1],x[d+1]-x[a+1],x[b+2]-x[a+2],x[c+2]-x[a+2],x[d+2]-x[a+2])*e.inverseRestDet;
        if(J<minimum){minimum=J;worst=e;}
      }
      if(minimum>=.135||!worst)return minimum;
      this.projectOrientation(worst,.15);
    }
    return this.minimumJacobian();
  }
  minimumJacobian(stopAt=-Infinity) {
    let minimum=Infinity;const x=this.x;
    for(const e of this.elements){
      const a=e.offsets[0],b=e.offsets[1],c=e.offsets[2],d=e.offsets[3];
      const J=determinant(x[b]-x[a],x[c]-x[a],x[d]-x[a],x[b+1]-x[a+1],x[c+1]-x[a+1],x[d+1]-x[a+1],x[b+2]-x[a+2],x[c+2]-x[a+2],x[d+2]-x[a+2])*e.inverseRestDet;
      minimum=Math.min(minimum,J);if(minimum<stopAt)return minimum;
    }
    return minimum;
  }
  preserveOrientation() {
    this.stepFraction=1;
    this.lastMinJacobian=this.minimumJacobian(.12);
    if(this.lastMinJacobian>=.12)return 1;
    this.limitedSteps++;this.repairOrientation();this.lastMinJacobian=this.minimumJacobian(.12);
    if(this.lastMinJacobian>=.12)return 1;
    this.candidate.set(this.x);
    // A constraint can disturb a neighbouring element. Backtrack the complete
    // substep, including grab/contact, until every element remains orientation-preserving.
    for(let fraction=.5;fraction>=1/512;fraction*=.5) {
      for(let i=0;i<this.x.length;i++)this.x[i]=this.previous[i]+fraction*(this.candidate[i]-this.previous[i]);
      this.lastMinJacobian=this.minimumJacobian(.12);
      if(this.lastMinJacobian>=.12){this.stepFraction=fraction;return fraction;}
    }
    this.x.set(this.previous);this.lastMinJacobian=this.minimumJacobian(.12);this.stepFraction=0;return 0;
  }

  step(h) {
    if(!this.kernel)return this.stepJS(h);
    if(this.grab)this.wake();if(this.sleeping)return false;
    this.kernel.step(h,PHYS);
    const meta=this.kernel.meta;this.grounded=meta[0]!==0;this.lastMinJacobian=meta[1];this.limitedSteps+=meta[2];this.stepFraction=meta[14];
    this.center.set(meta[3],meta[4],meta[5]);
    if(this.grab) {
      const point=this.grab.point;point.set(0,0,0);
      for(const [id,w] of this.grab.weights){point.x+=this.x[id*3]*w;point.y+=this.x[id*3+1]*w;point.z+=this.x[id*3+2]*w;}
    }
    const rms=Math.sqrt(2*meta[6]/this.totalMass);
    this.quietTime=this.canSleep&&!this.grab&&this.grounded&&this.stepFraction>=.999&&rms<.005?this.quietTime+h:0;
    if(this.quietTime>.45){this.sleeping=true;this.velocity.fill(0);}
    this.surfaceDirty=true;return true;
  }
  stepJS(h) {
    if(this.grab)this.wake();if(this.sleeping)return false;
    const previousFraction=this.stepFraction;this.stepFraction=1;
    const x=this.x,v=this.velocity,old=this.previous;
    if(previousFraction<1)this.repairOrientation();
    old.set(x);this.contact.fill(0);
    const air=Math.exp(-.025*h);
    for(let i=0;i<v.length;i++)v[i]*=air;
    for(let i=1;i<v.length;i+=3)v[i]-=PHYS.gravity*h;
    for(const c of this.contacts){c.normal=0;c.incoming=0;for(const [id,w] of c.weights)c.incoming+=v[id*3+1]*w;}
    for(let i=0;i<x.length;i++)x[i]+=v[i]*h;
    for(const e of this.elements)e.lambdaD=e.lambdaH=e.lambdaB=0;
    if(this.grab)this.grab.lambda.fill(0);
    for(let iteration=0;iteration<PHYS.iterations;iteration++) {
      for(let n=0;n<this.elements.length;n++) {
        const e=this.elements[(iteration&1)?this.elements.length-1-n:n];this.solveElastic(e,h);this.solveBarrier(e);
      }
      this.solveGrab(h);this.solveContacts();
    }
    this.grounded=false;
    for(const c of this.contacts)if(c.normal>0) {
      this.grounded=true;let dx=0,dz=0;
      for(const [id,w] of c.weights){dx+=(x[id*3]-old[id*3])*w;dz+=(x[id*3+2]-old[id*3+2])*w;}
      const tangent=Math.hypot(dx,dz),friction=tangent<PHYS.staticFriction*c.normal?1:Math.min(1,PHYS.dynamicFriction*c.normal/(tangent+1e-20));
      for(const [id,w] of c.weights){const s=this.inverseMass[id]*w*friction/c.denominator;x[id*3]-=dx*s;x[id*3+2]-=dz*s;}
    }
    this.preserveOrientation();
    for(let i=0;i<v.length;i++)v[i]=(x[i]-old[i])/h;
    for(const c of this.contacts)if(c.normal>0&&c.incoming<0) {
      let vy=0;for(const [id,w] of c.weights)vy+=v[id*3+1]*w;
      const bounce=c.incoming<-.18?-c.incoming*PHYS.restitution:0;
      const impulse=Math.max(0,bounce-vy)/c.denominator;
      for(const [id,w] of c.weights)v[id*3+1]+=this.inverseMass[id]*w*impulse;
    }
    // Equal/opposite axial viscosity dissipates strain energy without damping
    // rigid-body translation or creating a continuously animated wobble.
    const damping=1-Math.exp(-PHYS.damping*h*.35);
    for(const [a,b] of this.edges) {
      const ia=a*3,ib=b*3,dx=x[ib]-x[ia],dy=x[ib+1]-x[ia+1],dz=x[ib+2]-x[ia+2],len=Math.hypot(dx,dy,dz);
      if(len<1e-9)continue;
      const nx=dx/len,ny=dy/len,nz=dz/len;
      const relative=(v[ib]-v[ia])*nx+(v[ib+1]-v[ia+1])*ny+(v[ib+2]-v[ia+2])*nz;
      const impulse=relative*damping/(this.inverseMass[a]+this.inverseMass[b]),sa=impulse*this.inverseMass[a],sb=impulse*this.inverseMass[b];
      v[ia]+=sa*nx;v[ia+1]+=sa*ny;v[ia+2]+=sa*nz;v[ib]-=sb*nx;v[ib+1]-=sb*ny;v[ib+2]-=sb*nz;
    }
    const rms=Math.sqrt(2*this.energy()/this.totalMass);
    // Sub-pixel residual contact chatter is put to sleep only after the real
    // oscillation has dissipated (5 mm/s RMS for 0.45 s at this 7 cm scale).
    this.quietTime=this.canSleep&&!this.grab&&this.grounded&&this.stepFraction>=.999&&rms<.005?this.quietTime+h:0;
    if(this.quietTime>.45){this.sleeping=true;v.fill(0);}
    this.updateCenter();this.surfaceDirty=true;return true;
  }
  updateCenter() {
    this.center.set(0,0,0);
    for(let i=0;i<this.mass.length;i++){const w=this.mass[i]/this.totalMass;this.center.x+=this.x[i*3]*w;this.center.y+=this.x[i*3+1]*w;this.center.z+=this.x[i*3+2]*w;}
  }
  updateSurface() {
    if(this.kernel) {
      // Keep the original full-resolution CPU surface as the single source of
      // truth. The kernel only accelerates the same embedding arithmetic.
      this.updateCenter();this.kernel.setCenter(this.center);this.kernel.updateSurface();
      const geometry=this.surface.geometry,meta=this.kernel.meta;
      geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;
      geometry.boundingBox.min.set(meta[7],meta[8],meta[9]);geometry.boundingBox.max.set(meta[10],meta[11],meta[12]);
      geometry.boundingSphere.center.copy(this.center);geometry.boundingSphere.radius=meta[13];
      this.surfaceDirty=false;this.surfaceRevision++;return;
    }
    this.nodalF.fill(0);
    for(const e of this.elements) {
      const f=this.deformation(e);
      for(const id of e.ids){const w=e.volume/this.nodalVolume[id];for(let k=0;k<9;k++)this.nodalF[id*9+k]+=f[k]*w;}
    }
    this.updateCenter();deformSurface(this.surface,this.x,this.nodalF,this.center);
    this.surfaceDirty=false;this.surfaceRevision++;
  }
  energy() {
    let energy=0;for(let i=0;i<this.mass.length;i++){const j=i*3;energy+=.5*this.mass[i]*(this.velocity[j]**2+this.velocity[j+1]**2+this.velocity[j+2]**2);}return energy;
  }
  elasticEnergy() {
    let energy=0;
    for(const e of this.elements){const f=this.deformation(e);let norm=0;for(const x of f)norm+=x*x;const j=matrixDet(f);energy+=e.volume*(.5*PHYS.shear*(norm-3)+.5*PHYS.bulk*(j-1-PHYS.shear/PHYS.bulk)**2-.5*PHYS.shear**2/PHYS.bulk);}
    return Math.max(0,energy);
  }
  volumeRatio() {
    let volume=0;for(const e of this.elements)volume+=matrixDet(this.deformation(e))*e.volume;return volume/this.cage.totalVolume;
  }
  wake(){this.sleeping=false;this.quietTime=0;}
  reset(){this.x.set(this.rest);this.previous.set(this.rest);this.velocity.fill(0);this.grab=null;this.grounded=false;this.stepFraction=1;if(this.kernel)this.kernel.meta[14]=1;this.wake();this.updateSurface();}
  nudge(){this.wake();for(let i=0;i<this.mass.length;i++){const j=i*3;this.velocity[j]+=.095+(this.x[j+1]-this.center.y)*3;this.velocity[j+1]+=.12;this.velocity[j+2]+=.025;}}
  isFinite(){for(let i=0;i<this.x.length;i++)if(!Number.isFinite(this.x[i])||!Number.isFinite(this.velocity[i])||Math.abs(this.x[i])>100000)return false;return true;}
}

function matrixDet(f) {
  return f[0]*(f[4]*f[8]-f[5]*f[7])-f[1]*(f[3]*f[8]-f[5]*f[6])+f[2]*(f[3]*f[7]-f[4]*f[6]);
}

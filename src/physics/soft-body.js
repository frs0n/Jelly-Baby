// SI-unit neo-Hookean XPBD, derived from refs/jelly-webgpu.html.
// Coupled elastic projection removes the reference split's artificial rest stress.
import { Vector3 } from 'three/webgpu';
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
    this.elements=[];this.edges=[];this.gradient=new Float64Array(12);this.hydroGradient=new Float64Array(12);this.F=new Float64Array(9);
    this.nodalF=new Float64Array(this.mass.length*9);this.nodalVolume=new Float64Array(this.mass.length);
    this.center=new Vector3();this.surface=cage.surface;
    this.sleeping=false;this.canSleep=true;this.quietTime=0;this.grounded=false;
    this.surfaceDirty=true;this.surfaceRevision=0;this.limitedSteps=0;this.lastMinJacobian=1;
    const uniqueEdges=new Set();
    for(let t=0;t<cage.tets.length;t++) {
      const ids=cage.tets[t],offsets=ids.map(v=>v*3),[a,b,c,d]=offsets,p=this.rest;
      const dm=[p[b]-p[a],p[c]-p[a],p[d]-p[a],p[b+1]-p[a+1],p[c+1]-p[a+1],p[d+1]-p[a+1],p[b+2]-p[a+2],p[c+2]-p[a+2],p[d+2]-p[a+2]];
      const volume=cage.volumes[t],inv=inverse3(dm),gradients=new Float64Array(12);
      for(let k=0;k<3;k++) {
        gradients[3+k]=inv[k];gradients[6+k]=inv[3+k];gradients[9+k]=inv[6+k];
        gradients[k]=-inv[k]-inv[3+k]-inv[6+k];
      }
      this.elements.push({ids,offsets,volume,gradients,lambdaD:0,lambdaH:0,lambdaB:0});
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
    this.updateSurface();
  }
  deformation(e) {
    const x=this.x,g=e.gradients,f=this.F,a=e.offsets[0];f.fill(0);
    for(let v=1;v<4;v++) {
      const i=e.offsets[v],j=v*3,dx=x[i]-x[a],dy=x[i+1]-x[a+1],dz=x[i+2]-x[a+2];
      f[0]+=dx*g[j];f[1]+=dx*g[j+1];f[2]+=dx*g[j+2];
      f[3]+=dy*g[j];f[4]+=dy*g[j+1];f[5]+=dy*g[j+2];
      f[6]+=dz*g[j];f[7]+=dz*g[j+1];f[8]+=dz*g[j+2];
    }
    return f;
  }
  solveElastic(e,h) {
    const f=this.deformation(e),g=e.gradients,dg=this.gradient,hg=this.hydroGradient;
    let norm=0;for(const value of f)norm+=value*value;norm=Math.sqrt(norm);
    if(norm<1e-12)return;
    const [a,b,c,d,ee,ff,gg,hh,ii]=f;
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
    const f=this.deformation(e),[a,b,c,d,ee,ff,gg,hh,ii]=f,g=e.gradients,out=this.gradient;
    const co=[ee*ii-ff*hh,ff*gg-d*ii,d*hh-ee*gg,c*hh-b*ii,a*ii-c*gg,b*gg-a*hh,b*ff-c*ee,c*d-a*ff,a*ee-b*d];
    const J=a*co[0]+b*co[1]+c*co[2];
    if(J>=.25&&e.lambdaB===0)return;
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
  minimumJacobian() {
    let minimum=Infinity;for(const e of this.elements)minimum=Math.min(minimum,determinant(...this.deformation(e)));return minimum;
  }
  preserveOrientation() {
    this.lastMinJacobian=this.minimumJacobian();
    if(this.lastMinJacobian>=.12)return;
    this.candidate.set(this.x);this.limitedSteps++;
    // A constraint can disturb a neighbouring element. Backtrack the complete
    // substep, including grab/contact, until every element remains orientation-preserving.
    for(let fraction=.5;fraction>=1/512;fraction*=.5) {
      for(let i=0;i<this.x.length;i++)this.x[i]=this.previous[i]+fraction*(this.candidate[i]-this.previous[i]);
      this.lastMinJacobian=this.minimumJacobian();if(this.lastMinJacobian>=.12)return;
    }
    this.x.set(this.previous);this.lastMinJacobian=this.minimumJacobian();
  }
  step(h) {
    if(this.grab)this.wake();if(this.sleeping)return false;
    const x=this.x,v=this.velocity,old=this.previous;old.set(x);this.contact.fill(0);
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
    this.quietTime=this.canSleep&&!this.grab&&this.grounded&&rms<.005?this.quietTime+h:0;
    if(this.quietTime>.45){this.sleeping=true;v.fill(0);}
    this.updateCenter();this.surfaceDirty=true;return true;
  }
  updateCenter() {
    this.center.set(0,0,0);
    for(let i=0;i<this.mass.length;i++){const w=this.mass[i]/this.totalMass;this.center.x+=this.x[i*3]*w;this.center.y+=this.x[i*3+1]*w;this.center.z+=this.x[i*3+2]*w;}
  }
  updateSurface() {
    const {positions,stencils,geometry,restNormals}=this.surface,normals=geometry.attributes.normal.array;
    this.nodalF.fill(0);
    for(const e of this.elements) {
      const f=this.deformation(e);
      for(const id of e.ids){const w=e.volume/this.nodalVolume[id];for(let k=0;k<9;k++)this.nodalF[id*9+k]+=f[k]*w;}
    }
    const f=new Float64Array(9);
    for(let i=0;i<stencils.length;i++) {
      let x=0,y=0,z=0;f.fill(0);
      for(const [id,w] of stencils[i]) {
        x+=this.x[id*3]*w;y+=this.x[id*3+1]*w;z+=this.x[id*3+2]*w;
        for(let k=0;k<9;k++)f[k]+=this.nodalF[id*9+k]*w;
      }
      positions[i*3]=x;positions[i*3+1]=y;positions[i*3+2]=z;
      const [a,b,c,d,e,ff,g,h,j]=f,nx=restNormals[i*3],ny=restNormals[i*3+1],nz=restNormals[i*3+2];
      // Smooth recovered deformation gradient, inverse-transposed onto the exact
      // reference's SDF normals; no resculpting or Loop smoothing of its surface.
      const ox=(e*j-ff*h)*nx+(ff*g-d*j)*ny+(d*h-e*g)*nz;
      const oy=(c*h-b*j)*nx+(a*j-c*g)*ny+(b*g-a*h)*nz;
      const oz=(b*ff-c*e)*nx+(c*d-a*ff)*ny+(a*e-b*d)*nz;
      const len=Math.hypot(ox,oy,oz)||1;normals[i*3]=ox/len;normals[i*3+1]=oy/len;normals[i*3+2]=oz/len;
    }
    geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;
    geometry.computeBoundingSphere();geometry.computeBoundingBox();this.updateCenter();
    this.surfaceDirty=false;this.surfaceRevision++;
  }
  energy() {
    let energy=0;for(let i=0;i<this.mass.length;i++){const j=i*3;energy+=.5*this.mass[i]*(this.velocity[j]**2+this.velocity[j+1]**2+this.velocity[j+2]**2);}return energy;
  }
  elasticEnergy() {
    let energy=0;
    for(const e of this.elements){const f=this.deformation(e);let norm=0;for(const x of f)norm+=x*x;const j=determinant(...f);energy+=e.volume*(.5*PHYS.shear*(norm-3)+.5*PHYS.bulk*(j-1-PHYS.shear/PHYS.bulk)**2-.5*PHYS.shear**2/PHYS.bulk);}
    return Math.max(0,energy);
  }
  volumeRatio() {
    let volume=0;for(const e of this.elements)volume+=determinant(...this.deformation(e))*e.volume;return volume/this.cage.totalVolume;
  }
  wake(){this.sleeping=false;this.quietTime=0;}
  reset(){this.x.set(this.rest);this.previous.set(this.rest);this.velocity.fill(0);this.grab=null;this.grounded=false;this.wake();this.updateSurface();}
  nudge(){this.wake();for(let i=0;i<this.mass.length;i++){const j=i*3;this.velocity[j]+=.095+(this.x[j+1]-this.center.y)*3;this.velocity[j+1]+=.12;this.velocity[j+2]+=.025;}}
  isFinite(){for(let i=0;i<this.x.length;i++)if(!Number.isFinite(this.x[i])||!Number.isFinite(this.velocity[i])||Math.abs(this.x[i])>100000)return false;return true;}
}

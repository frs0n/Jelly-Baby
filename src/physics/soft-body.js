// Ported from refs/jelly-webgpu.html. SI units; original XPBD energy and contact solver.
import * as THREE from 'three/webgpu';
import { PHYS, clamp } from './constants.js';
const keep = object => object;
  function determinant(a,b,c,d,e,f,g,h,i) {
    return a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  }
  function inverse3(m) {
    const [a,b,c,d,e,f,g,h,i] = m;
    const det = determinant(a,b,c,d,e,f,g,h,i);
    if (Math.abs(det) < 1e-24) throw new Error('Degenerate rest element.');
    const s = 1/det;
    return [(e*i-f*h)*s,(c*h-b*i)*s,(b*f-c*e)*s,
      (f*g-d*i)*s,(a*i-c*g)*s,(c*d-a*f)*s,
      (d*h-e*g)*s,(b*g-a*h)*s,(a*e-b*d)*s];
  }

  function makeSmoothSurface(cage) {
    // Two Loop-subdivision passes smooth the rendered/optical shell while the
    // underlying tetrahedral simulation cage remains unchanged.
    const cageIds=[...new Set(cage.boundary.flat())];
    const local=new Map(cageIds.map((v,i)=>[v,i]));
    let faces=cage.boundary.map(f=>f.map(v=>local.get(v)));
    let stencils=cageIds.map(v=>[[v,1]]);

    const blendStencil=terms=> {
      const weights=new Map();
      for (const [stencil,scale] of terms) for (const [id,w] of stencil)
        weights.set(id,(weights.get(id)||0)+w*scale);
      return [...weights].filter(([,w])=>Math.abs(w)>1e-12);
    };

    const subdivide=()=> {
      const neighbours=stencils.map(()=>new Set()),edges=new Map();
      for (const f of faces) for (let i=0;i<3;i++) {
        const a=f[i],b=f[(i+1)%3],opposite=f[(i+2)%3];
        neighbours[a].add(b);neighbours[b].add(a);
        const key=Math.min(a,b)+','+Math.max(a,b);
        if(!edges.has(key)) edges.set(key,{a:Math.min(a,b),b:Math.max(a,b),op:[]});
        edges.get(key).op.push(opposite);
      }

      const next=stencils.map((stencil,i)=> {
        const n=neighbours[i].size;
        const beta=(5/8-Math.pow(3/8+Math.cos(2*Math.PI/n)/4,2))/n;
        return blendStencil([[stencil,1-n*beta],...[...neighbours[i]].map(j=>[stencils[j],beta])]);
      });

      for(const edge of edges.values()) {
        if(edge.op.length!==2) throw new Error('Non-manifold subdivision edge.');
        edge.index=next.length;
        next.push(blendStencil([[stencils[edge.a],3/8],[stencils[edge.b],3/8],
          [stencils[edge.op[0]],1/8],[stencils[edge.op[1]],1/8]]));
      }

      const edgeIndex=(a,b)=>edges.get(Math.min(a,b)+','+Math.max(a,b)).index;
      const nextFaces=[];
      for(const [a,b,c] of faces) {
        const ab=edgeIndex(a,b),bc=edgeIndex(b,c),ca=edgeIndex(c,a);
        nextFaces.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);
      }
      stencils=next;faces=nextFaces;
    };

    subdivide();
    subdivide();

    const indices=faces.flat();
    const positions=new Float32Array(stencils.length*3);
    const geometry=keep(new THREE.BufferGeometry());
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(indices);
    const opticalThickness=new Float32Array(stencils.length).fill(.03);
    geometry.setAttribute('opticalThickness',new THREE.BufferAttribute(opticalThickness,1).setUsage(THREE.DynamicDrawUsage));
    return {geometry,stencils,positions,indices:geometry.index.array};
  }
  class SoftBody {
    constructor(cage) {
      this.cage=cage; this.x=cage.pos.slice(); this.rest=cage.pos.slice();
      this.previous=this.x.slice(); this.velocity=new Float64Array(this.x.length);
      this.mass=new Float64Array(this.x.length/3); this.inverseMass=new Float64Array(this.mass.length);
      this.contact=new Float64Array(this.mass.length); this.grab=null;
      this.elements=[]; this.gradient=new Float64Array(12); this.F=new Float64Array(9);
      const uniqueEdges=new Set(); this.edges=[];
      for (const ids of cage.tets) {
        const [a,b,c,d]=ids.map(v=>v*3),p=this.rest;
        const dm=[p[b]-p[a],p[c]-p[a],p[d]-p[a],p[b+1]-p[a+1],p[c+1]-p[a+1],p[d+1]-p[a+1],p[b+2]-p[a+2],p[c+2]-p[a+2],p[d+2]-p[a+2]];
        const volume=determinant(...dm)/6,inv=inverse3(dm);
        const gradients=new Float64Array(12);
        for(let k=0;k<3;k++) {
          gradients[3+k]=inv[k]; gradients[6+k]=inv[3+k]; gradients[9+k]=inv[6+k];
          gradients[k]=-inv[k]-inv[3+k]-inv[6+k];
        }
        this.elements.push({ids,offsets:ids.map(v=>v*3),volume,gradients,lambdaD:0,lambdaH:0,lambdaB:0});
        for(const i of ids) this.mass[i]+=PHYS.density*volume/4;
        for(let i=0;i<4;i++) for(let j=i+1;j<4;j++) {
          const a=Math.min(ids[i],ids[j]),b=Math.max(ids[i],ids[j]),key=a+','+b;
          if(!uniqueEdges.has(key)) { uniqueEdges.add(key); this.edges.push([a,b]); }
        }
      }
      for(let i=0;i<this.mass.length;i++) this.inverseMass[i]=1/this.mass[i];
      this.totalMass=this.mass.reduce((a,b)=>a+b,0);
      this.surface=makeSmoothSurface(cage);
      this.center=new THREE.Vector3(); this.updateSurface();
    }
    deformation(e) {
      const x=this.x,g=e.gradients,f=this.F;
      f.fill(0);
      for(let v=0;v<4;v++) {
        const i=e.offsets[v],j=v*3;
        // Translation-free evaluation avoids catastrophic cancellation far from origin.
        if(v===0) continue;
        const a=e.offsets[0],dx=x[i]-x[a],dy=x[i+1]-x[a+1],dz=x[i+2]-x[a+2];
        f[0]+=dx*g[j]; f[1]+=dx*g[j+1]; f[2]+=dx*g[j+2];
        f[3]+=dy*g[j]; f[4]+=dy*g[j+1]; f[5]+=dy*g[j+2];
        f[6]+=dz*g[j]; f[7]+=dz*g[j+1]; f[8]+=dz*g[j+2];
      }
      return f;
    }
    project(e,C,compliance,key,inequality=false) {
      const grad=this.gradient,w=this.inverseMass,x=this.x;
      let denom=compliance;
      for(let v=0;v<4;v++) { const j=3*v; denom+=w[e.ids[v]]*(grad[j]**2+grad[j+1]**2+grad[j+2]**2); }
      if(denom<1e-16) return;
      let delta=(-C-compliance*e[key])/denom;
      if(inequality) delta=Math.max(0,e[key]+delta)-e[key];
      e[key]+=delta;
      for(let v=0;v<4;v++) {
        const j=v*3,i=e.offsets[v],s=w[e.ids[v]]*delta;
        x[i]+=s*grad[j]; x[i+1]+=s*grad[j+1]; x[i+2]+=s*grad[j+2];
      }
    }
    // Stable compressible neo-Hookean energy per rest volume:
    // W = mu/2 * (||F||² - 3) + bulk/2 * (J - 1 - mu/bulk)².
    // Its stress vanishes at F=I; the two XPBD constraints split this energy.
    // An additional unilateral determinant barrier resists element inversion.
    solveDeviatoric(e,h) {
      const f=this.deformation(e),g=e.gradients,out=this.gradient;
      let norm=0; for(let j=0;j<9;j++) norm+=f[j]*f[j];
      norm=Math.sqrt(norm); if(norm<1e-12) return;
      for(let v=0;v<4;v++) {
        const j=v*3,a=g[j],b=g[j+1],c=g[j+2];
        out[j]=(f[0]*a+f[1]*b+f[2]*c)/norm;
        out[j+1]=(f[3]*a+f[4]*b+f[5]*c)/norm;
        out[j+2]=(f[6]*a+f[7]*b+f[8]*c)/norm;
      }
      this.project(e,norm,1/(PHYS.shear*e.volume*h*h),'lambdaD');
    }
    solveHydrostatic(e,h,barrier=false) {
      const f=this.deformation(e),g=e.gradients,out=this.gradient;
      const [a,b,c,d,ee,ff,gg,hh,ii]=f;
      const c0=ee*ii-ff*hh,c1=ff*gg-d*ii,c2=d*hh-ee*gg;
      const c3=c*hh-b*ii,c4=a*ii-c*gg,c5=b*gg-a*hh;
      const c6=b*ff-c*ee,c7=c*d-a*ff,c8=a*ee-b*d;
      const J=a*c0+b*c1+c*c2;
      if(barrier && J>=.16 && e.lambdaB===0) return;
      for(let v=0;v<4;v++) {
        const j=v*3,g0=g[j],g1=g[j+1],g2=g[j+2];
        out[j]=c0*g0+c1*g1+c2*g2;
        out[j+1]=c3*g0+c4*g1+c5*g2;
        out[j+2]=c6*g0+c7*g1+c8*g2;
      }
      if(barrier) this.project(e,J-.16,0,'lambdaB',true);
      else this.project(e,J-(1+PHYS.shear/PHYS.bulk),1/(PHYS.bulk*e.volume*h*h),'lambdaH');
    }
    solveGrab(h) {
      const grab=this.grab; if(!grab) return;
      const p=grab.point; p.set(0,0,0);
      let denominator=0;
      for(const [id,weight] of grab.weights) {
        p.x+=this.x[id*3]*weight; p.y+=this.x[id*3+1]*weight; p.z+=this.x[id*3+2]*weight;
        denominator+=this.inverseMass[id]*weight*weight;
      }
      const alpha=1/(90*h*h); denominator+=alpha;
      for(let axis=0;axis<3;axis++) {
        const C=p.getComponent(axis)-grab.target.getComponent(axis);
        // Force limit keeps teleports from driving the FEM into a singular state.
        const dl=(-C-alpha*grab.lambda[axis])/denominator;
        const next=clamp(grab.lambda[axis]+dl,-PHYS.maxGrabForce*h*h,PHYS.maxGrabForce*h*h);
        const change=next-grab.lambda[axis]; grab.lambda[axis]=next;
        for(const [id,weight] of grab.weights) this.x[id*3+axis]+=this.inverseMass[id]*weight*change;
      }
    }
    step(h) {
      const x=this.x,v=this.velocity,old=this.previous;
      old.set(x); this.contact.fill(0);
      const air=Math.exp(-.025*h);
      for(let i=0;i<this.mass.length;i++) {
        const j=i*3; v[j]*=air; v[j+1]=v[j+1]*air-PHYS.gravity*h; v[j+2]*=air;
        x[j]+=v[j]*h; x[j+1]+=v[j+1]*h; x[j+2]+=v[j+2]*h;
      }
      for(const e of this.elements) e.lambdaD=e.lambdaH=e.lambdaB=0;
      if(this.grab) this.grab.lambda.fill(0);
      for(let iteration=0;iteration<PHYS.iterations;iteration++) {
        const reverse=(iteration&1)!==0;
        for(let n=0;n<this.elements.length;n++) {
          const e=this.elements[reverse?this.elements.length-1-n:n];
          this.solveDeviatoric(e,h); this.solveHydrostatic(e,h); this.solveHydrostatic(e,h,true);
        }
        this.solveGrab(h);
        for(let i=0;i<this.mass.length;i++) {
          const j=i*3;
          if(x[j+1]<PHYS.floor) {
            this.contact[i]+=PHYS.floor-x[j+1]; x[j+1]=PHYS.floor;
          }
        }
      }
      for(let i=0;i<this.mass.length;i++) {
        const j=i*3,normal=this.contact[i],incoming=v[j+1];
        if(normal>0) {
          const dx=x[j]-old[j],dz=x[j+2]-old[j+2],tangent=Math.hypot(dx,dz);
          const friction=tangent<PHYS.staticFriction*normal ? 1 : Math.min(1,PHYS.dynamicFriction*normal/(tangent+1e-20));
          x[j]-=dx*friction; x[j+2]-=dz*friction;
        }
        v[j]=(x[j]-old[j])/h; v[j+1]=(x[j+1]-old[j+1])/h; v[j+2]=(x[j+2]-old[j+2])/h;
        if(normal>0 && incoming<0) {
          const bounce=incoming<-.18 ? -incoming*PHYS.restitution : 0;
          v[j+1]=Math.max(v[j+1],bounce);
        }
      }
      // Pairwise axial viscosity removes strain-rate energy, not rigid-body
      // translation or rotation. Equal/opposite impulses conserve momentum.
      const damping=1-Math.exp(-PHYS.damping*h*.35);
      for(const [a,b] of this.edges) {
        const ia=a*3,ib=b*3,dx=x[ib]-x[ia],dy=x[ib+1]-x[ia+1],dz=x[ib+2]-x[ia+2];
        const len=Math.hypot(dx,dy,dz); if(len<1e-9) continue;
        const nx=dx/len,ny=dy/len,nz=dz/len;
        const relative=(v[ib]-v[ia])*nx+(v[ib+1]-v[ia+1])*ny+(v[ib+2]-v[ia+2])*nz;
        const impulse=relative*damping/(this.inverseMass[a]+this.inverseMass[b]);
        const sa=impulse*this.inverseMass[a],sb=impulse*this.inverseMass[b];
        v[ia]+=sa*nx; v[ia+1]+=sa*ny; v[ia+2]+=sa*nz;
        v[ib]-=sb*nx; v[ib+1]-=sb*ny; v[ib+2]-=sb*nz;
      }
    }
    updateSurface() {
      const {positions,stencils,geometry}=this.surface;
      for(let i=0;i<stencils.length;i++) {
        let x=0,y=0,z=0;
        for(const [id,w] of stencils[i]) { const j=id*3; x+=this.x[j]*w; y+=this.x[j+1]*w; z+=this.x[j+2]*w; }
        positions[3*i]=x; positions[3*i+1]=y; positions[3*i+2]=z;
      }
      geometry.attributes.position.needsUpdate=true;
      geometry.computeVertexNormals(); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
      this.center.set(0,0,0);
      for(let i=0;i<this.mass.length;i++) {
        const w=this.mass[i]/this.totalMass;
        this.center.x+=this.x[i*3]*w; this.center.y+=this.x[i*3+1]*w; this.center.z+=this.x[i*3+2]*w;
      }
    }
    energy() {
      let E=0;
      for(let i=0;i<this.mass.length;i++) { const j=i*3; E+=.5*this.mass[i]*(this.velocity[j]**2+this.velocity[j+1]**2+this.velocity[j+2]**2); }
      return E;
    }
    volumeRatio() {
      let volume=0;
      for(const e of this.elements) volume+=determinant(...this.deformation(e))*e.volume;
      return volume/this.cage.totalVolume;
    }
    reset() {
      this.x.set(this.rest); this.previous.set(this.rest); this.velocity.fill(0); this.grab=null;
      this.updateSurface();
    }
    nudge() {
      if(this.grab) return;
      // A modest impulse and torque, not an authored wobble animation.
      for(let i=0;i<this.mass.length;i++) {
        const j=i*3,dy=this.x[j+1]-this.center.y;
        this.velocity[j]+=.095+dy*3; this.velocity[j+1]+=.12; this.velocity[j+2]+=.025;
      }
    }
    isFinite() {
      for(let i=0;i<this.x.length;i++) if(!Number.isFinite(this.x[i])||!Number.isFinite(this.velocity[i])||Math.abs(this.x[i])>100000) return false;
      return true;
    }
  }

export { SoftBody, determinant, inverse3 };

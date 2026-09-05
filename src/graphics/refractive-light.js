// Geometry-traced RGB transport, Fresnel, Beer–Lambert absorption and TIR from the reference.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { clamp } from '../physics/constants.js';
import { depositBeam } from './beam-raster.js';
const keep = object => object;
  class SurfaceBVH {
    constructor(surface) {
      this.surface=surface; this.p=surface.positions; this.index=surface.indices;
      this.centroids=new Float32Array(this.index.length);
      for(let t=0;t<this.index.length/3;t++) for(let axis=0;axis<3;axis++) {
        this.centroids[t*3+axis]=(this.p[this.index[t*3]*3+axis]+this.p[this.index[t*3+1]*3+axis]+this.p[this.index[t*3+2]*3+axis])/3;
      }
      const build=ids=> {
        const node={min:[0,0,0],max:[0,0,0],left:null,right:null,ids:null};
        if(ids.length<=8) node.ids=ids;
        else {
          const ranges=[0,1,2].map(axis=> {
            let lo=Infinity,hi=-Infinity; for(const id of ids) { const x=this.centroids[id*3+axis]; lo=Math.min(lo,x); hi=Math.max(hi,x); } return hi-lo;
          });
          const axis=ranges.indexOf(Math.max(...ranges));
          ids.sort((a,b)=>this.centroids[a*3+axis]-this.centroids[b*3+axis]);
          const mid=ids.length>>1; node.left=build(ids.slice(0,mid)); node.right=build(ids.slice(mid));
        }
        return node;
      };
      this.root=build(Array.from({length:this.index.length/3},(_,i)=>i)); this.refit();
    }
    refit() {
      const p=this.p,ix=this.index;
      const visit=node=> {
        if(node.ids) {
          node.min.fill(Infinity); node.max.fill(-Infinity);
          for(const t of node.ids) for(let c=0;c<3;c++) for(let a=0;a<3;a++) {
            const v=p[ix[t*3+c]*3+a]; node.min[a]=Math.min(node.min[a],v); node.max[a]=Math.max(node.max[a],v);
          }
        } else {
          visit(node.left); visit(node.right);
          for(let a=0;a<3;a++) { node.min[a]=Math.min(node.left.min[a],node.right.min[a]); node.max[a]=Math.max(node.left.max[a],node.right.max[a]); }
        }
      }; visit(this.root);
    }
    /** @returns {{t:number,u:number,v:number,distance:number}|null} */
    hit(o,d,maxDistance=Infinity) {
      const p=this.p,ix=this.index; let nearest=maxDistance,result=null;
      const box=node=> {
        let lo=0,hi=nearest;
        for(let a=0;a<3;a++) {
          if(Math.abs(d[a])<1e-12) { if(o[a]<node.min[a]||o[a]>node.max[a]) return false; }
          else {
            let t0=(node.min[a]-o[a])/d[a],t1=(node.max[a]-o[a])/d[a];
            if(t0>t1) [t0,t1]=[t1,t0]; lo=Math.max(lo,t0); hi=Math.min(hi,t1);
            if(hi<lo) return false;
          }
        } return true;
      };
      const visit=node=> {
        if(!box(node)) return;
        if(!node.ids) { visit(node.left); visit(node.right); return; }
        for(const t of node.ids) {
          const a=ix[t*3]*3,b=ix[t*3+1]*3,c=ix[t*3+2]*3;
          const e1x=p[b]-p[a],e1y=p[b+1]-p[a+1],e1z=p[b+2]-p[a+2];
          const e2x=p[c]-p[a],e2y=p[c+1]-p[a+1],e2z=p[c+2]-p[a+2];
          const hx=d[1]*e2z-d[2]*e2y,hy=d[2]*e2x-d[0]*e2z,hz=d[0]*e2y-d[1]*e2x;
          const det=e1x*hx+e1y*hy+e1z*hz; if(Math.abs(det)<1e-14) continue;
          const inv=1/det,sx=o[0]-p[a],sy=o[1]-p[a+1],sz=o[2]-p[a+2];
          const u=(sx*hx+sy*hy+sz*hz)*inv; if(u<0||u>1) continue;
          const qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x;
          const v=(d[0]*qx+d[1]*qy+d[2]*qz)*inv; if(v<0||u+v>1) continue;
          const distance=(e2x*qx+e2y*qy+e2z*qz)*inv;
          if(distance>1e-7 && distance<nearest) { nearest=distance; result={t,u,v,distance}; }
        }
      }; visit(this.root); return result;
    }
    normal(hit,d,entering) {
      const ix=this.index,p=this.p,n=this.surface.geometry.attributes.normal.array;
      const a=ix[hit.t*3]*3,b=ix[hit.t*3+1]*3,c=ix[hit.t*3+2]*3,w=1-hit.u-hit.v;
      let x=n[a]*w+n[b]*hit.u+n[c]*hit.v,y=n[a+1]*w+n[b+1]*hit.u+n[c+1]*hit.v,z=n[a+2]*w+n[b+2]*hit.u+n[c+2]*hit.v;
      // At sharp deformation, a shading normal can point across the true face.
      // Fall back to its geometric normal before orienting against the ray.
      const ex=p[b]-p[a],ey=p[b+1]-p[a+1],ez=p[b+2]-p[a+2];
      const fx=p[c]-p[a],fy=p[c+1]-p[a+1],fz=p[c+2]-p[a+2];
      const gx=ey*fz-ez*fy,gy=ez*fx-ex*fz,gz=ex*fy-ey*fx;
      const sign=entering?1:-1;
      if((x*d[0]+y*d[1]+z*d[2])*sign>-.015) { x=gx; y=gy; z=gz; }
      const len=Math.hypot(x,y,z)||1;
      x=x/len*sign; y=y/len*sign; z=z/len*sign;
      if(x*d[0]+y*d[1]+z*d[2]>0) { x=-x; y=-y; z=-z; }
      return [x,y,z];
    }
  }

  function refractRay(d,n,n1,n2) {
    const cosine=clamp(-(d[0]*n[0]+d[1]*n[1]+d[2]*n[2]),0,1),eta=n1/n2;
    const k=1-eta*eta*(1-cosine*cosine);
    if(k<0) return null;
    const ct=Math.sqrt(k),a=eta*cosine-ct;
    const rs=(n1*cosine-n2*ct)/(n1*cosine+n2*ct+1e-20);
    const rp=(n2*cosine-n1*ct)/(n2*cosine+n1*ct+1e-20);
    return {direction:[eta*d[0]+a*n[0],eta*d[1]+a*n[1],eta*d[2]+a*n[2]],transmission:1-(rs*rs+rp*rp)/2};
  }

  class RefractiveLightField {
    constructor(surface, lightDirection, sigma) {
      this.lightDirection=lightDirection; this.sigma=sigma;
      this.size=256; this.span=.22; this.samples=64; this.origin=new THREE.Vector2();
      this.originNode=uniform(this.origin); this.spanNode=uniform(this.span);
      this.shadowOrigin=new THREE.Vector2();this.shadowOriginNode=uniform(this.shadowOrigin);
      this.bvh=new SurfaceBVH(surface); this.surface=surface;
      this.photons=new Float32Array(this.size*this.size*3);
      this.shadow=new Float32Array(this.size*this.size);
      this.contact=new Float32Array(this.size*this.size);
      this.blurScratch=new Float32Array(this.size*this.size);
      this.lightBytes=new Uint16Array(this.size*this.size*4);
      this.shadowBytes=new Uint8Array(this.size*this.size*4);
      this.lightTexture=this.makeTexture(this.lightBytes);
      this.shadowTexture=this.makeTexture(this.shadowBytes);
    }
    makeTexture(data) {
      const type=data instanceof Uint16Array?THREE.HalfFloatType:THREE.UnsignedByteType;
      const tex=keep(new THREE.DataTexture(data,this.size,this.size,THREE.RGBAFormat,type));
      tex.minFilter=tex.magFilter=THREE.LinearFilter; tex.generateMipmaps=false;
      tex.colorSpace=THREE.NoColorSpace; tex.needsUpdate=true; return tex;
    }
    rasterTriangle(a,b,c,buffer,value) {
      const n=this.size,scale=n/this.span;
      const ax=(a[0]-this.origin.x)*scale,ay=(a[1]-this.origin.y)*scale;
      const bx=(b[0]-this.origin.x)*scale,by=(b[1]-this.origin.y)*scale;
      const cx=(c[0]-this.origin.x)*scale,cy=(c[1]-this.origin.y)*scale;
      const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax); if(Math.abs(area)<1e-9) return;
      const minX=clamp(Math.floor(Math.min(ax,bx,cx)),0,n-1),maxX=clamp(Math.ceil(Math.max(ax,bx,cx)),0,n-1);
      const minY=clamp(Math.floor(Math.min(ay,by,cy)),0,n-1),maxY=clamp(Math.ceil(Math.max(ay,by,cy)),0,n-1);
      for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) {
        const px=x+.5,py=y+.5;
        const u=((bx-px)*(cy-py)-(by-py)*(cx-px))/area;
        const v=((cx-px)*(ay-py)-(cy-py)*(ax-px))/area;
        if(u>=0 && v>=0 && u+v<=1) buffer[y*n+x]=Math.max(buffer[y*n+x],value);
      }
    }
    blur(buffer) {
      const n=this.size,tmp=this.blurScratch;
      for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
        let sum=0; for(let k=-2;k<=2;k++) sum+=buffer[y*n+clamp(x+k,0,n-1)]*(3-Math.abs(k)); tmp[y*n+x]=sum/9;
      }
      for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
        let sum=0; for(let k=-2;k<=2;k++) sum+=tmp[clamp(y+k,0,n-1)*n+x]*(3-Math.abs(k)); buffer[y*n+x]=sum/9;
      }
    }
    updateViewThickness(camera) {
      // Trace the first interior exit for each displayed vertex in the viewing
      // direction. Interpolated per-vertex thickness improves on a constant slab;
      // screen-space colour lookup still cannot see off-screen/background layers.
      const p=this.surface.positions,n=this.surface.geometry.attributes.normal.array;
      const thickness=this.surface.geometry.attributes.opticalThickness;
      for(let i=0;i<p.length;i+=3) {
        let dx=p[i]-camera.position.x,dy=p[i+1]-camera.position.y,dz=p[i+2]-camera.position.z;
        const length=Math.hypot(dx,dy,dz)||1; dx/=length;dy/=length;dz/=length;
        const normal=[n[i],n[i+1],n[i+2]];
        if(dx*normal[0]+dy*normal[1]+dz*normal[2]>-.01) continue;
        const refraction=refractRay([dx,dy,dz],normal,1,1.35); if(!refraction) continue;
        const dir=refraction.direction,o=[p[i]+dir[0]*2e-6,p[i+1]+dir[1]*2e-6,p[i+2]+dir[2]*2e-6];
        const hit=this.bvh.hit(o,dir);
        thickness.array[i/3]=hit?clamp(hit.distance,.0002,.16):.002;
      }
      thickness.needsUpdate=true;
    }
    update(body) {
      this.bvh.refit(); this.photons.fill(0); this.shadow.fill(0); this.contact.fill(0);
      const D=[this.lightDirection.x,this.lightDirection.y,this.lightDirection.z];
      const p=this.surface.positions,ix=this.surface.indices,box=this.surface.geometry.boundingBox;
      const cx=body.center.x,cz=body.center.z;
      // Keep a stretched or airborne body's complete projected footprint in the receiver.
      this.span=Math.max(.22,(box.max.x-box.min.x)*2+.04,(box.max.z-box.min.z)*2+.04,
        box.max.y*Math.max(Math.abs(D[0]/D[1]),Math.abs(D[2]/D[1]))*2+.12);
      this.spanNode.value=this.span;
      // Follow transport, including the light-space displacement of a lifted body.
      const projectedX=cx-body.center.y*D[0]/D[1],projectedZ=cz-body.center.y*D[2]/D[1];
      this.origin.set((cx+projectedX)/2-this.span/2,(cz+projectedZ)/2-this.span/2);
      this.shadowOrigin.copy(this.origin);
      for(let t=0;t<ix.length;t+=3) {
        const vertices=[ix[t]*3,ix[t+1]*3,ix[t+2]*3];
        const projected=vertices.map(i=>[p[i]-p[i+1]*D[0]/D[1],p[i+2]-p[i+1]*D[2]/D[1]]);
        this.rasterTriangle(...projected,this.shadow,1);
        const height=(p[vertices[0]+1]+p[vertices[1]+1]+p[vertices[2]+1])/3;
        if(height<.016) this.rasterTriangle(...vertices.map(i=>[p[i],p[i+2]]),this.contact,Math.exp(-height/.0028));
      }
      this.blur(this.shadow); this.blur(this.contact);
      const top=box.max.y+.007;
      let loX=Infinity,hiX=-Infinity,loZ=Infinity,hiZ=-Infinity;
      for(let i=0;i<p.length;i+=3) {
        const x=p[i]+(top-p[i+1])*D[0]/D[1],z=p[i+2]+(top-p[i+1])*D[2]/D[1];
        loX=Math.min(loX,x); hiX=Math.max(hiX,x); loZ=Math.min(loZ,z); hiZ=Math.max(hiZ,z);
      }
      const width=hiX-loX+.002,depth=hiZ-loZ+.002; loX-=.001;loZ-=.001;
      const sampleArea=width*depth/(2*this.samples*this.samples),stride=this.samples+1;
      const rays=new Array(stride*stride).fill(null);
      const sigmas=this.sigma,ior=1.35;
      for(let y=0;y<=this.samples;y++) for(let x=0;x<=this.samples;x++) {
        // Connected ray bundles transport a continuous footprint, not point noise.
        const o=[loX+x/this.samples*width,top,loZ+y/this.samples*depth];
        const entry=this.bvh.hit(o,D); if(!entry) continue;
        const en=this.bvh.normal(entry,D,true),entryPoint=o.map((v,a)=>v+D[a]*entry.distance);
        {
          // Share the geometric path across RGB; retain spectral absorption.
          // The original subpixel caustic dispersion does not warrant 3× tracing.
          const transmitted=refractRay(D,en,1,ior); if(!transmitted) continue;
          let dir=transmitted.direction,throughput=transmitted.transmission,pathLength=0;
          let start=entryPoint.map((v,a)=>v+dir[a]*2e-6),escaped=false,branch=0;
          for(let bounce=0;bounce<4;bounce++) {
            const exit=this.bvh.hit(start,dir); if(!exit) break;
            pathLength+=exit.distance;
            const hitPoint=start.map((v,a)=>v+dir[a]*exit.distance);
            const normal=this.bvh.normal(exit,dir,false),refraction=refractRay(dir,normal,ior,1);
            if(refraction) {
              throughput*=refraction.transmission; dir=refraction.direction;
              start=hitPoint.map((v,a)=>v+dir[a]*2e-6); escaped=true;branch=bounce; break;
            }
            const dot=dir[0]*normal[0]+dir[1]*normal[1]+dir[2]*normal[2];
            dir=dir.map((v,a)=>v-2*dot*normal[a]); start=hitPoint.map((v,a)=>v+dir[a]*2e-6);
          }
          if(!escaped||dir[1]>=-1e-5||throughput<.002) continue;
          const distance=-start[1]/dir[1]; if(distance<=0) continue;
          // Secondary interception is occlusion here, not an invented ray exit.
          if(this.bvh.hit(start,dir,distance)) continue;
          rays[y*stride+x]={landing:[start[0]+dir[0]*distance,start[2]+dir[2]*distance],throughput:sigmas.map(sigma=>throughput*Math.exp(-sigma*pathLength)),branch,entryY:entryPoint[1],exitY:start[1]};
        }
      }
      const continuity=Math.max(width,depth)/this.samples*8;
      for(let y=0;y<this.samples;y++)for(let x=0;x<this.samples;x++) {
        const a=y*stride+x,b=a+1,c=a+stride,d=c+1;
        for(const ids of [[a,b,d],[a,d,c]]) {
          const beam=ids.map(id=>rays[id]);if(beam.some(ray=>ray===null))continue;
          // Do not bridge silhouettes or discontinuous internal-reflection paths.
          if(beam.some(ray=>ray.branch!==beam[0].branch||Math.abs(ray.entryY-beam[0].entryY)>continuity||Math.abs(ray.exitY-beam[0].exitY)>continuity))continue;
          const flux=[0,1,2].map(channel=>sampleArea*(beam[0].throughput[channel]+beam[1].throughput[channel]+beam[2].throughput[channel])/3);
          depositBeam(this.photons,this.size,this.origin,this.span,beam.map(ray=>ray.landing),0,flux);
        }
      }
      for(let i=0;i<this.size*this.size;i++) {
        // Linear RGBA16F keeps bright focused flux instead of clipping it at 5×.
        for(let c=0;c<3;c++) this.lightBytes[i*4+c]=THREE.DataUtils.toHalfFloat(clamp(this.photons[i*3+c],0,60000));
        this.lightBytes[i*4+3]=THREE.DataUtils.toHalfFloat(1);
        this.shadowBytes[i*4]=Math.round(this.shadow[i]*255);
        this.shadowBytes[i*4+1]=Math.round(this.contact[i]*255);
        this.shadowBytes[i*4+2]=0; this.shadowBytes[i*4+3]=255;
      }
      this.lightTexture.needsUpdate=true; this.shadowTexture.needsUpdate=true;
    }
  }

export { RefractiveLightField, SurfaceBVH };

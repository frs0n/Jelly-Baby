#include <stdint.h>

// Tiny fixed-memory WebAssembly accelerator for the existing CPU XPBD solver.
// The JS class owns the model semantics; this module only executes the same
// arithmetic in tight linear-memory loops so interaction no longer competes
// with tens of thousands of JS method/object traversals per frame.

// Allocate above the linker-owned stack/data region when rebuilding the kernel.
extern unsigned char __heap_base;
static uint32_t heap;
static uint32_t node_count, element_count, edge_count, contact_count, surface_count;
static uint32_t x_p, previous_p, candidate_p, velocity_p, mass_p, inverse_mass_p, contact_node_p;
static uint32_t element_ids_p, element_volume_p, element_gradients_p, inverse_rest_det_p;
static uint32_t lambda_d_p, lambda_h_p, lambda_b_p;
static uint32_t edge_ids_p;
static uint32_t contact_ids_p, contact_weights_p, contact_denominator_p, contact_normal_p, contact_incoming_p;
static uint32_t nodal_volume_p, nodal_f_p;
static uint32_t grab_ids_p, grab_weights_p, grab_target_p, grab_lambda_p;
static uint32_t surface_positions_p, surface_normals_p, surface_ids_p, surface_weights_p, rest_normals_p;
static uint32_t meta_p;
static double total_mass;

static inline double *d64(uint32_t p) { return (double *)(uintptr_t)p; }
static inline float *f32(uint32_t p) { return (float *)(uintptr_t)p; }
static inline uint32_t *u32(uint32_t p) { return (uint32_t *)(uintptr_t)p; }
static inline double dsqrt(double x) { return __builtin_sqrt(x); }
static inline double dmin(double a,double b) { return a<b?a:b; }
static inline double dmax(double a,double b) { return a>b?a:b; }

__attribute__((export_name("alloc"))) uint32_t alloc_mem(uint32_t bytes) {
  if(!heap)heap=(uint32_t)(uintptr_t)&__heap_base;
  uint32_t p=(heap+15u)&~15u;heap=p+bytes;return p;
}

__attribute__((export_name("configure"))) void configure(
  uint32_t nodes,uint32_t elements,uint32_t edges,uint32_t contacts,uint32_t surface_vertices,
  uint32_t x,uint32_t previous,uint32_t candidate,uint32_t velocity,uint32_t mass,uint32_t inverse_mass,uint32_t contact_node,
  uint32_t element_ids,uint32_t element_volume,uint32_t element_gradients,uint32_t inverse_rest_det,
  uint32_t lambda_d,uint32_t lambda_h,uint32_t lambda_b,uint32_t edge_ids,
  uint32_t contact_ids,uint32_t contact_weights,uint32_t contact_denominator,uint32_t contact_normal,uint32_t contact_incoming,
  uint32_t nodal_volume,uint32_t nodal_f,uint32_t grab_ids,uint32_t grab_weights,uint32_t grab_target,uint32_t grab_lambda,
  uint32_t surface_positions,uint32_t surface_normals,uint32_t surface_ids,uint32_t surface_weights,uint32_t rest_normals,
  uint32_t meta,double totalMass
) {
  node_count=nodes;element_count=elements;edge_count=edges;contact_count=contacts;surface_count=surface_vertices;
  x_p=x;previous_p=previous;candidate_p=candidate;velocity_p=velocity;mass_p=mass;inverse_mass_p=inverse_mass;contact_node_p=contact_node;
  element_ids_p=element_ids;element_volume_p=element_volume;element_gradients_p=element_gradients;inverse_rest_det_p=inverse_rest_det;
  lambda_d_p=lambda_d;lambda_h_p=lambda_h;lambda_b_p=lambda_b;edge_ids_p=edge_ids;
  contact_ids_p=contact_ids;contact_weights_p=contact_weights;contact_denominator_p=contact_denominator;contact_normal_p=contact_normal;contact_incoming_p=contact_incoming;
  nodal_volume_p=nodal_volume;nodal_f_p=nodal_f;grab_ids_p=grab_ids;grab_weights_p=grab_weights;grab_target_p=grab_target;grab_lambda_p=grab_lambda;
  surface_positions_p=surface_positions;surface_normals_p=surface_normals;surface_ids_p=surface_ids;surface_weights_p=surface_weights;rest_normals_p=rest_normals;
  meta_p=meta;total_mass=totalMass;
}

static inline double tet_jacobian(uint32_t e,const double *pos) {
  const uint32_t *ids=u32(element_ids_p);const double *inv_det=d64(inverse_rest_det_p);
  const uint32_t a=ids[e*4]*3,b=ids[e*4+1]*3,c=ids[e*4+2]*3,d=ids[e*4+3]*3;
  const double ax=pos[b]-pos[a],bx=pos[c]-pos[a],cx=pos[d]-pos[a];
  const double ay=pos[b+1]-pos[a+1],by=pos[c+1]-pos[a+1],cy=pos[d+1]-pos[a+1];
  const double az=pos[b+2]-pos[a+2],bz=pos[c+2]-pos[a+2],cz=pos[d+2]-pos[a+2];
  return (ax*(by*cz-cy*bz)-bx*(ay*cz-cy*az)+cx*(ay*bz-by*az))*inv_det[e];
}

static double minimum_jacobian(const double *pos,double stop_at) {
  double minimum=1.0/0.0;
  for(uint32_t e=0;e<element_count;e++) {double J=tet_jacobian(e,pos);if(J<minimum)minimum=J;if(minimum<stop_at)return minimum;}
  return minimum;
}

static inline void deformation(uint32_t e,const double *x,const uint32_t *ids,const double *grad,double *f) {
  const uint32_t a=ids[e*4]*3,b=ids[e*4+1]*3,c=ids[e*4+2]*3,d=ids[e*4+3]*3,go=e*12;
  const double bx=x[b]-x[a],by=x[b+1]-x[a+1],bz=x[b+2]-x[a+2];
  const double cx=x[c]-x[a],cy=x[c+1]-x[a+1],cz=x[c+2]-x[a+2];
  const double dx=x[d]-x[a],dy=x[d+1]-x[a+1],dz=x[d+2]-x[a+2];
  f[0]=bx*grad[go+3]+cx*grad[go+6]+dx*grad[go+9];f[1]=bx*grad[go+4]+cx*grad[go+7]+dx*grad[go+10];f[2]=bx*grad[go+5]+cx*grad[go+8]+dx*grad[go+11];
  f[3]=by*grad[go+3]+cy*grad[go+6]+dy*grad[go+9];f[4]=by*grad[go+4]+cy*grad[go+7]+dy*grad[go+10];f[5]=by*grad[go+5]+cy*grad[go+8]+dy*grad[go+11];
  f[6]=bz*grad[go+3]+cz*grad[go+6]+dz*grad[go+9];f[7]=bz*grad[go+4]+cz*grad[go+7]+dz*grad[go+10];f[8]=bz*grad[go+5]+cz*grad[go+8]+dz*grad[go+11];
}

static inline void solve_element(uint32_t e,double h,double shear,double bulk,double *x,const double *inverse_mass,const uint32_t *ids,const double *volume,const double *grad,double *lambdaD,double *lambdaH,double *lambdaB) {
  double f[9],dg[12],hg[12];deformation(e,x,ids,grad,f);
  double norm=0;for(uint32_t k=0;k<9;k++)norm+=f[k]*f[k];norm=dsqrt(norm);if(norm<1e-12)return;
  double a=f[0],b=f[1],c=f[2],d=f[3],ee=f[4],ff=f[5],gg=f[6],hh=f[7],ii=f[8];
  double c0=ee*ii-ff*hh,c1=ff*gg-d*ii,c2=d*hh-ee*gg,c3=c*hh-b*ii,c4=a*ii-c*gg,c5=b*gg-a*hh,c6=b*ff-c*ee,c7=c*d-a*ff,c8=a*ee-b*d;
  double J=a*c0+b*c1+c*c2,alphaD=1/(shear*volume[e]*h*h),alphaH=1/(bulk*volume[e]*h*h),dd=alphaD,hhMass=alphaH,dh=0;
  const uint32_t go=e*12,io=e*4;
  for(uint32_t v=0;v<4;v++) {
    const uint32_t j=v*3,gj=go+j;double gx=grad[gj],gy=grad[gj+1],gz=grad[gj+2],wm=inverse_mass[ids[io+v]];
    dg[j]=(a*gx+b*gy+c*gz)/norm;dg[j+1]=(d*gx+ee*gy+ff*gz)/norm;dg[j+2]=(gg*gx+hh*gy+ii*gz)/norm;
    hg[j]=c0*gx+c1*gy+c2*gz;hg[j+1]=c3*gx+c4*gy+c5*gz;hg[j+2]=c6*gx+c7*gy+c8*gz;
    for(uint32_t k=0;k<3;k++){double dv=dg[j+k],hv=hg[j+k];dd+=wm*dv*dv;hhMass+=wm*hv*hv;dh+=wm*dv*hv;}
  }
  double rd=-norm-alphaD*lambdaD[e],rh=-(J-1-shear/bulk)-alphaH*lambdaH[e],den=dd*hhMass-dh*dh;
  double dlD=(rd*hhMass-rh*dh)/den,dlH=(rh*dd-rd*dh)/den;lambdaD[e]+=dlD;lambdaH[e]+=dlH;
  for(uint32_t v=0;v<4;v++){uint32_t id=ids[io+v],at=id*3,j=v*3;double wm=inverse_mass[id];for(uint32_t k=0;k<3;k++)x[at+k]+=wm*(dlD*dg[j+k]+dlH*hg[j+k]);}

  // Barrier is evaluated after the elastic projection, exactly like the JS path.
  deformation(e,x,ids,grad,f);a=f[0];b=f[1];c=f[2];d=f[3];ee=f[4];ff=f[5];gg=f[6];hh=f[7];ii=f[8];
  J=a*(ee*ii-ff*hh)+b*(ff*gg-d*ii)+c*(d*hh-ee*gg);if(J>=.25&&lambdaB[e]==0)return;
  c0=ee*ii-ff*hh;c1=ff*gg-d*ii;c2=d*hh-ee*gg;c3=c*hh-b*ii;c4=a*ii-c*gg;c5=b*gg-a*hh;c6=b*ff-c*ee;c7=c*d-a*ff;c8=a*ee-b*d;
  double co[9]={c0,c1,c2,c3,c4,c5,c6,c7,c8},out[12],denom=0;
  for(uint32_t v=0;v<4;v++){uint32_t j=v*3,gj=go+j;double gx=grad[gj],gy=grad[gj+1],gz=grad[gj+2],wm=inverse_mass[ids[io+v]];for(uint32_t k=0;k<3;k++){out[j+k]=co[k*3]*gx+co[k*3+1]*gy+co[k*3+2]*gz;denom+=wm*out[j+k]*out[j+k];}}
  if(denom<1e-15)return;double next=dmax(0,lambdaB[e]-(J-.25)/denom),delta=next-lambdaB[e];lambdaB[e]=next;
  for(uint32_t v=0;v<4;v++){uint32_t id=ids[io+v],at=id*3,j=v*3;double wm=inverse_mass[id]*delta;for(uint32_t k=0;k<3;k++)x[at+k]+=wm*out[j+k];}
}

static inline void solve_grab(uint32_t slot,double h,double max_force,double *x,const double *inverse_mass) {
  const uint32_t *record=u32(grab_ids_p)+slot*17,*ids=record+1;uint32_t grab_count=record[0];
  const double *weights=d64(grab_weights_p)+slot*16,*target=d64(grab_target_p)+slot*3;double *lambda=d64(grab_lambda_p)+slot*3;
  double p[3]={0,0,0},denominator=0;
  for(uint32_t q=0;q<grab_count;q++){uint32_t id=ids[q],at=id*3;double w=weights[q];p[0]+=x[at]*w;p[1]+=x[at+1]*w;p[2]+=x[at+2]*w;denominator+=inverse_mass[id]*w*w;}
  double alpha=1/(90*h*h);denominator+=alpha;
  for(uint32_t axis=0;axis<3;axis++) {double C=p[axis]-target[axis],dl=(-C-alpha*lambda[axis])/denominator;double next=dmin(max_force*h*h,dmax(-max_force*h*h,lambda[axis]+dl)),change=next-lambda[axis];lambda[axis]=next;for(uint32_t q=0;q<grab_count;q++){uint32_t id=ids[q];x[id*3+axis]+=inverse_mass[id]*weights[q]*change;}}
}

static inline void project_orientation(uint32_t e,double target,double *x,const double *inverse_mass,const uint32_t *ids,const double *grad) {
  (void)grad;
  const uint32_t io=e*4,ia=ids[io],ib=ids[io+1],ic=ids[io+2],id=ids[io+3],a=ia*3,b=ib*3,c=ic*3,d=id*3;
  const double bax=x[b]-x[a],bay=x[b+1]-x[a+1],baz=x[b+2]-x[a+2];
  const double cax=x[c]-x[a],cay=x[c+1]-x[a+1],caz=x[c+2]-x[a+2];
  const double dax=x[d]-x[a],day=x[d+1]-x[a+1],daz=x[d+2]-x[a+2];
  const double inv=d64(inverse_rest_det_p)[e];
  const double J=(bax*(cay*daz-caz*day)-cax*(bay*daz-baz*day)+dax*(bay*caz-baz*cay))*inv;
  if(J>=target)return;
  // Direct determinant gradients in current coordinates. These are simpler
  // and numerically more reliable here than reconstructing dJ/dx through F.
  double gbx=(cay*daz-caz*day)*inv,gby=(caz*dax-cax*daz)*inv,gbz=(cax*day-cay*dax)*inv;
  double gcx=(day*baz-daz*bay)*inv,gcy=(daz*bax-dax*baz)*inv,gcz=(dax*bay-day*bax)*inv;
  double gdx=(bay*caz-baz*cay)*inv,gdy=(baz*cax-bax*caz)*inv,gdz=(bax*cay-bay*cax)*inv;
  double gax=-(gbx+gcx+gdx),gay=-(gby+gcy+gdy),gaz=-(gbz+gcz+gdz);
  double denom=inverse_mass[ia]*(gax*gax+gay*gay+gaz*gaz)+inverse_mass[ib]*(gbx*gbx+gby*gby+gbz*gbz)+inverse_mass[ic]*(gcx*gcx+gcy*gcy+gcz*gcz)+inverse_mass[id]*(gdx*gdx+gdy*gdy+gdz*gdz);
  if(denom<1e-15)return;double dl=(target-J)/denom;
  double s=inverse_mass[ia]*dl;x[a]+=s*gax;x[a+1]+=s*gay;x[a+2]+=s*gaz;
  s=inverse_mass[ib]*dl;x[b]+=s*gbx;x[b+1]+=s*gby;x[b+2]+=s*gbz;
  s=inverse_mass[ic]*dl;x[c]+=s*gcx;x[c+1]+=s*gcy;x[c+2]+=s*gcz;
  s=inverse_mass[id]*dl;x[d]+=s*gdx;x[d+1]+=s*gdy;x[d+2]+=s*gdz;
}

static double repair_orientation(double *x,const double *previous,const double *inverse_mass,const uint32_t *ids,const double *grad) {
  // Never shrink the global timestep. Correct only the tetrahedra that cross
  // the orientation barrier. The previous state is known-valid and is used
  // only as a local fallback if determinant projection stalls.
  double minimum=1.0/0.0;
  for(uint32_t pass=0;pass<256;pass++) {
    uint32_t worst=0;minimum=1.0/0.0;
    for(uint32_t e=0;e<element_count;e++){double J=tet_jacobian(e,x);if(J<minimum){minimum=J;worst=e;}}
    if(minimum>=.135)return minimum;
    const double before=minimum;
    project_orientation(worst,.155,x,inverse_mass,ids,grad);
    const double after=tet_jacobian(worst,x);
    if(previous && !(after>before+1e-10)) {
      const uint32_t o=worst*4;
      for(uint32_t q=0;q<4;q++){uint32_t at=ids[o+q]*3;for(uint32_t axis=0;axis<3;axis++)x[at+axis]=.5*(x[at+axis]+previous[at+axis]);}
    }
  }
  return minimum_jacobian(x,-1.0/0.0);
}

static inline void solve_contacts(double floor,double *x,const double *inverse_mass,double *node_contact) {
  const uint32_t *ids=u32(contact_ids_p);const double *weights=d64(contact_weights_p),*denom=d64(contact_denominator_p);double *normal=d64(contact_normal_p);
  for(uint32_t c=0;c<contact_count;c++) {double y=0;uint32_t o=c*4;for(uint32_t k=0;k<4;k++){uint32_t id=ids[o+k];y+=x[id*3+1]*weights[o+k];}if(y>=floor)continue;double depth=floor-y;normal[c]+=depth;for(uint32_t k=0;k<4;k++){uint32_t id=ids[o+k];double w=weights[o+k];x[id*3+1]+=inverse_mass[id]*w*depth/denom[c];node_contact[id]+=depth*w;}}
}

static double preserve_orientation(double *x,const double *previous,double *candidate,double *meta,const double *inverse_mass,const uint32_t *ids,const double *grad) {
  (void)candidate;
  double minimum=minimum_jacobian(x,.12);meta[1]=minimum;if(minimum>=.12){meta[2]=0;return 1.0;}
  meta[2]=1;
  minimum=repair_orientation(x,previous,inverse_mass,ids,grad);
  // Projection normally clears the barrier. If several adjacent elements are
  // simultaneously pathological, locally blend only the worst tet toward the
  // known-valid previous state. This preserves the full 1/240 s step for the
  // rest of the body instead of putting the whole simulation into slow motion.
  for(uint32_t pass=0;minimum<.12&&pass<256;pass++) {
    uint32_t worst=0;minimum=1.0/0.0;
    for(uint32_t e=0;e<element_count;e++){double J=tet_jacobian(e,x);if(J<minimum){minimum=J;worst=e;}}
    if(minimum>=.12)break;
    const uint32_t o=worst*4;
    for(uint32_t q=0;q<4;q++){uint32_t at=ids[o+q]*3;for(uint32_t axis=0;axis<3;axis++)x[at+axis]=.5*(x[at+axis]+previous[at+axis]);}
    minimum=repair_orientation(x,previous,inverse_mass,ids,grad);
  }
  meta[1]=minimum_jacobian(x,-1.0/0.0);
  return 1.0;
}

__attribute__((export_name("step"))) void step(double h,uint32_t grab_count,double gravity,double shear,double bulk,double air,double damping,uint32_t iterations,double static_friction,double dynamic_friction,double restitution,double floor,double max_grab_force) {
  double *x=d64(x_p),*previous=d64(previous_p),*candidate=d64(candidate_p),*velocity=d64(velocity_p),*mass=d64(mass_p),*inverse_mass=d64(inverse_mass_p),*node_contact=d64(contact_node_p);
  uint32_t *ids=u32(element_ids_p);double *volume=d64(element_volume_p),*grad=d64(element_gradients_p),*lambdaD=d64(lambda_d_p),*lambdaH=d64(lambda_h_p),*lambdaB=d64(lambda_b_p);
  double *cn=d64(contact_normal_p),*ci=d64(contact_incoming_p),*cw=d64(contact_weights_p);uint32_t *cids=u32(contact_ids_p);double *meta=d64(meta_p);
  for(uint32_t i=0;i<node_count*3;i++){previous[i]=x[i];node_contact[i/3]=0;velocity[i]*=air;}for(uint32_t i=1;i<node_count*3;i+=3)velocity[i]-=gravity*h;
  for(uint32_t c=0;c<contact_count;c++){cn[c]=0;ci[c]=0;uint32_t o=c*4;for(uint32_t k=0;k<4;k++){uint32_t id=cids[o+k];ci[c]+=velocity[id*3+1]*cw[o+k];}}
  for(uint32_t i=0;i<node_count*3;i++)x[i]+=velocity[i]*h;for(uint32_t e=0;e<element_count;e++)lambdaD[e]=lambdaH[e]=lambdaB[e]=0;for(uint32_t k=0;k<grab_count*3;k++)d64(grab_lambda_p)[k]=0;
  for(uint32_t iteration=0;iteration<iterations;iteration++) {
    if(iteration&1){for(uint32_t n=element_count;n-->0;)solve_element(n,h,shear,bulk,x,inverse_mass,ids,volume,grad,lambdaD,lambdaH,lambdaB);}else{for(uint32_t n=0;n<element_count;n++)solve_element(n,h,shear,bulk,x,inverse_mass,ids,volume,grad,lambdaD,lambdaH,lambdaB);}
    for(uint32_t g=0;g<grab_count;g++)solve_grab(g,h,max_grab_force,x,inverse_mass);solve_contacts(floor,x,inverse_mass,node_contact);
  }
  uint32_t grounded=0;double *denom=d64(contact_denominator_p);
  for(uint32_t c=0;c<contact_count;c++)if(cn[c]>0){grounded=1;double dx=0,dz=0;uint32_t o=c*4;for(uint32_t k=0;k<4;k++){uint32_t id=cids[o+k];dx+=(x[id*3]-previous[id*3])*cw[o+k];dz+=(x[id*3+2]-previous[id*3+2])*cw[o+k];}double tangent=dsqrt(dx*dx+dz*dz),friction=tangent<static_friction*cn[c]?1:dmin(1,dynamic_friction*cn[c]/(tangent+1e-20));for(uint32_t k=0;k<4;k++){uint32_t id=cids[o+k];double s=inverse_mass[id]*cw[o+k]*friction/denom[c];x[id*3]-=dx*s;x[id*3+2]-=dz*s;}}
  meta[14]=preserve_orientation(x,previous,candidate,meta,inverse_mass,ids,grad);
  for(uint32_t i=0;i<node_count*3;i++)velocity[i]=(x[i]-previous[i])/h;
  for(uint32_t c=0;c<contact_count;c++)if(cn[c]>0&&ci[c]<0){double vy=0;uint32_t o=c*4;for(uint32_t k=0;k<4;k++){uint32_t id=cids[o+k];vy+=velocity[id*3+1]*cw[o+k];}double bounce=ci[c]<-.18?-ci[c]*restitution:0,impulse=dmax(0,bounce-vy)/denom[c];for(uint32_t k=0;k<4;k++){uint32_t id=cids[o+k];velocity[id*3+1]+=inverse_mass[id]*cw[o+k]*impulse;}}
  const uint32_t *edges=u32(edge_ids_p);
  for(uint32_t e=0;e<edge_count;e++){uint32_t a=edges[e*2],b=edges[e*2+1],ia=a*3,ib=b*3;double dx=x[ib]-x[ia],dy=x[ib+1]-x[ia+1],dz=x[ib+2]-x[ia+2],len=dsqrt(dx*dx+dy*dy+dz*dz);if(len<1e-9)continue;double nx=dx/len,ny=dy/len,nz=dz/len,relative=(velocity[ib]-velocity[ia])*nx+(velocity[ib+1]-velocity[ia+1])*ny+(velocity[ib+2]-velocity[ia+2])*nz;double impulse=relative*damping/(inverse_mass[a]+inverse_mass[b]),sa=impulse*inverse_mass[a],sb=impulse*inverse_mass[b];velocity[ia]+=sa*nx;velocity[ia+1]+=sa*ny;velocity[ia+2]+=sa*nz;velocity[ib]-=sb*nx;velocity[ib+1]-=sb*ny;velocity[ib+2]-=sb*nz;}
  double cx=0,cy=0,cz=0,energy=0;for(uint32_t i=0;i<node_count;i++){uint32_t j=i*3;double mw=mass[i]/total_mass;cx+=x[j]*mw;cy+=x[j+1]*mw;cz+=x[j+2]*mw;energy+=.5*mass[i]*(velocity[j]*velocity[j]+velocity[j+1]*velocity[j+1]+velocity[j+2]*velocity[j+2]);}
  meta[0]=(double)grounded;meta[3]=cx;meta[4]=cy;meta[5]=cz;meta[6]=energy;
}

__attribute__((export_name("update_surface"))) void update_surface(void) {
  const double *x=d64(x_p),*volume=d64(element_volume_p),*grad=d64(element_gradients_p),*nodal_volume=d64(nodal_volume_p);const uint32_t *ids=u32(element_ids_p);double *nodalF=d64(nodal_f_p),*meta=d64(meta_p);
  for(uint32_t i=0;i<node_count*9;i++)nodalF[i]=0;
  double f[9];for(uint32_t e=0;e<element_count;e++){deformation(e,x,ids,grad,f);for(uint32_t v=0;v<4;v++){uint32_t id=ids[e*4+v],m=id*9;double w=volume[e]/nodal_volume[id];for(uint32_t k=0;k<9;k++)nodalF[m+k]+=f[k]*w;}}
  float *p=f32(surface_positions_p),*n=f32(surface_normals_p),*rest=f32(rest_normals_p);const uint32_t *sids=u32(surface_ids_p);const double *sw=d64(surface_weights_p);
  double minX=1.0/0.0,minY=1.0/0.0,minZ=1.0/0.0,maxX=-1.0/0.0,maxY=-1.0/0.0,maxZ=-1.0/0.0,maxR2=0,cx=meta[3],cy=meta[4],cz=meta[5];
  for(uint32_t vtx=0;vtx<surface_count;vtx++){
    uint32_t j=vtx*4,i=vtx*3,i0=sids[j],i1=sids[j+1],i2=sids[j+2],i3=sids[j+3];double w0=sw[j],w1=sw[j+1],w2=sw[j+2],w3=sw[j+3];uint32_t p0=i0*3,p1=i1*3,p2=i2*3,p3=i3*3;
    double px=x[p0]*w0+x[p1]*w1+x[p2]*w2+x[p3]*w3,py=x[p0+1]*w0+x[p1+1]*w1+x[p2+1]*w2+x[p3+1]*w3,pz=x[p0+2]*w0+x[p1+2]*w1+x[p2+2]*w2+x[p3+2]*w3;p[i]=(float)px;p[i+1]=(float)py;p[i+2]=(float)pz;
    uint32_t m0=i0*9,m1=i1*9,m2=i2*9,m3=i3*9;double a=nodalF[m0]*w0+nodalF[m1]*w1+nodalF[m2]*w2+nodalF[m3]*w3,b=nodalF[m0+1]*w0+nodalF[m1+1]*w1+nodalF[m2+1]*w2+nodalF[m3+1]*w3,c=nodalF[m0+2]*w0+nodalF[m1+2]*w1+nodalF[m2+2]*w2+nodalF[m3+2]*w3,d=nodalF[m0+3]*w0+nodalF[m1+3]*w1+nodalF[m2+3]*w2+nodalF[m3+3]*w3,e=nodalF[m0+4]*w0+nodalF[m1+4]*w1+nodalF[m2+4]*w2+nodalF[m3+4]*w3,ff=nodalF[m0+5]*w0+nodalF[m1+5]*w1+nodalF[m2+5]*w2+nodalF[m3+5]*w3,g=nodalF[m0+6]*w0+nodalF[m1+6]*w1+nodalF[m2+6]*w2+nodalF[m3+6]*w3,h=nodalF[m0+7]*w0+nodalF[m1+7]*w1+nodalF[m2+7]*w2+nodalF[m3+7]*w3,q=nodalF[m0+8]*w0+nodalF[m1+8]*w1+nodalF[m2+8]*w2+nodalF[m3+8]*w3;
    double nx=rest[i],ny=rest[i+1],nz=rest[i+2],ox=(e*q-ff*h)*nx+(ff*g-d*q)*ny+(d*h-e*g)*nz,oy=(c*h-b*q)*nx+(a*q-c*g)*ny+(b*g-a*h)*nz,oz=(b*ff-c*e)*nx+(c*d-a*ff)*ny+(a*e-b*d)*nz,len=dsqrt(ox*ox+oy*oy+oz*oz),inv=len?1/len:1;n[i]=(float)(ox*inv);n[i+1]=(float)(oy*inv);n[i+2]=(float)(oz*inv);
    if(px<minX)minX=px;if(px>maxX)maxX=px;if(py<minY)minY=py;if(py>maxY)maxY=py;if(pz<minZ)minZ=pz;if(pz>maxZ)maxZ=pz;double dx=px-cx,dy=py-cy,dz=pz-cz,r2=dx*dx+dy*dy+dz*dz;if(r2>maxR2)maxR2=r2;
  }
  meta[7]=minX;meta[8]=minY;meta[9]=minZ;meta[10]=maxX;meta[11]=maxY;meta[12]=maxZ;meta[13]=dsqrt(maxR2);
}

import * as THREE from 'three/webgpu';
import { SoftBody } from '../physics/soft-body.js';
import { PHYS } from '../physics/constants.js';
import { loadBabyCage } from '../physics/baby-cage.ts';
import { RefractiveLightField } from '../graphics/refractive-light.js';
import { Baby, ABSORPTION } from '../graphics/baby.ts';
import { loadEnvironment } from '../graphics/environment.ts';
import { makeTable } from '../graphics/table.ts';
import { Locomotion } from './locomotion.ts';
import { Input } from './input.ts';
import { JellySound } from './sound.ts';
import { createRenderer, resizeView } from '../graphics/renderer.ts';
import { OpticalTransport } from '../graphics/transport.ts';
import { createComposite } from '../graphics/composite.ts';
import { FixedStepper } from './fixed-step.ts';
import { Playground } from '../multiplayer/playground.ts';
import { appearanceAbsorption } from '../multiplayer/appearance.ts';
import { Facilities } from './facilities.ts';
import { SwingFacility } from './swing-facility.ts';
import { FacilityShadows } from '../graphics/facility-shadows.ts';
import { TrampolineFacility } from './trampoline-facility.ts';

export async function startGame(stage:(s:string)=>void,fail:(e:unknown)=>void) {
  const probe=import.meta.env.DEV&&new URLSearchParams(location.search).has('profile')?(await import('./performance-probe.ts')).createProbe():null;
  stage('Starting WebGPU');
  const renderer=await createRenderer(fail);
  document.querySelector('#viewport')!.appendChild(renderer.domElement);
  // Construct audio before the remaining async scene work so the first mobile
  // gesture can unlock Web Audio even while assets and shaders are settling.
  const sound=new JellySound();
  const scene=new THREE.Scene();
  scene.background=new THREE.Color('#e8d9c3');scene.fog=new THREE.Fog('#e8d9c3',2,12);
  const camera=new THREE.PerspectiveCamera(36,1,.001,40);
  camera.position.set(.082,.126,.19);
  stage('Reading the light');
  const environment=await loadEnvironment(renderer,scene);
  stage('Making a little jelly');
  const body=new SoftBody(await loadBabyCage());
  const baby=new Baby(body);scene.add(baby.group);
  const optics=new RefractiveLightField(body.cage.opticalSurface,environment.incoming,ABSORPTION);
  const facilityShadows=new FacilityShadows(environment.incoming);
  const table=await makeTable(optics,environment,facilityShadows);scene.add(table.mesh);
  const composite=createComposite(renderer,scene,camera);
  const rig=new Locomotion(body);
  let playground:Playground|undefined;
  const facilities=new Facilities();
  facilities.add(new SwingFacility(scene,body,facilityShadows,sound.facility));
  facilities.add(new TrampolineFacility(scene,body,facilityShadows,sound.facility));
  rig.onContact=(speed,foot)=>sound.contact(speed,foot);
  const physicsClock=new FixedStepper(PHYS.step);
  let lastTime=0,disposed=false;
  const reset=()=>{
    sound.stopFacilities();facilities.reset();input.recenter();body.reset();
    baby.resetFace();physicsClock.reset();playground?.reset();
  };
  const input=new Input(camera,renderer.domElement,body,baby.mesh,rig,sound,reset);
  input.bodyControlled=()=>!!facilities.active;
  input.facilityCameraDistance=()=>facilities.active?.cameraDistance;
  facilities.onInteract=()=>{input.clear();rig.reset();void sound.unlock().catch(()=>{});};
  const transport=new OpticalTransport(optics,body,camera,environment.incoming,fail);
  const resize=()=>resizeView(renderer,camera,input.controls);
  let resizeFrame=0;
  const resizeObserver=new ResizeObserver(()=>{
    cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(resize);
  });
  resizeObserver.observe(document.querySelector('#viewport')!);resize();
  document.querySelector('#reset')!.addEventListener('click',reset);
  document.querySelector('#sound')!.addEventListener('click',event=>{
    const muted=sound.toggle(),button=document.querySelector('#sound')!;
    button.setAttribute('aria-pressed',String(muted));button.setAttribute('aria-label',muted?'Enable sound':'Mute sound');
    button.classList.toggle('muted',muted);void sound.unlock().catch(()=>{});
    if((event as MouseEvent).detail>0)(event.currentTarget as HTMLButtonElement).blur();
  });
  stage('Settling in');
  // Let contact establish itself before displaying the first frame.
  for(let i=0;i<80;i++){rig.step(PHYS.step);body.step(PHYS.step);}
  body.updateSurface();baby.update();input.update(1);
  facilityShadows.update(renderer);
  optics.update(renderer,body,true);
  await transport.update();
  playground=new Playground(scene,body,baby,input,facilities,palette=>{baby.setAppearance(palette);optics.setAbsorption(appearanceAbsorption(palette));},fail);
  stage('Compiling the material');
  await renderer.compileAsync(scene,camera);
  stage('Drawing the first frame');
  composite.render();
  // Fence first-frame GPU work so validation/OOM cannot masquerade as a successful boot.
  const backend=renderer.backend as unknown as {device:GPUDevice};
  await backend.device.queue.onSubmittedWorkDone();
  playground.start();
  lastTime=performance.now();
  const frame=(time:number)=>{
    if(disposed)return;
    try {
      probe?.begin(Math.max(0,(time-lastTime)/1000));
      const dt=Math.min(.05,Math.max(0,(time-lastTime)/1000));lastTime=time;
      if(document.hidden){physicsClock.reset();return;}
      physicsClock.advance(dt,()=>{
        input.step(PHYS.step);facilities.step(PHYS.step);
        if(!facilities.active)rig.step(PHYS.step);
        body.step(PHYS.step);facilities.afterStep();input.afterPhysicsStep();
        if(!facilities.active)rig.afterStep();
      });
      probe?.mark('physics');
      playground?.update(dt);
      probe?.mark('visitors');
      if(body.surfaceDirty) {
        if(!body.isFinite())throw new Error('The soft-body simulation produced an invalid state');
        body.updateSurface();
      }
      probe?.mark('surface');
      facilities.update();baby.update(dt,facilities.active?.laughing??false);
      facilityShadows.update(renderer);
      probe?.mark('face');
      input.update(dt);
      sound.listen(camera);
      transport.follow();
      optics.update(renderer,body);
      table.mesh.position.x=body.center.x;table.mesh.position.z=body.center.z;
      void transport.update().catch(fail);
      probe?.mark('optics');
      composite.render();
      probe?.mark('render');probe?.end();
    }catch(error){fail(error);}
  };
  await renderer.setAnimationLoop(frame);
  const dispose=()=>{
    if(disposed)return;disposed=true;probe?.dispose();
    void renderer.setAnimationLoop(null);input.dispose();sound.dispose();transport.dispose();resizeObserver.disconnect();cancelAnimationFrame(resizeFrame);
    playground?.dispose();facilities.dispose();facilityShadows.dispose();
    composite.dispose();baby.dispose();table.dispose();environment.dispose();optics.dispose();renderer.dispose();
  };
  window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();});
  if(import.meta.hot)import.meta.hot.dispose(dispose);
  return {stop:()=>{
    disposed=true;input.clear();playground?.dispose();facilities.dispose();facilityShadows.dispose();
    sound.dispose();transport.dispose();void renderer.setAnimationLoop(null);
  }};
}

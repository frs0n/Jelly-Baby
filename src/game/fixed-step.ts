/** Preserve the fixed solver timestep while bounding work after a slow frame. */
export class FixedStepper {
  private accumulator=0;
  readonly step:number;
  constructor(step:number){this.step=step;}
  advance(dt:number,simulate:()=>void,now:()=>number=performance.now.bind(performance)) {
    this.accumulator+=Math.min(.05,Math.max(0,dt));
    const started=now();let steps=0;
    while(this.accumulator>=this.step&&steps<6) {
      simulate();this.accumulator-=this.step;steps++;
      if(now()-started>=8)break;
    }
    // Discard overload backlog rather than multiply next frame's work. Never
    // enlarge the physics timestep, which would change the material response.
    if(this.accumulator>=this.step)this.accumulator%=this.step;
    return steps;
  }
  reset(){this.accumulator=0;}
}

/** Preserve the fixed solver timestep while bounding work after a slow frame. */
const monotonicNow=()=>performance.now();

export class FixedStepper {
  private accumulator=0;
  readonly step:number;
  constructor(step:number){this.step=step;}
  advance(dt:number,simulate:()=>void,budgetMs=8,now:()=>number=monotonicNow) {
    this.accumulator+=Math.min(.05,Math.max(0,dt));
    const started=now();let steps=0;
    while(this.accumulator>=this.step&&steps<6) {
      simulate();this.accumulator-=this.step;steps++;
      // An active grab can opt out of the wall-clock cutoff. The independent
      // six-step cap still prevents a catch-up spiral, while the pointer never
      // loses normal 240 Hz solver samples merely because one frame was busy.
      if(Number.isFinite(budgetMs)&&now()-started>=budgetMs)break;
    }
    // Discard overload backlog rather than multiply next frame's work. Never
    // enlarge the physics timestep, which would change the material response.
    if(this.accumulator>=this.step)this.accumulator%=this.step;
    return steps;
  }
  reset(){this.accumulator=0;}
}

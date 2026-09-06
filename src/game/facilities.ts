export interface Facility {
  readonly id:string;
  readonly label:string;
  readonly active:boolean;
  /** Distance to an available interaction, or Infinity when unavailable. */
  readonly interactionDistance:number;
  readonly laughing?:boolean;
  readonly cameraDistance?:number;
  interact():boolean;
  step(h:number):void;
  afterStep?():void;
  update():void;
  reset():void;
  dispose():void;
}

/** One interaction owner and one contextual affordance, shared by every facility. */
export class Facilities {
  private readonly items:Facility[]=[];
  private readonly abort=new AbortController();
  private readonly prompt=document.createElement('div');
  private readonly hint=document.createElement('span');
  private readonly button=document.createElement('button');
  onInteract:()=>void=()=>{};
  constructor() {
    this.prompt.className='facility-prompt';this.prompt.hidden=true;
    this.hint.className='facility-hint';this.hint.setAttribute('role','status');
    this.button.className='facility-button';this.button.type='button';
    this.prompt.append(this.hint,this.button);document.querySelector('#app')!.append(this.prompt);
    const signal=this.abort.signal;
    this.button.addEventListener('click',()=>this.interact(),{signal});
    window.addEventListener('keydown',event=>{
      if(event.code!=='KeyE'||event.repeat||(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]'))return;
      if(this.candidate){event.preventDefault();this.interact();}
    },{signal});
  }
  add(facility:Facility) {
    if(this.items.some(item=>item.id===facility.id))throw new Error(`Duplicate facility: ${facility.id}`);
    this.items.push(facility);return facility;
  }
  get active() {return this.items.find(item=>item.active);}
  private get candidate() {
    return this.active??this.items.filter(item=>Number.isFinite(item.interactionDistance))
      .sort((a,b)=>a.interactionDistance-b.interactionDistance)[0];
  }
  private interact() {
    if(this.candidate?.interact()){this.onInteract();this.update();}
  }
  step(h:number) {for(const item of this.items)item.step(h);}
  afterStep() {for(const item of this.items)item.afterStep?.();}
  update() {
    for(const item of this.items)item.update();
    const candidate=this.candidate;this.prompt.hidden=!candidate;
    if(!candidate)return;
    const action=candidate.active?`Get Off ${candidate.label}`:`Play ${candidate.label}`;
    const hint=`Press E to ${action}`;
    if(this.hint.textContent!==hint)this.hint.textContent=hint;
    if(this.button.textContent!==action)this.button.textContent=action;
  }
  reset() {for(const item of this.items)item.reset();this.prompt.hidden=true;}
  dispose() {this.abort.abort();this.prompt.remove();for(const item of this.items)item.dispose();}
}

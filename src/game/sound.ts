export class JellySound {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private compressor:DynamicsCompressorNode|null=null;
  muted=false;
  async unlock() {
    if(!this.context) {
      this.context=new AudioContext();
      this.master=this.context.createGain(); this.master.gain.value=this.muted?0:.62;
      this.compressor=this.context.createDynamicsCompressor();
      this.compressor.threshold.value=-14; this.compressor.ratio.value=5;
      this.master.connect(this.compressor).connect(this.context.destination);
    }
    if(this.context.state==='suspended') await this.context.resume();
  }
  toggle() {
    this.muted=!this.muted;
    if(this.context&&this.master) this.master.gain.setTargetAtTime(this.muted?0:.62,this.context.currentTime,.025);
    return this.muted;
  }
  contact(speed:number,foot:boolean) {
    const ctx=this.context, out=this.master;
    if(!ctx||!out||ctx.state!=='running'||this.muted) return;
    const t=ctx.currentTime, strength=Math.min(1,speed/.8);
    // Damped wet membrane modes, plus a brief filtered surface-contact transient.
    const base=(foot?190:125)+Math.random()*18;
    for(const [ratio,level,decay] of [[1,.28,.15],[1.63,.12,.095],[2.7,.045,.04]]) {
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.type='sine'; osc.frequency.setValueAtTime(base*ratio*(1+strength*.9),t);
      osc.frequency.exponentialRampToValueAtTime(base*ratio*.65,t+.07);
      gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(level*(.14+strength),t+.003);
      gain.gain.exponentialRampToValueAtTime(.0001,t+decay*(1+strength));
      osc.connect(gain).connect(out);osc.start(t);osc.stop(t+.35);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};
    }
    const buffer=ctx.createBuffer(1,Math.floor(ctx.sampleRate*.06),ctx.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.exp(-i/(ctx.sampleRate*.009));
    const noise=ctx.createBufferSource(), filter=ctx.createBiquadFilter(), gain=ctx.createGain();
    noise.buffer=buffer;filter.type='bandpass';filter.frequency.value=foot?950:620;filter.Q.value=1.5;
    gain.gain.value=.10*strength;noise.connect(filter).connect(gain).connect(out);noise.start(t);
    noise.onended=()=>{noise.disconnect();filter.disconnect();gain.disconnect();};
  }
  dispose() { void this.context?.close(); }
}

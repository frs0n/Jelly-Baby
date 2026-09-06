export type Appearance={primary:string;secondary:string;angle:number};
function hueColor(h:number,s:number,l:number) {
  const a=s*Math.min(l,1-l);
  const channel=(n:number)=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
/** A continuous palette space, always using two distinct hues. */
export function paletteFromDigest(digest:Uint8Array):Appearance {
  const hue=(digest[0]*256+digest[1])/65536*360;
  const saturation=.48+digest[2]/255*.16,lightness=.82+digest[3]/255*.06;
  const offset=(digest[4]%2?1:-1)*(35+digest[5]/255*35);
  return {primary:hueColor(hue,saturation,lightness),secondary:hueColor((hue+offset+360)%360,saturation,.85),angle:(digest[6]/255-.5)*1.5};
}
export function appearanceAbsorption(p:Appearance):[number,number,number] {
  const a=parseInt(p.primary.slice(1),16),b=parseInt(p.secondary.slice(1),16);
  return [16,8,0].map(shift=>{const value=(((a>>shift)&255)+((b>>shift)&255))/510;return 3+(1-value)*100;}) as [number,number,number];
}


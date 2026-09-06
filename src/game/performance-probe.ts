/** Opt-in development instrumentation; stripped out of production builds. */
export function createProbe() {
  const panel=document.createElement('aside');
  panel.style.cssText='position:fixed;left:8px;top:150px;z-index:1000;max-width:430px;padding:10px;background:#fffE;color:#111;font:12px monospace;pointer-events:auto';
  const button=document.createElement('button');button.textContent='Measure 5 seconds';
  const report=document.createElement('pre');report.textContent='Ready to measure';
  panel.append(button,report);document.body.append(panel);
  let until=0,rows:Record<string,number>[]=[],row:Record<string,number>={},last=0;
  button.onclick=()=>{rows=[];until=performance.now()+5000;report.textContent='Measuring…';};
  return {
    begin(dt:number){row={interval:dt*1000};last=performance.now();},
    mark(name:string){const now=performance.now();row[name]=now-last;last=now;},
    end(){
      if(!until)return;rows.push(row);
      if(performance.now()<until)return;until=0;
      const keys=Object.keys(row),stats=Object.fromEntries(keys.map(key=>{const a=rows.map(r=>r[key]).sort((a,b)=>a-b);return [key,{mean:+(a.reduce((s,v)=>s+v,0)/a.length).toFixed(2),p95:+a[Math.floor(a.length*.95)].toFixed(2)}];}));
      report.textContent=JSON.stringify({frames:rows.length,...stats},null,2);
    },
    dispose(){panel.remove();},
  };
}

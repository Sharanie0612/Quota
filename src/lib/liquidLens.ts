export type LensBox = {x:number;y:number;width:number;height:number};
const active = new Map<HTMLElement,()=>void>();

export function cancelLiquidLenses(){for(const stop of [...active.values()])stop();}
export function cancelLiquidLens(element:HTMLElement){active.get(element)?.();}
export function readLiquidLens(host:HTMLElement):LensBox|null {
  const lens=host.querySelector<HTMLElement>(':scope > .motion-highlight');
  if(!lens)return null;
  const a=lens.getBoundingClientRect(),b=host.getBoundingClientRect();
  return a.width>0&&a.height>0?{x:a.left-b.left-host.clientLeft,y:a.top-b.top-host.clientTop,width:a.width,height:a.height}:null;
}

/** Only the optical selection moves. Labels, hit targets and layout stay fixed. */
export function moveLiquidLens(host:HTMLElement,from:LensBox|null,to:LensBox){
  const lens=host.querySelector<HTMLElement>(':scope > .motion-highlight');
  if(!lens)return;
  cancelLiquidLens(lens);
  if(!from||document.documentElement.dataset.glass!=='on'||document.hidden||!document.hasFocus()
    ||matchMedia('(prefers-reduced-motion: reduce)').matches||matchMedia('(forced-colors: active)').matches)return;
  const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);
  if(distance<1)return;
  const horizontal=Math.abs(dx)>Math.abs(dy),stretch=Math.min(14,distance*.12),overshoot=Math.min(3,distance*.04);
  const transition=lens.style.transition,radius=getComputedStyle(lens).borderRadius;
  lens.style.transition='none';
  const pose=(box:LensBox)=>({transform:`translate(${box.x}px,${box.y}px)`,width:box.width+'px',height:box.height+'px'});
  const middle={x:from.x+dx*.35,y:from.y+dy*.35,width:from.width+(to.width-from.width)*.35,height:from.height+(to.height-from.height)*.35};
  if(horizontal){middle.width+=stretch;middle.x-=stretch/2;middle.height*=.97;}
  else{middle.height+=stretch;middle.y-=stretch/2;middle.width*=.985;}
  const beyond={...to,x:to.x+dx/distance*overshoot,y:to.y+dy/distance*overshoot};
  const animation=lens.animate([
    {...pose(from),borderRadius:radius,offset:0,easing:'cubic-bezier(.2,.7,.25,1)'},
    {...pose(middle),borderRadius:Math.min(to.height,to.width)*.48+'px',offset:.26,easing:'cubic-bezier(.2,.7,.25,1)'},
    {...pose(beyond),borderRadius:radius,offset:.72,easing:'cubic-bezier(.2,.7,.25,1)'},
    {...pose(to),borderRadius:radius,offset:1},
  ],{duration:440,easing:'linear',fill:'both'});
  animation.id='quota-liquid-selection';
  const stop=()=>{
    animation.onfinish=null;animation.oncancel=null;animation.cancel();
    lens.style.transition=transition;
    if(active.get(lens)===stop)active.delete(lens);
  };
  active.set(lens,stop);animation.onfinish=stop;animation.oncancel=stop;
}

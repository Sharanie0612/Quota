import {useEffect,useLayoutEffect,useRef} from 'react';
import {useAppearance} from './appearance';
const useBrowserLayoutEffect=typeof window==='undefined'?useEffect:useLayoutEffect;

/** Measure one selection surface; navigation and segmented controls share it. */
export function useSlidingHighlight<T extends HTMLElement>(value:string) {
  const container=useRef<T>(null);
  const appearance=useAppearance(),previous=useRef(value),animation=useRef<Animation|null>(null),interrupted=useRef<DOMRect|null>(null);
  const reduced=appearance.reducedMotion||(appearance.glass&&appearance.reduceEffects);
  useBrowserLayoutEffect(()=>{
    const host=container.current;
    if(!host)return;
    const selectionChanged=previous.current!==value;previous.current=value;
    const measure=(animate=false)=>{
      const active=host.querySelector<HTMLElement>('[data-motion-active="true"]');
      const highlight=host.querySelector<HTMLElement>(':scope > .motion-highlight');
      if(!active||!highlight)return;
      const before=interrupted.current??highlight.getBoundingClientRect(),bounds=host.getBoundingClientRect();interrupted.current=null;
      animation.current?.cancel();animation.current=null;
      for(const [key,number] of Object.entries({x:active.offsetLeft,y:active.offsetTop,width:active.offsetWidth,height:active.offsetHeight}))host.style.setProperty('--highlight-'+key,number+'px');
      if(!animate||before.width<1)return;
      let frames:Keyframe[],duration:number;
      if(reduced){frames=[{opacity:.25},{opacity:1}];duration=140;}
      else{
        const x=before.left-bounds.left,y=before.top-bounds.top,tx=active.offsetLeft,ty=active.offsetTop;
        const start={transform:`translate(${x}px,${y}px)`,width:before.width+'px',height:before.height+'px'};
        const end={transform:`translate(${tx}px,${ty}px)`,width:active.offsetWidth+'px',height:active.offsetHeight+'px'};
        if(appearance.material==='liquid'){
          const dx=tx-x,dy=ty-y;
          frames=[{...start,offset:0},{transform:`translate(${x+dx*.74}px,${y+dy*.74}px) scale(${1+Math.min(.06,Math.abs(dx)/1600)},${1+Math.min(.12,Math.abs(dy)/1200)})`,width:active.offsetWidth+'px',height:active.offsetHeight+'px',offset:.5},{...end,transform:`translate(${tx+dx*.018}px,${ty+dy*.018}px)`,offset:.79},{...end,offset:1}];duration=340;
        }else{frames=[start,end];duration=180;}
      }
      const next=highlight.animate(frames,{duration,easing:'cubic-bezier(.2,.7,.2,1)'});animation.current=next;
      next.onfinish=()=>{if(animation.current===next)animation.current=null;};
    };
    measure(selectionChanged);
    // The first ResizeObserver delivery is not a resize; do not cancel a fresh selection.
    const geometry=()=>{const selected=host.querySelector<HTMLElement>('[data-motion-active="true"]');return [host.offsetWidth,host.offsetHeight,selected?.offsetLeft,selected?.offsetTop,selected?.offsetWidth,selected?.offsetHeight].join(':');};
    let signature=geometry();
    const observer=new ResizeObserver(()=>{const next=geometry();if(next!==signature){signature=next;measure();}});
    observer.observe(host);
    host.querySelectorAll<HTMLElement>('[data-motion-active]').forEach(child=>observer.observe(child));
    const settle=()=>{animation.current?.cancel();animation.current=null;};
    window.addEventListener('blur',settle);window.addEventListener('quota-material-reset',settle);
    return()=>{if(animation.current)interrupted.current=host.querySelector<HTMLElement>(':scope > .motion-highlight')?.getBoundingClientRect()??null;observer.disconnect();settle();window.removeEventListener('blur',settle);window.removeEventListener('quota-material-reset',settle);};
  },[value,reduced,appearance.material]);
  return container;
}

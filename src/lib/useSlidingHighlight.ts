import {useEffect,useLayoutEffect,useRef} from 'react';
const useBrowserLayoutEffect=typeof window==='undefined'?useEffect:useLayoutEffect;

/** Measure one selection surface; navigation and segmented controls share it. */
export function useSlidingHighlight<T extends HTMLElement>(value:string) {
  const container=useRef<T>(null);
  useBrowserLayoutEffect(()=>{
    const host=container.current;
    if(!host)return;
    const measure=()=>{
      const active=host.querySelector<HTMLElement>('[data-motion-active="true"]');
      if(!active)return;
      for(const [key,number] of Object.entries({x:active.offsetLeft,y:active.offsetTop,width:active.offsetWidth,height:active.offsetHeight}))host.style.setProperty('--highlight-'+key,number+'px');
    };
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(host);
    host.querySelectorAll<HTMLElement>('[data-motion-active]').forEach(child=>observer.observe(child));
    return()=>observer.disconnect();
  },[value]);
  return container;
}

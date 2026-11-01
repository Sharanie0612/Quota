import {useEffect,useRef} from 'react';
import {getCurrentWindow} from '@tauri-apps/api/window';

const surfaces='.nav-item,.seg button,.btn,.sidebar-toggle,.workspace-tools button,.material-plane';
type Point={element:Element;x:number;y:number};

/** One frame per input; the light lives inside its target and never moves content. */
export function useMaterialLight(enabled:boolean,resetKey:string){
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const root=container.current;
    if(!root||!enabled)return;
    let frame=0,point:Point|null=null,active:HTMLElement|null=null,pressed:HTMLElement|null=null,rim:HTMLElement|null=null,disposed=false,nativeFocused=true;
    const fading=new Map<HTMLElement,ReturnType<typeof setTimeout>>();
    const host=(element:Element|null)=>{
      const result=element?.closest<HTMLElement>(surfaces);
      return result&&root.contains(result)&&!result.matches(':disabled')?result:null;
    };
    const removeCoordinates=(element:HTMLElement)=>{
      element.style.removeProperty('--light-x');element.style.removeProperty('--light-y');element.removeAttribute('data-light-pressed');
    };
    const release=(element:HTMLElement,hard:boolean)=>{
      clearTimeout(fading.get(element));fading.delete(element);element.removeAttribute('data-light-active');
      if(hard){element.setAttribute('data-light-suspended','true');removeCoordinates(element);}
      else fading.set(element,setTimeout(()=>{fading.delete(element);removeCoordinates(element);},180));
    };
    const reset=()=>{
      cancelAnimationFrame(frame);frame=0;point=null;
      rim?.style.removeProperty('--rim-angle');rim?.removeAttribute('data-rim-active');rim=null;
      pressed?.removeAttribute('data-light-pressed');pressed=null;
      if(active)release(active,true);active=null;
      for(const element of [...fading.keys()])release(element,true);
    };
    const paint=()=>{
      frame=0;
      if(disposed||!nativeFocused||document.hidden||document.documentElement.dataset.material!=='liquid'||document.documentElement.dataset.motion==='reduced'){reset();return;}
      const focused=document.activeElement instanceof Element&&document.activeElement.matches(':focus-visible')?host(document.activeElement):null;
      const target=focused??(point?host(point.element):null);
      if(active&&active!==target)release(active,false);
      active=target;
      const plane=target?.closest<HTMLElement>('.material-plane')??null;
      if(rim!==plane){rim?.style.removeProperty('--rim-angle');rim?.removeAttribute('data-rim-active');rim=plane;}
      if(!target)return;
      clearTimeout(fading.get(target));fading.delete(target);
      const rect=target.getBoundingClientRect();
      if(rect.width<=0||rect.height<=0){reset();return;}
      const x=focused?rect.width/2:Math.max(0,Math.min(rect.width,point!.x-rect.left));
      const y=focused?rect.height/2:Math.max(0,Math.min(rect.height,point!.y-rect.top));
      target.style.setProperty('--light-x',x+'px');target.style.setProperty('--light-y',y+'px');
      if(rim){const r=rim.getBoundingClientRect(),rx=(focused?rect.left+x:point!.x)-r.left-r.width/2,ry=(focused?rect.top+y:point!.y)-r.top-r.height/2;rim.style.setProperty('--rim-angle',(Math.atan2(ry,rx)*180/Math.PI+90)+'deg');rim.setAttribute('data-rim-active','true');}
      target.removeAttribute('data-light-suspended');target.setAttribute('data-light-active','true');
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(paint);};
    const move=(event:PointerEvent)=>{
      if(event.pointerType==='touch'||!(event.target instanceof Element))return;
      point={element:event.target,x:event.clientX,y:event.clientY};schedule();
    };
    const leave=()=>{point=null;schedule();};
    const down=(event:PointerEvent)=>{move(event);pressed?.removeAttribute('data-light-pressed');pressed=host(event.target instanceof Element?event.target:null);pressed?.setAttribute('data-light-pressed','true');};
    const up=()=>{pressed?.removeAttribute('data-light-pressed');pressed=null;};
    const focus=()=>{point=null;schedule();};
    const visibility=()=>{if(document.hidden){reset();window.dispatchEvent(new Event('quota-material-reset'));}};
    root.addEventListener('pointermove',move,{passive:true});
    root.addEventListener('pointerdown',down,{passive:true});
    root.addEventListener('pointerleave',leave);
    root.addEventListener('focusin',focus);root.addEventListener('focusout',focus);
    root.addEventListener('scroll',reset,true);
    window.addEventListener('pointerup',up);window.addEventListener('pointercancel',reset);
    window.addEventListener('blur',reset);window.addEventListener('resize',reset);
    document.addEventListener('visibilitychange',visibility);
    const observer=new ResizeObserver(reset);
    root.querySelectorAll('.main,.sidebar').forEach(element=>observer.observe(element));
    let stopNative:(()=>void)|undefined;
    try{void getCurrentWindow().onFocusChanged(event=>{nativeFocused=event.payload;reset();if(!nativeFocused)window.dispatchEvent(new Event('quota-material-reset'));}).then(stop=>{if(disposed)stop();else stopNative=stop;}).catch(()=>undefined);}catch{/* Browser preview keeps DOM focus and visibility checks. */}
    return()=>{
      disposed=true;reset();observer.disconnect();stopNative?.();
      root.removeEventListener('pointermove',move);root.removeEventListener('pointerdown',down);root.removeEventListener('pointerleave',leave);
      root.removeEventListener('focusin',focus);root.removeEventListener('focusout',focus);root.removeEventListener('scroll',reset,true);
      window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',reset);window.removeEventListener('blur',reset);window.removeEventListener('resize',reset);document.removeEventListener('visibilitychange',visibility);
    };
  },[enabled,resetKey]);
  return container;
}

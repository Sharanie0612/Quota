// A transient rim on the navigation layer. No animation loop runs while idle.
export function initializeGlassMotion(isEnabled:()=>boolean) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const contrast=matchMedia('(forced-colors: active)');
  const surfaces=new Map<HTMLElement,ReturnType<typeof setTimeout>|null>();
  let pointer:HTMLElement|null=null,focus:HTMLElement|null=null;
  let frame=0,latest:{surface:HTMLElement;x:number;y:number}|null=null;
  const allowed=()=>isEnabled()&&!reduced.matches&&!contrast.matches&&!document.hidden;
  const surfaceFor=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>('.app .sidebar,.app .workspace-toolbar,.app .seg'):null;
  const reset=(surface:HTMLElement)=>{
    const timer=surfaces.get(surface);if(timer)clearTimeout(timer);
    surfaces.delete(surface);
    for(const name of ['--glass-x','--glass-y','--glass-glow'])surface.style.removeProperty(name);
  };
  const refresh=()=>{
    if(allowed())return;
    if(frame)cancelAnimationFrame(frame);
    frame=0;latest=null;pointer=null;focus=null;
    for(const surface of surfaces.keys())reset(surface);
  };
  const show=(surface:HTMLElement,x:number,y:number)=>{
    const timer=surfaces.get(surface);if(timer)clearTimeout(timer);
    surfaces.set(surface,null);
    const rect=surface.getBoundingClientRect();
    surface.style.setProperty('--glass-x',Math.max(0,Math.min(rect.width,x-rect.left))+'px');
    surface.style.setProperty('--glass-y',Math.max(0,Math.min(rect.height,y-rect.top))+'px');
    surface.style.setProperty('--glass-glow','1');
  };
  const showFocus=()=>{
    const element=document.activeElement;
    if(!focus||!(element instanceof HTMLElement)||!element.matches(':focus-visible'))return;
    const rect=element.getBoundingClientRect();show(focus,rect.left+rect.width/2,rect.top+rect.height/2);
  };
  const fade=(surface:HTMLElement|null)=>{
    if(!surface)return;
    if(surface===focus){showFocus();return;}
    const timer=surfaces.get(surface);if(timer)clearTimeout(timer);
    surface.style.setProperty('--glass-glow','0');
    // Keep the last light position while it fades; reset only after it is gone.
    surfaces.set(surface,setTimeout(()=>reset(surface),220));
  };
  document.addEventListener('pointermove',event=>{
    if(!allowed()||event.pointerType==='touch')return;
    const surface=surfaceFor(event.target);if(!surface)return;
    if(pointer!==surface){const previous=pointer;pointer=surface;fade(previous);}
    latest={surface,x:event.clientX,y:event.clientY};if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;const point=latest;latest=null;
      if(point&&point.surface===pointer&&point.surface.isConnected&&allowed())show(point.surface,point.x,point.y);
    });
  },{passive:true});
  document.addEventListener('pointerout',event=>{
    const surface=surfaceFor(event.target);
    if(surface===pointer&&surface&&!(event.relatedTarget instanceof Node&&surface.contains(event.relatedTarget))){pointer=null;fade(surface);}
  },{passive:true});
  document.addEventListener('focusin',event=>{
    const element=event.target,previous=focus;
    focus=allowed()&&element instanceof Element&&element.matches(':focus-visible')?surfaceFor(element):null;
    if(previous!==focus&&previous!==pointer)fade(previous);
    if(focus)showFocus();
  });
  document.addEventListener('focusout',()=>{
    queueMicrotask(()=>{
      if(!focus)return;
      const active=document.activeElement;
      if(active instanceof Element&&focus.contains(active)&&active.matches(':focus-visible'))return;
      const previous=focus;focus=null;if(previous!==pointer)fade(previous);
    });
  });
  const clear=()=>{
    if(frame)cancelAnimationFrame(frame);
    frame=0;latest=null;pointer=null;focus=null;
    for(const surface of surfaces.keys())reset(surface);
  };
  window.addEventListener('blur',clear);
  document.addEventListener('visibilitychange',refresh);
  reduced.addEventListener('change',refresh);contrast.addEventListener('change',refresh);
  return {refresh};
}

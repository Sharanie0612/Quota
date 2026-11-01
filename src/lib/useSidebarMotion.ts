import {useLayoutEffect,useRef} from 'react';
/** Resize once, then animate position on the compositor. Charts do not receive
 * a different width on every animation frame. Capture supports mid-flight reversal. */
export function useSidebarMotion(collapsed:boolean,reducedMotion=false,reducedEffects=false){
  const ref=useRef<HTMLElement>(null),before=useRef<DOMRect|null>(null),animation=useRef<Animation|null>(null);
  const capture=()=>{before.current=ref.current?.getBoundingClientRect()??null;animation.current?.cancel();};
  useLayoutEffect(()=>{
    animation.current?.cancel();animation.current=null;
    const node=ref.current,old=before.current;before.current=null;
    if(!node||!old||reducedMotion)return;
    const delta=old.left-node.getBoundingClientRect().left;
    if(Math.abs(delta)<1)return;
    const next=node.animate([{transform:`translateX(${delta}px)`},{transform:'translateX(0)'}],{duration:reducedEffects?120:260,easing:'cubic-bezier(.2,.8,.2,1)'});
    animation.current=next;next.onfinish=()=>{if(animation.current===next)animation.current=null;};
    return()=>next.cancel();
  },[collapsed,reducedMotion,reducedEffects]);
  return {ref,capture};
}

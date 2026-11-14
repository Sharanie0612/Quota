import {useLayoutEffect,useRef} from 'react';
import {motion} from './motion';
/** Resize once, then animate position on the compositor. Charts do not receive
 * a different width on every animation frame. Capture supports mid-flight reversal. */
export function useSidebarMotion(collapsed:boolean,reducedMotion=false,reducedEffects=false){
  const ref=useRef<HTMLElement>(null),before=useRef<DOMRect|null>(null),animation=useRef<Animation|null>(null);
  const capture=()=>{before.current=ref.current?.getBoundingClientRect()??null;animation.current?.cancel();};
  useLayoutEffect(()=>{
    animation.current?.cancel();animation.current=null;
    const node=ref.current,old=before.current;before.current=null;
    if(!node||!old)return;
    if(reducedMotion||reducedEffects){
      const next=node.animate([{opacity:.7},{opacity:1}],{duration:motion.fast,easing:'ease-out'});
      animation.current=next;return()=>next.cancel();
    }
    const delta=old.left-node.getBoundingClientRect().left;
    if(Math.abs(delta)<1)return;
    const next=node.animate([{transform:`translateX(${delta}px)`},{transform:'translateX(0)'}],{duration:motion.layout,easing:motion.ease});
    animation.current=next;next.onfinish=()=>{if(animation.current===next)animation.current=null;};
    return()=>next.cancel();
  },[collapsed,reducedMotion,reducedEffects]);
  return {ref,capture};
}

import { useEffect, useLayoutEffect, useRef } from "react";
import {cancelLiquidLens,moveLiquidLens,readLiquidLens,type LensBox} from './liquidLens';

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Measure real labels so the selected surface glides across unequal-width tabs. */
export function useSlidingHighlight<T extends HTMLElement>(value: string) {
  const container = useRef<T>(null);
  const interrupted = useRef<LensBox|null>(null);
  const measured = useRef(false);
  const destination = useRef<LensBox|null>(null);
  useBrowserLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => {
      const active = node.querySelector<HTMLElement>('[data-motion-active="true"]');
      if (!active) return;
      const to={x:active.offsetLeft,y:active.offsetTop,width:active.offsetWidth,height:active.offsetHeight};
      const previous=destination.current;
      if(!interrupted.current&&previous&&Object.keys(to).every(key=>to[key as keyof LensBox]===previous[key as keyof LensBox]))return;
      const from=measured.current?(interrupted.current??readLiquidLens(node)):null;
      interrupted.current=null;measured.current=true;destination.current=to;
      node.style.setProperty("--highlight-x", `${active.offsetLeft}px`);
      node.style.setProperty("--highlight-y", `${active.offsetTop}px`);
      node.style.setProperty("--highlight-width", `${active.offsetWidth}px`);
      node.style.setProperty("--highlight-height", `${active.offsetHeight}px`);
      moveLiquidLens(node,from,to);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.querySelectorAll<HTMLElement>('[data-motion-active]').forEach(child => observer.observe(child));
    return () => {
      observer.disconnect();interrupted.current=readLiquidLens(node);
      const lens=node.querySelector<HTMLElement>(':scope > .motion-highlight');if(lens)cancelLiquidLens(lens);
    };
  }, [value]);
  return container;
}

import { useEffect, useLayoutEffect, useRef } from "react";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Measure real labels so the selected surface glides across unequal-width tabs. */
export function useSlidingHighlight<T extends HTMLElement>(value: string) {
  const container = useRef<T>(null);
  useBrowserLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => {
      const active = node.querySelector<HTMLElement>('[data-motion-active="true"]');
      if (!active) return;
      node.style.setProperty("--highlight-x", `${active.offsetLeft}px`);
      node.style.setProperty("--highlight-y", `${active.offsetTop}px`);
      node.style.setProperty("--highlight-width", `${active.offsetWidth}px`);
      node.style.setProperty("--highlight-height", `${active.offsetHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.querySelectorAll<HTMLElement>('[data-motion-active]').forEach(child => observer.observe(child));
    return () => observer.disconnect();
  }, [value]);
  return container;
}

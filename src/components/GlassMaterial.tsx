import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {useAppearance} from '../lib/appearance';
import {lensMap} from '../lib/appearance/lens';

type Image={width:number;height:number;source:string};
const cache=new Map<string,Image>();
const useBrowserLayoutEffect=typeof window==='undefined'?useEffect:useLayoutEffect;

/** Geometry-only maps refract the live backdrop; they never capture app content. */
export function GlassMaterial(){
  const appearance=useAppearance(),ref=useRef<SVGSVGElement>(null),id='quota-lens-'+useId().replace(/:/g,'');
  const [image,setImage]=useState<Image|null>(null);
  const enabled=appearance.material!=='solid';
  useBrowserLayoutEffect(()=>{
    const surface=ref.current?.parentElement;
    if(!surface||!enabled||!/(Chrome|Chromium|Edg)\//.test(navigator.userAgent)||!CSS.supports('backdrop-filter','url(#lens)'))return;
    let frame=0;
    const measure=()=>{
      frame=0;const width=Math.round(surface.offsetWidth),height=Math.round(surface.offsetHeight);
      if(width<2||height<2)return;
      const radius=parseFloat(getComputedStyle(surface).borderTopLeftRadius),key=[width,height,radius].join(':');
      let next=cache.get(key);
      if(!next){
        const map=lensMap(width,height,radius),canvas=document.createElement('canvas');canvas.width=map.width;canvas.height=map.height;
        const context=canvas.getContext('2d');if(!context)return;
        context.putImageData(new ImageData(map.pixels,map.width,map.height),0,0);
        next={width,height,source:canvas.toDataURL()};
        if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(key,next);
      }
      setImage(next);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);observer.observe(surface);measure();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();surface.style.removeProperty('--material-lens');surface.removeAttribute('data-lens');};
  },[enabled]);
  useBrowserLayoutEffect(()=>{
    const surface=ref.current?.parentElement;
    if(surface&&enabled&&image){surface.style.setProperty('--material-lens',`url("#${id}")`);surface.dataset.lens='ready';}
  },[enabled,image,id]);
  return <svg ref={ref} className="material-defs" aria-hidden="true" focusable="false" width="0" height="0"><defs>{enabled&&image&&<filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width={image.width} height={image.height} colorInterpolationFilters="sRGB"><feImage href={image.source} x="0" y="0" width={image.width} height={image.height} preserveAspectRatio="none" result="geometry"/><feDisplacementMap in="SourceGraphic" in2="geometry" scale={appearance.reduceEffects||appearance.reducedMotion?6:26} xChannelSelector="R" yChannelSelector="G"/></filter>}</defs></svg>;
}

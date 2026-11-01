import {useCallback,useEffect,useState} from 'react';
export function useChartSize(width=880,height=580){
  const [node,setNode]=useState<SVGSVGElement|null>(null),[size,setSize]=useState({width,height});
  const ref=useCallback((element:SVGSVGElement|null)=>setNode(element),[]);
  useEffect(()=>{if(!node)return;const update=()=>{const rect=node.getBoundingClientRect();if(rect.width>0&&rect.height>0)setSize(previous=>{const next={width:Math.round(rect.width),height:Math.round(rect.height)};return next.width===previous.width&&next.height===previous.height?previous:next;});};update();const observer=new ResizeObserver(update);observer.observe(node);return()=>observer.disconnect();},[node]);
  return {ref,...size};
}

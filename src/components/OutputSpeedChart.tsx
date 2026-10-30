import {useEffect,useMemo,useRef,useState} from 'react';
import type {OutputSpeedReport} from '../lib/types';
import {speedTimeAxis,speedTimeTicks} from '../lib/outputSpeed';
import {callLayout,nearestCall} from '../lib/outputCalls';
import {useAppearance} from '../lib/appearance';
import {useChartSize} from '../lib/useChartSize';
import {ModelLogo} from './ModelLogo';
export const speedNumber=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:n>0&&n<1?2:1});
export function speedColor(model:string,models:string[]){
  const palette=['var(--chart-2)','var(--chart-1)','var(--chart-3)','var(--chart-4)','var(--chart-5)','var(--chart-rest)'];
  return palette[Math.max(0,[...models].sort().indexOf(model))%palette.length];
}
export function OutputSpeedChart({data,period,onSelectModel}:{data:OutputSpeedReport;period:string;onSelectModel:(model:string)=>void}){
  const size=useChartSize(1000,310),canvas=useRef<HTMLCanvasElement>(null),appearance=useAppearance();
  const [cursor,setCursor]=useState<string|null>(null);
  const layout=useMemo(()=>callLayout(data.calls,size.width,size.height),[data.calls,size.width,size.height]);
  const {points,start,end,ceiling,ticks,left,right,top,bottom}=layout;
  const active=points.find(point=>point.call.id===cursor);
  const x=(time:number)=>left+(time-start)/(end-start)*(right-left);
  const y=(rate:number)=>bottom-rate/ceiling*(bottom-top);
  const models=[...new Set(points.map(p=>p.call.model))];
  const timeAxis=useMemo(()=>speedTimeAxis(start,end,period),[start,end,period]);
  const timeTicks=useMemo(()=>speedTimeTicks(start,end,right-left,timeAxis.spacing).filter((at,i,rows)=>!i||timeAxis.format(at)!==timeAxis.format(rows[i-1])),[start,end,right,left,timeAxis]);
  useEffect(()=>{
    const element=canvas.current;if(!element)return;const context=element.getContext('2d');if(!context)return;
    const contrast=matchMedia('(forced-colors: active)');
    const draw=()=>{
      const ratio=window.devicePixelRatio||1;element.width=size.width*ratio;element.height=size.height*ratio;
      context.scale(ratio,ratio);context.clearRect(0,0,size.width,size.height);
      const styles=getComputedStyle(element),colors=new Map(data.models.map(model=>[model,styles.getPropertyValue(speedColor(model,data.models).slice(4,-1)).trim()]));
      context.strokeStyle=contrast.matches?styles.color:styles.getPropertyValue('--text').trim()||styles.color;context.lineWidth=1.25;
      for(const point of points){context.globalAlpha=.76;context.fillStyle=colors.get(point.call.model)||styles.getPropertyValue('--blue');context.beginPath();context.arc(point.x,point.y,3.2,0,Math.PI*2);context.fill();context.globalAlpha=1;context.stroke();}
    };
    // Media styles settle before painting; a new display needs a new ratio query.
    let frame=0,resolution:MediaQueryList|undefined;
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});};
    const watchRatio=()=>{resolution?.removeEventListener('change',watchRatio);resolution=matchMedia(`(resolution: ${window.devicePixelRatio||1}dppx)`);resolution.addEventListener('change',watchRatio);schedule();};
    contrast.addEventListener('change',schedule);window.addEventListener('resize',schedule);watchRatio();
    return()=>{if(frame)cancelAnimationFrame(frame);resolution?.removeEventListener('change',watchRatio);contrast.removeEventListener('change',schedule);window.removeEventListener('resize',schedule);};
  },[points,size.width,size.height,data.models,appearance]);
  return <div className="speed-plot" data-call-count={points.length} onMouseLeave={()=>setCursor(null)}>
    <div className="speed-call-canvas"><canvas ref={canvas} aria-hidden="true"/>
    <svg ref={size.ref} viewBox={`0 0 ${size.width} ${size.height}`} role="img" tabIndex={0}
      aria-label={`${points.length} 次调用的输出速度，每点一次调用，左右方向键查看`}
      onMouseMove={event=>{const rect=event.currentTarget.getBoundingClientRect();setCursor(nearestCall(points,(event.clientX-rect.left)*size.width/rect.width,(event.clientY-rect.top)*size.height/rect.height)?.call.id??null);}}
      onFocus={()=>setCursor(points[points.length-1]?.call.id??null)} onBlur={()=>setCursor(null)}
      onKeyDown={event=>{if(event.key==='Escape'){setCursor(null);return;}if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const index=Math.max(0,points.findIndex(point=>point.call.id===cursor));setCursor(points[Math.max(0,Math.min(points.length-1,index+(event.key==='ArrowLeft'?-1:1)))]?.call.id??null);}}>
      {ticks.map(value=><g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="speed-grid"/><text x={left-12} y={y(value)+5} textAnchor="end" className="speed-tick">{speedNumber(value)}</text></g>)}
      {timeTicks.map((at,i,rows)=><text key={at} data-time-tick={at} x={x(at)} y={size.height-10} textAnchor={i===0?'start':i===rows.length-1?'end':'middle'} className="speed-tick">{timeAxis.format(at)}</text>)}
      <text x={left} y={top-10} className="speed-tick">tokens/s</text>
      {active&&<circle cx={active.x} cy={active.y} r="6" fill="var(--surface)" stroke="var(--text)" strokeWidth="2"/>}
    </svg></div>
    {active&&<div className="speed-tooltip" role="tooltip" style={{left:Math.max(8,Math.min(size.width-310,active.x-155)),top:active.y<140?150:12}}>
      <b>{new Date(active.call.completedAt).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hourCycle:'h23'})}</b>
      <div><span><i style={{background:speedColor(active.call.model,data.models)}}/>{active.call.model}</span><strong>{speedNumber(active.call.speed)}<small> tokens/s</small></strong><em>{active.call.outputTokens.toLocaleString()} Token · {speedNumber(active.call.durationMs/1000)} 秒</em></div>
    </div>}
    <div className="speed-legend">{models.map(model=><button key={model} onClick={()=>onSelectModel(model)}><i style={{background:speedColor(model,data.models)}}/><ModelLogo name={model} size={19}/>{model}</button>)}</div>
  </div>;
}

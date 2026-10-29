import {useMemo,useState} from 'react';
import type {OutputSpeedPoint,OutputSpeedReport} from '../lib/types';
import {speedBucketLabel,speedSeries,speedTimeTicks,speedValue} from '../lib/outputSpeed';
import {useChartSize} from '../lib/useChartSize';
import {ModelLogo} from './ModelLogo';
export const speedNumber=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:n>0&&n<1?2:1});
export function speedColor(model:string,models:string[]){
  const palette=['var(--chart-2)','var(--chart-1)','var(--chart-3)','var(--chart-4)','var(--chart-5)','var(--chart-rest)'];
  return palette[Math.max(0,[...models].sort().indexOf(model))%palette.length];
}
export function OutputSpeedChart({data,period,onSelectModel}:{data:OutputSpeedReport;period:string;onSelectModel:(model:string)=>void}){
  const size=useChartSize(1000,300);
  const [cursor,setCursor]=useState<number|null>(null);
  const series=useMemo(()=>speedSeries(data.points),[data.points]);
  const times=useMemo(()=>[...new Set(data.points.map(p=>p.timestamp))].sort((a,b)=>a-b),[data.points]);
  const maximum=Math.max(20,...data.points.map(point=>speedValue(point)??0));
  const power=10**Math.floor(Math.log10(maximum/5)),step=([1,2,2.5,5,10].find(value=>value*power>=maximum/5)??10)*power;
  const ceiling=Math.ceil(maximum/step)*step,yTicks=Array.from({length:Math.round(ceiling/step)+1},(_,i)=>i*step);
  const left=60,right=size.width-22,top=26,bottom=size.height-44;
  const grain=data.bucketSeconds*1000;
  const first=times[0]??data.rangeStart,last=times[times.length-1]??data.rangeEnd;
  const start=Math.max(data.rangeStart,first),end=Math.max(start+10_000,Math.min(data.rangeEnd,last+grain));
  const x=(time:number)=>left+Math.max(0,Math.min(1,(time-start)/(end-start)))*(right-left);
  const center=(point:OutputSpeedPoint)=>x(Math.min(end,point.timestamp+grain/2));
  const y=(rate:number)=>bottom-rate/ceiling*(bottom-top);
  const timeLabel=(at:number)=>new Date(at).toLocaleString('zh-CN',period==='today'?{hour:'2-digit',minute:'2-digit'}:end-start<2*86400000?{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}:{month:'2-digit',day:'2-digit'});
  const ticks=speedTimeTicks(start,end,right-left);
  const active=cursor==null?[]:data.points.filter(p=>p.timestamp===cursor);
  const activeX=active.length?center(active[0]):0;
  const move=(clientX:number,rect:DOMRect)=>{
    const at=start+Math.max(0,Math.min(1,(clientX-rect.left-left)/(right-left)))*(end-start)-grain/2;
    const nearest=times.reduce((best,time)=>Math.abs(time-at)<Math.abs(best-at)?time:best,times[0]);
    setCursor(nearest??null);
  };
  return <div className="speed-plot" onMouseLeave={()=>setCursor(null)}>
    <svg ref={size.ref} viewBox={`0 0 ${size.width} ${size.height}`} role="img" tabIndex={0}
      aria-label="按时间统计的平均输出速度，左右方向键查看时段" data-bucket-seconds={data.bucketSeconds}
      onMouseMove={event=>move(event.clientX,event.currentTarget.getBoundingClientRect())}
      onFocus={()=>setCursor(times[times.length-1]??null)} onBlur={()=>setCursor(null)}
      onKeyDown={event=>{if(event.key==='Escape'){setCursor(null);return;}if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const index=Math.max(0,times.indexOf(cursor??times[times.length-1]!));setCursor(times[Math.max(0,Math.min(times.length-1,index+(event.key==='ArrowLeft'?-1:1)))]??null);}}>
      {yTicks.map(value=><g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="speed-grid"/><text x={left-12} y={y(value)+5} textAnchor="end" className="speed-tick">{speedNumber(value)}</text></g>)}
      {ticks.map((at,i)=><text key={at} x={x(at)} y={size.height-10} textAnchor={i===0?'start':i===ticks.length-1?'end':'middle'} className="speed-tick">{timeLabel(at)}</text>)}
      {series.map(s=>{const segments:OutputSpeedPoint[][]=[];for(const point of s.rows){const last=segments[segments.length-1];if(last&&point.timestamp-last[last.length-1].timestamp<=grain)last.push(point);else segments.push([point]);}return <g key={s.model} style={{color:speedColor(s.model,data.models)}}>
        {segments.map((segment,indexSegment)=>{const points=segment.map(point=>({x:center(point),y:y(speedValue(point)!)})),path=points.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ');return <g key={indexSegment}><path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{segment.filter(point=>segment.length===1||cursor===point.timestamp).map(point=><circle key={point.timestamp} cx={center(point)} cy={y(speedValue(point)!)} r={cursor===point.timestamp?5:3.5} fill="var(--surface)" stroke="currentColor" strokeWidth="2.2"/>)}</g>;})}
      </g>;})}
      {!!active.length&&<line x1={activeX} x2={activeX} y1={top} y2={bottom} className="speed-crosshair"/>}
    </svg>
    {!!active.length&&<div className="speed-tooltip" role="tooltip" style={{left:Math.max(8,Math.min(size.width-320,activeX-155)),top:12}}>
      <b>{new Date(cursor!).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:data.bucketSeconds<60?'2-digit':undefined})} · {speedBucketLabel(data.bucketSeconds)}均值</b>
      {active.map(point=><div key={point.model}><span><i style={{background:speedColor(point.model,data.models)}}/>{point.model}</span><strong>{speedNumber(speedValue(point))}<small> tokens/s</small></strong><em>{point.samples} 次输出 · {point.outputTokens.toLocaleString()} Token · {speedNumber(point.durationMs/1000)} 秒</em></div>)}
    </div>}
    <div className="speed-legend">{series.map(s=><button key={s.model} onClick={()=>onSelectModel(s.model)}><i style={{background:speedColor(s.model,data.models)}}/><ModelLogo name={s.model} size={19}/>{s.model}</button>)}</div>
  </div>;
}

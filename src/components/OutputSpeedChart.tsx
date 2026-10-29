import {useMemo,useState} from 'react';
import type {OutputSpeedPoint,OutputSpeedReport} from '../lib/types';
import {speedBucketLabel,speedSeries,speedTimeTicks,speedValue} from '../lib/outputSpeed';
import {useChartSize} from '../lib/useChartSize';
import {ModelLogo} from './ModelLogo';
export const speedNumber=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:1});
export function speedColor(model:string,models:string[]){
  const palette=['var(--chart-1)','var(--chart-3)','var(--chart-2)','var(--chart-4)','var(--chart-5)','var(--chart-rest)'];
  return palette[Math.max(0,[...models].sort().indexOf(model))%palette.length];
}
export function OutputSpeedChart({data,period,onSelectModel}:{data:OutputSpeedReport;period:string;onSelectModel:(model:string)=>void}){
  const size=useChartSize(1000,340);
  const [cursor,setCursor]=useState<number|null>(null);
  const series=useMemo(()=>speedSeries(data.points),[data.points]);
  const times=useMemo(()=>[...new Set(data.points.map(p=>p.timestamp))].sort((a,b)=>a-b),[data.points]);
  const ceiling=Math.max(20,Math.ceil(data.points.reduce((max,p)=>Math.max(max,speedValue(p)??0),0)/20)*20);
  const left=60,right=size.width-22,top=26,bottom=size.height-44;
  const start=data.rangeStart,end=Math.max(start+10_000,data.rangeEnd),grain=data.bucketSeconds*1000;
  const x=(time:number)=>left+Math.max(0,Math.min(1,(time-start)/(end-start)))*(right-left);
  const center=(point:OutputSpeedPoint)=>x(Math.min(end,point.timestamp+grain/2));
  const y=(rate:number)=>bottom-rate/ceiling*(bottom-top);
  const timeLabel=(at:number)=>new Date(at).toLocaleString('zh-CN',period==='live'?{hour:'2-digit',minute:'2-digit'}:period==='today'?{hour:'2-digit',minute:'2-digit'}:{month:'2-digit',day:'2-digit'});
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
      {[0,1,2,3,4].map(i=><g key={i}><line x1={left} x2={right} y1={y(ceiling*i/4)} y2={y(ceiling*i/4)} className="speed-grid"/><text x={left-12} y={y(ceiling*i/4)+5} textAnchor="end" className="speed-tick">{speedNumber(ceiling*i/4)}</text></g>)}
      {ticks.map((at,i)=><text key={at} x={x(at)} y={size.height-10} textAnchor={i===0?'start':i===ticks.length-1?'end':'middle'} className="speed-tick">{timeLabel(at)}</text>)}
      {series.map(s=><g key={s.model} style={{color:speedColor(s.model,data.models)}}>
        <path d={s.rows.map((point,i)=>`${i&&point.timestamp-s.rows[i-1].timestamp<=grain?'L':'M'}${center(point)},${y(speedValue(point)!)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>
        {s.rows.map(point=><circle key={point.timestamp} cx={center(point)} cy={y(speedValue(point)!)} r={cursor===point.timestamp?5:3.5} fill="var(--surface)" stroke="currentColor" strokeWidth="2"/>)}
      </g>)}
      {!!active.length&&<line x1={activeX} x2={activeX} y1={top} y2={bottom} className="speed-crosshair"/>}
    </svg>
    {!!active.length&&<div className="speed-tooltip" role="tooltip" style={{left:Math.max(8,Math.min(size.width-320,activeX-155)),top:12}}>
      <b>{new Date(cursor!).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:data.bucketSeconds<60?'2-digit':undefined})} · {speedBucketLabel(data.bucketSeconds)}均值</b>
      {active.map(point=><div key={point.model}><span><i style={{background:speedColor(point.model,data.models)}}/>{point.model}</span><strong>{speedNumber(speedValue(point))}<small> tokens/s</small></strong><em>{point.samples} 次输出 · {point.outputTokens.toLocaleString()} Token · {speedNumber(point.durationMs/1000)} 秒</em></div>)}
    </div>}
    <div className="speed-legend">{series.map(s=><button key={s.model} onClick={()=>onSelectModel(s.model)}><i style={{background:speedColor(s.model,data.models)}}/><ModelLogo name={s.model} size={19}/>{s.model}</button>)}</div>
  </div>;
}

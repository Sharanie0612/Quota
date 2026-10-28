import { useState } from 'react';
import type { ActivityReport } from '../lib/types';
import { cacheShares, shares, type Share } from '../lib/activityShares';
import { activityFilterLabel } from '../lib/activityModels';
import './activity-shares.css';

const colors=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)','var(--chart-5)','var(--chart-rest)'];
function Donut({title,rows,format,onChoose,cache=false}:{title:string;rows:Share[];format:(n:number)=>string;onChoose?:(key:string)=>void;cache?:boolean}){
  const [active,setActive]=useState<string|null>(null);
  const total=rows.reduce((sum,row)=>sum+row.value,0);let offset=0;
  const focus=rows.find(row=>row.key===active);
  const percentage=(n:number)=>total?(100*n/total).toFixed(1)+'%':'—';
  return <section className="card activity-share"><h3>{title}</h3><div className="activity-donut" onMouseLeave={()=>setActive(null)}><svg viewBox="0 0 180 180" role="img" aria-label={`${title}：${rows.map(row=>`${row.name} ${percentage(row.value)}`).join('；')}`}><circle cx="90" cy="90" r="65" fill="none" stroke="var(--surface-3)" strokeWidth="19"/>{rows.map((row,i)=>{const length=total?row.value/total*100:0,start=offset;offset+=length;return length>0?<circle key={row.key} cx="90" cy="90" r="65" pathLength="100" fill="none" stroke={colors[i]} strokeWidth={active===row.key?23:19} strokeDasharray={`${Math.max(0,length-(length<100?.55:0))} ${100-Math.max(0,length-(length<100?.55:0))}`} strokeDashoffset={-start} transform="rotate(-90 90 90)" onMouseEnter={()=>setActive(row.key)} onFocus={()=>setActive(row.key)} onBlur={()=>setActive(null)} role={onChoose&&row.key!=="__other__"?"button":undefined} tabIndex={onChoose&&row.key!=="__other__"?0:undefined} aria-label={`${row.name} ${percentage(row.value)}`} onClick={()=>{if(row.key!=="__other__")onChoose?.(row.key);}} onKeyDown={event=>{if(onChoose&&row.key!=="__other__"&&["Enter"," "].includes(event.key)){event.preventDefault();onChoose(row.key);}}}><title>{row.name}：{percentage(row.value)} · {new Intl.NumberFormat('zh-CN').format(row.value)} Token</title></circle>:null;})}</svg><div className="activity-donut-center"><b>{focus?percentage(focus.value):cache?percentage(rows[0]?.value??0):format(total)}</b><span>{focus?.name??(cache?'输入缓存命中率':'Token')}</span></div></div>{!total&&<p className="activity-share-empty">暂无数据</p>}</section>;
}
export function ActivityShares({report,format,onModel,onSource,onMetric}:{report:ActivityReport;format:(n:number)=>string;onModel:(key:string)=>void;onSource:(key:string)=>void;onMetric:(key:'cached'|'uncached')=>void}){
  const names:Record<string,string>={codex:'Codex',zcode:'ZCode',harness:'DeepSeek Harness',trae:'Trae'};
  return <div className="activity-shares"><Donut title="来源占比" rows={shares(report.sources,key=>names[key]??key,5)} format={format} onChoose={onSource}/><Donut title="模型占比" rows={shares(report.models,activityFilterLabel,4)} format={format} onChoose={onModel}/><Donut title="输入缓存" rows={cacheShares(report.models)} format={format} cache onChoose={key=>onMetric(key as 'cached'|'uncached')}/></div>;
}

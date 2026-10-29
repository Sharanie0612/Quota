import {useState} from 'react';
import {useChartSize} from '../lib/useChartSize';
import type {UsageBucket} from '../lib/usageAnalytics';
export function UsageAnalysisChart({buckets,currency,metric}:{buckets:UsageBucket[];currency:string;metric:'money'|'tokens'}){
  const size=useChartSize(1000,280),[hover,setHover]=useState<number|null>(null);
  const left=56,right=size.width-18,top=24,bottom=size.height-38;
  const values=buckets.map(row=>metric==='tokens'?row.tokens:row.subscription+row.usage);
  const maximum=Math.max(1,...values),power=10**Math.floor(Math.log10(maximum/4)),step=Math.ceil(maximum/4/power)*power,ceiling=step*4;
  const slot=(right-left)/Math.max(1,buckets.length),bar=Math.min(30,slot*.62);
  const y=(value:number)=>bottom-value/ceiling*(bottom-top),active=hover==null?null:buckets[hover];
  const display=(value:number)=>metric==='tokens'?Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(value):(currency==='CNY'?'¥':'$')+value.toLocaleString('zh-CN',{maximumFractionDigits:2});
  return <div className="usage-analysis-plot" onMouseLeave={()=>setHover(null)}>
    <svg ref={size.ref} viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={metric==='tokens'?'已采集Token随时间变化':'账期费用分摊趋势'} tabIndex={0} onFocus={()=>setHover(buckets.length-1)} onBlur={()=>setHover(null)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setHover(value=>Math.max(0,Math.min(buckets.length-1,(value??buckets.length-1)+(event.key==='ArrowLeft'?-1:1))));}}} onMouseMove={event=>{const rect=event.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(buckets.length-1,Math.floor((event.clientX-rect.left-left)/slot))));}}>
      {[0,1,2,3,4].map(i=><g key={i}><line x1={left} x2={right} y1={y(step*i)} y2={y(step*i)} className="analysis-grid"/><text x={left-10} y={y(step*i)+4} textAnchor="end" className="analysis-tick">{display(step*i)}</text></g>)}
      {buckets.map((row,index)=>{const x=left+slot*(index+.5)-bar/2;return <g key={row.from} opacity={hover==null||hover===index?1:.55}>{metric==='tokens'?<rect x={x} y={y(row.tokens)} width={bar} height={Math.max(0,bottom-y(row.tokens))} rx={Math.min(4,bar/2)} className="analysis-bar-tokens"/>:<><rect x={x} y={y(row.subscription)} width={bar} height={Math.max(0,bottom-y(row.subscription))} rx={Math.min(4,bar/2)} className="analysis-bar-subscription"/><rect x={x} y={y(row.subscription+row.usage)} width={bar} height={Math.max(0,y(row.subscription)-y(row.subscription+row.usage))} rx={Math.min(4,bar/2)} className="analysis-bar-usage"/></>}{index%Math.max(1,Math.ceil(buckets.length/8))===0&&<text x={x+bar/2} y={size.height-10} textAnchor="middle" className="analysis-tick">{row.label}</text>}</g>;})}
    </svg>
    {active&&<div role="tooltip" className="analysis-tooltip" style={{left:Math.max(6,Math.min(size.width-260,left+slot*((hover??0)+.5)-120))}}><b>{active.from}{active.to!==active.from?' — '+active.to:''}</b>{metric==='money'?<><span>订阅分摊<strong>{active.hasSubscription?display(active.subscription):'未记录'}</strong></span><span>按量分摊<strong>{active.hasUsage?display(active.usage):'未记录'}</strong></span></>:<span>已采集Token<strong>{active.tokens.toLocaleString()}</strong></span>}</div>}
    <div className="analysis-legend">{metric==='money'?<><span><i className="subscription"/>订阅费用分摊</span><span><i className="usage"/>按量费用分摊</span></>:<span><i className="tokens"/>已采集Token</span>}</div>
  </div>;
}

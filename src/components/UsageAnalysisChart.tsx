import {useState} from 'react';
import {useChartSize} from '../lib/useChartSize';
import type {UsageBucket} from '../lib/usageAnalytics';
export function UsageAnalysisChart({buckets,currency,metric}:{buckets:UsageBucket[];currency:string;metric:'money'|'tokens'}){
  const size=useChartSize(1000,260),[hover,setHover]=useState<number|null>(null);
  const left=66,right=size.width-18,top=20,bottom=size.height-34;
  const values=buckets.map(row=>metric==='tokens'?row.tokens:row.missingFx?0:row.subscription+row.usage);
  const maximum=Math.max(1,...values),power=10**Math.floor(Math.log10(maximum/4)),step=Math.ceil(maximum/4/power)*power,ceiling=step*4;
  const slot=(right-left)/Math.max(1,buckets.length),bar=Math.max(1,Math.min(24,slot*.6));
  const y=(value:number)=>bottom-value/ceiling*(bottom-top),active=hover==null?null:buckets[hover];
  const display=(value:number)=>metric==='tokens'?Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(value):(currency==='CNY'?'¥':'$')+value.toLocaleString('zh-CN',{maximumFractionDigits:2,notation:value>=10000?'compact':'standard'});
  return <div className="usage-analysis-plot" onMouseLeave={()=>setHover(null)}>
    <svg ref={size.ref} viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={metric==='tokens'?'Token 用量趋势':'人民币支出趋势，费用按账期分摊'} tabIndex={0} onFocus={()=>setHover(buckets.length-1)} onBlur={()=>setHover(null)} onKeyDown={event=>{if(event.key==='Escape'){setHover(null);return;}if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setHover(value=>Math.max(0,Math.min(buckets.length-1,(value??buckets.length-1)+(event.key==='ArrowLeft'?-1:1))));}}} onMouseMove={event=>{const rect=event.currentTarget.getBoundingClientRect();setHover(Math.max(0,Math.min(buckets.length-1,Math.floor((event.clientX-rect.left-left)/slot))));}}>
      {[0,1,2,3,4].map(i=><g key={i}><line x1={left} x2={right} y1={y(step*i)} y2={y(step*i)} className="analysis-grid"/><text x={left-12} y={y(step*i)+4} textAnchor="end" className="analysis-tick">{display(step*i)}</text></g>)}
      {buckets.map((row,index)=>{const x=left+slot*(index+.5)-bar/2;return <g key={row.from} opacity={hover==null||hover===index?1:.5}>{metric==='tokens'?<rect x={x} y={y(row.tokens)} width={bar} height={Math.max(0,bottom-y(row.tokens))} rx={Math.min(3,bar/2)} className="analysis-bar-tokens"/>:row.missingFx?<path d={`M${x},${bottom-3}h${bar}`} stroke="var(--text-3)" strokeDasharray="2 2"><title>等待月均汇率</title></path>:<><rect x={x} y={y(row.subscription)} width={bar} height={Math.max(0,bottom-y(row.subscription))} rx={Math.min(3,bar/2)} className="analysis-bar-subscription"/><rect x={x} y={y(row.subscription+row.usage)} width={bar} height={Math.max(0,y(row.subscription)-y(row.subscription+row.usage))} rx={Math.min(3,bar/2)} className="analysis-bar-usage"/></>}{index%Math.max(1,Math.ceil(buckets.length/7))===0&&<text x={x+bar/2} y={size.height-8} textAnchor="middle" className="analysis-tick">{row.label}</text>}</g>;})}
    </svg>
    {active&&<div role="tooltip" className="analysis-tooltip" style={{left:Math.max(4,Math.min(size.width-256,left+slot*((hover??0)+.5)-120))}}><b>{active.from}{active.to!==active.from?' — '+active.to:''}</b>{metric==='money'?active.missingFx?<span>等待对应月份汇率</span>:<><span>订阅<strong>{active.hasSubscription?display(active.subscription):'未记录'}</strong></span><span>按量<strong>{active.hasUsage?display(active.usage):'未记录'}</strong></span></>:<span>Token<strong>{active.tokens.toLocaleString('zh-CN')}</strong></span>}</div>}
    <div className="analysis-legend">{metric==='money'?<><span><i className="subscription"/>订阅</span><span><i className="usage"/>按量</span><span className="analysis-basis">按账期分摊</span></>:<span><i/>Token</span>}</div>
  </div>;
}

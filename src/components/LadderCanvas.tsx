import {useState} from 'react';
import type {LadderEntry} from '../lib/types';
import {ladderScale,plotPrice,type LadderExchange,type LadderMetric} from '../lib/ladderPlot';
import {plotPriceLabel,scatterClusters} from '../lib/scatterLayout';
import {reasoningLabel} from '../lib/ladderModels';
import {useChartSize} from '../lib/useChartSize';
import {ModelLogo,modelBrand} from './ModelLogo';
type Props={entries:LadderEntry[];domain:string;focused:LadderEntry|null;onFocus:(entry:LadderEntry)=>void;exchange?:LadderExchange|null;metric:LadderMetric;currency:string;highlightBrand:string};
export function LadderCanvas({entries,domain,focused,onFocus,exchange,metric,currency,highlightBrand}:Props){
  const chart=useChartSize(1000,440),[hover,setHover]=useState<string|null>(null),[opened,setOpened]=useState<string|null>(null);
  const bounds={left:54,right:chart.width-30,top:38,bottom:chart.height-64};
  const raw=entries.map(entry=>({entry,id:entry.id,cost:plotPrice(entry,metric,currency,exchange)!,score:entry.rankings[domain].score}));
  const scale=ladderScale(raw,bounds);
  const clusters=scatterClusters(raw.map(point=>({...point,x:scale.x(point.cost),y:scale.y(point.score)})));
  const active=clusters.find(cluster=>cluster.anchor.id===hover),expanded=clusters.find(cluster=>cluster.anchor.id===opened);
  const choose=(cluster:typeof clusters[number])=>{if(cluster.members.length===1)onFocus(cluster.anchor.entry);else setOpened(value=>value===cluster.anchor.id?null:cluster.anchor.id);};
  return <div className="scatter-panel" onKeyDown={event=>{if(event.key==='Escape'){setOpened(null);setHover(null);}}}>
    <svg ref={chart.ref} viewBox={`0 0 ${chart.width} ${chart.height}`} data-plot-width={chart.width} data-plot-height={chart.height} role="group" aria-label={`${currency}统一价格与性能坐标图`}>
      <text x={bounds.left} y="18" className="scatter-axis-title">能力指数 ↑</text>
      {scale.scoreTicks.map(value=><g key={value}><line x1={bounds.left} x2={bounds.right} y1={scale.y(value)} y2={scale.y(value)} className="scatter-grid"/><text x={bounds.left-12} y={scale.y(value)+4} textAnchor="end" className="scatter-tick">{value}</text></g>)}
      {scale.ticks.map(value=><g key={value}><line x1={scale.x(value)} x2={scale.x(value)} y1={bounds.top} y2={bounds.bottom} className="scatter-grid"/><text x={scale.x(value)} y={bounds.bottom+26} textAnchor="middle" className="scatter-tick">{value>0&&value<.001?value.toExponential(0):Number(value.toPrecision(3))}</text></g>)}
      <text x={(bounds.left+bounds.right)/2} y={chart.height-8} textAnchor="middle" className="scatter-axis-title">{metric==='cached'?'缓存命中':metric==='output'?'输出':metric==='input'?'输入':'输入 + 输出'} · {currency==='CNY'?'¥':currency} / {metric==='total'?'百万输入 + 百万输出':'百万 Token'} · 对数刻度 →</text>
      {clusters.map(cluster=>{const {anchor,members}=cluster,selected=members.some(p=>p.id===focused?.id),multiple=members.length>1;
        return <g key={anchor.id} className="scatter-point" role="button" tabIndex={0} aria-pressed={selected||opened===anchor.id}
          data-cost={anchor.cost} data-score={anchor.score} data-plot-x={anchor.x} data-plot-y={anchor.y} data-profile-ids={members.map(p=>p.id).join('|')}
          data-members={JSON.stringify(members.map(({id,cost,score,x,y})=>({id,cost,score,x,y})))}
          aria-label={multiple?`附近 ${members.length} 款模型，点击选择`:`${anchor.entry.name}，能力 ${anchor.score.toFixed(1)}，价格 ${plotPriceLabel(anchor.cost,currency)}`}
          style={{opacity:!highlightBrand||members.some(p=>modelBrand(p.entry.name)===highlightBrand)?1:.18}}
          onMouseEnter={()=>setHover(anchor.id)} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover(anchor.id)} onBlur={()=>setHover(null)} onClick={()=>choose(cluster)}
          onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();choose(cluster);}}}>
          <circle cx={anchor.x} cy={anchor.y} r={multiple?12:8} className={`scatter-marker${multiple?' is-cluster':''}`}/>
          {(selected||hover===anchor.id||opened===anchor.id)&&<circle cx={anchor.x} cy={anchor.y} r={multiple?16:12} className="scatter-selection-ring"/>}
          {multiple?<text x={anchor.x} y={anchor.y+4} textAnchor="middle" className="scatter-badge">{members.length}</text>:<foreignObject x={anchor.x-7} y={anchor.y-7} width="14" height="14" className="scatter-logo"><ModelLogo name={anchor.entry.name} size={14}/></foreignObject>}
        </g>;
      })}
    </svg>
    {active&&<div role="tooltip" className="scatter-tooltip" style={{left:Math.min(chart.width-280,Math.max(8,active.anchor.x-120)),top:active.anchor.y<130?active.anchor.y+25:active.anchor.y-100}}>
      {active.members.length>1?<><b>{active.members.length} 款相近模型</b><span>{active.members.slice(0,3).map(p=>p.entry.name).join('、')}{active.members.length>3?'…':''}</span><span>点击选择型号</span></>:<><b><ModelLogo name={active.anchor.entry.name} size={21}/>{active.anchor.entry.name}</b><div><strong>{active.anchor.score.toFixed(1)} 分</strong><span>{plotPriceLabel(active.anchor.cost,currency)}</span></div></>}
    </div>}
    {expanded&&<section className="scatter-picker" aria-label="相近模型"><header><b>选择型号 · {expanded.members.length}</b><button className="btn btn-quiet btn-sm" onClick={()=>setOpened(null)} aria-label="收起相近模型">收起</button></header><div>{expanded.members.map(point=><button key={point.id} onClick={()=>onFocus(point.entry)}><ModelLogo name={point.entry.name} size={22}/><span>{point.entry.name}<small>{reasoningLabel(point.entry)}</small></span><b>{point.score.toFixed(1)} 分</b><strong>{plotPriceLabel(point.cost,currency)}</strong></button>)}</div></section>}
  </div>;
}

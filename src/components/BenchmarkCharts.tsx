import { useState } from 'react';
import type { BenchmarkModel, BenchmarkProfile } from '../lib/types';
import { DOMAINS, fixed, frontier, SERIES } from '../lib/benchmarkCharts';

export function CapabilityBars({models}:{models:BenchmarkModel[]}) {
  return <section className="card capability-chart"><div className="benchmark-chart-heading"><h2>各有擅长</h2><span>相对分位 · 0–100</span></div>
    <div className="benchmark-legend">{models.map((m,i)=><span key={m.id}><i style={{background:SERIES[i]}}/>{m.name}</span>)}</div>
    <div className="capability-groups">{DOMAINS.map(domain=><div key={domain.id} className="capability-group"><div className="capability-label">{domain.name}{domain.id==='visual'&&<span title="独立展示，不计入综合分">独立项</span>}</div><div className="capability-bars">{models.map((model,i)=>{const value=model.domains[domain.id];return <div key={model.id} className="capability-bar-row" aria-label={`${model.name} · ${domain.name}：${fixed(value)}`}><div className="capability-track"><span style={{width:(value??0)+'%',background:SERIES[i]}}/></div><b>{fixed(value)}</b></div>;})}</div></div>)}</div>
  </section>;
}

export function EfficiencyChart({profiles,ids}:{profiles:BenchmarkProfile[];ids:string[]}) {
  const [hover,setHover]=useState<BenchmarkProfile|null>(null);
  const rows=profiles.filter(p=>ids.includes(p.modelId)&&p.cost!=null&&p.cost>0&&Number.isFinite(p.cost));
  const w=900,h=410,left=60,right=32,top=24,bottom=58;
  const values=rows.map(p=>Math.log10(p.cost!));
  const minimum=values.length?Math.min(...values):-1,maximum=values.length?Math.max(...values):1;
  const padding=Math.max(.12,(maximum-minimum)*.08),low=minimum-padding,high=maximum+padding;
  const ceiling=Math.min(100,Math.max(20,Math.ceil((Math.max(...rows.map(p=>p.index),0)+5)/10)*10));
  const ticks=Array.from({length:Math.ceil(high)-Math.floor(low)+1},(_,i)=>Math.floor(low)+i).flatMap(power=>[1,2,5].map(multiple=>multiple*10**power)).filter(cost=>Math.log10(cost)>=low&&Math.log10(cost)<=high);
  const x=(cost:number)=>left+(Math.log10(cost)-low)/(high-low||1)*(w-left-right);
  const y=(value:number)=>h-bottom-value/ceiling*(h-top-bottom);
  const money=(value:number)=>'$'+new Intl.NumberFormat('en',{maximumSignificantDigits:3}).format(value);
  const edge=frontier(rows);
  return <section className="card efficiency-chart"><div className="benchmark-chart-heading"><h2>能力与成本</h2><span>Artificial Analysis · Index v5</span></div>
    <div className="benchmark-legend">{ids.map((id,i)=>{const name=rows.find(p=>p.modelId===id)?.name;return name?<span key={id}><i style={{background:SERIES[i]}}/>{name.split(' (')[0]}</span>:null;})}</div>
    {rows.length?<><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="能力与任务成本：横轴为美元每任务的对数刻度，纵轴为 AA Intelligence Index v5。圆点是不同公开推理档位，虚线为所选模型的成本效率边界。" onMouseLeave={()=>setHover(null)}>
      {Array.from({length:ceiling/10+1},(_,i)=>i*10).map(value=><g key={value}><line x1={left} x2={w-right} y1={y(value)} y2={y(value)} className="benchmark-grid"/><text x={left-12} y={y(value)+4} textAnchor="end">{value}</text></g>)}
      {ticks.map(cost=><g key={cost}><line x1={x(cost)} x2={x(cost)} y1={top} y2={h-bottom} className="benchmark-grid vertical"/><text x={x(cost)} y={h-bottom+24} textAnchor="middle">{money(cost)}</text></g>)}
      {edge.length>1&&<polyline points={edge.map(p=>`${x(p.cost!)},${y(p.index)}`).join(' ')} className="benchmark-frontier"/>}
      {ids.map((id,i)=>{const points=rows.filter(p=>p.modelId===id).sort((a,b)=>a.cost!-b.cost!);return <g key={id} style={{color:SERIES[i]}}><polyline points={points.map(p=>`${x(p.cost!)},${y(p.index)}`).join(' ')} className="benchmark-profile-line"/>{points.map((p,index)=><circle key={p.setting+index} cx={x(p.cost!)} cy={y(p.index)} r={hover===p?7:5} fill="currentColor" className="benchmark-point" tabIndex={0} aria-label={`${p.name}，${p.setting}，能力 ${fixed(p.index)}，${money(p.cost!)} 每任务`} onFocus={()=>setHover(p)} onBlur={()=>setHover(null)} onMouseEnter={()=>setHover(p)}><title>{p.name} · {p.setting}：{fixed(p.index)} / {money(p.cost!)} 每任务</title></circle>)}</g>;})}
      <text x={left} y={14}>能力指数</text><text x={(left+w-right)/2} y={h-8} textAnchor="middle">任务成本（美元，对数刻度） →</text>
    </svg><div className="efficiency-readout" role="status">{hover?<><b>{hover.name}</b><span>{hover.setting}</span><span>能力 {fixed(hover.index)}</span><span>{money(hover.cost!)} / 任务</span></>:<span>圆点表示推理档位，虚线连接所选模型的效率边界。</span>}</div></>:<div className="benchmark-empty">所选模型暂无同版本的能力与任务成本数据。</div>}
  </section>;
}

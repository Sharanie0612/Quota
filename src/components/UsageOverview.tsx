import {useMemo,useState} from 'react';
import type {ActivityReport,MonthlyUsageRate,VendorCostReport} from '../lib/types';
import {reportCsv,usageBuckets,type UsageGrain} from '../lib/usageAnalytics';
import {cny} from '../lib/usageCny';
import {vendorRows,effectiveVendorPrice} from '../lib/vendorCosts';
import {UsageAnalysisChart} from './UsageAnalysisChart';
import {UsageBreakdown} from './UsageBreakdown';
import {ProviderLogo} from './logos';
import {Button,EmptyState,Notice,Seg} from './ui';
import {IconWallet} from './icons';

export function UsageOverview({activity,finance,from,to,vendor,rates,onAdd,onVendor,onExport}:{activity:ActivityReport;finance:VendorCostReport;from:string;to:string;vendor:string;rates:MonthlyUsageRate[];onAdd:()=>void;onVendor:(id:string)=>void;onExport:(contents:string,suffix:string)=>void}){
  const [grain,setGrain]=useState('auto'),[metric,setMetric]=useState<'money'|'tokens'>('money');
  const actualGrain:UsageGrain=grain==='auto'?(from==='1900-01-01'||to==='9999-12-31'||Date.parse(to)-Date.parse(from)>120*86400000?'month':Date.parse(to)-Date.parse(from)>45*86400000?'week':'day'):grain as UsageGrain;
  const result=useMemo(()=>usageBuckets(finance.expenses,activity.daily,from,to,actualGrain,'RMB',vendor,rates),[finance,activity,from,to,actualGrain,vendor,rates]);
  const rows=useMemo(()=>vendorRows(activity.models,finance,from,to,rates).filter(row=>!vendor||row.id===vendor),[activity,finance,from,to,rates,vendor]);
  const hasCost=result.buckets.some(row=>row.hasCost),missing=result.buckets.some(row=>row.missingFx);
  const total=!hasCost||missing||result.error?null:result.buckets.reduce((sum,row)=>sum+row.subscription+row.usage,0);
  const covered=rows.reduce((sum,row)=>sum+row.covered.total,0);
  const exportRows=()=>onExport(reportCsv(['开始日期','结束日期','订阅费用人民币','按量费用人民币','已采集Token','汇率状态'],result.buckets.map(row=>[row.from,row.to,row.hasSubscription&&!row.missingFx?row.subscription:null,row.hasUsage&&!row.missingFx?row.usage:null,row.tokens,row.missingFx?'缺少月均汇率':'已折算'])),'人民币统计');
  const compact=(value:number)=>Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(value);
  return <>
    <div className="usage-kpis">
      <section><span>总支出 · 人民币</span><strong>{total==null?(missing?'待换算':'未记录'):cny(total)}</strong><div>{missing?'缺少部分月份汇率':hasCost?'包含订阅和按量费用':'记录支出后开始统计'}</div></section>
      <section><span>使用 Token</span><strong>{compact(activity.totals.tokens.total)}</strong><div>输入 {compact(activity.totals.tokens.input)} · 输出 {compact(activity.totals.tokens.output)}</div></section>
      <section><span title="已记录支出 ÷ 同期费用覆盖用量 × 一百万">实际单价 · 每百万 Token</span><strong>{cny(effectiveVendorPrice(total,covered))}</strong><div>{covered?`${compact(covered)} Token 已有费用记录`:'记录费用后自动计算'}</div></section>
    </div>
    {!finance.expenses.length&&<section className="usage-start card"><div><h2>先记一笔支出</h2><p>填入订阅费或实际账单，就能看到总花费和真实单价。</p></div><Button variant="primary" onClick={onAdd}>记录支出</Button></section>}
    <section className="card usage-analysis">
      <div className="usage-analysis-heading"><h2 title="账期费用按自然日分摊；美元按对应月的平均汇率折算">{metric==='money'?'支出趋势':'用量趋势'}</h2><div className="usage-analysis-actions"><Seg value={metric} onChange={setMetric} options={[{value:'money',label:'支出'},{value:'tokens',label:'Token'}]}/><select className="select" aria-label="统计粒度" value={grain} onChange={event=>setGrain(event.target.value)}><option value="auto">自动</option><option value="day">按日</option><option value="week">按周</option><option value="month">按月</option></select><Button size="sm" variant="quiet" onClick={exportRows} disabled={!!result.error||!result.buckets.length}>导出</Button></div></div>
      {result.error?<Notice tone="warn">{result.error}</Notice>:metric==='money'&&!hasCost?<EmptyState icon={<IconWallet size={24}/>} title="还没有支出记录" action={<Button onClick={onAdd}>记录支出</Button>}/>:<UsageAnalysisChart buckets={result.buckets} metric={metric} currency="CNY"/>}
    </section>
    <section className="card usage-vendor-summary"><div className="usage-analysis-heading"><h2>各厂商支出</h2><span>人民币</span></div>
      {rows.length?<div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th>厂商</th><th>支出</th><th>Token</th><th>实际单价 / 百万 Token</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><button className="usage-vendor-link" onClick={()=>onVendor(row.id)}><ProviderLogo provider={row.id==='custom'?'openai':row.id} size={25}/>{row.name}<span>↗</span></button></td><td>{cny(row.cny)}</td><td>{compact(row.totals.total)}</td><td>{cny(row.cnyEffective)}</td></tr>)}</tbody></table></div>:<EmptyState icon={<IconWallet size={24}/>} title="当前范围暂无用量"/>}
    </section>
    <details className="usage-distribution"><summary>查看用量分布</summary><UsageBreakdown activity={activity} onExport={onExport}/></details>
  </>;
}

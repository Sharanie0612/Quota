import {useMemo,useState} from 'react';
import type {ActivityReport,VendorCostReport} from '../lib/types';
import {expensePortions,vendorNames} from '../lib/vendorCosts';
import {localDay,reportCsv,usageBuckets,type UsageGrain} from '../lib/usageAnalytics';
import {UsageAnalysisChart} from './UsageAnalysisChart';
import {UsageBreakdown} from './UsageBreakdown';
import {Button,EmptyState,Notice,Seg} from './ui';
import {IconChart,IconWallet} from './icons';

export function UsageOverview({activity,finance,from,to,vendor,currency,onCurrency,onAdd,onPrices,onExport}:{activity:ActivityReport;finance:VendorCostReport;from:string;to:string;vendor:string;currency:string;onCurrency:(value:string)=>void;onAdd:()=>void;onPrices:()=>void;onExport:(contents:string,suffix:string)=>void}){
  const [grain,setGrain]=useState('auto'),[metric,setMetric]=useState<'money'|'tokens'>('money');
  const actualGrain:UsageGrain=grain==='auto'?(from==='1900-01-01'||to==='9999-12-31'||Date.parse(to)-Date.parse(from)>120*86400000?'month':Date.parse(to)-Date.parse(from)>45*86400000?'week':'day'):grain as UsageGrain;
  const result=useMemo(()=>usageBuckets(finance.expenses,activity.daily,from,to,actualGrain,currency,vendor),[finance,activity,from,to,actualGrain,currency,vendor]);
  const hasCost=result.buckets.some(row=>row.hasCost),subscription=result.buckets.reduce((sum,row)=>sum+row.subscription,0),usage=result.buckets.reduce((sum,row)=>sum+row.usage,0);
  const money=(value:number)=>`${currency==='CNY'?'¥':'$'}${value.toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
  const costParts=[result.buckets.some(row=>row.hasSubscription)?`订阅 ${money(subscription)}`:'',result.buckets.some(row=>row.hasUsage)?`按量 ${money(usage)}`:''].filter(Boolean).join(' · ');
  const other=currency==='CNY'?'USD':'CNY';
  const otherBills=finance.expenses.filter(row=>(!vendor||row.vendor===vendor)&&row.currency===other&&row.from<=localDay()&&row.from<=to&&row.to>=from);
  const otherAmount=otherBills.reduce((sum,row)=>sum+((row.subscription??0)+(row.usage??0))*expensePortions(row,from,to).reduce((n,p)=>n+p.factor,0),0);
  const activeDays=activity.daily.filter(row=>row.tokens.total>0).length;
  const totals=activity.totals.tokens;
  const exportRows=()=>onExport(reportCsv(['厂商范围','开始日期','结束日期','币种','订阅费用分摊','按量费用分摊','已采集Token'],result.buckets.map(row=>[vendorNames[vendor]??'全部厂商',row.from,row.to,currency,row.hasSubscription?row.subscription:null,row.hasUsage?row.usage:null,row.tokens])),'期间统计');
  return <>
    <div className="usage-kpis"><section><span title="所选日期内已记录的账期费用；跨期按自然日分摊">账期费用 · {currency}</span><strong>{result.error?'—':hasCost?money(subscription+usage):'未记录'}</strong><div>{hasCost?costParts:'添加账期后查看实际支出'}{otherBills.length>0&&<button onClick={()=>onCurrency(other)}>另有 {other==='USD'?'$':'¥'}{otherAmount.toLocaleString('zh-CN',{maximumFractionDigits:2})} {other} ↗</button>}</div></section><section><span>已采集 Token</span><strong>{Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(totals.total)}</strong></section><section><span>输出 Token</span><strong>{Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).format(totals.output)}</strong><div>输入 {totals.input.toLocaleString()}</div></section><section><span>活跃天数</span><strong>{activeDays}<small>天</small></strong><div>{activity.totals.sessions.toLocaleString()} 个会话</div></section></div>
    <section className="card usage-analysis"><div className="usage-analysis-heading"><div><h2 title={metric==='money'?'账期按自然日分摊，不代表逐日扣款':'按自然日汇总已采集记录'}>{metric==='money'?'费用分摊趋势':'用量趋势'}</h2></div><div className="usage-analysis-actions"><Seg value={metric} onChange={setMetric} options={[{value:'money',label:'费用'},{value:'tokens',label:'Token'}]}/><select className="select" aria-label="统计粒度" value={grain} onChange={event=>setGrain(event.target.value)}><option value="auto">自动粒度</option><option value="day">按日</option><option value="week">按周</option><option value="month">按月</option></select><Button size="sm" onClick={exportRows} disabled={!!result.error||!result.buckets.length}>导出 CSV</Button></div></div>
      {result.error?<Notice tone="warn">{result.error}</Notice>:metric==='money'&&!hasCost?<EmptyState icon={<IconWallet size={28}/>} title={`当前范围尚未记录${currency==='CNY'?'人民币':'美元'}账期费用`} action={<Button onClick={onAdd}>添加账期</Button>}/>:metric==='tokens'&&!totals.total?<EmptyState icon={<IconChart size={28}/>} title="当前范围暂无已采集用量"/>:<UsageAnalysisChart buckets={result.buckets} metric={metric} currency={currency}/>}
      {metric==='money'&&hasCost&&<div className="analysis-caption"><Button variant="quiet" size="sm" onClick={onPrices}>实际 Token 单价 ↗</Button></div>}
    </section>
    <UsageBreakdown activity={activity} onExport={onExport}/>
  </>;
}

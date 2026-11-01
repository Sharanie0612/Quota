import {useMemo,useState} from 'react';
import type {MonthlyUsageRate,VendorCostReport,VendorExpense} from '../lib/types';
import {vendorNames} from '../lib/vendorCosts';
import {filteredObservations,localDay,reportCsv} from '../lib/usageAnalytics';
import {cny,convertedExpense,convertedSnapshot} from '../lib/usageCny';
import {Button,EmptyState} from './ui';
import {IconWallet} from './icons';
import {ProviderLogo} from './logos';

const originalAmount=(value:number|null,currency:string)=>value==null?'—':`${currency==='USD'?'$':'¥'}${value.toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
const stamp=(at:number)=>new Date(at*1000).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
export function SpendingHistory({finance,from,to,vendor,rates,onEdit,onAdd,onExport}:{finance:VendorCostReport;from:string;to:string;vendor:string;rates:MonthlyUsageRate[];onEdit:(expense:VendorExpense)=>void;onAdd:()=>void;onExport:(contents:string,suffix:string)=>void}){
  const [search,setSearch]=useState(''),[state,setState]=useState('all'),[account,setAccount]=useState(''),[limit,setLimit]=useState(25);
  const today=localDay();
  const expenses=useMemo(()=>finance.expenses.filter(row=>(!vendor||row.vendor===vendor)&&row.from<=to&&row.to>=from).filter(row=>!search.trim()||`${vendorNames[row.vendor]??row.vendor} ${row.from} ${row.to}`.toLowerCase().includes(search.trim().toLowerCase())).filter(row=>state==='all'||(state==='active'?row.from<=today&&row.to>=today:state==='ended'?row.to<today:row.from>today)).sort((a,b)=>b.from.localeCompare(a.from)||a.vendor.localeCompare(b.vendor)),[finance,from,to,vendor,search,state,today]);
  const observations=['CNY','USD'].flatMap(currency=>filteredObservations(finance.history??[],vendor,currency,'')).filter(row=>{const day=localDay(new Date(row.at*1000));return day>=from&&day<=to;}).sort((a,b)=>b.at-a.at);
  const accounts=[...new Map(observations.map(row=>[`${row.accountId}|${row.currency}`,`${row.label} · ${row.currency}`])).entries()];
  const selected=accounts.some(([id])=>id===account)?account:accounts[0]?.[0]??'';
  const records=observations.filter(row=>`${row.accountId}|${row.currency}`===selected);
  const exportRows=()=>onExport(reportCsv(['厂商','费用开始','费用结束','人民币金额','原币','订阅原币金额','按量原币金额','换算状态'],expenses.map(row=>{const converted=convertedExpense(row,from,to,rates);return [vendorNames[row.vendor]??row.vendor,row.from,row.to,converted.total,row.currency,row.subscription,row.usage,converted.missingMonths.length?'缺少月均汇率':'月均汇率'];})),'消费记录');
  return <>
    <section className="usage-history card">
      <div className="usage-analysis-heading"><h2>消费记录</h2><div className="usage-history-tools"><input className="input" placeholder="搜索厂商或日期" aria-label="搜索消费历史" value={search} onChange={event=>{setSearch(event.target.value);setLimit(25);}}/><select className="select" value={state} aria-label="历史账期状态" onChange={event=>setState(event.target.value)}><option value="all">全部记录</option><option value="active">进行中</option><option value="ended">已结束</option><option value="upcoming">未开始</option></select><Button size="sm" variant="quiet" onClick={exportRows} disabled={!expenses.length}>导出</Button></div></div>
      {expenses.length?<div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th>厂商</th><th>费用日期</th><th title="计入所选日期的金额，跨期按天分摊">人民币金额</th><th>类型</th><th/></tr></thead><tbody>{expenses.slice(0,limit).map(row=>{const converted=convertedExpense(row,from,to,rates);return <tr key={`${row.vendor}-${row.from}-${row.to}-${row.currency}`}><td><span className="ledger-vendor"><ProviderLogo provider={row.vendor==='custom'?'openai':row.vendor} size={23}/><b>{vendorNames[row.vendor]??row.vendor}</b></span></td><td><span>{row.from}</span><span className="ledger-period">至 {row.to}</span></td><td><b>{converted.missingMonths.length?'待换算':cny(converted.total)}</b>{row.currency==='USD'&&<span className="ledger-period">原币 {originalAmount((row.subscription??0)+(row.usage??0),'USD')}</span>}</td><td>{row.subscription!=null&&row.usage!=null?'订阅 + 按量':row.subscription!=null?'订阅':'按量'}</td><td><Button size="sm" variant="quiet" onClick={()=>onEdit(row)}>编辑</Button></td></tr>;})}</tbody></table></div>:<EmptyState icon={<IconWallet size={24}/>} title="当前范围没有支出记录" action={<Button onClick={onAdd}>记录支出</Button>}/>}
      {expenses.length>limit&&<Button variant="quiet" onClick={()=>setLimit(value=>value+25)}>显示更多</Button>}
    </section>
    {!!observations.length&&<details className="card usage-observations"><summary>账户消费变化<span>{observations.length} 条观测</span></summary><div className="usage-ledger-context"><h2 title="厂商返回的累计计数，独立于上方实付记录">原币累计值</h2><select className="select" aria-label="消费历史账户" value={selected} onChange={event=>setAccount(event.target.value)}>{accounts.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></div><div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th>确认时间</th><th>累计消费 · 原币</th><th title="按确认月份均值折算，仅供核对">区间消费 · 人民币</th><th>区间充值 · 原币</th></tr></thead><tbody>{records.slice(0,100).map(row=><tr key={`${row.accountId}-${row.currency}-${row.at}`}><td><b>{stamp(row.at)}</b>{row.counterReset&&<span className="ledger-period">计数已重置</span>}</td><td>{originalAmount(row.cumulativeSpend,row.currency)}</td><td>{cny(convertedSnapshot(row.spendDelta,row.currency,localDay(new Date(row.at*1000)).slice(0,7),rates))}</td><td>{originalAmount(row.rechargeDelta,row.currency)}</td></tr>)}</tbody></table></div></details>}
  </>;
}

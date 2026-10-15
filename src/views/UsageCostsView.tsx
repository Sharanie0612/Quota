import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errText } from "../lib/api";
import { vendorRows, vendorNames, endOfSubscription, expensePortions, sumTokens, effectiveVendorPrice } from "../lib/vendorCosts";
import { monthKey, monthRange, monthLabel, shiftMonth } from "../lib/usageMonths";
import type { ActivityReport, VendorCostReport, VendorExpense, MonthlyUsageRate } from "../lib/types";
import { Button, EmptyState, Field, Modal, Notice, Seg } from "../components/ui";
import { ModelLogo } from "../components/ModelLogo";
import { ProviderLogo } from "../components/logos";
import { IconPlus, IconRefresh, IconWallet } from "../components/icons";
import { toast } from "../lib/store";

const day=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const count=(n:number)=>n.toLocaleString("zh-CN");
const money=(n:number|null,currency:string)=>n==null?"待补充":`${currency==="USD"?"$":"¥"}${n.toLocaleString("zh-CN",{maximumFractionDigits:6})}`;
const when=(t:number|null)=>t==null?"暂无记录":new Date(t*1000).toLocaleDateString("zh-CN");
function initialRange(){
  try {
    const saved=JSON.parse(localStorage.getItem('quota-my-usage-range')??'null');
    const month=monthRange(saved?.from?.slice(0,7));
    if(month&&saved.mode!=='all')return {...month,mode:'month'};
  } catch {/* Preferences are optional. */}
  return {...monthRange(monthKey())!,mode:'month'};
}

export function UsageCostsView(){
  const [initial]=useState(initialRange);
  const [from,setFrom]=useState(initial.from);
  const [to,setTo]=useState(initial.to);
  const [rangeMode,setRangeMode]=useState(initial.mode);
  const [draftFrom,setDraftFrom]=useState(initial.mode==='all'?'':initial.from);
  const [draftTo,setDraftTo]=useState(initial.mode==='all'?'':initial.to);
  const [search,setSearch]=useState('');
  const [rates,setRates]=useState<MonthlyUsageRate[]>([]);
  const [fxError,setFxError]=useState('');
  const [fxReload,setFxReload]=useState(0);
  const [fxEdit,setFxEdit]=useState<{month:string;value:string}|null>(null);
  const [fxSaving,setFxSaving]=useState(false);
  const [activity,setActivity]=useState<ActivityReport|null>(null);
  const [finance,setFinance]=useState<VendorCostReport|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [reload,setReload]=useState(0);
  const [busy,setBusy]=useState(false);
  const [edit,setEdit]=useState<VendorExpense|null>(null);
  const [original,setOriginal]=useState<VendorExpense|null>(null);
  const [manager,setManager]=useState(false);
  const [managerVendor,setManagerVendor]=useState('');
  const [managerStatus,setManagerStatus]=useState('all');
  const [subscription,setSubscription]=useState("");
  const [usage,setUsage]=useState("");
  const [saving,setSaving]=useState(false);
  const query=`${from}|${to}`;
  useEffect(()=>{setActivity(null);setFinance(null);setLoading(true);},[query]);
  useEffect(()=>{
    let live=true;setLoading(true);setError("");
    if(!from||!to||from>to){setError("请选择有效的起止日期");setLoading(false);return;}
    void Promise.all([api.getActivity("","without-trae",0,"",from,to),api.getVendorCosts(from,to)])
      .then(([a,f])=>{if(live){setActivity(a);setFinance(f);}}).catch(e=>{if(live)setError(errText(e));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[query,reload]);
  useEffect(()=>{
    let live=true;const cleanups:(()=>void)[]=[];
    for(const event of ["activity-updated","accounts-updated"])void listen(event,()=>setReload(n=>n+1)).then(un=>{if(live)cleanups.push(un);else un();}).catch(()=>undefined);
    return()=>{live=false;cleanups.forEach(un=>un());};
  },[]);
  const rows=useMemo(()=>finance?vendorRows(activity?.models??[],finance,from,to,rates):[],[finance,activity,from,to,rates]);
  const currentMonth=monthKey();
  const selectedMonth=from.slice(0,7);
  const referenceMonth=rangeMode==='month'?selectedMonth:currentMonth;
  const fxMonths=useMemo(()=>[...new Set([referenceMonth,...(finance?.expenses??[]).filter(e=>e.currency==='USD').flatMap(e=>expensePortions(e,from,to).map(p=>p.month))])].sort(),[finance,from,to,referenceMonth]);
  const displayedRate=rates.find(r=>r.month===referenceMonth);
  const fxQuery=fxMonths.join('|');
  useEffect(()=>{let live=true;setFxError('');void api.getMonthlyUsageFx(fxQuery.split('|')).then(r=>{if(live){setRates(r.rates);setFxError(r.error??'');}}).catch(e=>{if(live)setFxError(errText(e));});return()=>{live=false;};},[fxQuery,fxReload,reload]);
  const visibleRows=rows.filter(r=>!search.trim()||`${r.name} ${r.rows.map(m=>m.key).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedTokens=sumTokens(activity?.models??[]);
  const coveredTokens=rows.reduce((n,r)=>n+r.covered.total,0);
  const pricedRows=rows.filter(r=>r.amounts.length);
  const referenceCny=pricedRows.length&&!pricedRows.some(r=>r.cny==null)?pricedRows.reduce((n,r)=>n+(r.cny??0),0):null;
  const partial=rows.some(r=>r.amounts.some(a=>a.partial));
  const applyRange=(mode:string,first:string,last:string)=>{setFrom(first);setTo(last);setRangeMode(mode);setDraftFrom(mode==='all'?'':first);setDraftTo(mode==='all'?'':last);try{localStorage.setItem('quota-my-usage-range',JSON.stringify({from:first,to:last,mode}));}catch{/* Preferences are optional. */}};
  const chooseMonth=(month:string)=>{const range=monthRange(month);if(range)applyRange('month',range.from,range.to);};
  const preset=(mode:string)=>{if(mode==='all'){applyRange(mode,'1900-01-01','9999-12-31');return;}if(mode==='custom'){setRangeMode(mode);if(!draftFrom)setDraftFrom(monthRange(currentMonth)!.from);if(!draftTo)setDraftTo(day(new Date()));return;}chooseMonth(rangeMode==='all'?currentMonth:selectedMonth);};
  const summaries=["CNY","USD"].map(currency=>({currency,amount:rows.flatMap(r=>r.amounts).filter(a=>a.currency===currency).reduce((n,a)=>n+a.total,0),known:rows.filter(r=>r.amounts.some(a=>a.currency===currency)).length}));
  const openEditor=(id:string,record?:VendorExpense,independent=false)=>{
    const start=independent?day(new Date()):rangeMode==='all'?monthRange(currentMonth)!.from:from;
    const value=record??{vendor:id,from:start,to:independent?endOfSubscription(start,1):rangeMode==='all'?monthRange(currentMonth)!.to:to,currency:id==="custom"?"USD":"CNY",subscription:null,usage:null,planId:null};
    const detected=finance?.accounts.find(a=>a.vendor===id)?.plan?.toLowerCase();
    const plan=!record&&id==="custom"&&detected?finance?.plans.find(p=>p.vendor===id&&p.id===detected):null;
    setOriginal(record?{...record}:null);setEdit(plan?{...value,planId:plan.id,currency:plan.currency,to:endOfSubscription(value.from,plan.months)}:{...value});setSubscription(plan?String(plan.amount):value.subscription?.toString()??"");setUsage(value.usage?.toString()??"");
  };
  const selectPlan=(id:string)=>{
    if(!edit)return;
    const plan=finance?.plans.find(p=>p.id===id&&p.vendor===edit.vendor);
    if(!plan){setEdit({...edit,planId:null});return;}
    setSubscription(String(plan.amount));setEdit({...edit,planId:id,currency:plan.currency,to:endOfSubscription(edit.from,plan.months)});
  };
  const save=async(clear=false)=>{
    if(!edit)return;
    const parse=(v:string)=>v.trim()?Number(v):null;
    const a=clear?null:parse(subscription),b=clear?null:parse(usage);
    if(!clear&&(!edit.from||!edit.to||edit.from>edit.to)){toast('请选择有效的订阅或消费周期','error');return;}
    if(!clear&&a==null&&b==null){toast('请至少填写一项费用；删除已有账期请使用「清除此记录」','error');return;}
    if(!clear&&!original&&finance?.expenses.some(e=>e.vendor===edit.vendor&&e.from===edit.from&&e.to===edit.to&&e.currency===edit.currency)){toast('此账期已存在，请从「订阅与账期」编辑原记录','error');return;}
    if([a,b].some(v=>v!=null&&(!Number.isFinite(v)||v<0||v>1e9))){toast("请输入有限的非负金额；留空表示尚未记录","error");return;}
    setSaving(true);
    try{await api.saveVendorExpense({... (clear?original??edit:edit),subscription:a,usage:b,planId:clear?null:edit.planId},original);setEdit(null);setOriginal(null);setReload(n=>n+1);toast(clear?'已清除此支出记录':'已保存账期，当前统计月份保持不变');}
    catch(e){toast(errText(e),"error");}finally{setSaving(false);}
  };
  const sync=async()=>{setBusy(true);try{await api.refreshActivity();await api.refreshAll();setReload(n=>n+1);}catch(e){setError(errText(e));}finally{setBusy(false);}};
  const editRow=rows.find(r=>r.id===edit?.vendor);
  const selectedPlan=finance?.plans.find(p=>p.id===edit?.planId);
  const today=day(new Date());
  const billStatus=(e:VendorExpense)=>e.from>today?'upcoming':e.to<today?'ended':'active';
  const managedExpenses=(finance?.expenses??[]).filter(e=>(!managerVendor||e.vendor===managerVendor)&&(managerStatus==='all'||billStatus(e)===managerStatus)).sort((a,b)=>b.from.localeCompare(a.from)||a.vendor.localeCompare(b.vendor));
  const subscriptionCount=finance?.expenses.filter(e=>e.subscription!=null&&billStatus(e)==='active').length??0;
  const billingVendors=Object.entries(vendorNames).filter(([id])=>['custom','deepseek','mimo','moonshot','zhipu'].includes(id)||finance?.expenses.some(e=>e.vendor===id)||rows.some(r=>r.id===id&&r.rows.length>0));
  const saveFx=async(reset=false)=>{if(!fxEdit)return;const n=Number(fxEdit.value);if(!reset&&(!Number.isFinite(n)||n<0.01||n>100)){toast('请输入 0.01–100 之间的汇率','error');return;}setFxSaving(true);try{await api.saveMonthlyUsageFx(fxEdit.month,reset?null:n);setFxEdit(null);setFxReload(n=>n+1);toast(reset?'已恢复官方月度参考':'已保存本月固定参考');}catch(e){toast(errText(e),'error');}finally{setFxSaving(false);}};
  return <div className="content-inner usage-costs">
    <div className="usage-costs-intro"><div><h2>每个月，用得明白</h2><p>按自然月汇总全部设备的用量与费用，已排除 Trae。</p><p className="hint">{activity?.options.syncDir?'订阅账期、支出和月度参考汇率已加入跨设备同步。':'在设置中开启跨设备同步，可同步订阅账期、支出和月度参考汇率。'}用量复用 Token 活动记录。</p></div><Button disabled={busy} onClick={()=>void sync()}><IconRefresh size={14} className={busy?"spin":""}/>{busy?"更新中…":"更新我的使用"}</Button></div>
    <section className="card my-usage-range">
      <div className="my-usage-range-head"><div><span className="usage-eyebrow">统计时间</span><h3>{rangeMode==='month'?monthLabel(selectedMonth):rangeMode==='all'?'全部历史':'自定义期间'}</h3></div><Seg value={rangeMode} onChange={preset} options={[{value:'month',label:'按月统计'},{value:'all',label:'全部历史'},{value:'custom',label:'自定义'}]}/></div>
      {rangeMode==='month'?<div className="usage-month-controls"><Button aria-label="上一个月" disabled={!shiftMonth(selectedMonth,-1)} onClick={()=>chooseMonth(shiftMonth(selectedMonth,-1)!)}>‹</Button><input className="input" aria-label="统计月份" type="month" min="1900-01" max="9999-12" value={selectedMonth} onChange={e=>chooseMonth(e.target.value)}/><Button aria-label="下一个月" disabled={!shiftMonth(selectedMonth,1)} onClick={()=>chooseMonth(shiftMonth(selectedMonth,1)!)}>›</Button><Button variant="quiet" disabled={selectedMonth===currentMonth} onClick={()=>chooseMonth(currentMonth)}>回到本月</Button><span className="hint">{from} — {to}{selectedMonth===currentMonth?' · 用量截至当前':''}</span></div>:rangeMode==='custom'?<div className="vendor-cost-filters"><Field label="开始日期"><input className="input" type="date" value={draftFrom} onChange={e=>setDraftFrom(e.target.value)}/></Field><Field label="结束日期"><input className="input" type="date" value={draftTo} onChange={e=>setDraftTo(e.target.value)}/></Field><Button variant="primary" disabled={!draftFrom||!draftTo||draftFrom>draftTo} onClick={()=>applyRange('custom',draftFrom,draftTo)}>应用日期</Button><span className="hint">当前统计 {from} — {to}</span></div>:<p className="hint">{finance?.firstDate??'暂无记录'} — {finance?.lastDate??'今天'} · 全部已采集历史</p>}
    </section>
    <section className="card usage-subscriptions-entry"><div className="usage-subscriptions-mark"><IconWallet size={22}/></div><div><h3>订阅与账期</h3><p>{subscriptionCount?`${subscriptionCount} 个订阅进行中 · `:''}独立管理订阅开始、结束时间和实付费用</p></div><Button onClick={()=>setManager(true)} disabled={!finance}>管理订阅与账期</Button></section>
    {error&&<Notice tone="error" actions={<Button onClick={()=>setReload(n=>n+1)}>重试</Button>}>{error}</Notice>}
    {!!activity?.errors.length&&<Notice tone="warn">{activity.errors.join("；")}。用量可能不完整，实际均价也会受影响。</Notice>}
    {!!activity?.syncErrors?.length&&<Notice tone="warn">部分同步未完成：{activity.syncErrors.join('；')}。可在设置中重试，本机记录仍保留。</Notice>}
    <div className="my-usage-summary"><section className="card"><span>{rangeMode==='month'?'所选月份':'所选期间'} · Token</span><strong>{loading?'—':count(selectedTokens.total)}</strong><small>{loading?'正在读取用量':`输入 ${count(selectedTokens.input)} · 输出 ${count(selectedTokens.output)}`}</small></section><section className="card"><span>全部历史 · Token</span><strong>{finance?count(finance.lifetimeTokens.total):'—'}</strong><small>{finance?`${count(finance.lifetimeSessions)} 个会话 · 全部设备`:'正在读取历史'}</small><Button size="sm" variant="quiet" onClick={()=>preset('all')}>查看全部历史</Button></section><section className="card"><span>{rangeMode==='month'?'月度费用':'期间费用'} · {partial?'分摊参考':'人民币参考'}</span><strong>{loading?'—':money(referenceCny,'CNY')}</strong><small>{loading?'正在读取费用':summaries.filter(s=>s.known).map(s=>money(s.amount,s.currency)).join(' + ')||'尚未记录费用'}</small></section><section className="card"><span>每百万 Token · 人民币参考</span><strong>{loading?'—':money(effectiveVendorPrice(referenceCny,coveredTokens),'CNY')}</strong><small>{loading?'正在核对费用覆盖':`已记录费用覆盖 ${count(coveredTokens)} Token`}</small></section></div>
    <p className="hint">{pricedRows.length} / {rows.length} 家厂商已记录费用。{partial?'部分账期按日分摊，按量消费的日分布未知时同样按日分摊；属于期间参考，不是逐日账单。':'完整账期使用整期已记录费用。'}均价仅使用费用覆盖的用量，未记录费用的日期不会当作免费。</p>
    <details className="card my-usage-fx"><summary>月度汇率参考 <span className="hint">{displayedRate?`${referenceMonth} · $1 ≈ ¥${displayedRate.cnyPerUsd.toFixed(4)}`:`${referenceMonth} · 尚未获取参考`} · 可调整</span></summary><p className="hint">每月固定采用上月末最后一次公布的 ECB 参考值，跨月分别折算；缺少汇率时不猜。原始美元金额保留，不是实际换汇结算价。</p>{fxError&&<Notice tone="warn">{fxError}<Button size="sm" onClick={()=>setFxReload(n=>n+1)}>重试获取</Button></Notice>}<div className="my-usage-fx-list">{fxMonths.map(month=>{const r=rates.find(r=>r.month===month);return <div key={month}><b>{month}</b><span>{r?`$1 ≈ ¥${r.cnyPerUsd.toFixed(4)}`:'待补充'}<small>{r?(r.source==='manual'?'手动固定参考':`ECB · ${r.date}`):'尚无该月参考'}</small></span><Button size="sm" onClick={()=>setFxEdit({month,value:r?String(r.cnyPerUsd):''})}>调整</Button></div>;})}</div></details>
    <div className="my-usage-vendors"><h3>厂商用量与费用</h3><input className="input" aria-label="搜索我的使用" placeholder="搜索厂商或模型" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {loading?<section className="card usage-cost-placeholder" role="status">正在读取实际用量与金额记录…</section>:visibleRows.length===0?<section className="card"><EmptyState icon={<IconWallet size={26}/>} title={search?'没有匹配厂商':'暂无用量与支出'} desc={search?'换个厂商名称或模型名称试试。':'更新账户与 Token 活动后即可开始统计。'}/></section>:visibleRows.map(row=><details className="card vendor-cost-card" key={row.id}>
      <summary className="vendor-cost-head"><div className="vendor-cost-brand"><ProviderLogo provider={row.id==="custom"?"openai":row.id} size={28}/><div><b>{row.name}</b><small>{row.families.length} 个模型 · 展开明细</small></div></div><div><small>实际 Token</small><b>{count(row.totals.total)}</b></div><div><small>期间费用</small>{row.amounts.length?row.amounts.map(a=><b key={a.currency}>{money(a.total,a.currency)}</b>):<b>待补充</b>}</div><div><small>每百万 Token · 人民币参考</small><b>{money(row.cnyEffective,'CNY')}</b></div><Button size="sm" onClick={e=>{e.preventDefault();e.stopPropagation();if(row.allExpenses.length){setManagerVendor(row.id);setManagerStatus('all');setManager(true);}else openEditor(row.id);}}>{row.allExpenses.length?'管理费用':'记录费用'}</Button></summary>
      <div className="vendor-cost-body">
        <p className="hint">{row.expenses.length?`费用覆盖周期内 ${count(row.covered.total)} Token；当前筛选共 ${count(row.totals.total)} Token。未有费用记录的日期不进入均价分母。`:"尚未记录匹配周期的费用。选择公开订阅套餐并确认订阅期，或填写厂商实际消费。"}</p>
        {!!row.amounts.length&&<p className="hint">原币每百万 Token：{row.amounts.map(a=>money(a.effective,a.currency)).join(' · ')}。人民币参考保留对应月份的固定汇率。</p>}
        {row.amounts.some(a=>a.partial)&&<Notice>当前日期截取了部分账期，费用按天分摊供参考。选择「查看账期」可核对整期实付。</Notice>}
        {row.amounts.some(a=>a.missingMonths.length>0)&&<Notice tone="warn">美元金额已保留，人民币参考缺少 {row.amounts.flatMap(a=>a.missingMonths).join('、')} 汇率；可在上方调整。</Notice>}
        {!!row.allExpenses.length&&<div className="vendor-expense-list">{row.allExpenses.map(e=><div key={`${e.from}-${e.to}-${e.currency}`}><div><b>{e.from} — {e.to}</b><small>{e.planId?finance?.plans.find(p=>p.id===e.planId)?.name+" · 公开订阅费":"实付 / 实际消费记录"} · 订阅 {money(e.subscription,e.currency)} · 按量消费 {money(e.usage,e.currency)}</small></div><Button size="sm" onClick={()=>applyRange('custom',e.from,e.to)}>查看账期</Button><Button size="sm" onClick={()=>openEditor(row.id,e)}>编辑</Button></div>)}</div>}
        {!!row.accounts.length&&<section className="vendor-finance"><h3>账户金额与充值历史</h3>{row.accounts.map(a=><div key={a.id} className="vendor-finance-account"><b>{a.label}</b><div><span>累计充值 {money(a.cumulativeRecharge,a.currency)}</span><span>累计消费 {money(a.cumulativeSpend,a.currency)}</span></div><p className="hint">{a.observedFrom!=null&&a.observedTo!=null?`${when(a.observedFrom)} — ${when(a.observedTo)} 计数记录：充值增量 ${money(a.observedRecharge,a.currency)}，消费增量 ${money(a.observedSpend,a.currency)}`:"新版开始保留消费计数；没有历史计数时不推算本期实付。"}</p>{a.historyFrom!=null&&<p className="hint">{when(a.historyFrom)} — {when(a.historyTo)} 余额记录：上涨 {money(a.balanceRises,a.currency)}，下降 {money(a.balanceDrops,a.currency)}，可能含赠金、退款或采样遗漏，仅供核对。</p>}</div>)}</section>}
        <div className="usage-cost-scroll"><table className="vendor-model-table"><thead><tr><th>模型</th><th>Token</th><th>输入 / 输出</th><th>缓存命中</th><th>用量占比</th></tr></thead><tbody>{row.families.map(f=><tr key={f.key}><td><div className="usage-cost-model"><ModelLogo name={f.key} size={22}/><span title={f.variants.map(v=>v.key).join("、")}>{f.key||"未知模型"}{f.variants.length>1&&<small>{f.variants.length} 个运行档位合并显示</small>}</span></div></td><td>{count(f.tokens.total)}</td><td>{count(f.tokens.input)} / {count(f.tokens.output)}</td><td>{count(f.tokens.cached)}</td><td>{row.totals.total?(f.tokens.total/row.totals.total*100).toFixed(1)+"%":"—"}</td></tr>)}</tbody></table></div>
      </div>
    </details>)}
    <details className="activity-method"><summary>如何计算费用与用量</summary><p className="hint">本页所有用量与均价排除 Trae，Token 活动保留原始记录。完整账期使用整期费用，任意日期截取账期时按自然日分摊订阅与按量费用，仅为参考，不推算逐日实付。人民币换算按每个月的固定参考，美元原币金额保留。当前账期的均价会随用量变化；未记录费用不等于免费，充值和余额变化不能当作消费。其他订阅功能共享费用，模型明细展示用量，不伪造逐型号账单。</p></details>
    {fxEdit&&<Modal title={`${fxEdit.month} · 固定汇率参考`} onClose={()=>{if(!fxSaving)setFxEdit(null);}} footer={<><Button disabled={fxSaving} onClick={()=>void saveFx(true)}>恢复官方参考</Button><span className="spacer"/><Button variant="primary" disabled={fxSaving} onClick={()=>void saveFx()}>保存参考</Button></>}><Field label="1 美元折合人民币"><input className="input" type="number" min="0.01" max="100" step="any" value={fxEdit.value} onChange={e=>setFxEdit({...fxEdit,value:e.target.value})}/></Field><p className="hint">手动值会标为个人参考，并固定保存到本机；不会覆盖原始费用。恢复官方参考后重新获取上月末公布值。</p></Modal>}
    {manager&&!edit&&<Modal title="订阅与账期" wide onClose={()=>setManager(false)} footer={<><span className="hint">修改账期不会改变统计月份</span><span className="spacer"/><Button onClick={()=>setManager(false)}>完成</Button><Button variant="primary" disabled={loading} onClick={()=>openEditor(managerVendor||'custom',undefined,true)}><IconPlus size={14}/>添加订阅 / 账期</Button></>}>
      <p className="hint">查看全部已记录账期，订阅时间独立于上方统计月份。跨月和年付费用会按自然日分配到各月。</p>
      <div className="usage-billing-filters"><Field label="厂商"><select className="select" value={managerVendor} onChange={e=>setManagerVendor(e.target.value)}><option value="">全部厂商</option>{billingVendors.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></Field><Seg value={managerStatus} onChange={setManagerStatus} options={[{value:'all',label:'全部'},{value:'active',label:'进行中'},{value:'upcoming',label:'未开始'},{value:'ended',label:'已结束'}]}/></div>
      <div className="usage-billing-list">{managedExpenses.length?managedExpenses.map(e=><article className="usage-billing-item" key={`${e.vendor}-${e.from}-${e.to}-${e.currency}`}><div className="usage-billing-brand"><ProviderLogo provider={e.vendor==='custom'?'openai':e.vendor} size={28}/><div><b>{vendorNames[e.vendor]??e.vendor}</b><small>{e.planId?finance?.plans.find(p=>p.id===e.planId)?.name??'订阅套餐':e.subscription!=null?'实付订阅':'按量消费'} · {billStatus(e)==='active'?'进行中':billStatus(e)==='upcoming'?'未开始':'已结束'}</small></div></div><div><b>{e.from} — {e.to}</b><small>订阅 {money(e.subscription,e.currency)} · 按量 {money(e.usage,e.currency)}</small></div><Button size="sm" disabled={loading} onClick={()=>openEditor(e.vendor,e,true)}>编辑账期</Button></article>):<EmptyState icon={<IconWallet size={24}/>} title="暂无匹配账期" desc="添加订阅开始、结束时间和实付费用，即可按月统计。"/>}</div>
    </Modal>}
    {edit&&<Modal title={`${vendorNames[edit.vendor]??edit.vendor} · ${manager?'管理订阅与账期':'记录实际支出'}`} wide onClose={()=>{if(!saving)setEdit(null);}} footer={<>{original?<Button disabled={saving} onClick={()=>void save(true)}>清除此记录</Button>:<Button disabled={saving} onClick={()=>setEdit(null)}>取消</Button>}<span className="spacer"/><Button variant="primary" disabled={saving||!edit.from||!edit.to||edit.from>edit.to} onClick={()=>void save()}>{saving?"保存中…":"保存账期"}</Button></>}>
      {manager&&!original&&<Field label="厂商"><select className="select" disabled={saving} value={edit.vendor} onChange={e=>{setEdit({...edit,vendor:e.target.value,planId:null,currency:e.target.value==='custom'?'USD':'CNY'});setSubscription('');setUsage('');}}>{billingVendors.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></Field>}
      <Field label="订阅套餐"><select className="select" disabled={saving} value={edit.planId??""} onChange={e=>selectPlan(e.target.value)}><option value="">手动填写实付 / 无订阅</option>{finance?.plans.filter(p=>p.vendor===edit.vendor).map(p=><option value={p.id} key={p.id}>{p.name} · {money(p.amount,p.currency)} / {p.months===12?"年":"月"}</option>)}</select></Field>
      {selectedPlan&&<Notice>{selectedPlan.condition} · 核实于 {selectedPlan.verifiedAt}<Button size="sm" onClick={()=>void api.openExternal(selectedPlan.source).catch(e=>toast(errText(e),"error"))}>官网来源</Button></Notice>}
      <div className="usage-rate-fields"><Field label="订阅 / 消费周期开始"><input className="input" type="date" disabled={saving} value={edit.from} onChange={e=>setEdit({...edit,from:e.target.value,to:selectedPlan?endOfSubscription(e.target.value,selectedPlan.months):edit.to})}/></Field><Field label="周期结束（含当日）" hint="可单独调整；自定义结束时间后按实付记录。"><input className="input" type="date" disabled={saving} min={edit.from} value={edit.to} onChange={e=>setEdit({...edit,to:e.target.value,planId:null})}/></Field></div>
      <Field label="币种"><select className="select" value={edit.currency} disabled={saving||!!edit.planId} onChange={e=>{setEdit({...edit,currency:e.target.value});setSubscription("");setUsage("");}}><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option></select></Field>
      <div className="usage-rate-fields"><Field label="订阅费（整个付费周期）" hint="留空表示无订阅，0 表示免费；改为实付金额后不再标注公开价。"><input className="input" type="number" step="any" min="0" disabled={saving} value={subscription} onChange={e=>{setSubscription(e.target.value);if(edit.planId)setEdit({...edit,planId:null});}}/></Field><Field label="该周期按量实际消费" hint="填写实际扣费或账单金额，不填写尚未消费的充值额。"><input className="input" type="number" step="any" min="0" disabled={saving} value={usage} onChange={e=>setUsage(e.target.value)}/></Field></div>
      {editRow?.accounts.map(a=><div className="hint" key={a.id}>{a.label}：累计充值 {money(a.cumulativeRecharge,a.currency)}，累计消费 {money(a.cumulativeSpend,a.currency)}。{a.observedSpend!=null&&<span>已记录区间消费 {money(a.observedSpend,a.currency)}（{when(a.observedFrom)} — {when(a.observedTo)}），请核对与所填周期一致。</span>}</div>)}
      <p className="hint">订阅时间独立保存，不随统计月份切换。跨月费用按自然日分摊；年付填写全年实付总额。保存后重新计算当前月份。</p>
    </Modal>}
  </div>;
}

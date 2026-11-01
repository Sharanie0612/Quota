import {save as saveDialog} from '@tauri-apps/plugin-dialog';
import {useEffect,useMemo,useRef,useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import {api,errText} from '../lib/api';
import {vendorRows,vendorNames,endOfSubscription,expensePortions} from '../lib/vendorCosts';
import {monthKey,monthRange,shiftMonth,restoreUsageRange} from '../lib/usageMonths';
import {localDay} from '../lib/usageAnalytics';
import {cny,convertedExpense} from '../lib/usageCny';
import type {ActivityReport,VendorCostReport,VendorExpense,MonthlyUsageRate} from '../lib/types';
import {Button,Field,Modal,Notice,Seg} from '../components/ui';
import {IconPlus,IconRefresh} from '../components/icons';
import {UsageOverview} from '../components/UsageOverview';
import {SpendingHistory} from '../components/SpendingHistory';
import {ActualUsagePrices} from '../components/ActualUsagePrices';
import {toast} from '../lib/store';
import './usage-workbench.css';

const initialRange=()=>{try{return restoreUsageRange(localStorage.getItem('quota-my-usage-range'));}catch{return restoreUsageRange(null);}};
type Data={key:string;activity:ActivityReport;finance:VendorCostReport};
export function UsageCostsView(){
  const [range,setRange]=useState<{mode:string;from:string;to:string}>(initialRange),[tab,setTab]=useState('overview'),[vendor,setVendor]=useState('');
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [rates,setRates]=useState<MonthlyUsageRate[]>([]),[fxError,setFxError]=useState(''),[fxBusy,setFxBusy]=useState(false),[fxOpen,setFxOpen]=useState(false),[fxReload,setFxReload]=useState(0);
  const [custom,setCustom]=useState(false),[draftFrom,setDraftFrom]=useState(''),[draftTo,setDraftTo]=useState('');
  const [edit,setEdit]=useState<VendorExpense|null>(null),[original,setOriginal]=useState<VendorExpense|null>(null);
  const [kind,setKind]=useState('subscription'),[subscription,setSubscription]=useState(''),[usage,setUsage]=useState(''),[saving,setSaving]=useState(false);
  const reload=useRef<()=>void>(()=>{});
  const {from,to}=range,currentMonth=monthKey(),query=`${from}|${to}|${vendor}`;
  const ready=data?.key===query,activity=ready?data.activity:null,finance=ready?data.finance:null;
  useEffect(()=>{
    let live=true,inFlight=false,queued=false;setError('');
    const load=async()=>{if(!live)return;if(inFlight){queued=true;return;}inFlight=true;
      do{queued=false;try{const [a,f]=await Promise.all([api.getActivity('','without-trae',0,vendor?`vendor:${vendor}`:'',from,to),api.getVendorCosts(from,to)]);if(live){setData({key:query,activity:a,finance:f});setError('');}}catch(e){if(live)setError(errText(e));}}while(queued&&live);inFlight=false;
    };
    reload.current=()=>void load();void load();
    const events=['activity-updated','accounts-updated'].map(name=>listen(name,()=>void load()));
    return()=>{live=false;for(const event of events)void event.then(stop=>stop()).catch(()=>{});};
  },[query,from,to,vendor]);
  const months=useMemo(()=>[...new Set([
    ...(finance?.expenses??[]).filter(e=>(!vendor||e.vendor===vendor)&&e.currency==='USD'&&e.from<=to&&e.to>=from).flatMap(e=>expensePortions(e,from,to).map(p=>p.month)),
    ...(finance?.history??[]).filter(row=>(!vendor||row.vendor===vendor)&&row.currency==='USD').map(row=>localDay(new Date(row.at*1000)).slice(0,7))
  ])].sort(),[finance,from,to,vendor]);
  const fxKey=months.join('|');
  useEffect(()=>{
    let live=true;setFxError('');
    if(!fxKey){setRates([]);setFxBusy(false);return;}
    setFxBusy(true);void api.getMonthlyUsageFx(fxKey.split('|')).then(result=>{if(live){setRates(result.rates);setFxError(result.error??'');}}).catch(e=>{if(live)setFxError(errText(e));}).finally(()=>{if(live)setFxBusy(false);});
    return()=>{live=false;};
  },[fxKey,fxReload]);
  useEffect(()=>{if(!fxKey)return;const timer=setInterval(()=>setFxReload(n=>n+1),3600000);return()=>clearInterval(timer);},[fxKey]);
  const rows=useMemo(()=>finance&&activity?vendorRows(activity.models,finance,from,to,rates).filter(row=>!vendor||row.id===vendor):[],[finance,activity,from,to,rates,vendor]);
  const applyRange=(mode:string,first:string,last:string)=>{const next={mode,from:first,to:last};setRange(next);try{localStorage.setItem('quota-my-usage-range',JSON.stringify(next));}catch{/* Optional preference. */}};
  const chooseMonth=(value:string)=>{const dates=monthRange(value);if(dates)applyRange('month',dates.from,dates.to);};
  const openCustom=()=>{setDraftFrom(range.mode==='all'?monthRange(currentMonth)!.from:from);setDraftTo(range.mode==='all'?localDay():to);setCustom(true);};
  const preset=(mode:string)=>{if(mode==='custom'){openCustom();return;}if(mode==='all'){applyRange('all','1900-01-01','9999-12-31');return;}if(mode==='month'){chooseMonth(currentMonth);return;}const first=new Date();if(mode==='year')first.setMonth(0,1);else first.setDate(first.getDate()-(mode==='week'?6:89));applyRange(mode,localDay(first),localDay());};
  const openEditor=(id=vendor||'custom',record?:VendorExpense)=>{
    const first=range.mode==='month'?from:localDay(),last=range.mode==='month'?to:endOfSubscription(first,1);
    setOriginal(record?{...record}:null);setEdit(record?{...record}:{vendor:id,from:first,to:last,currency:id==='custom'?'USD':'CNY',subscription:null,usage:null,planId:null});
    setKind(record?.subscription!=null&&record?.usage!=null?'both':record?.usage!=null?'usage':'subscription');setSubscription(record?.subscription?.toString()??'');setUsage(record?.usage?.toString()??'');
  };
  const save=async(remove=false)=>{
    if(!edit)return;const parse=(text:string)=>text.trim()?Number(text):null;
    const a=remove||kind==='usage'?null:parse(subscription),b=remove||kind==='subscription'?null:parse(usage);
    if(!remove&&a==null&&b==null){toast('请填写实付金额','error');return;}
    if([a,b].some(value=>value!=null&&(!Number.isFinite(value)||value<0||value>1e9))){toast('请输入有效的非负金额','error');return;}
    setSaving(true);try{await api.saveVendorExpense({...(remove?original??edit:edit),subscription:a,usage:b,planId:remove?null:edit.planId},original);setEdit(null);setOriginal(null);reload.current();toast(remove?'已删除支出':'已记录支出');}catch(e){toast(errText(e),'error');}finally{setSaving(false);}
  };
  const update=async()=>{setBusy(true);try{const result=await Promise.allSettled([api.refreshActivity(),api.refreshAll()]);reload.current();const failed=result.filter(row=>row.status==='rejected');if(failed.length)toast('部分来源更新失败，请在设置中查看','error');}finally{setBusy(false);}};
  const exportCsv=async(contents:string,suffix:string)=>{try{const path=await saveDialog({title:'导出当前统计',defaultPath:`Quota-${suffix}-${localDay()}.csv`,filters:[{name:'CSV 报表',extensions:['csv']}]});if(path){await api.exportReportCsv(path,contents);toast('报表已导出');}}catch(e){toast(errText(e),'error');}};
  const selectedPlan=finance?.plans.find(plan=>plan.id===edit?.planId);
  const choosePlan=(id:string)=>{const plan=finance?.plans.find(row=>row.id===id&&row.vendor===edit?.vendor);if(!edit)return;if(!plan){setEdit({...edit,planId:null});return;}setKind('subscription');setSubscription(String(plan.amount));setEdit({...edit,planId:plan.id,currency:plan.currency,to:endOfSubscription(edit.from,plan.months)});};
  const editAmount=edit?convertedExpense({...edit,subscription:kind==='usage'?null:subscription.trim()?Number(subscription):null,usage:kind==='subscription'?null:usage.trim()?Number(usage):null},edit.from,edit.to,rates):null;
  const missing=finance?.expenses.some(e=>(!vendor||e.vendor===vendor)&&e.currency==='USD'&&e.from<=localDay()&&convertedExpense(e,from,to,rates).missingMonths.length);
  const vendors=Object.entries(vendorNames).filter(([id])=>['custom','deepseek','mimo','moonshot','zhipu'].includes(id)||finance?.expenses.some(e=>e.vendor===id)||rows.some(row=>row.id===id));
  return <div className="content-inner usage-costs usage-simple">
    <header className="usage-heading"><h1>我的使用</h1><div><Button variant="quiet" aria-label="更新我的使用" disabled={busy} onClick={()=>void update()}><IconRefresh size={17} className={busy?'spin':''}/></Button><Button variant="primary" onClick={()=>openEditor()}><IconPlus size={16}/>记录支出</Button></div></header>
    <div className="usage-toolbar">
      <div className="usage-date-control">{range.mode==='month'?<><Button variant="quiet" aria-label="上一个月" disabled={!shiftMonth(from.slice(0,7),-1)} onClick={()=>chooseMonth(shiftMonth(from.slice(0,7),-1)!)}>‹</Button><input className="input" aria-label="统计月份" type="month" value={from.slice(0,7)} onChange={event=>chooseMonth(event.target.value)}/><Button variant="quiet" aria-label="下一个月" disabled={!shiftMonth(from.slice(0,7),1)} onClick={()=>chooseMonth(shiftMonth(from.slice(0,7),1)!)}>›</Button></>:<Button variant="quiet" onClick={openCustom}>{range.mode==='all'?'全部历史':`${from} — ${to}`}</Button>}</div>
      <select className="select" aria-label="统计时间范围" value={['month','week','quarter','year','all'].includes(range.mode)?range.mode:'custom'} onChange={event=>preset(event.target.value)}><option value="month">按月查看</option><option value="week">近 7 天</option><option value="quarter">近 90 天</option><option value="year">今年</option><option value="all">全部历史</option><option value="custom">自定义日期</option></select>
      <select className="select" aria-label="统计厂商" value={vendor} onChange={event=>setVendor(event.target.value)}><option value="">全部厂商</option>{vendors.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select>
      <Button size="sm" variant="quiet" onClick={()=>{setFxOpen(true);}}>{fxBusy?'汇率更新中':'人民币 · 月均汇率'}</Button>
    </div>
    <div className="usage-view-tabs"><Seg value={tab} onChange={setTab} options={[{value:'overview',label:'总览'},{value:'history',label:'消费记录'},{value:'prices',label:'实际单价'}]}/></div>
    {error&&<Notice tone="error" actions={<Button onClick={()=>reload.current()}>重试</Button>}>{error}</Notice>}
    {!ready&&!error&&<section className="card usage-cost-placeholder" role="status">正在读取记录…</section>}
    {ready&&fxError&&missing&&<Notice tone="warn" actions={<Button onClick={()=>setFxReload(n=>n+1)}>获取汇率</Button>}>部分美元支出等待月均汇率，人民币合计暂不显示。</Notice>}
    {ready&&activity&&finance&&tab==='overview'&&<UsageOverview activity={activity} finance={finance} from={from} to={to} vendor={vendor} rates={rates} onAdd={()=>openEditor()} onVendor={id=>{setVendor(id);setTab('prices');}} onExport={(contents,suffix)=>void exportCsv(contents,suffix)}/>}
    {ready&&finance&&tab==='history'&&<SpendingHistory finance={finance} from={from} to={to} vendor={vendor} rates={rates} onEdit={record=>openEditor(record.vendor,record)} onAdd={()=>openEditor()} onExport={(contents,suffix)=>void exportCsv(contents,suffix)}/>}
    {ready&&tab==='prices'&&<ActualUsagePrices rows={rows} onRecord={id=>openEditor(id)} onEdit={record=>openEditor(record.vendor,record)}/>}
    {!!activity?.errors.length&&<Notice tone="warn">{activity.errors.join('；')}</Notice>}
    {!!activity?.syncErrors?.length&&<Notice tone="warn">{activity.syncErrors.join('；')}</Notice>}
    {custom&&<Modal title="选择统计日期" onClose={()=>setCustom(false)} footer={<><Button onClick={()=>setCustom(false)}>取消</Button><Button variant="primary" disabled={!draftFrom||!draftTo||draftFrom>draftTo} onClick={()=>{applyRange('custom',draftFrom,draftTo);setCustom(false);}}>应用日期</Button></>}><div className="usage-rate-fields"><Field label="开始日期"><input className="input" type="date" aria-label="统计开始日期" value={draftFrom} onChange={event=>setDraftFrom(event.target.value)}/></Field><Field label="结束日期"><input className="input" type="date" aria-label="统计结束日期" value={draftTo} min={draftFrom} onChange={event=>setDraftTo(event.target.value)}/></Field></div></Modal>}
    {fxOpen&&<Modal title="人民币换算" onClose={()=>setFxOpen(false)} footer={<><Button onClick={()=>setFxReload(n=>n+1)} disabled={fxBusy}>重新获取</Button><Button variant="primary" onClick={()=>setFxOpen(false)}>完成</Button></>}><p>美元费用按所属月份已公布日汇率的平均值折算。本月均值随新报价更新，原币金额保留。</p>{fxError&&<Notice tone="warn">{fxError}</Notice>}<div className="usage-fx-rates">{months.length?months.map(month=>{const rate=rates.find(row=>row.month===month);return <div key={month}><b>{month}</b><span>{rate?`$1 = ¥${rate.cnyPerUsd.toFixed(4)}`:'尚无可用均值'}</span><time>{rate?`截至 ${rate.date}`:''}</time></div>;}):<p>当前范围没有需要换算的美元支出。</p>}</div></Modal>}
    {edit&&<Modal title={original?'编辑支出':'记录支出'} onClose={()=>{if(!saving)setEdit(null);}} footer={<>{original&&<Button disabled={saving} onClick={()=>void save(true)}>删除记录</Button>}<span className="spacer"/><Button disabled={saving} onClick={()=>setEdit(null)}>取消</Button><Button variant="primary" disabled={saving||!edit.from||!edit.to||edit.from>edit.to} onClick={()=>void save()}>{saving?'保存中…':'保存支出'}</Button></>}>
      <div className="usage-rate-fields"><Field label="厂商"><select className="select" value={edit.vendor} disabled={saving||!!original} onChange={event=>{setEdit({...edit,vendor:event.target.value,currency:event.target.value==='custom'?'USD':'CNY',planId:null});}}>{vendors.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></Field><Field label="费用类型"><select className="select" value={kind} onChange={event=>{setKind(event.target.value);setEdit({...edit,planId:null});}}><option value="subscription">订阅费</option><option value="usage">按量消费</option><option value="both">订阅与按量</option></select></Field></div>
      <div className="usage-rate-fields">{kind!=='usage'&&<Field label={kind==='both'?'订阅实付':'实付金额'}><input className="input" aria-label="订阅实付金额" type="number" min="0" step="any" autoFocus value={subscription} onChange={event=>{setSubscription(event.target.value);setEdit({...edit,planId:null});}}/></Field>}{kind!=='subscription'&&<Field label={kind==='both'?'按量实付':'实付金额'}><input className="input" aria-label="按量实付金额" type="number" min="0" step="any" value={usage} onChange={event=>setUsage(event.target.value)}/></Field>}<Field label="原币"><select className="select" value={edit.currency} onChange={event=>setEdit({...edit,currency:event.target.value,planId:null})}><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option></select></Field></div>
      <div className="usage-rate-fields"><Field label="费用开始日期"><input className="input" type="date" value={edit.from} onChange={event=>setEdit({...edit,from:event.target.value,planId:null})}/></Field><Field label="费用结束日期"><input className="input" type="date" min={edit.from} value={edit.to} onChange={event=>setEdit({...edit,to:event.target.value,planId:null})}/></Field></div>
      {edit.currency==='USD'&&<p className="usage-conversion-preview">{editAmount?.total!=null?`计入人民币约 ${cny(editAmount.total)}`:'保存原币金额，按对应月均汇率换算'}</p>}
      {kind==='subscription'&&<details className="usage-plan-picker"><summary>选择已有套餐</summary><select className="select" aria-label="订阅套餐" value={edit.planId??''} onChange={event=>choosePlan(event.target.value)}><option value="">手动填写实付</option>{finance?.plans.filter(plan=>plan.vendor===edit.vendor).map(plan=><option value={plan.id} key={plan.id}>{plan.name} · {plan.currency} {plan.amount}</option>)}</select>{selectedPlan&&<Button variant="quiet" size="sm" onClick={()=>void api.openExternal(selectedPlan.source)}>查看套餐来源</Button>}</details>}
    </Modal>}
  </div>;
}

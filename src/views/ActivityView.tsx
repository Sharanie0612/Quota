import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errText } from "../lib/api";
import { activityFilterLabel, activityModelName } from "../lib/activityModels";
import { toast } from "../lib/store";
import { newActivityIssues } from "../lib/activityIssues";
import { accessNames, launcherNames, softwareNames, vendorNames, emptyActivityFilters, loadActivityFilters, saveActivityFilters } from "../lib/activityWorkspace";
import { Button, EmptyState, Field, Notice, Seg } from "../components/ui";
import { ActivityCharts } from "../components/ActivityCharts";
import { ActivityShares } from '../components/ActivityShares';
import { ActivityModelPicker } from "../components/ActivityModelPicker";
import { ActivityAttribution } from "../components/ActivityAttribution";
import { IconChart, IconGear, IconRefresh } from "../components/icons";
import type { ActivityFilters, ActivityGroup, ActivityReport } from "../lib/types";
import type { ActivityMetric, ActivityRange } from "../lib/activityCharts";
import "./activity-controls.css";
const number = (n: number) => new Intl.NumberFormat("zh-CN").format(n);
function ActivityNumber({value,compact}:{value:number|undefined;compact:boolean}) {
  const element=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    const node=element.current;
    if(!node||compact)return;
    let disposed=false;
    const fit=()=>{
      if(disposed)return;
      node.style.fontSize="";
      const text=node.firstElementChild as HTMLElement;
      const available=node.clientWidth;
      if(!available)return;
      // Measure the actual glyphs, including separators, instead of estimating from digit count.
      for(let attempt=0;attempt<3;attempt++){
        const width=text.getBoundingClientRect().width;
        if(width<=available)break;
        node.style.fontSize=`${parseFloat(getComputedStyle(node).fontSize)*available/width*.99}px`;
      }
    };
    fit();
    const observer=new ResizeObserver(fit);
    observer.observe(node);
    void document.fonts.ready.then(fit);
    return()=>{disposed=true;observer.disconnect();node.style.fontSize="";};
  },[value,compact]);
  return <b ref={element} title={value==null?"":number(value)}><span className="activity-number-content">{value==null?"—":compact?new Intl.NumberFormat("zh-CN",{notation:"compact",maximumFractionDigits:2}).formatToParts(value).map((part,index)=><span key={index} className={part.type==="compact"?"activity-summary-unit":undefined}>{part.value}</span>):number(value)}</span></b>;
}

export function ActivityView({onOpenSyncSettings}:{onOpenSyncSettings?:()=>void}) {
  const [initial]=useState(loadActivityFilters);
  const [filters,setFilters]=useState(initial.filters);
  const [days,setDays]=useState(initial.days);
  const [model,setModel]=useState(initial.model);
  const [compactNumbers,setCompactNumbers]=useState(true);
  const format=(n:number)=>compactNumbers?new Intl.NumberFormat("zh-CN",{notation:"compact",maximumFractionDigits:2}).format(n):number(n);
  const [metric,setMetric]=useState<ActivityMetric>("total");
  const [selection,setSelection]=useState<{query:string;range:ActivityRange}|null>(null);
  const [more,setMore]=useState(false);
  const modelScope=JSON.stringify([filters,days]);const query=JSON.stringify([filters,days,model]);
  const range=selection?.query===query?selection.range:null;const detailQuery=JSON.stringify([query,range]);
  const [rangeReport,setRangeReport]=useState<{query:string;value:ActivityReport}|null>(null);
  const [report,setReport]=useState<{query:string;scope:string;value:ActivityReport}|null>(null);
  const data=report?.query===query?report.value:null;
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  const [readError,setReadError]=useState("");const [rangeError,setRangeError]=useState("");const [syncError,setSyncError]=useState("");
  const [reloadKey,setReloadKey]=useState(0);const requestId=useRef(0);
  useEffect(()=>{saveActivityFilters(filters,days,model);setSelection(null);},[query]);
  useEffect(()=>{if(newActivityIssues([...(data?.errors??[]),...(syncError?[syncError]:[])]))toast("部分来源尚未采集完整，可在采集来源中查看详情。");},[data?.errors,syncError]);
  const load=useCallback(async()=>{const id=++requestId.current;setLoading(true);setReadError("");
    try{const value=await api.getActivity("","",Number(days),model,"","",filters);if(id===requestId.current)setReport({query,scope:modelScope,value});}
    catch(e){if(id===requestId.current)setReadError(errText(e));}finally{if(id===requestId.current)setLoading(false);}
  },[filters,days,model,query,modelScope]);
  useEffect(()=>{let disposed=false;let timer:number;const poll=async()=>{await load();if(!disposed)timer=window.setTimeout(()=>void poll(),15000);};void poll();return()=>{disposed=true;clearTimeout(timer);++requestId.current;};},[load,reloadKey]);
  useEffect(()=>{let disposed=false;let cleanup:(()=>void)|undefined;void listen("activity-updated",()=>setReloadKey(k=>k+1)).then(un=>{if(disposed)un();else cleanup=un;}).catch(()=>undefined);return()=>{disposed=true;cleanup?.();};},[]);
  useEffect(()=>{let live=true;setRangeError("");if(!range)return;void api.getActivity("","",Number(days),model,range.from,range.to,filters).then(value=>{if(live)setRangeReport({query:detailQuery,value});}).catch(e=>{if(live)setRangeError(errText(e));});return()=>{live=false;};},[detailQuery,reloadKey,report]);
  const refresh=async()=>{if(busy)return;setBusy(true);try{await api.refreshActivity();setSyncError("");setReloadKey(k=>k+1);}catch(e){setSyncError(errText(e));}finally{setBusy(false);}};
  const patchFilters=(patch:Partial<ActivityFilters>)=>setFilters(value=>({...value,...patch}));
  const clearFilters=()=>{setFilters({...emptyActivityFilters});setModel("");setSelection(null);};
  const totals=data?.totals;
  const unavailableTokens=data?.coverage?.tokenRecords===0&&!!totals?.calls;
  const choices=data??report?.value;const facets=choices?.facets;
  const availableModels=data?.availableModels??(report?.scope===modelScope?report.value.availableModels:[])??[];
  const hasActivity=!!totals&&(totals.tokens.total>0||totals.calls>0||totals.sessions>0);
  const detailData=range?rangeReport?.query===detailQuery?rangeReport.value:null:data;
  const devices=choices?.devices??[];
  const environmentLabel=(id:string)=>{const found=devices.find(d=>d.id===id);return found?`${found.name}${devices.some(d=>d.id!==id&&d.name===found.name)?` · ${id.slice(0,8)}`:""}`:`环境 ${id.slice(0,8)}`;};
  const label=(key:keyof ActivityFilters,value:string)=>(key==='software'?softwareNames[value]:key==='launcher'?launcherNames[value]:key==='access'?accessNames[value]:key==='vendor'?vendorNames[value]:environmentLabel(value))??value;
  const chips=(Object.entries(filters) as [keyof ActivityFilters,string][]).filter(([,v])=>v);
  const choose=(title:string,key:keyof ActivityFilters,rows:ActivityGroup[]|undefined,names:Record<string,string>,all:string)=> <Field label={title}><select className="select" aria-label={`统计${title}`} value={filters[key]} onChange={e=>patchFilters({[key]:e.target.value})}><option value="">{all}</option>{[...new Set([...(rows??[]).map(r=>r.key),...(filters[key]?[filters[key]]:[])])].map(value=><option key={value} value={value}>{names[value]??(key==='environment'?environmentLabel(value):value)}</option>)}</select></Field>;
  const status=loading?'正在读取统计…':data?.updatedAt?`采集于 ${new Date(data.updatedAt).toLocaleString('zh-CN')}`:'尚未采集';
  return <div className="content-inner activity-page">
    {rangeError&&<Notice tone="error">{rangeError}</Notice>}
    <section className="card activity-controls activity-workspace-controls" aria-label="活动筛选与采集">
      <div className="activity-controls-main"><Seg value={days} onChange={setDays} options={[{value:'0',label:'全部历史'},{value:'7',label:'7 天'},{value:'30',label:'30 天'},{value:'90',label:'90 天'},{value:'365',label:'1 年'}]}/><div className="activity-controls-actions"><Button variant="primary" disabled={busy} onClick={()=>void refresh()}><IconRefresh size={14} className={busy?'spin':''}/>{busy?'更新中…':'更新用量'}</Button><Button variant="quiet" onClick={onOpenSyncSettings}><IconGear size={15}/>采集来源</Button></div></div>
      <div className="activity-visible-filters">
        {choose('软件','software',facets?.softwares??choices?.sources,softwareNames,'全部软件')}
        {choose('环境','environment',facets?.environments??choices?.byDevice,{},'全部环境')}
        <Field label="模型"><ActivityModelPicker key={modelScope} rows={availableModels} value={model} onChange={setModel} loading={loading} softwareView/></Field>
      </div>
      <div className="activity-controls-context"><Button size="sm" variant="quiet" aria-expanded={more} aria-controls="activity-more-filters" onClick={()=>setMore(v=>!v)}>更多筛选{filters.launcher||filters.access||filters.vendor?' · 已选':''} {more?'⌃':'⌄'}</Button><span className="activity-scope-summary">{chips.length||model?'':"全部软件 · 全部环境 · 全部模型"}</span><span className="activity-collection-status" role="status">{status}</span></div>
      <div id="activity-more-filters" className="activity-more-fields" hidden={!more}>
        {choose('调度入口','launcher',facets?.launchers,launcherNames,'全部入口')}
        {choose('接入方式','access',facets?.accesses,accessNames,'全部接入')}
        {choose('模型厂商','vendor',facets?.vendors,vendorNames,'全部厂商')}
      </div>
      {(chips.length>0||model||range)&&<div className="activity-filter-chips" aria-label="当前筛选">{chips.map(([key,value])=><button key={key} onClick={()=>patchFilters({[key]:''})} aria-label={`移除筛选 ${label(key,value)}`}>{label(key,value)} <span aria-hidden="true">×</span></button>)}{model&&<button onClick={()=>setModel('')} aria-label="移除模型筛选">{activityFilterLabel(model)} ×</button>}{range&&<button onClick={()=>setSelection(null)}>{range.from} — {range.to} ×</button>}<Button size="sm" variant="quiet" onClick={clearFilters}>清空筛选</Button></div>}
    </section>
    {readError&&<Notice tone="warn" actions={<Button size="sm" disabled={loading} onClick={()=>void load()}>重试读取</Button>}><b>统计读取未完成</b><div>{readError}</div></Notice>}
    {(data?.errors.length||syncError)?<Notice tone="warn"><b>部分来源尚未采集完整</b><details className="activity-error-details"><summary>查看采集详情</summary><ul>{[...new Set([...(data?.errors??[]),...(syncError?[syncError]:[])])].map(message=><li key={message}>{message}</li>)}</ul></details></Notice>:null}
    <section className="card activity-overview" aria-label="用量概览" aria-busy={loading}>
    <div className="activity-summary-toolbar"><h3>用量概览</h3><button className="activity-number-format" aria-label={compactNumbers?"切换为完整数字":"切换为简写"} onClick={()=>setCompactNumbers(v=>!v)}><span aria-hidden="true">123</span>{compactNumbers?"简写":"完整数字"}<span aria-hidden="true">⇄</span></button></div>
    <div className={`activity-summary${compactNumbers?"":" activity-summary-full"}`}>
      {[{label:"总 Token",value:totals?.tokens.total,key:"total"},{label:"输入",value:totals?.tokens.input,key:"input"},{label:"输出",value:totals?.tokens.output,key:"output"},{label:"工具调用",value:totals?.calls,key:"tools"},{label:"会话",value:totals?.sessions,key:"sessions"}].map(item=>{
        const isMetric=["total","input","output"].includes(item.key);
        const selected=metric===item.key||(item.key==="input"&&["cached","uncached"].includes(metric));
        const Tag=isMetric?'button':'div';
        return <Tag key={item.key} className={item.key==="total"?"activity-summary-primary":isMetric?undefined:"activity-summary-secondary"} aria-pressed={isMetric?selected:undefined} onClick={isMetric?()=>setMetric(item.key as ActivityMetric):undefined}>
          <span className="activity-summary-label">{item.label}</span>
          <ActivityNumber value={unavailableTokens&&isMetric?undefined:item.value} compact={compactNumbers}/>
        </Tag>;
      })}
    </div>
    {["input","cached","uncached"].includes(metric)&&<div className="input-cache-controls"><Seg value={metric} onChange={v=>setMetric(v as ActivityMetric)} options={[{value:"input",label:"全部输入"},{value:"cached",label:"缓存命中"},{value:"uncached",label:"未命中"}]}/><span>{data?.coverage?.knownCacheInput?`已知输入命中率 ${((data.cache??data.models).reduce((sum,r)=>sum+r.tokens.cached,0)/data.coverage.knownCacheInput*100).toFixed(1)}%`:totals?.tokens.input?`命中率 ${(totals.tokens.cached/totals.tokens.input*100).toFixed(1)}%`:"暂无输入"}</span></div>}
    </section>

    {data?.coverage&&data.coverage.knownCacheInput<data.coverage.allInput&&<p className="hint activity-coverage">部分来源未提供缓存细分；命中率仅按已知缓存输入计算。</p>}
    {!data ? <section className="card activity-placeholder" role="status"><p>{loading ? "正在读取当前范围的活动记录…" : "读取失败后可重试；尚未获得统计结果。"}</p></section>
      : !hasActivity ? <section className="card activity-placeholder"><EmptyState icon={<IconChart size={26} />} title="当前范围暂无活动"
        desc={data.updatedAt ? "试试其他软件、环境或更长的时间范围。" : "点击「更新用量」，读取本机仍保留的历史用量。"}
        action={data.updatedAt ? <Button onClick={() => { clearFilters(); setDays("0"); }}>查看全部历史</Button> : undefined} /></section>
        : <>
          <div id="activity-charts"><ActivityCharts key={query} rows={["cached","uncached"].includes(metric)?data.cacheDaily??data.daily:data.daily} days={Number(days)} hourly={["cached","uncached"].includes(metric)?data.cacheHourly??data.hourly??[]:data.hourly??[]} format={format} model={model} metric={metric} setMetric={setMetric} range={range} onRange={range=>setSelection(range ? {query,range} : null)} /></div>
          {detailData&&<ActivityShares report={detailData} format={format} onModel={key=>setModel(`model:${activityModelName(key)}`)} onSource={key=>patchFilters({software:key})} onMetric={setMetric}/>}
          {detailData?.details&&<ActivityAttribution report={detailData} onFilter={patchFilters}/>}
        </>}
  </div>;
}

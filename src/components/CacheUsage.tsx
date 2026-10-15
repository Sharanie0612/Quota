import { useState } from "react";
import type { ActivityGroup } from "../lib/types";
import { activityChannelName, activityModelChannel, activityModelName } from "../lib/activityModels";
import { ModelLogo } from "./ModelLogo";
import { Button } from "./ui";
export function CacheUsage({rows,format,onModel}: {rows:ActivityGroup[];format:(n:number)=>string;onModel:(key:string)=>void}) {
  const [expanded,setExpanded] = useState(false);
  const models = [...rows].filter(row=>row.tokens.input>0).sort((a,b)=>b.tokens.input-a.tokens.input);
  const input = models.reduce((sum,row)=>sum+row.tokens.input,0);
  const cached = models.reduce((sum,row)=>sum+Math.min(row.tokens.input,Math.max(0,row.tokens.cached)),0);
  const rate = input ? cached/input : 0;
  return <section className="card cache-usage"><div className="cache-heading"><h3>缓存命中</h3><span className="hint">占输入 Token 的比例</span></div>
    <div className="cache-summary"><b>{input ? `${(rate*100).toFixed(1)}%` : "—"}<small>总体命中率</small></b><div className="cache-summary-detail"><div className="cache-bar" role="img" aria-label={`总体缓存命中率 ${(rate*100).toFixed(1)}%`}><span style={{width:`${rate*100}%`}}/></div><div><span>已命中 <b>{format(cached)}</b></span><span>未命中 <b>{format(Math.max(0,input-cached))}</b></span></div></div></div>
    <div className="cache-model-list">{(expanded ? models : models.slice(0,6)).map(row=>{
      const hit = Math.min(row.tokens.input,Math.max(0,row.tokens.cached));
      const rate = hit/row.tokens.input;
      const name = activityModelName(row.key) || "未知模型";
      const channel = activityChannelName(activityModelChannel(row.key));
      return <button className="cache-model-row" key={row.key} title={`${name}${channel ? ` · ${channel}` : ""} · 命中 ${format(hit)} · 未命中 ${format(row.tokens.input-hit)}`} onClick={()=>onModel(row.key)}><ModelLogo name={name} size={18}/><span className="cache-model-content"><span className="cache-model-label"><span>{name}{channel && <span className="activity-channel-tag">{channel}</span>}</span><b>{(rate*100).toFixed(1)}%</b></span><span className="cache-bar" aria-hidden="true"><span style={{width:`${rate*100}%`}}/></span><span className="cache-model-values">命中 {format(hit)} · 未命中 {format(row.tokens.input-hit)}</span></span></button>;
    })}</div>{models.length>6&&<Button variant="quiet" size="sm" onClick={()=>setExpanded(value=>!value)}>{expanded ? "收起" : `展开全部 ${models.length} 个模型`}</Button>}{!models.length&&<p className="hint">当前范围暂无输入记录</p>}</section>;
}

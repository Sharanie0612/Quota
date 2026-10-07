import { useMemo, useState } from "react";
import type { ActivityGroup } from "../lib/types";
import { activityModelChoices, activityModelIdentity } from "../lib/activityModels";
import { ModelLogo } from "./ModelLogo";
import "./activity-model-picker.css";
export function ActivityModelPicker({rows,value,onChange,loading}: {rows:ActivityGroup[];value:string;onChange:(key:string)=>void;loading:boolean}) {
  const [search,setSearch]=useState("");
  const models=useMemo(()=>activityModelChoices(rows,search),[rows,search]);
  const vendors=[...new Map(rows.map(row=>{const info=activityModelIdentity(row.key);return [info.provider,info];})).values()];
  return <div className="activity-scope-picker"><input className="input" aria-label="搜索模型或厂商" placeholder="搜索模型或厂商" value={search} onChange={e=>setSearch(e.target.value)}/><select className="select" aria-label="模型或供应商筛选" value={value} onChange={e=>onChange(e.target.value)} disabled={loading&&!rows.length}><option value="">全部模型</option><optgroup label="供应商汇总">{vendors.map(v=><option key={v.provider} value={`vendor:${v.provider}`}>{v.vendor} · 全部模型</option>)}</optgroup>{vendors.map(v=><optgroup key={v.provider} label={v.vendor}>{models.filter(row=>activityModelIdentity(row.key).provider===v.provider).map(row=><option key={row.key} value={row.key}>{row.key}</option>)}</optgroup>)}{value&&!value.startsWith("vendor:")&&!models.some(row=>row.key===value)&&<option value={value}>{value}</option>}</select>{value&&!value.startsWith("vendor:")&&<ModelLogo name={value} size={22}/>}</div>;
}
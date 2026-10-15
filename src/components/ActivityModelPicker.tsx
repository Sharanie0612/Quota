import { useMemo, useState } from "react";
import type { ActivityGroup } from "../lib/types";
import { activityChannelName, activityChannels, activityModelChannel, activityModelChoices, activityModelIdentity, activityModelName } from "../lib/activityModels";
import { ModelLogo } from "./ModelLogo";
import "./activity-model-picker.css";
const channelHints: Record<string, string> = { trae: "Trae 提供（用 Trae 额度）", api: "API 接入（用自带密钥）" };
const label = (key: string) => { const channel = activityChannelName(activityModelChannel(key)); return channel ? `${activityModelName(key)} · ${channel}` : activityModelName(key); };
export function ActivityModelPicker({rows,value,onChange,loading}: {rows:ActivityGroup[];value:string;onChange:(key:string)=>void;loading:boolean}) {
  const [search,setSearch]=useState("");
  const models=useMemo(()=>activityModelChoices(rows,search),[rows,search]);
  const vendors=[...new Map(rows.filter(row=>!activityModelChannel(row.key)).map(row=>{const info=activityModelIdentity(row.key);return [info.provider,info];})).values()];
  const channels=activityChannels(rows);
  const known=value.startsWith("vendor:")||value.startsWith("channel:")||models.some(row=>row.key===value);
  return <div className="activity-scope-picker"><input className="input" aria-label="搜索模型或厂商" placeholder="搜索模型或厂商" value={search} onChange={e=>setSearch(e.target.value)}/><select className="select" aria-label="模型或供应商筛选" value={value} onChange={e=>onChange(e.target.value)} disabled={loading&&!rows.length}><option value="">全部模型</option>{channels.length>0&&<optgroup label="Trae 用量通道">{channels.map(channel=><option key={channel} value={`channel:${channel}`}>{channelHints[channel] ?? activityChannelName(channel)}</option>)}</optgroup>}<optgroup label="供应商汇总">{vendors.map(v=><option key={v.provider} value={`vendor:${v.provider}`}>{v.vendor} · 全部模型</option>)}</optgroup>{vendors.map(v=><optgroup key={v.provider} label={v.vendor}>{models.filter(row=>activityModelIdentity(row.key).provider===v.provider).map(row=><option key={row.key} value={row.key}>{label(row.key)}</option>)}</optgroup>)}{value&&!known&&<option value={value} hidden={!!activityModelChannel(value)}>{label(value)}</option>}</select>{value&&!value.startsWith("vendor:")&&!value.startsWith("channel:")&&<ModelLogo name={activityModelName(value)} size={22}/>}</div>;
}

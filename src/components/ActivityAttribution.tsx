import { useMemo, useState } from 'react';
import type { ActivityDetail, ActivityFilters, ActivityReport } from '../lib/types';
import { accessNames, launcherNames, softwareNames, vendorNames } from '../lib/activityWorkspace';
import { ModelLogo } from './ModelLogo';
import { Button } from './ui';

export function ActivityAttribution({report,onFilter}:{report:ActivityReport;onFilter:(patch:Partial<ActivityFilters>)=>void}){
  const [search,setSearch]=useState('');const [page,setPage]=useState(0);
  const names=new Map(report.devices.map(d=>[d.id,d.name]));
  const rows=useMemo(()=>[...(report.details??[])].filter(r=>`${softwareNames[r.software]??r.software} ${r.model} ${vendorNames[r.vendor]??r.vendor} ${names.get(r.environment)??r.environment} ${launcherNames[r.launcher]??r.launcher}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.tokens.total-a.tokens.total||b.calls-a.calls||a.model.localeCompare(b.model)),[report,search]);
  const current=Math.min(page,Math.max(0,Math.ceil(rows.length/20)-1));
  const count=(n:number)=>new Intl.NumberFormat('zh-CN').format(n);
  const id=(r:ActivityDetail)=>JSON.stringify([r.software,r.launcher,r.environment,r.access,r.model]);
  return <section className="card activity-attribution" aria-label="用量来源明细">
    <div className="activity-detail-heading"><div><h3>用量来源</h3><p className="hint">软件、实际型号与接入分别记录。未保存的历史信息保留未标记。</p></div><input className="input" aria-label="搜索用量来源" placeholder="搜索软件、模型或环境" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></div>
    <div className="activity-model-table-scroll"><table className="activity-model-table activity-attribution-table"><thead><tr><th scope="col">软件 / 入口</th><th scope="col">模型 / 厂商</th><th scope="col">接入</th><th scope="col">环境</th><th scope="col">Token</th><th scope="col">工具调用</th></tr></thead><tbody>{rows.slice(current*20,current*20+20).map(r=><tr key={id(r)}>
      <td><button className="activity-detail-link" onClick={()=>onFilter({software:r.software,launcher:r.launcher})}>{softwareNames[r.software]??r.software}</button><small>{launcherNames[r.launcher]??r.launcher}</small></td>
      <td><span className="activity-detail-model"><ModelLogo name={r.model} size={20}/><span>{r.model}<small>{vendorNames[r.vendor]??r.vendor}</small></span></span></td>
      <td>{accessNames[r.access]??r.access}</td><td><button className="activity-detail-link" onClick={()=>onFilter({environment:r.environment})}>{names.get(r.environment)??`环境 ${r.environment.slice(0,8)}`}</button></td>
      <td title={count(r.tokens.total)}>{count(r.tokens.total)}</td><td>{count(r.calls)}</td>
    </tr>)}</tbody></table></div>
    {!rows.length&&<p className="hint activity-detail-empty">当前条件没有来源明细。</p>}
    {rows.length>20&&<div className="activity-detail-pagination"><span>{rows.length} 组 · 第 {current+1} / {Math.ceil(rows.length/20)} 页</span><Button size="sm" disabled={!current} onClick={()=>setPage(current-1)}>上一页</Button><Button size="sm" disabled={(current+1)*20>=rows.length} onClick={()=>setPage(current+1)}>下一页</Button></div>}
  </section>;
}

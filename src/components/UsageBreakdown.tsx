import {useMemo,useState} from 'react';
import type {ActivityReport} from '../lib/types';
import {activityModelIdentity} from '../lib/activityModels';
import {sumTokens,vendorNames} from '../lib/vendorCosts';
import {reportCsv} from '../lib/usageAnalytics';
import {Button,Seg} from './ui';

export function UsageBreakdown({activity,onExport}:{activity:ActivityReport;onExport:(contents:string,suffix:string)=>void}) {
  const [group,setGroup]=useState('models'),[all,setAll]=useState(false);
  const rows=useMemo(()=>{
    if(group==='devices')return activity.byDevice.map(row=>({...row,name:activity.devices.find(device=>device.id===row.key)?.name??row.key}));
    if(group==='vendors') {
      const groups=new Map<string,typeof activity.models>();
      for(const row of activity.models){const id=activityModelIdentity(row.key).provider;groups.set(id,[...(groups.get(id)??[]),row]);}
      return [...groups].map(([key,models])=>({key,name:vendorNames[key]??key,tokens:sumTokens(models)}));
    }
    return activity.models.map(row=>({...row,name:row.key}));
  },[activity,group]).sort((a,b)=>b.tokens.total-a.tokens.total);
  const total=rows.reduce((sum,row)=>sum+row.tokens.total,0);
  if(!total)return null;
  return <section className="card usage-breakdown">
    <div className="usage-analysis-heading"><div><h2 title="当前日期与厂商范围">用量分布</h2></div><div className="usage-analysis-actions">
      <Seg value={group} onChange={value=>{setGroup(value);setAll(false);}} options={[{value:'models',label:'模型'},{value:'vendors',label:'厂商'},{value:'devices',label:'设备'}]}/>
      <Button size="sm" onClick={()=>onExport(reportCsv(['名称','输入Token','其中缓存命中Token','输出Token','其中推理Token','总Token','占比'],rows.map(row=>[row.name,row.tokens.input,row.tokens.cached,row.tokens.output,row.tokens.reasoning,row.tokens.total,`${(row.tokens.total/total*100).toFixed(2)}%`])),'用量分布')}>导出 CSV</Button>
    </div></div>
    <div className="analytics-table-scroll"><table className="analytics-table"><thead><tr><th>{group==='models'?'模型':group==='vendors'?'厂商':'设备'}</th><th>输入 Token</th><th>输出 Token</th><th>总 Token</th><th>占比</th></tr></thead><tbody>
      {rows.slice(0,all?undefined:6).map((row,index)=><tr key={row.key}><td><div className="usage-breakdown-label"><i style={{background:`var(--chart-${index%5+1})`}}/><b title={row.name}>{row.name}</b></div><div className="usage-breakdown-track"><i style={{width:`${row.tokens.total/total*100}%`,background:`var(--chart-${index%5+1})`}}/></div></td><td>{row.tokens.input.toLocaleString('zh-CN')}</td><td>{row.tokens.output.toLocaleString('zh-CN')}</td><td><b>{row.tokens.total.toLocaleString('zh-CN')}</b></td><td>{(row.tokens.total/total*100).toFixed(1)}%</td></tr>)}
    </tbody></table></div>
    {rows.length>6&&<Button variant="quiet" size="sm" onClick={()=>setAll(value=>!value)}>{all?'收起明细':`查看全部 ${rows.length} 项`}</Button>}
  </section>;
}

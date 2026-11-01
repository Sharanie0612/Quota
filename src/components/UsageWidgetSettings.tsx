import { useEffect, useState } from 'react';
import { api, errText } from '../lib/api';
import { Notice, Seg, Switch } from './ui';
export function UsageWidgetSettings(){
  const [options,setOptions]=useState<Awaited<ReturnType<typeof api.getWidgetOptions>>|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{let live=true;void api.getWidgetOptions().then(o=>{if(live)setOptions(o);}).catch(e=>{if(live)setError(errText(e));});return()=>{live=false;};},[]);
  const save=async(patch:Partial<NonNullable<typeof options>>)=>{if(!options||busy)return;setBusy(true);try{setOptions(await api.saveWidgetOptions({...options,...patch}));setError('');}catch(e){setError(errText(e));}finally{setBusy(false);}};
  return <section className="card section"><h2>用量悬浮窗</h2><div className="setting-row"><div className="txt"><b>贴边显示用量</b><span>查看运行任务与 Token 用量</span></div><Switch label="用量悬浮窗" checked={options?.enabled??false} disabled={!options||busy} onChange={enabled=>void save({enabled})}/></div>{options?.enabled&&<><div className="setting-row"><div className="txt"><b>停靠侧边</b></div><Seg value={options.side} options={[{value:'left',label:'左侧'},{value:'right',label:'右侧'}]} onChange={side=>{if(!busy)void save({side});}}/></div><div className="setting-row"><div className="txt"><b>垂直位置</b></div><select className="select" aria-label="悬浮窗垂直位置" disabled={busy} value={options.heightPercent} onChange={e=>void save({heightPercent:Number(e.target.value)})}>{[25,50,75].map((n,i)=><option key={n} value={n}>{['靠上','居中','靠下'][i]}</option>)}</select></div></>}{error&&<Notice tone="error">{error}</Notice>}</section>;
}

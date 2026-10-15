import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { api, errText, events } from '../lib/api';
import type { ActivityOptions, ActivityReport } from '../lib/types';
import { Button, Notice, Switch } from './ui';
import { ActivityStoragePanel } from './ActivityStoragePanel';
import { AccountSyncPanel } from './AccountSyncPanel';

export function CrossDeviceSyncPanel(){
  const [options,setOptions]=useState<ActivityOptions|null>(null);
  const [report,setReport]=useState<ActivityReport|null>(null);
  const [account,setAccount]=useState<{lastSynced:string|null;error:string|null}|null>(null);
  const [readers,setReaders]=useState<{device:string;version:string|null;compressed:boolean|null}[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const reload=useCallback(async()=>{
    const [o,r,a,p]=await Promise.all([api.getActivityOptions(),api.getActivity(),api.getAccountSyncStatus(),api.getActivityReaders()]);
    setOptions(o);setReport(r);setAccount(a);setReaders(p);return {o,r,a};
  },[]);
  useEffect(()=>{let live=true;void reload().catch(e=>{if(live)setError(errText(e));});const refresh=()=>{if(live)void reload().catch(()=>undefined);};const un=events.onAccountsUpdated(refresh);const activity=events.onActivityUpdated(refresh);return()=>{live=false;void un.then(f=>f());void activity.then(f=>f());};},[reload]);
  const sync=async(o=options)=>{
    if(!o?.syncDir)return;
    setBusy(true);setError('');setMessage('');
    try{
      const results=await Promise.allSettled([api.refreshActivity(),o.syncAccounts?api.syncAccounts():Promise.resolve()]);
      const next=await reload();
      const errors=results.flatMap(r=>r.status==='rejected'?[errText(r.reason)]:[]).concat(next.r.syncErrors??[],next.o.syncAccounts&&next.a.error?[next.a.error]:[]);
      if(errors.length)setError([...new Set(errors)].join('；'));else setMessage('已完成本机同步。云盘传输完成后，另一台设备会自动更新。');
    }catch(e){setError(errText(e));}finally{setBusy(false);}
  };
  const update=async(patch:Partial<ActivityOptions>)=>{
    const current=await api.getActivityOptions();const next={...current,...patch};await api.saveActivityOptions(next);setOptions(next);return next;
  };
  const choose=async()=>{
    setBusy(true);setError('');
    try{const path=await open({directory:true,multiple:false,title:'选择云盘中的 Quota 同步文件夹'});if(typeof path==='string'){const next=await update({syncDir:path});await sync(next);}}catch(e){setError(errText(e));}finally{setBusy(false);}
  };
  const enabled=!!options?.syncDir;
  const errors=[error,...(enabled?(report?.syncErrors??[]):[]),...(enabled&&options?.syncAccounts&&account?.error?[account.error]:[])];
  const failed=enabled&&errors.some(Boolean);
  const other=report?.devices.filter(d=>d.id!==options?.deviceId)??[];
  const old=readers.filter(r=>r.compressed!==true).length;
  const last=report?.updatedAt?new Date(report.updatedAt).toLocaleString('zh-CN'):null;
  return <section className="card section cross-device-sync">
    <div className="sync-heading"><div><h2>跨设备同步</h2><p>在其他电脑继续查看同一份账户、用量与订阅账期。密钥和登录信息留在本机。</p></div><span className={`badge ${failed?'bad':enabled?'good':''}`}>{!options?'正在检查':failed?'需要重试':enabled?'已开启':'未开启'}</span></div>
    {!enabled?<><ol className="sync-steps"><li><b>选一个云盘文件夹</b><span>例如 iCloud Drive、OneDrive 或 NAS 中的 QuotaSync。</span></li><li><b>其他电脑选同一个文件夹</b><span>在另一台 Quota 的设置中完成同样的选择。</span></li><li><b>保持 Quota 与云盘运行</b><span>账户、Token 用量、订阅账期、支出和月度参考汇率会自动更新。</span></li></ol><Button variant="primary" disabled={busy||!options} onClick={()=>void choose()}>开启跨设备同步</Button></>:<>
      <div className="sync-overview"><div><small>同步文件夹</small><b>{options?.syncDir.split(/[\\/]/).filter(Boolean).pop()}</b></div><div><small>其他设备</small><b>{other.length?`${other.length} 台已发现`:'等待另一台电脑连接'}</b></div></div>
      <p className="hint">每台电脑只需设置一次。运行时通常每 5 分钟交换数据，关闭自动采集后仍会同步。我的使用复用 Token 活动记录，登录信息仍需在各设备单独连接。</p>
      <div className="tag-row"><Button variant="primary" disabled={busy} onClick={()=>void sync()}>{busy?'同步中…':'立即同步'}</Button><span className="hint">{last?`本机上次检查 ${last}`:'尚未同步'}</span></div>
      {old>0&&<p className="hint">还有 {old} 台设备未确认更新，本机会自动兼容。全部设备更新后可在高级选项中节省空间。</p>}
      {other.length>0&&<details className="sync-devices"><summary>查看已发现的设备</summary>{other.map(d=><div key={d.id}><b>{d.name||'其他电脑'}</b><span className="hint">{readers.find(r=>r.device===d.id)?.version??'版本待确认'}</span></div>)}</details>}
    </>}
    {message&&<Notice>{message}</Notice>}
    {errors.some(Boolean)&&<Notice tone="warn"><b>部分同步未完成，已保存的数据仍保留。</b><details><summary>查看原因</summary><p>{[...new Set(errors.filter(Boolean))].join('；')}</p></details></Notice>}
    {enabled&&<details className="sync-advanced"><summary>高级选项与故障处理</summary>
      <div className="setting-row"><div className="txt"><b>同时同步账户信息</b><span>同步账户名称、余额与额度；不会同步密钥和登录信息。</span></div><Switch checked={options?.syncAccounts??true} label="同时同步账户信息" disabled={busy} onChange={value=>{setBusy(true);void update({syncAccounts:value}).catch(e=>setError(errText(e))).finally(()=>setBusy(false));}}/></div>
      <p className="hint sync-folder">{options?.syncDir}</p><div className="tag-row"><Button size="sm" disabled={busy} onClick={()=>void choose()}>更换文件夹</Button><Button size="sm" disabled={busy} onClick={()=>{setBusy(true);void update({syncDir:''}).then(()=>{setMessage('已停止跨设备同步，本机账户和用量仍保留。');setError('');return reload();}).catch(e=>setError(errText(e))).finally(()=>setBusy(false));}}>停止同步</Button></div>
      <ActivityStoragePanel syncDir={options?.syncDir??''}/><AccountSyncPanel/>
      <p className="hint">本页显示本机处理状态。云盘是否上传完成，请查看云盘客户端；不会删除其他设备的数据。</p>
    </details>}
  </section>;
}

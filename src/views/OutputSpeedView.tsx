import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api,errText } from '../lib/api';
import type { OutputSpeedPoint,OutputSpeedReport } from '../lib/types';
import { speedSeries,speedValue } from '../lib/outputSpeed';
import { Button,EmptyState,Modal,Notice,Seg } from '../components/ui';
import { IconChart,IconRefresh } from '../components/icons';
import { ModelLogo } from '../components/ModelLogo';
import './output-speed.css';
const colors=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)','var(--chart-5)','var(--chart-rest)'];
const rate=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:1});
export function OutputSpeedView({onOpenSyncSettings}:{onOpenSyncSettings:()=>void}){
  const [data,setData]=useState<OutputSpeedReport|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [days,setDays]=useState('7'),[device,setDevice]=useState(''),[model,setModel]=useState(''),[method,setMethod]=useState(false);
  const [hover,setHover]=useState<OutputSpeedPoint|null>(null);const generation=useRef(0);
  const query=JSON.stringify([device,days,model]),activeQuery=useRef(query);activeQuery.current=query;
  const load=useCallback(async()=>{if(activeQuery.current!==query)return;const current=++generation.current;try{const next=await api.getOutputSpeed(device,'codex',Number(days),model);if(current===generation.current){setData(next);setError('');setHover(null);}}catch(e){if(current===generation.current)setError(errText(e));}},[device,days,model,query]);
  useEffect(()=>{void load();const un=listen('activity-updated',()=>void load());return()=>{generation.current++;void un.then(fn=>fn());};},[load]);
  const refresh=async(sync=false)=>{setBusy(true);setError('');try{if(sync)await api.syncActivityNow();else await api.refreshActivity();await load();}catch(e){setError(errText(e));}finally{setBusy(false);}};
  const series=useMemo(()=>speedSeries(data?.points??[]),[data]);
  const all=series.flatMap(s=>s.rows),times=all.map(p=>p.timestamp),rates=all.map(p=>speedValue(p)!);
  const minimum=times.length?times.reduce((a,b)=>Math.min(a,b),Infinity):0,maximum=times.length?times.reduce((a,b)=>Math.max(a,b),-Infinity):1;
  const span=Math.max(3_600_000,maximum-minimum),lo=minimum-(maximum===minimum?span/2:span*.025),hi=maximum+(maximum===minimum?span/2:span*.025);
  const ceiling=Math.max(20,Math.ceil(rates.reduce((a,b)=>Math.max(a,b),0)/20)*20);
  const x=(time:number)=>66+(time-lo)/(hi-lo)*788,y=(value:number)=>350-value/ceiling*308;
  const timeLabel=(time:number)=>new Date(time).toLocaleString('zh-CN',days==='1'?{hour:'2-digit',minute:'2-digit'}:{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const stats=data?.summary;
  return <div className="content-inner speed-page">
    <div className="speed-toolbar"><Seg value={days} onChange={setDays} options={[{value:'1',label:'今天'},{value:'7',label:'7 天'},{value:'30',label:'30 天'},{value:'0',label:'全部'}]}/><div className="speed-actions"><Button size="sm" variant="quiet" onClick={()=>setMethod(true)}>统计口径</Button><Button size="sm" disabled={busy} onClick={()=>void refresh(true)}>同步</Button><Button size="sm" disabled={busy} onClick={()=>void refresh()}><IconRefresh size={14} className={busy?'spin':''}/>{busy?'采集中…':'采集记录'}</Button></div></div>
    <div className="speed-filters"><span className="speed-source">Codex</span><select className="select" aria-label="输出速度设备" value={device} onChange={e=>{setDevice(e.target.value);setModel('');}}><option value="">全部设备</option>{data?.devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><select className="select" aria-label="输出速度模型" value={model} onChange={e=>setModel(e.target.value)}><option value="">全部模型</option>{data?.models.map(name=><option key={name}>{name}</option>)}</select><Button size="sm" variant="quiet" onClick={onOpenSyncSettings}>同步设置</Button></div>
    {error&&<Notice tone="error">{error}</Notice>}
    <div className="speed-summary">{[['平均速度',stats?.average,'tokens/s'],['中位速度',stats?.median,'tokens/s'],['P95 速度',stats?.p95,'tokens/s'],['采样次数',stats?.samples,'次']].map(([label,value,unit])=><section className="card" key={String(label)}><span>{label}</span><div><strong>{rate(value as number|undefined)}</strong><span>{unit}</span></div></section>)}</div>
    <section className="card speed-chart"><div className="speed-chart-heading"><h2>速度趋势</h2><span>tokens/s</span></div>{all.length?<>
      <svg viewBox="0 0 910 410" role="img" aria-label="模型输出速度随时间变化曲线">
        {[0,1,2,3,4].map(i=>{const value=ceiling*i/4;return <g key={i}><line x1="66" x2="854" y1={y(value)} y2={y(value)} className="speed-grid"/><text x="52" y={y(value)+5} textAnchor="end" className="speed-tick">{rate(value)}</text></g>;})}
        {[0,1,2,3,4].map(i=>{const time=lo+(hi-lo)*i/4;return <text key={i} x={x(time)} y="388" textAnchor={i===0?'start':i===4?'end':'middle'} className="speed-tick">{timeLabel(time)}</text>;})}
        {series.map((s,index)=><g key={s.model} style={{color:colors[index%colors.length]}}><path d={s.rows.map((p,i)=>`${i&&p.timestamp-s.rows[i-1].timestamp<=(data?.bucketMinutes??60)*180_000?'L':'M'}${x(p.timestamp)},${y(speedValue(p)!)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>{s.rows.filter((_,i)=>i%Math.max(1,Math.ceil(s.rows.length/180))===0||i===s.rows.length-1).map(p=><g key={p.timestamp}><circle cx={x(p.timestamp)} cy={y(speedValue(p)!)} r="4" fill="var(--surface)" stroke="currentColor" strokeWidth="2"/><circle cx={x(p.timestamp)} cy={y(speedValue(p)!)} r="13" fill="transparent" tabIndex={0} role="button" aria-label={`${p.model} ${timeLabel(p.timestamp)} ${rate(speedValue(p))} tokens/s`} onFocus={()=>setHover(p)} onMouseEnter={()=>setHover(p)} onClick={()=>setHover(p)}><title>{p.model} · {timeLabel(p.timestamp)} · {rate(speedValue(p))} tokens/s · {p.samples} 次</title></circle></g>)}</g>)}
        {hover&&<line x1={x(hover.timestamp)} x2={x(hover.timestamp)} y1="34" y2="350" className="speed-crosshair"/>}
      </svg><div className="speed-inspector" aria-live="polite">{hover?<><ModelLogo name={hover.model} size={21}/><b>{hover.model}</b><span>{timeLabel(hover.timestamp)}</span><strong>{rate(speedValue(hover))} tokens/s</strong><span>{hover.samples} 次</span></>:<span>{(data?.bucketMinutes??60)===5?'按 5 分钟汇总':'按小时汇总'}</span>}</div>
      <div className="speed-legend">{series.map((s,i)=><button key={s.model} onClick={()=>setModel(s.model)}><i style={{background:colors[i%colors.length]}}/>{s.model}</button>)}</div>
    </>:<EmptyState icon={<IconChart size={28}/>} title={data?'暂无输出速度记录':'正在读取记录…'} action={data?<Button onClick={()=>void refresh()} disabled={busy}>采集记录</Button>:undefined}/>}</section>
    {method&&<Modal title="输出速度统计口径" onClose={()=>setMethod(false)} footer={<Button onClick={()=>setMethod(false)}>关闭</Button>}><div className="speed-method"><p>输出速度 = 非推理输出 Token ÷ 客户端记录的文本输出时长。</p><p>仅统计具有完整输出片段计时和逐次用量的响应，排除工具调用响应、工具执行、思考与等待时间。有效样本至少输出 64 Token、持续 0.5 秒，减少短输出和缓冲突发造成的抖动。旧记录缺少计时会留空。</p><p>今天按 5 分钟、其他范围按小时与模型汇总，以输出 Token 总数除以输出时长总和计算；平均速度采用同一口径，中位数和 P95 按有效响应计算。</p><p>速度指标随 Token 活动记录保存、去重并同步。只保存计时与用量，不保存对话内容。</p></div></Modal>}
  </div>;
}

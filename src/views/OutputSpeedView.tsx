import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import {api,errText} from '../lib/api';
import type {OutputSpeedPoint,OutputSpeedReport} from '../lib/types';
import {speedBucketLabel,speedBuckets,speedSeries,speedValue} from '../lib/outputSpeed';
import {useChartSize} from '../lib/useChartSize';
import {Button,EmptyState,Modal,Notice,Seg} from '../components/ui';
import {IconChart,IconRefresh} from '../components/icons';
import {ModelLogo} from '../components/ModelLogo';
import './output-speed.css';
const colors=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)','var(--chart-5)','var(--chart-rest)'];
const rate=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:1});
export function OutputSpeedView({onOpenSyncSettings}:{onOpenSyncSettings:()=>void}){
  const [data,setData]=useState<OutputSpeedReport|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [range,setRange]=useState('1h'),[resolution,setResolution]=useState('0'),[device,setDevice]=useState(''),[model,setModel]=useState(''),[method,setMethod]=useState(false);
  const [hover,setHover]=useState<OutputSpeedPoint|null>(null),generation=useRef(0),chart=useChartSize(910,410);
  const query=JSON.stringify([device,range,model,resolution]),activeQuery=useRef(query);activeQuery.current=query;
  const load=useCallback(async()=>{if(activeQuery.current!==query)return;const current=++generation.current;try{const next=await api.getOutputSpeed(device,'codex',range==='1h'?1:Number(range),model,Number(resolution),range==='1h'?1:0);if(current===generation.current){setData(next);setError('');setHover(null);}}catch(e){if(current===generation.current)setError(errText(e));}},[device,range,model,resolution,query]);
  useEffect(()=>{
    void load();let disposed=false;let pending:ReturnType<typeof setTimeout>|undefined;
    const schedule=()=>{if(disposed)return;clearTimeout(pending);pending=setTimeout(()=>void load(),100);};
    const un=['activity-updated','output-speed-updated'].map(event=>listen(event,schedule));
    const timer=setInterval(()=>{if(document.visibilityState==='visible')schedule();},10_000);
    return()=>{disposed=true;generation.current++;clearInterval(timer);clearTimeout(pending);for(const task of un)void task.then(fn=>fn());};
  },[load]);
  const refresh=async(sync=false)=>{setBusy(true);setError('');try{if(sync)await api.syncActivityNow();else await api.refreshActivity();await load();}catch(e){setError(errText(e));}finally{setBusy(false);}};
  const series=useMemo(()=>speedSeries(data?.points??[]),[data]);
  const all=series.flatMap(s=>s.rows),ceiling=Math.max(20,Math.ceil(all.reduce((max,p)=>Math.max(max,speedValue(p)??0),0)/20)*20);
  const lo=data?.rangeStart??Date.now()-3_600_000,hi=Math.max(lo+10_000,data?.rangeEnd??Date.now());
  const bounds={left:62,right:chart.width-30,top:28,bottom:chart.height-52};
  const x=(time:number)=>bounds.left+Math.max(0,Math.min(1,(time-lo)/(hi-lo)))*(bounds.right-bounds.left),y=(value:number)=>bounds.bottom-value/ceiling*(bounds.bottom-bounds.top);
  const timeLabel=(time:number)=>new Date(time).toLocaleString('zh-CN',range==='1h'?{hour:'2-digit',minute:'2-digit',second:'2-digit'}:range==='1'?{hour:'2-digit',minute:'2-digit'}:{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const stats=data?.summary,bucket=data?.bucketSeconds??60;
  const color=(name:string)=>colors[Math.max(0,data?.models.indexOf(name)??0)%colors.length];
  const status=!data?'读取中':!data.collectionEnabled?'自动采集已暂停':!data.collectedAt?'等待采集':Date.now()-data.collectedAt>30_000?'采集延迟':'每10秒采集';
  return <div className="content-inner speed-page">
    <div className="speed-control card">
      <div className="speed-toolbar"><div className="speed-title"><h1>输出速度</h1><Seg value={range} onChange={value=>{setRange(value);setResolution('0');}} options={[{value:'1h',label:'近1小时'},{value:'1',label:'今天'},{value:'7',label:'7天'},{value:'30',label:'30天'},{value:'0',label:'全部'}]}/></div><div className="speed-actions"><Button size="sm" variant="quiet" onClick={()=>setMethod(true)}>统计口径</Button><Button size="sm" disabled={busy} onClick={()=>void refresh(true)}>同步</Button><Button size="sm" disabled={busy} onClick={()=>void refresh()}><IconRefresh size={14} className={busy?'spin':''}/>{busy?'采集中…':'立即采集'}</Button></div></div>
      <div className="speed-filters"><span className="speed-source">Codex</span><select className="select" aria-label="输出速度设备" value={device} onChange={e=>{setDevice(e.target.value);setModel('');}}><option value="">全部设备</option>{data?.devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><select className="select" aria-label="输出速度模型" value={model} onChange={e=>setModel(e.target.value)}><option value="">全部模型</option>{data?.models.map(name=><option key={name}>{name}</option>)}</select><select className="select speed-resolution" aria-label="速度时间粒度" value={resolution} onChange={e=>setResolution(e.target.value)}>{speedBuckets.map(b=><option key={b.value} value={b.value}>{b.value?`${b.label}均值`:'自动时间粒度'}</option>)}</select><Button size="sm" variant="quiet" onClick={onOpenSyncSettings}>同步设置</Button></div>
    </div>
    {error&&<Notice tone="error">{error}</Notice>}{data?.errors.map((message,i)=><Notice tone="warn" key={i}>{message}</Notice>)}
    <div className="speed-summary card">
      <section className="speed-average"><span>平均输出速度</span><div><strong>{rate(stats?.average)}</strong><span>tokens/s</span></div></section>
      <div className="speed-secondary">{[['中位速度',stats?.median,'tokens/s'],['P95 速度',stats?.p95,'tokens/s'],['有效样本',stats?.samples,'次']].map(([label,value,unit])=><section key={String(label)}><span>{label}</span><div><strong>{rate(value as number|undefined)}</strong><span>{unit}</span></div></section>)}</div>
      <div className={`speed-live${data?.collectionEnabled?' active':''}`}><span><i/>{status}</span><time>{data?.collectedAt?`最近采集 ${new Date(data.collectedAt).toLocaleTimeString('zh-CN')}`:'尚无采集时间'}</time></div>
    </div>
    <section className="card speed-chart"><div className="speed-chart-heading"><h2>平均速度趋势</h2><span>{speedBucketLabel(bucket)}均值 · tokens/s</span></div>{all.length?<>
      <svg ref={chart.ref} viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="模型平均输出速度随时间变化曲线" data-bucket-seconds={bucket}>
        {[0,1,2,3,4].map(i=>{const value=ceiling*i/4;return <g key={i}><line x1={bounds.left} x2={bounds.right} y1={y(value)} y2={y(value)} className="speed-grid"/><text x={bounds.left-12} y={y(value)+5} textAnchor="end" className="speed-tick">{rate(value)}</text></g>;})}
        {[0,1,2,3,4].map(i=>{const time=lo+(hi-lo)*i/4;return <text key={i} x={x(time)} y={chart.height-15} textAnchor={i===0?'start':i===4?'end':'middle'} className="speed-tick">{timeLabel(time)}</text>;})}
        {series.map(s=><g key={s.model} style={{color:color(s.model)}}><path d={s.rows.map((p,i)=>`${i&&p.timestamp-s.rows[i-1].timestamp<=bucket*3000?'L':'M'}${x(p.timestamp)},${y(speedValue(p)!)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>{s.rows.filter((_,i)=>i%Math.max(1,Math.ceil(s.rows.length/180))===0||i===s.rows.length-1).map(p=><g key={p.timestamp}><circle cx={x(p.timestamp)} cy={y(speedValue(p)!)} r="3" fill="var(--surface)" stroke="currentColor" strokeWidth="2"/><circle cx={x(p.timestamp)} cy={y(speedValue(p)!)} r="12" fill="transparent" tabIndex={0} role="button" aria-label={`${p.model} ${timeLabel(p.timestamp)} ${rate(speedValue(p))} tokens/s`} onFocus={()=>setHover(p)} onMouseEnter={()=>setHover(p)} onClick={()=>setHover(p)}><title>{p.model} · {timeLabel(p.timestamp)} · {rate(speedValue(p))} tokens/s · {p.samples} 次</title></circle></g>)}</g>)}
        {hover&&<line x1={x(hover.timestamp)} x2={x(hover.timestamp)} y1={bounds.top} y2={bounds.bottom} className="speed-crosshair"/>}
      </svg>{hover&&<div className="speed-inspector" aria-live="polite"><ModelLogo name={hover.model} size={21}/><b>{hover.model}</b><strong>{rate(speedValue(hover))} tokens/s</strong><span>{timeLabel(hover.timestamp)} · {hover.samples} 次</span></div>}
      <div className="speed-legend">{series.map(s=><button key={s.model} onClick={()=>setModel(model===s.model?'':s.model)} aria-pressed={model===s.model}><i style={{background:color(s.model)}}/><ModelLogo name={s.model} size={18}/>{s.model}</button>)}</div>
    </>:<EmptyState icon={<IconChart size={28}/>} title={data?'暂无输出速度记录':'正在读取记录…'} action={data?<Button onClick={()=>void refresh()} disabled={busy}>立即采集</Button>:undefined}/>}</section>
    {method&&<Modal title="输出速度统计口径" onClose={()=>setMethod(false)} footer={<Button onClick={()=>setMethod(false)}>关闭</Button>}><div className="speed-method"><p>每10秒读取已配置的 Codex 新增日志，沿用 Token 活动记录、设备选择和去重同步。关闭自动采集后暂停；不重复记录空闲时段。</p><p>每条有效响应的速度 = 非推理输出 Token ÷ 客户端记录的文本输出时长。仅在完整用量与计时到齐后记录，排除工具调用、思考与等待；有效样本至少64 Token、0.5秒。</p><p>曲线按响应完成时间分组，以每组输出 Token 总数除以输出时长总和得到平均速度。近1小时默认1分钟均值，今天5分钟，7天1小时，30天6小时，全部按天，也可自行选择粒度。空档留空，旧日志缺少计时不补造速度。</p><p>采集频率与图表时间粒度分别控制读取和展示。网络或采集任务延迟时显示实际最近采集时间；采集任务不会并发重叠。</p></div></Modal>}
  </div>;
}

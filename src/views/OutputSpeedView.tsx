import {useState} from 'react';
import {api,errText} from '../lib/api';
import {useOutputSpeed} from '../lib/useOutputSpeed';
import {speedBucketLabel} from '../lib/outputSpeed';
import {Button,Modal,Notice,Seg} from '../components/ui';
import {IconRefresh} from '../components/icons';
import {ModelLogo} from '../components/ModelLogo';
import {OutputSpeedChart,speedColor,speedNumber} from '../components/OutputSpeedChart';
import './output-speed.css';

const periods=[
  {value:'today',label:'今天',days:1,minutes:0,grain:3600,grains:[60,300,3600]},
  {value:'week',label:'7天',days:7,minutes:0,grain:86400,grains:[3600,21600,86400]},
  {value:'month',label:'30天',days:30,minutes:0,grain:86400,grains:[21600,86400]},
  {value:'all',label:'全部',days:0,minutes:0,grain:86400,grains:[21600,86400]},
];
const stamp=(at:number)=>new Date(at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
export function OutputSpeedView({onOpenSyncSettings}:{onOpenSyncSettings:()=>void}){
  const [period,setPeriod]=useState('week'),[grain,setGrain]=useState(86400),[device,setDevice]=useState(''),[model,setModel]=useState('');
  const [view,setView]=useState('trend'),[method,setMethod]=useState(false),[widgetError,setWidgetError]=useState('');
  const range=periods.find(row=>row.value===period)!;
  const {data,error,refresh,refreshing}=useOutputSpeed(device,model,range.days,range.minutes,grain);
  const latest=data?.recent[0],summary=data?.summary;
  const changePeriod=(value:string)=>{setPeriod(value);setGrain(periods.find(row=>row.value===value)!.grain);};
  return <div className="content-inner speed-page speed-trends">
    <header className="speed-page-heading"><div><h1>输出速度</h1><p>查看已完成输出的速度变化</p></div><div className="speed-page-actions"><Button variant="quiet" size="sm" onClick={()=>void api.getWidgetOptions().then(options=>api.saveWidgetOptions({...options,enabled:true})).catch(e=>setWidgetError(errText(e)))}>查看运行任务</Button><Button variant="quiet" size="sm" onClick={()=>setMethod(true)}>统计说明</Button><Button variant="quiet" aria-label="重新读取输出记录" disabled={refreshing} onClick={()=>void refresh()}><IconRefresh size={17} className={refreshing?'spin':''}/></Button></div></header>
    {error&&<Notice tone="error">{error}</Notice>}{widgetError&&<Notice tone="error">{widgetError}</Notice>}{data?.errors.map(message=><Notice tone="warn" key={message}>{message}</Notice>)}
    <div className="speed-trend-controls"><Seg value={period} onChange={changePeriod} options={periods.map(({value,label})=>({value,label}))}/><div className="speed-scope"><select className="select" aria-label="输出速度模型" value={model} onChange={event=>setModel(event.target.value)}><option value="">全部模型</option>{[...new Set([...(data?.models??[]),...(model?[model]:[])])].map(name=><option key={name}>{name}</option>)}</select><select className="select" aria-label="输出速度设备" value={device} onChange={event=>setDevice(event.target.value)}><option value="">全部设备</option>{data?.devices.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></div></div>
    <section className="card speed-workspace" aria-busy={!data}>
      <div className="speed-summary"><section><span>平均输出</span><div><strong className="speed-average-value">{speedNumber(summary?.average)}</strong><span>tokens/s</span></div></section><section><span>最近一次</span><div><strong className="speed-latest-value">{speedNumber(latest?.speed)}</strong><span>tokens/s</span></div></section><section><span>有效输出</span><div><strong className="speed-sample-value">{summary?.samples.toLocaleString()??'—'}</strong><span>次</span></div></section></div>
      <section className="speed-chart"><div className="speed-chart-heading"><h2>{view==='trend'?'速度趋势':'输出记录'}</h2><div className="speed-chart-tools">{view==='trend'&&<select className="select" aria-label="速度趋势粒度" value={grain} onChange={event=>setGrain(Number(event.target.value))}>{range.grains.map(value=><option value={value} key={value}>{speedBucketLabel(value)}均值</option>)}</select>}<Seg value={view} onChange={setView} options={[{value:'trend',label:'趋势'},{value:'records',label:'记录'}]}/></div></div>
        {!data?<div className="speed-empty" role="status">正在读取趋势…</div>:data.summary.samples?view==='trend'?<OutputSpeedChart data={data} period={period} onSelectModel={name=>setModel(model===name?'':name)}/>:<div className="speed-records"><table><thead><tr><th>完成时间</th><th>模型</th><th>输出 Token</th><th>耗时</th><th>tokens/s</th></tr></thead><tbody>{data.recent.map(row=><tr key={row.id}><td>{stamp(row.completedAt)}</td><td><span className="speed-model-name"><ModelLogo name={row.model} size={20}/>{row.model}</span></td><td>{row.outputTokens.toLocaleString('zh-CN')}</td><td>{speedNumber(row.durationMs/1000)} 秒</td><td><b>{speedNumber(row.speed)}</b></td></tr>)}</tbody></table></div>:<div className="speed-empty"><div className="speed-empty-plot"><i/><i/><i/></div><h3>这个范围还没有速度记录</h3><p>{data.live?.activeRequests?'有任务正在进行，响应完成后自动更新趋势。':'完成一次具备 Token 用量和计时的输出后，趋势会自动显示。'}</p>{period!=='all'&&<Button variant="quiet" onClick={()=>changePeriod('all')}>查看全部历史</Button>}</div>}
      </section>
    </section>
    {!!data?.byModel.length&&<section className="card speed-models"><div className="speed-models-heading"><h2>模型对比</h2>{model&&<Button variant="quiet" size="sm" onClick={()=>setModel('')}>全部模型</Button>}</div><div className="speed-model-table"><table><thead><tr><th>模型</th><th>平均 tokens/s</th><th>有效输出</th><th>最近记录</th></tr></thead><tbody>{data.byModel.map(row=><tr key={row.model}><td><button onClick={()=>setModel(model===row.model?'':row.model)} aria-label={`查看 ${row.model} 输出速度`} aria-pressed={model===row.model}><i style={{background:speedColor(row.model,data.models)}}/><ModelLogo name={row.model} size={21}/>{row.model}</button></td><td><b>{speedNumber(row.summary.average)}</b></td><td>{row.summary.samples.toLocaleString('zh-CN')} 次</td><td>{stamp(row.latestAt)}</td></tr>)}</tbody></table></div></section>}
    {method&&<Modal title="速度趋势的统计方式" onClose={()=>setMethod(false)} footer={<><Button variant="quiet" onClick={onOpenSyncSettings}>采集设置</Button><Button onClick={()=>setMethod(false)}>完成</Button></>}><div className="speed-method"><p>当前来源提供响应完成后的 Token 数和输出耗时，因此这里展示已完成响应的速度趋势。</p><p>均值 = 有效输出 Token ÷ 输出时长。工具、思考与等待排除；无记录的时间留空。有效输出至少 64 Token、0.5 秒。</p><p>本机每秒检查新记录；正在工作的任务在侧边悬浮窗中显示。文本流片段没有准确 Token 数，不能当成实时 tokens/s。</p></div></Modal>}
  </div>;
}

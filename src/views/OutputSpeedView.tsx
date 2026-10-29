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
  {value:'live',label:'近30分钟',days:0,minutes:30,grain:10,grains:[10,60,300]},
  {value:'today',label:'今天',days:1,minutes:0,grain:3600,grains:[60,300,3600]},
  {value:'week',label:'7天',days:7,minutes:0,grain:86400,grains:[3600,21600,86400]},
  {value:'month',label:'30天',days:30,minutes:0,grain:86400,grains:[21600,86400]},
  {value:'all',label:'全部',days:0,minutes:0,grain:86400,grains:[21600,86400]},
];
const stamp=(at:number)=>new Date(at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const age=(at:number)=>{const seconds=Math.max(0,Math.floor((Date.now()-at)/1000));return seconds<60?`${seconds}秒前`:seconds<3600?`${Math.floor(seconds/60)}分钟前`:seconds<86400?`${Math.floor(seconds/3600)}小时前`:`${Math.floor(seconds/86400)}天前`;};

export function OutputSpeedView({onOpenSyncSettings}:{onOpenSyncSettings:()=>void}){
  const [period,setPeriod]=useState('today'),[grain,setGrain]=useState(3600);
  const [device,setDevice]=useState(''),[model,setModel]=useState(''),[view,setView]=useState('trend'),[method,setMethod]=useState(false),[widgetError,setWidgetError]=useState('');
  const range=periods.find(p=>p.value===period)!;
  const {data,error,refresh,refreshing}=useOutputSpeed(device,model,range.days,range.minutes,grain);
  const latest=data?.recent[0],summary=data?.summary;
  const waiting=!!(data?.localMonitoring&&data.collectionEnabled&&data.live.activeRequests);
  const checked=data?.live.checkedAt;
  const status=!data?'正在读取':!data.collectionEnabled?'采集已暂停':!data.localMonitoring?'远程记录':data.errors.length?'读取异常':!data.live.sourceConfigured?'未设置日志目录':!checked?'正在连接':Date.now()-checked>5000?'读取延迟':data.live.stream?.lastDeltaAt&&Date.now()-data.live.stream.lastDeltaAt<2000?'正在接收输出':data.live.activeRequests?'模型工作中':'本机监听中';
  const normal=!!(data?.collectionEnabled&&data.localMonitoring&&checked&&Date.now()-checked<5000&&!data.errors.length);
  const changePeriod=(value:string)=>{const next=periods.find(p=>p.value===value)!;setPeriod(value);setGrain(next.grain);};
  const emptyTitle=!data?'正在读取记录':data.coverage.outputRecords?'本时段的输出暂无可用计时':'这个时段还没有输出记录';
  return <div className="content-inner speed-page">
    <header className="speed-page-heading"><h1>输出速度</h1><div className="speed-page-actions">
      <span className={`speed-monitor${normal?' connected':''}`} title={checked?`本机最近读取 ${stamp(checked)}`:status}><i/>{status}</span>
      <Button size="sm" onClick={()=>void api.getWidgetOptions().then(options=>api.saveWidgetOptions({...options,enabled:true})).then(()=>setWidgetError('')).catch(error=>setWidgetError(errText(error)))}>显示悬浮窗</Button>
      <Button variant="quiet" size="sm" onClick={()=>setMethod(true)}>统计说明</Button>
      <Button variant="quiet" size="sm" disabled={refreshing} onClick={()=>void refresh()} title="重新读取本机输出记录" aria-label="重新读取输出记录"><IconRefresh size={17} className={refreshing?'spin':''}/></Button>
    </div></header>
    {widgetError&&<Notice tone="error">{widgetError}</Notice>}{error&&<Notice tone="error">{error}</Notice>}
    {data?.errors.map((message,i)=><Notice tone="warn" key={i}>{message}</Notice>)}
    <section className="card speed-workspace" aria-busy={!data}>
      <div className="speed-controls"><Seg value={period} onChange={changePeriod} options={periods.map(({value,label})=>({value,label}))}/>
        <div className="speed-scope"><select className="select" aria-label="输出速度设备" value={device} onChange={event=>setDevice(event.target.value)}><option value="">全部设备</option>{data?.devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select className="select" aria-label="输出速度模型" value={model} onChange={event=>setModel(event.target.value)}><option value="">全部模型</option>{[...new Set([...(data?.models??[]),...(model?[model]:[])])].map(name=><option key={name}>{name}</option>)}</select></div>
      </div>
      <div className="speed-summary">
        <section className="speed-average"><span>{range.label}平均速度</span><div><strong className="speed-average-value">{speedNumber(summary?.average)}</strong><span>tokens/s</span></div></section>
        <section className="speed-latest"><span>最近一次已完成输出</span><div><strong className="speed-latest-value">{speedNumber(latest?.speed)}</strong><span>tokens/s</span></div><p title={latest?stamp(latest.completedAt):''}>{latest?<><ModelLogo name={latest.model} size={17}/><span>{latest.model}</span><time>{age(latest.completedAt)}</time></>:'等待本时段第一条有效记录'}</p></section>
        <section className="speed-count" title={data?`已计时 ${data.coverage.timedRecords} 次 / 输出 ${data.coverage.outputRecords} 次`:undefined}><span>已计时输出</span><div><strong className="speed-sample-value">{summary?.samples.toLocaleString()??'—'}</strong><span>次</span></div></section>
      </div>
      <section className="speed-chart">
        <div className="speed-chart-heading"><div><h2>{view==='trend'?'平均速度趋势':'已完成输出记录'}</h2><span>{view==='trend'?`${speedBucketLabel(grain)}均值 · tokens/s`:'用量、耗时与速度逐条对应'}</span></div>
          <div className="speed-chart-tools">{view==='trend'&&<div role="group" aria-label="均值时间粒度"><Seg value={String(grain)} onChange={value=>setGrain(Number(value))} options={range.grains.map(value=>({value:String(value),label:speedBucketLabel(value)}))}/></div>}<Seg value={view} onChange={setView} options={[{value:'trend',label:'趋势'},{value:'records',label:'记录'}]}/></div>
        </div>
        {data?.summary.samples?view==='trend'?<OutputSpeedChart data={data} period={period} onSelectModel={name=>setModel(model===name?'':name)}/>:<div className="speed-records"><table><thead><tr><th>完成时间</th><th>模型</th><th>输出 Token</th><th>输出耗时</th><th>速度 · tokens/s</th></tr></thead><tbody>{data.recent.map(row=><tr key={row.id}><td>{stamp(row.completedAt)}</td><td><span className="speed-model-name"><ModelLogo name={row.model} size={20}/>{row.model}</span></td><td>{row.outputTokens.toLocaleString()}</td><td>{speedNumber(row.durationMs/1000)} 秒</td><td><b>{speedNumber(row.speed)}</b></td></tr>)}</tbody></table></div>:<div className="speed-empty"><div className="speed-empty-plot"><i/><i/><i/></div><h3>{emptyTitle}</h3><p>{waiting?'检测到进行中的任务，输出结束后会自动显示。':data?.coverage.outputRecords?'已读取用量，缺少计时或不满足测量条件的记录不会生成速度。':'新记录到达后会自动显示，也可以切换时间范围查看历史。'}</p>{period==='live'&&<Button variant="quiet" onClick={()=>changePeriod('today')}>查看今天</Button>}</div>}
      </section>
    </section>
    {!!data?.byModel.length&&<section className="card speed-models"><div className="speed-models-heading"><h2>模型速度</h2>{model&&<Button variant="quiet" size="sm" onClick={()=>setModel('')}>查看全部模型</Button>}</div><div className="speed-model-table"><table><thead><tr><th>模型</th><th>时段平均 · tokens/s</th><th>已计时输出</th><th>最近记录</th></tr></thead><tbody>{data.byModel.map(row=><tr key={row.model} className={model===row.model?'selected':''}><td><button onClick={()=>setModel(model===row.model?'':row.model)} aria-label={`查看 ${row.model} 输出速度`} aria-pressed={model===row.model}><i style={{background:speedColor(row.model,data.models)}}/><ModelLogo name={row.model} size={21}/>{row.model}</button></td><td><div className="speed-model-number"><b>{speedNumber(row.summary.average)}</b><span><i style={{width:`${(row.summary.average??0)/Math.max(1,...data.byModel.map(model=>model.summary.average??0))*100}%`,background:speedColor(row.model,data.models)}}/></span></div></td><td>{row.summary.samples.toLocaleString()} 次</td><td title={stamp(row.latestAt)}>{age(row.latestAt)}</td></tr>)}</tbody></table></div></section>}
    {method&&<Modal title="输出速度如何记录" onClose={()=>setMethod(false)} footer={<><Button variant="quiet" onClick={onOpenSyncSettings}>采集与同步</Button><span className="spacer"/><Button onClick={()=>setMethod(false)}>关闭</Button></>}><div className="speed-method">
      <p><b>速度来自已完成的输出。</b> Codex日志提供响应结束后的用量和文本输出起止时间，没有逐Token计数。因此这里显示客户端观测的输出速度，不能测量正在生成的实时tokens/s。</p>
      <p><b>均值按输出时长加权。</b> 以所选时段内完成的有效输出Token总数除以输出时长总和；工具、思考和等待不计入输出时长。每个图表点对应一个明确的时间桶，空档留空，不补零、不平滑补点。</p>
      <p><b>记录会自动更新。</b> 本机每秒增量检查日志，与完整采集、SSH和目录同步分别运行。正在进行的任务显示等待状态，只有用量和计时到齐才入图。远程记录随已配置的SSH采集和同步到达。</p>
      <p><b>可以逐条核对。</b> “记录”显示最近24条有效响应的完成时间、Token数、输出耗时和速度。有效输出至少64 Token、0.5秒；短突发、工具混合或缺少计时的记录不生成速度，已有Token用量仍然保留。</p>
    </div></Modal>}
  </div>;
}

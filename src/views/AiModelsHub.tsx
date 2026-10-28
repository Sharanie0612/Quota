import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api, errText } from '../lib/api';
import type { AiModelSnapshot, BenchmarkBoard, BenchmarkModel } from '../lib/types';
import { modelResult, settingText, SERIES } from '../lib/benchmarkCharts';
import { Button, EmptyState, Modal, Notice, Seg } from '../components/ui';
import { IconRefresh, IconSearch } from '../components/icons';
import { ModelLogo } from '../components/ModelLogo';
import { CapabilityBars, EfficiencyChart } from '../components/BenchmarkCharts';
import { AiModelsView } from './AiModelsView';
import { priceText } from '../lib/format';
import './benchmarks.css';

const tiers=['S','A','B','C','D'];
const bands:Record<string,string>={S:'前 10%',A:'10–30%',B:'30–60%',C:'60–85%',D:'85% 后'};
const date=(value:string)=>value?new Date(value).toLocaleString('zh-CN'):'尚未更新';
export function AiModelsHub(){
  const [data,setData]=useState<BenchmarkBoard|null>(null);
  const [registry,setRegistry]=useState<AiModelSnapshot|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [tab,setTab]=useState('ladder'),[source,setSource]=useState('aa'),[effort,setEffort]=useState('best');
  const [search,setSearch]=useState(''),[vendor,setVendor]=useState('all');
  const [selection,setSelection]=useState<string[]|null>(null);
  const [detail,setDetail]=useState<BenchmarkModel|null>(null),[detailProfile,setDetailProfile]=useState('');
  const [method,setMethod]=useState(false);
  useEffect(()=>{
    let live=true;
    const load=()=>api.getBenchmarks().then(value=>{if(live&&value){setData(value);setError('');}}).catch(e=>{if(live)setError(errText(e));});
    void load();void api.getAiModels().then(value=>{if(live)setRegistry(value);}).catch(()=>undefined);
    const un=listen('benchmarks-updated',()=>void load());
    const smoke=(event:Event)=>void api.reportBenchmarkSmoke((event as CustomEvent).detail).catch(()=>undefined);
    window.addEventListener('quota-benchmark-smoke-report',smoke);
    return()=>{live=false;void un.then(fn=>fn());window.removeEventListener('quota-benchmark-smoke-report',smoke);};
  },[]);
  const models=data?.models??[];
  const rankingId=source==='aa'&&effort!=='best'?`aa:${effort}`:source;
  const ranking=data?.rankings.find(r=>r.id===rankingId);
  const modelMap=useMemo(()=>new Map(models.map(m=>[m.id,m])),[models]);
  const selected=selection??data?.rankings.find(r=>r.id==='aa')?.entries.slice(0,3).map(r=>r.modelId)??[];
  const comparisons=selected.map(id=>modelMap.get(id)).filter((m):m is BenchmarkModel=>!!m);
  const entries=(ranking?.entries??[]).filter(e=>{
    const m=modelMap.get(e.modelId);return m&&(vendor==='all'||m.vendor===vendor)&&`${m.name} ${m.vendor}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  const observed=models.filter(m=>!ranking?.entries.some(e=>e.modelId===m.id)&&m.name.toLowerCase().includes(search.toLowerCase())&&(vendor==='all'||m.vendor===vendor));
  const choose=(id:string)=>setSelection(current=>{const next=current??selected;return next.includes(id)?next.filter(v=>v!==id):next.length<4?[...next,id]:next;});
  const openDetail=(m:BenchmarkModel,profile='')=>{setDetail(m);setDetailProfile(profile||modelResult(m,source==='consensus'?'aa':source,source==='consensus'?'best':effort)?.profileId||m.results[0]?.profileId||'');};
  const currentResult=detail?.results.find(r=>r.profileId===detailProfile);
  const official=detail?registry?.models.find(m=>[m.name,m.apiId].some(name=>name.replace(/[^a-z0-9]/gi,'').toLowerCase()===detail.id)):null;
  const refresh=async()=>{setBusy(true);setError('');try{setData(await api.refreshBenchmarks());}catch(e){setError(errText(e));}finally{setBusy(false);}};
  return <div className="content-inner benchmark-page">
    <div className="benchmark-toolbar">
      <Seg value={tab} options={[{value:'ladder',label:'模型天梯'},{value:'capability',label:'能力对比'},{value:'efficiency',label:'效率曲线'},{value:'prices',label:'官方价格'}]} onChange={setTab}/>
      <div><Button size="sm" variant="quiet" onClick={()=>setMethod(true)}>算法与来源</Button><Button size="sm" disabled={busy} onClick={()=>void refresh()}><IconRefresh size={14} className={busy?'spin':''}/>{busy?'更新中…':'更新评测'}</Button></div>
    </div>
    {error&&<Notice tone="warn">{error}</Notice>}
    {data?.sources.some(s=>s.error)&&<Notice tone="warn" actions={<Button size="sm" onClick={()=>setMethod(true)}>查看来源</Button>}>部分来源未能更新，已保留上次评测。</Notice>}
    {tab==='prices'?<AiModelsView embedded/>:<>
      {tab!=='efficiency'&&<div className="benchmark-source-controls">
        <select className="select" aria-label="评测榜单" value={source} onChange={e=>setSource(e.target.value)}><option value="aa">AA 能力指数</option><option value="livebench">LiveBench 综合分</option><option value="consensus">跨榜共识 · 平均名次</option></select>
        {source==='aa'&&<select className="select" aria-label="推理档位" value={effort} onChange={e=>setEffort(e.target.value)}><option value="best">最高公开指数 · 完整配置</option>{['Low','Medium','High','Xhigh','Max','Reasoning','Non-reasoning'].map(value=><option value={value.toLowerCase()} key={value}>{value}</option>)}</select>}
        <span>{source==='consensus'?'平均名次越低越好；各榜条件不同':ranking?.unit}</span>
      </div>}
      {tab==='ladder'&&<>
        <div className="benchmark-filters"><div className="search"><IconSearch size={14}/><input className="input" aria-label="搜索天梯模型" placeholder="搜索模型" value={search} onChange={e=>setSearch(e.target.value)}/></div><select className="select" aria-label="天梯厂商" value={vendor} onChange={e=>setVendor(e.target.value)}><option value="all">全部厂商</option>{[...new Set(models.map(m=>m.vendor).filter(Boolean))].sort().map(v=><option key={v}>{v}</option>)}</select></div>
        <div className="ladder-heading"><h2>{ranking?.name??'模型天梯'}</h2><span>{entries.length} 款 · {source==='consensus'?'同池共识名次':'源站原分'}</span></div>
        {entries.length>0&&<div className="tier-board" data-ranking-id={rankingId} aria-label="AI 模型能力天梯">{tiers.map(tier=><section key={tier} className={`tier-row tier-${tier.toLowerCase()}`}>
          <div className="tier-label"><b>{tier}</b><span>{bands[tier]}</span></div><div className="tier-models">{entries.filter(e=>e.tier===tier).map(e=>{const m=modelMap.get(e.modelId)!;return <article key={e.modelId} className={`tier-model${selected.includes(e.modelId)?' selected':''}`} data-model-id={e.modelId} data-profile-id={e.profileId} data-rank={e.rank}>
            <button className="tier-model-main" onClick={()=>openDetail(m,e.profileId)}><span className="tier-model-name"><ModelLogo name={m.name} size={23}/><b>{m.name}</b></span><span className="tier-model-setting" title={e.setting}>{source==='consensus'?`同池 AA #${e.sourceRanks['artificial-analysis']} / LB #${e.sourceRanks.livebench}`:settingText(e.setting)}{e.coverage<100?' · 分项不全':''}</span><span className="tier-model-score"><strong>{e.score.toFixed(2)}</strong><span>#{e.rank}</span></span></button>
            <label className="tier-compare" title="加入能力对比，最多四款"><input type="checkbox" aria-label={`对比 ${m.name}`} checked={selected.includes(m.id)} onChange={()=>choose(m.id)}/>对比</label>
          </article>;})}</div>
        </section>)}</div>}
        {!data&&!error&&<div className="benchmark-empty">正在读取测评…</div>}
        {data&&!entries.length&&<EmptyState icon={<IconSearch size={22}/>} title="当前榜单没有匹配型号" desc="可以切换评测平台、档位或筛选条件。"/>}
        {observed.length>0&&<details className="benchmark-watch"><summary>其他已收录型号 <span>{observed.length}</span></summary><div>{observed.map(m=><button key={m.id} onClick={()=>openDetail(m)}><ModelLogo name={m.name} size={20}/><span>{m.name}</span><span>{m.results.length?'其他榜单或配置':'仅分项记录'}</span></button>)}</div></details>}
        <div className="benchmark-selection"><span>{comparisons.length} 款已选</span><Button size="sm" onClick={()=>setTab('capability')}>比较能力 →</Button><Button size="sm" variant="quiet" onClick={()=>setTab('efficiency')}>查看效率曲线</Button></div>
      </>}
      {(tab==='capability'||tab==='efficiency')&&<>
        <div className="benchmark-compare-picker">{comparisons.map((m,i)=><button key={m.id} onClick={()=>choose(m.id)} title="移除模型"><i style={{background:SERIES[i]}}/>{m.name}<span>×</span></button>)}<select className="select" aria-label="添加对比模型" value="" onChange={e=>choose(e.target.value)} disabled={selected.length>=4}><option value="">添加模型…</option>{models.filter(m=>!selected.includes(m.id)&&m.results.length&&(tab!=='efficiency'||data?.profiles.some(p=>p.modelId===m.id&&p.cost!=null))).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        {tab==='capability'?<CapabilityBars models={comparisons} source={source} effort={effort}/>:<EfficiencyChart profiles={data?.profiles??[]} ids={selected}/>}
      </>}
    </>}
    {method&&<Modal title="算法与来源" onClose={()=>setMethod(false)} footer={<Button onClick={()=>setMethod(false)}>关闭</Button>}><div className="benchmark-method">
      <h3>分数与源站一致</h3><p>AA 榜直接使用一套完整配置的 Intelligence Index v5，保留原始分数。默认每个型号取公开指数最高的一套配置；可以切换 Low / High / Max 等档位。分项始终来自同一配置。</p>
      <p>LiveBench 按该版本官网分类和权重计算综合分。当前长程任务权重 2，编程和设计各 1.5，其他各 1；缺测项按官网规则移出分母，并显示覆盖情况。</p>
      <h3>跨榜共识怎么算</h3><p>只取两榜都有完整记录的相同型号，在同一型号集合内分别排位；并列用平均名次。最终按两个名次的平均值排序，越低越好。两榜数据各占一半，官网自报不改变名次。这个数是共识名次，不能当作性能分或答对率。</p>
      <p>S / A / B / C / D 是当前完整榜单的名次分层，边界为前 10% / 30% / 60% / 85%，并列不拆开。搜索和厂商筛选不改变原名次。官网报告在模型详情独立核对，不能混用不同工具、预算或回退条件。</p>
      <p>效率图使用同一 AA 配置的原始指数与实测美元 / 任务。价格页单独显示厂商官方 API 单价。</p>
      <div className="benchmark-sources">{data?.sources.map(s=><article key={s.id}><div><h3>{s.name}</h3><p>{s.version}</p><span>{s.records} 条 · {date(s.checkedAt)}{s.automatic?'':' · 人工核对'}</span>{s.error&&<p role="alert">{s.error}</p>}</div><Button size="sm" onClick={()=>void api.openExternal(s.url)}>打开来源 ↗</Button></article>)}</div>
      <p>{data?.algorithm} · {data?.referenceCohort.length??0} 个共识型号</p>
    </div></Modal>}
    {detail&&<Modal wide title={detail.name} onClose={()=>setDetail(null)} footer={<><Button onClick={()=>setDetail(null)}>关闭</Button><Button variant="primary" disabled={!selected.includes(detail.id)&&selected.length>=4} onClick={()=>{if(!selected.includes(detail.id))choose(detail.id);setTab('capability');setDetail(null);}}>查看对比</Button></>}><div className="benchmark-model-detail">
      {detail.results.length>0&&<><label className="benchmark-profile-select">测评与配置<select className="select" aria-label="详情测评配置" value={detailProfile} onChange={e=>setDetailProfile(e.target.value)}>{detail.results.map(r=><option key={r.profileId} value={r.profileId}>{r.sourceId==='livebench'?'LiveBench':'AA'} · {settingText(r.setting)} · {r.score.toFixed(2)}</option>)}</select></label>{currentResult&&<><div className="benchmark-detail-score"><ModelLogo name={detail.name} size={32}/><strong>{currentResult.score.toFixed(2)}</strong><span>{currentResult.sourceId==='livebench'?'LiveBench 综合分':'AA 原始指数'}</span></div><div className="benchmark-native-table"><table><thead><tr><th>分项</th><th>原始成绩</th>{currentResult.sourceId==='livebench'&&<th>权重</th>}</tr></thead><tbody>{currentResult.components.map(c=><tr key={c.metric}><td>{c.metric}</td><td>{c.value.toFixed(2)}{c.unit==='percent'?'%':' Elo'}</td>{currentResult.sourceId==='livebench'&&<td>{c.weight}</td>}</tr>)}</tbody></table></div><p className="benchmark-detail-version">{currentResult.version} · {settingText(currentResult.setting)} · 覆盖 {currentResult.coverage.toFixed(0)}%</p></>}</>}
      {official&&<section className="benchmark-official"><h3>厂商官方资料</h3><dl><div><dt>输入 / 输出 · 每百万 Token</dt><dd>{priceText(official.price?.input??null,official.price?.currency??'')} / {priceText(official.price?.output??null,official.price?.currency??'')}</dd></div></dl>{official.source&&<Button size="sm" onClick={()=>void api.openExternal(official.source)}>官方定价与条件 ↗</Button>}</section>}
      <h3>来源记录</h3>{data?.sources.filter(s=>detail.observations.some(o=>o.sourceId===s.id)).map(s=><details className="benchmark-evidence" key={s.id}><summary>{s.name}{s.automatic?'':' · 官网报告，仅作对照'}</summary><div className="benchmark-evidence-table"><table><thead><tr><th>测评</th><th>公开配置</th><th>原始成绩</th></tr></thead><tbody>{detail.observations.filter(o=>o.sourceId===s.id).map((o,i)=><tr key={i}><td><button onClick={()=>void api.openExternal(o.url)}>{o.metric} ↗</button><span>{o.version}</span></td><td>{o.setting}</td><td>{o.value.toFixed(2)}{o.unit==='percent'?'%':' Elo'}</td></tr>)}</tbody></table></div></details>)}
    </div></Modal>}
  </div>;
}

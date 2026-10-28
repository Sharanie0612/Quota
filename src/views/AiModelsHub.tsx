import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api, errText } from '../lib/api';
import type { AiModelSnapshot, BenchmarkBoard, BenchmarkModel } from '../lib/types';
import { configurationText, modelResult, SCENARIOS, settingText, SERIES } from '../lib/benchmarkCharts';
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
  const [tab,setTab]=useState('ladder'),[source,setSource]=useState('general'),[effort,setEffort]=useState('best');
  const [expanded,setExpanded]=useState(false);
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
  const selected=selection??data?.rankings.find(r=>r.id==='general')?.entries.slice(0,3).map(r=>r.modelId)??[];
  const comparisons=selected.map(id=>modelMap.get(id)).filter((m):m is BenchmarkModel=>!!m);
  const entries=(ranking?.entries??[]).filter(e=>{
    const m=modelMap.get(e.modelId);return m&&(vendor==='all'||m.vendor===vendor)&&`${m.name} ${m.vendor}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  const visible=expanded?entries:entries.slice(0,24);
  const calibrated=SCENARIOS.some(s=>s.id===source);
  const observed=models.filter(m=>!ranking?.entries.some(e=>e.modelId===m.id)&&m.name.toLowerCase().includes(search.toLowerCase())&&(vendor==='all'||m.vendor===vendor));
  const choose=(id:string)=>setSelection(current=>{const next=current??selected;return next.includes(id)?next.filter(v=>v!==id):next.length<4?[...next,id]:next;});
  const openDetail=(m:BenchmarkModel,profile='')=>{setDetail(m);setDetailProfile(profile||modelResult(m,source,effort)?.profileId||m.results[0]?.profileId||'');};
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
        <div className="benchmark-domain-tabs" role="group" aria-label="评测榜单">{[...SCENARIOS,{id:'aa',name:'AA 原始'},{id:'livebench',name:'LiveBench 原始'}].map(s=><button key={s.id} className={source===s.id?'active':''} aria-pressed={source===s.id} data-benchmark-source={s.id} onClick={()=>{setSource(s.id);setExpanded(false);}}>{s.name}</button>)}</div>
        {source==='aa'&&<select className="select" aria-label="推理档位" value={effort} onChange={e=>setEffort(e.target.value)}><option value="best">最高公开指数 · 完整配置</option>{['Low','Medium','High','Xhigh','Max','Reasoning','Non-reasoning'].map(value=><option value={value.toLowerCase()} key={value}>{value}</option>)}</select>}
        <span>{source==='general'?'Epoch ECI · 显示 90% 区间':calibrated?'同配置测评 · 难度校准':ranking?.unit}</span>
      </div>}
      {tab==='ladder'&&<>
        <div className="benchmark-filters"><div className="search"><IconSearch size={14}/><input className="input" aria-label="搜索天梯模型" placeholder="搜索模型" value={search} onChange={e=>setSearch(e.target.value)}/></div><select className="select" aria-label="天梯厂商" value={vendor} onChange={e=>setVendor(e.target.value)}><option value="all">全部厂商</option>{[...new Set(models.map(m=>m.vendor).filter(Boolean))].sort().map(v=><option key={v}>{v}</option>)}</select></div>
        <div className="ladder-heading"><h2>{ranking?.name??'模型天梯'}</h2><span>{entries.length} 款 · {calibrated?'指数，不是百分比':'源站原分'}</span></div>
        {entries.length>0&&<div className="tier-board" data-ranking-id={rankingId} aria-label="AI 模型能力天梯">{tiers.filter(t=>visible.some(e=>e.tier===t)).map(tier=><section key={tier} className={`tier-row tier-${tier.toLowerCase()}`}>
          <div className="tier-label"><b>{tier}</b><span>{ranking?.tierLabels?.[tier]??bands[tier]}</span></div><div className="tier-models">{visible.filter(e=>e.tier===tier).map(e=>{const m=modelMap.get(e.modelId)!;return <article key={e.modelId} className={`tier-model${selected.includes(e.modelId)?' selected':''}`} data-model-id={e.modelId} data-profile-id={e.profileId} data-rank={e.rank}>
            <button className="tier-model-main" onClick={()=>openDetail(m,e.profileId)}><span className="tier-model-name"><ModelLogo name={m.name} size={23}/><b>{m.name}</b></span><span className="tier-model-setting" title={e.setting}>{calibrated?`${configurationText(e.setting)} · ${e.benchmarkCount} 项`:settingText(e.setting)}{calibrated&&source!=='general'&&e.benchmarkCount===2?' · 少量测评':''}</span><span className="tier-model-score"><strong>{e.score.toFixed(2)}</strong><span>#{e.rank}</span></span>{e.lower!=null&&e.upper!=null&&<span className="tier-model-range" data-range-kind={e.rangeKind} title={e.rangeKind==='confidence90'?'来源发布的 90% 置信区间，可与其他型号重叠':'逐项留出后的敏感性范围，不是置信区间'}><span className="tier-range-values">{`${e.lower.toFixed(2)}–${e.upper.toFixed(2)}`}</span><span>{e.rangeKind==='confidence90'?'90% 区间':'敏感性'}</span></span>}</button>
            <label className="tier-compare" title="加入能力对比，最多四款"><input type="checkbox" aria-label={`对比 ${m.name}`} checked={selected.includes(m.id)} onChange={()=>choose(m.id)}/>对比</label>
          </article>;})}</div>
        </section>)}</div>}
        {entries.length>24&&<div className="benchmark-expand"><Button size="sm" data-expand-ladder={!expanded?'true':undefined} onClick={()=>setExpanded(!expanded)}>{expanded?'收起为前 24 款':`查看全部 ${entries.length} 款`}</Button></div>}
        {!data&&!error&&<div className="benchmark-empty">正在读取测评…</div>}
        {data&&!entries.length&&<EmptyState icon={<IconSearch size={22}/>} title="当前榜单没有匹配型号" desc={calibrated?'当前缺少足够的可比较测评，可以查看原始平台对照。':'可以切换评测平台、档位或筛选条件。'}/>}
        {observed.length>0&&<details className="benchmark-watch"><summary>其他已收录型号 <span>{observed.length}</span></summary><div>{observed.map(m=><button key={m.id} onClick={()=>openDetail(m)}><ModelLogo name={m.name} size={20}/><span>{m.name}</span><span>{m.results.length?'其他榜单或配置':'仅分项记录'}</span></button>)}</div></details>}
        <div className="benchmark-selection"><span>{comparisons.length} 款已选</span><Button size="sm" onClick={()=>setTab('capability')}>比较能力 →</Button><Button size="sm" variant="quiet" onClick={()=>setTab('efficiency')}>查看效率曲线</Button></div>
      </>}
      {(tab==='capability'||tab==='efficiency')&&<>
        <div className="benchmark-compare-picker">{comparisons.map((m,i)=><button key={m.id} onClick={()=>choose(m.id)} title="移除模型"><i style={{background:SERIES[i]}}/>{m.name}<span>×</span></button>)}<select className="select" aria-label="添加对比模型" value="" onChange={e=>choose(e.target.value)} disabled={selected.length>=4}><option value="">添加模型…</option>{models.filter(m=>!selected.includes(m.id)&&m.results.length&&(tab!=='efficiency'||data?.profiles.some(p=>p.modelId===m.id&&p.cost!=null))).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        {tab==='capability'?<CapabilityBars models={comparisons} source={source} effort={effort}/>:<EfficiencyChart profiles={data?.profiles??[]} ids={selected}/>}
      </>}
    </>}
    {method&&<Modal title="算法与来源" onClose={()=>setMethod(false)} footer={<Button onClick={()=>setMethod(false)}>关闭</Button>}><div className="benchmark-method">
      <h3>通用综合</h3><p>使用 Epoch AI 发布的 ECI 和 90% 区间。它通过逻辑曲线同时估计模型能力、测评难度和区分度，使用多项公开测评，包含 Epoch 实测、测评机构及厂商报告；不是将 AA、LiveBench 和官网的总分相加。公开 ECI 是来源的多配置聚合值，不能称为同预算测量。相近型号的区间可能重叠。</p>
      <h3>编程、推理、Agent 与知识</h3><p>沿用 Epoch 公布的难度与斜率，只拟合所选场景的能力参数，让难题与易题有可比较的尺度。每款模型固定一套配置，按有效测评数量选取，再按公开推理档位及标识稳定择一，不按分数挑配置；至少两项测评才排名。</p>
      <p>归一化遵循来源给出的随机基线和满分上限。相同配置的冲突记录排除；版本不明确的 Terminal Bench 不参与场景计算。场景敏感性范围来自逐项留出，不是统计置信区间。少量测评不等同于可靠结论，缺失也不补零。</p>
      <p>校准指数不是百分比。S / A / B / C / D 分别采用 165 / 155 / 145 / 130 的固定展示边界，新增型号不改变既有等级；边界是产品展示规则，不是统计显著性。源站原榜仍用名次分层。AA 保留完整配置原始指数，LiveBench 遵循当前官方分类权重，厂商官网在详情独立对照。</p>
      <p>效率图使用同一 AA 配置的原始指数与实测美元 / 任务。价格页单独显示厂商官方 API 单价。</p>
      <div className="benchmark-sources">{data?.sources.map(s=><article key={s.id}><div><h3>{s.name}</h3><p>{s.version}</p><span>{s.records} 条 · {date(s.checkedAt)}{s.automatic?'':' · 人工核对'}</span>{s.error&&<p role="alert">{s.error}</p>}</div><Button size="sm" onClick={()=>void api.openExternal(s.url)}>打开来源 ↗</Button></article>)}</div>
      <p>{data?.algorithm} · Epoch AI 数据遵循 CC BY 4.0；测评版本、完整配置及运行工具以记录为准。</p>
    </div></Modal>}
    {detail&&<Modal wide title={detail.name} onClose={()=>setDetail(null)} footer={<><Button onClick={()=>setDetail(null)}>关闭</Button><Button variant="primary" disabled={!selected.includes(detail.id)&&selected.length>=4} onClick={()=>{if(!selected.includes(detail.id))choose(detail.id);setTab('capability');setDetail(null);}}>查看对比</Button></>}><div className="benchmark-model-detail">
      {detail.results.length>0&&<><label className="benchmark-profile-select">测评与配置<select className="select" aria-label="详情测评配置" value={detailProfile} onChange={e=>setDetailProfile(e.target.value)}>{detail.results.map(r=><option key={r.profileId} value={r.profileId}>{r.sourceId==='epoch-ai'?(SCENARIOS.find(s=>s.id===r.kind)?.name??'Epoch'):r.sourceId==='livebench'?'LiveBench':'AA'} · {settingText(r.setting)} · {r.score.toFixed(2)}</option>)}</select></label>{currentResult&&<><div className="benchmark-detail-score"><ModelLogo name={detail.name} size={32}/><strong>{currentResult.score.toFixed(2)}</strong><span>{currentResult.sourceId==='epoch-ai'?'ECI 校准尺度':currentResult.sourceId==='livebench'?'LiveBench 综合分':'AA 原始指数'}</span></div>{currentResult.lower!=null&&currentResult.upper!=null&&<p className="benchmark-result-range">{currentResult.rangeKind==='confidence90'?'来源 90% 区间':'逐项留出敏感性范围'}：{currentResult.lower.toFixed(2)}–{currentResult.upper.toFixed(2)}{currentResult.rangeKind==='sensitivity'?'（不是置信区间）':''}</p>}{currentResult.kind==='general'&&<p>下方是固定配置的单项对照，不用于重算来源发布的综合值。</p>}<div className="benchmark-native-table"><table><thead><tr><th>分项</th><th>原始成绩</th>{currentResult.sourceId==='livebench'&&<th>权重</th>}{currentResult.sourceId==='epoch-ai'&&<><th>基线校准值</th><th>配置与来源</th></>}</tr></thead><tbody>{currentResult.components.map(c=><tr key={c.metric}><td>{c.url?<button className="benchmark-source-link" onClick={()=>void api.openExternal(c.url)}>{c.metric} ↗</button>:c.metric}{c.difficulty!=null&&<span>难度 {c.difficulty.toFixed(2)} · 斜率 {c.slope?.toFixed(4)}</span>}</td><td>{c.value.toFixed(2)}{c.unit==='percent'?'%':' Elo'}</td>{currentResult.sourceId==='livebench'&&<td>{c.weight}</td>}{currentResult.sourceId==='epoch-ai'&&<><td>{c.normalized?.toFixed(2)}</td><td>{c.configuration}<span>{c.evaluator}</span></td></>}</tr>)}</tbody></table></div><p className="benchmark-detail-version">{currentResult.version} · {settingText(currentResult.setting)}{currentResult.benchmarkCount?` · ${currentResult.benchmarkCount} 项测评`:''}{currentResult.calibrationError!=null?` · 拟合残差 ${(currentResult.calibrationError*100).toFixed(2)} 个百分点`:''}</p></>}</>}
      <div className="benchmark-source-summary">{['general','aa','livebench'].map(id=>{const r=modelResult(detail,id);return r?<article key={id}><span>{id==='general'?'Epoch ECI':id==='aa'?'AA 指数':'LiveBench'}</span><b>{r.score.toFixed(2)}</b></article>:null;})}</div>
      {official&&<section className="benchmark-official"><h3>厂商官方资料</h3><dl><div><dt>输入 / 输出 · 每百万 Token</dt><dd>{priceText(official.price?.input??null,official.price?.currency??'')} / {priceText(official.price?.output??null,official.price?.currency??'')}</dd></div></dl>{official.source&&<Button size="sm" onClick={()=>void api.openExternal(official.source)}>官方定价与条件 ↗</Button>}</section>}
      <h3>来源记录</h3>{data?.sources.filter(s=>detail.observations.some(o=>o.sourceId===s.id)).map(s=><details className="benchmark-evidence" key={s.id}><summary>{s.name}{s.automatic?'':' · 官网报告，仅作对照'}</summary><div className="benchmark-evidence-table"><table><thead><tr><th>测评</th><th>公开配置</th><th>原始成绩</th></tr></thead><tbody>{detail.observations.filter(o=>o.sourceId===s.id).map((o,i)=><tr key={i}><td><button onClick={()=>void api.openExternal(o.url)}>{o.metric} ↗</button><span>{o.version}</span></td><td>{o.setting}</td><td>{o.value.toFixed(2)}{o.unit==='percent'?'%':' Elo'}</td></tr>)}</tbody></table></div></details>)}
    </div></Modal>}
  </div>;
}

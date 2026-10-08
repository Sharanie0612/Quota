import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Modal, Notice, Seg } from "../components/ui";
import { IconLayers, IconRefresh } from "../components/icons";
import { ModelLogo } from "../components/ModelLogo";
import { api, errText } from "../lib/api";
import { priceText, timeAgo } from "../lib/format";
import { toast } from "../lib/store";
import type { LadderEntry, LadderSnapshot } from "../lib/types";
import { currencyTitle, LadderChart } from "../components/LadderChart";

import { compareNames, modelFamilies, modelFamily, reasoningLabel, releasedWithin, releaseDates } from "../lib/ladderModels";
import { AbilityRadar, abilityAxes, modelColors } from "../components/AbilityRadar";

const DOMAINS = [
  { value: "general", label: "综合能力" }, { value: "coding", label: "编程" },
  { value: "science", label: "科学推理" }, { value: "agents", label: "智能体" },
  { value: "multimodal", label: "多模态" }, {value:"math",label:"数学"}, {value:"reasoning",label:"推理"}, {value:"audio",label:"语音"}, {value:"image-gen",label:"图像生成"}, {value:"video-gen",label:"视频生成"}, {value:"image-to-video",label:"图生视频"},
];

function PriceReview({ entry, onClose }: { entry: LadderEntry; onClose: () => void }) {
  return <Modal title={`官方价格 · ${entry.name}`} onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
    <p>系统自动读取厂商官网，无需填写或人工采用价格。</p>
    <p className="hint">{entry.price.note ?? "官网暂无可确认的标准 Token 价格"}</p>
    <div className="usage-selected"><span>输入 <b>{priceText(entry.price.input,entry.price.currency)}</b></span><span>输出 <b>{priceText(entry.price.output,entry.price.currency)}</b></span><span>缓存命中 <b>{priceText(entry.price.cachedInput,entry.price.currency)}</b></span></div>
    <p className="hint">每百万 Token · 核实时间 {entry.verifiedAt ? new Date(entry.verifiedAt).toLocaleString("zh-CN") : "暂无成功核实记录"}</p>
    {entry.candidate?.error && <Notice tone="warn">{entry.candidate.error}</Notice>}
    <p className="hint">最近自动检查 {entry.candidate?.checkedAt ? new Date(entry.candidate.checkedAt).toLocaleString("zh-CN") : "尚未检查"}。可在天梯顶部重新更新排名与价格。</p>
    <Button disabled={!entry.priceSource} onClick={() => void api.openExternal(entry.priceSource).catch(e=>toast(errText(e),"error"))}>查看官网来源</Button>
  </Modal>;
}

function LadderTable({ entries, domain, onReview, label }: {
  entries: LadderEntry[]; domain: string;
  onReview: (entry: LadderEntry) => void; label: string;
}) {
  return <div className="ladder-table-scroll"><table className="ladder-table" aria-label={label}><thead><tr><th>排名</th><th>模型</th><th>能力分</th><th>输入：未命中 / 命中</th><th>输出 / 缓存写入</th></tr></thead><tbody>
    {entries.map(entry => {
      const ranking = entry.rankings[domain];
      const known = entry.price.input != null && entry.price.output != null;
      return <tr key={entry.id}><td><span className={`rank-number${ranking && ranking.rank <= 10 ? " rank-top" : ""}`}>{ranking?.rank ?? "—"}</span></td>
        <td><button className="ladder-model model-detail-trigger" onClick={() => onReview(entry)}><span className="ladder-vendor-logo"><ModelLogo name={entry.name} size={26} /></span><div><b>{entry.name}</b><span>{entry.vendor}{entry.name.includes(" (") ? ` · ${entry.name.split(" (")[1].replace(")", "")}` : ""}</span></div></button></td>
        <td>{ranking ? <div className="rank-score"><b>{ranking.score.toFixed(0)}</b><progress max={100} value={ranking.score} aria-label={`${entry.name} 能力分`} /></div> : <span className="hint">暂无评测</span>}</td>
        <td><button className="ladder-price" onClick={() => onReview(entry)}>{known ? <><b>{priceText(entry.price.input, entry.price.currency)} / {priceText(entry.price.cachedInput, entry.price.currency)}</b><span>{currencyTitle(entry.price.currency)} {entry.price.currency} · 核实 {entry.verifiedAt?.slice(0, 10) ?? "暂无官网价格"}{entry.candidate?.error ? " · 沿用上次价格" : ""}</span></> : <><Badge tone="amber">暂无官网价格</Badge><span>{currencyTitle(entry.price.currency)} {entry.price.currency}</span></>}</button></td>
        <td><b>{priceText(entry.price.output, entry.price.currency)}</b><span className="hint price-cache-line">写入 {priceText(entry.price.cacheWrite, entry.price.currency)}{entry.price.cacheWriteLong != null ? ` / 1h ${priceText(entry.price.cacheWriteLong, entry.price.currency)}` : ""}</span></td></tr>;
    })}
  </tbody></table></div>;
}

export function LadderView({ autoUpdate }: { autoUpdate: boolean }) {
  const [data, setData] = useState<LadderSnapshot | null>(null);
  const [mode,setMode]=useState("chart");
  const [exchange, setExchange] = useState<Awaited<ReturnType<typeof api.getExchangeRate>> | null>(null);
  useEffect(() => { let live = true; const loadRate = () => void api.getExchangeRate().then(rate => { if (live) setExchange(rate); }).catch(() => undefined); loadRate(); const timer = window.setInterval(loadRate, 3600000); return () => { live = false; clearInterval(timer); }; }, []);
  const [focused,setFocused]=useState<LadderEntry|null>(null);
  const [domain, setDomain] = useState("general");
  const [vendor, setVendor] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [sort, setSort] = useState("rank");
  const [releaseWindow, setReleaseWindow] = useState("all");
  const [abilitySort, setAbilitySort] = useState("vendor");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<LadderEntry | null>(null);
  const load = useCallback(async () => { try { setData(await api.getLadder()); setError(null); } catch { setError("暂时无法读取天梯，请重试"); } }, []);
  const refresh = useCallback(async (force: boolean) => {
    setBusy(true);
    try { setData(await api.refreshLadder(force)); setError(null); }
    catch { setError("更新失败，继续显示已有数据"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!autoUpdate) return;
    void refresh(false);
    const timer = window.setInterval(() => void refresh(false), 3600_000);
    return () => window.clearInterval(timer);
  }, [autoUpdate, refresh]);
  const supported = ["OpenAI", "Anthropic", "Google", "DeepSeek", "Kimi", "Z AI", "Xiaomi", "Alibaba", "SpaceXAI", "Meta"];
  const vendors = supported.filter((v) => data?.entries.some((e) => e.vendor === v));
  const dates = useMemo(() => releaseDates(data?.entries ?? []), [data]);
  const recent = useMemo(() => modelFamilies((data?.entries ?? []).filter(e => supported.includes(e.vendor) && releasedWithin(dates.get(modelFamily(e)), 7))), [data, dates]);
  const entries = useMemo(() => {
    const list = (data?.entries ?? []).filter((e) => supported.includes(e.vendor) && (releaseWindow === "all" || releasedWithin(dates.get(modelFamily(e)), Number(releaseWindow))) && (vendor === "all" || e.vendor === vendor) && (currency === "all" || e.price.currency === currency) && `${e.name} ${e.vendor}`.toLowerCase().includes(search.toLowerCase()));
    return list.sort((a, b) => {
      if (sort === "price") {
        const cost = (e: LadderEntry) => e.price.input == null || e.price.output == null ? Infinity : e.price.input + e.price.output;
        if ((cost(a) === Infinity) !== (cost(b) === Infinity)) return cost(a) === Infinity ? 1 : -1;
        if (currency === "all" && a.price.currency !== b.price.currency) return a.price.currency.localeCompare(b.price.currency);
        return cost(a) - cost(b) || (a.rankings[domain]?.rank ?? Infinity) - (b.rankings[domain]?.rank ?? Infinity);
      }
      return (a.rankings[domain]?.rank ?? Infinity) - (b.rankings[domain]?.rank ?? Infinity);
    });
  }, [data, vendor, currency, sort, search, domain, releaseWindow, dates]);
  const tableGroups = [{ key: "combined", title: "模型排名", entries }];
  useEffect(() => { setFocused(current => current ? entries.find(e => e.id === current.id) ?? null : null); }, [entries]);
  const families = useMemo(() => modelFamilies(entries, abilitySort), [entries, abilitySort]);
  useEffect(() => { setSelected(current => current.map(id => entries.some(e => e.id === id) ? id : "")); }, [entries]);
  const compare = selected.map(id=>entries.find(e=>e.id===id)).filter((entry):entry is LadderEntry=>!!entry);
  return <div className="content-inner ladder-page">
    <div className="ladder-hero card"><div><span className="eyebrow">AI 模型天梯</span><h2>找到适合你的模型</h2><p>十家厂商 · 能力排名 · 官方价格</p></div>
      <div className="ladder-sync"><span className="hint">更新于 {timeAgo(data?.updatedAt)}{autoUpdate ? " · 每日检查" : " · 手动更新"}</span><Button disabled={busy} onClick={() => void refresh(true)}><IconRefresh size={14} className={busy ? "spin" : ""} />{busy ? "更新中…" : "更新排名与价格"}</Button></div></div>
    {error || data?.error ? <Notice tone="warn" actions={<Button size="sm" onClick={() => void refresh(true)} disabled={busy}>重试</Button>}>{error ?? data?.error}</Notice> : null}

    <div className="ladder-toolbar"><Seg value={mode} options={[{value:"chart",label:"图表"},{value:"table",label:"列表"},{value:"ability",label:"能力图"}]} onChange={setMode}/><select className="select" aria-label="能力分类" value={domain} onChange={e=>setDomain(e.target.value)}>{DOMAINS.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select>
      <input className="input ladder-search" aria-label="搜索模型" placeholder="搜索模型" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
    <div className="ladder-release-filter"><label>推出时间 <select className="select" aria-label="模型推出时间" value={releaseWindow} onChange={e=>setReleaseWindow(e.target.value)}><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="365">近 1 年</option><option value="all">全部</option></select></label><span className="hint">{modelFamilies(entries).length} 款模型 · {entries.length} 个评测档位{releaseWindow !== "all" ? " · 未知推出日期不纳入" : ""}</span>{recent.length > 0 && <Button size="sm" variant="quiet" onClick={()=>setReleaseWindow("7")}><Badge tone="blue">7 天内新模型</Badge>{recent.length} 款 · 查看</Button>}</div>
    <details className="ladder-filter-details"><summary>更多筛选</summary><div className="ladder-filters">
      <select className="select" aria-label="筛选厂商" value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="all">全部厂商</option>{vendors.map((v) => <option key={v}>{v}</option>)}</select>
      <select className="select" aria-label="价格币种" value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="all">原厂币种</option><option value="CNY">人民币</option><option value="USD">美元</option></select>
      <select className="select" aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value)}><option value="rank">能力排名</option><option value="price">按币种 · 价格从低到高</option></select>
      <span className="hint">原厂标准价格 · 缓存价格独立</span>
    </div></details>
    {mode === "chart" && !data && <div className="card section">读取中…</div>}
    {mode==="chart" && data && (entries.length ? <LadderChart entries={entries} domain={domain} focused={focused} onFocus={setFocused} exchange={exchange} /> : <div className="card"><EmptyState icon={<IconLayers size={24}/>} title="没有匹配的模型" desc="试试更长的推出时间范围或其他筛选条件"/></div>)}
    <div className={`ladder-layout${mode==="chart"?" chart-layout":""}`}><div className="ladder-tables" hidden={mode!=="table"}>
      {!data ? <div className="card section">读取中…</div> : !entries.length ? <div className="card"><EmptyState icon={<IconLayers size={24} />} title="没有匹配的模型" desc="试试其他筛选条件" /></div> : tableGroups.map(group => <section className="card ladder-table-wrap" key={group.key}>
        <div className="ladder-table-heading"><h3>{group.title}</h3><span>{group.entries.length} 个模型 · 每百万 Token</span></div>
        <LadderTable entries={group.entries} domain={domain} onReview={setFocused} label={`${group.title}模型天梯`} />
      </section>)}
    </div></div>
    {mode === "ability" && <section className="card ability-compare"><div className="usage-heading"><h3>六维能力对比</h3><span className="hint">最多选择 3 个模型 · 缺失维度留空</span></div><label className="ability-sort">模型排序 <select className="select" aria-label="能力图模型排序" value={abilitySort} onChange={e=>setAbilitySort(e.target.value)}><option value="vendor">厂商 → 模型名称</option><option value="name">模型名称</option></select></label><div className="ability-picker">{[0,1,2].map(i=>{
      const entry = entries.find(e=>e.id===selected[i]);
      const family = families.find(g=>g.key===(entry ? modelFamily(entry) : ""));
      const choose = (id:string) => setSelected(current=>{const next=[...current];next[i]=id;return next;});
      const inUse = (id:string) => selected.some((value,index)=>index!==i&&value===id);
      const options = families.filter(g=>g.variants.some(v=>!inUse(v.id)));
      const option = (g:typeof families[number]) => <option key={g.key} value={g.key}>{abilitySort==="name" ? `${g.name} · ${g.vendor}` : g.name}</option>;
      return <div className="ability-slot" key={i}><label>模型 {i+1}<select className="select" aria-label={`对比模型 ${i+1}`} value={family?.key ?? ""} onChange={event=>{
        const variants=options.find(g=>g.key===event.target.value)?.variants.filter(e=>!inUse(e.id));
        choose(variants?.find(e=>reasoningLabel(e)===(entry ? reasoningLabel(entry) : "Max"))?.id ?? variants?.[variants.length-1]?.id ?? "");
      }}><option value="">选择模型</option>{abilitySort==="vendor" ? [...new Set(options.map(g=>g.vendor))].sort(compareNames).map(v=><optgroup key={v} label={v}>{options.filter(g=>g.vendor===v).map(option)}</optgroup>) : options.map(option)}</select></label>
      <label>推理强度<select className="select" aria-label={`模型 ${i+1} 推理强度`} value={entry?.id ?? ""} disabled={!family || family.variants.length<2} onChange={event=>choose(event.target.value)}>{family ? family.variants.map(e=><option key={e.id} value={e.id} disabled={inUse(e.id)}>{reasoningLabel(e)}{family.variants.filter(v=>reasoningLabel(v)===reasoningLabel(e)).length>1 ? ` · ${e.name}` : ""}</option>) : <option value="">先选择模型</option>}</select></label></div>;
    })}</div>{compare.length ? <><AbilityRadar entries={compare}/><div className="ability-legend">{compare.map((e,i)=><button key={e.id} onClick={()=>setFocused(e)} style={{color:modelColors[i]}}><ModelLogo name={e.name} size={20}/>{e.name}</button>)}</div><table className="ladder-table"><thead><tr><th>维度</th>{compare.map(e=><th key={e.id}>{e.name}</th>)}</tr></thead><tbody>{abilityAxes.map(a=><tr key={a.key}><td>{a.label}</td>{compare.map(e=><td key={e.id}>{e.rankings[a.key]?.score.toFixed(1) ?? "暂无评测"}</td>)}</tr>)}</tbody></table></> : <EmptyState icon={<IconLayers size={24}/>} title="选择模型，比较六维能力" desc="综合、编程、数学、科学、推理与智能体"/>}</section>}
    {focused && <Modal title={focused.name} onClose={()=>setFocused(null)} footer={<Button onClick={()=>setFocused(null)}>关闭</Button>}><div className="model-mini-card"><AbilityRadar entries={[focused]}/><div><p><ModelLogo name={focused.name} size={24}/> {focused.vendor}</p><p>推出时间 {releasedWithin(dates.get(modelFamily(focused)),7)&&<Badge tone="blue">7 天内新模型</Badge>} <b>{dates.get(modelFamily(focused)) ?? "暂无资料"}</b></p><p className="hint">日期来源 AITier · 每百万 Token · {focused.price.currency}</p><dl><dt>输入</dt><dd>{priceText(focused.price.input,focused.price.currency)}</dd><dt>缓存命中</dt><dd>{priceText(focused.price.cachedInput,focused.price.currency)}</dd><dt>输出</dt><dd>{priceText(focused.price.output,focused.price.currency)}</dd></dl><Button size="sm" onClick={()=>{setReview(focused);setFocused(null);}}>价格与来源</Button></div></div><div className="radar-values">{abilityAxes.map(a=><span key={a.key}>{a.label} <b>{focused.rankings[a.key]?.score.toFixed(1) ?? "—"}</b></span>)}</div></Modal>}
    <div className="ladder-source"><span>AITier 能力评分 · 官方标准价格</span><Button size="sm" variant="quiet" onClick={() => void api.openExternal(data?.source ?? "https://aitier.net/zh").catch((e) => toast(errText(e), "error"))}>查看排名来源</Button></div>
    {review ? <PriceReview entry={data?.entries.find(e=>e.id===review.id) ?? review} onClose={() => setReview(null)} /> : null}
  </div>;
}

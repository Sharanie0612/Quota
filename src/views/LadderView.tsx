import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Modal, Notice, Seg } from "../components/ui";
import { IconLayers, IconRefresh } from "../components/icons";
import { ModelLogo } from "../components/ModelLogo";
import { api, errText } from "../lib/api";
import { priceText, timeAgo } from "../lib/format";
import { toast } from "../lib/store";
import type { LadderEntry, LadderSnapshot } from "../lib/types";
import { currencyTitle, LadderChart, ladderCurrencyGroups, type LadderLayout } from "../components/LadderChart";

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

function LadderTable({ entries, domain, selected, onToggle, onReview, label }: {
  entries: LadderEntry[]; domain: string; selected: string[]; onToggle: (id: string) => void;
  onReview: (entry: LadderEntry) => void; label: string;
}) {
  return <div className="ladder-table-scroll"><table className="ladder-table" aria-label={label}><thead><tr><th>排名</th><th>模型</th><th>能力分</th><th>输入：未命中 / 命中</th><th>输出 / 缓存写入</th><th>对比</th></tr></thead><tbody>
    {entries.map(entry => {
      const ranking = entry.rankings[domain];
      const known = entry.price.input != null && entry.price.output != null;
      return <tr key={entry.id}><td><span className={`rank-number${ranking && ranking.rank <= 10 ? " rank-top" : ""}`}>{ranking?.rank ?? "—"}</span></td>
        <td><div className="ladder-model"><span className="ladder-vendor-logo"><ModelLogo name={entry.name} size={26} /></span><div><b>{entry.name}</b><span>{entry.vendor}{entry.name.includes(" (") ? ` · ${entry.name.split(" (")[1].replace(")", "")}` : ""}</span></div></div></td>
        <td>{ranking ? <div className="rank-score"><b>{ranking.score.toFixed(0)}</b><progress max={100} value={ranking.score} aria-label={`${entry.name} 能力分`} /></div> : <span className="hint">暂无评测</span>}</td>
        <td><button className="ladder-price" onClick={() => onReview(entry)}>{known ? <><b>{priceText(entry.price.input, entry.price.currency)} / {priceText(entry.price.cachedInput, entry.price.currency)}</b><span>{currencyTitle(entry.price.currency)} {entry.price.currency} · 核实 {entry.verifiedAt?.slice(0, 10) ?? "暂无官网价格"}{entry.candidate?.error ? " · 沿用上次价格" : ""}</span></> : <><Badge tone="amber">暂无官网价格</Badge><span>{currencyTitle(entry.price.currency)} {entry.price.currency}</span></>}</button></td>
        <td><b>{priceText(entry.price.output, entry.price.currency)}</b><span className="hint price-cache-line">写入 {priceText(entry.price.cacheWrite, entry.price.currency)}{entry.price.cacheWriteLong != null ? ` / 1h ${priceText(entry.price.cacheWriteLong, entry.price.currency)}` : ""}</span></td>
        <td><input type="checkbox" checked={selected.includes(entry.id)} disabled={selected.length >= 3 && !selected.includes(entry.id)} onChange={() => onToggle(entry.id)} aria-label={`对比 ${entry.name}`} /></td></tr>;
    })}
  </tbody></table></div>;
}

export function LadderView({ autoUpdate }: { autoUpdate: boolean }) {
  const [data, setData] = useState<LadderSnapshot | null>(null);
  const [mode,setMode]=useState("chart");
  const [layout, setLayout] = useState<LadderLayout>("combined");
  const [exchange, setExchange] = useState<Awaited<ReturnType<typeof api.getExchangeRate>> | null>(null);
  useEffect(() => { let live = true; const loadRate = () => void api.getExchangeRate().then(rate => { if (live) setExchange(rate); }).catch(() => undefined); loadRate(); const timer = window.setInterval(loadRate, 3600000); return () => { live = false; clearInterval(timer); }; }, []);
  const [focused,setFocused]=useState<LadderEntry|null>(null);
  const [domain, setDomain] = useState("general");
  const [vendor, setVendor] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [sort, setSort] = useState("rank");
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
  const entries = useMemo(() => {
    const list = (data?.entries ?? []).filter((e) => supported.includes(e.vendor) && (vendor === "all" || e.vendor === vendor) && (currency === "all" || e.price.currency === currency) && `${e.name} ${e.vendor}`.toLowerCase().includes(search.toLowerCase()));
    return list.sort((a, b) => {
      if (sort === "price") {
        const cost = (e: LadderEntry) => e.price.input == null || e.price.output == null ? Infinity : e.price.input + e.price.output;
        if ((cost(a) === Infinity) !== (cost(b) === Infinity)) return cost(a) === Infinity ? 1 : -1;
        if (currency === "all" && a.price.currency !== b.price.currency) return a.price.currency.localeCompare(b.price.currency);
        return cost(a) - cost(b) || (a.rankings[domain]?.rank ?? Infinity) - (b.rankings[domain]?.rank ?? Infinity);
      }
      return (a.rankings[domain]?.rank ?? Infinity) - (b.rankings[domain]?.rank ?? Infinity);
    });
  }, [data, vendor, currency, sort, search, domain]);
  const tableGroups = layout === "split" ? ladderCurrencyGroups(entries).map(group => ({
    key: group.currency, title: `${currencyTitle(group.currency)} ${group.currency}`, entries: group.entries,
  })) : [{ key: "combined", title: "合并视图", entries }];
  useEffect(() => { setFocused(current => current ? entries.find(e => e.id === current.id) ?? null : null); }, [entries]);
  const compare = (data?.entries ?? []).filter((e) => selected.includes(e.id));
  const toggle = (id: string) => setSelected((s) => s.includes(id) ? s.filter((v) => v !== id) : s.length < 3 ? [...s, id] : s);
  return <div className="content-inner ladder-page">
    <div className="ladder-hero card"><div><span className="eyebrow">AI 模型天梯</span><h2>找到适合你的模型</h2><p>十家厂商 · 能力排名 · 官方价格</p></div>
      <div className="ladder-sync"><span className="hint">更新于 {timeAgo(data?.updatedAt)}{autoUpdate ? " · 每日检查" : " · 手动更新"}</span><Button disabled={busy} onClick={() => void refresh(true)}><IconRefresh size={14} className={busy ? "spin" : ""} />{busy ? "更新中…" : "更新排名与价格"}</Button></div></div>
    {error || data?.error ? <Notice tone="warn" actions={<Button size="sm" onClick={() => void refresh(true)} disabled={busy}>重试</Button>}>{error ?? data?.error}</Notice> : null}
    {data?.checkedAt && <p className="hint" role="status">本次官网自动核实 {data.entries.filter(e=>e.candidate && !e.candidate.error).length} / {data.entries.length} 个评测型号 · 其余型号显示官网缺失或读取失败原因，系统自动重试。</p>}
    <div className="ladder-toolbar"><Seg value={mode} options={[{value:"chart",label:"图表"},{value:"table",label:"列表"}]} onChange={setMode}/><div className="ladder-layout-toggle" role="group" aria-label="币种展示方式"><Seg value={layout} options={[{value:"split",label:mode === "chart" ? "两张图表" : "分两表"},{value:"combined",label:"合并视图"}]} onChange={setLayout}/></div><select className="select" aria-label="能力分类" value={domain} onChange={e=>setDomain(e.target.value)}>{DOMAINS.map(d=><option key={d.value} value={d.value}>{d.label}</option>)}</select>
      <input className="input ladder-search" aria-label="搜索模型" placeholder="搜索模型" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
    <details className="ladder-filter-details"><summary>更多筛选</summary><div className="ladder-filters">
      <select className="select" aria-label="筛选厂商" value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="all">全部厂商</option>{vendors.map((v) => <option key={v}>{v}</option>)}</select>
      <select className="select" aria-label="价格币种" value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="all">原厂币种</option><option value="CNY">人民币</option><option value="USD">美元</option></select>
      <select className="select" aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value)}><option value="rank">能力排名</option><option value="price">按币种 · 价格从低到高</option></select>
      <span className="hint">原厂标准价格 · 缓存价格独立</span>
    </div></details>
    {mode === "chart" && !data && <div className="card section">读取中…</div>}
    {mode==="chart" && data && <LadderChart entries={entries} domain={domain} focused={focused} onFocus={setFocused} layout={layout} exchange={exchange} />}
    {mode==="chart" && focused && <div className="card ladder-focused"><b>{focused.name}</b><span>{focused.vendor} · 能力分 {focused.rankings[domain]?.score.toFixed(1)??"暂无评测"}</span><span>未命中 {priceText(focused.price.input,focused.price.currency)} · 命中 {priceText(focused.price.cachedInput??null,focused.price.currency)} · 输出 {priceText(focused.price.output,focused.price.currency)}</span><span className="hint">核实 {focused.verifiedAt?.slice(0,10) ?? "暂无官网价格"} · 每百万 Token</span>{focused.candidate?.error && <span className="hint">本次官网未确认：{focused.candidate.error}</span>}<div><Button size="sm" disabled={selected.length >= 3 && !selected.includes(focused.id)} onClick={()=>toggle(focused.id)}>{selected.includes(focused.id) ? "移出对比" : "加入对比"}</Button><Button size="sm" onClick={()=>setReview(focused)}>价格详情</Button></div></div>}
    <div className={`ladder-layout${mode==="chart"?" chart-layout":""}`}><div className="ladder-tables" hidden={mode!=="table"}>
      {!data ? <div className="card section">读取中…</div> : !entries.length ? <div className="card"><EmptyState icon={<IconLayers size={24} />} title="没有匹配的模型" desc="试试其他筛选条件" /></div> : tableGroups.map(group => <section className="card ladder-table-wrap" key={group.key}>
        <div className="ladder-table-heading"><h3>{group.title}</h3><span>{group.entries.length} 个模型{layout === "combined" ? " · 保留原币种" : " · 每百万 Token"}</span></div>
        <LadderTable entries={group.entries} domain={domain} selected={selected} onToggle={toggle} onReview={setReview} label={`${group.title}模型天梯`} />
      </section>)}
    </div><aside className="ladder-compare card" hidden={!compare.length}><h3>模型对比 <Badge>{compare.length}/3</Badge></h3>
      {!compare.length ? <p className="hint">选中最多 3 个模型，比较能力与成本。</p> : compare.map((e) => <div key={e.id} className="compare-model"><div><b>{e.name}</b><button className="btn btn-quiet btn-sm" aria-label={`移除 ${e.name}`} onClick={() => toggle(e.id)}>移除</button></div>
        {DOMAINS.map((d) => <div className="compare-metric" key={d.value}><span>{d.label}</span><b>{e.rankings[d.value]?.score.toFixed(0) ?? "—"}</b></div>)}
        <div className="compare-metric"><span>缓存命中</span><b>{priceText(e.price.cachedInput??null,e.price.currency)}</b></div><div className="compare-metric"><span>缓存写入</span><b>{priceText(e.price.cacheWrite??null,e.price.currency)}</b></div>
        <div className="compare-metric"><span>输入 / 输出</span><b>{priceText(e.price.input, e.price.currency)} / {priceText(e.price.output, e.price.currency)}</b></div><p className="hint">{e.price.note}</p>
        <Button size="sm" disabled={!e.priceSource} onClick={() => void api.openExternal(e.priceSource).catch((err) => toast(errText(err), "error"))}>官方定价</Button>
      </div>)}
    </aside></div>
    <div className="ladder-source"><span>排名与能力分来自 AITier，推理版本保留原名；合并图使用 ECB 参考汇率，官方价格保留原币种。</span><Button size="sm" variant="quiet" onClick={() => void api.openExternal(data?.source ?? "https://aitier.net/zh").catch((e) => toast(errText(e), "error"))}>查看排名来源</Button></div>
    {review ? <PriceReview entry={data?.entries.find(e=>e.id===review.id) ?? review} onClose={() => setReview(null)} /> : null}
  </div>;
}

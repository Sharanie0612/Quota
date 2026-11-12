import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, errText } from "../lib/api";
import type { AiModelSnapshot, BenchmarkBoard, LadderSnapshot } from "../lib/types";
import { aaDomains, aaLeaderboard, aaMethodology, aaSource, aaVersion, evaluationWeight, scoreOptions, visualAxes } from "../lib/aaMethodology";
import { filterVisualModels, inEvaluationWindow, rankVisualModels, visualModels, type EvaluationScope, type VisualModel } from "../lib/visualModels";
import { plotPrice, validExchange, type LadderExchange } from "../lib/ladderPlot";
import { AbilityRadar, modelColors } from "../components/AbilityRadar";
import { BenchmarkBreakdown } from "../components/BenchmarkBreakdown";
import { LadderChart } from "../components/LadderChart";
import { Button, EmptyState, Modal, Notice, Seg } from "../components/ui";
import { IconRefresh, IconSearch } from "../components/icons";
import { ModelLogo } from "../components/ModelLogo";
import { priceText } from "../lib/format";
import "./model-ladder.css";

const compareLimit = 3;
const labelScope = [
  { value: "main30", label: "主力 · 近 30 天测评" },
  { value: "main", label: "主力配置" },
  { value: "all30", label: "近 30 天 · 全部配置" },
  { value: "all", label: "全部有效测评" },
];
const referenceNote = "领域分按公开分项及权重计算。知识工作使用公开 Elo 估算，AA 综合指数采用来源发布值。";

function ModelDetail({ model, onClose, onCompare, canCompare }: {
  model: VisualModel;
  onClose: () => void;
  onCompare: () => void;
  canCompare: boolean;
}) {
  const { entry, profile, release, edition, breakdown } = model;
  return <Modal wide title={entry.name} onClose={onClose} footer={<>
    <Button onClick={onClose}>关闭</Button>
    <Button variant="primary" onClick={onCompare} disabled={!canCompare}>查看对比</Button>
  </>}>
    <div className="benchmark-detail">
      <div className="benchmark-detail-summary">
        <div className="visual-model-score">
          <ModelLogo name={entry.name} size={30} />
          <div><span>AA 综合指数 · {aaVersion(profile.version)}</span><strong>{profile.index.toFixed(1)}</strong></div>
        </div>
        <dl>
          <dt>评测配置</dt><dd>{profile.setting}</dd>
          <dt>版本发布日期</dt><dd>{edition?.publishedAt || "未确认具体日期"}</dd>
          <dt>型号发布</dt><dd>{release?.releasedAt ?? "未确认"}</dd>
          <dt>公开分项</dt><dd>{breakdown.coverage} / 9</dd>
        </dl>
        <dl>
          <dt>输入</dt><dd>{priceText(entry.price.input, entry.price.currency)}</dd>
          <dt>输出</dt><dd>{priceText(entry.price.output, entry.price.currency)}</dd>
          <dt>缓存命中</dt><dd>{priceText(entry.price.cachedInput, entry.price.currency)}</dd>
          <dt>计价单位</dt><dd>{entry.verifiedAt ? entry.price.unit : "—"}</dd>
          <dt>价格核实</dt><dd>{entry.verifiedAt ? new Date(entry.verifiedAt).toLocaleDateString("zh-CN") : "待核实"}</dd>
          {entry.price.note && <><dt>计费条件</dt><dd>{entry.price.note}</dd></>}
        </dl>
      </div>
      <div className="visual-model-links">
        <Button size="sm" onClick={() => void api.openExternal(aaLeaderboard)}>评测来源</Button>
        {entry.priceSource && <Button size="sm" onClick={() => void api.openExternal(entry.priceSource)}>厂商官方定价</Button>}
      </div>
      <BenchmarkBreakdown models={[model]} />
      <p className="benchmark-note">{referenceNote}</p>
    </div>
  </Modal>;
}

function ModelComparison({ models, selected, onSelect, onRemove }: {
  models: VisualModel[];
  selected: VisualModel[];
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const vendors = [...new Set(models.map(model => model.entry.vendor))].sort();
  const selectedIds = new Set(selected.map(model => model.entry.id));
  return <section className="card visual-ability">
    <div className="visual-ability-heading">
      <h2>能力对比</h2>
      <select className="select" aria-label="添加对比配置" value="" disabled={selected.length >= compareLimit}
        onChange={event => onSelect(event.target.value)}>
        <option value="">{selected.length >= compareLimit ? "已选 3 个配置" : "添加型号与配置"}</option>
        {vendors.map(vendor => {
          const options = models.filter(model => model.entry.vendor === vendor && !selectedIds.has(model.entry.id));
          return options.length > 0 && <optgroup key={vendor} label={vendor}>
            {options.map(model => <option key={model.entry.id} value={model.entry.id}>{model.entry.name}</option>)}
          </optgroup>;
        })}
      </select>
    </div>
    <div className="visual-compare-selected">
      {selected.map((model, index) => <button key={model.entry.id} onClick={() => onRemove(model.entry.id)}
        aria-label={`移除 ${model.entry.name}`}>
        <i style={{ background: modelColors[index] }} />{model.entry.name}<span aria-hidden="true">×</span>
      </button>)}
    </div>
    {selected.length > 0 ? <>
      <AbilityRadar entries={selected.map(model => model.entry)} axes={visualAxes} label="四个领域的能力对比图" />
      <BenchmarkBreakdown models={selected} />
      <p className="benchmark-note">{referenceNote}</p>
    </> : <EmptyState icon={<IconSearch size={24} />} title="添加一个评测配置开始对比" />}
  </section>;
}

function Methodology({ board, registry, exchange, onClose }: {
  board: BenchmarkBoard | null;
  registry: AiModelSnapshot | null;
  exchange: LadderExchange | null;
  onClose: () => void;
}) {
  const source = board?.sources.find(source => source.id === aaSource);
  return <Modal wide title="评测方法与来源" onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
    <div className="visual-model-method">
      <p>Artificial Analysis v5.0.1 将四个领域各计 25%。Quota 按同一型号、推理档位与回退设置展示来源发布的综合指数。</p>
      <p>领域分按公开分项加权换算到 0–100，分项缺失时留空。知识工作按公开 Elo 换算为参考分，AA 使用加入指数时冻结的 Elo。评测以英文文本任务为主。</p>
      <div className="benchmark-method-grid">
        {aaDomains.map(domain => <section key={domain.id}>
          <h3>{domain.label} <small>25%</small></h3>
          <ul>{domain.evaluations.map(evaluation => <li key={evaluation.name}>
            <strong>{evaluation.name} · {evaluationWeight(evaluation)}%</strong>
            <span>{evaluation.scoring}</span>
          </li>)}</ul>
        </section>)}
      </div>
      <p>价格采用厂商标准 Token 单价。人民币图表使用 ECB 汇率{validExchange(exchange) ? `（${exchange.date}，1 USD ≈ ${exchange.cnyPerUsd.toFixed(4)} CNY）` : "，汇率缺失时美元模型保留在榜单"}。</p>
      {source?.checkedAt && <p>当前快照 {aaVersion(source.edition?.version) ?? source.version} · {new Date(source.checkedAt).toLocaleString("zh-CN")}</p>}
      {source?.error && <Notice tone="warn">{source.error}</Notice>}
      {registry?.sources.filter(source => source.error).map(source => <p key={source.vendor}>{source.vendor} · {source.error}</p>)}
      <div className="visual-model-links">
        <Button onClick={() => void api.openExternal(aaMethodology)}>Artificial Analysis 方法原文</Button>
        {source?.edition && <Button onClick={() => void api.openExternal(source.edition!.url)}>版本记录</Button>}
      </div>
    </div>
  </Modal>;
}

export function AiModelsHub({ initialVendor = "all" }: { initialVendor?: string }) {
  const [board, setBoard] = useState<BenchmarkBoard | null>(null);
  const [registry, setRegistry] = useState<AiModelSnapshot | null>(null);
  const [legacy, setLegacy] = useState<LadderSnapshot | null>(null);
  const [exchange, setExchange] = useState<LadderExchange | null>(null);
  const [tab, setTab] = useState("ladder");
  const [view, setView] = useState("ranking");
  const [domain, setDomain] = useState("general");
  const [scopeChoice, setScope] = useState<EvaluationScope | null>(null);
  const [vendor, setVendor] = useState(initialVendor);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<string[] | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [method, setMethod] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let revision = 0;
    async function load() {
      const request = ++revision;
      const [benchmarks, models, ladder, fx] = await Promise.allSettled([
        api.getBenchmarks(), api.getAiModels(), api.getLadder(), api.getExchangeRate(),
      ]);
      if (!active || request !== revision) return;
      if (benchmarks.status === "fulfilled") setBoard(benchmarks.value);
      if (models.status === "fulfilled") setRegistry(models.value);
      if (ladder.status === "fulfilled") setLegacy(ladder.value);
      if (fx.status === "fulfilled") setExchange(fx.value);
      setError([benchmarks, models, ladder, fx].flatMap(result => result.status === "rejected" ? [errText(result.reason)] : []).join(" · "));
      setLoaded(true);
    }
    void load();
    const subscription = listen("benchmarks-updated", () => void load());
    return () => { active = false; void subscription.then(unlisten => unlisten()); };
  }, []);

  const all = useMemo(() => board ? visualModels(board, registry, legacy) : [], [board, registry, legacy]);
  const source = board?.sources.find(source => source.id === aaSource);
  const scope = scopeChoice ?? (inEvaluationWindow(source?.edition?.publishedAt, 30) ? "main30" : source?.edition ? "main" : "all");
  const inScope = filterVisualModels(all, scope);
  const query = search.trim().toLowerCase();
  const filtered = inScope.filter(model => (vendor === "all" || model.entry.vendor === vendor)
    && `${model.entry.name} ${model.entry.vendor}`.toLowerCase().includes(query));
  const ranked = rankVisualModels(filtered, domain);
  const scoreLabel = scoreOptions.find(option => option.key === domain)?.label ?? "综合指数";
  const vendors = [...new Set(all.map(model => model.entry.vendor))].sort();
  const primary = filterVisualModels(all, "main");
  const featured = primary.length ? primary : all;
  const defaults = featured.filter((model, index) => featured.findIndex(candidate => candidate.model.id === model.model.id
    && candidate.entry.vendor === model.entry.vendor) === index).slice(0, compareLimit).map(model => model.entry.id);
  const selected = (selection ?? []).filter(id => all.some(model => model.entry.id === id));
  const comparisons = selected.flatMap(id => all.filter(model => model.entry.id === id));
  const detail = all.find(model => model.entry.id === detailId);
  const versions = [...new Set(all.map(model => aaVersion(model.profile.version)))];
  const edition = aaVersion(source?.edition?.version) ?? versions.join(" / ");

  function toggleCompare(id: string) {
    setSelection(previous => {
      const ids = (previous ?? selected).filter(id => all.some(model => model.entry.id === id));
      if (ids.includes(id)) return ids.filter(value => value !== id);
      return ids.length < compareLimit ? [...ids, id] : ids;
    });
  }

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const [scores, prices] = await Promise.allSettled([api.refreshBenchmarks(), api.refreshAiModels(true)]);
      if (scores.status === "fulfilled") setBoard(scores.value);
      if (prices.status === "fulfilled") setRegistry(prices.value);
      const [ladder, fx] = await Promise.allSettled([api.getLadder(), api.getExchangeRate()]);
      if (ladder.status === "fulfilled") setLegacy(ladder.value);
      if (fx.status === "fulfilled") setExchange(fx.value);
      setError([scores, prices, ladder, fx].flatMap(result => result.status === "rejected" ? [errText(result.reason)] : []).join(" · "));
    } finally {
      setLoaded(true);
      setBusy(false);
    }
  }

  return <div className="content-inner visual-model-page" data-evaluation-scope={scope} data-benchmark-edition={edition}>
    <header className="visual-model-toolbar">
      <div className="visual-model-title"><h1>AI 模型</h1>{edition && <span>Artificial Analysis · {edition}</span>}</div>
      <div className="visual-model-actions">
        <Button size="sm" variant="quiet" onClick={() => setMethod(true)}>评测方法与来源</Button>
        <Button size="sm" disabled={busy} onClick={() => void refresh()}>
          <IconRefresh size={14} className={busy ? "spin" : ""} />{busy ? "更新中…" : "更新数据"}
        </Button>
      </div>
    </header>
    <div className="benchmark-navigation">
      <Seg value={tab} options={[{ value: "ladder", label: "模型天梯" }, { value: "ability", label: "能力对比" }]} onChange={value => {
        if (value === "ability" && selection === null) setSelection(defaults);
        setTab(value);
      }} />
      {tab === "ladder" && <Seg value={view} options={[{ value: "ranking", label: "榜单" }, { value: "chart", label: "价格 × 能力" }]} onChange={setView} />}
    </div>
    {error && <Notice tone="warn">{error}</Notice>}
    {(source?.error || registry?.sources.some(source => source.error)) && <Notice tone="warn"
      actions={<Button size="sm" onClick={() => setMethod(true)}>查看来源</Button>}>
      部分来源更新失败，正在使用上次有效数据。
    </Notice>}
    {!loaded ? <EmptyState icon={<IconSearch size={24} />} title="正在读取评测…" /> : tab === "ladder" ? <>
      <div className="visual-model-filters">
        <div className="search"><IconSearch size={15} /><input className="input" aria-label="搜索天梯模型"
          placeholder="搜索模型或厂商" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <select className="select" aria-label="天梯厂商" value={vendor} onChange={event => setVendor(event.target.value)}>
          <option value="all">全部厂商</option>
          {vendors.map(name => <option key={name}>{name}</option>)}
        </select>
        <select className="select" aria-label="测评范围" value={scope} onChange={event => setScope(event.target.value as EvaluationScope)}>
          {labelScope.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <nav className="benchmark-domains" aria-label="能力评分维度">
        {scoreOptions.map(option => <button key={option.key} type="button" aria-pressed={domain === option.key}
          onClick={() => setDomain(option.key)}>
          <strong>{option.label}</strong><span>{option.key === "general" ? "AA 发布值" : "25% 权重"}</span>
        </button>)}
      </nav>
      <div className="benchmark-result-info">
        <span role="status">{ranked.length} 个配置{filtered.length > ranked.length && ` · ${filtered.length - ranked.length} 个分项不齐`}</span>
        {domain !== "general" && <span>{domain === "knowledge-work" ? "使用公开 Elo 的领域参考分" : "按公开分项计算的领域分"}</span>}
        {selected.length > 0 && <Button size="sm" variant="quiet" onClick={() => setTab("ability")}>对比 {selected.length} 个配置</Button>}
      </div>
      {view === "chart" ? <LadderChart entries={filtered.map(model => model.entry)} domain={domain} scoreLabel={scoreLabel}
        focused={detail?.entry ?? null} onFocus={entry => setDetailId(entry.id)} exchange={exchange} fixedCurrency="CNY" compact />
        : ranked.length > 0 ? <section className="card benchmark-ranking" aria-label="模型排名">
          <table>
            <thead><tr><th scope="col">名次</th><th scope="col">型号与配置</th><th scope="col" aria-sort="descending">{scoreLabel}</th>
              <th scope="col" title="每百万输入加每百万输出 Token 的标准单价">标准价 · ¥</th><th scope="col">对比</th></tr></thead>
            <tbody>{ranked.map(({ model, rank, score }) => {
              const { entry, profile } = model;
              const included = selected.includes(entry.id);
              const cost = entry.verifiedAt ? plotPrice(entry, "total", "CNY", exchange) : null;
              return <tr key={entry.id} data-profile-id={entry.id} data-score={score}>
                <td className="benchmark-rank">{rank}</td>
                <th scope="row"><button className="benchmark-profile" onClick={() => setDetailId(entry.id)}>
                  <ModelLogo name={entry.name} size={25} /><span><strong>{model.model.name}</strong>
                    <small>{entry.vendor} · {profile.setting}</small></span>
                </button></th>
                <td className="benchmark-score"><strong>{score.toFixed(1)}</strong>
                  <span aria-hidden="true"><i style={{ width: `${score}%` }} /></span>
                </td>
                <td className="benchmark-price">{cost === null ? "—" : priceText(cost, "CNY")}</td>
                <td><Button size="sm" variant={included ? "primary" : "default"} disabled={!included && selected.length >= compareLimit}
                  aria-label={`${included ? "移除对比" : "加入对比"} ${entry.name}`}
                  onClick={() => toggleCompare(entry.id)}>{included ? "已选" : "加入"}</Button></td>
              </tr>;
            })}</tbody>
          </table>
        </section> : <EmptyState icon={<IconSearch size={24} />} title="当前筛选暂无可比较的评测"
          desc={scope.endsWith("30") && source?.edition && !source.edition.publishedAt ? "当前版本仅公布更新月份，近 30 天筛选需要具体发布日期。" : undefined}
          action={
          scope !== "all" ? <Button size="sm" onClick={() => setScope("all")}>查看全部有效测评</Button> : undefined
        } />}
    </> : <ModelComparison models={all} selected={comparisons} onSelect={toggleCompare} onRemove={toggleCompare} />}
    {detail && <ModelDetail model={detail} onClose={() => setDetailId(null)}
      canCompare={selected.includes(detail.entry.id) || selected.length < compareLimit}
      onCompare={() => {
        if (!selected.includes(detail.entry.id)) toggleCompare(detail.entry.id);
        setTab("ability");
        setDetailId(null);
      }} />}
    {method && <Methodology board={board} registry={registry} exchange={exchange} onClose={() => setMethod(false)} />}
  </div>;
}

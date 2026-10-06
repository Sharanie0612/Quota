import { useState } from "react";
import type { LadderEntry } from "../lib/types";
import { priceText } from "../lib/format";
import { comparisonPrice, ladderScale, plotBounds, plotPrice, validExchange, type LadderExchange, type LadderMetric } from "../lib/ladderPlot";
import { ModelLogo, modelBrand } from "./ModelLogo";
import "./ladder-chart.css";
export { comparisonPrice } from "../lib/ladderPlot";
export type LadderLayout = "split" | "combined";
export const currencyTitle = (currency: string) => currency === "CNY" ? "人民币" : currency === "USD" ? "美元" : currency;
export const ladderCurrencyGroups = (entries: LadderEntry[]) => [...new Set(entries.map(entry => entry.price.currency))].sort().map(currency => ({ currency, entries: entries.filter(entry => entry.price.currency === currency) }));
export const reasoningLabel = (entry: LadderEntry) => {
  const named = entry.name.match(/[（(]([^）)]+)[）)]/)?.[1] ?? "";
  const effort = /^(non-reasoning|xhigh|high|medium|low|max|minimal|reasoning)(?:\b|,)/i.exec(named)?.[1] ?? /(?:^|-)(non-reasoning|xhigh|high|medium|low|max|minimal|reasoning)(?:-|$)/i.exec(entry.id)?.[1];
  return effort ? effort.toLowerCase().replace(/^./, char => char.toUpperCase()) : "未标注";
};

type Props = { entries: LadderEntry[]; domain: string; focused: LadderEntry | null; onFocus: (entry: LadderEntry) => void; layout?: LadderLayout; exchange?: LadderExchange | null };
function Canvas({ entries, domain, focused, onFocus, exchange, metric, currency, highlightBrand }: Props & { metric: LadderMetric; currency: string; highlightBrand: string }) {
  const [hover, setHover] = useState<LadderEntry | null>(null);
  const points = entries.map(entry => ({ entry, cost: plotPrice(entry, metric, currency, exchange)!, score: entry.rankings[domain].score }));
  const scale = ladderScale(points);
  const active = entries.find(entry => entry.id === (hover?.id ?? focused?.id));
  const groups = new Map<string, typeof points>();
  for (const point of points) {
    const key = `${point.cost}:${point.score}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  const clusters = [...groups.values()].map(group => group.sort((a, b) => a.entry.id.localeCompare(b.entry.id)));
  const priority = (group: typeof points) => group.some(point => point.entry.id === active?.id) ? 2 : group.some(point => modelBrand(point.entry.name) === highlightBrand) ? 1 : 0;
  clusters.sort((a, b) => priority(a) - priority(b));
  const neighbours = active ? points.filter(point => Math.hypot(scale.x(point.cost) - scale.x(plotPrice(active, metric, currency, exchange)!), scale.y(point.score) - scale.y(active.rankings[domain].score)) <= 26) : [];
  return <div className="scatter-panel"><svg viewBox="0 0 880 405" role="group" aria-label={`${currency}统一价格与性能坐标图`}>
    <text x="62" y="18" className="scatter-axis-title">能力更强 ↑</text>
    {Array.from({ length: Math.floor((100 - scale.min) / 10) + 1 }, (_, index) => scale.min + index * 10).map(value => <g key={value}>
      <line x1={plotBounds.left} x2={plotBounds.right} y1={scale.y(value)} y2={scale.y(value)} className="scatter-grid" />
      <text x="49" y={scale.y(value) + 4} textAnchor="end" className="scatter-tick">{value}</text>
    </g>)}
    {scale.ticks.map(value => <g key={value}>
      <line x1={scale.x(value)} x2={scale.x(value)} y1={plotBounds.top} y2={plotBounds.bottom} className="scatter-grid" />
      <text x={scale.x(value)} y="362" textAnchor="middle" className="scatter-tick">{Number(value.toPrecision(6))}</text>
    </g>)}
    <text x="452" y="392" textAnchor="middle" className="scatter-axis-title">标准未命中成本（{currency} / {metric === "total" ? "百万输入 + 百万输出 Token" : "百万 Token"}）→</text>
    {clusters.map(group => {
      const chosen = group.find(point => point.entry.id === active?.id) ?? group.find(point => modelBrand(point.entry.name) === highlightBrand) ?? group[0];
      const { entry, cost, score } = chosen;
      const x = scale.x(cost), y = scale.y(score);
      const selected = group.some(point => point.entry.id === focused?.id);
      return <g key={`${cost}:${score}`} className="scatter-point" style={{ opacity: !highlightBrand || group.some(point => modelBrand(point.entry.name) === highlightBrand) ? 1 : .15 }} role="button" tabIndex={0}
        data-cost={cost} data-score={score} data-plot-x={x} data-plot-y={y}
        aria-label={`${entry.name}，推理强度 ${reasoningLabel(entry)}，能力 ${score}，成本 ${priceText(cost, currency)}${group.length > 1 ? `，同坐标 ${group.length} 个型号` : ""}`}
        aria-pressed={selected} onMouseEnter={() => setHover(entry)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(entry)} onBlur={() => setHover(null)} onClick={() => onFocus(entry)}
        onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); onFocus(entry); } }}>
        <title>{`${entry.vendor} · ${entry.name} · ${reasoningLabel(entry)} · ${priceText(cost, currency)}${group.length > 1 ? ` · 同坐标 ${group.length} 个型号，点击查看` : ""}`}</title>
        <circle cx={x} cy={y} r="11" className="scatter-logo-background" />
        {group.some(point => point.entry.id === active?.id) && <circle cx={x} cy={y} r="14" className="scatter-selection-ring" />}
        <foreignObject x={x - 9} y={y - 9} width="18" height="18" className="scatter-logo"><ModelLogo name={entry.name} size={18} /></foreignObject>
        {group.length > 1 && <g className="scatter-cluster-count"><rect x={x + 5} y={y + 4} width="18" height="16" rx="6" /><text x={x + 14} y={y + 16} textAnchor="middle">{group.length}</text></g>}
      </g>;
    })}
  </svg>
    <div className="scatter-inspector" aria-live="polite">{active ? <>
      <div className="scatter-detail"><ModelLogo name={active.name} size={22} /><b>{active.name}</b><span>{active.vendor} · {reasoningLabel(active)} · 能力 {active.rankings[domain].score.toFixed(1)} 分</span></div>
      <div className="scatter-prices"><span>标准成本 {priceText(comparisonPrice(active, metric), active.price.currency)}</span><span>图中 {priceText(plotPrice(active, metric, currency, exchange), currency)}</span><span>{metric === "total" ? "每百万输入 + 百万输出 Token" : "每百万 Token"}</span></div>
    </> : <span className="hint">越靠左上越有优势。Logo 中心对应真实价格与能力分；点击固定型号，重叠时从下方列表选择。</span>}</div>
    {active && neighbours.length > 1 && <div className="scatter-neighbours"><span className="hint">此位置附近 {neighbours.length} 个型号</span><div>{neighbours.map(({ entry, cost }) => <button key={entry.id} type="button" aria-pressed={focused?.id === entry.id} onClick={() => onFocus(entry)}><ModelLogo name={entry.name} size={18} /><span>{entry.name}</span><b>{priceText(cost, currency)}</b></button>)}</div></div>}
  </div>;
}
export function LadderChart({ layout = "combined", ...props }: Props) {
  const [metric, setMetric] = useState<LadderMetric>("total"), [effort, setEffort] = useState("all"), [ability, setAbility] = useState(false), [highlightBrand, setHighlightBrand] = useState("");
  const ranked = props.entries.filter(entry => Number.isFinite(entry.rankings[props.domain]?.score) && entry.rankings[props.domain].score >= 0 && entry.rankings[props.domain].score <= 100);
  const priced = ranked.filter(entry => comparisonPrice(entry, metric) != null && entry.verifiedAt && entry.price.currency.trim());
  const effectiveEffort = ranked.some(entry => reasoningLabel(entry) === effort) ? effort : "all";
  const selected = priced.filter(entry => effectiveEffort === "all" || reasoningLabel(entry) === effectiveEffort);
  const split = layout === "split" || !validExchange(props.exchange);
  const groups = split ? ladderCurrencyGroups(selected) : [{ currency: "CNY", entries: selected.filter(entry => plotPrice(entry, metric, "CNY", props.exchange) != null) }];
  const omitted = props.entries.filter(entry => !groups.some(group => group.entries.some(value => value.id === entry.id)));
  return <section className="ladder-chart-block"><div className="chart-heading"><div><h3>{ability ? "全部型号能力" : "价格 × 性能"}</h3><p className="hint">独立评测型号包含推理强度；未标注时不推算。</p></div><div className="ladder-filters">
    {!ability && <select className="select" aria-label="比较价格类型" value={metric} onChange={event => setMetric(event.target.value as LadderMetric)}><option value="total">输入 + 输出成本</option><option value="input">输入价格</option><option value="output">输出价格</option></select>}
    <select className="select" aria-label="推理强度" value={effectiveEffort} onChange={event => setEffort(event.target.value)}><option value="all">全部推理强度</option>{[...new Set(ranked.map(reasoningLabel))].sort().map(value => <option key={value}>{value}</option>)}</select>
    <button className="btn" onClick={() => setAbility(value => !value)}>{ability ? "查看价格 × 性能" : "全部型号能力图"}</button>
  </div></div>
    {ability ? <div className="card scatter-chart"><p className="hint">所有有当前分类评测的型号，含暂无标准价型号；每个推理版本独立展示。</p><div className="ability-models">{ranked.filter(entry => effectiveEffort === "all" || reasoningLabel(entry) === effectiveEffort).sort((a, b) => b.rankings[props.domain].score - a.rankings[props.domain].score).map(entry => <button key={entry.id} className="ability-row" onClick={() => props.onFocus(entry)}><ModelLogo name={entry.name} /><span>{entry.name} · {reasoningLabel(entry)}</span><progress max={100} value={entry.rankings[props.domain].score} /><b>{entry.rankings[props.domain].score.toFixed(1)}</b></button>)}</div></div> : <>
      {layout === "combined" && <p className="hint" role="status">{validExchange(props.exchange) ? `统一人民币 · 1 USD = ${props.exchange.cnyPerUsd.toFixed(4)} CNY · ECB 参考日 ${props.exchange.date}${props.exchange.error ? ` · ${props.exchange.error}` : " · 每日同步"}` : "汇率暂不可用，已按原币种分图展示，美元型号不会被隐藏。"}</p>}
      <div className={split ? "scatter-cards" : ""}>{groups.map(group => <div className="card scatter-chart" key={group.currency}>{split && <h3>{currencyTitle(group.currency)}</h3>}{group.entries.length ? <Canvas {...props} entries={group.entries} currency={group.currency} metric={metric} highlightBrand={highlightBrand} /> : <p className="hint">暂无同时具备评测分与已核实价格的型号。</p>}</div>)}</div>
      <div className="scatter-footer"><p className="hint">{groups.reduce((count, group) => count + group.entries.length, 0)} 个型号 · 模型 Logo 标识 · 点击图例突出模型系列 · 标记不偏移，同坐标显示数量 · 价格轴对数压缩，刻度非等距 · 汇率仅供比较，保留原币种，不修改官方价格。</p><div className="scatter-legend">{[...new Set(groups.flatMap(group => group.entries.map(entry => modelBrand(entry.name))))].sort().map(brand => <button type="button" key={brand} aria-pressed={highlightBrand === brand} onClick={() => setHighlightBrand(current => current === brand ? "" : brand)}><ModelLogo name={brand} size={20} />{brand}</button>)}</div></div>
      <details className="card scatter-chart"><summary>未进入价格图的型号（{omitted.length}）</summary><div className="scatter-models">{omitted.map(entry => <button key={entry.id} onClick={() => props.onFocus(entry)}>{entry.name} · {reasoningLabel(entry)} · {!entry.rankings[props.domain] ? "当前分类暂无评测" : !entry.verifiedAt || comparisonPrice(entry, metric) == null ? "暂无可比较的标准 Token 价格" : effectiveEffort !== "all" && reasoningLabel(entry) !== effectiveEffort ? "推理强度筛选已排除" : "等待可用汇率"}</button>)}</div></details>
    </>}
  </section>;
}

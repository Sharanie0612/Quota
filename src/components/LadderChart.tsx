import { useEffect,useState } from "react";
import {createPortal} from 'react-dom';
import {useChartSize} from '../lib/useChartSize';
import type { LadderEntry } from "../lib/types";
import { priceText } from "../lib/format";
import { comparisonPrice, ladderScale, plotPrice, validExchange, type LadderExchange, type LadderMetric } from "../lib/ladderPlot";
import { ModelLogo, modelBrand } from "./ModelLogo";
import "./ladder-chart.css";
export { comparisonPrice } from "../lib/ladderPlot";
export const currencyTitle = (currency: string) => currency === "CNY" ? "人民币" : currency === "USD" ? "美元" : currency;
import { reasoningLabel } from "../lib/ladderModels";
export { reasoningLabel } from "../lib/ladderModels";

type Props = { entries: LadderEntry[]; domain: string; focused: LadderEntry | null; onFocus: (entry: LadderEntry) => void; exchange?: LadderExchange | null; onShowList?:()=>void;fixedCurrency?:"CNY";compact?:boolean };
function Canvas({ entries, domain, focused, onFocus, exchange, metric, currency, highlightBrand,compact }: Props & { metric: LadderMetric; currency: string; highlightBrand: string }) {
  const [hover, setHover] = useState<LadderEntry | null>(null);
  const chart=useChartSize();const plotBounds={left:62,right:chart.width-38,top:44,bottom:chart.height-80};
  const points = entries.map(entry => ({ entry, cost: plotPrice(entry, metric, currency, exchange)!, score: entry.rankings[domain].score }));
  const scale = ladderScale(points,plotBounds);
  const active = entries.find(entry => entry.id === (hover?.id ?? focused?.id));
  const tooltip=points.find(point=>point.entry.id===hover?.id);
  const groups = new Map<string, typeof points>();
  for (const point of points) {
    const key = `${point.cost}:${point.score}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  const clusters = [...groups.values()].map(group => group.sort((a, b) => a.entry.id.localeCompare(b.entry.id)));
  const priority = (group: typeof points) => group.some(point => point.entry.id === active?.id) ? 2 : group.some(point => modelBrand(point.entry.name) === highlightBrand) ? 1 : 0;
  clusters.sort((a, b) => priority(a) - priority(b));
  const neighbours = active ? points.filter(point => Math.hypot(scale.x(point.cost) - scale.x(plotPrice(active, metric, currency, exchange)!), scale.y(point.score) - scale.y(active.rankings[domain].score)) <= 26) : [];
  return <div className="scatter-panel"><svg ref={chart.ref} viewBox={`0 0 ${chart.width} ${chart.height}`} data-plot-width={chart.width} data-plot-height={chart.height} role="group" aria-label={`${currency}统一价格与性能坐标图`}>
    <text x="62" y="18" className="scatter-axis-title">能力更强 ↑</text>
    {scale.scoreTicks.map(value => <g key={value}>
      <line x1={plotBounds.left} x2={plotBounds.right} y1={scale.y(value)} y2={scale.y(value)} className="scatter-grid" />
      <text x="49" y={scale.y(value) + 4} textAnchor="end" className="scatter-tick">{value}</text>
    </g>)}
    {scale.ticks.map(value => <g key={value}>
      <line x1={scale.x(value)} x2={scale.x(value)} y1={plotBounds.top} y2={plotBounds.bottom} className="scatter-grid" />
      <text x={scale.x(value)} y={plotBounds.bottom+30} textAnchor="middle" className="scatter-tick">{Number(value.toPrecision(3))}</text>
    </g>)}
    <text x={chart.width/2} y={plotBounds.bottom+65} textAnchor="middle" className="scatter-axis-title">{metric==="cached"?"缓存命中价格":metric==="output"?"输出价格":"未命中成本"}（{currency} / {metric === "total" ? "百万输入 + 百万输出 Token" : "百万 Token"}）→</text>
    {clusters.map(group => {
      const chosen = group.find(point => point.entry.id === active?.id) ?? group.find(point => modelBrand(point.entry.name) === highlightBrand) ?? group[0];
      const { entry, cost, score } = chosen;
      const x = scale.x(cost), y = scale.y(score);
      const selected = group.some(point => point.entry.id === focused?.id);
      return <g key={`${cost}:${score}`} className="scatter-point" style={{ opacity: !highlightBrand || group.some(point => modelBrand(point.entry.name) === highlightBrand) ? 1 : .15 }} role="button" tabIndex={0}
        data-cost={cost} data-score={score} data-plot-x={x} data-plot-y={y} data-profile-ids={group.map(p=>p.entry.id).join('|')}
        aria-label={`${entry.name}，推理强度 ${reasoningLabel(entry)}，能力 ${score}，成本 ${priceText(cost, currency)}${group.length > 1 ? `，同坐标 ${group.length} 个型号` : ""}`}
        aria-pressed={selected} onMouseEnter={() => setHover(entry)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(entry)} onBlur={() => setHover(null)} onClick={() => onFocus(entry)}
        onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); onFocus(entry); } }}>
        <title>{`${entry.vendor} · ${entry.name} · ${reasoningLabel(entry)} · ${priceText(cost, currency)}${group.length > 1 ? ` · 同坐标 ${group.length} 个型号，点击查看` : ""}`}</title>
        <circle cx={x} cy={y} r="12" className="scatter-logo-background" />
        {group.some(point => point.entry.id === active?.id) && <circle cx={x} cy={y} r="12" className="scatter-selection-ring" />}
        <foreignObject x={x - 11} y={y - 11} width="22" height="22" className="scatter-logo"><ModelLogo name={entry.name} size={22} /></foreignObject>
        {group.length > 1 && <g className="scatter-cluster-count"><rect x={x + 5} y={y + 4} width="18" height="16" rx="6" /><text x={x + 14} y={y + 16} textAnchor="middle">{group.length}</text></g>}
      </g>;
    })}

  </svg>
    {tooltip&&<div role="tooltip" className="scatter-tooltip" style={{left:Math.min(chart.width-290,Math.max(8,scale.x(tooltip.cost)-120)),top:Math.max(12,scale.y(tooltip.score)-110)}}><b><ModelLogo name={tooltip.entry.name} size={21}/>{tooltip.entry.name}</b><span>{tooltip.entry.vendor} · {reasoningLabel(tooltip.entry)}</span><div><strong>{tooltip.score.toFixed(1)} 分</strong><span>{priceText(tooltip.cost,currency)}</span></div></div>}
    {!compact&&<div className="scatter-inspector" aria-live="polite">{active ? <>
      <div className="scatter-detail"><ModelLogo name={active.name} size={22} /><b>{active.name}</b><span>{active.vendor} · {reasoningLabel(active)} · 能力 {active.rankings[domain].score.toFixed(1)} 分</span></div>
      <div className="scatter-prices"><span>所选价格 {priceText(comparisonPrice(active, metric), active.price.currency)}</span><span>图中 {priceText(plotPrice(active, metric, currency, exchange), currency)}</span><span>{metric === "total" ? "每百万输入 + 百万输出 Token" : "每百万 Token"}</span></div>
    </> : <span>选择模型查看详情</span>}</div>}
    {active && neighbours.length > 1 && <div className="scatter-neighbours"><span className="hint">此位置附近 {neighbours.length} 个型号</span><div>{neighbours.map(({ entry, cost }) => <button key={entry.id} type="button" aria-pressed={focused?.id === entry.id} onClick={() => onFocus(entry)}><ModelLogo name={entry.name} size={18} /><span>{entry.name}</span><b>{priceText(cost, currency)}</b></button>)}</div></div>}
  </div>;
}
export function LadderChart(props: Props) {
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{if(!expanded)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setExpanded(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[expanded]);
  const Unpriced=props.compact?'details':'section';
  const [chartCurrency,setChartCurrency]=useState("CNY");
  const [metric, setMetric] = useState<LadderMetric>("total"), [effort, setEffort] = useState("all"), [highlightBrand, setHighlightBrand] = useState("");
  const ranked = props.entries.filter(entry => Number.isFinite(entry.rankings[props.domain]?.score) && entry.rankings[props.domain].score >= 0 && entry.rankings[props.domain].score <= 100);
  const priced = ranked.filter(entry => comparisonPrice(entry, metric) != null && entry.verifiedAt && entry.price.currency.trim());
  const effectiveEffort = ranked.some(entry => reasoningLabel(entry) === effort) ? effort : "all";
  const selected = priced.filter(entry => effectiveEffort === "all" || reasoningLabel(entry) === effectiveEffort);
  const effectiveCurrency=props.fixedCurrency??(selected.some(e=>plotPrice(e,metric,chartCurrency,props.exchange)!=null)?chartCurrency:selected.find(e=>["CNY","USD"].includes(e.price.currency))?.price.currency??chartCurrency);
  const currencies=props.fixedCurrency||validExchange(props.exchange)?[effectiveCurrency]:[...new Set([effectiveCurrency,...selected.map(e=>e.price.currency)])];
  const groups = currencies.map(currency=>({currency,entries:selected.filter(entry=>plotPrice(entry,metric,currency,props.exchange)!=null)})).filter(group=>group.entries.length||currencies.length===1);
  const omitted = ranked.filter(entry => (effectiveEffort === "all" || reasoningLabel(entry) === effectiveEffort) && !groups.some(group => group.entries.some(value => value.id === entry.id)));
  const content=<section className={`ladder-chart-block${expanded?' chart-expanded':''}`} role={expanded?'dialog':undefined} aria-modal={expanded?true:undefined} aria-label={expanded?'放大的模型天梯':undefined}><div className="chart-heading"><div><h3>价格 × 能力</h3></div><button className="btn btn-sm" onClick={()=>setExpanded(value=>!value)}>{expanded?'退出放大':'展开图表'}</button><details><summary>比较选项</summary><div className="ladder-filters">
    {<select className="select" aria-label="比较价格类型" value={metric} onChange={event => setMetric(event.target.value as LadderMetric)}><option value="total">输入 + 输出成本</option><option value="input">输入价格</option><option value="output">输出价格</option><option value="cached">缓存命中价格</option></select>}
    <select className="select" aria-label="推理强度" value={effectiveEffort} onChange={event => setEffort(event.target.value)}><option value="all">全部推理强度</option>{[...new Set(ranked.map(reasoningLabel))].sort().map(value => <option key={value}>{value}</option>)}</select>
    {!props.fixedCurrency&&<select className="select" aria-label="图表币种" value={effectiveCurrency} onChange={event=>setChartCurrency(event.target.value)}><option value="CNY">人民币</option><option value="USD">美元</option></select>}

  </div></details></div>
    {<>
      {!props.compact&&<p className="hint" role="status">{validExchange(props.exchange) ? `1 USD = ${props.exchange.cnyPerUsd.toFixed(4)} CNY · ECB ${props.exchange.date}${props.exchange.error ? ` · ${props.exchange.error}` : ""}` : "汇率暂不可用，按原币种分别绘图。"}</p>}
      <div>{groups.map(group => <div className="card scatter-chart" key={group.currency}>{group.entries.length ? <Canvas {...props} entries={group.entries} currency={group.currency} metric={metric} highlightBrand={highlightBrand} /> : <div className="section"><h3>{ranked.length?"这个分类暂不支持价格对比":"这个分类暂无已收录评测"}</h3><p className="hint">图表需要同一计费单位、已核实价格与评测分。仍可在列表查看现有模型与来源。</p>{props.onShowList&&<button className="btn" onClick={props.onShowList}>查看模型列表</button>}</div>}</div>)}</div>
      <div className="scatter-footer">{!props.compact&&<p className="hint">区间自动适配当前模型 · 价格轴使用对数刻度 · 汇率仅供比较</p>}<div className="scatter-legend">{[...new Set(groups.flatMap(group => group.entries.map(entry => modelBrand(entry.name))))].sort().map(brand => <button type="button" key={brand} aria-pressed={highlightBrand === brand} onClick={() => setHighlightBrand(current => current === brand ? "" : brand)}><ModelLogo name={brand} size={20} />{brand}</button>)}</div></div>
      {!!omitted.length&&<Unpriced className="card ladder-unpriced">{props.compact&&<summary>{omitted.length} 款暂无可比人民币价格</summary>}<div className="chart-heading"><h3>能力排名 · 价格待确认</h3><span className="hint">{omitted.length} 个评测档位</span></div><p className="hint">保留当前分类的全部评分；暂无可比价格的型号不设虚假价格坐标。</p><div className="ladder-score-list">{[...omitted].sort((a,b)=>b.rankings[props.domain].score-a.rankings[props.domain].score).map(entry=><button key={entry.id} data-profile-id={entry.id} data-score={entry.rankings[props.domain].score} onClick={()=>props.onFocus(entry)} className="ladder-score-row" title={entry.candidate?.error??"官方未提供可比较的 Token 价格"}><ModelLogo name={entry.name} size={20}/><span>{entry.name}<small>{reasoningLabel(entry)}</small></span><span className="ladder-score-track"><i style={{width:`${entry.rankings[props.domain].score}%`}}/></span><b>{entry.rankings[props.domain].score.toFixed(1)}</b></button>)}</div></Unpriced>}
    </>}
  </section>;
  return expanded?createPortal(content,document.body):content;
}

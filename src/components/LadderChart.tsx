import { useEffect,useState } from "react";
import {createPortal} from 'react-dom';
import {LadderCanvas as Canvas} from './LadderCanvas';
import type { LadderEntry } from "../lib/types";
import { comparisonPrice, plotPrice, validExchange, type LadderExchange, type LadderMetric } from "../lib/ladderPlot";
import { ModelLogo, modelBrand } from "./ModelLogo";
import "./ladder-chart.css";
export { comparisonPrice } from "../lib/ladderPlot";
export const currencyTitle = (currency: string) => currency === "CNY" ? "人民币" : currency === "USD" ? "美元" : currency;
import { reasoningLabel } from "../lib/ladderModels";
export { reasoningLabel } from "../lib/ladderModels";

type Props = { entries: LadderEntry[]; domain: string; focused: LadderEntry | null; onFocus: (entry: LadderEntry) => void; exchange?: LadderExchange | null; onShowList?:()=>void;fixedCurrency?:"CNY";compact?:boolean };
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

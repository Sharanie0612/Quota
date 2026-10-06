import { useState } from "react";
import type { LadderEntry } from "../lib/types";
import "./ladder-chart.css";
export type LadderLayout = "split" | "combined";
export const currencyTitle = (c: string) => c === "CNY" ? "人民币" : c === "USD" ? "美元" : c;
export const ladderCurrencyGroups = (entries: LadderEntry[]) => [...new Set(entries.map(e => e.price.currency))].sort().map(currency => ({ currency, entries: entries.filter(e => e.price.currency === currency) }));
export const reasoningLabel = (e: LadderEntry) => {
 const named=e.name.match(/[（(]([^）)]+)[）)]/)?.[1] ?? "";
 const effort=/^(non-reasoning|xhigh|high|medium|low|max|minimal|reasoning)(?:\b|,)/i.exec(named)?.[1] ?? /(?:^|-)(non-reasoning|xhigh|high|medium|low|max|minimal|reasoning)(?:-|$)/i.exec(e.id)?.[1];
 return effort ? effort.toLowerCase().replace(/^./,c=>c.toUpperCase()) : "未标注";
};
type Metric = "total" | "input" | "output";
export const comparisonPrice = (e: LadderEntry, metric: Metric) => metric === "input" ? e.price.input : metric === "output" ? e.price.output : e.price.input != null && e.price.output != null ? e.price.input + e.price.output : null;
const vendors = ["OpenAI", "Anthropic", "Google", "DeepSeek", "Kimi", "Z AI", "Xiaomi", "Alibaba", "SpaceXAI", "Meta"];
export const ladderVendorColor = (vendor: string) => `var(--model-${Math.max(0,vendors.indexOf(vendor))+1})`;
function VendorMarker({ vendor, x = 10, y = 10, active = false }: { vendor: string; x?: number; y?: number; active?: boolean }) {
 const index = Math.max(0, vendors.indexOf(vendor));
 return <circle cx={x} cy={y} r={active ? 8.5 : 6.5} fill={`var(--model-${index + 1})`} stroke={`var(--model-${index + 1}-border)`} className="scatter-dot" data-vendor={vendor} />;
}
type Props = { entries: LadderEntry[]; domain: string; focused: LadderEntry | null; onFocus: (e: LadderEntry) => void; layout?: LadderLayout; exchange?: { cnyPerUsd: number; date: string; error: string | null } | null };
function Canvas({ entries, domain, focused, onFocus, exchange, metric, currency, highlightVendor }: Props & { metric: Metric; currency: string; highlightVendor: string }) {
 const [hover, setHover] = useState<LadderEntry | null>(null);
 const cost = (e: LadderEntry) => comparisonPrice(e, metric)! * (currency === "CNY" && e.price.currency === "USD" ? exchange!.cnyPerUsd : 1);
 const max = Math.max(1, ...entries.map(cost)), min = Math.max(0, Math.floor(Math.min(100, ...entries.map(e => e.rankings[domain].score)) / 10) * 10 - 10);
 const x = (v: number) => 62 + Math.log1p(v) / Math.log1p(max) * 780;
 const y = (v: number) => 344 - (v - min) / (100 - min) * 310;
 const active = entries.find(e => e.id === (hover?.id ?? focused?.id));
 const positions = new Map<string, {x:number;y:number}>();
 const clusters = new Map<string, LadderEntry[]>();
 for (const e of entries) { const key = `${Math.round(x(cost(e)) / 12)}:${Math.round(y(e.rankings[domain].score) / 12)}`; clusters.set(key, [...(clusters.get(key) ?? []), e]); }
 for (const group of clusters.values()) group.sort((a,b)=>a.id.localeCompare(b.id)).forEach((e,i)=>{
   const angle = i * Math.PI * 2 / group.length;
   const radius=Math.min(60,Math.max(18,group.length*3));
   positions.set(e.id, group.length>1 ? {x:Math.min(842-radius,Math.max(62+radius,x(cost(e))))+Math.cos(angle)*radius,y:Math.min(344-radius,Math.max(34+radius,y(e.rankings[domain].score)))+Math.sin(angle)*radius} : {x:x(cost(e)),y:y(e.rankings[domain].score)});
 });
 const ticks = [0,.1,.5,1,2,5,10,20,50,100,200,500,1000].filter(v => v <= max).reduce<number[]>((a,v) => !a.length || x(v)-x(a[a.length-1]) > 45 ? [...a,v] : a,[]);
 return <div className="scatter-panel"><svg viewBox="0 0 880 405" role="group" aria-label={`${currency}统一价格与性能坐标图`}>
 <text x="62" y="18" className="scatter-axis-title">能力更强 ↑</text>
 {Array.from({length:Math.floor((100-min)/10)+1},(_,i)=>min+i*10).map(v=><g key={v}><line x1="62" x2="842" y1={y(v)} y2={y(v)} className="scatter-grid"/><text x="49" y={y(v)+4} textAnchor="end" className="scatter-tick">{v}</text></g>)}
 {ticks.map(v=><g key={v}><line x1={x(v)} x2={x(v)} y1="34" y2="344" className="scatter-grid"/><text x={x(v)} y="366" textAnchor="middle" className="scatter-tick">{v}</text></g>)}
 <text x="452" y="397" textAnchor="middle" className="scatter-axis-title">成本（{currency} / {metric === "total" ? "百万输入 + 百万输出 Token" : "百万 Token"}）→</text>
 {entries.map(e=><g key={e.id} className="scatter-point" style={{opacity:!highlightVendor || highlightVendor === e.vendor ? 1 : .15}} role="button" tabIndex={0} aria-label={`${e.name}，推理强度 ${reasoningLabel(e)}，能力 ${e.rankings[domain].score}，原价 ${comparisonPrice(e,metric)} ${e.price.currency}`} aria-pressed={focused?.id===e.id} onMouseEnter={()=>setHover(e)} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover(e)} onBlur={()=>setHover(null)} onClick={()=>onFocus(e)} onKeyDown={event=>{if(["Enter"," "].includes(event.key)){event.preventDefault();onFocus(e);}}}>
 <title>{`${e.vendor} · ${e.name} · ${reasoningLabel(e)} · ${cost(e).toFixed(2)} ${currency}`}</title><line x1={x(cost(e))} y1={y(e.rankings[domain].score)} x2={positions.get(e.id)!.x} y2={positions.get(e.id)!.y} className="scatter-grid"/><circle cx={positions.get(e.id)!.x} cy={positions.get(e.id)!.y} r="10" fill="transparent"/>{active?.id===e.id && <circle cx={positions.get(e.id)!.x} cy={positions.get(e.id)!.y} r="13" className="scatter-selection-ring"/>}<VendorMarker vendor={e.vendor} x={positions.get(e.id)!.x} y={positions.get(e.id)!.y} active={active?.id===e.id}/>
 {active?.id===e.id && <text x={x(cost(e)) > 620 ? x(cost(e))-12 : x(cost(e))+12} y={y(e.rankings[domain].score)-12} textAnchor={x(cost(e))>620?"end":"start"} className="scatter-count">{e.name}</text>}
 </g>)}
 </svg><div className="scatter-inspector" aria-live="polite">{active?<><b>{active.name}</b><span>推理强度：{reasoningLabel(active)} · 能力 {active.rankings[domain].score.toFixed(1)} 分</span><span>原价 {Number(comparisonPrice(active,metric)!.toPrecision(12))} {active.price.currency} · 图中 {cost(active).toFixed(2)} {currency}</span></>:<span className="hint">越靠左上越有优势。悬停看详情，点击固定型号；每个推理版本独立展示。</span>}</div></div>;
}
export function LadderChart({layout="combined",...props}:Props) {
 const [metric,setMetric]=useState<Metric>("total"), [effort,setEffort]=useState("all"), [ability,setAbility]=useState(false), [highlightVendor,setHighlightVendor]=useState("");
 const ranked=props.entries.filter(e=>Number.isFinite(e.rankings[props.domain]?.score)&&e.rankings[props.domain].score>=0&&e.rankings[props.domain].score<=100);
 const priced=props.entries.filter(e=>e.rankings[props.domain] && Number.isFinite(e.rankings[props.domain].score) && e.rankings[props.domain].score>=0 && e.rankings[props.domain].score<=100 && comparisonPrice(e,metric)!=null && Number.isFinite(comparisonPrice(e,metric)) && comparisonPrice(e,metric)!>=0 && e.verifiedAt);
 const effectiveEffort=ranked.some(e=>reasoningLabel(e)===effort)?effort:"all";
 const selected=priced.filter(e=>effectiveEffort==="all"||reasoningLabel(e)===effectiveEffort);
 const split=layout==="split"||!props.exchange;
 const groups=split?ladderCurrencyGroups(selected):[{currency:"CNY",entries:selected.filter(e=>e.price.currency==="CNY"||e.price.currency==="USD")}];
 return <section className="ladder-chart-block"><div className="chart-heading"><div><h3>{ability?"全部型号能力":"价格 × 性能"}</h3><p className="hint">独立评测型号包含推理强度；未标注时不推算。</p></div><div className="ladder-filters">
 {!ability&&<select className="select" aria-label="比较价格类型" value={metric} onChange={e=>setMetric(e.target.value as Metric)}><option value="total">输入 + 输出成本</option><option value="input">输入价格</option><option value="output">输出价格</option></select>}
 <select className="select" aria-label="推理强度" value={effectiveEffort} onChange={e=>setEffort(e.target.value)}><option value="all">全部推理强度</option>{[...new Set(ranked.map(reasoningLabel))].sort().map(v=><option key={v}>{v}</option>)}</select><button className="btn" onClick={()=>setAbility(v=>!v)}>{ability?"查看价格 × 性能":"全部型号能力图"}</button></div></div>
 {ability ? <div className="card scatter-chart"><p className="hint">所有有当前分类评测的型号，含暂无标准价型号；每个推理版本独立展示。</p><div className="ability-models">{ranked.filter(e=>effectiveEffort==="all"||reasoningLabel(e)===effectiveEffort).sort((a,b)=>b.rankings[props.domain].score-a.rankings[props.domain].score).map(e=><button key={e.id} className="ability-row" onClick={()=>props.onFocus(e)}><span>{e.name} · {reasoningLabel(e)}</span><progress max={100} value={e.rankings[props.domain].score} style={{accentColor:`var(--model-${Math.max(0,vendors.indexOf(e.vendor))+1})`}}/><b>{e.rankings[props.domain].score.toFixed(1)}</b></button>)}</div></div> : <>
 {layout==="combined"&&<p className="hint" role="status">{props.exchange?`统一人民币 · 1 USD = ${props.exchange.cnyPerUsd.toFixed(4)} CNY · ECB 参考日 ${props.exchange.date}${props.exchange.error?` · ${props.exchange.error}`:" · 每日同步"}`:"汇率暂不可用，已按原币种分图展示，美元型号不会被隐藏。"}</p>}
 <div className={split?"scatter-cards":""}>{groups.map(group=><div className="card scatter-chart" key={group.currency}>{split&&<h3>{currencyTitle(group.currency)}</h3>}{group.entries.length?<Canvas {...props} entries={group.entries} currency={group.currency} metric={metric} highlightVendor={highlightVendor}/>:<p className="hint">暂无同时具备评测分与已核实价格的型号。</p>}</div>)}</div>
 <div className="scatter-footer"><p className="hint">{groups.reduce((n,g)=>n+g.entries.length,0)} 个型号 · 圆点颜色区分厂商 · 点击图例突出厂商 · 相邻圆点展开，细线指向真实坐标 · 对数价格轴 · 汇率仅供比较，保留原币种，不修改官方价格。</p><div className="scatter-legend">{vendors.filter(v=>groups.some(g=>g.entries.some(e=>e.vendor===v))).map(v=><button type="button" key={v} aria-pressed={highlightVendor===v} onClick={()=>setHighlightVendor(current=>current===v?"":v)}><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><VendorMarker vendor={v}/></svg>{v}</button>)}</div></div>
 <details className="card scatter-chart"><summary>未进入价格图的型号（{props.entries.filter(e=>!groups.some(g=>g.entries.some(v=>v.id===e.id))).length}）</summary><div className="scatter-models">{props.entries.filter(e=>!groups.some(g=>g.entries.some(v=>v.id===e.id))).map(e=><button key={e.id} onClick={()=>props.onFocus(e)}>{e.name} · {reasoningLabel(e)} · {!e.rankings[props.domain]?"当前分类暂无评测":!e.verifiedAt||comparisonPrice(e,metric)==null?"暂无标准价":effectiveEffort!=="all"&&reasoningLabel(e)!==effectiveEffort?"推理强度筛选已排除":"等待可用汇率"}</button>)}</div></details></>}
 </section>;
}

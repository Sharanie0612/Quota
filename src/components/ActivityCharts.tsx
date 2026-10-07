import { useEffect, useMemo, useState } from "react";
import type { ActivityGroup } from "../lib/types";
import { metricValue, periodLabel, emptyTokens, smoothUsagePath, bucketUsage, heatLevel, parseDay, usageCalendar, periodRange, type ActivityMetric, type ActivityRange, type TimeScale } from "../lib/activityCharts";
import "./activity-charts.css";

const number = (n: number) => new Intl.NumberFormat("zh-CN").format(n);
const compact = (n: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const last = <T,>(items: T[]) => items[items.length - 1];
export function ActivityCharts({ rows, hourly, format, days, model, metric, setMetric, range, onRange }: { rows: ActivityGroup[]; hourly: ActivityGroup[]; format:(n:number)=>string; days: number; model: string; metric: ActivityMetric; setMetric: (value: ActivityMetric) => void; range: ActivityRange | null; onRange: (value: ActivityRange | null) => void }) {
  const metricLabel = {total:"总 Token",input:"输入 Token",output:"输出 Token",cached:"缓存命中",uncached:"未命中输入"}[metric];
  const [scale, setScale] = useState<TimeScale|"overview">(range&&range.from===range.to?"day":"overview");
  const [year, setYear] = useState(new Date().getFullYear());
  const [selected, setSelected] = useState("");
  const [period, setPeriod] = useState("");
  const [hover, setHover] = useState("");
  const years = [...new Set([new Date().getFullYear(), ...rows.filter(row => parseDay(row.key)).map(row => Number(row.key.slice(0, 4)))])].sort((a, b) => b - a);
  const calendar = useMemo(() => usageCalendar(rows, days, new Date(), days === 0 ? year : undefined), [rows, days, year]);
  const dailySeries = useMemo(() => bucketUsage(usageCalendar(rows, days), scale==="overview"?"day":scale), [rows, days, scale]);
  const hourDates=useMemo(()=>usageCalendar(rows,days),[rows,days]);
  useEffect(()=>{if(!range&&scale==="day")setScale("overview");},[range,scale]);
  const isHourly=scale==="day"&&!!range&&range.from===range.to;
  const series=isHourly?Array.from({length:24},(_,hour)=>{const key=`${range.from}T${String(hour).padStart(2,"0")}`;const row=hourly.find(r=>r.key===key);return {key,tokens:row?.tokens??emptyTokens(),recorded:!!row};}):dailySeries;
  const periodText=(key:string)=>isHourly?key.slice(11)+":00":periodLabel(key,scale==="overview"?"day":scale);
  const heatMax = Math.max(0, ...calendar.map(day => day.tokens.total));
  const chosen = calendar.find(day => day.key === (range?.from ?? selected)) ?? last(calendar.filter(day => day.recorded)) ?? last(calendar);
  const chosenPeriod = series.find(day => day.key === (hover || (range ? period : ""))) ?? last(series);
  const pin = (key: string) => { setPeriod(key);setHover(""); const all = usageCalendar(rows, days); if(!isHourly){const next=periodRange(key,scale==="overview"?"day":scale,all[0]?.key??key,last(all)?.key??key);if(scale==="overview")setScale("day");onRange(next);} };
  const pointAt = (clientX: number, element: SVGSVGElement) => { const rect=element.getBoundingClientRect(); const px=(clientX-rect.left)/rect.width*730; return series[Math.max(0,Math.min(series.length-1,Math.round((px-left)/(right-left)*(series.length-1))))]?.key ?? ""; };
  const max = Math.max(1, ...series.map(day => metricValue(day.tokens,metric)));
  const left = 56, right = 704, top = 18, bottom = 180;
  const x = (index: number) => series.length < 2 ? (left + right) / 2 : left + index / (series.length - 1) * (right - left);
  const y = (value: number) => bottom - value / max * (bottom - top);
  const path = smoothUsagePath(series.map((day,index)=>({x:x(index),y:y(metricValue(day.tokens,metric))})));
  const area = series.length ? `${path} L ${x(series.length-1)} ${bottom} L ${x(0)} ${bottom} Z` : "";
  const offset = calendar.length ? (parseDay(calendar[0].key)!.getDay() + 6) % 7 : 0;
  const activeDays = calendar.filter(day => day.tokens.total > 0).length;
  const vendorNames:Record<string,string>={custom:"OpenAI",deepseek:"DeepSeek",zhipu:"智谱 GLM",moonshot:"Kimi",mimo:"小米 MiMo",anthropic:"Anthropic",google:"Google",alibaba:"Alibaba",unknown:"其他"};
  const label = model.startsWith("vendor:") ? `${vendorNames[model.slice(7)] ?? "供应商"} · 全部模型` : model || "全部模型";
  return <>
    <section className="card usage-trend">
      <div className="usage-heading"><div><h3>{label} · {metricLabel}趋势</h3><p className="hint">{isHourly ? "每小时用量" : scale === "overview" || scale === "day" ? "每日用量" : scale === "week" ? "每周用量" : "每月用量"} · Token</p></div><div className="ladder-filters"><select className="select" aria-label="趋势指标" value={metric} onChange={e=>setMetric(e.target.value as typeof metric)}><option value="total">总 Token</option><option value="input">输入 Token</option><option value="output">输出 Token</option><option value="cached">缓存命中</option><option value="uncached">未命中输入</option></select><select className="select" aria-label="趋势量程" value={scale} onChange={e=>{const next=e.target.value as TimeScale|"overview";setScale(next);setPeriod("");setHover("");const day=last(hourDates.filter(d=>d.recorded))??last(hourDates);onRange(next==="day"&&day?{from:day.key,to:day.key}:null);}}><option value="overview">总览</option><option value="day">按日</option><option value="week">按周</option><option value="month">按月</option></select></div></div>
      {range && <div className="date-selection-bar">{isHourly?<select className="select" aria-label="小时趋势日期" value={range.from} onChange={e=>{setPeriod("");setHover("");onRange({from:e.target.value,to:e.target.value});}}>{hourDates.map(d=><option key={d.key} value={d.key}>{d.key}</option>)}</select>:<b>{range.from === range.to ? range.from : range.from + " — " + range.to}</b>}<span>{isHourly ? "24 小时" : "所选周期"}</span><button className="btn btn-sm" onClick={()=>{setPeriod("");setHover("");setScale("overview");onRange(null);}}>{isHourly?"返回总览":"清除日期选择"}</button></div>}
      <svg className="usage-plot" viewBox="0 0 730 216" role="group" tabIndex={0} aria-label={`${label}${isHourly?"每小时":scale === "overview" || scale === "day" ? "每日" : scale === "week" ? "每周" : "每月"} Token 平滑曲线图`} onPointerMove={e=>setHover(pointAt(e.clientX,e.currentTarget))} onPointerLeave={()=>setHover("")} onClick={e=>pin(pointAt(e.clientX,e.currentTarget))} onKeyDown={e=>{if(e.key==="Escape"){setHover("");setPeriod("");setScale("overview");onRange(null);return;}if(e.key==="Enter"||e.key===" "){e.preventDefault();if(chosenPeriod)pin(chosenPeriod.key);return;}if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const index=chosenPeriod?series.indexOf(chosenPeriod):0;const next=e.key==="Home"?0:e.key==="End"?series.length-1:Math.max(0,Math.min(series.length-1,index+(e.key==="ArrowLeft"?-1:1)));if(series[next])setHover(series[next].key);}}>
        {[0, .5, 1].map(ratio => <g key={ratio}><line x1={left} x2={right} y1={y(max * ratio)} y2={y(max * ratio)} className="usage-grid" /><text x={left - 9} y={y(max * ratio) + 4} textAnchor="end">{compact(max * ratio)}</text></g>)}
        <path d={area} className="usage-area"/><path d={path} className="usage-line"/>
        {chosenPeriod && <line x1={x(series.indexOf(chosenPeriod))} x2={x(series.indexOf(chosenPeriod))} y1={top} y2={bottom} className="usage-crosshair" />}
        {chosenPeriod && <circle cx={x(series.indexOf(chosenPeriod))} cy={y(metricValue(chosenPeriod.tokens,metric))} r="4" className="usage-dot" />}
        {[...new Set((isHourly?[0,6,12,18,23]:[0, Math.floor((series.length - 1) / 2), series.length - 1]))].filter(index => index >= 0).map(index => <text key={index} x={x(index)} y="207" textAnchor={index === 0 && series.length > 1 ? "start" : index === series.length - 1 && series.length > 1 ? "end" : "middle"}>{periodText(series[index].key)}</text>)}
      </svg>
      <div className="usage-selected"><select className="select" aria-label="查看趋势具体日期或周期" value={chosenPeriod?.key ?? ""} onChange={e => pin(e.target.value)}>{series.map(day => <option key={day.key} value={day.key}>{periodText(day.key)}</option>)}</select><span>{metricLabel} <b>{format(chosenPeriod?metricValue(chosenPeriod.tokens,metric):0)}</b></span></div>
    </section>
    <section className="card usage-heatmap">
      <div className="usage-heading"><div><h3>Token 活动热力图</h3><p className="hint">{label} · {activeDays} 个活跃日 · 颜色越深，当日用量越高</p></div>
        {days === 0 && <select className="select" aria-label="热力图年份" value={year} onChange={e => { setYear(Number(e.target.value)); setSelected(""); }}>{years.map(value => <option key={value} value={value}>{value} 年</option>)}</select>}
      </div>
      <div className="heatmap-scroll"><div className="heatmap-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>{day}</span>)}</div>
        <div className="heatmap-cells" role="group" aria-label={`${label}每日 Token 热力图`}>
          {Array.from({ length: offset }, (_, i) => <span className="heatmap-pad" key={`pad-${i}`} />)}
          {calendar.map((day, index) => <button type="button" key={day.key} className={`heatmap-cell level-${heatLevel(day.tokens.total, heatMax)}`} aria-pressed={!!range && day.key >= range.from && day.key <= range.to}
            tabIndex={day.key === chosen?.key ? 0 : -1} aria-label={`${day.key}，${number(day.tokens.total)} Token${day.recorded ? "" : "，无使用记录"}`}
            title={`${day.key} · ${number(day.tokens.total)} Token`} onClick={() => { setSelected(day.key); setScale("day"); setPeriod(day.key); setHover(""); onRange({ from: day.key, to: day.key }); }}
            onKeyDown={e => {
              const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7, Home: -index, End: calendar.length - 1 - index };
              if (!(e.key in step)) return;
              e.preventDefault(); const next = Math.max(0, Math.min(calendar.length - 1, index + step[e.key]));
              setSelected(calendar[next].key);
              const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button"); buttons?.[next]?.focus();
            }} />)}
        </div>
      </div>
      <div className="heatmap-footer"><span className="hint">{calendar[0]?.key} — {last(calendar)?.key}</span><span className="heatmap-legend" aria-label="热力颜色从零到峰值">少{[0, 1, 2, 3, 4].map(level => <i key={level} className={`level-${level}`} />)}多 · 峰值 {compact(heatMax)}</span></div>
      <div className="usage-selected" aria-live="polite">{chosen ? <><b>{chosen.key}</b><span>总量 {format(chosen.tokens.total)}</span><span>输入 {format(chosen.tokens.input)}</span><span>输出 {format(chosen.tokens.output)}</span><span>缓存命中 {format(chosen.tokens.cached)}</span></> : <span>该年份暂无记录。</span>}</div>
    </section>
  </>;
}

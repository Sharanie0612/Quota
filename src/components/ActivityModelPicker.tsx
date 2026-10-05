import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ActivityGroup } from "../lib/types";
import { activityModelChoices, activityModelIdentity } from "../lib/activityModels";
import { IconCheck, IconLayers, IconSearch, IconX } from "./icons";
import { ProviderLogo } from "./logos";
import "./activity-model-picker.css";

const number = (n: number) => new Intl.NumberFormat("zh-CN").format(n);
export function ActivityModelPicker({ rows, value, onChange, loading }: { rows: ActivityGroup[]; value: string; onChange: (key: string) => void; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const matches = useMemo(() => activityModelChoices(rows, search), [rows, search]);
  const choices = ["", ...matches.map(row => row.key)];
  const active = Math.min(index, choices.length - 1);
  const selected = rows.find(row => row.key === value);
  const total = rows.reduce((sum, row) => sum + row.tokens.total, 0);
  const identity = activityModelIdentity(value);
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const choose = (key: string) => { onChange(key); close(); };

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    const container = list.current;
    const option = container?.querySelectorAll('[role="option"]')[active];
    if (!open || !container || !option) return;
    const box = container.getBoundingClientRect(), item = option.getBoundingClientRect();
    if (item.top < box.top) container.scrollTop -= box.top - item.top;
    else if (item.bottom > box.bottom) container.scrollTop += item.bottom - box.bottom;
  }, [open, active, search]);

  return <div className="activity-model-control" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(false);
  }} onKeyDown={event => { if (event.key === "Escape" && open && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <div className="activity-model-label"><b>模型用量</b><span>选择后，指标、热力图和趋势一起切换</span></div>
    <div className="activity-model-selection">
      <button type="button" className="activity-model-trigger" ref={trigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSearch(""); setIndex(value ? Math.max(0, activityModelChoices(rows, "").findIndex(row => row.key === value) + 1) : event.key === "ArrowUp" ? activityModelChoices(rows, "").length : 0); setOpen(true); }
      }} onClick={() => {
        if (open) close(); else { setSearch(""); setIndex(value ? Math.max(0, activityModelChoices(rows, "").findIndex(row => row.key === value) + 1) : 0); setOpen(true); }
      }}>
        {value ? <ProviderLogo provider={identity.provider} size={32}/> : <span className="activity-model-all"><IconLayers size={23}/></span>}
        <span className="activity-model-title"><small>{value ? identity.vendor : `${rows.filter(row => row.key).length} 个模型 · 当前范围`}</small><b>{value || "全部模型"}</b></span>
        <span className="activity-model-change">更换模型 <span aria-hidden="true">⌄</span></span>
      </button>
      {value && <button type="button" className="btn" onClick={() => choose("")} aria-label="清除模型筛选，查看全部模型"><IconX size={14}/>全部模型</button>}
    </div>
    <p className="activity-model-summary" role="status">{loading && !rows.length ? "正在读取模型用量…" : value
      ? selected ? `${number(selected.tokens.total)} Token · ${number(selected.sessions)} 个会话${total > 0 ? ` · 占当前范围 ${(selected.tokens.total / total * 100).toFixed(1)}%` : ""}`
        : loading ? "正在读取所选模型…" : "所选模型在当前范围暂无记录，可切换全部模型或扩大时间范围。"
      : `${number(total)} Token · 按厂商分组，组内按用量排序`}</p>

    {open && <div className="activity-model-popover" id={`${id}-panel`} role="dialog" aria-label="选择模型">
      <div className="activity-model-search"><IconSearch size={16}/><input className="input" ref={input} role="combobox" aria-label="搜索模型或厂商" aria-expanded={true} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={`${id}-option-${active}`} value={search} placeholder="搜索厂商、完整型号或推理版本" onChange={event => { setSearch(event.target.value); setIndex(event.target.value.trim() ? 1 : 0); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setIndex((active + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length); }
        if (event.key === "Enter") { event.preventDefault(); if (!search.trim() || matches.length) choose(choices[active]); }
      }}/></div>
      <div className="activity-model-options" role="listbox" aria-label="当前范围的模型" id={`${id}-list`} ref={list}>
        <div role="option" id={`${id}-option-0`} aria-selected={!value} className={`activity-model-option ${active === 0 ? "is-active" : ""}`} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setIndex(0)} onClick={() => choose("")}>
          <span className="activity-model-all"><IconLayers size={22}/></span><span className="activity-model-title"><b>全部模型</b><small>查看当前范围所有模型的用量</small></span>{!value && <IconCheck size={17}/>}
        </div>
        {matches.map((row, i) => {
          const info = activityModelIdentity(row.key);
          const heading = i === 0 || activityModelIdentity(matches[i - 1].key).vendor !== info.vendor;
          return <div role="presentation" key={row.key}>{heading && <div className="activity-model-vendor" role="presentation">{info.vendor}</div>}
            <div role="option" id={`${id}-option-${i + 1}`} aria-selected={row.key === value} className={`activity-model-option ${active === i + 1 ? "is-active" : ""}`} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setIndex(i + 1)} onClick={() => choose(row.key)}>
              <ProviderLogo provider={info.provider} size={30}/><span className="activity-model-title"><b>{row.key}</b><small>{number(row.tokens.total)} Token · {number(row.sessions)} 个会话</small></span>{row.key === value && <IconCheck size={17}/>}
            </div>
          </div>;
        })}
      </div>
      {!matches.length && <p className="activity-model-empty" role="status">{search ? "没有匹配的模型，试试厂商名称或更短的关键词。" : loading ? "正在读取模型列表…" : "当前范围暂无已知模型记录。"}</p>}
      <div className="activity-model-help">{matches.length} 个匹配模型 · ↑↓ 选择 · Enter 确认 · Esc 收起{rows.some(row => !row.key) ? " · 未知型号记录包含在全部模型中" : ""}</div>
    </div>}
  </div>;
}

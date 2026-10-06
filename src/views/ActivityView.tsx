import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { api, errText } from "../lib/api";
import { toast } from "../lib/store";
import { Button, EmptyState, Field, Notice, Seg } from "../components/ui";
import { ActivityCharts } from "../components/ActivityCharts";
import { ProviderLogo } from "../components/logos";
import { ActivityModelPicker } from "../components/ActivityModelPicker";
import { activityModelIdentity } from "../lib/activityModels";
import { IconChart, IconGear, IconRefresh } from "../components/icons";
import type { ActivityGroup, ActivityOptions, ActivityReport } from "../lib/types";

import type { ActivityMetric, ActivityRange } from "../lib/activityCharts";

const number = (n: number) => new Intl.NumberFormat("zh-CN").format(n);
const sourceNames: Record<string, string> = { codex: "Codex", zcode: "ZCode", harness: "DeepSeek Harness" };

function Breakdown({ title, rows, calls = false, onModel }: { title: string; rows: ActivityGroup[]; calls?: boolean; onModel?: (model: string) => void }) {
  const amount = (row: ActivityGroup) => calls ? row.calls : row.tokens.total;
  const total = rows.reduce((sum, row) => sum + amount(row), 0);
  const sorted = [...rows].sort((a, b) => amount(b) - amount(a));
  return <section className="card activity-breakdown">
    <h3>{title}</h3>
    {rows.length ? <table>
      <thead><tr><th>名称</th><th>{calls ? "调用次数" : "Token"}</th><th>会话</th></tr></thead>
      <tbody>{sorted.map(row => <tr key={row.key}>
        <td>{onModel ? <button className="activity-model-link" onClick={() => onModel(row.key)} aria-label={`查看 ${row.key} 的用量图表`}><ProviderLogo provider={activityModelIdentity(row.key).provider} size={22} /><span>{row.key || "未知"}</span></button> : <span>{row.key || "未知"}</span>}<div className="breakdown-track" aria-hidden="true"><span style={{ width: `${total ? amount(row) / total * 100 : 0}%` }} /></div></td>
        <td>{number(amount(row))}</td><td>{number(row.sessions)}</td>
      </tr>)}</tbody>
    </table> : <p className="hint">当前范围暂无{calls ? "工具调用" : "记录"}。</p>}
  </section>;
}

export function ActivityView() {
  const [device, setDevice] = useState("");
  const [source, setSource] = useState("");
  const [days, setDays] = useState("30");
  const [model, setModel] = useState("");
  const [metric, setMetric] = useState<ActivityMetric>("total");
  const [selection, setSelection] = useState<{ query: string; range: ActivityRange } | null>(null);
  const modelScope = JSON.stringify([device, source, days]);
  const query = JSON.stringify([device, source, days, model]);
  const range = selection?.query === query ? selection.range : null;
  const detailQuery = JSON.stringify([query, range]);
  const [rangeReport, setRangeReport] = useState<{ query: string; value: ActivityReport } | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [report, setReport] = useState<{ query: string; scope: string; value: ActivityReport } | null>(null);
  const data = report?.query === query ? report.value : null;
  useEffect(() => { setSelection(null); }, [query]);
  const [options, setOptions] = useState<ActivityOptions | null>(null);
  const [detail, setDetail] = useState("models");
  const [busy, setBusy] = useState<"collect" | "save" | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);
  const modelPicker = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setReadError("");
    try {
      const value = await api.getActivity(device, source, Number(days), model);
      if (id === requestId.current) setReport({ query, scope: modelScope, value });
    } catch (e) {
      if (id === requestId.current) setReadError(errText(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [device, source, days, model, query, modelScope]);

  useEffect(() => {
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      await load();
      if (!cancelled) timer = window.setTimeout(() => void poll(), 15000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); ++requestId.current; };
  }, [load, reloadKey]);
  useEffect(() => {
    let disposed=false;let cleanup:(()=>void)|undefined;
    void listen("activity-updated",()=>setReloadKey(key=>key+1)).then(unlisten=>{if(disposed)unlisten();else cleanup=unlisten;}).catch(()=>undefined);
    return ()=>{disposed=true;cleanup?.();};
  }, []);

  useEffect(() => {
    let live = true; setRangeError("");
    if (!range) return;
    void api.getActivity(device, source, Number(days), model, range.from, range.to).then(value => { if (live) setRangeReport({ query: detailQuery, value }); }).catch(e => { if (live) setRangeError(errText(e)); });
    return () => { live = false; };
  }, [detailQuery, reloadKey, report]);

  const refresh = async () => {
    setBusy("collect");
    try {
      await api.refreshActivity();
      await api.syncAccounts();
      setSyncError("");
      // Restart with the current filters, even if they changed during collection.
      setReloadKey(key => key + 1);
    } catch (e) {
      setSyncError(errText(e));
    } finally { setBusy(null); }
  };

  const choose = async (key: "syncDir" | "codexHome" | "zcodeHome" | "harnessHome") => {
    try {
      const path = await open({ directory: true, multiple: false, title: key === "syncDir" ? "选择各设备共用的同步目录" : "选择日志目录" });
      if (typeof path === "string") setOptions(current => current ? { ...current, [key]: path } : current);
    } catch (e) { toast(errText(e), "error"); }
  };

  const save = async () => {
    if (!options) return;
    setBusy("save");
    try {
      const current=await api.getActivityOptions();
      await api.saveActivityOptions({...options,autoCollect:current.autoCollect,collectIntervalSeconds:current.collectIntervalSeconds,syncAccounts:current.syncAccounts});
      setOptions(null);
      // A collection failure must not be reported as a failed settings save.
      try {
        await api.refreshActivity();
        await api.syncAccounts();
        setSyncError("");
        toast("统计设置已保存并同步");
      } catch (e) {
        setSyncError(errText(e));
        toast(`设置已保存，同步未完成：${errText(e)}`, "error");
      }
      setReloadKey(key => key + 1);
    } catch (e) { toast(errText(e), "error"); }
    finally { setBusy(null); }
  };

  const totals = data?.totals;
  const availableModels = data?.availableModels ?? (report?.scope === modelScope ? report.value.availableModels : []) ?? [];
  const hasActivity = !!totals && (totals.tokens.total > 0 || totals.calls > 0 || totals.sessions > 0);
  const detailData = range ? rangeReport?.query === detailQuery ? rangeReport.value : null : data;
  const rows = detail === "models" ? detailData?.models ?? [] : detail === "tools" ? detailData?.tools ?? []
    : detail === "agents" ? detailData?.agents ?? [] : (detailData?.byDevice ?? []).map(row => ({ ...row, key: data?.devices.find(d => d.id === row.key)?.name ?? row.key }));
  const status = !data ? loading ? "正在读取统计…" : readError ? "统计读取失败" : "暂无统计"
    : data.updatedAt ? `采集于 ${new Date(data.updatedAt).toLocaleString("zh-CN")}` : "尚未采集本地记录";

  return <div className="content-inner activity-page">
    <div className="card ladder-hero">
      <div><span className="eyebrow">Token 活动</span><h2>用量与效率，一目了然</h2><p>Codex、ZCode 与 DeepSeek Harness 的本地活动</p></div>
      <div className="ladder-sync"><span className="hint" role="status">{status}</span><div>
        <Button disabled={!!busy} onClick={() => void refresh()}><IconRefresh size={13} className={busy === "collect" ? "spin" : ""} />{busy === "collect" ? "同步中…" : "立即同步"}</Button>
        <Button disabled={!!busy || !data} onClick={() => setOptions(options ? null : data ? { ...data.options } : null)}><IconGear size={13} />{options ? "收起设置" : "同步设置"}</Button>
      </div></div>
    </div>

    {readError && <Notice tone="warn" actions={<Button size="sm" disabled={loading} onClick={() => void load()}>重试读取</Button>}>
      <b>统计读取未完成</b><div>{readError}</div>{data && <div className="hint">保留当前筛选最近一次读取的结果。</div>}
    </Notice>}
    {syncError && <Notice tone="warn" actions={<Button size="sm" disabled={!!busy} onClick={() => void refresh()}>重试同步</Button>}>
      <b>采集或同步未完成</b><div>{syncError}</div><div className="hint">现有用量和已保存设置仍保留。</div>
    </Notice>}
    {!!data?.errors.length && <Notice tone="warn" actions={<Button size="sm" disabled={!!busy} onClick={() => void refresh()}>重试同步</Button>}>
      <b>{data.errors.length} 项采集或同步未完成</b><div>已完成的用量仍可查看。</div>
      <details className="activity-error-details"><summary>查看详情</summary><ul>{data.errors.map((message, index) => <li key={index}>{message}</li>)}</ul></details>
    </Notice>}

    {options && <section className="card activity-settings">
      <h3>自动采集与跨设备同步</h3>
      <Field label="设备名称"><input className="input" aria-label="设备名称" value={options.deviceName} disabled={!!busy} onChange={e => setOptions({ ...options, deviceName: e.target.value })} /></Field>
      <p className="hint">采集频率和账户跨设备同步在「设置」调整。</p>
      <Field label="共享目录" hint="在每台设备选择同一个 iCloud Drive、OneDrive 或 NAS 目录；同步用量和已开启的账户展示资料，不同步密钥。"><div className="activity-path">
        <input className="input" aria-label="共享目录" readOnly value={options.syncDir} placeholder="尚未开启跨设备同步" />
        <Button disabled={!!busy} onClick={() => void choose("syncDir")}>选择目录</Button>
        <Button disabled={!!busy || !options.syncDir} onClick={() => setOptions({ ...options, syncDir: "" })}>关闭同步</Button>
      </div></Field>
      <details><summary>日志位置</summary>{(["codexHome", "zcodeHome", "harnessHome"] as const).map(key => {
        const label = key === "codexHome" ? "Codex" : key === "zcodeHome" ? "智谱 ZCode" : "DeepSeek Harness";
        return <Field key={key} label={label}><div className="activity-path">
          <input className="input" aria-label={`${label} 日志目录`} value={options[key]} disabled={!!busy} placeholder={key === "harnessHome" ? "选择 Harness 持久化根目录以启用" : ""} onChange={e => setOptions({ ...options, [key]: e.target.value })} />
          <Button disabled={!!busy} onClick={() => void choose(key)}>选择</Button>
        </div></Field>;
      })}</details>
      <div className="activity-settings-actions"><Button disabled={!!busy} onClick={() => setOptions(null)}>取消</Button><Button variant="primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" ? "保存并同步中…" : "保存并同步"}</Button></div>
    </section>}

    <div className="ladder-filters">
      <select className="select" aria-label="统计设备" value={device} onChange={e => { setDevice(e.target.value); setModel(""); }}><option value="">全部设备</option>{(data?.devices ?? report?.value.devices)?.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select>
      <select className="select" aria-label="统计来源" value={source} onChange={e => { setSource(e.target.value); setModel(""); }}><option value="">全部来源</option>{Object.entries(sourceNames).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
      <Seg value={days} onChange={value => { setDays(value); setModel(""); }} options={[{value:"7",label:"7 天"},{value:"30",label:"30 天"},{value:"90",label:"90 天"},{value:"365",label:"一年"},{value:"0",label:"全部"}]} />
      {(device || source || model || range) && <Button size="sm" onClick={()=>{setDevice("");setSource("");setModel("");setSelection(null);}}>清除筛选</Button>}
      <span className="hint activity-filter-status" role="status">{loading ? "更新统计中…" : `${sourceNames[source] ?? "全部来源"} · ${days === "0" ? "全部历史" : `近 ${days} 天`}`}</span>
    </div>

    <div ref={modelPicker}><ActivityModelPicker rows={availableModels} value={model} onChange={setModel} loading={loading}/></div>

    <div className="activity-totals" aria-busy={loading}>{[
      ["总 Token", totals?.tokens.total], ["输入 Token", totals?.tokens.input], ["输出 Token", totals?.tokens.output],
      ["缓存命中", totals?.tokens.cached], ["工具调用", totals?.calls], ["会话数", totals?.sessions],
    ].map(([label, value], index) => <button className="card activity-stat" key={label} aria-pressed={index < 4 ? metric === (["total","input","output","cached"] as const)[index] : undefined} onClick={() => {if(index < 4){setMetric((["total","input","output","cached"] as const)[index]);document.getElementById("activity-charts")?.scrollIntoView({behavior:"smooth",block:"nearest"});}else{setDetail(index === 4 ? "tools" : "models");document.getElementById("activity-details")?.scrollIntoView({behavior:"smooth",block:"start"});}}}><span>{label}</span><b>{value == null ? "—" : number(Number(value))}</b></button>)}</div>

    {!data ? <section className="card activity-placeholder" role="status"><p>{loading ? "正在读取当前范围的活动记录…" : "读取失败后可重试；尚未获得统计结果。"}</p></section>
      : !hasActivity ? <section className="card activity-placeholder"><EmptyState icon={<IconChart size={26} />} title="当前范围暂无活动"
        desc={data.updatedAt ? "试试其他来源、设备或更长的时间范围。" : "点击「立即同步」，读取本机仍保留的历史用量。"}
        action={data.updatedAt ? <Button onClick={() => { setDevice(""); setSource(""); setDays("0"); setModel(""); }}>查看全部历史</Button> : undefined} /></section>
        : <>
          <div id="activity-charts"><ActivityCharts key={query} rows={data.daily} days={Number(days)} model={model} metric={metric} setMetric={setMetric} range={range} onRange={range=>setSelection(range ? {query,range} : null)} /></div>
          <div id="activity-details" className="activity-detail-heading"><h3>{range ? range.from === range.to ? range.from : range.from + " — " + range.to : "当前范围"} · 活动明细</h3><Seg value={detail} onChange={setDetail} options={[{value:"models",label:"模型"},{value:"tools",label:"工具"},{value:"agents",label:"Agent"},{value:"devices",label:"设备"}]} /></div>
          {range && <div className="usage-selected" role="status"><span>{rangeError || (!detailData ? "读取所选周期…" : `${number(detailData.totals.tokens.total)} Token · ${number(detailData.totals.sessions)} 个会话`)}</span><Button size="sm" onClick={()=>setSelection(null)}>清除日期选择</Button>{rangeError && <Button size="sm" onClick={()=>setReloadKey(k=>k+1)}>重试</Button>}</div>}
          <Breakdown title={detail === "models" ? "模型使用" : detail === "tools" ? "工具调用" : detail === "agents" ? "Agent 使用" : "设备用量"} calls={detail === "tools"} rows={rows} onModel={detail === "models" ? key => { setModel(key); modelPicker.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } : undefined} />
        </>}
    <p className="hint">历史范围以各设备仍保留的本地记录为准。输入包含缓存命中与缓存写入；推理 Token 包含在输出中，不重复相加。不会保存或同步对话正文、工具参数与登录信息。</p>
  </div>;
}

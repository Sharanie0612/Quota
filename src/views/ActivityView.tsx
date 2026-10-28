import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { api, errText } from "../lib/api";
import { activityChannelName, activityFilterLabel, activityModelChannel, activityModelIdentity, activityModelName } from "../lib/activityModels";
import { toast } from "../lib/store";
import { newActivityIssues } from "../lib/activityIssues";
import { mergeSshDevices } from "../lib/sshDevices";
import { Button, EmptyState, Field, Modal, Notice, Seg, Switch } from "../components/ui";
import { ActivityCharts } from "../components/ActivityCharts";
import { ModelLogo } from "../components/ModelLogo";
import { CacheUsage } from "../components/CacheUsage";
import { ActivityShares } from '../components/ActivityShares';
import { ActivityModelPicker } from "../components/ActivityModelPicker";
import { ActivityDeviceDetails, ActivityModelDetails, TraeUsageDetails } from "../components/ActivityDetails";
import { activityDeviceChoices } from "../lib/activityDevices";

import "./activity-controls.css";

import { IconChart, IconGear, IconRefresh } from "../components/icons";
import type { ActivityGroup, ActivityOptions, ActivityReport } from "../lib/types";

import type { ActivityMetric, ActivityRange } from "../lib/activityCharts";

const number = (n: number) => new Intl.NumberFormat("zh-CN").format(n);
const sourceNames: Record<string, string> = { codex: "Codex", zcode: "ZCode", harness: "DeepSeek Harness", trae: "Trae" };

function ActivityNumber({value,compact}:{value:number|undefined;compact:boolean}) {
  const element=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    const node=element.current;
    if(!node||compact)return;
    let disposed=false;
    const fit=()=>{
      if(disposed)return;
      node.style.fontSize="";
      const text=node.firstElementChild as HTMLElement;
      const available=node.clientWidth;
      if(!available)return;
      // Measure the actual glyphs, including separators, instead of estimating from digit count.
      for(let attempt=0;attempt<3;attempt++){
        const width=text.getBoundingClientRect().width;
        if(width<=available)break;
        node.style.fontSize=`${parseFloat(getComputedStyle(node).fontSize)*available/width*.99}px`;
      }
    };
    fit();
    const observer=new ResizeObserver(fit);
    observer.observe(node);
    void document.fonts.ready.then(fit);
    return()=>{disposed=true;observer.disconnect();node.style.fontSize="";};
  },[value,compact]);
  return <b ref={element} title={value==null?"":number(value)}><span className="activity-number-content">{value==null?"—":compact?new Intl.NumberFormat("zh-CN",{notation:"compact",maximumFractionDigits:2}).formatToParts(value).map((part,index)=><span key={index} className={part.type==="compact"?"activity-summary-unit":undefined}>{part.value}</span>):number(value)}</span></b>;
}

function Breakdown({ title, rows, calls = false, onModel, format = number }: { format?:(n:number)=>string; title: string; rows: ActivityGroup[]; calls?: boolean; onModel?: (model: string) => void }) {
  const amount = (row: ActivityGroup) => calls ? row.calls : row.tokens.total;
  const total = rows.reduce((sum, row) => sum + amount(row), 0);
  const sorted = [...rows].sort((a, b) => amount(b) - amount(a));
  return <section className="card activity-breakdown">
    <h3>{title}</h3>
    {rows.length ? <table>
      <thead><tr><th>名称</th><th>{calls ? "调用次数" : "Token"}</th><th>会话</th></tr></thead>
      <tbody>{sorted.map(row => { const name = activityModelName(row.key) || "未知"; const channel = activityChannelName(activityModelChannel(row.key));
        return <tr key={row.key}>
        <td>{onModel ? <button className="activity-model-link" onClick={() => onModel(row.key)} aria-label={`按 ${activityFilterLabel(row.key)} 查看用量图表`}><ModelLogo name={name} size={22} /><span>{name}</span>{channel && <span className="activity-channel-tag">{channel}</span>}</button> : <span>{row.key || "未知"}</span>}<div className="breakdown-track" aria-hidden="true"><span style={{ width: `${total ? amount(row) / total * 100 : 0}%` }} /></div></td>
        <td>{format(amount(row))}</td><td>{number(row.sessions)}</td>
      </tr>; })}</tbody>
    </table> : <p className="hint">当前范围暂无{calls ? "工具调用" : "记录"}。</p>}
  </section>;
}

export function ActivityView({onOpenSyncSettings}:{onOpenSyncSettings?:()=>void}) {
  const [compactNumbers,setCompactNumbers]=useState(true);
  const format=(n:number)=>compactNumbers?new Intl.NumberFormat("zh-CN",{notation:"compact",maximumFractionDigits:2}).format(n):number(n);
  const [device, setDevice] = useState("");
  const [source, setSource] = useState("");
  const [days, setDays] = useState("0");
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
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sshHosts, setSshHosts] = useState<string[]>([]);
  const [sshDetecting, setSshDetecting] = useState(false);
  const [sshNotice, setSshNotice] = useState("");
  const [sshWarning, setSshWarning] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshHome, setSshHome] = useState("");
  const sshRequest = useRef(0);
  useEffect(() => () => { sshRequest.current++; }, []);
  const [detail, setDetail] = useState("models");
  useEffect(()=>{setDetail(model==="vendor:trae"||model.startsWith("channel:")||source==="trae"?"channels":"models");},[model,source]);
  const [connectingTrae, setConnectingTrae] = useState(false);
  const [busy, setBusy] = useState<"collect" | "save" | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);
  const modelPicker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const count = newActivityIssues([...(data?.errors ?? []), ...(syncError ? [syncError] : [])]);
    if (count) toast("部分记录暂未采集，已有用量可正常查看。详情见同步设置。");
  }, [data?.errors, syncError]);

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

  const choose = async (key: "codexHome" | "zcodeHome" | "harnessHome" | "traeHome") => {
    try {
      const path = await open({ directory: true, multiple: false, title: "选择日志目录" });
      if (typeof path === "string") setOptions(current => current ? { ...current, [key]: path } : current);
    } catch (e) { toast(errText(e), "error"); }
  };

  const detectSsh = async (identify=false, manual=false) => {
    const id = ++sshRequest.current;
    setSshDetecting(true); setSshWarning(""); setSshNotice("");
    try {
      const result = manual ? {hosts:[sshHost.trim()],warnings:[]} : await api.discoverSshHosts();
      if (id !== sshRequest.current) return;
      if(!manual)setSshHosts(result.hosts);
      setSshWarning(result.warnings.join("；"));
      setSshNotice(result.hosts.length ? `发现 ${result.hosts.length} 个 SSH 连接，识别设备后可选择纳入统计。`
        : "未在 SSH 配置中找到连接，可手动添加 Codex 使用的主机别名。");
      if(identify){
        const targets=manual ? [{host:sshHost.trim(),home:sshHome.trim()}] : [
          ...result.hosts.map(host=>({host,home:""})),
          ...(options?.codexSshDevices??[]).map(d=>({host:d.host,home:d.home}))
        ];
        const unique=targets.filter((t,i)=>targets.findIndex(other=>other.host.toLowerCase()===t.host.toLowerCase()&&other.home===t.home)===i);
        if(unique.length>32){setSshWarning("发现的连接超过 32 个，请手动识别需要使用的主机。");return;}
        if(!unique.length)return;
        setSshNotice("正在连接并识别设备，暂不采集用量…");
        const found=await api.identifySshDevices(unique);
        if(id!==sshRequest.current)return;
        setOptions(current=>current?{...current,codexSshDevices:mergeSshDevices(current.codexSshDevices??[],found)}:current);
        const failures=found.filter(d=>d.error).length;
        setSshNotice(`已识别 ${new Set(found.filter(d=>!d.error).map(d=>d.deviceId)).size} 台设备${failures?`，${failures} 个连接未完成`:""}。新设备默认不纳入统计。`);
        if(manual){setSshHost("");setSshHome("");}
      }
    } catch (e) {
      if (id === sshRequest.current) {setSshNotice("可重试识别设备，或手动添加连接。");setSshWarning(`自动识别未完成：${errText(e)}。仍可手动填写。`);}
    } finally { if (id === sshRequest.current) setSshDetecting(false); }
  };
  const closeOptions = () => { sshRequest.current++; setSshDetecting(false); setOptions(null); };
  const openSettings = async () => {
    setSettingsLoading(true);
    try {
      const current = await api.getActivityOptions();
      setSshHost("");setSshHome("");setSshHosts([]);
      setOptions(current); void detectSsh();
    }
    catch (e) { toast(errText(e), "error"); }
    finally { setSettingsLoading(false); }
  };

  const connectTrae = async () => {
    if (!options) return;
    setConnectingTrae(true);
    try {
      const enabled = !options.traeEnabled;
      if (!enabled || await confirm("允许 Quota 从本机 Trae 进程读取用量数据库密钥，并存入系统凭据管理器？数据库只在内存解密，不保存对话正文。", { title: "连接本机 Trae", kind: "info" })) setOptions(current => current ? { ...current, traeEnabled: enabled } : current);
    } catch (e) { toast(errText(e), "error"); }
    finally { setConnectingTrae(false); }
  };

  const save = async () => {
    if (!options) return;
    setBusy("save");
    try {
      const current=await api.getActivityOptions();
      await api.saveActivityOptions({...options,syncDir:current.syncDir,syncAccounts:current.syncAccounts});
      closeOptions();
      // A collection failure must not be reported as a failed settings save.
      try {
        await api.refreshActivity();
        await api.syncAccounts();
        setSyncError("");
        toast("采集设置已保存，用量已更新");
      } catch (e) {
        setSyncError(errText(e));
        toast(`采集设置已保存，用量更新未完成：${errText(e)}`, "error");
      }
      setReloadKey(key => key + 1);
    } catch (e) { toast(errText(e), "error"); }
    finally { setBusy(null); }
  };

  const totals = data?.totals;
  const availableModels = data?.availableModels ?? (report?.scope === modelScope ? report.value.availableModels : []) ?? [];
  const hasActivity = !!totals && (totals.tokens.total > 0 || totals.calls > 0 || totals.sessions > 0);
  const detailData = range ? rangeReport?.query === detailQuery ? rangeReport.value : null : data;
  // Trae separates models it provides from models reached with the user's own API key.
  const channelRows = detailData?.channels ?? [];
  const detailOptions = [{ value: "models", label: "模型" }, { value: "tools", label: "工具" }, { value: "agents", label: "Agent" }, { value: "devices", label: "设备" },
    ...(channelRows.length || source==="trae" || model==="vendor:trae" || model.startsWith("channel:") ? [{ value: "channels", label: "Trae 明细" }] : [])];
  const rows = detail === "models" ? detailData?.models ?? [] : detail === "tools" ? detailData?.tools ?? []
    : detail === "agents" ? detailData?.agents ?? [] : detail === "channels" ? channelRows
    : detailData?.byDevice ?? [];
  const status = !data ? loading ? "正在读取统计…" : readError ? "统计读取失败" : "暂无统计"
    : data.updatedAt ? `采集于 ${new Date(data.updatedAt).toLocaleString("zh-CN")}` : "尚未采集本地记录";

  const devices = data?.devices ?? report?.value.devices ?? [];
  const deviceChoices = activityDeviceChoices(devices, data?.options ?? report?.value.options);
  const modelLabel = model.startsWith("vendor:") && model !== "vendor:trae"
    ? availableModels.map(row => activityModelIdentity(row.key)).find(info => `vendor:${info.provider}` === model)?.vendor ?? "所选供应商"
    : activityFilterLabel(model);
  const activeFilters = [device ? deviceChoices.find(item => item.id === device)?.label ?? device : "", sourceNames[source], modelLabel].filter(Boolean);
  const clearFilters = () => { setDevice(""); setSource(""); setModel(""); setSelection(null); };
  const focusModelPicker = (key: string) => {
    setModel(key);
    setFiltersOpen(true);
    modelPicker.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  return <div className="content-inner activity-page">
    <section className="card activity-controls" aria-label="活动筛选与采集">
      <div className="activity-controls-main">
        <Seg value={days} onChange={value => { setDays(value); setModel(""); }} options={[{value:"0",label:"全部历史"},{value:"7",label:"7 天"},{value:"30",label:"30 天"},{value:"90",label:"90 天"},{value:"365",label:"1 年"}]} />
        <div className="activity-controls-actions">
          <Button variant="primary" disabled={!!busy || settingsLoading} onClick={() => void refresh()}><IconRefresh size={14} className={busy ? "spin" : ""} />{busy ? busy === "save" ? "保存中…" : "更新中…" : "更新用量"}</Button>
          <Button variant="quiet" disabled={!!busy || settingsLoading} onClick={() => void openSettings()} aria-haspopup="dialog"><IconGear size={15} />{settingsLoading ? "读取中…" : "采集设置"}</Button>
        </div>
      </div>
      <div className="activity-controls-context" ref={modelPicker}>
        <Button size="sm" variant="quiet" className={`activity-filter-toggle${activeFilters.length ? " has-filters" : ""}`} aria-expanded={filtersOpen} aria-controls="activity-filters" onClick={() => setFiltersOpen(value => !value)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
          筛选{activeFilters.length > 0 && <span className="activity-filter-count">{activeFilters.length}</span>}<span className={`activity-filter-chevron${filtersOpen ? " is-open" : ""}`} aria-hidden="true">⌄</span>
        </Button>
        <span className="activity-scope-summary" title={activeFilters.join(" · ")}>{activeFilters.length ? activeFilters.join(" · ") : "全部设备 · 全部来源 · 全部模型"}</span>
        {(activeFilters.length > 0 || range) && <Button variant="quiet" size="sm" onClick={clearFilters}>重置筛选</Button>}
        <span className="activity-collection-status" role="status">{loading && data ? "更新统计中…" : status}</span>
      </div>
      <div id="activity-filters" className="activity-filter-panel" hidden={!filtersOpen}>
        <div className="activity-filter-fields">
          <Field label="设备"><select className="select" aria-label="统计设备" value={device} onChange={e => { setDevice(e.target.value); setModel(""); }}><option value="">全部设备</option>{deviceChoices.map(d => <option value={d.id} key={d.id}>{d.label}</option>)}</select></Field>
          <Field label="来源"><select className="select" aria-label="统计来源" value={source} onChange={e => { setSource(e.target.value); setModel(""); }}><option value="">全部来源</option>{Object.entries(sourceNames).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        </div>
        <div className="activity-filter-model"><span>模型或供应商</span><ActivityModelPicker key={modelScope} rows={availableModels} value={model} onChange={setModel} loading={loading}/></div>
        <p className="hint activity-filter-help">选择厂商查看其直接使用的全部模型，或选择一个模型查看概览、趋势与明细；Trae 按提供模型与 API 接入分别统计。筛选不改变采集设置。</p>
      </div>
    </section>

    {readError && <Notice tone="warn" actions={<Button size="sm" disabled={loading} onClick={() => void load()}>重试读取</Button>}>
      <b>统计读取未完成</b><div>{readError}</div>{data && <div className="hint">保留当前筛选最近一次读取的结果。</div>}
    </Notice>}
    {(data?.errors.length || syncError) ? <Notice tone="warn">
      <b>部分用量尚未采集完整</b><details className="activity-error-details"><summary>查看采集详情</summary><ul>{[...new Set([...(data?.errors ?? []), ...(syncError ? [syncError] : [])])].map(message => <li key={message}>{message}</li>)}</ul></details>
    </Notice> : null}
    {options && <Modal title="采集设置" wide onClose={() => { if (!busy && !connectingTrae) closeOptions(); }} footer={<><Button disabled={!!busy || connectingTrae} onClick={closeOptions}>取消</Button><Button variant="primary" disabled={!!busy || sshDetecting || connectingTrae} onClick={() => void save()}>{busy === "save" ? "保存中…" : "保存设置"}</Button></>}>
      <div className="activity-collection-settings">
      <p className="hint activity-settings-intro">从本机日志读取用量，采集后自动更新图表。</p>
      <div className="setting-row"><div className="txt"><b>自动采集</b><span>仅在 Quota 运行时执行</span></div><Switch checked={options.autoCollect} disabled={!!busy} onChange={autoCollect => setOptions({...options,autoCollect})} label="自动采集 Token 活动" /></div>
      {options.autoCollect && <div className="setting-row"><div className="txt"><b>采集频率</b><span>默认每 30 秒采集一次</span></div><select className="select" aria-label="Token 采集频率" disabled={!!busy} value={options.collectIntervalSeconds ?? 30} onChange={e => setOptions({...options,collectIntervalSeconds:Number(e.target.value)})}>{[5,15,30,60,300,900].map(value => <option key={value} value={value}>{value < 60 ? `${value} 秒` : `${value / 60} 分钟`}</option>)}{options.collectIntervalSeconds && ![5,15,30,60,300,900].includes(options.collectIntervalSeconds) && <option value={options.collectIntervalSeconds}>{options.collectIntervalSeconds} 秒</option>}</select></div>}
      <Field label="设备名称" hint="用于区分跨设备同步后的用量记录"><input className="input" aria-label="设备名称" value={options.deviceName} disabled={!!busy} onChange={e => setOptions({ ...options, deviceName: e.target.value })} /></Field>
      <section className="activity-ssh-settings" aria-label="SSH 远程设备"><h3>SSH 用量来源</h3><p className="hint">远端无需安装 Quota。通过现有 SSH 连接只读采集 Codex 用量，不在远端创建文件或同步目录。</p>
      <Field label="SSH 设备" hint="识别连接后，勾选需要纳入统计的设备，也可以全部不选。保存后生效。">
        <div className="ssh-device-toolbar"><span className="hint">已纳入 {(options.codexSshDevices??[]).filter(d=>d.included).length} 台设备</span>
          <Button disabled={!!busy || sshDetecting} onClick={() => void detectSsh(true)}>{sshDetecting ? "识别中…" : "识别设备"}</Button></div>
        <p className="hint" role="status">{sshNotice || (sshHosts.length?`发现 ${sshHosts.length} 个连接`:"正在读取本机 SSH 配置…")}</p>
        <div className="ssh-device-list">{(options.codexSshDevices??[]).map((remote,index)=><div className="ssh-device" key={remote.deviceId||`${remote.host}:${remote.home}`}>
          <label className="ssh-device-choice"><input type="checkbox" aria-label={`纳入统计 ${remote.name||remote.host} (${remote.host})`} checked={remote.included} disabled={!!busy||sshDetecting||!remote.deviceId}
            onChange={e=>setOptions({...options,codexSshDevices:options.codexSshDevices?.map((d,i)=>i===index?{...d,included:e.target.checked}:d)})} />
            <span><strong>{remote.name||remote.host}</strong><span className="activity-ssh-aliases">{[...new Set([remote.host,...remote.aliases].filter(Boolean))].map(alias=><small key={alias}>{alias}</small>)}</span>{remote.home&&<small>{remote.home}</small>}<small className="activity-device-id" title={remote.deviceId}>{remote.deviceId ? `设备标识：${remote.deviceId.slice(0,8)}` : "设备尚未识别"}</small></span>
            <span className="ssh-device-state">{remote.included?"纳入统计":"不纳入统计"}</span></label>
          {remote.error&&<p className="hint ssh-device-error" role="status">{remote.error}</p>}
          {!remote.deviceId&&!remote.error&&<p className="hint">旧连接待识别，确认设备后可更改统计选择。</p>}
        </div>)}</div>
        <p className="hint">取消勾选会停止采集，并让该设备历史退出 Token 活动、我的使用和悬浮窗汇总；记录保留，重新勾选即可恢复。</p>
        {sshWarning && <p className="hint" role="status">{sshWarning}</p>}
      </Field>
      <details><summary>手动添加 SSH 连接</summary><Field label="主机别名" hint="使用本机 SSH 配置中的别名。远程设备需为 Ubuntu / Linux，并可免交互连接。">
        <div className="activity-path"><input className="input" aria-label="Codex SSH 主机别名" value={sshHost} placeholder="例如 devbox" disabled={!!busy||sshDetecting} onChange={e=>setSshHost(e.target.value)} />
          <Button disabled={!!busy||sshDetecting||!sshHost.trim()} onClick={()=>void detectSsh(true,true)}>识别并添加</Button></div>
      </Field><Field label="远程 Codex 数据目录（可选）" hint="留空使用远程 CODEX_HOME 或 ~/.codex。识别只读取设备标识，勾选保存后才采集用量。">
        <input className="input" aria-label="远程 Codex 数据目录" value={sshHome} placeholder="自动识别远程数据目录" disabled={!!busy||sshDetecting} onChange={e=>setSshHome(e.target.value)} />
      </Field></details>
      </section>
      <details className="activity-source-settings"><summary>Trae 本机用量<small>{options.traeEnabled ? "已连接" : "未连接"}</small></summary>
      <Field label="Trae 本机用量" hint="首次连接需打开 Trae 或 Trae SOLO，之后可离线读取历史。只保存用量指标。">
        <Button disabled={!!busy || connectingTrae} onClick={() => void connectTrae()}>{options.traeEnabled ? "断开 Trae" : "连接本机 Trae"}</Button>
        {options.traeEnabled && <span className="hint"> 保存后开始采集</span>}
      </Field>
      </details>
      <details className="activity-log-settings"><summary><span>日志位置</span><small>高级设置</small></summary><p className="hint">Codex 与 ZCode 通常无需修改；使用 Harness 时选择其持久化根目录，Trae 可自动识别本机目录。</p>{(["codexHome", "zcodeHome", "harnessHome", "traeHome"] as const).map(key => {
        const label = key === "codexHome" ? "Codex" : key === "zcodeHome" ? "智谱 ZCode" : key === "traeHome" ? "Trae / Trae SOLO" : "DeepSeek Harness";
        return <Field key={key} label={label}><div className="activity-path">
          <input className="input" aria-label={`${label} 日志目录`} value={options[key]} disabled={!!busy} placeholder={key === "harnessHome" ? "选择 Harness 持久化根目录以启用" : ""} onChange={e => setOptions({ ...options, [key]: e.target.value })} />
          <Button disabled={!!busy} onClick={() => void choose(key)}>选择</Button>
        </div></Field>;
      })}</details>
      {onOpenSyncSettings && <div className="activity-sync-setting"><div><b>跨设备同步</b><p className="hint">共享目录与同步管理在「设置」中统一配置。</p></div><Button size="sm" disabled={!!busy} onClick={() => { closeOptions(); onOpenSyncSettings(); }}>前往设置 ↗</Button></div>}
      </div>
    </Modal>}

    <section className="card activity-overview" aria-label="用量概览" aria-busy={loading}>
    <div className="activity-summary-toolbar"><h3>用量概览</h3><button className="activity-number-format" aria-label={compactNumbers?"切换为完整数字":"切换为简写"} onClick={()=>setCompactNumbers(v=>!v)}><span aria-hidden="true">123</span>{compactNumbers?"简写":"完整数字"}<span aria-hidden="true">⇄</span></button></div>
    <div className={`activity-summary${compactNumbers?"":" activity-summary-full"}`}>
      {[{label:"总 Token",value:totals?.tokens.total,key:"total"},{label:"输入",value:totals?.tokens.input,key:"input"},{label:"输出",value:totals?.tokens.output,key:"output"},{label:"工具调用",value:totals?.calls,key:"tools"},{label:"会话",value:totals?.sessions,key:"sessions"}].map(item=>{
        const isMetric=["total","input","output"].includes(item.key);
        const selected=metric===item.key||(item.key==="input"&&["cached","uncached"].includes(metric));
        return <button key={item.key} className={item.key==="total"?"activity-summary-primary":isMetric?undefined:"activity-summary-secondary"} aria-pressed={isMetric?selected:undefined} onClick={()=>{
          if(isMetric)setMetric(item.key as ActivityMetric);
          else{setDetail(item.key==="tools"?"tools":"models");document.getElementById("activity-details")?.scrollIntoView({behavior:"smooth"});}
        }}>
          <span className="activity-summary-label">{item.label}</span>
          <ActivityNumber value={item.value} compact={compactNumbers}/>
        </button>;
      })}
    </div>
    {["input","cached","uncached"].includes(metric)&&<div className="input-cache-controls"><Seg value={metric} onChange={v=>setMetric(v as ActivityMetric)} options={[{value:"input",label:"全部输入"},{value:"cached",label:"缓存命中"},{value:"uncached",label:"未命中"}]}/><span>{totals?.tokens.input?`命中率 ${(totals.tokens.cached/totals.tokens.input*100).toFixed(1)}%`:"暂无输入"}</span></div>}
    </section>

    {!data ? <section className="card activity-placeholder" role="status"><p>{loading ? "正在读取当前范围的活动记录…" : "读取失败后可重试；尚未获得统计结果。"}</p></section>
      : !hasActivity ? <section className="card activity-placeholder"><EmptyState icon={<IconChart size={26} />} title="当前范围暂无活动"
        desc={data.updatedAt ? "试试其他来源、设备或更长的时间范围。" : "点击「更新用量」，读取本机仍保留的历史用量。"}
        action={data.updatedAt ? <Button onClick={() => { setDevice(""); setSource(""); setDays("0"); setModel(""); }}>查看全部历史</Button> : undefined} /></section>
        : <>
          <div id="activity-charts"><ActivityCharts key={query} rows={data.daily} days={Number(days)} hourly={data.hourly ?? []} format={format} model={model} metric={metric} setMetric={setMetric} range={range} onRange={range=>setSelection(range ? {query,range} : null)} /></div>
          {detailData&&<ActivityShares report={detailData} format={format} onModel={setModel} onSource={key=>{setSource(key);setModel('');}} onMetric={setMetric}/>}
          <details className="activity-cache-details"><summary>按模型查看缓存</summary><CacheUsage rows={detailData?.models ?? []} format={format} onModel={setModel}/></details>
          <div id="activity-details" className="activity-detail-heading"><h3>{range ? range.from === range.to ? range.from : range.from + " — " + range.to : "当前范围"} · 活动明细</h3><Seg value={detail} onChange={setDetail} options={detailOptions} /></div>
          {range && <div className="usage-selected" role="status"><span>{rangeError || (!detailData ? "读取所选周期…" : `${number(detailData.totals.tokens.total)} Token · ${number(detailData.totals.sessions)} 个会话`)}</span><Button size="sm" onClick={()=>setSelection(null)}>清除日期选择</Button>{rangeError && <Button size="sm" onClick={()=>setReloadKey(k=>k+1)}>重试</Button>}</div>}
          {detail==="channels" ? <TraeUsageDetails rows={detailData?.models ?? []} channels={channelRows} format={format} onModel={focusModelPicker}/>
            : detail==="models" ? <section className="card activity-channel-details"><h3>模型使用</h3><ActivityModelDetails rows={rows} format={format} onModel={focusModelPicker}/></section>
            : detail==="devices" ? <ActivityDeviceDetails rows={detailData?.byDevice ?? []} devices={devices} options={data?.options ?? report?.value.options} format={format} onDevice={id=>{setDevice(id);setModel("");modelPicker.current?.scrollIntoView({block:"start"});}}/>
            : <Breakdown format={format} title={detail === "tools" ? "工具调用" : "Agent 使用"} calls={detail === "tools"} rows={rows}/>}
          {detail==="channels"&&detailData?.channels.some(row=>row.key==="unknown"&&row.tokens.total>0)&&<Notice>部分旧记录未包含通道信息。请在记录所属电脑连接本机 Trae 并重新采集，再同步到其他设备；用量总数不变。</Notice>}
        </>}
    <details className="activity-method"><summary>统计口径与隐私</summary><p className="hint">输入包含缓存命中与缓存写入，推理包含在输出中，不重复相加。历史范围以本地保留记录为准；仅保存用量指标。</p></details>
  </div>;
}

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { creatorColors, ModelCostChart, type ComparisonPoint } from "../components/ModelCostChart";
import { IconArrowUpRight, IconCheck, IconPlus, IconRefresh, IconSearch, IconX } from "../components/icons";
import { ModelLogo } from "../components/ModelLogo";
import { Button, EmptyState, Field, Modal, Notice } from "../components/ui";
import { api, errText } from "../lib/api";
import {
  configurationLabel, latestModelCount, matchesModel, modelFamiliesForComparison, restoreComparison,
  selectedComparison, selectedConfiguration, type ComparisonSelection, type ModelFamily,
} from "../lib/modelComparison";
import type { TaskCostModel, TaskCostReport } from "../lib/types";
import "./model-ladder.css";

const aaChart = "https://artificialanalysis.ai/models?cost=intelligence-vs-cost-per-task";
const aaKeys = "https://artificialanalysis.ai/api-key-management-redirect";
const storageKey = "quota-model-comparison-v1";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const formatCost = (cost: number) => cost < 0.0001 ? `$${cost.toExponential(3)}` : usd.format(cost);
type ComparedModel = { family: ModelFamily; configuration: TaskCostModel };
type OpenPanel = "picker" | "chart" | "source" | null;

function readSelection() {
  try { return restoreComparison(localStorage.getItem(storageKey)); }
  catch { return restoreComparison(null); }
}

function DataConnection({ connected, onClose, onSave }: {
  connected: boolean;
  onClose: () => void;
  onSave: (report: TaskCostReport) => void;
}) {
  const formId = useId();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(value: string) {
    setBusy(true);
    setError("");
    try {
      onSave(await api.saveTaskCostKey(value));
    } catch (failure) {
      setError(errText(failure));
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Artificial Analysis 数据源" onClose={() => { if (!busy) onClose(); }} footer={<>
    {connected && <Button disabled={busy} onClick={() => void save("")}>断开连接</Button>}
    <Button disabled={busy} onClick={onClose}>取消</Button>
    <Button type="submit" form={formId} variant="primary" disabled={busy || !key.trim()}>
      {busy ? "正在连接…" : "连接并更新"}
    </Button>
  </>}>
    <form id={formId} onSubmit={event => {
      event.preventDefault();
      if (!busy && key.trim()) void save(key.trim());
    }}>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Artificial Analysis API Key" hint="支持免费 API Key。Quota 将其保存在系统凭据管理器中。">
        <input className="input" type="password" maxLength={512} autoComplete="off" spellCheck={false}
          value={key} disabled={busy} onChange={event => setKey(event.target.value)}
          placeholder={connected ? "输入新密钥以更换" : "粘贴 API Key"} />
      </Field>
      <Button type="button" size="sm" variant="quiet" onClick={() => void api.openExternal(aaKeys)}>打开 AA 密钥管理</Button>
    </form>
  </Modal>;
}

function ModelPicker({ families, vendor, vendors, selection, selectedIds, onToggle, onVendor, onClose }: {
  families: ModelFamily[];
  vendor: string;
  vendors: string[];
  selection: ComparisonSelection;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onVendor: (creator: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [limit, setLimit] = useState(60);
  const matches = families.filter(family => matchesModel(family, search, vendor)
    && (!onlySelected || selectedIds.has(family.id)));
  return <Modal wide title="选择对比模型" onClose={onClose} footer={<>
    <span className="model-picker-count" role="status">已选 {selectedIds.size} 个型号</span>
    <Button variant="primary" onClick={onClose}>完成</Button>
  </>}>
    <div className="model-picker-controls">
      <div className="search">
        <IconSearch size={16}/>
        <input className="input" aria-label="搜索模型或厂商" placeholder="搜索模型或厂商" value={search}
          onChange={event => { setSearch(event.target.value); setLimit(60); }}/>
      </div>
      <select className="select" aria-label="模型厂商" value={vendor}
        onChange={event => { onVendor(event.target.value); setLimit(60); }}>
        <option value="">全部厂商</option>
        {vendors.map(creator => <option key={creator} value={creator}>{creator}</option>)}
      </select>
    </div>
    <div className="model-picker-options">
      <label><input type="checkbox" checked={onlySelected} onChange={event => {
        setOnlySelected(event.target.checked);
        setLimit(60);
      }}/> 仅显示已选</label>
      <span>{matches.length} 个型号 · 最新发布优先</span>
    </div>
    <div className="model-picker-list" aria-label="可选模型">
      {matches.slice(0, limit).map(family => {
        const chosen = selectedIds.has(family.id);
        const model = selectedConfiguration(family, selection);
        return <button key={family.id} type="button" className="model-picker-row" aria-label={`${chosen ? "移除" : "加入"} ${family.name}`}
          aria-pressed={chosen} onClick={() => onToggle(family.id)}>
          <ModelLogo name={family.name} size={21}/>
          <span className="model-picker-name"><strong>{family.name}</strong>
            <small>{family.creator} · {family.releaseDate ?? "发布日期未知"}{family.configurations.length > 1 && ` · ${family.configurations.length} 个档位`}</small>
          </span>
          <span className="model-picker-metric"><strong>{model.index.toFixed(1)}</strong>
            <small>{model.costPerTask === null ? "成本未知" : formatCost(model.costPerTask)}</small>
          </span>
          <span className="model-picker-check" aria-hidden="true">{chosen ? <IconCheck size={15}/> : <IconPlus size={15}/>}</span>
        </button>;
      })}
      {!matches.length && <p className="model-picker-empty">没有匹配的模型</p>}
    </div>
    {limit < matches.length && <Button size="sm" className="model-picker-more" onClick={() => setLimit(current => current + 60)}>
      显示更多
    </Button>}
  </Modal>;
}

function ModelDetail({ row, onChooseConfiguration, onClose }: {
  row: ComparedModel;
  onChooseConfiguration: (family: string, configuration: string) => void;
  onClose: () => void;
}) {
  const { family, configuration } = row;
  return <Modal title={<span className="task-model-title"><ModelLogo name={family.name} size={25}/>{family.name}</span>}
    onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
    {family.configurations.length > 1 && <Field label="评测档位">
      <select className="select" value={configuration.id}
        onChange={event => onChooseConfiguration(family.id, event.target.value)}>
        {family.configurations.map(model => <option key={model.id} value={model.id}>{configurationLabel(model)}</option>)}
      </select>
    </Field>}
    <dl className="task-model-details">
      <dt>厂商</dt><dd>{family.creator}</dd>
      <dt>发布日期</dt><dd>{family.releaseDate ?? "未知"}</dd>
      <dt>Intelligence Index</dt><dd>{configuration.index.toFixed(1)}</dd>
      <dt>Cost per Task</dt><dd>{configuration.costPerTask === null ? "暂无可比成本" : formatCost(configuration.costPerTask)}</dd>
    </dl>
  </Modal>;
}

export function AiModelsHub({ autoUpdate }: { autoUpdate: boolean }) {
  const [report, setReport] = useState<TaskCostReport | null>(null);
  const [selection, setSelection] = useState(readSelection);
  const [vendor, setVendor] = useState("");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  useEffect(() => {
    let active = true;
    async function read() {
      const version = ++request.current;
      try {
        const next = await api.getTaskCost();
        if (active && version === request.current) {
          setReport(next);
          setError("");
        }
      } catch (failure) {
        if (active && version === request.current) setError(errText(failure));
      }
    }
    const subscription = listen("task-cost-updated", () => void read());
    void subscription.then(() => { if (active) void read(); }, () => { if (active) void read(); });
    return () => {
      active = false;
      void subscription.then(unlisten => unlisten(), () => undefined);
    };
  }, []);

  function apply(next: TaskCostReport) {
    request.current += 1;
    setReport(next);
    setError("");
  }

  async function refresh() {
    setBusy(true);
    try {
      apply(await api.refreshTaskCost());
    } catch (failure) {
      setError(errText(failure));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(selection)); } catch { /* In-memory selection remains available. */ }
  }, [selection]);

  const snapshot = report?.snapshot;
  const families = useMemo(() => modelFamiliesForComparison(snapshot?.models ?? []), [snapshot]);
  const { defaults, selected } = useMemo(() => selectedComparison(families, selection), [families, selection]);
  const selectedIds = useMemo(() => new Set(selected.map(family => family.id)), [selected]);
  const vendorColors = useMemo(() => creatorColors([...new Set(families.map(family => family.creator))]), [families]);
  const visible = useMemo<ComparedModel[]>(() => selected.map(family => ({
    family, configuration: selectedConfiguration(family, selection),
  })), [selected, selection]);
  const points = useMemo<ComparisonPoint[]>(() => visible.flatMap(row => row.configuration.costPerTask === null
    ? [] : [{ ...row, cost: row.configuration.costPerTask }]), [visible]);
  const vendorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { family } of visible) counts.set(family.creator, (counts.get(family.creator) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [visible]);
  const detail = visible.find(row => row.family.id === detailId);
  const connected = report?.connected ?? false;
  const failure = error || report?.error;

  function toggle(id: string) {
    setSelection(current => {
      const added = new Set(current.included);
      const excluded = new Set(current.excluded);
      if (added.has(id) || defaults.has(id) && !excluded.has(id)) {
        added.delete(id);
        if (defaults.has(id)) excluded.add(id);
      } else {
        excluded.delete(id);
        if (!defaults.has(id)) added.add(id);
      }
      return { ...current, included: [...added], excluded: [...excluded] };
    });
  }

  function chooseConfiguration(id: string, configuration: string) {
    setSelection(current => ({ ...current, configurations: { ...current.configurations, [id]: configuration } }));
  }

  function inspect(id: string) {
    setActiveModel(id);
    setDetailId(id);
    setPanel(null);
  }

  const canvas = <ModelCostChart rows={points} vendorColors={vendorColors}
    formatCost={formatCost} selectedId={activeModel} onSelect={inspect}/>;

  return <div className="content-inner visual-model-page" data-task-cost-origin={snapshot?.origin}>
    <header className="visual-model-toolbar">
      <h1>AI 模型</h1>
      <div className="visual-model-actions">
        <Button size="sm" variant="quiet" onClick={() => setPanel("source")}>{connected ? "管理数据源" : "连接数据源"}</Button>
        {connected && <Button size="sm" disabled={busy} onClick={() => void refresh()}>
          <IconRefresh size={14} className={busy ? "spin" : ""}/>{busy ? "更新中…" : "立即更新"}
        </Button>}
      </div>
    </header>
    {failure && <Notice tone="warn">{failure}{snapshot && "。正在显示上次有效数据。"}</Notice>}
    <section className="card task-cost-chart" aria-labelledby="task-cost-title">
      <div className="task-cost-heading">
        <div>
          <h2 id="task-cost-title">Intelligence Index vs. Cost per Task</h2>
          <p>左上方代表更高的能力、更低的单任务成本</p>
        </div>
        <div className="visual-model-actions">
          {points.length > 0 && <Button size="sm" variant="quiet" onClick={() => setPanel("chart")}>
            <IconArrowUpRight size={15}/> 放大图表
          </Button>}
          <Button size="sm" variant="primary" disabled={!families.length} onClick={() => { setVendor(""); setPanel("picker"); }}>
            <IconPlus size={15}/> 选择模型
          </Button>
        </div>
      </div>
      {snapshot && <div className="task-comparison-status">
        <span role="status" data-selected={visible.length} data-plotted={points.length} data-available={families.length}>
          已选 <b>{visible.length}</b> / {families.length} 个型号
          {visible.length > points.length && ` · ${visible.length - points.length} 个成本待公布`}
        </span>
        <Button size="sm" variant="quiet" disabled={!families.length} onClick={() => setSelection(restoreComparison(null))}>
          <IconRefresh size={13}/> 恢复最新 {latestModelCount} 个
        </Button>
      </div>}
      {points.length > 0 ? panel !== "chart" && canvas : <EmptyState icon={<IconSearch size={24}/>}
        title={!report && !error ? "正在读取模型数据…" : visible.length ? "已选模型暂无可比成本" : "暂无可绘制的模型"}
        desc={snapshot ? "可从模型列表中加入有单任务成本的型号。" : undefined}/>}
      {vendorCounts.length > 0 && <div className="task-vendor-legend" aria-label="模型厂商">
        {vendorCounts.map(([creator]) => <button key={creator} type="button" title={`查看 ${creator} 的型号`}
          onClick={() => { setVendor(creator); setPanel("picker"); }}>
          <span style={{ background: vendorColors.get(creator) }}/>{creator}
        </button>)}
      </div>}
      <footer className="task-cost-footer">
        <span>{snapshot && <>
          {snapshot.origin === "historical" ? `历史快照 ${snapshot.indexVersion.replace(/^Intelligence Index /, "")}`
            : `API 指数 v${snapshot.indexVersion}`}
          <span className="task-cost-check-time"> · {new Date(snapshot.checkedAt).toLocaleString("zh-CN")}</span>
          {connected && ` · ${autoUpdate ? "自动更新" : "手动更新"}`}
        </>}</span>
        <Button size="sm" variant="quiet" onClick={() => void api.openExternal(aaChart)}>数据来源 · Artificial Analysis <IconArrowUpRight size={13}/></Button>
      </footer>
    </section>
    {visible.length > 0 && <section className="card task-models-list" aria-labelledby="selected-models-title">
      <div className="task-models-heading"><h2 id="selected-models-title">已选模型</h2><span>按发布日期排序</span></div>
      <div className="task-models-scroll">
        <table>
          <thead><tr><th scope="col">型号</th><th scope="col">评测档位</th><th scope="col">发布日期</th>
            <th scope="col">指数</th><th scope="col">USD / 任务</th><th scope="col" aria-label="操作"/></tr></thead>
          <tbody>{visible.map(({ family, configuration }) => <tr key={family.id} data-model={family.id}
            data-profile-id={configuration.id} data-score={configuration.index} data-cost={configuration.costPerTask ?? undefined}
            data-release={family.releaseDate ?? ""} aria-selected={activeModel === family.id}>
            <th scope="row"><button type="button" className="task-model-name" onClick={() => inspect(family.id)}>
              <ModelLogo name={family.name} size={20}/><span><strong>{family.name}</strong><small>{family.creator}</small></span>
            </button></th>
            <td>{family.configurations.length > 1 ? <select className="select task-model-configuration"
              aria-label={`${family.name} 评测档位`} value={configuration.id}
              onChange={event => chooseConfiguration(family.id, event.target.value)}>
              {family.configurations.map(model => <option value={model.id} key={model.id}>{configurationLabel(model)}</option>)}
            </select> : <span className="task-model-single-setting">{configuration.name === family.name ? "—" : configurationLabel(configuration)}</span>}</td>
            <td>{family.releaseDate ?? "—"}</td>
            <td><strong>{configuration.index.toFixed(1)}</strong></td>
            <td>{configuration.costPerTask === null ? "—" : formatCost(configuration.costPerTask)}</td>
            <td><Button size="sm" variant="quiet" aria-label={`移除 ${family.name}`} onClick={() => toggle(family.id)}><IconX size={14}/></Button></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}
    {panel === "chart" && points.length > 0 && <Modal maxWidth={1280} title="Intelligence Index vs. Cost per Task"
      onClose={() => setPanel(null)}>{canvas}</Modal>}
    {panel === "picker" && <ModelPicker families={families} vendor={vendor} vendors={[...vendorColors.keys()].sort()}
      selection={selection} selectedIds={selectedIds} onToggle={toggle} onVendor={setVendor} onClose={() => setPanel(null)}/>}
    {panel === "source" && <DataConnection connected={connected} onClose={() => setPanel(null)}
      onSave={next => { apply(next); setPanel(null); }}/>}
    {detail && <ModelDetail row={detail} onChooseConfiguration={chooseConfiguration} onClose={() => setDetailId(null)}/>}
  </div>;
}

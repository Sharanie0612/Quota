import { useEffect, useId, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { ModelCostChart, chartCreatorColor, type ComparisonPoint } from "../components/ModelCostChart";
import { ModelLogo } from "../components/ModelLogo";
import { IconAdjust, IconArrowUpRight, IconChoose, IconFilter, IconImage, IconLink, IconTable } from "../components/icons";
import { Button, Field, Modal, Notice } from "../components/ui";
import { api, copyText, errText } from "../lib/api";
import { toast } from "../lib/store";
import { reportCsv } from "../lib/usageAnalytics";
import {
  configurationLabel, latestModelCount, matchesModel, modelFamiliesForComparison, restoreComparison,
  selectedComparison, selectedConfiguration, type ModelFamily,
} from "../lib/modelComparison";
import type { TaskCostModel, TaskCostReport } from "../lib/types";
import "./model-ladder.css";

const aaChart = "https://artificialanalysis.ai/models?cost=intelligence-vs-cost-per-task";
const aaKeys = "https://artificialanalysis.ai/api-key-management-redirect";
const chartTitle = "Intelligence Index vs. Cost per Task";
const storageKey = "quota-model-comparison-v1";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const syncTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", hour12: false });
const formatCost = (cost: number) => cost < 0.0001 ? `$${cost.toExponential(3)}` : usd.format(cost);
type ComparedModel = { family: ModelFamily; configuration: TaskCostModel };
type OpenPanel = "picker" | "chart" | "source" | "display" | null;
type ModelView = "chart" | "list";

function readSelection() {
  try { return restoreComparison(localStorage.getItem(storageKey)); }
  catch { return restoreComparison(null); }
}

function saveChartImage(surface: HTMLElement | null) {
  if (!surface) return;
  const chart = surface.querySelector("svg");
  if (!chart) return;
  const clone = chart.cloneNode(true) as SVGSVGElement;
  const styles = ["fill", "stroke", "stroke-width", "stroke-linejoin", "stroke-dasharray", "opacity", "paint-order",
    "font-size", "font-family", "font-weight", "color"];
  const original = [chart, ...chart.querySelectorAll("*")];
  [clone, ...clone.querySelectorAll<SVGElement>("*")].forEach((node, index) => {
    const computed = getComputedStyle(original[index]);
    styles.forEach(property => node.style.setProperty(property, computed.getPropertyValue(property)));
  });
  const { width, height } = chart.viewBox.baseVal;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", getComputedStyle(surface).backgroundColor);
  clone.prepend(background);
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Quota-AA-Intelligence-vs-Cost.svg";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DataConnection({ connected, snapshot, onClose, onSave }: {
  connected: boolean;
  snapshot?: TaskCostReport["snapshot"];
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

  return <Modal title="Artificial Analysis" onClose={() => { if (!busy) onClose(); }} footer={<>
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
      {snapshot && <p className="task-source-version">
        {snapshot.origin === "historical" ? snapshot.indexVersion : `Intelligence Index v${snapshot.indexVersion}`}
      </p>}
      <Field label="API Key">
        <input className="input" type="password" maxLength={512} autoComplete="off" spellCheck={false}
          value={key} disabled={busy} onChange={event => setKey(event.target.value)}
          placeholder={connected ? "输入新密钥以更换" : "粘贴 API Key"} />
      </Field>
      <div className="task-model-actions">
        <Button type="button" variant="quiet" onClick={() => void api.openExternal(aaKeys)}>管理 API Key</Button>
        <Button type="button" variant="quiet" onClick={() => void api.openExternal(aaChart)}>查看 AA 原图</Button>
      </div>
    </form>
  </Modal>;
}

function ModelPicker({ families, vendors, selectedIds, canReset, initialVendor, onToggle, onReset, onClose }: {
  families: ModelFamily[];
  vendors: string[];
  selectedIds: Set<string>;
  canReset: boolean;
  initialVendor: string;
  onToggle: (id: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [vendor, setVendor] = useState(initialVendor);
  const [onlySelected, setOnlySelected] = useState(false);
  const [limit, setLimit] = useState(60);
  const matches = families.filter(family => matchesModel(family, search, vendor)
    && (!onlySelected || selectedIds.has(family.id)));
  return <Modal wide title="选择对比模型" onClose={onClose} footer={<>
    <Button variant="quiet" className="model-picker-reset" disabled={!canReset} onClick={onReset}>恢复最新 {latestModelCount} 个</Button>
    <Button variant="primary" onClick={onClose}>完成</Button>
  </>}>
    <div className="model-picker-controls">
      <input className="input" type="search" aria-label="搜索模型或厂商" placeholder="搜索模型或厂商" value={search}
        onChange={event => { setSearch(event.target.value); setLimit(60); }}/>
      <select className="select" aria-label="模型厂商" value={vendor}
        onChange={event => { setVendor(event.target.value); setLimit(60); }}>
        <option value="">全部厂商</option>
        {vendors.map(creator => <option key={creator} value={creator}>{creator}</option>)}
      </select>
    </div>
    <div className="model-picker-options">
      <label><input type="checkbox" checked={onlySelected} onChange={event => {
        setOnlySelected(event.target.checked);
        setLimit(60);
      }}/> 仅显示已选</label>
      <span role="status">已选 {selectedIds.size} 个型号</span>
    </div>
    <div className="model-picker-list" aria-label="可选模型">
      {matches.slice(0, limit).map(family => {
        const chosen = selectedIds.has(family.id);
        return <label key={family.id} className="model-picker-row">
          <input type="checkbox" checked={chosen} onChange={() => onToggle(family.id)}
            aria-label={`${chosen ? "移除" : "加入"} ${family.name}`}/>
          <span className="model-picker-name">{family.name}</span>
          {family.releaseDate && <time dateTime={family.releaseDate}>{family.releaseDate}</time>}
        </label>;
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
    <dl className="task-model-details">
      <dt>综合指数</dt><dd>{configuration.index.toFixed(1)}</dd>
      <dt>单任务成本</dt><dd>{configuration.costPerTask === null ? "未公布" : formatCost(configuration.costPerTask)}</dd>
      <dt>厂商</dt><dd>{family.creator}</dd>
      {family.releaseDate && <><dt>发布日期</dt><dd>{family.releaseDate}</dd></>}
    </dl>
    {family.configurations.length > 1 && <Field label="评测档位">
      <select className="select" value={configuration.id}
        onChange={event => onChooseConfiguration(family.id, event.target.value)}>
        {family.configurations.map(model => <option key={model.id} value={model.id}>{configurationLabel(model)}</option>)}
      </select>
    </Field>}
  </Modal>;
}

export function AiModelsHub({ autoUpdate }: { autoUpdate: boolean }) {
  const [report, setReport] = useState<TaskCostReport | null>(null);
  const [selection, setSelection] = useState(readSelection);
  const [view, setView] = useState<ModelView>("chart");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [pickerVendor, setPickerVendor] = useState("");
  const [hoveredCreator, setHoveredCreator] = useState<string | null>(null);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [frontierVisible, setFrontierVisible] = useState(true);
  const [quadrantVisible, setQuadrantVisible] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const chartSurface = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!autoUpdate || !report?.connected) return;
    let active = true;
    const check = () => {
      if (document.hidden) return;
      const version = request.current;
      void api.checkTaskCost().catch(failure => {
        if (active && version === request.current) setError(errText(failure));
      });
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [autoUpdate, report?.connected]);

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
  const vendors = useMemo(() => [...new Set(families.map(family => family.creator))].sort(), [families]);
  const visible = useMemo<ComparedModel[]>(() => selected.map(family => ({
    family, configuration: selectedConfiguration(family, selection),
  })), [selected, selection]);
  const points = useMemo<ComparisonPoint[]>(() => visible.flatMap(row => row.configuration.costPerTask === null
    ? [] : [{ ...row, cost: row.configuration.costPerTask }]), [visible]);
  const plottedCreators = useMemo(() => [...new Set([...points].sort((a, b) => a.cost - b.cost).map(row => row.family.creator))], [points]);
  const detail = visible.find(row => row.family.id === detailId);
  const connected = report?.connected ?? false;
  const failure = error || report?.error;
  const canReset = selection.included.length + selection.excluded.length + Object.keys(selection.configurations).length > 0;

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
  }

  function openPicker(creator = "") {
    setPickerVendor(creator);
    setPanel("picker");
  }

  async function exportModels() {
    try {
      const path = await save({ title: "导出模型数据", defaultPath: "Quota-AA-Models.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      await api.exportReportCsv(path, reportCsv(["模型", "厂商", "发布日期", "Intelligence Index", "USD / 任务"],
        visible.map(({ family, configuration }) => [configuration.name, family.creator, family.releaseDate, configuration.index, configuration.costPerTask])));
    } catch (failure) {
      toast(errText(failure), "error");
    }
  }

  const chartOptions = { rows: points, formatCost, selectedId: activeModel, onSelect: inspect,
    labelsVisible, frontierVisible, quadrantVisible, hoveredCreator };

  const emptyChart = visible.length ? "已选模型暂无单任务成本" : "选择模型开始对比";
  const placeholder = !report && !error ? "正在读取模型" : emptyChart;
  return <div className="content-inner visual-model-page" data-task-cost-origin={snapshot?.origin}>
    <header className="task-page-heading">
      <h1>AI 模型</h1>
      <div className="task-model-actions task-source-status">
        {snapshot && <span data-checked-at={snapshot.checkedAt} role="status">
          {snapshot.origin === "api" && connected && !failure ? "AA 已连接" : snapshot.origin === "api" ? "缓存数据" : "历史快照"}
          {" · "}<time dateTime={snapshot.checkedAt}>{syncTime.format(new Date(snapshot.checkedAt))}</time>
        </span>}
        {connected && <Button onClick={() => void refresh()} disabled={busy}>{busy ? "正在更新…" : "立即更新"}</Button>}
        <Button variant={connected ? "quiet" : "default"} onClick={() => setPanel("source")}>
          {connected ? "数据源" : "连接 AA"}
        </Button>
      </div>
    </header>
    {failure && <div className="task-sync-error" role="alert">
      {failure}{snapshot && "。已保留上次数据。"}
    </div>}
    <section className="task-cost-chart" aria-labelledby="task-cost-heading">
      <header className="task-cost-heading">
        <div>
          <h2 id="task-cost-heading">{chartTitle}</h2>
          <p>Artificial Analysis Intelligence Index · Weighted average cost (USD) per Artificial Analysis Intelligence Index task</p>
        </div>
        <div className="task-chart-controls">
          <div className="task-chart-tools">
            <Button className="task-chart-icon" aria-label="复制 AA 原图链接" title="复制 AA 原图链接"
              onClick={() => void copyText(aaChart).then(() => toast("链接已复制"), failure => toast(errText(failure), "error"))}><IconLink size={16}/></Button>
            <Button className="task-chart-icon" aria-label="下载图表" title="下载图表" disabled={view !== "chart" || !points.length}
              onClick={() => saveChartImage(chartSurface.current)}><IconImage size={16}/></Button>
            <Button className="task-chart-icon" aria-label="下载数据" title="下载数据" disabled={!visible.length}
              onClick={() => void exportModels()}><IconTable size={16}/></Button>
          </div>
          <div className="task-chart-tools task-comparison-status">
            <Button className="task-model-count" aria-label="选择模型" aria-haspopup="dialog" disabled={!families.length} onClick={() => openPicker()}>
              <span role="status" data-selected={visible.length} data-plotted={points.length} data-available={families.length}>
                {visible.length} of {families.length} models
              </span>
              <IconChoose size={16}/>
            </Button>
            <Button className="task-chart-icon" aria-label="筛选模型" title="筛选模型" disabled={!families.length}
              onClick={() => openPicker()}><IconFilter size={16}/></Button>
            <Button className="task-chart-icon" aria-label="图表显示设置" title="图表显示设置"
              onClick={() => setPanel("display")}><IconAdjust size={16}/></Button>
          </div>
        </div>
      </header>
      {view === "chart" ? <div className="task-plot-panel" role="region" aria-label="图表">
        {points.length ? <>
          <div className="task-plot-key">
            <button type="button" aria-pressed={quadrantVisible} onClick={() => setQuadrantVisible(value => !value)}>
              <i className="task-key-area"/>Most attractive quadrant
            </button>
            <button type="button" aria-pressed={frontierVisible} onClick={() => setFrontierVisible(value => !value)}>
              <i className="task-key-line"/>Pareto line
            </button>
          </div>
          <div className="task-creator-legend" aria-label="模型厂商">
            {plottedCreators.map(creator => <button type="button" key={creator}
              onMouseEnter={() => setHoveredCreator(creator)} onMouseLeave={() => setHoveredCreator(null)}
              onFocus={() => setHoveredCreator(creator)} onBlur={() => setHoveredCreator(null)}
              onClick={() => openPicker(creator)}>
              <i style={{ background: chartCreatorColor(creator) }}/>{creator}
            </button>)}
          </div>
          <div className="task-plot-source"><Button variant="quiet" onClick={() => void api.openExternal(aaChart)}>Artificial Analysis</Button></div>
          <ModelCostChart {...chartOptions} surfaceRef={chartSurface}/>
        </> : <p className="task-chart-empty">{placeholder}</p>}
      </div> : <div className="task-models-list" role="region" aria-label="列表">
        {visible.length ? <table>
          <thead><tr><th scope="col">型号</th><th scope="col">综合指数</th><th scope="col">单任务成本</th></tr></thead>
          <tbody>{visible.map(({ family, configuration }) => <tr key={family.id} data-model={family.id}
            data-profile-id={configuration.id} data-score={configuration.index} data-cost={configuration.costPerTask ?? undefined}
            data-release={family.releaseDate ?? ""}>
            <th scope="row"><button type="button" className="task-model-name" onClick={() => inspect(family.id)}>
              {family.name}
            </button></th>
            <td>{configuration.index.toFixed(1)}</td>
            <td>{configuration.costPerTask === null ? "未公布" : formatCost(configuration.costPerTask)}</td>
          </tr>)}</tbody>
        </table> : <p className="task-chart-empty">{placeholder}</p>}
      </div>}
    </section>
    {panel === "chart" && points.length > 0 && <Modal key="model-chart" maxWidth={1280} title="模型图表"
      onClose={() => setPanel(null)}><ModelCostChart {...chartOptions}/></Modal>}
    {panel === "display" && <Modal key="model-display" title="图表显示设置" onClose={() => setPanel(null)}>
      <div className="task-display-options">
        <label><input type="checkbox" checked={labelsVisible} onChange={event => setLabelsVisible(event.target.checked)}/>显示型号标签</label>
        <label><input type="checkbox" checked={quadrantVisible} onChange={event => setQuadrantVisible(event.target.checked)}/>显示优选区域</label>
        <label><input type="checkbox" checked={frontierVisible} onChange={event => setFrontierVisible(event.target.checked)}/>显示帕累托前沿</label>
      </div>
      <div className="task-model-actions task-display-actions">
        <Button onClick={() => { setView(view === "chart" ? "list" : "chart"); setPanel(null); }}>{view === "chart" ? "列表" : "图表"}</Button>
        <Button disabled={!points.length} onClick={() => setPanel("chart")}><IconArrowUpRight size={15}/>放大图表</Button>
      </div>
    </Modal>}
    {panel === "picker" && <ModelPicker families={families} vendors={vendors} selectedIds={selectedIds} initialVendor={pickerVendor}
      canReset={canReset} onToggle={toggle} onReset={() => setSelection(restoreComparison(null))} onClose={() => setPanel(null)}/>}
    {panel === "source" && <DataConnection connected={connected} snapshot={snapshot} onClose={() => setPanel(null)}
      onSave={next => { apply(next); setPanel(null); }}/>}
    {detail && <ModelDetail row={detail} onChooseConfiguration={chooseConfiguration} onClose={() => setDetailId(null)}/>}
  </div>;
}

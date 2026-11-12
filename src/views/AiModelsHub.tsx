import { useEffect, useId, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { LadderCanvas } from "../components/LadderCanvas";
import { IconRefresh, IconSearch } from "../components/icons";
import { ModelLogo } from "../components/ModelLogo";
import { Button, EmptyState, Field, Modal, Notice } from "../components/ui";
import { api, errText } from "../lib/api";
import type { TaskCostModel, TaskCostReport } from "../lib/types";
import "./model-ladder.css";

const aaChart = "https://artificialanalysis.ai/models?cost=intelligence-vs-cost-per-task";
const aaKeys = "https://artificialanalysis.ai/api-key-management-redirect";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const formatCost = (cost: number) => cost < 0.0001 ? `$${cost.toExponential(3)}` : usd.format(cost);

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

function ModelDetail({ model, onClose }: { model: TaskCostModel; onClose: () => void }) {
  return <Modal title={<span className="task-model-title"><ModelLogo name={model.name} size={25} />{model.name}</span>}
    onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
    <dl className="task-model-details">
      <dt>厂商</dt><dd>{model.creator}</dd>
      {model.releaseDate && <><dt>发布日期</dt><dd>{model.releaseDate}</dd></>}
      <dt>Intelligence Index</dt><dd>{model.index.toFixed(1)}</dd>
      <dt>Cost per Task</dt><dd>{model.costPerTask === null ? "暂无可比成本" : formatCost(model.costPerTask)}</dd>
    </dl>
  </Modal>;
}

export function AiModelsHub({ autoUpdate }: { autoUpdate: boolean }) {
  const [report, setReport] = useState<TaskCostReport | null>(null);
  const [search, setSearch] = useState("");
  const [vendor, setVendor] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const [connection, setConnection] = useState(false);
  const [expanded, setExpanded] = useState(false);
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

  const snapshot = report?.snapshot;
  const { vendors, selectedVendor, points, unpriced } = useMemo(() => {
    const models = snapshot?.models ?? [];
    const vendors = [...new Set(models.map(model => model.creator))].sort();
    const selectedVendor = vendors.includes(vendor) ? vendor : "";
    const query = search.trim().toLowerCase();
    const visible = models.filter(model => (!selectedVendor || model.creator === selectedVendor)
      && (!query || `${model.name} ${model.creator}`.toLowerCase().includes(query)));
    const points = visible.flatMap(model => model.costPerTask === null ? [] : [{
      id: model.id, name: model.name, detail: model.creator, cost: model.costPerTask, score: model.index,
    }]);
    const unpriced = visible.filter(model => model.costPerTask === null).sort((a, b) => b.index - a.index || a.name.localeCompare(b.name));
    return { vendors, selectedVendor, points, unpriced };
  }, [snapshot, search, vendor]);

  const model = snapshot?.models.find(model => model.id === modelId);
  const connected = report?.connected ?? false;
  const canvas = <LadderCanvas points={points} label="AA 综合指数与单任务成本散点图" showFrontier
    xLabel="单任务成本（USD · 对数刻度）" yLabel="Intelligence Index" costLabel={formatCost}
    selectedId={modelId} onSelect={id => { setExpanded(false); setModelId(id); }} />;
  const failure = error || report?.error;

  return <div className="content-inner visual-model-page" data-task-cost-origin={snapshot?.origin}>
    <header className="visual-model-toolbar">
      <h1>AI 模型</h1>
      <div className="visual-model-actions">
        <Button size="sm" variant="quiet" onClick={() => setConnection(true)}>{connected ? "管理数据源" : "连接数据源"}</Button>
        {connected && <Button size="sm" disabled={busy} onClick={() => void refresh()}>
          <IconRefresh size={14} className={busy ? "spin" : ""} />{busy ? "更新中…" : "立即更新"}
        </Button>}
      </div>
    </header>
    {failure && <Notice tone="warn">{failure}{snapshot && "。正在显示上次有效数据。"}</Notice>}
    <section className="card task-cost-chart" aria-labelledby="task-cost-title">
      <div className="task-cost-heading">
        <div>
          <h2 id="task-cost-title">Intelligence Index vs. Cost per Task</h2>
          <p>Artificial Analysis 综合指数与加权单任务成本</p>
        </div>
        {points.length > 0 && <Button size="sm" onClick={() => setExpanded(true)}>展开图表</Button>}
      </div>
      {snapshot && <div className="visual-model-filters">
        <div className="search"><IconSearch size={15} /><input className="input" aria-label="搜索模型或厂商"
          placeholder="搜索模型或厂商" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <select className="select" aria-label="模型厂商" value={selectedVendor} onChange={event => setVendor(event.target.value)}>
          <option value="">全部厂商</option>
          {vendors.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>}
      {points.length > 0 ? !expanded && canvas : <EmptyState icon={<IconSearch size={24} />}
        title={!report && !error ? "正在读取模型数据…" : snapshot ? "当前筛选暂无可绘制的成本" : "暂无单任务成本数据"}
        desc={!snapshot && report ? "连接 Artificial Analysis 数据源，或打开 AA 原图查看最新评测。" : undefined} />}
      <footer className="task-cost-footer">
        <span role="status">{snapshot ? <>
          {points.length} 个配置 · {snapshot.origin === "historical"
            ? `历史快照 ${snapshot.indexVersion.replace(/^Intelligence Index /, "")}` : `API 指数 v${snapshot.indexVersion}`}
          <span className="task-cost-check-time"> · {new Date(snapshot.checkedAt).toLocaleString("zh-CN")}</span>
          {connected && ` · ${autoUpdate ? "自动更新" : "手动更新"}`}
        </> : null}</span>
        <Button size="sm" variant="quiet" onClick={() => void api.openExternal(aaChart)}>来源 · Artificial Analysis ↗</Button>
      </footer>
      {unpriced.length > 0 && <details className="task-cost-unpriced">
        <summary>{unpriced.length} 个有指数但暂无可比成本的配置</summary>
        <div className="ladder-score-list">{unpriced.map(model => <button className="ladder-score-row" key={model.id}
          data-profile-id={model.id} data-score={model.index} onClick={() => setModelId(model.id)}>
          <ModelLogo name={model.name} size={20} /><span>{model.name}<small>{model.creator}</small></span><b>{model.index.toFixed(1)}</b>
        </button>)}</div>
      </details>}
    </section>
    {expanded && points.length > 0 && <Modal wide title="放大的模型天梯" onClose={() => setExpanded(false)}>{canvas}</Modal>}
    {model && <ModelDetail model={model} onClose={() => setModelId(null)} />}
    {connection && <DataConnection connected={connected} onClose={() => setConnection(false)} onSave={next => {
      apply(next);
      setConnection(false);
    }} />}
  </div>;
}

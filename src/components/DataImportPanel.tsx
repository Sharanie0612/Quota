import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText } from "../lib/api";
import { toast } from "../lib/store";
import type { ImportPreview, ImportSelection } from "../lib/types";
import { Button, Notice } from "./ui";

const providerNames: Record<string, string> = {
  deepseek: "DeepSeek", moonshot: "Kimi", zhipu: "智谱 GLM",
  mimo: "小米 MiMo 按量", "mimo-plan": "小米 MiMo 订阅", custom: "ChatGPT 订阅",
};

export function DataImportPanel({ onClose, onBusyChange }: {onClose: () => void; onBusyChange: (busy: boolean) => void}) {
  const [path, setPath] = useState("");
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selection, setSelection] = useState<ImportSelection>({accountIds: [], credentials: false, settings: false, catalog: false, balanceHistory: false, activity: false});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changeBusy = (value: boolean) => { setBusy(value); onBusyChange(value); };
  const pickFile = async () => {
    try {
      const picked = await open({title: "选择 Quota 数据或加密备份", multiple: false, filters: [{name: "Quota 迁移文件", extensions: ["json"]}]});
      if (typeof picked === "string") { setPath(picked); setPreview(null); setError(""); }
    } catch (e) { setError(errText(e)); }
  };
  const readPreview = async () => {
    if (!path || busy) return;
    changeBusy(true); setError(""); setPreview(null);
    try {
      const result = await api.previewImport(path, password);
      setPreview(result);
      setSelection({accountIds: result.accounts.map(a => a.id), credentials: result.credentials, settings: result.settings,
        catalog: result.catalog, balanceHistory: result.balanceHistory, activity: result.activity});
    } catch (e) { setError(errText(e)); }
    finally { changeBusy(false); }
  };
  const importSelected = async () => {
    if (!preview || busy) return;
    changeBusy(true); setError("");
    try {
      const chosen = {...selection, credentials: selection.credentials && selection.accountIds.length > 0};
      const summary = await api.importData(path, password, preview.fingerprint, chosen);
      toast(`${summary}，正在重新加载…`);
      setPassword("");
      setTimeout(() => window.location.reload(), 900);
    } catch (e) { setError(errText(e)); changeBusy(false); }
  };
  const chosen = selection.accountIds.length > 0 || selection.settings || selection.catalog || selection.balanceHistory || selection.activity;
  const toggleAccount = (id: string) => setSelection(current => ({...current, accountIds: current.accountIds.includes(id)
    ? current.accountIds.filter(item => item !== id) : [...current.accountIds, id]}));
  const sections = [
    {key: "settings" as const, available: preview?.settings, label: "应用设置"},
    {key: "catalog" as const, available: preview?.catalog, label: `模型资料与隐藏列表（${preview?.catalogCount ?? 0} 项）`},
    {key: "balanceHistory" as const, available: preview?.balanceHistory, label: `余额历史（${preview?.historyCount ?? 0} 条）`},
    {key: "activity" as const, available: preview?.activity, label: `Token 活动（${preview?.activityCount ?? 0} 条，自动去重）`},
  ];
  return <div className="backup-panel data-import-panel">
    <h3>选择导入内容</h3>
    <div className="tag-row"><Button size="sm" onClick={() => void pickFile()} disabled={busy}>选择文件</Button><span className="hint migration-path">{path || "支持普通 JSON、加密备份及旧版本导出"}</span></div>
    <div className="backup-fields">
      <input className="input" type="password" aria-label="迁移文件密码" autoComplete="off" placeholder="加密备份密码；普通 JSON 留空" value={password} disabled={busy}
        onChange={e => {setPassword(e.target.value); setPreview(null);}} onKeyDown={e => {if (e.key === "Enter") void readPreview();}} />
      <Button size="sm" disabled={busy || !path} onClick={() => void readPreview()}>{busy ? "处理中…" : "读取内容"}</Button>
    </div>
    {preview && <>
      <Notice tone="info">{preview.encrypted ? "加密备份可迁移账户及密钥，在 macOS 上恢复到系统钥匙串。" : "普通 JSON 可恢复账户资料，不含登录信息；自动查询账户需在新设备补充密钥或重新连接。"}
        <div>按账户 ID 合并；同 ID 的已选资料会更新，其他账户及未选内容保留。余额历史和 Token 活动合并去重。</div>
      </Notice>
      {preview.accounts.length > 0 && <fieldset className="migration-choices" disabled={busy}>
        <legend>账户（{selection.accountIds.length} / {preview.accounts.length}）</legend>
        <label><input type="checkbox" checked={selection.accountIds.length === preview.accounts.length} onChange={e => setSelection({...selection, accountIds: e.target.checked ? preview.accounts.map(a => a.id) : []})} />全部账户</label>
        {preview.accounts.map(account => <label key={account.id}><input type="checkbox" checked={selection.accountIds.includes(account.id)} onChange={() => toggleAccount(account.id)} /><span>{account.label}<small className="hint"> · {providerNames[account.provider] ?? "其他平台"}</small></span></label>)}
      </fieldset>}
      {preview.credentials && <label className="migration-option"><input type="checkbox" checked={selection.credentials && selection.accountIds.length > 0} disabled={busy || !selection.accountIds.length}
        onChange={e => setSelection({...selection, credentials: e.target.checked})} />同时导入所选账户的 API Key 和小米登录信息</label>}
      <fieldset className="migration-choices" disabled={busy}><legend>其他内容</legend>
        {sections.map(section => <label key={section.key}><input type="checkbox" disabled={!section.available} checked={selection[section.key] && !!section.available}
          onChange={e => setSelection({...selection, [section.key]: e.target.checked})} />{section.label}{!section.available ? " · 文件未包含" : ""}</label>)}
      </fieldset>
      <p className="hint">选择账户时，余额历史只导入这些账户；只选余额历史时，仅合并本机已有账户的记录。ChatGPT 迁移后需连接新设备的 Codex 登录；共享目录和采集路径需在新设备重新选择。</p>
      <Button variant="primary" size="sm" disabled={busy || !chosen} onClick={() => void importSelected()}>导入所选内容</Button>
    </>}
    {error && <Notice tone="warn">{error}</Notice>}
    <Button size="sm" variant="quiet" disabled={busy} onClick={onClose}>取消</Button>
  </div>;
}

import { useEffect, useState } from "react";
import { api, errText } from "../lib/api";
import type { ActivityStorage } from "../lib/types";
import { Button, Notice } from "./ui";

const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
export function ActivityStoragePanel({ syncDir }: { syncDir: string }) {
  const [info, setInfo] = useState<ActivityStorage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [readers, setReaders] = useState<{device:string;version:string|null;compressed:boolean|null}[]>([]);
  useEffect(() => {
    let live = true;
    setInfo(null); setError(""); setResult("");
    setReaders([]);
    if (syncDir) void api.getActivityStorage().then(next => { if (live) setInfo(next); }).catch(e => { if (live) setError(errText(e)); });
    if (syncDir) void api.getActivityReaders().then(next => {if(live)setReaders(next);}).catch(e=>{if(live)setError(errText(e));});
    return () => { live = false; };
  }, [syncDir]);
  const optimize = async () => {
    setBusy(true); setError(""); setResult("");
    try {
      const next = await api.optimizeActivityStorage();
      setInfo(next.after);
      const saved = Math.max(0, next.before.bytes - next.after.bytes);
      setResult(`已无损压缩 ${next.converted} 个本机旧文件，节省 ${bytes(saved)}；共享统计文件现在占用 ${bytes(next.after.bytes)}。`);
    } catch (e) { setError(errText(e)); await api.getActivityStorage().then(setInfo).catch(() => undefined); }
    finally { setBusy(false); }
  };
  const rebuild = async () => {
    setBusy(true); setError(""); setResult("");
    try {
      await api.rebuildActivitySync();
      const report=await api.getActivity();
      setResult("已重新读取共享目录；原有用量保留，重复记录按事件 ID 去重。");
      if(report.errors.length)setError(report.errors.join("；"));
      setReaders(await api.getActivityReaders());
      setInfo(await api.getActivityStorage());
    } catch(e){setError(errText(e));}finally{setBusy(false);}
  };
  if (!syncDir) return null;
  return <div className="activity-storage-panel">
    <div className="setting-row"><div className="txt"><b>同步数据占用</b><span>{info ? `${bytes(info.bytes)} · ${info.files.toLocaleString()} 个文件` : error || "正在检查…"}</span></div><Button size="sm" disabled={busy || !info || info.legacyCompatibility || !info.ownLegacyFiles} onClick={() => void optimize()}>{busy ? "处理中…" : "节省空间"}</Button></div>
    <p className="hint">{info?.legacyCompatibility?'为兼容旧设备，暂时保留较大的副本。全部设备更新并同步后，才能安全节省空间。':'优化前会校验数据，保留完整用量；只处理本机创建的文件。'}</p>
    {readers.some(r=>r.compressed!==true) && <p className="hint">{readers.filter(r=>r.compressed!==true).length} 台设备尚未确认更新。</p>}
    <div className="setting-row"><div className="txt"><b>另一台电脑缺少用量</b><span>重新读取共享数据并恢复兼容副本，不清空本机统计。</span></div><Button size="sm" disabled={busy} onClick={()=>void rebuild()}>{busy?'处理中…':'修复漏同步'}</Button></div>
    {result && <Notice>{result}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
  </div>;
}

import { useCallback, useEffect, useState } from "react";
import { api, errText, events } from "../lib/api";
import type { AccountSyncCandidate, AccountView } from "../lib/types";
import { Button, Notice } from "./ui";

export function AccountSyncPanel() {
  const [rows, setRows] = useState<AccountSyncCandidate[]>([]);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [targets, setTargets] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { const [candidates,local] = await Promise.all([api.getAccountSyncCandidates(),api.listAccounts()]);
      setRows(candidates); setAccounts(local); setError(""); }
    catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void reload(); const un = events.onAccountsUpdated(() => void reload());
    return () => { void un.then(f => f()).catch(() => undefined); }; }, [reload]);
  const resolve = async (id: string, target: string | null) => {
    if (busy) return; setBusy(true);
    try { await api.resolveAccountSync(id,target); await reload(); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };
  if (!rows.length && !error) return null;
  return <details className="card section">
    <summary>账户关联与额外账户{rows.length ? "（" + rows.length + "）" : ""}</summary>
    <p>同一账号只需关联一次，其他电脑会沿用此决定。不同账号请保留为独立账户；登录信息留在本机。</p>
    {error && <Notice tone="error">{error}</Notice>}
    {rows.map(row => {
      const choices = accounts.filter(a => a.provider === row.provider && a.id !== row.id);
      return <div key={row.id} className="section">
        <div className="setting-row"><div className="txt"><b>{row.label}</b><span>{row.pending ? "来自其他设备" : "本机账户"}</span></div>
          <Button size="sm" disabled={busy} onClick={() => void resolve(row.id,null)}>保留为独立账户</Button></div>
        {choices.length > 0 && <div className="setting-row">
          <select className="select" style={{flex:1,minWidth:0,width:"auto"}} aria-label={"将 " + row.label + " 关联到"} value={targets[row.id] ?? ""}
            disabled={busy} onChange={e => setTargets({...targets,[row.id]:e.target.value})}>
            <option value="">选择同一个账号的本机账户</option>
            {choices.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <Button size="sm" disabled={busy || !targets[row.id]} onClick={() => void resolve(row.id,targets[row.id])}>关联为同一账户</Button>
        </div>}
      </div>;
    })}
  </details>;
}

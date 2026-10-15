import { useCallback, useEffect, useState } from "react";
import { api, errText, events } from "../lib/api";
import type { AccountSyncCandidate } from "../lib/types";
import { Button, Notice } from "./ui";

// Extra remote accounts are optional, not a blocking merge workflow.
export function AccountSyncPanel() {
  const [rows, setRows] = useState<AccountSyncCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { setRows((await api.getAccountSyncCandidates()).filter(row => row.pending)); setError(""); }
    catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => {
    void reload();
    const un = events.onAccountsUpdated(() => void reload());
    return () => { void un.then(f => f()); };
  }, [reload]);
  const show = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try { await api.resolveAccountSync(id, null); await reload(); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };
  if (!rows.length && !error) return null;
  return <details className="card section">
    <summary>其他设备的额外账户{rows.length ? `（${rows.length}）` : ""}</summary>
    <p>本机账户与登录信息已保留。若需要显示另一个独立账号，可在这里添加。</p>
    {error && <Notice tone="error">{error}</Notice>}
    {rows.map(row => <div key={row.id} className="setting-row">
      <div className="txt"><b>{row.label}</b><span>来自其他设备</span></div>
      <Button size="sm" disabled={busy} onClick={() => void show(row.id)}>显示此账户</Button>
    </div>)}
  </details>;
}

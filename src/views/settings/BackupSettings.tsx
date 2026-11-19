import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Button, Notice } from "../../components/ui";
import { IconGear } from "../../components/icons";
import { DataImportPanel } from "../../components/DataImportPanel";
import { api, errText } from "../../lib/api";
import { toast } from "../../lib/store";

type BackupPanel = null | "export";

/** 备份文件的默认名（带日期，避免覆盖上一次的备份） */
function backupFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Quota备份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
}

export function BackupSettings() {
  const [backupPanel, setBackupPanel] = useState<BackupPanel>(null);
  const [backupPw, setBackupPw] = useState("");
  const [backupPw2, setBackupPw2] = useState("");
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dataExport, setDataExport] = useState<{path:string; summary:string} | null>(null);
  const closeBackupPanel = () => {
    setBackupPanel(null);
    setBackupPw("");
    setBackupPw2("");
    setIncludeCredentials(false);
  };

  /** 导出加密备份：选保存位置 → Rust 端打包 config + 资料 + 凭据并加密写入 */
  const doExport = async () => {
    if (backupBusy || dataBusy) return;
    if (!backupPw) {
      toast("先输入备份密码", "error");
      return;
    }
    if (backupPw !== backupPw2) {
      toast("两次输入的密码不一致", "error");
      return;
    }
    setBackupBusy(true);
    try {
      const path = await save({
        title: "导出加密备份",
        defaultPath: backupFileName(),
        filters: [{ name: "Quota 加密备份", extensions: ["json"] }],
      });
      if (!path) return;
      await api.exportBackup(backupPw, path);
      toast("备份已导出，请妥善保管文件与密码");
      closeBackupPanel();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBackupBusy(false);
    }
  };

  const doDataExport = async () => {
    if (backupBusy || dataBusy) return;
    setDataBusy(true);
    try {
      const stamp = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const name = `Quota数据-${stamp.getFullYear()}${pad(stamp.getMonth()+1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.json`;
      const path = await save({ title:"导出 Quota 数据", defaultPath:name, filters:[{name:"Quota 数据（JSON）",extensions:["json"]}] });
      if (!path) return;
      const summary = await api.exportData(path);
      setDataExport({path,summary});
      toast(summary);
      closeBackupPanel();
    } catch (e) { toast(errText(e), "error"); }
    finally { setDataBusy(false); }
  };
  return (
    <div className="card section">
      <h2>
        <IconGear size={14} /> 备份与迁移
      </h2>
      {dataExport && <Notice autoDismiss><b>{dataExport.summary}</b><div style={{overflowWrap:"anywhere"}}>保存位置：{dataExport.path}</div></Notice>}
      <div className="setting-row">
        <div className="txt">
          <b>导出备份</b>
          <span>默认不含登录信息</span>
        </div>
        <Button
          size="sm"
          disabled={dataBusy || backupBusy}
          onClick={() => { setImportOpen(false); setBackupPanel(backupPanel === "export" ? null : "export"); }}
        >
          导出
        </Button>
      </div>
      {backupPanel && <label className="migration-option"><input type="checkbox" checked={includeCredentials} disabled={backupBusy || dataBusy} onChange={e=>setIncludeCredentials(e.target.checked)}/>包含登录信息（需要加密密码）</label>}
      {backupPanel && !includeCredentials && <div className="backup-panel"><Button variant="primary" size="sm" disabled={dataBusy || backupBusy} onClick={()=>void doDataExport()}>{dataBusy?"处理中…":"保存备份"}</Button><Button size="sm" variant="quiet" onClick={closeBackupPanel}>取消</Button></div>}
      <div className="setting-row">
        <div className="txt">
          <b>导入数据 / 迁移账户</b>
          <span>选择需要恢复的内容，未选内容保留</span>
        </div>
        <Button
          size="sm"
          disabled={dataBusy || backupBusy}
          onClick={() => { closeBackupPanel(); setImportOpen(!importOpen); }}
        >
          导入
        </Button>
      </div>
      {importOpen ? <DataImportPanel onClose={() => setImportOpen(false)} onBusyChange={setDataBusy} /> : null}
      {backupPanel && includeCredentials ? (
        <div className="backup-panel">
          <div className="backup-fields">
            <input
              className="input"
              type="password"
              placeholder="备份密码"
              aria-label="备份密码"
              autoComplete="new-password"
              value={backupPw}
              onChange={(e) => setBackupPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !backupBusy && !dataBusy && void doExport()}
            />
            {backupPanel === "export" ? (
              <input
                className="input"
                type="password"
                placeholder="再输入一次确认"
                aria-label="确认备份密码"
                autoComplete="new-password"
                value={backupPw2}
                onChange={(e) => setBackupPw2(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !backupBusy && !dataBusy && void doExport()}
              />
            ) : null}
            <Button
              variant="primary"
              size="sm"
              disabled={backupBusy || dataBusy}
              onClick={() => void doExport()}
            >
              {backupBusy ? "处理中…" : "导出备份"}
            </Button>
            <Button size="sm" variant="quiet" onClick={closeBackupPanel}>
              取消
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

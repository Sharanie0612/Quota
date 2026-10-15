import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { IconClock, IconGear, IconInfo, IconSpark } from "../components/icons";
import { Button, Modal, Notice, Seg, Switch } from "../components/ui";
import { CrossDeviceSyncPanel } from "../components/CrossDeviceSyncPanel";

import { DataImportPanel } from "../components/DataImportPanel";
import { api, copyText, errText } from "../lib/api";
import { toast } from "../lib/store";
import type { ActivityOptions, AppInfo, Settings } from "../lib/types";

const INTERVALS = [
  { value: "10", label: "10 分钟" },
  { value: "30", label: "30 分钟" },
  { value: "60", label: "1 小时" },
  { value: "180", label: "3 小时" },
];

type BackupPanel = null | "export";

/** 备份文件的默认名（带日期，避免覆盖上一次的备份） */
function backupFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Quota备份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
}

export function SettingsView({
  settings,
  onUpdate,
  info,
}: {
  settings: Settings | null;
  onUpdate: (s: Settings) => void;
  info: AppInfo | null;
}) {
  const [customInterval, setCustomInterval] = useState<string | null>(null);
  const [backupPanel, setBackupPanel] = useState<BackupPanel>(null);
  const [backupPw, setBackupPw] = useState("");
  const [backupPw2, setBackupPw2] = useState("");
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dataExport, setDataExport] = useState<{path:string; summary:string} | null>(null);
  const [activity, setActivity] = useState<ActivityOptions | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  useEffect(() => { void api.getActivityOptions().then(setActivity).catch(e => setActivityError(errText(e))); }, []);
  const updateActivity = async (patch: Partial<ActivityOptions>):Promise<boolean> => {
    if (!activity || activityBusy) return false;
    setActivityBusy(true);
    try {
      const current = await api.getActivityOptions();
      const next = {...current, ...patch};
      await api.saveActivityOptions(next);setActivity(next);setActivityError("");return true;
    } catch(e) {setActivityError(errText(e));return false;}
    finally {setActivityBusy(false);}
  };
  if (!settings) {
    return (
      <div className="content-inner">
        <div className="card section">
          <div className="skeleton" style={{ height: 18, width: 160 }} />
        </div>
      </div>
    );
  }

  const set = (patch: Partial<Settings>) => onUpdate({ ...settings, ...patch });

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

  const isPreset = customInterval === null && INTERVALS.some((i) => Number(i.value) === settings.refreshIntervalMinutes);
  const intervalValue = customInterval ?? String(settings.refreshIntervalMinutes);
  const validInterval = intervalValue.trim() !== "" && Number.isInteger(Number(intervalValue))
    && Number(intervalValue) >= 1 && Number(intervalValue) <= 1440;

  return (
    <div className="content-inner settings-page">
      <CrossDeviceSyncPanel />
      <div className="card section">
        <h2><IconClock size={14} /> Token 活动</h2>
        <div className="setting-row"><div className="txt"><b>自动采集</b><span>Quota 运行时更新本机用量</span></div><Switch checked={activity?.autoCollect ?? false} disabled={!activity || activityBusy} onChange={value=>void updateActivity({autoCollect:value})} label="自动采集 Token 活动" /></div>
        <div className="setting-row"><div className="txt"><b>采集频率</b></div><select className="select" aria-label="Token 采集频率" disabled={!activity || activityBusy} value={activity?.collectIntervalSeconds ?? 30} onChange={e=>void updateActivity({collectIntervalSeconds:Number(e.target.value)})}>{[5,15,30,60,300,900].map(value=><option key={value} value={value}>{value<60?`${value} 秒`:`${value/60} 分钟`}</option>)}{activity && ![5,15,30,60,300,900].includes(activity.collectIntervalSeconds) && <option value={activity.collectIntervalSeconds}>{activity.collectIntervalSeconds} 秒</option>}</select></div>
        {activityError && <Notice tone="warn">{activityError}</Notice>}
      </div>
      <div className="card section">
        <h2>
          <IconClock size={14} /> 余额刷新
        </h2>
        <div className="setting-row">
          <div className="txt">
            <b>自动刷新</b>
            <span>启动时始终刷新一次</span>
          </div>
          <Switch
            checked={settings.autoRefresh}
            onChange={(v) => set({ autoRefresh: v })}
            label="自动刷新"
          />
        </div>
        <div className="setting-row">
          <div className="txt">
            <b>刷新间隔</b>
          </div>
          <Seg
            value={isPreset ? String(settings.refreshIntervalMinutes) : "custom"}
            options={[...INTERVALS, { value: "custom", label: "自定义" }]}
            onChange={(v) => {
              if (v === "custom") {
                setCustomInterval(String(settings.refreshIntervalMinutes));
                return;
              }
              setCustomInterval(null);
              set({ refreshIntervalMinutes: Number(v) });
            }}
          />
        </div>
        {!isPreset ? (
          <div className="setting-row">
            <div className="txt">
              <b>自定义间隔（分钟）</b>
              <span>{validInterval ? "1–1440 分钟" : "请输入 1–1440 的整数"}</span>
            </div>
            <input
              className="input"
              style={{ width: 110 }}
              type="number"
              min={1}
              max={1440}
              value={intervalValue}
              aria-label="自定义刷新间隔（分钟）"
              aria-invalid={!validInterval}
              onChange={(e) => {
                setCustomInterval(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value.trim() && Number.isInteger(n) && n >= 1 && n <= 1440) set({ refreshIntervalMinutes: n });
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="card section">
        <h2>
          <IconSpark size={14} /> 余额与额度提醒
        </h2>
        <div className="setting-row">
          <div className="txt">
            <b>发送系统通知</b>
            <span>余额或订阅额度不足时提醒</span>
          </div>
          <Switch
            checked={settings.notifyLowBalance}
            onChange={(v) => set({ notifyLowBalance: v })}
            label="低余额通知"
          />
        </div>
        <div className="setting-row">
          <div className="txt">
            <b>新增账户的默认阈值</b>
            <span>金额账户用原币种；ChatGPT 用剩余百分比</span>
          </div>
          <input
            className="input"
            style={{ width: 110 }}
            type="number"
            min={0}
            step="1"
            value={settings.defaultLowThreshold}
            aria-label="新增账户的默认阈值"
            onChange={(e) => set({ defaultLowThreshold: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="card section">
        <h2>提醒与天梯</h2>
        <div className="setting-row"><div className="txt"><b>余额增加提示</b><span>检测到充值时提示</span></div><Switch checked={settings.notifyRecharge} onChange={(v) => set({ notifyRecharge: v })} label="余额增加提示" /></div>
        <div className="setting-row"><div className="txt"><b>自动更新模型天梯</b><span>每天检查排名与官方价格，失败保留上次核实结果</span></div><Switch checked={settings.ladderAutoUpdate} onChange={(v) => set({ ladderAutoUpdate: v })} label="天梯自动更新" /></div>
      </div>
      <div className="card section">
        <h2>
          <IconGear size={14} /> 窗口与托盘
        </h2>
        <div className="setting-row">
          <div className="txt">
            <b>关闭主窗口时最小化到托盘</b>
            <span>点击托盘图标即可重新打开</span>
          </div>
          <Switch
            checked={settings.closeToTray}
            onChange={(v) => set({ closeToTray: v })}
            label="关闭到托盘"
          />
        </div>
        <div className="setting-row"><div className="txt"><b>托盘提醒角标</b><span>额度不足时显示红点</span></div><Switch checked={settings.trayAlert} onChange={(v) => set({ trayAlert: v })} label="托盘角标" /></div>
      </div>

      <div className="card section">
        <h2>
          <IconSpark size={14} /> 模型资料库
        </h2>
        <div className="setting-row">
          <div className="txt">
            <b>恢复内置资料</b>
            <span>清空你对模型卡片的全部本地修改</span>
          </div>
          <Button
            size="sm"
            onClick={() => setConfirmReset(true)}
          >
            恢复
          </Button>
        </div>
      </div>

      <div className="card section">
        <h2>
          <IconGear size={14} /> 备份与迁移
        </h2>
        {dataExport && <Notice><b>{dataExport.summary}</b><div style={{overflowWrap:"anywhere"}}>保存位置：{dataExport.path}</div></Notice>}
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

      <div className="card section">
        <h2>
          <IconInfo size={14} /> 数据与安全
        </h2>
        <div className="setting-row">
          <div className="txt">
            <b>API Key 存放位置</b>
            <span>系统凭据库（Windows 凭据管理器 / macOS 钥匙串）</span>
          </div>
        </div>
        <div className="setting-row">
          <div className="txt">
            <b>配置文件目录</b>
            <div className="mono" style={{ marginTop: 6 }}>
              {info?.configDir ?? "读取中…"}
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (info?.configDir) {
                void copyText(info.configDir)
                  .then(() => toast("已复制目录路径"))
                  .catch(() => toast("复制失败，请手动选中路径复制", "error"));
              }
            }}
          >
            复制路径
          </Button>
        </div>
        <div className="setting-row">
          <div className="txt">
            <b>版本</b>
            <span>Quota {info?.version ?? "—"}</span>
          </div>
        </div>
      </div>

      {confirmReset && <Modal title="恢复内置模型资料？" onClose={() => { if (!resetting) setConfirmReset(false); }} footer={<><Button disabled={resetting} onClick={() => setConfirmReset(false)}>取消</Button><Button variant="danger" disabled={resetting} onClick={() => {
        setResetting(true);
        void api.resetCatalog().then(() => {setConfirmReset(false);toast('已恢复内置模型资料');}).catch(e => toast(errText(e), 'error')).finally(() => setResetting(false));
      }}>{resetting ? '恢复中…' : '恢复内置资料'}</Button></>}><p>你对模型资料的本地修改将被清除。</p></Modal>}
    </div>
  );
}

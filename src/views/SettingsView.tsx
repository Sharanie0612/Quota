import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { IconClock, IconGear, IconInfo, IconSpark } from "../components/icons";
import { Button, Notice, Seg, Switch } from "../components/ui";
import { DataImportPanel } from "../components/DataImportPanel";
import { api, copyText, errText } from "../lib/api";
import { toast } from "../lib/store";
import type { AppInfo, Settings } from "../lib/types";

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
  const [backupBusy, setBackupBusy] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [dataExport, setDataExport] = useState<{path:string; summary:string} | null>(null);
  const [feishu, setFeishu] = useState<Awaited<ReturnType<typeof api.getFeishuSync>> | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  useEffect(() => { void api.getFeishuSync().then(setFeishu).catch(() => undefined); }, []);
  const syncCloud = async (enable: boolean) => {
    setSyncBusy(true);
    try { toast(await api.syncFeishu(enable)); }
    catch (e) { toast(errText(e), "error"); }
    finally { await api.getFeishuSync().then(setFeishu).catch(() => undefined); setSyncBusy(false); }
  };
  const syncFile = async (importing: boolean) => {
    setSyncBusy(true);
    try {
      const filters=[{name:"Quota 统计同步",extensions:["json"]}];
      const picked=importing?await open({title:"导入从飞书下载的统计文件",multiple:false,filters}):await save({title:"导出统计同步文件",defaultPath:`Quota统计-${new Date().toISOString().replace(/[:.]/g,"-")}.json`,filters});
      const path=typeof picked==="string"?picked:Array.isArray(picked)?picked[0]:null;
      if(path)toast(await (importing?api.importActivitySync(path):api.exportActivitySync(path)));
    } catch(e){toast(errText(e),"error");} finally {setSyncBusy(false);}
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
    } catch (e) { toast(errText(e), "error"); }
    finally { setDataBusy(false); }
  };

  const isPreset = customInterval === null && INTERVALS.some((i) => Number(i.value) === settings.refreshIntervalMinutes);
  const intervalValue = customInterval ?? String(settings.refreshIntervalMinutes);
  const validInterval = intervalValue.trim() !== "" && Number.isInteger(Number(intervalValue))
    && Number(intervalValue) >= 1 && Number(intervalValue) <= 1440;

  return (
    <div className="content-inner" style={{ maxWidth: 760 }}>
      <div className="card section">
        <h2>
          <IconClock size={14} /> 余额刷新
        </h2>
        <p>自动同步余额与额度。</p>
        <div className="setting-row">
          <div className="txt">
            <b>自动刷新</b>
            <span>启动时更新一次；关闭后续定时刷新后，可手动刷新</span>
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
            <span>余额变动不频繁的话，30 分钟到 1 小时足够</span>
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
              <span>{validInterval ? "范围 1–1440，整数；有效值自动保存" : "请输入 1–1440 的整数，当前输入未保存"}</span>
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
        <p>选择需要的提醒。</p>
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
        <p>查看官方价格，核对后保存到本机。</p>
        <div className="setting-row">
          <div className="txt">
            <b>恢复内置资料</b>
            <span>清空你对模型卡片的全部本地修改</span>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              try {
                await api.resetCatalog();
                toast("已恢复内置模型资料");
              } catch {
                toast("恢复失败", "error");
              }
            }}
          >
            恢复
          </Button>
        </div>
      </div>

      <div className="card section">
        <h2>
          <IconGear size={14} /> 备份与迁移
        </h2>
        <div className="setting-row"><div className="txt"><b>飞书跨设备统计同步</b><span>个人账户：导出 → 上传到“我的空间 / Quota 同步” → 其他设备下载并导入。按事件合并，重复导入不会叠加计数。</span></div><Button size="sm" disabled={syncBusy} onClick={() => void api.openExternal("https://my.feishu.cn/drive/me/").catch(e=>toast(errText(e),"error"))}>打开飞书云盘</Button></div>
        <div className="setting-row"><Button size="sm" disabled={syncBusy} onClick={()=>void syncFile(false)}>导出统计同步文件</Button><Button size="sm" disabled={syncBusy} onClick={()=>void syncFile(true)}>{syncBusy?"处理中…":"导入并合并统计"}</Button></div>
        <p className="hint">只同步设备名、模型、会话标识和用量指标；也支持已有“导出数据”文件中的活动记录。合并后再次导出可转交其他设备。</p>
        <details><summary>企业账户自动同步（需要开放平台授权）</summary><p className="hint">每台设备需安装飞书官方 CLI 并登录同一飞书账号。个人账户无法授权时，请使用上方文件同步。</p><Button size="sm" disabled={syncBusy} onClick={() => void syncCloud(true)}>{syncBusy ? "同步中…" : feishu?.enabled ? "立即同步" : "连接并同步"}</Button></details>
        {feishu?.enabled && <div className="setting-row"><span className="hint">上次同步：{feishu.lastSynced ? new Date(feishu.lastSynced).toLocaleString() : "尚未完成"}</span><Button size="sm" disabled={syncBusy} onClick={() => void syncCloud(false)}>关闭飞书同步</Button></div>}
        {feishu?.error && <Notice tone="warn">{feishu.error}</Notice>}
        <div className="setting-row"><div className="txt"><b>导出数据</b><span>账户资料、余额历史、设置、模型资料和 Token 活动，保存为跨平台 JSON；不含登录凭据。</span></div><Button size="sm" disabled={dataBusy || backupBusy} onClick={() => void doDataExport()}>{dataBusy ? "处理中…" : "导出数据"}</Button></div>
        <p>普通 JSON 支持选择内容导入；账户名称、手动金额及提醒阈值会保留，密钥和小米登录信息请使用加密备份迁移到 macOS。</p>
        {dataExport && <Notice><b>{dataExport.summary}</b><div style={{overflowWrap:"anywhere"}}>保存位置：{dataExport.path}</div></Notice>}
        <p>加密保存账户与密钥。请妥善保管密码，遗失后无法恢复。</p>
        <div className="setting-row">
          <div className="txt">
            <b>导出加密备份</b>
            <span>包含全部账户、API Key、小米登录信息、设置、模型资料、余额历史和 Token 活动；Windows / macOS 通用</span>
          </div>
          <Button
            size="sm"
            disabled={dataBusy || backupBusy}
            onClick={() => { setImportOpen(false); setBackupPanel(backupPanel === "export" ? null : "export"); }}
          >
            导出
          </Button>
        </div>
        <div className="setting-row">
          <div className="txt">
            <b>导入数据 / 迁移账户</b>
            <span>先读取普通 JSON 或加密备份，再勾选账户、登录信息及其他内容；未选内容保留</span>
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
        {backupPanel ? (
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
            <span>Windows 凭据管理器</span>
          </div>
        </div>
        <div className="setting-row">
          <div className="txt">
            <b>配置文件目录</b>
            <span>账户信息与设置保存在这里，可直接备份</span>
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

    </div>
  );
}

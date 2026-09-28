import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { IconClock, IconGear, IconInfo, IconSpark } from "../components/icons";
import { Button, Notice, Seg, Switch } from "../components/ui";
import { api, copyText, errText } from "../lib/api";
import { toast } from "../lib/store";
import type { AppInfo, Settings } from "../lib/types";

const INTERVALS = [
  { value: "10", label: "10 分钟" },
  { value: "30", label: "30 分钟" },
  { value: "60", label: "1 小时" },
  { value: "180", label: "3 小时" },
];

type BackupPanel = null | "export" | "import";

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
  const [customInterval, setCustomInterval] = useState("");
  const [backupPanel, setBackupPanel] = useState<BackupPanel>(null);
  const [backupPw, setBackupPw] = useState("");
  const [backupPw2, setBackupPw2] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);

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
    if (!backupPw) {
      toast("先输入备份密码", "error");
      return;
    }
    if (backupPw !== backupPw2) {
      toast("两次输入的密码不一致", "error");
      return;
    }
    const path = await save({
      title: "导出加密备份",
      defaultPath: backupFileName(),
      filters: [{ name: "Quota 加密备份", extensions: ["json"] }],
    });
    if (!path) return;
    setBackupBusy(true);
    try {
      await api.exportBackup(backupPw, path);
      toast("备份已导出，请妥善保管文件与密码");
      closeBackupPanel();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBackupBusy(false);
    }
  };

  /** 从备份恢复：选文件 + 密码 → 覆盖当前配置/资料/凭据 → 整页刷新 */
  const doImport = async () => {
    if (!backupPw) {
      toast("先输入备份密码", "error");
      return;
    }
    const picked = await open({
      title: "选择 Quota 备份文件",
      multiple: false,
      filters: [{ name: "Quota 加密备份", extensions: ["json"] }],
    });
    if (!picked) return;
    const path = typeof picked === "string" ? picked : picked[0];
    if (!path) return;
    setBackupBusy(true);
    try {
      const msg = await api.importBackup(backupPw, path);
      toast(`${msg}，正在重新加载…`);
      // 恢复会替换全部账户与设置，直接刷新让所有页面数据重新加载
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      toast(errText(e), "error");
      setBackupBusy(false);
    }
  };

  const isPreset = INTERVALS.some((i) => Number(i.value) === settings.refreshIntervalMinutes);

  return (
    <div className="content-inner" style={{ maxWidth: 760 }}>
      <div className="card section">
        <h2>
          <IconClock size={14} /> 余额刷新
        </h2>
        <p>后台按设定间隔自动查询所有账户的余额与模型列表，窗口最小化到托盘时也会继续。</p>
        <div className="setting-row">
          <div className="txt">
            <b>自动刷新</b>
            <span>关闭后只能手动点「刷新」</span>
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
              set({ refreshIntervalMinutes: Number(v) });
            }}
          />
        </div>
        {!isPreset ? (
          <div className="setting-row">
            <div className="txt">
              <b>自定义间隔（分钟）</b>
              <span>范围 1 – 1440 分钟</span>
            </div>
            <input
              className="input"
              style={{ width: 110 }}
              type="number"
              min={1}
              max={1440}
              value={customInterval || String(settings.refreshIntervalMinutes)}
              onChange={(e) => {
                setCustomInterval(e.target.value);
                const n = Number(e.target.value);
                if (n >= 1 && n <= 1440) set({ refreshIntervalMinutes: n });
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="card section">
        <h2>
          <IconSpark size={14} /> 低余额提醒
        </h2>
        <p>余额低于账户自身设定的阈值时发送 Windows 系统通知，同一账户 6 小时内只提醒一次。</p>
        <div className="setting-row">
          <div className="txt">
            <b>发送系统通知</b>
            <span>关闭后仍会在卡片上标红，但不弹通知</span>
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
            <span>单位与账户余额一致（人民币账户填元，美元账户填美元）</span>
          </div>
          <input
            className="input"
            style={{ width: 110 }}
            type="number"
            min={0}
            step="1"
            value={settings.defaultLowThreshold}
            onChange={(e) => set({ defaultLowThreshold: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div className="card section">
        <h2>
          <IconGear size={14} /> 窗口与托盘
        </h2>
        <div className="setting-row">
          <div className="txt">
            <b>关闭主窗口时最小化到托盘</b>
            <span>保持后台刷新与低余额提醒；要彻底退出请用托盘菜单里的「退出」</span>
          </div>
          <Switch
            checked={settings.closeToTray}
            onChange={(v) => set({ closeToTray: v })}
            label="关闭到托盘"
          />
        </div>
        <div className="setting-row">
          <div className="txt">
            <b>托盘悬浮卡</b>
            <span>左键点击托盘图标即可弹出余额一览，点击别处自动收起</span>
          </div>
          <Button size="sm" onClick={() => toast("左键单击任务栏托盘图标试试")}>
            查看用法
          </Button>
        </div>
      </div>

      <div className="card section">
        <h2>
          <IconSpark size={14} /> 模型资料库
        </h2>
        <p>
          模型简介与价格来自软件内置的资料库（部分条目已对照官网核实）。价格随时会变，
          请以官网为准；模型库里每张卡片都有「比价」，可以抓取官方定价页、取第三方参考价交叉核对，
          核对完一键采用就会记为本机资料并标明核实时间。
        </p>
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
        <p>
          换电脑或重装系统时，把账户配置、模型资料和所有密钥打包成一个加密文件带走。
          文件用你设置的密码 AES-256-GCM 加密，密码不落盘——忘了密码就没有任何办法恢复。
        </p>
        <div className="setting-row">
          <div className="txt">
            <b>导出加密备份</b>
            <span>包含全部账户、设置、模型资料与 API Key，保存为一个加密文件</span>
          </div>
          <Button
            size="sm"
            onClick={() => setBackupPanel(backupPanel === "export" ? null : "export")}
          >
            导出
          </Button>
        </div>
        <div className="setting-row">
          <div className="txt">
            <b>从备份恢复</b>
            <span>选择备份文件并输入密码。会覆盖当前的账户、设置与全部密钥</span>
          </div>
          <Button
            size="sm"
            onClick={() => setBackupPanel(backupPanel === "import" ? null : "import")}
          >
            恢复
          </Button>
        </div>
        {backupPanel ? (
          <div className="backup-panel">
            {backupPanel === "import" ? (
              <Notice tone="warn">
                恢复会覆盖当前所有的账户、设置与密钥，且无法撤销。确认要继续吗？
              </Notice>
            ) : null}
            <div className="backup-fields">
              <input
                className="input"
                type="password"
                placeholder="备份密码"
                autoComplete="new-password"
                value={backupPw}
                onChange={(e) => setBackupPw(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !backupBusy && void (backupPanel === "export" ? doExport() : doImport())}
              />
              {backupPanel === "export" ? (
                <input
                  className="input"
                  type="password"
                  placeholder="再输入一次确认"
                  autoComplete="new-password"
                  value={backupPw2}
                  onChange={(e) => setBackupPw2(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !backupBusy && void doExport()}
                />
              ) : null}
              <Button
                variant="primary"
                size="sm"
                disabled={backupBusy}
                onClick={() => void (backupPanel === "export" ? doExport() : doImport())}
              >
                {backupBusy ? "处理中…" : backupPanel === "export" ? "导出备份" : "开始恢复"}
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
            <span>Windows 凭据管理器（服务名 Quota）。密钥不写入配置文件、不上传任何服务器。</span>
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
        <Notice tone="info">
          余额与模型数据直接来自各厂商官方接口；「充值」按钮只做一件事——在你的默认浏览器里打开该账户的官方充值页面，
          软件不接触任何支付流程，也不代持资金。
        </Notice>
      </div>

      <div className="hint" style={{ textAlign: "center", paddingBottom: 8 }}>
        供应商接口可能随时调整。小米 MiMo 没有余额接口，可用「自定义余额接口」或「手动余额」；
        百炼这类从云账户扣费的，填阿里云 AccessKey 走账单接口读余额；智谱走账户报表接口（官方文档未收录、实测可用）。
      </div>
    </div>
  );
}

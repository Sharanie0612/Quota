import { useState } from "react";
import { IconClock, IconGear, IconInfo, IconSpark } from "../components/icons";
import { Button, Notice, Seg, Switch } from "../components/ui";
import { api, copyText } from "../lib/api";
import { toast } from "../lib/store";
import type { AppInfo, Settings } from "../lib/types";

const INTERVALS = [
  { value: "10", label: "10 分钟" },
  { value: "30", label: "30 分钟" },
  { value: "60", label: "1 小时" },
  { value: "180", label: "3 小时" },
];

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
          <IconInfo size={14} /> 数据与安全
        </h2>
        <div className="setting-row">
          <div className="txt">
            <b>API Key 存放位置</b>
            <span>Windows 凭据管理器（服务名 AgentPrice）。密钥不写入配置文件、不上传任何服务器。</span>
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
            <span>AgentPrice {info?.version ?? "—"}</span>
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

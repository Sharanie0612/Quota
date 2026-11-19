import { useState } from "react";
import { Seg, Switch } from "../../components/ui";
import { IconClock, IconSpark } from "../../components/icons";
import type { SettingsControls } from "./sections";

const INTERVALS = [
  { value: "10", label: "10 分钟" },
  { value: "30", label: "30 分钟" },
  { value: "60", label: "1 小时" },
  { value: "180", label: "3 小时" },
];

export function RefreshSettings({ settings, onUpdate: set }: SettingsControls) {
  const [customInterval, setCustomInterval] = useState<string | null>(null);
  const isPreset = customInterval === null && INTERVALS.some((i) => Number(i.value) === settings.refreshIntervalMinutes);
  const intervalValue = customInterval ?? String(settings.refreshIntervalMinutes);
  const validInterval = intervalValue.trim() !== "" && Number.isInteger(Number(intervalValue))
    && Number(intervalValue) >= 1 && Number(intervalValue) <= 1440;
  return <>
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
      <h2>提醒与模型资料</h2>
      <div className="setting-row"><div className="txt"><b>余额增加提示</b><span>检测到充值时提示</span></div><Switch checked={settings.notifyRecharge} onChange={(v) => set({ notifyRecharge: v })} label="余额增加提示" /></div>
      <div className="setting-row"><div className="txt"><b>自动更新 AI 模型</b><span>连接 Artificial Analysis 后，运行期间定期更新指数与单任务成本</span></div><Switch checked={settings.ladderAutoUpdate} onChange={(v) => set({ ladderAutoUpdate: v })} label="模型资料自动更新" /></div>
    </div>
  </>;
}

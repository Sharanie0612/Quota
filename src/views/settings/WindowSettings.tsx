import { IconGear } from "../../components/icons";
import { Switch } from "../../components/ui";
import { UsageWidgetSettings } from "../../components/UsageWidgetSettings";
import { AppearanceSettings } from "../../components/AppearanceSettings";
import type { SettingsControls } from "./sections";

export function WindowSettings({ settings, onUpdate: set }: SettingsControls) {
  return <>
    <AppearanceSettings/>
    <UsageWidgetSettings/>
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
  </>;
}

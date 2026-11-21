import type { Settings } from "../../lib/types";

export const settingsSections = [
  { id: "appearance", title: "外观与窗口" },
  { id: "sources", title: "采集来源" },
  { id: "sync", title: "同步与备份" },
  { id: "updates", title: "提醒与更新" },
  { id: "about", title: "关于与安全" },
] as const;

export type SettingsSection = typeof settingsSections[number]["id"];
export interface SettingsControls {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}

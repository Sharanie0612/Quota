import { invoke } from "@tauri-apps/api/core";
import type { AppInfo, LiveModelStatus, Settings } from "../types";

type WidgetOptions = { enabled: boolean; side: "left" | "right"; heightPercent: number };

export const desktopApi = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  getMainWindowChrome: () => invoke<{
    installed: boolean;
    blockedFramePaints: number;
    blockedThemedPaints: number;
    safeActivationForwards: number;
  }>("get_main_window_chrome"),
  openMain: () => invoke<void>("show_main_window"),
  openMainView: (view: string) => invoke<void>("show_main_window", { view }),
  showMain: (account?: string | null) => invoke<void>("show_main_window", { account: account ?? null }),

  widgetReady: () => invoke<void>("widget_ready"),
  getWidgetOptions: () => invoke<WidgetOptions>("get_widget_options"),
  saveWidgetOptions: (options: WidgetOptions) => invoke<WidgetOptions>("save_widget_options", { options }),
  getWidgetUsage: () =>
    invoke<{ today: number; total: number; date: string; updatedAt: number | null; partial: boolean }>("get_widget_usage"),
  getWidgetSpeed: () => invoke<LiveModelStatus>("get_widget_speed"),
  setWidgetExpanded: (expanded: boolean) => invoke<void>("set_widget_expanded", { expanded }),
  moveWidget: (dx: number, dy: number, finished: boolean) => invoke<void>("move_widget", { dx, dy, finished }),
};

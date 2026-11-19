import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityFilters, ActivityOptions, ActivityReport, ActivityStorage, ActivityWorkspace,
  ActivityWorkspaceReport, OutputSpeedReport, SshHostDiscovery, SshIdentity,
} from "../types";

export const activityApi = {
  getActivity: (device = "", source = "", days = 0, model = "", from = "", to = "", filters?: ActivityFilters) =>
    invoke<ActivityReport>("get_activity", { device, source, days, model, from, to, filters }),
  getActivityWorkspace: () => invoke<ActivityWorkspaceReport>("get_activity_workspace"),
  saveActivityWorkspace: (
    input: ActivityWorkspace,
    settings?: Pick<ActivityWorkspaceReport, "autoCollect" | "collectIntervalSeconds" | "multicaEnabled" | "multicaWorkspaceRoot">,
  ) => invoke<void>("save_activity_workspace", { input, settings }),
  identifyActivityEnvironment: (kind: string, target: string, home = "") =>
    invoke<{ deviceId: string; name: string }>("identify_activity_environment", { kind, target, home }),
  refreshActivity: () => invoke<number>("refresh_activity"),
  getActivityOptions: () => invoke<ActivityOptions>("get_activity_options"),
  saveActivityOptions: (input: ActivityOptions) => invoke<void>("save_activity_options", { input }),
  getOutputSpeed: (device = "", source = "codex", days = 7, model = "", bucketSeconds = 0, lookbackHours = 0, lookbackMinutes = 0) =>
    invoke<OutputSpeedReport>("get_output_speed", { device, source, days, model, bucketSeconds, lookbackHours, lookbackMinutes }),
  refreshOutputSpeed: () => invoke<number>("refresh_output_speed"),

  discoverSshHosts: () => invoke<SshHostDiscovery>("discover_codex_ssh_hosts"),
  identifySshDevices: (targets: { host: string; home: string }[]) =>
    invoke<SshIdentity[]>("identify_codex_ssh_devices", { targets }),
  syncActivityNow: () => invoke<void>("sync_activity_now"),
  getSyncOverview: () => invoke<{
    devices: { id: string; name: string }[];
    updatedAt: number | null;
    syncErrors: string[];
  }>("get_sync_overview"),
  getActivityStorage: () => invoke<ActivityStorage>("get_activity_storage"),
  getActivityReaders: () =>
    invoke<{ device: string; version: string | null; compressed: boolean | null; multiSource?: boolean | null }[]>("get_activity_readers"),
  rebuildActivitySync: () => invoke<number>("rebuild_activity_sync"),
  optimizeActivityStorage: () =>
    invoke<{ before: ActivityStorage; after: ActivityStorage; converted: number }>("optimize_activity_storage"),
};

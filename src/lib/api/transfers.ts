import { invoke } from "@tauri-apps/api/core";
import type { ImportPreview, ImportSelection } from "../types";

export const transfersApi = {
  exportReportCsv: (path: string, contents: string) => invoke<void>("export_report_csv", { path, contents }),
  exportData: (path: string) => invoke<string>("export_data", { path }),
  /** 导出的加密备份包含账户凭据，path 由文件选择窗口提供。 */
  exportBackup: (password: string, path: string) => invoke<void>("export_backup", { password, path }),
  previewImport: (path: string, password: string) => invoke<ImportPreview>("preview_import", { path, password }),
  importData: (path: string, password: string, fingerprint: string, selection: ImportSelection) =>
    invoke<string>("import_data", { path, password, fingerprint, selection }),
  exportActivitySync: (path: string) => invoke<string>("export_activity_sync", { path }),
  importActivitySync: (path: string) => invoke<string>("import_activity_sync", { path }),
};

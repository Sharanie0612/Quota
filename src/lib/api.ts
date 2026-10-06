import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ActivityReport, ActivityOptions,
  AccountInput,
  AccountTrend,
  AccountView,
  AppInfo,
  CatalogEntry,
  CustomProbe,
  ModelCard,
  PriceComparison,
  ProviderView,
  RechargeEvent,
  Settings,
  ImportPreview, ImportSelection,
  LadderSnapshot,
  LadderPriceCheck,
} from "./types";

export const api = {
  getAccountSyncStatus: () => invoke<{lastSynced:string|null;error:string|null}>("get_account_sync_status"),
  syncAccounts: () => invoke<void>("sync_accounts"),
  exportActivitySync: (path:string) => invoke<string>("export_activity_sync",{path}),
  importActivitySync: (path:string) => invoke<string>("import_activity_sync",{path}),
  getActivityOptions: () => invoke<ActivityOptions>("get_activity_options"),
  exportData: (path: string) => invoke<string>("export_data", { path }),
  getExchangeRate: () => invoke<{ cnyPerUsd: number; date: string; checkedAt: string; source: string; error: string | null }>("get_exchange_rate"),
  getActivity: (device = "", source = "", days = 0, model = "", from = "", to = "") => invoke<ActivityReport>("get_activity", { device, source, days, model, from, to }),
  refreshActivity: () => invoke<number>("refresh_activity"),
  saveActivityOptions: (input: ActivityOptions) => invoke<void>("save_activity_options", { input }),
  getLadder: () => invoke<LadderSnapshot>("get_ladder"),
  refreshLadder: (force = false) => invoke<LadderSnapshot>("refresh_ladder", { force }),
  checkLadderPrice: (id: string) => invoke<LadderPriceCheck>("check_ladder_price", { id }),
  adoptLadderPrice: (id: string, input: number, output: number, currency: string, cachedInput: number | null = null, cacheWrite: number | null = null, cacheWriteLong: number | null = null) =>
    invoke<void>("adopt_ladder_price", { id, input, output, currency, cachedInput, cacheWrite, cacheWriteLong }),
  startMimoLogin: () => invoke<void>("start_mimo_login"),
  listMimoConnections: () => invoke<{id: string; label: string}[]>("list_mimo_connections"),
  reuseMimoConnection: (accountId: string, provider: string) => invoke<string>("reuse_mimo_connection", {accountId, provider}),
  finishMimoLogin: (provider: string) => invoke<string>("finish_mimo_login", { provider }),
  cancelMimoLogin: () => invoke<void>("cancel_mimo_login"),
  connectChatgpt: () => invoke<string>("connect_chatgpt"),
  discardConnection: (id: string) => invoke<void>("discard_connection", { id }),
  listProviders: () => invoke<ProviderView[]>("list_providers"),
  listAccounts: () => invoke<AccountView[]>("list_accounts"),
  saveAccount: (input: AccountInput) => invoke<AccountView>("save_account", { input }),
  deleteAccount: (id: string) => invoke<void>("delete_account", { id }),
  refreshAccount: (id: string) => invoke<AccountView>("refresh_account", { id }),
  refreshAll: () => invoke<AccountView[]>("refresh_all"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  /** 全部账户的余额历史与趋势（本地记录，用于折线与耗尽预测） */
  getBalanceHistory: () => invoke<Record<string, AccountTrend>>("get_balance_history"),
  /** 导出加密备份（配置 + 模型资料 + 全部密钥）；path 来自 dialog 插件 */
  exportBackup: (password: string, path: string) =>
    invoke<void>("export_backup", { password, path }),
  previewImport: (path: string, password: string) => invoke<ImportPreview>("preview_import", {path, password}),
  importData: (path: string, password: string, fingerprint: string, selection: ImportSelection) =>
    invoke<string>("import_data", {path, password, fingerprint, selection}),
  modelCards: (provider?: string) =>
    invoke<ModelCard[]>("model_cards", { provider: provider ?? null }),
  saveCatalogEntry: (entry: CatalogEntry) => invoke<void>("save_catalog_entry", { entry }),
  resetCatalog: () => invoke<void>("reset_catalog_overrides"),
  /** 在模型库里手动隐藏 / 恢复某个模型（存本机 hidden_models.json） */
  setModelHidden: (modelId: string, hidden: boolean) =>
    invoke<void>("set_model_hidden", { modelId, hidden }),
  /** 价格比对：本地资料库 +（可选）官方定价页抓取 +（可选）第三方参考价 */
  comparePrices: (
    modelId: string,
    provider: string,
    includePage: boolean,
    includeReference: boolean,
  ) =>
    invoke<PriceComparison>("compare_prices", {
      modelId,
      provider,
      includePage,
      includeReference,
    }),
  /** 测试自定义余额接口，返回自动发现的金额字段 */
  probeCustomBalance: (input: {
    customUrl?: string | null;
    customHeaders?: string | null;
    customJsonPath?: string | null;
    customCurrency?: string | null;
    customMethod?: string | null;
    customBody?: string | null;
  }) => invoke<CustomProbe>("probe_custom_balance", { input }),
  /** 生成可直接运行的 cURL 调用示例（含该账户的 API Key） */
  apiSnippet: (accountId: string, modelId: string) =>
    invoke<string>("api_snippet", { accountId, modelId }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  appInfo: () => invoke<AppInfo>("app_info"),
  /** 打开主面板；传 accountId 时主面板会直接定位到该账户 */
  showMain: (account?: string | null) =>
    invoke<void>("show_main_window", { account: account ?? null }),
};

export const events = {
  onAccountsUpdated: (cb: () => void) => listen("accounts-updated", cb),
  /** 刷新时检测到余额明显上涨（疑似充值） */
  onRechargeDetected: (cb: (e: RechargeEvent) => void) =>
    listen<RechargeEvent>("recharge-detected", (e) => cb(e.payload)),
  /** 从悬浮卡点某个账户进入主面板时触发，带回账户 id */
  onFocusAccount: (cb: (id: string) => void) => listen<string>("focus-account", (e) => cb(e.payload)),
};

/** 把后端返回的错误转成可读文本 */
export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as Error).message);
  return String(e);
}

/**
 * 复制文本到剪贴板。
 * navigator.clipboard 要求窗口处于聚焦状态，webview 里偶尔不满足，
 * 所以失败时退回老办法（临时 textarea + execCommand）。
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* 继续走兜底 */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("浏览器不允许复制，请手动选中文本复制");
}

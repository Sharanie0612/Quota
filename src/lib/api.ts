import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AccountInput,
  AccountView,
  AppInfo,
  CatalogEntry,
  CustomProbe,
  ModelCard,
  PriceComparison,
  ProviderView,
  Settings,
} from "./types";

export const api = {
  listProviders: () => invoke<ProviderView[]>("list_providers"),
  listAccounts: () => invoke<AccountView[]>("list_accounts"),
  saveAccount: (input: AccountInput) => invoke<AccountView>("save_account", { input }),
  deleteAccount: (id: string) => invoke<void>("delete_account", { id }),
  refreshAccount: (id: string) => invoke<AccountView>("refresh_account", { id }),
  refreshAll: () => invoke<AccountView[]>("refresh_all"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
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
  /** 悬浮卡按内容自适应高度 */
  resizePopup: (height: number) => invoke<void>("resize_popup", { height }),
  hidePopup: () => invoke<void>("hide_popup"),
};

export const events = {
  onAccountsUpdated: (cb: () => void) => listen("accounts-updated", cb),
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

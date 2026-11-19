import { listen } from "@tauri-apps/api/event";
import type { RechargeEvent } from "./types";
import { accountsApi } from "./api/accounts";
import { activityApi } from "./api/activity";
import { usageApi } from "./api/usage";
import { modelsApi } from "./api/models";
import { desktopApi } from "./api/desktop";
import { transfersApi } from "./api/transfers";

export const api = {
  ...accountsApi,
  ...activityApi,
  ...usageApi,
  ...modelsApi,
  ...desktopApi,
  ...transfersApi,
};

export const events = {
  onNavigateMain: (cb: (view: string) => void) => listen<string>("navigate-main", e => cb(e.payload)),
  onActivityUpdated: (cb: () => void) => listen("activity-updated", cb),
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

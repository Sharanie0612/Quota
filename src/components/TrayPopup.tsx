import { useCallback, useEffect, useMemo, useRef } from "react";
import { api, errText } from "../lib/api";
import {
  balanceSourceLabel,
  money,
  timeAgo,
} from "../lib/format";
import { useAccounts, useToasts } from "../lib/store";
import type { AccountView } from "../lib/types";
import { IconAlert, IconCoins, IconExternal, IconRefresh, IconX } from "./icons";
import { ProviderLogo } from "./logos";
import { Badge, Button, IconButton } from "./ui";

/** 悬浮卡高度估算：固定部分（标题栏 + 底栏 + 内边距）与每项高度 */
const CHROME_H = 119;
const ALERT_H = 39;
const ITEM_H = 86;
/** 超过这么多账户就让列表滚动，窗口不再变高 */
const MAX_VISIBLE_ITEMS = 5;

/** 托盘悬浮卡：点托盘图标弹出的紧凑余额面板 */
export default function TrayPopup() {
  const { accounts, reload, refreshAll, refreshing } = useAccounts();
  const toasts = useToasts();
  const resizeTimer = useRef<number | null>(null);

  const low = useMemo(() => accounts.filter((a) => a.low), [accounts]);
  const pending = useMemo(
    () => accounts.filter((a) => !a.status.balance && !a.low).length,
    [accounts],
  );

  /** 汇总同币种余额（不同币种分开显示，不做汇率换算） */
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of accounts) {
      const b = a.status.balance;
      if (b && b.total !== null) {
        map.set(b.currency, (map.get(b.currency) ?? 0) + b.total);
      }
    }
    return Array.from(map.entries()).slice(0, 2);
  }, [accounts]);

  /** 让悬浮卡窗口跟着内容高矮变化 */
  const fitWindow = useCallback(() => {
    if (resizeTimer.current !== null) window.clearTimeout(resizeTimer.current);
    resizeTimer.current = window.setTimeout(() => {
      const visible = Math.max(1, Math.min(accounts.length, MAX_VISIBLE_ITEMS));
      const h = CHROME_H + (low.length > 0 || pending > 0 ? ALERT_H : 0) + visible * ITEM_H;
      void api.resizePopup(h).catch(() => undefined);
    }, 60);
  }, [accounts.length, low.length, pending]);

  useEffect(() => {
    fitWindow();
    return () => {
      if (resizeTimer.current !== null) window.clearTimeout(resizeTimer.current);
    };
  }, [fitWindow]);

  const openMain = async (accountId?: string) => {
    try {
      await api.showMain(accountId ?? null);
    } catch {
      /* 忽略 */
    }
  };

  const recharge = async (url: string) => {
    if (!url) {
      await openMain();
      return;
    }
    try {
      await api.openExternal(url);
    } catch (e) {
      alert(errText(e));
    }
  };

  return (
    <div className="popup-root">
      <div className="popup">
        <div className="popup-head">
          <span className="popup-mark">
            <IconCoins size={14} />
          </span>
          <div className="popup-title">
            <b>模型账户余额</b>
            <span>
              {accounts.length === 0
                ? "还没有账户"
                : totals.length > 0
                  ? `合计 ${totals.map(([c, v]) => money(v, c)).join(" + ")}`
                  : `${accounts.length} 个账户`}
            </span>
          </div>
          <div className="spacer" />
          <IconButton
            title="刷新余额"
            className="btn-sm"
            busy={refreshing}
            disabled={refreshing}
            onClick={() => void refreshAll()}
          >
            <IconRefresh size={14} />
          </IconButton>
          <IconButton title="收起" className="btn-sm" onClick={() => void api.hidePopup()}>
            <IconX size={14} />
          </IconButton>
        </div>

        {low.length > 0 ? (
          <div className="popup-alert">
            <IconAlert size={13} />
            <span>
              {low.length} 个账户余额不足：
              {low
                .slice(0, 3)
                .map((a) => a.label)
                .join("、")}
              {low.length > 3 ? " 等" : ""}
            </span>
          </div>
        ) : pending > 0 ? (
          <div className="popup-alert is-quiet">
            <IconAlert size={13} />
            <span>{pending} 个账户还没有余额数据，点刷新试一次</span>
          </div>
        ) : null}

        <div className="popup-list">
          {accounts.length === 0 ? (
            <div className="popup-empty">
              <div className="popup-empty-mark">
                <IconCoins size={20} />
              </div>
              <b>还没有账户</b>
              <span>打开主面板，添加第一个模型账户后这里会显示余额。</span>
              <Button size="sm" variant="primary" onClick={() => void openMain()}>
                打开主面板
              </Button>
            </div>
          ) : null}

          {accounts.map((a) => (
            <PopupItem
              key={a.id}
              account={a}
              onOpen={() => void openMain(a.id)}
              onRecharge={() => void recharge(a.effectiveRechargeUrl)}
            />
          ))}
        </div>

        <div className="popup-foot">
          <Button size="sm" variant="primary" style={{ flex: 1 }} onClick={() => void openMain()}>
            打开主面板
          </Button>
          <Button size="sm" onClick={() => void reload()} disabled={refreshing}>
            重读
          </Button>
        </div>
        {toasts.length > 0 ? (
          <div className="popup-toast">{toasts[toasts.length - 1].text}</div>
        ) : null}
      </div>
    </div>
  );
}

function PopupItem({
  account,
  onOpen,
  onRecharge,
}: {
  account: AccountView;
  onOpen: () => void;
  onRecharge: () => void;
}) {
  const b = account.status.balance;
  const sourceLabel = b ? balanceSourceLabel(b.source) : null;
  const err = account.status.balanceError;

  const placeholder = !b
    ? account.balanceSupported || account.balanceMode === "aliyun" || account.balanceMode === "custom"
      ? err
        ? "查询失败"
        : "暂无数据"
      : "手动记录 / 不支持查询"
    : null;

  return (
    <div className={`popup-item${account.low ? " is-low" : ""}`} onClick={onOpen} title="打开主面板查看详情">
      <div className="top">
        <ProviderLogo provider={account.provider} size={20} />
        <span className="popup-label">{account.label}</span>
        {account.low ? <Badge tone="red">余额不足</Badge> : null}
        {sourceLabel ? <Badge tone={b?.source === "manual" ? "amber" : "blue"}>{sourceLabel}</Badge> : null}
        <div className="spacer" />
        {account.effectiveRechargeUrl ? (
          <button
            className="btn btn-sm btn-quiet popup-hoverable"
            style={{ height: 22, padding: "0 6px" }}
            onClick={(e) => {
              e.stopPropagation();
              onRecharge();
            }}
          >
            <IconExternal size={12} />
            充值
          </button>
        ) : null}
      </div>

      <div className="popup-body">
        <div className={`val${account.low ? " low" : ""}${b && b.total !== null ? "" : " muted"}`}>
          {b && b.total !== null ? (
            money(b.total, b.currency)
          ) : (
            <span className="placeholder">{placeholder}</span>
          )}
        </div>
        <div className="popup-side">
          {b && b.amounts.length > 0 ? (
            <span className="popup-amounts" title={b.amounts.map((x) => `${x.label} ${x.value}`).join(" / ")}>
              {b.amounts
                .slice(0, 2)
                .map((x) => `${x.label} ${money(x.value, b.currency)}`)
                .join(" · ")}
            </span>
          ) : null}
          <span className="popup-meta">
            {account.status.models.length > 0 ? `${account.status.models.length} 个模型 · ` : ""}
            {timeAgo(account.status.lastChecked)}
          </span>
        </div>
      </div>

      {err ? (
        <div className="popup-err" title={err}>
          <IconAlert size={11} />
          <span>{err.length > 46 ? `${err.slice(0, 46)}…` : err}</span>
        </div>
      ) : null}
    </div>
  );
}

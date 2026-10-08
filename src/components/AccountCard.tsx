import { api, errText } from "../lib/api";
import {
  daysLeftText,
  money,
  timeAgo,
} from "../lib/format";
import { toast } from "../lib/store";
import { balanceBreakdown, isSubscriptionAccount } from "../lib/accountOverview";
import type { AccountTrend, AccountView, HistoryPoint } from "../lib/types";
import { ProviderLogo } from "./logos";
import {
  IconAlert,
  IconExternal,
  IconLayers,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconWallet,
} from "./icons";
import { Badge, Button, Notice } from "./ui";
import "./account-cards.css";

/** 余额迷你折线：最近 30 天的本地历史记录，不足两个点不画 */
function Sparkline({ points, low }: { points: HistoryPoint[]; low?: boolean }) {
  if (points.length < 2) return null;
  const w = 84;
  const h = 26;
  const pad = 2;
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const color = low ? "var(--red)" : "var(--blue)";
  return (
    <svg
      className="sparkline"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
    >
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={x(points.length - 1)}
        cy={y(values[values.length - 1])}
        r="2.4"
        fill={color}
      />
    </svg>
  );
}

export function AccountCard({
  account,
  busy,
  trend,
  onRefresh,
  onEdit,
  onUseManual,
  onShowModels,
}: {
  account: AccountView;
  busy: boolean;
  trend?: AccountTrend;
  onRefresh: () => void;
  onEdit: () => void;
  onUseManual: () => void;
  onShowModels: () => void;
}) {
  const balance = account.status.balance;
  const subscription = account.status.subscription;
  const isPlan = isSubscriptionAccount(account);
  const breakdown = balanceBreakdown(balance, account);
  const amount = (kind: string) => balance?.amounts.find((a) => a.kind === kind)?.value;
  const mimoWindows = account.provider === "mimo-plan" && balance ? [
    { label: "套餐额度", used: amount("used"), limit: amount("total") },
    { label: "本月额度", used: amount("month_used"), limit: amount("month_limit") },
  ].filter((w) => w.used != null && w.limit != null && Number.isFinite(w.used) && Number.isFinite(w.limit) && w.limit >= 0) : [];
  const planExtras = (balance?.amounts ?? []).filter((item) => Number.isFinite(item.value) && !(
    mimoWindows.some((window) => window.label === "套餐额度") && ["used", "total"].includes(item.kind)
    || mimoWindows.some((window) => window.label === "本月额度") && ["month_used", "month_limit"].includes(item.kind)
  ));
  const extraAmounts = isPlan ? planExtras : breakdown.extra;
  const hasSubscriptionWindows = !!subscription?.windows.length;
  const meaningfulBalanceNote = balance?.note && (balance.source === "costs" || balance.note.includes("未读到")) ? balance.note : null;


  const openUrl = async (url: string, label: string) => {
    if (!url) {
      toast(`该供应商还没有配置${label}链接，可在「编辑」里自定义`, "error");
      return;
    }
    try {
      await api.openExternal(url);
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  const statusBadge = account.status.balanceError && account.balanceMode !== "manual" ? <Badge tone="amber">同步异常</Badge> : account.low || balance?.usable === false ? (
    <Badge tone="red">{isPlan ? "额度不足" : "余额不足"}</Badge>
  ) : balance?.source === "manual" && !hasSubscriptionWindows ? (
    <Badge>{account.balanceMode !== "manual" && !account.status.lastChecked ? "待同步" : "手动记录"}</Badge>
  ) : balance || subscription ? (
    <Badge tone="green">正常</Badge>
  ) : (
    <Badge>待查询</Badge>
  );

  return (
    <div className={`card account-card ${isPlan ? "account-subscription" : "account-balance"}`}>
      <div className="acct-head">
        <ProviderLogo provider={account.provider} size={34} />
        <div className="acct-title">
          <div className="acct-label">
            {account.label}
            {statusBadge}
          </div>
          <div className="acct-provider" title={account.effectiveBaseUrl}>
            {account.providerName}
            {account.providerRegion && account.providerRegion !== "自定义"
              ? ` · ${account.providerRegion}`
              : ""}
          </div>
        </div>
      </div>

      <div>
        {isPlan && !hasSubscriptionWindows && balance?.source === "manual" && balance.total != null ? (
          <div className="subscription-windows">
            <div className="subscription-caption"><Badge>手动记录</Badge><span>剩余额度</span></div>
            <div className="usage-window">
              <div className="usage-label"><span>当前剩余</span><b>{money(balance.total, balance.currency)}</b></div>
              {balance.currency === "%" ? <progress value={Math.max(0, Math.min(100, balance.total))} max={100} aria-label="手动剩余额度" className={account.low ? "is-low" : ""} /> : null}
              <span className="hint">更新手动记录后参与额度提醒。</span>
            </div>
          </div>
        ) : account.provider === "mimo-plan" && mimoWindows.length ? (
          <div className="subscription-windows">
            <div className="subscription-caption"><Badge tone="blue">MiMo Token Plan</Badge><span>{balance?.total != null ? `${money(balance.total, balance.currency)} 剩余` : "Credits"}</span></div>
            {balance?.note && <p className="subscription-detail">{balance.note.split(" · 余额")[0]}</p>}
            {mimoWindows.map((w) => {
              const remaining = w.limit! > 0 ? Math.max(0, Math.min(100, (1 - w.used! / w.limit!) * 100)) : null;
              return <div key={w.label} className="usage-window">
                <div className="usage-label"><span>{w.label}</span><b>{remaining == null ? money(Math.max(0, w.limit! - w.used!), "CREDITS") : `${remaining.toFixed(0)}%`}<small> 剩余</small></b></div>
                {remaining != null ? <progress value={remaining} max={100} aria-label={w.label} className={account.low ? "is-low" : ""} /> : null}
                <span className="hint">已用 {money(w.used!, "CREDITS")} / {money(w.limit!, "CREDITS")}</span>
              </div>;
            })}
          </div>
        ) : subscription && hasSubscriptionWindows ? (
          <div className="subscription-windows">
            <div className="subscription-caption"><Badge tone="blue">{subscription.plan.toUpperCase()}</Badge><span>Codex 订阅额度</span></div>
            {subscription.windows.map((w) => <div key={w.label} className="usage-window">
              <div className="usage-label"><span>{w.label}</span><b>{w.remaining.toFixed(0)}<small>% 剩余</small></b></div>
              <progress value={w.remaining} max={100} aria-label={w.label} className={w.remaining < account.lowBalanceThreshold ? "is-low" : ""} />
              {w.resetAt ? <span className="hint">{new Date(w.resetAt * 1000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 重置</span> : null}
            </div>)}
          </div>
        ) : !isPlan ? (
          <div className="balance-content">
            <div className="balance-row"><div><span className="hint">{balance?.currency === "CREDITS" ? "剩余额度" : "总余额"}</span><div className="balance-value">{balance?.total == null ? "—" : money(balance.total, balance.currency)}</div></div><Sparkline points={trend?.points ?? []} low={account.low}/></div>
            <div className="balance-details">{breakdown.fields.map(({label,item}) => <div key={label} title={item?.label ?? "尚未取得该项数据"}><span>{label}{item?.kind === "manual_cumulative_recharge" ? " · 手动" : ""}</span><b>{item == null ? "—" : money(item.value,item.currency ?? balance?.currency ?? "CNY")}</b></div>)}</div>
            {trend?.dailyBurn != null && trend.dailyBurn > 0 && balance ? <div className="trend-hint">日均消耗约 {money(trend.dailyBurn,balance.currency)}{trend.daysLeft != null ? " · " + daysLeftText(trend.daysLeft) : ""}</div> : null}
          </div>
        ) : balance?.total != null || (balance?.amounts.length ?? 0) > 0 ? (
          <div className="subscription-windows">
            <div className="subscription-caption"><Badge>已同步额度</Badge><span>{subscription?.plan.toUpperCase() ?? "剩余额度"}</span></div>
            <div className="usage-window"><div className="usage-label"><span>当前剩余</span><b>{balance?.total == null ? "—" : money(balance.total, balance.currency)}</b></div><span className="hint">当前接口未提供完整的额度周期。</span></div>
          </div>
        ) : (
          <div className="subscription-empty"><b>{busy ? "正在读取订阅额度" : account.status.balanceError ? "订阅额度同步失败" : "暂无订阅额度"}</b><span>{account.status.balanceError ? "可重试查询，或手动记录剩余额度。" : "连接账户后查看套餐与剩余额度"}</span>{!account.status.balanceError && !busy ? <Button size="sm" onClick={onEdit}>连接账户</Button> : null}</div>
        )}
      </div>

      {extraAmounts.length || meaningfulBalanceNote || account.note?.trim() ? <details className="account-more-details">
        <summary>更多明细{extraAmounts.length > 0 ? ` · ${extraAmounts.length} 项` : ""}</summary>
        {extraAmounts.length > 0 ? <div className="account-extra-amounts" aria-label="其他账户明细">{extraAmounts.map((item, index) => <div key={`${item.kind}-${index}`}><span>{item.label}</span><b>{money(item.value, balance?.currency ?? "CNY")}</b></div>)}</div> : null}
        {meaningfulBalanceNote ? <p className="account-data-note">{meaningfulBalanceNote}</p> : null}
        {account.note?.trim() ? <p className="account-user-note"><span>备注</span>{account.note}</p> : null}
      </details> : null}

      {!account.hasKey && account.needsApiKey && !account.provider.startsWith("mimo") ? (
        <Notice tone="warn" actions={<Button size="sm" onClick={onEdit}>填写 API Key</Button>}>
          填写 API Key 后可同步模型。
        </Notice>
      ) : null}

      {account.balanceMode !== "manual" && account.status.balanceError ? (
        <Notice
          tone="error"
          actions={
            <>
              <Button size="sm" disabled={busy} onClick={onRefresh}>
                重试
              </Button>
              <Button size="sm" onClick={onUseManual}>
                {isPlan ? "改用手动额度" : "改用手动余额"}
              </Button>
              <Button size="sm" onClick={() => openUrl(account.billingUrl || account.effectiveRechargeUrl || account.docsUrl, "官网")}>
                打开官网
              </Button>

            </>
          }
        >
          {account.status.balanceError}
          {balance || hasSubscriptionWindows ? <span className="account-stale-note">{balance?.source === "manual" && !hasSubscriptionWindows ? "当前展示手动记录。" : "当前展示上次成功同步的数据。"}</span> : null}
        </Notice>
      ) : null}

      {!isPlan && !account.balanceSupported &&
      !account.status.balance &&
      !account.status.balanceError &&
      (account.balanceMode === "auto" || account.balanceMode === "manual") ? (
        <Notice
          tone="info"
          actions={
            <>
              <Button size="sm" variant="quiet" onClick={onEdit}>
                设置其他获取方式
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => openUrl(account.billingUrl || account.docsUrl, "官网")}
              >
                去官网查看
              </Button>
            </>
          }
        >
          暂无数据，请连接账户或手动记录。

        </Notice>
      ) : null}

      {account.status.modelsError && !account.provider.startsWith("mimo") && account.provider !== "custom" ? (
        <Notice tone="info" actions={<Button size="sm" variant="quiet" onClick={onShowModels}>查看模型说明</Button>}>
          模型列表暂未同步
        </Notice>
      ) : null}

      <div className="card-foot">
        <span className="meta">更新于 {timeAgo(account.status.lastChecked)}{balance?.source === "manual" ? isPlan ? " · 手动额度" : " · 手动余额" : ""}</span>
        <div className="account-actions">
          {!isPlan && account.provider !== "mimo" && <Button size="sm" onClick={onShowModels}><IconLayers size={13}/>模型</Button>}
          <Button size="sm" disabled={busy} onClick={onRefresh}><IconRefresh size={13} className={busy ? "spin" : ""}/>{busy ? "刷新中" : "刷新"}</Button>
          <Button size="sm" onClick={onEdit}><IconPencil size={13}/>编辑</Button>
          <Button size="sm" variant="primary" disabled={!account.effectiveRechargeUrl} onClick={() => void openUrl(account.effectiveRechargeUrl,isPlan ? "订阅" : "充值")}><IconExternal size={13}/>{isPlan ? "管理订阅" : "充值"}</Button>
        </div>
      </div>
    </div>
  );
}

export function EmptyAccounts({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <div className="empty-mark">
        <IconWallet size={26} />
      </div>
      <h3>还没有添加模型账户</h3>
      <p>连接账户，集中查看余额与订阅额度。</p>
      <Button variant="primary" onClick={onAdd}>
        <IconPlus size={14} />
        添加第一个账户
      </Button>
    </div>
  );
}

export function LowBalanceBanner({
  accounts,
  trends,
}: {
  accounts: AccountView[];
  trends?: Record<string, AccountTrend>;
}) {
  const low = accounts.filter((a) => a.low || a.status.balance?.usable === false);
  if (low.length === 0) return null;
  const urgent = low
    .map((a) => ({ label: a.label, days: trends?.[a.id]?.daysLeft ?? null }))
    .filter((x) => x.days != null && x.days < 7);
  return (
    <div className="notice notice-warn" style={{ marginBottom: 16 }}>
      <IconAlert size={14} />
      <div className="notice-text">
        {low.length} 个账户额度不足：
        {low.map((a) => {
          const b = a.status.balance;
          return ` ${a.label}（${a.status.subscription ? "订阅额度不足" : b && b.total !== null ? money(b.total, b.currency) : "—"}）`;
        })}
        。
        {urgent.length > 0 ? (
          <div style={{ marginTop: 4 }}>
            {urgent.map((x) => `${x.label} ${daysLeftText(x.days as number)}`).join("；")}
            ，建议尽快充值。
          </div>
        ) : null}
      </div>
    </div>
  );
}

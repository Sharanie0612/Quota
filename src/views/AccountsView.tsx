import { useEffect, useState } from "react";
import { AccountCard, EmptyAccounts, LowBalanceBanner } from "../components/AccountCard";
import { api } from "../lib/api";
import { money } from "../lib/format";
import type { AccountTrend, AccountView, HistoryPoint } from "../lib/types";

/** 顶部汇总卡：总余额（按币种）+ 本月消耗估算 + 余额预警数 */
function SummaryBar({
  accounts,
  trends,
}: {
  accounts: AccountView[];
  trends: Record<string, AccountTrend>;
}) {
  if (accounts.length === 0) return null;

  const totals = (() => {
    const map = new Map<string, number>();
    for (const a of accounts) {
      const b = a.status.balance;
      if (b && b.total !== null) {
        map.set(b.currency, (map.get(b.currency) ?? 0) + b.total);
      }
    }
    return Array.from(map.entries()).slice(0, 2);
  })();

  /** 本月消耗 = 本月初最近一条历史余额 − 当前余额；月初前没有记录的账户不猜 */
  const spent = (() => {
    const now = new Date();
    const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    const map = new Map<string, number>();
    for (const a of accounts) {
      const b = a.status.balance;
      const pts: HistoryPoint[] = trends[a.id]?.points ?? [];
      if (!b || b.total === null || pts.length < 2) continue;
      let start: HistoryPoint | null = null;
      for (const p of pts) {
        if (p.t <= monthStart) start = p;
        else break;
      }
      if (!start) continue;
      const diff = start.v - b.total;
      if (diff > 0) map.set(b.currency, (map.get(b.currency) ?? 0) + diff);
    }
    return Array.from(map.entries()).slice(0, 2);
  })();

  const lowCount = accounts.filter((a) => a.low).length;

  return (
    <div className="summary-bar">
      <div className="stat">
        <span className="stat-label">总余额</span>
        <span className="stat-value">
          {totals.length > 0 ? totals.map(([c, v]) => money(v, c)).join(" + ") : "—"}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">本月消耗（估算）</span>
        <span className="stat-value">
          {spent.length > 0
            ? spent.map(([c, v]) => money(v, c)).join(" + ")
            : "积累几天历史后显示"}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">余额预警</span>
        <span className={`stat-value${lowCount > 0 ? " is-alert" : ""}`}>
          {lowCount > 0 ? `${lowCount} 个账户余额不足` : "全部正常"}
        </span>
      </div>
    </div>
  );
}

export function AccountsView({
  accounts,
  loading,
  refreshing,
  onRefreshOne,
  onAdd,
  onEdit,
  onOpenModels,
}: {
  accounts: AccountView[];
  loading: boolean;
  refreshing: boolean;
  onRefreshOne: (id: string) => void;
  onAdd: () => void;
  onEdit: (account: AccountView) => void;
  onOpenModels: (provider: string) => void;
}) {
  const [trends, setTrends] = useState<Record<string, AccountTrend>>({});

  // 账户列表变化（刷新/编辑后）时同步拉一次本地余额历史
  useEffect(() => {
    if (accounts.length === 0) {
      setTrends({});
      return;
    }
    let alive = true;
    api
      .getBalanceHistory()
      .then((m) => {
        if (alive) setTrends(m);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [accounts]);

  if (loading) {
    return (
      <div className="content-inner">
        <div className="grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card account-card" style={{ height: 198 }}>
              <div className="skeleton" style={{ height: 34, width: 140 }} />
              <div className="skeleton" style={{ height: 32, width: 180 }} />
              <div className="skeleton" style={{ height: 14, width: "70%" }} />
              <div className="skeleton" style={{ height: 14, width: "50%" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="content-inner">
        <EmptyAccounts onAdd={onAdd} />
      </div>
    );
  }

  return (
    <div className="content-inner">
      <SummaryBar accounts={accounts} trends={trends} />
      <LowBalanceBanner accounts={accounts} trends={trends} />
      <div className="grid">
        {accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            busy={refreshing}
            trend={trends[a.id]}
            onRefresh={() => onRefreshOne(a.id)}
            onEdit={() => onEdit(a)}
            onShowModels={() => onOpenModels(a.provider)}
          />
        ))}
      </div>
    </div>
  );
}

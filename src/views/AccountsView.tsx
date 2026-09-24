import { AccountCard, EmptyAccounts, LowBalanceBanner } from "../components/AccountCard";
import type { AccountView } from "../lib/types";

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
      <LowBalanceBanner accounts={accounts} />
      <div className="grid">
        {accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            busy={refreshing}
            onRefresh={() => onRefreshOne(a.id)}
            onEdit={() => onEdit(a)}
            onShowModels={() => onOpenModels(a.provider)}
          />
        ))}
      </div>
    </div>
  );
}

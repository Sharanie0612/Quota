import { useCallback, useEffect, useState } from "react";
import { AccountSheet } from "./components/AccountSheet";
import { IconGear, IconLayers, IconPlus, IconRefresh, IconWallet } from "./components/icons";
import { Button, EmptyState } from "./components/ui";
import { api, events } from "./lib/api";
import { useAccounts, useSettings, useToasts } from "./lib/store";
import type { AccountView, AppInfo, ProviderView } from "./lib/types";
import { AccountsView } from "./views/AccountsView";
import { ModelsView } from "./views/ModelsView";
import { SettingsView } from "./views/SettingsView";
import appIcon from "../src-tauri/icons/128x128.png";

type View = "accounts" | "models" | "settings";

export default function App() {
  const { accounts, loading, refreshing, reload, refreshAll, refreshOne } = useAccounts();
  const { settings, update } = useSettings();
  const toasts = useToasts();

  const [view, setView] = useState<View>("accounts");
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [sheetFor, setSheetFor] = useState<{ account: AccountView | null } | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState("all");
  const [modelCount, setModelCount] = useState(0);

  useEffect(() => {
    api.listProviders().then(setProviders).catch((e) => console.error(e));
    api.appInfo().then(setInfo).catch(() => undefined);
    const un = events.onFocusAccount((id) => {
      setView("accounts");
      setPendingFocus(id);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // 从悬浮卡点进来的账户：等账户列表加载好后打开它的编辑面板
  useEffect(() => {
    if (!pendingFocus) return;
    const target = accounts.find((a) => a.id === pendingFocus);
    if (target) {
      setSheetFor({ account: target });
      setPendingFocus(null);
    }
  }, [pendingFocus, accounts]);

  const lowCount = accounts.filter((a) => a.low).length;
  const onCount = useCallback((n: number) => setModelCount(n), []);

  const openModels = (provider: string) => {
    setProviderFilter(provider || "all");
    setView("models");
  };

  const title =
    view === "accounts" ? "账户总览" : view === "models" ? "模型库" : "设置";
  const sub =
    view === "accounts"
      ? accounts.length === 0
        ? "还没有添加账户"
        : `${accounts.length} 个账户${lowCount > 0 ? ` · ${lowCount} 个余额不足` : " · 余额都正常"}`
      : view === "models"
        ? `${modelCount} 个可用模型 · 价格以官网为准`
        : "刷新频率、提醒阈值与数据位置";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={appIcon} alt="" aria-hidden="true" />
          <div className="brand-text">
            <span className="brand-title">Quota</span>
            <span className="brand-sub">余额与额度看板</span>
          </div>
        </div>

        <button
          className={`nav-item${view === "accounts" ? " active" : ""}`}
          onClick={() => setView("accounts")}
        >
          <IconWallet size={16} />
          账户总览
          <span className="count">{accounts.length || ""}</span>
        </button>
        <button
          className={`nav-item${view === "models" ? " active" : ""}`}
          onClick={() => setView("models")}
        >
          <IconLayers size={16} />
          模型库
          <span className="count">{modelCount || ""}</span>
        </button>
        <button
          className={`nav-item${view === "settings" ? " active" : ""}`}
          onClick={() => setView("settings")}
        >
          <IconGear size={16} />
          设置
        </button>

        <div className="sidebar-foot">
          {lowCount > 0 ? (
            <div style={{ color: "var(--red, #d70015)", marginBottom: 6 }}>
              {lowCount} 个账户余额不足
            </div>
          ) : null}
          API Key 保存在系统凭据管理器
          <br />
          充值跳转官方页面，不经手支付
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h1>{title}</h1>
          <span className="sub">{sub}</span>
          <div className="spacer" />
          {view !== "settings" ? (
            <Button
              size="sm"
              onClick={() => void refreshAll()}
              disabled={refreshing || accounts.length === 0}
            >
              <IconRefresh size={13} className={refreshing ? "spin" : ""} />
              {refreshing ? "刷新中…" : "刷新全部"}
            </Button>
          ) : null}
          <Button size="sm" variant="primary" onClick={() => setSheetFor({ account: null })}>
            <IconPlus size={13} />
            添加账户
          </Button>
        </div>

        <div className="content">
          {view === "accounts" ? (
            <AccountsView
              accounts={accounts}
              loading={loading}
              refreshing={refreshing}
              onRefreshOne={(id) => void refreshOne(id)}
              onAdd={() => setSheetFor({ account: null })}
              onEdit={(account) => setSheetFor({ account })}
              onOpenModels={openModels}
            />
          ) : null}

          {view === "models" ? (
            accounts.length === 0 && providers.length > 0 ? (
              <div className="content-inner">
                <EmptyState
                  icon={<IconLayers size={26} />}
                  title="模型库还空着"
                  desc="模型库会根据你添加的账户，拉取该平台实际可用的模型，并匹配简介、价格与能力标签。先添加一个账户试试。"
                  action={
                    <Button variant="primary" onClick={() => setSheetFor({ account: null })}>
                      添加模型账户
                    </Button>
                  }
                />
              </div>
            ) : (
              <ModelsView
                accounts={accounts}
                providers={providers}
                providerFilter={providerFilter}
                setProviderFilter={setProviderFilter}
                onCount={onCount}
                onAddAccount={() => setSheetFor({ account: null })}
                onRefreshAll={refreshAll}
              />
            )
          ) : null}

          {view === "settings" ? (
            <SettingsView settings={settings} onUpdate={(s) => void update(s)} info={info} />
          ) : null}
        </div>
      </main>

      {sheetFor ? (
        <AccountSheet
          providers={providers}
          initial={sheetFor.account}
          defaultThreshold={settings?.defaultLowThreshold ?? 20}
          onClose={() => setSheetFor(null)}
          onSaved={(view) => {
            setSheetFor(null);
            void reload();
            if (view.provider && providerFilter !== "all" && providerFilter !== view.provider) {
              setProviderFilter("all");
            }
          }}
          onDeleted={() => {
            setSheetFor(null);
            void reload();
          }}
        />
      ) : null}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === "error" ? " error" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

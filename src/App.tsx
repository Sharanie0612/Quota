import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AccountSheet } from "./components/AccountSheet";
import { IconPlus, IconRefresh } from "./components/icons";
import { Button, Notice } from "./components/ui";
import { api, events } from "./lib/api";
import { money } from "./lib/format";
import { overviewState } from "./lib/accountOverview";
import { toast, useAccounts, useSettings } from "./lib/store";
import { ToastStack } from "./components/ToastStack";
import type { AccountView, AppInfo, ProviderView } from "./lib/types";
import { AccountsView } from "./views/AccountsView";
import type { SettingsSection } from "./views/settings/sections";
import {useMaterialLight} from './lib/useMaterialLight';
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { isWorkspacePage, workspacePages, type WorkspacePage } from "./lib/workspacePages";
import {useSidebarMotion} from './lib/useSidebarMotion';
import { WindowControls } from "./components/WindowControls";
import { WorkspaceToolbar } from "./components/WorkspaceToolbar";
import { setAppearance, useAppearance } from './lib/appearance';
import { LaunchAnimation } from './components/LaunchAnimation';

const ActivityView = lazy(() => import("./views/ActivityView").then(m => ({ default: m.ActivityView })));
const UsageCostsView = lazy(() => import("./views/UsageCostsView").then(m => ({ default: m.UsageCostsView })));
const AiModelsHub = lazy(() => import("./views/AiModelsHub").then(m => ({ default: m.AiModelsHub })));
const OutputSpeedView = lazy(() => import("./views/OutputSpeedView").then(m => ({ default: m.OutputSpeedView })));
const SettingsView = lazy(() => import("./views/SettingsView").then(m => ({ default: m.SettingsView })));

export default function App() {
  const appearance=useAppearance();
  const sidebarMotion=useSidebarMotion(appearance.collapsed,appearance.reducedMotion,appearance.glass&&appearance.reduceEffects);
  const { accounts, loading, refreshing, reload, refreshAll, refreshOne } = useAccounts();
  const { settings, update } = useSettings();

  const [settingsSection,setSettingsSection]=useState<SettingsSection>("appearance");
  const [view, setView] = useState<WorkspacePage>("accounts");
  const openSettings = (section: SettingsSection) => {
    setSettingsSection(section);
    setView("settings");
  };
  const light=useMaterialLight(appearance.material==='liquid'&&!appearance.reducedMotion,view+':'+appearance.collapsed);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {contentRef.current?.scrollTo({top:0});}, [view, settingsSection]);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [sheetFor, setSheetFor] = useState<{ account: AccountView | null; mode?: "manual" } | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  useEffect(() => {
    const report=(event:Event)=>void api.reportBenchmarkSmoke((event as CustomEvent).detail).catch(()=>undefined);
    window.addEventListener('quota-benchmark-smoke-report',report);
    return()=>window.removeEventListener('quota-benchmark-smoke-report',report);
  },[]);

  useEffect(() => {
    api.listProviders().then(setProviders).catch((e) => console.error(e));
    api.appInfo().then(setInfo).catch(() => undefined);
    const navigation = events.onNavigateMain(page => { if (isWorkspacePage(page)) setView(page); });
    const un = events.onFocusAccount((id) => {
      setView("accounts");
      setPendingFocus(id);
    });
    // 刷新时余额明显上涨：提示一次，不打断操作
    const unRecharge = events.onRechargeDetected((e) => {
      toast(
        `检测到「${e.label}」余额增加了约 ${money(e.amount, e.currency)}，可能是刚充值`,
      );
    });
    return () => {
      void navigation.then(stop => stop());
      void un.then((f) => f());
      void unRecharge.then((f) => f());
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

  const { low, failed, pending } = overviewState(accounts);
  const { title, wide } = workspacePages[view];
  const status = [
    low && low + " 个额度不足",
    failed && failed + " 个同步异常",
    pending && pending + " 个待查询",
  ].filter(Boolean).join(" · ") || "状态正常";
  const accountSummary = loading ? "正在读取账户…" : accounts.length ? accounts.length + " 个账户 · " + status : "还没有添加账户";
  const addAccount = () => setSheetFor({ account: null });
  const finishEdit = () => { setSheetFor(null); void reload(); };
  const openSources = () => openSettings("sources");

  function renderPage() {
    switch (view) {
      case "accounts":
        return <AccountsView accounts={accounts} loading={loading} refreshing={refreshing}
          onRefreshOne={refreshOne} onAdd={addAccount} onEdit={(account, mode) => setSheetFor({ account, mode })}/>;
      case "costs":
        return <UsageCostsView title={title}/>;
      case "ai-models":
        return <AiModelsHub title={title} autoUpdate={settings?.ladderAutoUpdate ?? true}/>;
      case "activity":
        return <ActivityView onOpenSources={openSources}/>;
      case "output-speed":
        return <OutputSpeedView title={title} onOpenSources={openSources}/>;
      case "settings":
        return <SettingsView section={settingsSection} onSectionChange={setSettingsSection}
          settings={settings} onUpdate={update} info={info}/>;
    }
  }

  return (
    <div ref={light} className={appearance.collapsed ? "app sidebar-collapsed" : "app"}>
      <LaunchAnimation/>
      <div className="window-drag-region" data-tauri-drag-region aria-hidden="true"/>
      <WindowControls/>
      <WorkspaceSidebar page={view} collapsed={appearance.collapsed} count={accounts.length} lowCount={low}
        version={info?.version} onNavigate={setView} onToggle={() => {
          sidebarMotion.capture();
          setAppearance({ collapsed: !appearance.collapsed });
        }}/>

      <main ref={sidebarMotion.ref} className={wide ? "main main-wide" : "main"}>
        <WorkspaceToolbar onUsage={() => setView("costs")} onSync={() => openSettings("sync")}/>
        <div className="content" ref={contentRef}>
          <div className="view-transition" key={view}>
            {!wide && <header className="page-heading content-inner">
              <div className="page-heading-text"><h1>{title}</h1>{view === "accounts" && <p>{accountSummary}</p>}</div>
              {view === "accounts" && <div className="page-actions">
                <Button size="sm" onClick={() => void refreshAll()} disabled={refreshing || accounts.length === 0}>
                  <IconRefresh size={13} className={refreshing ? "spin" : ""}/>{refreshing ? "刷新中…" : "刷新全部"}
                </Button>
                <Button size="sm" variant="primary" onClick={addAccount}><IconPlus size={13}/>添加账户</Button>
              </div>}
            </header>}
            {!!info?.storageIssues?.length && <div className="content-inner" style={{ paddingBottom: 0 }}>
              <Notice tone="error" actions={<Button size="sm" onClick={() => openSettings("about")}>查看配置目录</Button>}>
                <strong>部分本机资料未能读取，相关文件已暂停保存</strong>
                {info.storageIssues.map(issue => <p key={issue}>{issue}</p>)}
              </Notice>
            </div>}
            <Suspense fallback={<div className="content-inner" role="status" aria-label={"正在打开" + title}>
              <div className="skeleton" style={{ height: 32, width: 160 }}/>
            </div>}>
              {renderPage()}
            </Suspense>
          </div>
        </div>
      </main>

      {sheetFor && <AccountSheet providers={providers} initial={sheetFor.account} initialBalanceMode={sheetFor.mode}
        defaultThreshold={settings?.defaultLowThreshold ?? 20} onClose={() => setSheetFor(null)}
        onSaved={finishEdit} onDeleted={finishEdit}/>}
      <ToastStack/>
    </div>
  );
}

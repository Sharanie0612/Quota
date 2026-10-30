import {listen} from '@tauri-apps/api/event';
import {GlassBackdrop} from './components/GlassBackdrop';
import { useEffect, useRef, useState } from "react";
import { AccountSheet } from "./components/AccountSheet";
import { IconChart, IconClock, IconGear, IconSpeed, IconPlus, IconRefresh, IconSpark, IconWallet } from "./components/icons";
import { Button, Notice } from "./components/ui";
import { api, events } from "./lib/api";
import { money } from "./lib/format";
import { overviewState } from "./lib/accountOverview";
import { toast, useAccounts, useSettings } from "./lib/store";
import { ToastStack } from "./components/ToastStack";
import type { AccountView, AppInfo, ProviderView } from "./lib/types";
import { AccountsView } from "./views/AccountsView";
import { OutputSpeedView } from "./views/OutputSpeedView";
import { SettingsView } from "./views/SettingsView";
import { ActivityView } from "./views/ActivityView";
import { UsageCostsView } from "./views/UsageCostsView";
import {useSidebarMotion} from './lib/useSidebarMotion';
import { useSlidingHighlight } from "./lib/useSlidingHighlight";
import { WindowControls } from "./components/WindowControls";
import { WorkspaceToolbar } from "./components/WorkspaceToolbar";
import { setAppearance, useAppearance } from './lib/appearance';
import { AiModelsHub } from './views/AiModelsHub';
import { LaunchAnimation } from './components/LaunchAnimation';
import appIcon from "../src-tauri/icons/128x128.png";

type View = "accounts" | "output-speed" | "activity" | "costs" | "settings" | "ai-models";

export default function App() {
  const appearance=useAppearance();
  const sidebarMotion=useSidebarMotion(appearance.collapsed);
  const { accounts, loading, refreshing, reload, refreshAll, refreshOne } = useAccounts();
  const { settings, update } = useSettings();

  const [view, setView] = useState<View>("accounts");
  useEffect(()=>{const un=listen<string>('navigate-main',event=>{if(['costs','output-speed','activity','settings'].includes(event.payload))setView(event.payload as View);});return()=>{void un.then(stop=>stop());};},[]);
  const nav = useSlidingHighlight<HTMLElement>(view);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {contentRef.current?.scrollTo({top:0});}, [view]);
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

  const { low: lowCount, failed: failedCount, pending: pendingCount } = overviewState(accounts);


  const title =
    view === "ai-models" ? "AI 模型" : view === "accounts" ? "账户总览" : view === "output-speed" ? "输出速度" : view === "activity" ? "Token 活动" : view === "costs" ? "我的使用" : "设置";
  const sub =
    view === "accounts"
      ? accounts.length === 0
        ? "还没有添加账户"
        : `${accounts.length} 个账户${lowCount > 0 ? ` · ${lowCount} 个额度不足` : ""}${failedCount > 0 ? ` · ${failedCount} 个同步异常` : ""}${pendingCount > 0 ? ` · ${pendingCount} 个待查询` : ""}${!lowCount && !failedCount && !pendingCount ? " · 状态正常" : ""}`
      : '';

  return (
    <div className={`app${appearance.collapsed?' sidebar-collapsed':''}`}>
      <GlassBackdrop/>
      <LaunchAnimation/>
      <div className="window-drag-region" data-tauri-drag-region aria-hidden="true"/>
      <WindowControls/>
      <button type="button" className="sidebar-toggle" aria-label={appearance.collapsed?'展开侧边栏':'收起侧边栏'} aria-expanded={!appearance.collapsed} aria-controls="main-sidebar" title={appearance.collapsed?'展开侧边栏':'收起侧边栏'} onClick={()=>{sidebarMotion.capture();setAppearance({collapsed:!appearance.collapsed});}}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>{appearance.collapsed?<path d="m12 9 3 3-3 3"/>:<path d="m16 9-3 3 3 3"/>}</svg></button>
      <aside className="sidebar" id="main-sidebar">
        <div className="brand" data-tauri-drag-region>
          <img className="brand-mark" src={appIcon} alt="" aria-hidden="true" />
          <div className="brand-text">
            <span className="brand-title">Quota</span>
          </div>
        </div>

        <nav className="sidebar-nav" ref={nav} aria-label="主导航">
        <span className="motion-highlight" aria-hidden="true"/>
        <button data-motion-active={view === "accounts"}
          aria-label="账户总览" title="账户总览"
          className={`nav-item${view === "accounts" ? " active" : ""}`}
          onClick={() => setView("accounts")}
        >
          <IconWallet size={16} />
          <span className="nav-label">账户总览</span>
          <span className="count">{accounts.length || ""}</span>
        </button>
        <button aria-label="我的使用" title="我的使用" data-motion-active={view === "costs"} className={`nav-item${view === "costs" ? " active" : ""}`} onClick={() => setView("costs")}><IconChart size={17}/><span className="nav-label">我的使用</span></button>
        <button aria-label="AI 模型" data-motion-active={view === 'ai-models'} className={`nav-item${view === 'ai-models'?' active':''}`} onClick={()=>setView('ai-models')} title="AI 模型"><IconSpark size={17}/><span className="nav-label">AI 模型</span></button>
        <button aria-label="Token 活动" title="Token 活动" data-motion-active={view === "activity"} className={`nav-item${view === "activity" ? " active" : ""}`} onClick={() => setView("activity")}><IconClock size={17}/><span className="nav-label">Token 活动</span></button>
        <button aria-label="输出速度" title="输出速度" data-motion-active={view === "output-speed"} className={`nav-item${view === "output-speed" ? " active" : ""}`} onClick={() => setView("output-speed")}><IconSpeed size={17}/><span className="nav-label">输出速度</span></button>
        <button data-motion-active={view === "settings"}
          aria-label="设置" title="设置"
          className={`nav-item${view === "settings" ? " active" : ""}`}
          onClick={() => setView("settings")}
        >
          <IconGear size={16} />
          <span className="nav-label">设置</span>
        </button>
        </nav>

        <div className="sidebar-foot">
          {lowCount > 0 ? (
            <div className="sidebar-alert" style={{ color: "var(--red, #d70015)", marginBottom: 6 }}>
              {lowCount} 个账户余额不足
            </div>
          ) : null}
          Quota {info?.version ?? ""}
        </div>
      </aside>

      <main ref={sidebarMotion.ref} className={`main${view==='ai-models'||view==='output-speed'||view==='costs'?' main-wide':''}`}>
        <WorkspaceToolbar onUsage={() => setView('costs')} onSync={() => setView('settings')}/>
        <div className="content" ref={contentRef}>
          <div className="view-transition" key={view}>
        {view!=='ai-models'&&view!=='output-speed'&&view!=='costs'&&<header className="page-heading content-inner">
          <div className="page-heading-text"><h1>{title}</h1>{sub&&<p>{sub}</p>}</div>
          <div className="page-actions">
          {view === "accounts" ? (
            <Button
              size="sm"
              onClick={() => void refreshAll()}
              disabled={refreshing || accounts.length === 0}
            >
              <IconRefresh size={13} className={refreshing ? "spin" : ""} />
              {refreshing ? "刷新中…" : "刷新全部"}
            </Button>
          ) : null}
          {view === "accounts" ? <Button size="sm" variant="primary" onClick={() => setSheetFor({ account: null })}>
            <IconPlus size={13} />
            添加账户
          </Button> : null}
          </div>
        </header>}
          {info?.storageIssues?.length ? (
            <div className="content-inner" style={{ paddingBottom: 0 }}>
              <Notice tone="error" actions={<Button size="sm" onClick={() => setView("settings")}>查看配置目录</Button>}>
                <strong>部分本机资料未能读取，相关文件已暂停保存</strong>
                {info.storageIssues.map(issue => <p key={issue}>{issue}</p>)}
              </Notice>
            </div>
          ) : null}
          {view === "accounts" ? (
            <AccountsView
              accounts={accounts}
              loading={loading}
              refreshing={refreshing}
              onRefreshOne={(id) => void refreshOne(id)}
              onAdd={() => setSheetFor({ account: null })}
              onEdit={(account, mode) => setSheetFor({ account, mode })}
            />
          ) : null}

          {view === 'ai-models' ? <AiModelsHub/> : null}
          {view === "activity" ? <ActivityView onOpenSyncSettings={()=>setView('settings')} /> : null}
          {view === "output-speed" ? <OutputSpeedView onOpenSyncSettings={()=>setView("settings")}/> : null}
          {view === "costs" ? <UsageCostsView /> : null}
          {view === "settings" ? (
            <SettingsView settings={settings} onUpdate={(s) => void update(s)} info={info} />
          ) : null}
          </div>
        </div>
      </main>

      {sheetFor ? (
        <AccountSheet
          providers={providers}
          initial={sheetFor.account}
          initialBalanceMode={sheetFor.mode}
          defaultThreshold={settings?.defaultLowThreshold ?? 20}
          onClose={() => setSheetFor(null)}
          onSaved={() => {
            setSheetFor(null);
            void reload();
          }}
          onDeleted={() => {
            setSheetFor(null);
            void reload();
          }}
        />
      ) : null}

      <ToastStack />
    </div>
  );
}
